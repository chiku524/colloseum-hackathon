# Supabase email auth and cloud keybags

**web3stronghold** can link each **verified email user** to a **Solana signing key** you custody in the sense that **ciphertext** lives in your Supabase Postgres project. Plaintext keys are produced only in the browser after the user enters their **account password** or **recovery phrase**.

## What you get

- **Email verification** — Supabase sends confirmation links; users must confirm before creating a wallet row.
- **Password reset** — Supabase “forgot password” email. After choosing a new password, the user must enter their **12-word recovery phrase** so the app can **re-wrap** the same data key with the new password (the old password wrap becomes useless).
- **Multi-device** — Sign in on another browser; download the same ciphertext from `solana_keybags` and unlock with the account password.

## CLI quick path (local)

From the repo root (after `vercel login`):

```bash
cd apps/web
vercel link -p web3stronghold --yes --scope YOUR_TEAM_SLUG   # once, if not linked
vercel env pull .env.development.local --yes
npm run dev
```

`apps/web/.env.development.local` is **gitignored**; it should contain `VITE_PUBLIC_SUPABASE_*` (or equivalent) from Vercel.

### Setup scripts (repo root)


| Command                               | What it does                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run setup:check`                 | Verifies pulled Vite env + whether a DB URL is available (does not print secrets).                                                                                                                                                                                                                          |
| `npm run setup:post-keybags`          | After migration succeeds: runs **`setup:check`**, then prints the **next steps** checklist (local Auth URLs, `npm run dev`, Table Editor, optional CLI).                                                                                                                                                    |
| `npm run setup:apply-keybags`         | Runs `001_solana_keybags.sql` then `002_solana_keybags_grants.sql` via **Node + `pg`** (works on Windows). `002` grants `authenticated` access and revokes `anon` on the table (fixes common “permission denied” from the Data API). Uses `POSTGRES_URL*` from Vercel pull, or `SUPABASE_DB_URL` / `DATABASE_URL`, or `.env.supabase.local`. Prefer **direct** Postgres (port **5432**); poolers can fail on DDL. |
| `npm run db:apply:keybags`            | Same **001 + 002** migrations using `**psql`** + `SUPABASE_DB_URL` (bash / Mac / Linux with client tools).                                                                                                                                                                                                      |
| `npm run setup:supabase-open`         | Opens the dashboard **SQL** and **Auth URL** pages for your project (needs URL in env for project ref).                                                                                                                                                                                                     |
| `npm run setup:supabase-open -- sql`  | SQL editor only.                                                                                                                                                                                                                                                                                            |
| `npm run setup:supabase-open -- auth` | Auth URL configuration only.                                                                                                                                                                                                                                                                                |
| `npm run setup:supabase-auth-urls`    | **PATCH**es `site_url` + `uri_allow_list` via [Supabase Management API](https://supabase.com/docs/reference/api/introduction). Needs `SUPABASE_ACCESS_TOKEN` ([account tokens](https://supabase.com/dashboard/account/tokens)). Optional: `SUPABASE_SITE_URL`, `SUPABASE_URI_ALLOW_LIST` (comma-separated). |
| `npm run setup:supabase-smtp-resend` | **PATCH**es Auth **SMTP** for **Resend** (`smtp.resend.com`, sender env). Needs `SUPABASE_ACCESS_TOKEN` + `RESEND_API_KEY`. See `docs/SUPABASE-CUSTOM-SMTP.md`. |
| `npm run setup:supabase:auth-bash`    | Same auth URL update via **bash** — prompts for the personal access token with `read -s` (Git Bash / macOS / Linux). |
| `npm run setup:supabase:keybags-bash` | **bash** prompts for the **Postgres password**, then applies the migration on `db.<ref>.supabase.co:5432` via **`psql`** (Unix / WSL) or **`node` + `pg`** on **Git Bash / MSYS** (avoids MSYS DNS failures). |
| `npm run supabase:mailpit` | Starts **standalone** Mailpit (`supabase/mailpit-compose.yml`) on **8025** / **1025**. For the **official** Docker stack, merge `supabase/docker-compose.self-host-mailpit.yml` — see `supabase/self-host/README.md`. |
| `npm run setup:install-psql` | **Windows only** — runs `scripts/install-postgresql-client.ps1` (needs **PowerShell as Administrator** + [Chocolatey](https://chocolatey.org/install)). Installs the `psql` client globally via `choco install psql`. |

Optional secrets file (gitignored): copy `.env.supabase.example` → `.env.supabase.local` for `SUPABASE_DB_URL` and/or `SUPABASE_ACCESS_TOKEN`. **`setup:supabase:keybags-bash` loads `SUPABASE_ACCESS_TOKEN` from that file into the shell** so Node sees it (pasting only the DB password is not enough on IPv4-only Windows).

If you skip automation, paste `supabase/migrations/001_solana_keybags.sql` then `002_solana_keybags_grants.sql` into the **Supabase SQL Editor** (in that order) and set **Authentication → URL configuration** manually.

### After the keybags migration succeeds

Run **`npm run setup:post-keybags`** — it executes **`setup:check`** and prints this checklist:

1. **Auth URLs for local dev** — If **Site URL** / **Redirect URLs** only list production, add **`http://localhost:5173`** (or run `npm run setup:supabase:auth-bash` and set Site URL to localhost while testing). Email confirmation links must match an allowed redirect.
2. **Run the web app** — `cd apps/web && npm run dev` → open **http://localhost:5173** → **Email** tab → register → confirm inbox → complete cloud wallet onboarding (see **UI testing checklist** below).
3. **Confirm in Supabase** — **Table Editor → `solana_keybags`** (rows appear after users complete cloud signup).
4. **Optional: Supabase CLI** — `supabase login` → `supabase init` → `supabase link --project-ref YOUR_REF` for remote DB workflows ([CLI install](https://github.com/supabase/cli#install-the-cli); Windows: Scoop or release binary under `%USERPROFILE%\.local\bin`).
5. **Production** — Vercel project env must include **`VITE_PUBLIC_SUPABASE_URL`** and **`VITE_PUBLIC_SUPABASE_ANON_KEY`**; redeploy after changes.

### Troubleshooting

- `**self-signed certificate in certificate chain`** when running `setup:apply-keybags` — fixed in current scripts by relaxing TLS verification for `*.supabase.co` hosts. Re-run `npm run setup:apply-keybags`. If migration still fails on **port 6543** (pooler), set `SUPABASE_DB_URL` in `.env.supabase.local` to the **direct** URI (port **5432**) from Supabase → Settings → Database.
- `**401` / `JWT could not be decoded`** for `setup:supabase-auth-urls` — you used a **project API key** (`eyJ...`). Create a **personal access token** at [Account → Access tokens](https://supabase.com/dashboard/account/tokens) and set `SUPABASE_ACCESS_TOKEN` to that value only.
- **`psql` not found** (bash keybags script) — On Windows, install client tools globally: open **PowerShell as Administrator**, `cd` to the repo, run `npm run setup:install-psql` (Chocolatey `psql` package). Or use `npm run setup:apply-keybags`, which does not need `psql`. On macOS: `brew install libpq` and `brew link --force libpq`. On Debian/Ubuntu: `sudo apt install postgresql-client`.
- **`could not translate host name "db....supabase.co"`** (Git Bash on Windows) — MSYS DNS often fails for Supabase even when the hostname is valid. Re-run `npm run setup:supabase:keybags-bash`: the script uses **Node + `pg`** on Git Bash / MSYS / Cygwin.
- **`getaddrinfo ENOTFOUND` / `ENETUNREACH` for `db.*.supabase.co` on Windows** — Direct DB hostnames are often **IPv6-only**. IPv4-only Windows cannot use them. **Fix:** (1) Set **`SUPABASE_ACCESS_TOKEN`** in **`.env.supabase.local`** (recommended) or paste when prompted; the script logs **`Management API pooler: …`** if the pooler endpoint could not build a URI (wrong token scope, empty JSON, etc.). It uses **`GET .../config/database/pooler`** and, if needed, builds **`postgres.<ref>` @ `db_host:5432`** from the API. Guessed **`aws-0-*` / `aws-1-*`** hostnames are fallbacks only. Fine-grained tokens need **`database_pooling_config_read`**. (2) Or set **`SUPABASE_DB_URL`** to the exact **Session mode** URI from **Supabase → Connect**. (3) Or run the SQL in **Supabase → SQL Editor**. (4) **`Tenant or user not found`** — wrong pooler host. **`password authentication failed for user "postgres"`** — the API template often uses user `postgres`; the script rewrites to **`postgres.<project_ref>`** for `*.pooler.supabase.com`. If it still fails, the **database password** is wrong (Settings → Database), not the PAT.
- **`self-signed certificate in certificate chain`** on **`setup:apply-keybags`** — Often from a pooled/direct URL whose host still matches Supabase; the script retries with relaxed TLS or widens host matching. If it persists, paste the **Session** URI from the dashboard into **`SUPABASE_DB_URL`**.
- **`permission denied for table solana_keybags`** (or insert/select fails after sign-in) — Run `002_solana_keybags_grants.sql` in the SQL Editor, or re-run `npm run setup:apply-keybags` so the `authenticated` role has `SELECT`/`INSERT`/`UPDATE` on the table.
- **`duplicate key value violates unique constraint "solana_keybags_pkey"`** — A row for this user already exists (e.g. wallet creation succeeded once and the UI retried). The app should send you to **unlock**; if you still see the error, refresh after sign-in or check **Table Editor → `solana_keybags`** for your user.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → URL configuration**: add your site URL and redirect URLs (e.g. `http://localhost:5173`, production `https://your-domain.com`).
3. **Authentication → Providers → Email**: enable email/password; keep “Confirm email” on for production.
4. Run the SQL in `supabase/migrations/001_solana_keybags.sql` and `002_solana_keybags_grants.sql` in the **SQL Editor**, in order (or use `npm run setup:apply-keybags` / Supabase CLI).
5. Copy **Project URL** and **anon (JWT) public** key into Vite env. Either naming works:
  - `VITE_PUBLIC_SUPABASE_URL` + `VITE_PUBLIC_SUPABASE_ANON_KEY` (common when using **Vercel → Storage → Supabase**)
  - `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (manual / docs shorthand)
6. Deploy the web app with those variables on the **same Vercel project** as `apps/web` (or run `vercel env pull` locally for `apps/web`).

### Branded auth emails (sender name and copy)

**Hosted Supabase (typical for this app):** Auth email **already works** without Docker or Mailpit. Supabase’s servers send verification and reset messages whenever your project is active (you are not running email infrastructure 24/7 yourself).

To use **your domain** and a friendly **From** name (e.g. **web3stronghold**), add **Custom SMTP**. **Recommended:** **Resend** + Supabase (no app code changes) — full checklist **`docs/SUPABASE-CUSTOM-SMTP.md`** (includes **Vercel / domain / aliases** notes). Supabase UI: enable SMTP under **Authentication → Email** (wording varies). Official: [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

**Templates** — **Authentication → Email Templates** — edit subjects and bodies for **Confirm signup**, **Magic link**, **Reset password**, etc.

Without custom SMTP, the display name is largely controlled by Supabase’s infrastructure.

### Self-hosted email (Docker / Mailpit — optional)

For **local CLI** (`supabase start`), Auth uses the built-in mail catcher; this repo adds **branded HTML templates** and dev-friendly URLs in `supabase/config.toml`. For **self-hosted Docker** Supabase, merge **`supabase/docker-compose.self-host-mailpit.yml`** with the official stack and set **`SMTP_*`** in `.env` — walkthrough **`supabase/self-host/README.md`**, overview **`docs/SUPABASE-SELF-HOSTED-EMAIL.md`**.

**Security:** Never commit Postgres passwords, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SECRET_KEY` to git. The browser only needs **URL + anon key**; RLS protects your tables. If secrets were pasted into chat or a ticket, **rotate** them in Supabase (database password, JWT secret, API keys).

Row-level security on `solana_keybags` ensures each user only reads/writes their own row. **Do not** expose the **service role** key in the browser.

## Cryptography (high level)

- A random **data key** encrypts the 64-byte Solana `secretKey` (AES-GCM).
- The data key is wrapped twice: with a key derived from the **account password** (PBKDF2) and from the **BIP39 mnemonic** (PBKDF2 on the normalized phrase).
- After a Supabase password reset, the user proves the mnemonic and the client uploads new password-wrap fields only.

## Local-only fallback

If both URL and anon key are unset (neither `VITE_PUBLIC_`* nor `VITE_SUPABASE_`*), the Email tab uses the **device-local** vault (`embeddedWalletVault.ts`) with no verification or sync.

## You do not need Next.js or SvelteKit

This repo’s **web3stronghold** dashboard is **Vite + React** (`apps/web`). Supabase Auth and `solana_keybags` are already wired there. Follow the **UI testing checklist** below instead of adding another framework.

## UI testing checklist

Prerequisites: env vars set — e.g. `cd apps/web && vercel env pull .env.development.local` after linking the Vercel project, or copy `VITE_PUBLIC_SUPABASE_URL` / `VITE_PUBLIC_SUPABASE_ANON_KEY` into `.env.local`. Apply SQL migrations `001_solana_keybags.sql` and `002_solana_keybags_grants.sql`. In Supabase **Authentication → URL configuration**, set **Site URL** and **Redirect URLs** to `http://localhost:5173` (and your production URL).

### A. Local-only email (no Supabase)

1. Unset or comment out `VITE_SUPABASE_`*, run `npm run dev` from `apps/web`.
2. Open the app → **Email** → **Register** → create wallet → complete team onboarding.
3. Refresh: unlock again with the same email/password.

### B. Cloud email (Supabase)

1. **Register**: Email tab → Register → use a real inbox you can open → confirm the Supabase email → **Sign in**.
2. **Create wallet**: Save the **12-word phrase** (copy to a scratch file for testing), check the box, enter password (≥8 chars) → **Create wallet & continue** → finish team onboarding.
3. **Multi-device**: Open an incognito window (or another browser), sign in with the same email, enter password → **Unlock** → same pubkey as before (compare in onboarding or header).
4. **Forgot password**: In Supabase dashboard you can use a second test user, or on sign-in click **Email me a reset link** → follow email → land on app → **Finish password reset**: new password + recovery phrase → should unlock the **same** wallet.
5. **Data check**: In Supabase **Table Editor** → `solana_keybags` → one row per user; `pubkey` matches the in-app address.

### C. Extension wallet (unchanged)

**Wallet** tab → connect Phantom/Solflare → onboarding → dashboard. Works alongside cloud email; no Supabase required for that path.