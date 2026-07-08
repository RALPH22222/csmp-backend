// check_token.js
import { stellarRpc, networkPassphrase, walletKeypair, walletPublic, PHP_TOKEN_ADDRESS } from './config/stellar.js';
import { invokeOp } from './utils/stellar.js';
import { TransactionBuilder, BASE_FEE, scValToNative } from '@stellar/stellar-sdk';

const sourceAccount = await stellarRpc.getAccount(walletPublic);
let tx = new TransactionBuilder(sourceAccount, { fee: BASE_FEE, networkPassphrase })
  .addOperation(invokeOp(PHP_TOKEN_ADDRESS, 'name', []))
  .setTimeout(30)
  .build();

const sim = await stellarRpc.simulateTransaction(tx);
if (sim.result?.retval) {
  console.log('Token name:', scValToNative(sim.result.retval));
} else {
  console.log(JSON.stringify(sim, null, 2));
}