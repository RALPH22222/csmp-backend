import { supabase } from '../config/supabase.js';
import { PHP_TOKEN_ADDRESS } from '../config/stellar.js';
import { invokeOp, buildAndSubmit, toTokenUnits } from '../utils/stellar.js';
import { scValToNative } from '@stellar/stellar-sdk';

export const createPool = async (req, res) => {
  try {
    const { name, total_members, contribution_amount, cycle_duration_days, max_members, contract_address } = req.body;
    const total_payout = max_members * contribution_amount;

    const { data: pool, error } = await supabase
      .from('pools')
      .insert({
        pool_name: name,
        pool_status_id: 1,               // FORMING
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
      invokeOp(contract_address, 'create_pool', [
        pool.id,
        total_members,
        contribution_amount.toString(),
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

    const { data: pool, error: poolErr } = await supabase.from('pools').select('*').eq('id', poolId).single();
    if (poolErr || !pool) return res.status(404).json({ error: 'Pool not found' });

    const { data: member, error: memberErr } = await supabase
      .from('pool_members')
      .insert({
        pool_id: poolId,
        user_id,
        member_status_id: 1,             // ACTIVE
        payout_sequence_number: sequence,
      })
      .select()
      .single();
    if (memberErr) throw memberErr;

    const { data: userRecord, error: userErr } = await supabase
      .from('users')
      .select('stellar_public_key')
      .eq('id', user_id)
      .single();
    if (userErr) throw userErr;

    await buildAndSubmit([
      invokeOp(pool.soroban_contract_address, 'add_member', [
        poolId,
        userRecord.stellar_public_key,
        sequence,
      ]),
    ]);

    return res.status(201).json(member);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const contribute = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { user_id } = req.body;

    const { data: pool, error: poolErr } = await supabase.from('pools').select('*').eq('id', poolId).single();
    if (poolErr) throw poolErr;

    const { data: member, error: memberErr } = await supabase
      .from('pool_members')
      .select('*, users(stellar_public_key)')
      .eq('pool_id', poolId)
      .eq('user_id', user_id)
      .single();
    if (memberErr || !member) return res.status(400).json({ error: 'Not a member' });

    const contractAddress = pool.soroban_contract_address;
    const memberAddr = member.users.stellar_public_key;
    const amountUnits = toTokenUnits(pool.cycle_contribution_amount);

    await buildAndSubmit([
      invokeOp(PHP_TOKEN_ADDRESS, 'transfer', [memberAddr, contractAddress, amountUnits]),
      invokeOp(contractAddress, 'contribute', [poolId, memberAddr]),
    ]);

    await supabase.from('transactions').insert({
      pool_member_id: member.id,
      transaction_type_id: 1,
      transaction_status_id: 2,
      amount: pool.cycle_contribution_amount,
    });

    await supabase.rpc('increment_contribution', {
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
    const { data: pool, error } = await supabase.from('pools').select('*').eq('id', poolId).single();
    if (error) throw error;

    await buildAndSubmit([
      invokeOp(pool.soroban_contract_address, 'payout', [poolId]),
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
      .from('pools')
      .select('soroban_contract_address')
      .eq('id', poolId)
      .single();
    if (error) throw error;

    const rawState = await buildAndSubmit([
      invokeOp(pool.soroban_contract_address, 'get_pool_state', [poolId]),
    ]);

    const state = scValToNative(rawState);
    return res.json(state);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
