import {
  BaseSignerWalletAdapter,
  isVersionedTransaction,
  type SupportedTransactionVersions,
  WalletConnectionError,
  WalletName,
  WalletNotConnectedError,
  WalletReadyState,
  WalletSignTransactionError,
} from '@solana/wallet-adapter-base';
import { Keypair, PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js';

export const STRONGHOLD_EMBEDDED_WALLET_NAME = 'Stronghold (email wallet)' as WalletName<'Stronghold (email wallet)'>;

const STRONGHOLD_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="%23151c24"/><path fill="%233d8bd4" d="M8 14h16v4H8z"/><path fill="%235ecf9a" d="M14 8h4v16h-4z"/></svg>`,
  );

/**
 * In-browser keypair for users who sign up with email + password.
 * The secret is never sent to a server; unlock is handled by {@link ../embeddedWalletVault.ts}.
 */
export class StrongholdEmbeddedWalletAdapter extends BaseSignerWalletAdapter<typeof STRONGHOLD_EMBEDDED_WALLET_NAME> {
  name = STRONGHOLD_EMBEDDED_WALLET_NAME;
  url = 'https://solana.com';
  icon = STRONGHOLD_ICON;
  readonly readyState = WalletReadyState.Loadable;
  supportedTransactionVersions = new Set(['legacy', 0] as const) as SupportedTransactionVersions;

  connecting = false;
  private _keypair: Keypair | null = null;
  publicKey: PublicKey | null = null;

  /** Call after decrypting the vault, before `connect()`. */
  setUnlockedKeypair(keypair: Keypair | null): void {
    this._keypair = keypair;
    if (keypair) {
      this.publicKey = keypair.publicKey;
    } else {
      this.publicKey = null;
    }
  }

  get keypair(): Keypair | null {
    return this._keypair;
  }

  async connect(): Promise<void> {
    if (!this._keypair) {
      throw new WalletConnectionError('Unlock your email wallet with your password first.');
    }
    this.publicKey = this._keypair.publicKey;
    this.emit('connect', this.publicKey);
  }

  async disconnect(): Promise<void> {
    this._keypair = null;
    this.publicKey = null;
    this.emit('disconnect');
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    try {
      const kp = this._keypair;
      if (!kp) throw new WalletNotConnectedError();

      if (isVersionedTransaction(transaction)) {
        transaction.sign([kp]);
      } else {
        transaction.partialSign(kp);
      }
      return transaction;
    } catch (e) {
      throw new WalletSignTransactionError(e instanceof Error ? e.message : String(e), e);
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    return Promise.all(transactions.map((t) => this.signTransaction(t)));
  }

  override async autoConnect(): Promise<void> {
    if (this._keypair) await this.connect();
  }
}
