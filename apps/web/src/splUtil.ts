import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import type { Connection } from '@solana/web3.js';
import { PublicKey, Transaction } from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';

/** Ensures the wallet has an ATA for `mint`; creates it with a signed tx if missing. */
export async function ensureWalletAta(
  connection: Connection,
  wallet: WalletContextState,
  mint: PublicKey,
): Promise<PublicKey> {
  const owner = wallet.publicKey;
  if (!owner || !wallet.sendTransaction) throw new Error('Connect a wallet that can send transactions.');
  const ata = getAssociatedTokenAddressSync(mint, owner, false);
  const info = await connection.getAccountInfo(ata);
  if (info) return ata;
  const ix = createAssociatedTokenAccountInstruction(
    owner,
    ata,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const tx = new Transaction().add(ix);
  const sig = await wallet.sendTransaction(tx, connection);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
  return ata;
}

export function recipientAtaForMint(recipient: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, recipient, false);
}
