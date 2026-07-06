import { TransactionBuilder, BASE_FEE, Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { walletKeypair, walletPublic, stellarRpc, networkPassphrase, PHP_DECIMALS } from '../config/stellar.js';

export function invokeOp(contractAddress, functionName, args) {
  return {
    type: 'invokeHostFunction',
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new Address(contractAddress).toScVal(),
      functionName,
      args.map(a => nativeToScVal(a))
    ),
    auth: [],
  };
}

export async function buildAndSubmit(operations) {
  const sourceAccount = await stellarRpc.getAccount(walletPublic);
  let tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  });

  for (const op of operations) {
    tx = tx.addOperation(op);
  }
  tx = tx.setTimeout(30).build();
  tx.sign(walletKeypair);

  const sendResp = await stellarRpc.sendTransaction(tx);
  if (sendResp.status !== 'PENDING') throw new Error(`Send failed: ${JSON.stringify(sendResp)}`);

  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    const txResp = await stellarRpc.getTransaction(sendResp.hash);
    if (txResp.status === 'SUCCESS') return txResp.returnValue;
    if (txResp.status === 'FAILED') throw new Error(`Tx failed: ${JSON.stringify(txResp)}`);
  }
}

export function toTokenUnits(amount) {
  return Math.floor(parseFloat(amount) * Math.pow(10, PHP_DECIMALS)).toString();
}