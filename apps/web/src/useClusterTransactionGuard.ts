import type { Connection } from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CLUSTER_LABELS,
  inferClusterFromGenesisHash,
  readWalletClusterHint,
  type SolanaClusterId,
} from './solanaCluster';
import { inferClusterLabel } from './rpcCluster';

export type ClusterGuardState = {
  rpcGenesisHash: string | null;
  rpcCluster: SolanaClusterId;
  walletCluster: SolanaClusterId | null;
  mismatch: boolean;
  walletClusterUnknown: boolean;
  rpcClusterLabel: string;
  genesisError: string | null;
  guardBeforeSignTransaction: () => Promise<boolean>;
};

/**
 * Compares RPC genesis (authoritative for this app) with wallet-reported cluster when available.
 * `guardBeforeSignTransaction` should run immediately before any on-chain signing path.
 */
export function useClusterTransactionGuard(
  connection: Connection,
  wallet: WalletContextState,
): ClusterGuardState {
  const [rpcGenesisHash, setRpcGenesisHash] = useState<string | null>(null);
  const [genesisError, setGenesisError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void connection
      .getGenesisHash()
      .then((h) => {
        if (!cancelled) {
          setRpcGenesisHash(h);
          setGenesisError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRpcGenesisHash(null);
          setGenesisError('Could not read cluster from your RPC endpoint.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  const rpcCluster = useMemo(() => inferClusterFromGenesisHash(rpcGenesisHash), [rpcGenesisHash]);
  const walletCluster = useMemo(() => readWalletClusterHint(wallet.wallet), [wallet.wallet]);

  const mismatch =
    wallet.connected &&
    rpcCluster !== 'unknown' &&
    walletCluster !== null &&
    walletCluster !== rpcCluster;

  const walletClusterUnknown = wallet.connected && walletCluster === null;

  const rpcClusterLabel =
    rpcCluster !== 'unknown'
      ? CLUSTER_LABELS[rpcCluster]
      : inferClusterLabel(connection.rpcEndpoint);

  const guardBeforeSignTransaction = useCallback(async (): Promise<boolean> => {
    if (!wallet.publicKey) return true;
    if (rpcCluster === 'unknown') return true;

    if (mismatch) {
      return window.confirm(
        `Network check: this app is on ${CLUSTER_LABELS[rpcCluster]} (from your RPC), but your wallet reported ${CLUSTER_LABELS[walletCluster!]}. Transactions may fail or use the wrong network. Continue anyway?`,
      );
    }

    if (walletClusterUnknown) {
      try {
        if (sessionStorage.getItem('ct-cluster-unknown-dismissed') === '1') return true;
      } catch {
        /* ignore */
      }
      const ok = window.confirm(
        `We could not detect which Solana network your wallet is using. This app is on ${CLUSTER_LABELS[rpcCluster]}. If your wallet is on another network, signing will fail. Continue?`,
      );
      if (ok) {
        try {
          sessionStorage.setItem('ct-cluster-unknown-dismissed', '1');
        } catch {
          /* ignore */
        }
      }
      return ok;
    }

    return true;
  }, [wallet.publicKey, rpcCluster, mismatch, walletClusterUnknown, walletCluster]);

  return {
    rpcGenesisHash,
    rpcCluster,
    walletCluster,
    mismatch,
    walletClusterUnknown,
    rpcClusterLabel,
    genesisError,
    guardBeforeSignTransaction,
  };
}
