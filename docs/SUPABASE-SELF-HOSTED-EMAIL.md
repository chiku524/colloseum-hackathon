# Self-hosted email for Supabase Auth

This repo supports **no third-party email API** for development and for **self-hosted** Supabase: you run an open-source **SMTP sink** (Mailpit) or the stack that ships with the Supabase CLI. Messages are not sent to the public internet unless you add a real MTA later.

## 1. Supabase CLI local dev (`supabase start`) — built-in mail catcher

The CLI starts an email testing service (Inbucket or Mailpit, depending on CLI version). Auth delivers mail to it; nothing leaves your machine.

1. From the repo root: `npx supabase start` (Docker required).
2. Open the **mail UI** (typical ports — check `npx supabase status`):
   - Web UI: `http://127.0.0.1:54324` (often listed as “Inbucket” or “Mailpit”).
3. Use **`supabase/config.toml`** in this repo:
   - **`[auth]`** `site_url` / `additional_redirect_urls` match your app (e.g. Vite `http://127.0.0.1:5173`).
   - **`[auth.email] enable_confirmations = true`** so signup sends a verification message you can open in the mail UI.
   - **`[inbucket]`** `sender_name` / `admin_email` — display name for dev mail.
   - **`[auth.email.template.confirmation]`** / **`recovery`** — HTML under `supabase/templates/` (web3stronghold-branded).

After editing `config.toml` or templates: `npx supabase stop && npx supabase start`.

Point the web app at the local API: `VITE_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and the **anon** key from `npx supabase status`.

## 2. Official self-hosted Supabase (Docker) + Mailpit

**Step-by-step:** [`supabase/self-host/README.md`](../supabase/self-host/README.md) (merge compose, `.env`, restart `auth`, apply keybag SQL).

**Compose merge file** (adds Mailpit to the upstream stack on the same default network):

```bash
cd /path/to/your/supabase-docker-project

docker compose \
  -f docker-compose.yml \
  -f /path/to/web3stronghold/supabase/docker-compose.self-host-mailpit.yml \
  up -d
```

**`.env`** — copy values from [`supabase/self-hosted-smtp.env.example`](../supabase/self-hosted-smtp.env.example). Auth (GoTrue) reads `SMTP_*` from the [official Docker `.env`](https://github.com/supabase/supabase/blob/master/docker/.env.example); set **`SMTP_HOST=mailpit`** (not `supabase-mail`) so the `auth` container resolves this service.

After editing `.env`:

```bash
docker compose -f docker-compose.yml -f docker-compose.self-host-mailpit.yml restart auth
```

- Mailpit UI: **http://localhost:8025** (or `MAILPIT_HTTP_PORT`).

### Standalone Mailpit (no full Supabase stack)

```bash
npm run supabase:mailpit
# or: docker compose -f supabase/mailpit-compose.yml up -d
```

Use this for quick SMTP testing from the host (`localhost:1025`). To attach **self-hosted Auth** to a standalone Mailpit, set `SMTP_HOST=host.docker.internal` (Docker Desktop) or the host gateway IP on Linux.

**Security:** Mailpit’s SMTP has no auth — use only on trusted / internal networks, never exposed to the public internet without a tunnel and controls.

## 3. Delivering real email (optional, advanced)

To reach real inboxes you need a **reachable MTA** (proper DNS: SPF, DKIM, DMARC). Options:

- **Your own SMTP** (e.g. Postfix, [docker-mailserver](https://github.com/docker-mailserver/docker-mailserver)) — still “self-hosted,” but operational overhead is high.
- **Transactional providers** (SES, etc.) — not self-hosted, but simplest for production.

Supabase documents SMTP env vars for self-hosted Docker [here](https://supabase.com/docs/guides/self-hosting/docker#configuring-an-email-server).

## 4. Hosted Supabase (supabase.com)

The dashboard **Email Templates** UI customizes content. **Custom SMTP** is optional and can point to your own server or a provider — see `docs/SUPABASE-AUTH.md`.

## npm scripts (repo root)

| Script | Purpose |
| ------ | ------- |
| `npm run supabase:mailpit` | Start standalone Mailpit (`8025` / `1025`). |
| `npm run supabase:mailpit:down` | Stop Mailpit. |
