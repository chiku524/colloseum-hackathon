import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseEnvPresent } from './supabaseEnv';

let browserClient: SupabaseClient | null = null;

/** Drop the cached browser client so the next `getSupabaseBrowserClient()` builds a new instance (e.g. after clearing local auth storage). */
export function resetSupabaseBrowserClient(): void {
  browserClient = null;
}

export function isSupabaseConfigured(): boolean {
  return isSupabaseEnvPresent();
}

/**
 * Browser Supabase client (anon key + RLS). Returns null if env is missing.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (browserClient) return browserClient;
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
