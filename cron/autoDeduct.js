import cron from 'node-cron';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { PHP_TOKEN_ADDRESS } from '../config/stellar.js';
import { invokeOp, toTokenUnits, submitUserOp, scArg } from '../utils/stellar.js';
import { Keypair } from '@stellar/stellar-sdk';

const ENCRYPTION_KEY = process.env.JWT_SECRET
  ? crypto.scryptSync(process.env.JWT_SECRET, 'salt', 32)
  : crypto.scryptSync('fallback_secret_key', 'salt', 32);

const decryptText = (text) => {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

export const startCronJobs = () => {
  // Run every 5 minutes for demo/testing purposes
  cron.schedule('*/5 * * * *', async () => {
    console.log('[CRON] Running auto-deduct checks for all active pools...');
    try {
      // 1. Fetch active pools
      const { data: pools, error: poolsErr } = await supabase.from('pools').select('*').eq('pool_status_id', 2);
      if (poolsErr) throw poolsErr;
      
      const now = new Date();

      for (const pool of pools) {
        // 2. Get members
        const { data: members, error: memErr } = await supabase
          .from('pool_members')
          .select('*, users(stellar_public_key, stellar_secret)')
          .eq('pool_id', pool.id);
          
        if (memErr || !members) continue;
        
        const currentMembers = members.length || 1;
        const dynamicContribution = pool.total_payout_amount / currentMembers;
        
        // Calculate expected cycles
        const startDate = new Date(pool.created_at);
        const diffDays = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        // Add 1 because the 1st cycle is due immediately upon starting
        const expectedCycles = Math.floor(diffDays / pool.cycle_duration_days) + 1;
        const expectedContributed = expectedCycles * dynamicContribution;
        
        for (const member of members) {
          const totalContributed = Number(member.total_contributed || 0);
          
          if (totalContributed < expectedContributed) {
            console.log(`[CRON] Auto-deducting ${dynamicContribution} from member ${member.user_id} for pool ${pool.id}`);
            try {
              const contractAddress = pool.soroban_contract_address;
              const memberAddr = member.users.stellar_public_key;
              const encryptedSecret = member.users.stellar_secret;
              if (!encryptedSecret) continue;

              const userSecret = decryptText(encryptedSecret);
              const userKeypair = Keypair.fromSecret(userSecret);
              const amountUnits = toTokenUnits(dynamicContribution);

              await submitUserOp(
                memberAddr,
                userKeypair,
                invokeOp(PHP_TOKEN_ADDRESS, 'transfer', [
                  memberAddr,
                  contractAddress,
                  scArg(amountUnits, 'i128'),
                ])
              );

              await submitUserOp(
                memberAddr,
                userKeypair,
                invokeOp(contractAddress, 'contribute', [
                  scArg(pool.id, 'string'),
                  memberAddr,
                ])
              );

              await supabase.from('transactions').insert({
                pool_member_id: member.id,
                transaction_type_id: 1,
                transaction_status_id: 2,
                amount: dynamicContribution,
              });

              await supabase.rpc('increment_contribution', {
                member_id: member.id,
                amount: dynamicContribution,
              });
              
              console.log(`[CRON] Successfully deducted ${dynamicContribution} from ${member.user_id}`);
            } catch (err) {
              console.error(`[CRON] Failed to deduct from member ${member.user_id}:`, err.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('[CRON] Error during auto-deduct:', err.message);
    }
  });
};
