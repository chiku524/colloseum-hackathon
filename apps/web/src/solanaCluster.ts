import type { WalletContextState } from '@solana/wallet-adapter-react';

/** Logical Solana cluster for comparing wallet vs RPC. */
export type SolanaClusterId = 'mainnet' | 'devnet' | 'testnet' | 'local' | 'unknown';

/** Known `getGenesisHash` results for public clusters (base58). */
const GENESIS_TO_CLUSTER: Record<string, SolanaClusterId> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet',
  'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG': 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
};

export const CLUSTER_LABELS: Record<SolanaClusterId, string> = {
  mainnet: 'Mainnet-beta',
  devnet: 'Devnet',
  testnet: 'Testnet',
  local: 'Local validator',
  unknown: 'Custom / unknown',
};

export function inferClusterFromGenesisHash(hash: string | null | undefined): SolanaClusterId {
  if (!hash) return 'unknown';
  return GENESIS_TO_CLUSTER[hash] ?? 'unknown';
}

function clusterFromString(s: string): SolanaClusterId | null {
  const t = s.toLowerCase();
  if (t.includes('mainnet')) return 'mainnet';
  if (t.includes('devnet')) return 'devnet';
  if (t.includes('testnet')) return 'testnet';
  if (t.includes('local')) return 'local';
  return null;
}

/**
 * Best-effort cluster reported by the wallet (injected provider or Wallet Standard metadata).
 * Returns null when the adapter does not expose a cluster (common for older injected APIs).
 */
export function readWalletClusterHint(wallet: WalletContextState['wallet']): SolanaClusterId | null {
  if (!wallet?.adapter) return null;
  const adapter = wallet.adapter as unknown as Record<string, unknown>;

  const stdWallet = adapter.standardWallet as
    | { accounts?: ReadonlyArray<{ chains?: readonly string[] }> }
    | undefined;
  const chains = stdWallet?.accounts?.[0]?.chains;
  if (chains?.length) {
    for (const c of chains) {
      const hit = clusterFromString(c);
      if (hit) return hit;
    }
  }

  if (typeof window === 'undefined') return null;

  const w = (
    window as unknown as {
      phantom?: { solana?: Record<string, unknown> };
      solana?: Record<string, unknown>;
    }
  ).phantom?.solana ?? (window as unknown as { solana?: Record<string, unknown> }).solana;

  if (!w || typeof w !== 'object') return null;

  const chainLike = w.chain ?? w.network ?? w.cluster;
  if (typeof chainLike === 'string') {
    return clusterFromString(chainLike);
  }
  if (chainLike && typeof chainLike === 'object') {
    const id = (chainLike as { id?: string }).id;
    if (typeof id === 'string') return clusterFromString(id);
  }

  return null;
}
