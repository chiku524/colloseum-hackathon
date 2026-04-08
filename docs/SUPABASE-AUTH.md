# Supabase email auth and cloud keybags

Stronghold can link each **verified email user** to a **Solana signing key** you custody in the sense that **ciphertext** lives in your Supabase Postgres project. Plaintext keys are produced only in the browser after the user enters their **account password** or **recovery phrase**.

## What you get

- **Email verification** — Supabase sends confirmation links; users must confirm before creating a wallet row.
- **Password reset** — Supabase “forgot password” email. After choosing a new password, the user must enter their **12-word recovery phrase** so the app can **re-wrap** the same data key with the new password (the old password wrap becomes useless).
- **Multi-device** — Sign in on another browser; download the same ciphertext from `solana_keybags` and unlock with the account password.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → URL configuration**: add your site URL and redirect URLs (e.g. `http://localhost:5173`, production `https://your-domain.com`).
3. **Authentication → Providers → Email**: enable email/password; keep “Confirm email” on for production.
4. Run the SQL in `supabase/migrations/001_solana_keybags.sql` in the **SQL Editor** (or use the Supabase CLI).
5. Copy **Project URL** and **anon public** key into Vite env:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Deploy the web app with those variables (e.g. Vercel project env for `apps/web`).

Row-level security on `solana_keybags` ensures each user only reads/writes their own row. **Do not** expose the **service role** key in the browser.

## Cryptography (high level)

- A random **data key** encrypts the 64-byte Solana `secretKey` (AES-GCM).
- The data key is wrapped twice: with a key derived from the **account password** (PBKDF2) and from the **BIP39 mnemonic** (PBKDF2 on the normalized phrase).
- After a Supabase password reset, the user proves the mnemonic and the client uploads new password-wrap fields only.

## Local-only fallback

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset, the Email tab uses the previous **device-local** vault (`embeddedWalletVault.ts`) with no verification or sync.

## UI testing checklist

Prerequisites: env vars set (see `apps/web/.env.example`), SQL migration applied, Supabase **Site URL** = `http://localhost:5173` (or your dev URL) and the same value under **Redirect URLs**.

### A. Local-only email (no Supabase)

1. Unset or comment out `VITE_SUPABASE_*`, run `npm run dev` from `apps/web`.
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
