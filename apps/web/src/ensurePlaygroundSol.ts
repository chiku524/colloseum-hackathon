import type { Connection, PublicKey } from '@solana/web3.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import type { SolanaClusterId } from './solanaCluster';

/** Enough for several small txs plus rent; airdrop if below this on devnet/testnet only. */
const MIN_LAMPORTS = Math.floor(0.02 * LAMPORTS_PER_SOL);

const AIRDROP_LAMPORTS = LAMPORTS_PER_SOL;

/**
 * Ensures `owner` has SOL on devnet/testnet (e.g. email wallets that never received a faucet drip).
 * No-op on mainnet, localnet, or unknown cluster.
 */
export async function ensurePlaygroundSol(
  connection: Connection,
  owner: PublicKey,
  rpcCluster: SolanaClusterId,
): Promise<void> {
  if (rpcCluster !== 'devnet' && rpcCluster !== 'testnet') return;

  const bal = await connection.getBalance(owner);
  if (bal >= MIN_LAMPORTS) return;

  let sig: string;
  try {
    sig = await connection.requestAirdrop(owner, AIRDROP_LAMPORTS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not request devnet/testnet SOL automatically (${msg}). ` +
        'Fund this wallet with the official faucet: https://faucet.solana.com — choose Devnet or Testnet to match this app.',
    );
  }

  const latest = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');

  const bal2 = await connection.getBalance(owner);
  if (bal2 < MIN_LAMPORTS) {
    throw new Error(
      'Your wallet still has very little SOL on this network after the airdrop. Try again in a minute or use https://faucet.solana.com.',
    );
  }
}
