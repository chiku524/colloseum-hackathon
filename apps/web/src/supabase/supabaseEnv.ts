/**
 * Resolve Supabase browser env from either naming style:
 * - Vercel Supabase integration: `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY`
 * - Docs / manual: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
 */
export function getSupabaseUrl(): string {
  const v =
    import.meta.env.VITE_PUBLIC_SUPABASE_URL?.trim() ||
    import.meta.env.VITE_SUPABASE_URL?.trim() ||
    '';
  return v;
}

export function getSupabaseAnonKey(): string {
  const v =
    import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    '';
  return v;
}

export function isSupabaseEnvPresent(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}
