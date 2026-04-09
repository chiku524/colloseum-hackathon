import type { WalletName } from '@solana/wallet-adapter-base';
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
 * Do **not** use WalletProvider `connect()`: it throws WalletNotSelectedError when
 * `wallets.find((w) => w.adapter === adapter)` is null (reference / timing mismatch),
 * even though `adapter` is already the embedded instance. Subscribing to `connect`
 * events is keyed off `adapter` in useEffect, so calling `embeddedAdapter.connect()`
 * directly updates React `connected` state correctly.
 */
export async function connectUnlockedEmbeddedWallet(opts: {
  disconnect: () => Promise<void>;
  select: (walletName: WalletName) => void;
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

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

  await opts.embeddedAdapter.connect();
}
