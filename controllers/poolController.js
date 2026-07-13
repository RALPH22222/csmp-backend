import { supabase } from "../config/supabase.js";
import { PHP_TOKEN_ADDRESS, PALUWAGAN_CONTRACT_ADDRESS } from "../config/stellar.js";
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
    let { name, total_members, total_payout_amount, cycle_duration_days, max_members, organizer_id, join_as_member } = req.body;
    
    // Validate credit score
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('did_credit_score, stellar_public_key')
      .eq('id', organizer_id)
      .single();
      
    if (userError || !userData) {
      return res.status(400).json({ error: "Could not fetch user data." });
    }
    
    if (userData.did_credit_score < 500) {
      return res.status(403).json({ error: "Insufficient credit score. A minimum score of 500 is required to create a pool." });
    }

    if (!userData.stellar_public_key) {
      return res.status(400).json({ error: "User does not have a Stellar wallet. Please set up a wallet first." });
    }

    const contribution_amount = max_members > 0 ? total_payout_amount / max_members : 0;

    const { data: pool, error } = await supabase
      .from("pools")
      .insert({
        pool_name: name,
        pool_status_id: 5, // PENDING
        total_payout_amount: total_payout_amount,
        cycle_contribution_amount: contribution_amount,
        cycle_duration_days,
        max_members,
        soroban_contract_address: PALUWAGAN_CONTRACT_ADDRESS,
        organizer_id: organizer_id,
      })
      .select()
      .single();
    if (error) throw error;

    try {
      await buildAndSubmit([
        invokeOp(PALUWAGAN_CONTRACT_ADDRESS, 'create_pool', [
          scArg(pool.id, 'string'),
          scArg(total_members, 'u32'),
          scArg(toTokenUnits(contribution_amount), 'i128'),
          PHP_TOKEN_ADDRESS,
        ]),
      ]);
    } catch (err) {
      console.warn('Skipping smart contract create_pool:', err.message);
    }

    const { data: existingMember } = await supabase
      .from('pool_members')
      .select('*')
      .eq('pool_id', pool.id)
      .eq('user_id', organizer_id)
      .single();

    if (join_as_member) {
      const sequence = 1;
      
      if (!existingMember) {
        const { error: memberErr } = await supabase
          .from('pool_members')
          .insert({
            pool_id: pool.id,
            user_id: organizer_id,
            member_status_id: 1,
            payout_sequence_number: sequence,
          });
        if (memberErr) throw memberErr;
      }

      try {
        await buildAndSubmit([
          invokeOp(PALUWAGAN_CONTRACT_ADDRESS, 'add_member', [
            scArg(pool.id, 'string'),
            userData.stellar_public_key,
            scArg(sequence, 'u32'),
          ]),
        ]);
      } catch (err) {
        console.warn('Skipping smart contract add_member:', err.message);
      }
    }

    return res.status(201).json(pool);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const joinPool = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { user_id, sequence } = req.body;

    const { data: pool, error: poolErr } = await supabase.from('pools').select('*').eq('id', poolId).single();
    if (poolErr || !pool) return res.status(404).json({ error: 'Pool not found' });
    
    if (pool.pool_status_id !== 1) { // 1 = FORMING
      return res.status(400).json({ error: 'This pool is not currently accepting members' });
    }

    const { data: userRecord, error: userErr } = await supabase
      .from("users")
      .select("stellar_public_key")
      .eq("id", user_id)
      .single();
    if (userErr) throw userErr;

    if (pool.soroban_contract_address) {
      if (!userRecord.stellar_public_key) {
        return res.status(400).json({ error: "User does not have a Stellar wallet address. Please create a wallet first." });
      }

      // On-chain call FIRST — don't touch Supabase until this succeeds
      await buildAndSubmit([
        invokeOp(pool.soroban_contract_address, "add_member", [
          scArg(poolId, "string"),
          userRecord.stellar_public_key,
          scArg(sequence, "u32"),
        ]),
      ]);
    }

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

    // removed duplicate add_member call
    // Check if max members reached, if so, set pool status to ACTIVE (2)
    const { count, error: countErr } = await supabase
      .from('pool_members')
      .select('*', { count: 'exact', head: true })
      .eq('pool_id', poolId);
      
    if (!countErr && count >= pool.max_members) {
      await supabase
        .from('pools')
        .update({ pool_status_id: 2 }) // ACTIVE
        .eq('id', poolId);
    }

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

    if (!pool.soroban_contract_address) {
      return res.status(400).json({ error: 'This pool is not fully initialized (missing contract address)' });
    }

    const { data: member, error: memberErr } = await supabase
      .from("pool_members")
      .select("*, users(stellar_public_key, stellar_secret)")
      .eq("pool_id", poolId)
      .eq("user_id", user_id)
      .single();
    if (memberErr || !member) return res.status(400).json({ error: 'Not a member' });

    // Fetch total members to calculate dynamic contribution
    const { count, error: countErr } = await supabase
      .from('pool_members')
      .select('*', { count: 'exact', head: true })
      .eq('pool_id', poolId);
      
    if (countErr) throw countErr;
    
    const currentMembers = count || 1;
    const dynamicContribution = pool.total_payout_amount / currentMembers;

    const contractAddress = pool.soroban_contract_address;
    const memberAddr = member.users.stellar_public_key;
    const encryptedSecret = member.users.stellar_secret;
    if (!encryptedSecret)
      return res.status(400).json({ error: "User secret not available" });

    const userSecret = decryptText(encryptedSecret);
    const userKeypair = Keypair.fromSecret(userSecret);
    const amountUnits = toTokenUnits(dynamicContribution);

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
      amount: dynamicContribution,
    });

    await supabase.rpc("increment_contribution", {
      member_id: member.id,
      amount: dynamicContribution,
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

    if (!pool.soroban_contract_address) {
      return res.status(400).json({ error: 'This pool is not fully initialized (missing contract address)' });
    }

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

    if (!pool.soroban_contract_address) {
      return res.status(400).json({ error: 'This pool is not fully initialized (missing contract address)' });
    }

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

export const getAllPools = async (req, res) => {
  try {
    const { data: pools, error } = await supabase
      .from('pools')
      .select('*, pool_statuses(status_name)')
      .in('pool_status_id', [1, 3]);
    
    if (error) throw error;
    return res.json(pools);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const getMyPools = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Fetch pools where the user is a member
    const { data: members, error: membersErr } = await supabase
      .from('pool_members')
      .select('pool_id, pools(*, pool_statuses(status_name))')
      .eq('user_id', userId);
      
    if (membersErr) throw membersErr;

    // Fetch pools where the user is the organizer
    const { data: organized, error: organizedErr } = await supabase
      .from('pools')
      .select('*, pool_statuses(status_name)')
      .eq('organizer_id', userId);

    if (organizedErr) throw organizedErr;

    const myPools = members.map(m => m.pools);
    
    // Merge organized pools, avoiding duplicates
    const existingPoolIds = new Set(myPools.map(p => p.id));
    for (const pool of organized) {
      if (!existingPoolIds.has(pool.id)) {
        myPools.push(pool);
      }
    }

    return res.json(myPools);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const getPoolById = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { data: pool, error } = await supabase
      .from('pools')
      .select('*, pool_statuses(status_name), pool_members(*, users(first_name, last_name), member_statuses(status_name))')
      .eq('id', poolId)
      .single();
      
    if (error) throw error;
    return res.json(pool);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};