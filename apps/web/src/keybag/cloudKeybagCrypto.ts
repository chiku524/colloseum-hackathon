import { entropyToMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { Keypair } from '@solana/web3.js';

/** Narrow for Web Crypto `BufferSource` (TS 5.9+ vs DOM lib). */
export function buf(u: Uint8Array): BufferSource {
  return u as BufferSource;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateRecoveryMnemonic(): string {
  const ent = crypto.getRandomValues(new Uint8Array(16));
  return entropyToMnemonic(ent, wordlist);
}

export function normalizeMnemonic(m: string): string {
  return m.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function deriveAesFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', buf(enc.encode(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: 210_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importRawAesKey(raw32: Uint8Array): Promise<CryptoKey> {
  if (raw32.length !== 32) throw new Error('Invalid data key length.');
  return crypto.subtle.importKey('raw', buf(raw32), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function aesGcmEncrypt(key: CryptoKey, iv: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(plain)));
}

async function aesGcmDecrypt(key: CryptoKey, iv: Uint8Array, ct: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(ct)));
}

export type SolanaKeybagCryptoPayload = {
  pubkey: string;
  pwd_salt: string;
  pwd_iv: string;
  pwd_wrap: string;
  rec_salt: string;
  rec_iv: string;
  rec_wrap: string;
  sk_iv: string;
  sk_ciphertext: string;
};

/**
 * Build encrypted keybag: data key wraps secret key; password and recovery mnemonic each wrap the data key.
 */
export async function buildKeybagPayload(
  keypair: Keypair,
  accountPassword: string,
  recoveryMnemonic: string,
): Promise<SolanaKeybagCryptoPayload> {
  const normalized = normalizeMnemonic(recoveryMnemonic);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('Invalid recovery phrase.');
  }

  const dk = crypto.getRandomValues(new Uint8Array(32));
  const skIv = crypto.getRandomValues(new Uint8Array(12));
  const dkKey = await importRawAesKey(dk);
  const skCt = await aesGcmEncrypt(dkKey, skIv, keypair.secretKey);

  const pwdSalt = crypto.getRandomValues(new Uint8Array(16));
  const pwdIv = crypto.getRandomValues(new Uint8Array(12));
  const pwdAes = await deriveAesFromPassword(accountPassword, pwdSalt);
  const pwdWrap = await aesGcmEncrypt(pwdAes, pwdIv, dk);

  const recSalt = crypto.getRandomValues(new Uint8Array(16));
  const recIv = crypto.getRandomValues(new Uint8Array(12));
  const recAes = await deriveAesFromPassword(normalized, recSalt);
  const recWrap = await aesGcmEncrypt(recAes, recIv, dk);

  return {
    pubkey: keypair.publicKey.toBase58(),
    pwd_salt: bytesToB64(pwdSalt),
    pwd_iv: bytesToB64(pwdIv),
    pwd_wrap: bytesToB64(pwdWrap),
    rec_salt: bytesToB64(recSalt),
    rec_iv: bytesToB64(recIv),
    rec_wrap: bytesToB64(recWrap),
    sk_iv: bytesToB64(skIv),
    sk_ciphertext: bytesToB64(skCt),
  };
}

export type SolanaKeybagRow = SolanaKeybagCryptoPayload & { user_id: string };

async function unwrapDkFromPassword(row: SolanaKeybagCryptoPayload, password: string): Promise<Uint8Array> {
  const salt = b64ToBytes(row.pwd_salt);
  const iv = b64ToBytes(row.pwd_iv);
  const wrap = b64ToBytes(row.pwd_wrap);
  const aes = await deriveAesFromPassword(password, salt);
  const dk = await aesGcmDecrypt(aes, iv, wrap);
  if (dk.length !== 32) throw new Error('Bad wallet wrap.');
  return dk;
}

async function unwrapDkFromRecovery(row: SolanaKeybagCryptoPayload, mnemonic: string): Promise<Uint8Array> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('Invalid recovery phrase.');
  }
  const salt = b64ToBytes(row.rec_salt);
  const iv = b64ToBytes(row.rec_iv);
  const wrap = b64ToBytes(row.rec_wrap);
  const aes = await deriveAesFromPassword(normalized, salt);
  const dk = await aesGcmDecrypt(aes, iv, wrap);
  if (dk.length !== 32) throw new Error('Bad recovery wrap.');
  return dk;
}

export async function unlockKeypairFromKeybag(row: SolanaKeybagCryptoPayload, accountPassword: string): Promise<Keypair> {
  let dk: Uint8Array;
  try {
    dk = await unwrapDkFromPassword(row, accountPassword);
  } catch {
    throw new Error('Could not unlock wallet. Wrong password, or you need recovery after a password reset.');
  }
  const dkKey = await importRawAesKey(dk);
  const skIv = b64ToBytes(row.sk_iv);
  const skCt = b64ToBytes(row.sk_ciphertext);
  let sk: Uint8Array;
  try {
    sk = await aesGcmDecrypt(dkKey, skIv, skCt);
  } catch {
    throw new Error('Wallet data is corrupted.');
  }
  if (sk.length !== 64) throw new Error('Invalid secret key length.');
  return Keypair.fromSecretKey(sk);
}

/** After email/password reset: prove recovery phrase, re-wrap data key with the new account password. */
export async function rewrapKeybagPasswordFromRecovery(
  row: SolanaKeybagCryptoPayload,
  recoveryMnemonic: string,
  newAccountPassword: string,
): Promise<Pick<SolanaKeybagCryptoPayload, 'pwd_salt' | 'pwd_iv' | 'pwd_wrap'>> {
  const dk = await unwrapDkFromRecovery(row, recoveryMnemonic);
  const pwdSalt = crypto.getRandomValues(new Uint8Array(16));
  const pwdIv = crypto.getRandomValues(new Uint8Array(12));
  const pwdAes = await deriveAesFromPassword(newAccountPassword, pwdSalt);
  const pwdWrap = await aesGcmEncrypt(pwdAes, pwdIv, dk);
  return {
    pwd_salt: bytesToB64(pwdSalt),
    pwd_iv: bytesToB64(pwdIv),
    pwd_wrap: bytesToB64(pwdWrap),
  };
}
