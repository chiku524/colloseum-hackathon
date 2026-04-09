/** True when Auth / GoTrue is likely down or overloaded (refresh storms, slow loads). */
export function isAuthServiceUnavailableError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'object' && 'status' in err) {
    const s = (err as { status?: number }).status;
    if (s === 502 || s === 503 || s === 504) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /503|502|504|service unavailable|authretryablefetcherror|failed to fetch|networkerror/i.test(msg);
}

/** User-facing copy when Supabase Auth HTTP layer fails. */
export function authServiceUnavailableMessage(): string {
  return 'Sign-in service is temporarily unavailable. Your saved session was cleared so you can try again. Check https://status.supabase.com — if it persists, contact Supabase support with your project ref.';
}
