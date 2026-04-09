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
   | Port | `465` (TLS) — see [Resend + Supabase](https://resend.com/docs/send-with-supabase-smtp) if your UI prefers `587` |
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
# export SUPABASE_SMTP_PORT="465"        # or 587

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

## Related repo docs

- `docs/SUPABASE-AUTH.md` — auth URLs, keybags, hosted setup.
- `docs/SUPABASE-SELF-HOSTED-EMAIL.md` — Mailpit / Docker (only if you self-host Supabase).
