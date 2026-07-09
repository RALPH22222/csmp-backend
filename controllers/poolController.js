import { supabase } from "../config/supabase.js";
import { PHP_TOKEN_ADDRESS } from "../config/stellar.js";
import {
  invokeOp,
  toTokenUnits,
  buildAndSubmit,
  submitUserOp,
  scArg,
} from "../utils/stellar.js";
import { Keypair, scValToNative } from "@stellar/stellar-sdk";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.JWT_SECRET
  ? crypto.scryptSync(process.env.JWT_SECRET, "salt", 32)
  : crypto.scryptSync("fallback_secret_key", "salt", 32);

const decryptText = (text) => {
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift(), "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

export const createPool = async (req, res) => {
  try {
    const {
      name,
      total_members,
      contribution_amount,
      cycle_duration_days,
      max_members,
      contract_address,
    } = req.body;
    const total_payout = max_members * contribution_amount;

    const { data: pool, error } = await supabase
      .from("pools")
      .insert({
        pool_name: name,
        pool_status_id: 1,
        total_payout_amount: total_payout,
        cycle_contribution_amount: contribution_amount,
        cycle_duration_days,
        max_members,
        soroban_contract_address: contract_address,
      })
      .select()
      .single();
    if (error) throw error;

    await buildAndSubmit([
      invokeOp(contract_address, "create_pool", [
        scArg(pool.id, "string"),
        scArg(total_members, "u32"),
        scArg(toTokenUnits(contribution_amount), "i128"),
        PHP_TOKEN_ADDRESS,
      ]),
    ]);

    return res.status(201).json(pool);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const joinPool = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { user_id, sequence } = req.body;

    const { data: pool, error: poolErr } = await supabase
      .from("pools")
      .select("*")
      .eq("id", poolId)
      .single();
    if (poolErr || !pool)
      return res.status(404).json({ error: "Pool not found" });

    const { data: userRecord, error: userErr } = await supabase
      .from("users")
      .select("stellar_public_key")
      .eq("id", user_id)
      .single();
    if (userErr) throw userErr;

    // On-chain call FIRST — don't touch Supabase until this succeeds
    await buildAndSubmit([
      invokeOp(pool.soroban_contract_address, "add_member", [
        scArg(poolId, "string"),
        userRecord.stellar_public_key,
        scArg(sequence, "u32"),
      ]),
    ]);

    // Only insert into Supabase after chain success
    const { data: member, error: memberErr } = await supabase
      .from("pool_members")
      .insert({
        pool_id: poolId,
        user_id,
        member_status_id: 1,
        payout_sequence_number: sequence,
      })
      .select()
      .single();
    if (memberErr) throw memberErr;

    return res.status(201).json(member);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const contribute = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { user_id } = req.body;

    const { data: pool, error: poolErr } = await supabase
      .from("pools")
      .select("*")
      .eq("id", poolId)
      .single();
    if (poolErr) throw poolErr;

    const { data: member, error: memberErr } = await supabase
      .from("pool_members")
      .select("*, users(stellar_public_key, stellar_secret)")
      .eq("pool_id", poolId)
      .eq("user_id", user_id)
      .single();
    if (memberErr || !member)
      return res.status(400).json({ error: "Not a member" });

    const contractAddress = pool.soroban_contract_address;
    const memberAddr = member.users.stellar_public_key;
    const encryptedSecret = member.users.stellar_secret;
    if (!encryptedSecret)
      return res.status(400).json({ error: "User secret not available" });

    const userSecret = decryptText(encryptedSecret);
    const userKeypair = Keypair.fromSecret(userSecret);
    const amountUnits = toTokenUnits(pool.cycle_contribution_amount);

    // Soroban allows only one invokeHostFunction op per tx — send as two.
    await submitUserOp(
      memberAddr,
      userKeypair,
      invokeOp(PHP_TOKEN_ADDRESS, "transfer", [
        memberAddr,
        contractAddress,
        scArg(amountUnits, "i128"),
      ]),
    );

    await submitUserOp(
      memberAddr,
      userKeypair,
      invokeOp(contractAddress, "contribute", [
        scArg(poolId, "string"),
        memberAddr,
      ]),
    );

    await supabase.from("transactions").insert({
      pool_member_id: member.id,
      transaction_type_id: 1,
      transaction_status_id: 2,
      amount: pool.cycle_contribution_amount,
    });

    await supabase.rpc("increment_contribution", {
      member_id: member.id,
      amount: pool.cycle_contribution_amount,
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const payout = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { data: pool, error } = await supabase
      .from("pools")
      .select("*")
      .eq("id", poolId)
      .single();
    if (error) throw error;

    await buildAndSubmit([
      invokeOp(pool.soroban_contract_address, "payout", [
        scArg(poolId, "string"),
      ]),
    ]);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const getPoolState = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { data: pool, error } = await supabase
      .from("pools")
      .select("soroban_contract_address")
      .eq("id", poolId)
      .single();
    if (error) throw error;

    const rawState = await buildAndSubmit([
      invokeOp(pool.soroban_contract_address, "get_pool_state", [
        scArg(poolId, "string"),
      ]),
    ]);

    const state = JSON.parse(
      JSON.stringify(scValToNative(rawState), (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
    return res.json(state);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
