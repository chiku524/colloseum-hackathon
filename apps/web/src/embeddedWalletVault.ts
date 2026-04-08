import { Keypair } from '@solana/web3.js';

/** Narrow for Web Crypto `BufferSource` (TS 5.9+ `Uint8Array` generic vs DOM lib). */
function buf(u: Uint8Array): BufferSource {
  return u as BufferSource;
}

const STORAGE_KEY = 'stronghold-email-vault-v1';
const ACCOUNT_KIND_KEY = 'stronghold-account-kind';

export const EMBEDDED_ACCOUNT_KIND = 'embedded' as const;

export type VaultRecordV1 = {
  v: 1;
  emailNorm: string;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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

export function hasEmbeddedVault(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function readVaultRecord(): VaultRecordV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as VaultRecordV1;
    if (o.v !== 1 || !o.emailNorm || !o.saltB64 || !o.ivB64 || !o.ciphertextB64) return null;
    return o;
  } catch {
    return null;
  }
}

export function clearEmbeddedVault(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(ACCOUNT_KIND_KEY);
  } catch {
    /* ignore */
  }
}

export function setAccountKindEmbedded(): void {
  try {
    window.localStorage.setItem(ACCOUNT_KIND_KEY, EMBEDDED_ACCOUNT_KIND);
  } catch {
    /* ignore */
  }
}

export async function createVault(email: string, password: string): Promise<Keypair> {
  const keypair = Keypair.generate();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await deriveKey(password, salt);
  const secret = keypair.secretKey;
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, aes, buf(secret)),
  );
  const rec: VaultRecordV1 = {
    v: 1,
    emailNorm: normalizeEmail(email),
    saltB64: bytesToB64(salt),
    ivB64: bytesToB64(iv),
    ciphertextB64: bytesToB64(ciphertext),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  setAccountKindEmbedded();
  return keypair;
}

export async function unlockVault(email: string, password: string): Promise<Keypair> {
  const rec = readVaultRecord();
  if (!rec) throw new Error('No email wallet found on this device. Register first.');

  const emailNorm = normalizeEmail(email);
  if (emailNorm !== rec.emailNorm) {
    throw new Error('That email does not match this device’s saved wallet.');
  }

  const salt = b64ToBytes(rec.saltB64);
  const iv = b64ToBytes(rec.ivB64);
  const ciphertext = b64ToBytes(rec.ciphertextB64);
  const aes = await deriveKey(password, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(iv) }, aes, buf(ciphertext));
  } catch {
    throw new Error('Incorrect password.');
  }
  const sk = new Uint8Array(plain);
  if (sk.length !== 64) throw new Error('Invalid wallet data.');
  return Keypair.fromSecretKey(sk);
}

export function validateNewPassword(password: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters for your password.';
  return null;
}
