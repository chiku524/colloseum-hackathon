export function hex32(u: Uint8Array): string {
  return [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
}
