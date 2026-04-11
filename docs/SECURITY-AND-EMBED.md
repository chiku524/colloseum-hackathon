# Security notes & embed contract

This complements `docs/CREATOR-TREASURY-BUILD-PLAN.md` (Phase E widgets) with what this repo actually implements today. For product intent and operator setup (RPC, deploy, Vercel), see **[`ESSENTIALS.md`](./ESSENTIALS.md)**.

## Threat model (high level)

- **Malicious payee:** Recipient pubkey is chosen at proposal time; only that owner’s ATA can receive the transfer. Wrong pubkey → funds go to the wrong party; there is no on-chain clawback in this program version.
- **Compromised team lead:** The lead can freeze the vault, cancel proposals that have **not** yet released funds (`released_so_far == 0`), resolve disputes, set policy, and attach artifacts. Prefer multisig or hardware wallets for the lead key on mainnet.
- **Signer spoofing in the UI:** The web app derives PDAs from the connected wallet and loaded `project_id`. Always verify PDAs and explorer links before signing.
- **RPC / indexer trust:** Read-only views (`view=status`, `view=simulate`) trust the RPC you pass in. Use your own RPC or a provider you trust for high-stakes reads.

## Public surfaces (no wallet)

| Path / query | Purpose |
|--------|---------|
| `/docs` (optional `?doc=<slug>`) | Read-only documentation hub: Markdown from `docs/` bundled into the static app at build time. On static hosts (e.g. Vercel), the deployment must **rewrite** unknown paths to `index.html` so a cold load of `/docs` is not a 404 — see **`apps/web/vercel.json`**. |
| `?view=status&team_lead=<pk>&project_id=<u64>` | Read project + proposals from chain. |
| `&rpc=<https://…>` | Optional RPC override (also `VITE_RPC_URL` in the main bundle). |
| `&embed=1` | Minimal chrome for iframes: hides the “URL parameters” explainer panel and tightens padding. |
| `&parent_origin=<encoded origin>` | With `embed=1`, enables `postMessage` from the iframe to the parent at that origin only. See **[`HOST-WIDGET-INTEGRATION.md`](./HOST-WIDGET-INTEGRATION.md)** and **`/widget-manifest.json`**. |

**Iframe guidance:** Prefer `embed=1` on status links. Do not put privileged keys inside embedded pages. For production, plan an allowlist of `frame-ancestors` / CSP on your host and (later) short-lived read tokens as described in the build plan. For parent-page `postMessage` setup, use **[`HOST-WIDGET-INTEGRATION.md`](./HOST-WIDGET-INTEGRATION.md)**.

## Policy simulator share link

| Query | Purpose |
|--------|---------|
| `?view=simulate&p=<base64>` | Loads canonical policy JSON from `p` and runs payout math in the browser only. |

Policies are embedded in the URL; very large JSON may exceed browser limits (~2k–8k depending on environment). Treat shared links as **convenience**, not a secrets channel.

## Serverless API (Vercel)

Routes live under `apps/web/api/` and deploy with the Vite app when **Root Directory** is `apps/web`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/v1/project` | Public | JSON snapshot: `team_lead`, `project_id`, optional `rpc`, or `token` (JWT from embed-token). |
| `POST` | `/api/v1/embed-token` | `Authorization: Bearer <TREASURY_API_SECRET>` | Mint HS256 JWT for `?view=status&token=` (7d expiry). Body: `{ "team_lead", "project_id", "rpc?" }`. |
| `POST` | `/api/v1/webhooks/emit` | Bearer `TREASURY_API_SECRET` | POST signed payload to `WEBHOOK_DELIVERY_URL` or body `delivery_url`. Headers: `X-Treasury-Signature: sha256=<hmac>`, `X-Treasury-Event`. |

**Env (Vercel → Settings → Environment Variables)**

| Variable | Where used | Notes |
|----------|------------|--------|
| `VITE_RPC_URL` | Browser bundle | Devnet/mainnet RPC for wallet + reads. |
| `VITE_PROGRAM_ID` | Browser bundle | Optional; defaults to IDL `address`. Set explicitly on Vercel for clarity. |
| `VITE_API_BASE_URL` | Browser bundle | Only if the UI must call APIs on another origin; omit for same-origin `/api` on Vercel. |
| `SOLANA_RPC_URL` | Serverless | RPC for `GET /api/v1/project` and JWT path. |
| `TREASURY_API_SECRET` | Serverless | Bearer secret for `embed-token` and `webhooks/emit`. |
| `JWT_EMBED_SECRET` | Serverless | HS256 key for embed JWTs (≥16 chars). |
| `WEBHOOK_SIGNING_SECRET` | Serverless | HMAC for outbound webhooks (≥16 chars). |
| `WEBHOOK_DELIVERY_URL` | Serverless | Optional default delivery URL for webhooks. |

Generate a paste-ready `.env` for import: **`npm run vercel:generate-env`** (writes gitignored `apps/web/.env.vercel.paste`). Template without secrets: **`apps/web/vercel.environment.template`**.

**Build:** `prebuild` copies `idl/creator_treasury.json` to `apps/web/api/idl.json` (gitignored) for reliable serverless bundling.

### Phase D — partial releases / tranches

The **on-chain program** supports multiple **`execute_release`** calls per proposal until the approved cap is paid; **`ReleaseProposal`** includes **`released_so_far`**. The **read API** (`/api/v1/project`, `snapshot.ts`) exposes **`releasedSoFar`** and **`amountRemaining`** per proposal. **Migration:** redeploy the program and reset or migrate proposal accounts on clusters that used the older layout (account size and field order changed).

## Seed script operational security

`npm run seed:treasury` uses `KEYPAIR_PATH` (default `~/.config/solana/id.json`). With **`--devnet`**, if **`keys/devnet-payer.json`** exists, the seed script uses it automatically. Use a throwaway key on devnet/localnet; never commit keypairs or `apps/web/.env.vercel.paste`.
