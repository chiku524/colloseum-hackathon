import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && anon);
}

/**
 * Browser Supabase client (anon key + RLS). Returns null if env is missing.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (browserClient) return browserClient;
  const url = import.meta.env.VITE_SUPABASE_URL!.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY!.trim();
  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
