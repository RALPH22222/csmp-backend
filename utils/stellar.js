import {
  Operation,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import {
  walletKeypair,
  walletPublic,
  stellarRpc,
  networkPassphrase,
  PHP_DECIMALS,
} from '../config/stellar.js';

function isAddressString(value) {
  return typeof value === 'string' && (/^G[A-Z0-9]{55}$/.test(value) || /^C[A-Z0-9]{55}$/.test(value));
}

// Wrap a value to force a specific ScVal type instead of relying on guesswork.
export function scArg(value, type) {
  return { __scType: type, value };
}

export function invokeOp(contractAddress, functionName, args) {
  const contract = new Address(contractAddress);

  const scArgs = args.map(a => {
    if (a && typeof a === 'object' && '__scType' in a) {
      return nativeToScVal(a.value, { type: a.__scType });
    }
    if (isAddressString(a)) {
      return new Address(a).toScVal();
    }
    return nativeToScVal(a);
  });

  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.toScAddress(),
    functionName,
    args: scArgs,
  });

  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs);

  return Operation.invokeHostFunction({ func, auth: [] });
}

async function submitTx(sourcePublicKey, signerKeypair, operation) {
  const sourceAccount = await stellarRpc.getAccount(sourcePublicKey);
  let tx = new TransactionBuilder(sourceAccount, { fee: BASE_FEE, networkPassphrase })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  tx = await stellarRpc.prepareTransaction(tx);
  tx.sign(signerKeypair);

  const sendResp = await stellarRpc.sendTransaction(tx);
  if (sendResp.status !== 'PENDING')
    throw new Error(`Send failed: ${JSON.stringify(sendResp)}`);

  while (true) {
    await new Promise(r => setTimeout(r, 1000));
    const txResp = await stellarRpc.getTransaction(sendResp.hash);
    if (txResp.status === 'SUCCESS') return txResp.returnValue;
    if (txResp.status === 'FAILED')
      throw new Error(`Tx failed: ${JSON.stringify(txResp)}`);
  }
}

// Wallet-signed single op (used by create_pool, join_pool, payout, get_pool_state)
export async function buildAndSubmit(operations) {
  if (operations.length !== 1) {
    throw new Error('Soroban only allows one invokeHostFunction op per transaction');
  }
  return submitTx(walletPublic, walletKeypair, operations[0]);
}

// User-signed single op (used by contribute, split across two txs)
export async function submitUserOp(userPublicKey, userKeypair, operation) {
  return submitTx(userPublicKey, userKeypair, operation);
}

export function toTokenUnits(amount) {
  return BigInt(Math.floor(parseFloat(amount) * Math.pow(10, PHP_DECIMALS)));
}