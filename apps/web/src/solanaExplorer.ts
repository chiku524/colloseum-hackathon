import type { SolanaClusterId } from './solanaCluster';

/** Solscan transaction URL for known clusters; generic Solana Explorer otherwise. */
export function explorerTxUrl(signature: string, cluster: SolanaClusterId): string {
  const enc = encodeURIComponent(signature);
  if (cluster === 'mainnet') {
    return `https://solscan.io/tx/${enc}`;
  }
  if (cluster === 'devnet') {
    return `https://solscan.io/tx/${enc}?cluster=devnet`;
  }
  if (cluster === 'testnet') {
    return `https://solscan.io/tx/${enc}?cluster=testnet`;
  }
  return `https://explorer.solana.com/tx/${enc}`;
}
