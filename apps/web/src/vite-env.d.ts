/// <reference types="vite/client" />

declare module '@idl' {
  const idl: { address: string; [key: string]: unknown };
  export default idl;
}

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_PROGRAM_ID?: string;
  /** Optional origin for serverless API (e.g. cross-domain). Default: same origin. */
  readonly VITE_API_BASE_URL?: string;
  /** Supabase project URL (enables cloud email auth + synced encrypted keybags). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon (public) key — RLS must protect `solana_keybags`. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
