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
  return 'Sign-in service is temporarily unavailable. Any saved session was cleared locally so you can try again. Check https://status.supabase.com and your Supabase project (paused project or Auth outage). If it persists, contact Supabase support with your project ref.';
}

/** Remove persisted GoTrue keys for this project (`sb-<ref>-*`) without calling `signOut` (avoids lock contention when Auth is failing). */
export function clearSupabaseBrowserAuthStorage(projectRef: string): void {
  if (typeof window === 'undefined') return;
  const prefix = `sb-${projectRef}-`;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  for (const k of keys) window.localStorage.removeItem(k);
}
