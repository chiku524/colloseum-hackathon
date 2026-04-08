-- Run in Supabase SQL Editor or via `npm run setup:apply-keybags`.
-- Also run `002_solana_keybags_grants.sql` after this (same folder) so the browser client can read/write under RLS.
-- Links each auth user to an encrypted Solana signing key (client-side ciphertext only).

create table if not exists public.solana_keybags (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pubkey text not null,
  pwd_salt text not null,
  pwd_iv text not null,
  pwd_wrap text not null,
  rec_salt text not null,
  rec_iv text not null,
  rec_wrap text not null,
  sk_iv text not null,
  sk_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists solana_keybags_pubkey_idx on public.solana_keybags (pubkey);

alter table public.solana_keybags enable row level security;

drop policy if exists "solana_keybags_select_own" on public.solana_keybags;
create policy "solana_keybags_select_own"
  on public.solana_keybags for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "solana_keybags_insert_own" on public.solana_keybags;
create policy "solana_keybags_insert_own"
  on public.solana_keybags for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "solana_keybags_update_own" on public.solana_keybags;
create policy "solana_keybags_update_own"
  on public.solana_keybags for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
