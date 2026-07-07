import {
  Operation,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import {
  walletKeypair,
  walletPublic,
  stellarRpc,
  networkPassphrase,
  PHP_DECIMALS,
} from "../config/stellar.js";

export function invokeOp(contractAddress, functionName, args) {
  const contract = new Address(contractAddress);
  const scArgs = args.map(a => nativeToScVal(a.value, { type: a.type }));

  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.toScAddress(),
    functionName: functionName,
    args: scArgs,
  });

  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs);

  return Operation.invokeHostFunction({
    func,
    auth: [],
  });
}

export async function buildAndSubmit(operations) {
  const sourceAccount = await stellarRpc.getAccount(walletPublic);
  let txBuilder = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  });

  for (const op of operations) {
    txBuilder = txBuilder.addOperation(op);
  }
  let tx = txBuilder.setTimeout(30).build();

  // Simulate + attach Soroban resource footprint/fee
  tx = await stellarRpc.prepareTransaction(tx);

  tx.sign(walletKeypair);

  const sendResp = await stellarRpc.sendTransaction(tx);
  if (sendResp.status !== "PENDING")
    throw new Error(`Send failed: ${JSON.stringify(sendResp)}`);

  while (true) {
    await new Promise((r) => setTimeout(r, 1000));
    const txResp = await stellarRpc.getTransaction(sendResp.hash);
    if (txResp.status === "SUCCESS") return txResp.returnValue;
    if (txResp.status === "FAILED")
      throw new Error(`Tx failed: ${JSON.stringify(txResp)}`);
  }
}

export function toTokenUnits(amount) {
  return Math.floor(parseFloat(amount) * Math.pow(10, PHP_DECIMALS)).toString();
}
