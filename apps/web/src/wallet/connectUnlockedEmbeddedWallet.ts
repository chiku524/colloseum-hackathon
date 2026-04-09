import type { WalletName } from '@solana/wallet-adapter-base';
import { WalletNotSelectedError } from '@solana/wallet-adapter-react';
import type { Keypair } from '@solana/web3.js';
import { flushSync } from 'react-dom';
import {
  STRONGHOLD_EMBEDDED_WALLET_NAME,
  type StrongholdEmbeddedWalletAdapter,
} from '../StrongholdEmbeddedWalletAdapter';

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Connect the in-app email wallet after unlocking its keypair.
 *
 * Ordering constraints (wallet-adapter-react):
 * - `disconnect()` can schedule `setWalletName(null)`; wait a macrotask before `select`.
 * - `select()` only updates React state; `flushSync` commits `walletName` so `adapter` is embedded.
 * - `WalletProviderBase` attaches `adapter` listeners in `useEffect` (after paint); `connect()` must run
 *   after that or `handleConnect` still sees `wallet === null` → WalletNotSelectedError.
 */
export async function connectUnlockedEmbeddedWallet(opts: {
  disconnect: () => Promise<void>;
  select: (walletName: WalletName) => void;
  connect: () => Promise<void>;
  embeddedAdapter: StrongholdEmbeddedWalletAdapter;
  keypair: Keypair;
}): Promise<void> {
  try {
    await opts.disconnect();
  } catch {
    /* noop */
  }

  opts.embeddedAdapter.setUnlockedKeypair(opts.keypair);

  await delayMs(0);

  flushSync(() => {
    opts.select(STRONGHOLD_EMBEDDED_WALLET_NAME);
  });

  // After paint: WalletProviderBase subscribes to the new adapter in useEffect.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

  try {
    await opts.connect();
  } catch (e) {
    if (e instanceof WalletNotSelectedError) {
      await delayMs(32);
      await opts.connect();
      return;
    }
    throw e;
  }
}
