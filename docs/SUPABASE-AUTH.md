# Supabase email auth and cloud keybags

Stronghold can link each **verified email user** to a **Solana signing key** you custody in the sense that **ciphertext** lives in your Supabase Postgres project. Plaintext keys are produced only in the browser after the user enters their **account password** or **recovery phrase**.

## What you get

- **Email verification** — Supabase sends confirmation links; users must confirm before creating a wallet row.
- **Password reset** — Supabase “forgot password” email. After choosing a new password, the user must enter their **12-word recovery phrase** so the app can **re-wrap** the same data key with the new password (the old password wrap becomes useless).
- **Multi-device** — Sign in on another browser; download the same ciphertext from `solana_keybags` and unlock with the account password.

## CLI quick path (local)

From the repo root (after `vercel login`):

```bash
cd apps/web
vercel link -p colloseum-hackathon --yes --scope YOUR_TEAM_SLUG   # once, if not linked
vercel env pull .env.development.local --yes
npm run dev
```

`apps/web/.env.development.local` is **gitignored**; it should contain `VITE_PUBLIC_SUPABASE_*` (or equivalent) from Vercel.

**Apply `solana_keybags` via terminal** (needs Postgres password from Supabase → **Settings → Database**, not the anon key):

```bash
export SUPABASE_DB_URL='postgresql://postgres:YOUR_DB_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres?sslmode=require'
npm run db:apply:keybags
```

Requires `psql` on your PATH (e.g. [Postgres client](https://www.postgresql.org/download/) or `brew install libpq`). If you skip this, paste `supabase/migrations/001_solana_keybags.sql` into the **Supabase SQL Editor** instead.

**Auth redirect URLs** still have to be set in the Supabase dashboard (**Authentication → URL configuration**). There is no safe one-liner without a personal access token.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → URL configuration**: add your site URL and redirect URLs (e.g. `http://localhost:5173`, production `https://your-domain.com`).
3. **Authentication → Providers → Email**: enable email/password; keep “Confirm email” on for production.
4. Run the SQL in `supabase/migrations/001_solana_keybags.sql` in the **SQL Editor** (or use the Supabase CLI).
5. Copy **Project URL** and **anon (JWT) public** key into Vite env. Either naming works:
  - `VITE_PUBLIC_SUPABASE_URL` + `VITE_PUBLIC_SUPABASE_ANON_KEY` (common when using **Vercel → Storage → Supabase**)
  - `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (manual / docs shorthand)
6. Deploy the web app with those variables on the **same Vercel project** as `apps/web` (or run `vercel env pull` locally for `apps/web`).

**Security:** Never commit Postgres passwords, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SECRET_KEY` to git. The browser only needs **URL + anon key**; RLS protects your tables. If secrets were pasted into chat or a ticket, **rotate** them in Supabase (database password, JWT secret, API keys).

Row-level security on `solana_keybags` ensures each user only reads/writes their own row. **Do not** expose the **service role** key in the browser.

## Cryptography (high level)

- A random **data key** encrypts the 64-byte Solana `secretKey` (AES-GCM).
- The data key is wrapped twice: with a key derived from the **account password** (PBKDF2) and from the **BIP39 mnemonic** (PBKDF2 on the normalized phrase).
- After a Supabase password reset, the user proves the mnemonic and the client uploads new password-wrap fields only.

## Local-only fallback

If both URL and anon key are unset (neither `VITE_PUBLIC_`* nor `VITE_SUPABASE_*`), the Email tab uses the **device-local** vault (`embeddedWalletVault.ts`) with no verification or sync.

## You do not need Next.js or SvelteKit

This repo’s dashboard is **Vite + React** (`apps/web`). Supabase Auth and `solana_keybags` are already wired there. Follow the **UI testing checklist** below instead of adding another framework.

## UI testing checklist

Prerequisites: env vars set — e.g. `cd apps/web && vercel env pull .env.development.local` after linking the Vercel project, or copy `VITE_PUBLIC_SUPABASE_URL` / `VITE_PUBLIC_SUPABASE_ANON_KEY` into `.env.local`. Apply SQL migration `supabase/migrations/001_solana_keybags.sql`. In Supabase **Authentication → URL configuration**, set **Site URL** and **Redirect URLs** to `http://localhost:5173` (and your production URL).

### A. Local-only email (no Supabase)

1. Unset or comment out `VITE_SUPABASE_`*, run `npm run dev` from `apps/web`.
2. Open the app → **Email** → **Register** → create wallet → complete team onboarding.
3. Refresh: unlock again with the same email/password.

### B. Cloud email (Supabase)

1. **Register**: Email tab → Register → use a real inbox you can open → confirm the Supabase email → **Sign in**.
2. **Create wallet**: Save the **12-word phrase** (copy to a scratch file for testing), check the box, enter password (≥10 chars) → **Create wallet & continue** → finish team onboarding.
3. **Multi-device**: Open an incognito window (or another browser), sign in with the same email, enter password → **Unlock** → same pubkey as before (compare in onboarding or header).
4. **Forgot password**: In Supabase dashboard you can use a second test user, or on sign-in click **Email me a reset link** → follow email → land on app → **Finish password reset**: new password + recovery phrase → should unlock the **same** wallet.
5. **Data check**: In Supabase **Table Editor** → `solana_keybags` → one row per user; `pubkey` matches the in-app address.

### C. Extension wallet (unchanged)

**Wallet** tab → connect Phantom/Solflare → onboarding → dashboard. Works alongside cloud email; no Supabase required for that path.