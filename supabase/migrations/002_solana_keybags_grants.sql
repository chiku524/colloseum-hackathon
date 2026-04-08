-- PostgREST / Supabase JS client: the authenticated role must have table privileges (RLS still enforces rows).
-- anon must not read or write ciphertext. Safe to re-run.

revoke all on table public.solana_keybags from anon;
grant select, insert, update on table public.solana_keybags to authenticated;
