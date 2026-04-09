# Self-hosted Supabase + Mailpit

Use this when you run the [official Supabase Docker stack](https://supabase.com/docs/guides/self-hosting/docker) and want **verification and reset emails** to land in a **local inbox** (no SendGrid/Resend). Mailpit is open source and runs on your hardware.

## 1. Bootstrap upstream Docker (once)

Follow Supabase docs: copy `supabase/docker/*` into a directory you own (e.g. `supabase-project/`), create `.env` from `.env.example`, generate secrets, **do not** use demo passwords in production.

## 2. Add Mailpit to the same Compose project

**Option A — reference this repo by path**

```bash
cd /path/to/your/supabase-project

docker compose \
  -f docker-compose.yml \
  -f /path/to/web3stronghold/supabase/docker-compose.self-host-mailpit.yml \
  up -d
```

**Option B — copy the overlay into your project**

```bash
cp /path/to/web3stronghold/supabase/docker-compose.self-host-mailpit.yml ./
docker compose -f docker-compose.yml -f docker-compose.self-host-mailpit.yml up -d
```

**Option C — `include` (Docker Compose v2.20+)**

Add to a `docker-compose.override.yml` next to the upstream file:

```yaml
include:
  - path: /path/to/web3stronghold/supabase/docker-compose.self-host-mailpit.yml
```

Then `docker compose up -d` picks up Mailpit automatically.

The overlay only defines the `mailpit` service. It attaches to the **default** Compose network, so **`auth` can resolve the hostname `mailpit`**.

## 3. Point GoTrue (Auth) at Mailpit

In your self-hosted `.env`, replace the default mail block with values from **`../self-hosted-smtp.env.example`** (repo root `supabase/self-hosted-smtp.env.example`). Minimally:

```env
MAILPIT_HTTP_PORT=8025
MAILPIT_SMTP_PORT=1025

SMTP_ADMIN_EMAIL=noreply@web3stronghold.local
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_SENDER_NAME=web3stronghold
```

Upstream `.env.example` may set `SMTP_HOST=supabase-mail` — **change it to `mailpit`** when using this overlay.

Then restart Auth so it picks up env:

```bash
docker compose -f docker-compose.yml -f docker-compose.self-host-mailpit.yml restart auth
```

Open **http://localhost:8025** (or your `MAILPIT_HTTP_PORT`) to read confirmation and password-reset messages.

## 4. Apply web3stronghold database migrations

Self-hosted Postgres does not include this app’s tables. In **Studio → SQL** or `psql`, run in order:

1. `supabase/migrations/001_solana_keybags.sql`
2. `supabase/migrations/002_solana_keybags_grants.sql`

(Paths are relative to the **web3stronghold** git repo.)

## 5. Point the Vite app at self-hosted API

Set `VITE_PUBLIC_SUPABASE_URL` to your Kong URL (e.g. `http://localhost:8000`) and `VITE_PUBLIC_SUPABASE_ANON_KEY` to the `ANON_KEY` from `.env`. Add your app origin to `SITE_URL` / `ADDITIONAL_REDIRECT_URLS` in `.env`.

## Security notes

- Mailpit’s SMTP port has **no authentication** — bind it to **localhost** only (default here) or a private network. Do not expose `1025` on the public internet.
- For **real** delivery to user mailboxes you still need a proper MTA or transactional provider; Mailpit is for **dev and internal QA**.

## Standalone Mailpit only

To run Mailpit without the full Supabase stack (e.g. testing SMTP from your laptop):

```bash
npm run supabase:mailpit
```

Uses `supabase/mailpit-compose.yml` at the repo root.
