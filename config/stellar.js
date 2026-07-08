import { Keypair, rpc } from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
dotenv.config();

export const walletKeypair = Keypair.fromSecret(process.env.WALLET_SECRET);
export const walletPublic = walletKeypair.publicKey();
export const stellarRpc = new rpc.Server(process.env.RPC_URL);
export const networkPassphrase = process.env.NETWORK_PASSPHRASE || 'Test SDF Future Network ; October 2022';
export const PHP_TOKEN_ADDRESS = process.env.PHP_TOKEN_ADDRESS;
export const PHP_TOKEN_CODE = process.env.PHP_TOKEN_CODE;
export const PHP_TOKEN_ISSUER = process.env.PHP_TOKEN_ISSUER;
export const PHP_DECIMALS = 7;