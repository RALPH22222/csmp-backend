// fix_trustline.js
import { supabase } from './config/supabase.js';
import { Keypair, Asset, Operation, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import { stellarRpc, networkPassphrase, PHP_TOKEN_CODE, PHP_TOKEN_ISSUER } from './config/stellar.js';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.JWT_SECRET
  ? crypto.scryptSync(process.env.JWT_SECRET, 'salt', 32)
  : crypto.scryptSync('fallback_secret_key', 'salt', 32);

const decryptText = (text) => {
  const [ivHex, ...rest] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encryptedText = Buffer.from(rest.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

const USER_ID = '66494b42-6061-40d2-878e-daec2bd256aa';

const { data: user, error } = await supabase
  .from('users')
  .select('stellar_public_key, stellar_secret')
  .eq('id', USER_ID)
  .single();
if (error || !user?.stellar_secret) throw new Error('User or secret not found');

const secretKey = decryptText(user.stellar_secret);
const keypair = Keypair.fromSecret(secretKey);
const asset = new Asset(PHP_TOKEN_CODE, PHP_TOKEN_ISSUER);
const sourceAccount = await stellarRpc.getAccount(user.stellar_public_key);

let tx = new TransactionBuilder(sourceAccount, { fee: BASE_FEE, networkPassphrase })
  .addOperation(Operation.changeTrust({ asset }))
  .setTimeout(30)
  .build();
tx.sign(keypair);

const sendResp = await stellarRpc.sendTransaction(tx);
console.log('Send status:', sendResp.status);

let txResp;
while (true) {
  await new Promise((r) => setTimeout(r, 1000));
  txResp = await stellarRpc.getTransaction(sendResp.hash);
  if (txResp.status === 'SUCCESS' || txResp.status === 'FAILED') break;
}
console.log('Final status:', txResp.status);