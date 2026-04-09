import { Buffer } from 'buffer';

/** Solana / Anchor code paths expect Node's Buffer in the browser bundle. */
if (typeof globalThis !== 'undefined' && !(globalThis as unknown as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}
