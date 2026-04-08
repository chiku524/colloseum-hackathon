import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseEnvPresent } from './supabaseEnv';

let browserClient: SupabaseClient | null = null;

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
