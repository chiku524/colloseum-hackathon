# Supabase + Resend (custom SMTP)

This is the recommended path for **production** auth email when you want mail from **your domain** (e.g. `noreply@yourdomain.com`, display name **web3stronghold**) without running Docker or your own mail server.

**No changes are required in the web3stronghold app code** — only [Resend](https://resend.com), your **DNS**, and the **Supabase dashboard**.

---

## Migration checklist (hosted Supabase → Resend)

1. **Resend account** — Sign up at [resend.com](https://resend.com).
2. **Domain** — In Resend → **Domains** → add the domain you send from (often the same domain as your Vercel site).
3. **DNS** — Add the TXT/CNAME records Resend shows (SPF, DKIM, etc.). Where you add them depends on where DNS is managed:
   - Domain on **Vercel** → [Vercel DNS / domain settings](https://vercel.com/docs/projects/domains).
   - Domain on **Cloudflare** / registrar → use that panel instead.
4. **API key** — Resend → **API Keys** → create a key (this becomes the **SMTP password** in Supabase). Store it in a password manager; do not commit it to git.
5. **Supabase SMTP** — Project → **Authentication** → **Sign In / Providers** → **Email** (or **Authentication → Emails** → **SMTP settings**, depending on dashboard version) → enable **Custom SMTP** and enter:

   | Field | Value |
   | ----- | ----- |
   | Host | `smtp.resend.com` |
   | Port | **`465`** or **`587`** — digits only. Do **not** paste quotes, spaces, or comments (e.g. wrong: `"465" # try 587`). Wrong values **crash Auth** (GoTrue exits; dashboard shows Auth unhealthy, sign-in **503**). |
   | Username | `resend` |
   | Password | Your Resend API key |
   | Sender email | e.g. `noreply@yourdomain.com` (must be on the verified domain) |
   | Sender name | e.g. `web3stronghold` |

6. **Save** in Supabase, then run a **test signup** from your deployed or local app.
7. **Templates** (optional) — Supabase → **Authentication** → **Email Templates** — adjust subjects/body copy to match your product.

Supabase reference: [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

### Same settings via CLI (this repo)

Uses the [Supabase Management API](https://supabase.com/docs/reference/api/v1-patch-project-auth-config) — same personal token as `setup:supabase-auth-urls`, **not** your anon/service_role key.

From the **repo root** (with `apps/web/.env.development.local` from `vercel env pull`, or vars exported):

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."   # Account → Access tokens
export RESEND_API_KEY="re_..."           # New key from Resend (never commit)

# Optional overrides:
# export SUPABASE_SMTP_SENDER_EMAIL="noreply@web3stronghold.app"
# export SUPABASE_SMTP_SENDER_NAME="web3stronghold"
# export SUPABASE_SMTP_PORT=465
# (or 587 — value must be digits only; never paste a whole commented line into the dashboard Port field)

npm run setup:supabase-smtp-resend
```

Or put `SUPABASE_ACCESS_TOKEN` and `RESEND_API_KEY` in **`.env.supabase.local`** (gitignored) at the repo root — `load-dotenv-files` loads it for the script.

**Permissions:** If the request returns **403**, your token may need broader scope or organization access to update Auth config.

**Security:** Do not paste API keys into chat or commit them. If a key was exposed, rotate it in Resend and regenerate the Supabase token if needed.

---

## Vercel and email: does Vercel offer mailboxes or aliases?

**No.** Vercel does **not** provide email hosting, inboxes, or “email aliases” as a product. A **Vercel alias** in their docs means a **deployment URL alias** (e.g. mapping a hostname to a deployment), not an email address.

For a domain you use with Vercel:

- **Sending** transactional mail (sign-up, reset): use **Resend** (or another SMTP provider) and wire it to **Supabase** as above. Resend only **sends**; it is not a full mailbox.
- **Receiving** mail at `you@yourdomain.com` or **forwarding/aliases**: use a separate service and set **MX** (and any provider-specific) records in DNS:

  - **[Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)** — free forwarding/aliases if the domain uses Cloudflare DNS.
  - **Google Workspace**, **Microsoft 365**, **Fastmail**, **Proton**, etc. — full mailboxes.
  - **ImprovMX**, **Forward Email**, etc. — simple forwarding.

If your domain’s DNS is managed in **Vercel**, you add those **MX** records there so inbound mail still works. See Vercel’s guide: [Using email with your Vercel domain](https://vercel.com/kb/guide/using-email-with-your-vercel-domain).

**Practical split:**

| Need | Use |
| ---- | --- |
| Auth emails **from** `noreply@…` | **Resend** + Supabase Custom SMTP |
| **Receive** mail / aliases on your domain | MX + a mail/forwarding provider (not Vercel) |

You can use the **same domain** for both: e.g. Resend sends from `noreply@yourdomain.com`, while MX points to Cloudflare Email Routing or Workspace for `hello@` → your Gmail.

---

## After SMTP is on

- Tune **Authentication → Email Templates** in Supabase.
- Keep **Site URL** and **Redirect URLs** correct (`docs/SUPABASE-AUTH.md`).

---

## Optional: SendGrid instead of Resend

Same Supabase **Custom SMTP** screen; typical values:

- Host: `smtp.sendgrid.net`
- Port: `587`
- Username: `apikey` (literal)
- Password: SendGrid API key with Mail Send permission

---

## Troubleshooting: confirmation or reset email never arrives

Sign-up can succeed in the app while **no message reaches the inbox** if SMTP delivery fails silently on Supabase’s side or mail is filtered.

1. **Supabase → Logs → Auth** (or Log Explorer) — Look for mail/SMTP errors right after signup (authentication failures, rejected sender, connection errors). If **Resend shows no messages at all**, GoTrue usually never reached SMTP (misconfig, Auth error before send, or signup mail skipped) — fix starts in **Supabase**, not Resend.
2. **Resend → Emails** (or your provider’s outbound log) — After a successful handoff, you should see outbound attempts. If the dashboard is empty, confirm **Custom SMTP** is enabled and saved in Supabase and that Auth was healthy when you triggered signup/resend.
3. **Sender address** — The **SMTP “sender” / admin email** in Supabase must use an address on a domain **verified in Resend** (e.g. `noreply@web3stronghold.app`). A typo or unverified domain often means no delivery.
4. **Redirect URL** — `emailRedirectTo` / `redirectTo` must match an entry under **Authentication → URL configuration → Redirect URLs**. The app can send a fixed production URL via **`VITE_AUTH_EMAIL_REDIRECT_ORIGIN`** (see `apps/web/vercel.environment.template`) so links stay allowlisted even when users register from `*.vercel.app`.
5. **Spam / Promotions** — Ask the recipient to search for the sender domain or “Supabase”.
6. **Rate limits** — Resend free tier and Supabase may throttle; wait a few minutes and use **Resend confirmation email** on the verify screen (after deploy) or call `auth.resend({ type: 'signup', … })` from the client.

## Troubleshooting: Auth unhealthy / 503 on `/auth/v1/token`

If logs show `GOTRUE_SMTP_PORT` / `strconv.ParseInt` / `Failed to load configuration`, the **SMTP port** in project Auth config is not a plain integer. Fix in **Supabase Dashboard → Authentication → Emails / SMTP**: set **Port** to `465` or `587` only, save, wait for Auth to restart. Or run `npm run setup:supabase-smtp-resend` with `SUPABASE_SMTP_PORT=465` (no quotes in `.env` values).

## Related repo docs

- `docs/SUPABASE-AUTH.md` — auth URLs, keybags, hosted setup.
- `docs/SUPABASE-SELF-HOSTED-EMAIL.md` — Mailpit / Docker (only if you self-host Supabase).
