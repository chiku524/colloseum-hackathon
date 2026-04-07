# Security notes & embed contract

This complements `docs/CREATOR-TREASURY-BUILD-PLAN.md` (Phase E widgets) with what this repo actually implements today.

## Threat model (high level)

- **Malicious payee:** Recipient pubkey is chosen at proposal time; only that owner’s ATA can receive the transfer. Wrong pubkey → funds go to the wrong party; there is no on-chain clawback in this program version.
- **Compromised team lead:** The lead can freeze the vault, cancel proposals in flight, resolve disputes, set policy, and attach artifacts. Prefer multisig or hardware wallets for the lead key on mainnet.
- **Signer spoofing in the UI:** The web app derives PDAs from the connected wallet and loaded `project_id`. Always verify PDAs and explorer links before signing.
- **RPC / indexer trust:** Read-only views (`view=status`, `view=simulate`) trust the RPC you pass in. Use your own RPC or a provider you trust for high-stakes reads.

## Public surfaces (no wallet)

| Query | Purpose |
|--------|---------|
| `?view=status&team_lead=<pk>&project_id=<u64>` | Read project + proposals from chain. |
| `&rpc=<https://…>` | Optional RPC override (also `VITE_RPC_URL` in the main bundle). |
| `&embed=1` | Minimal chrome for iframes: hides the “URL parameters” explainer panel and tightens padding. |

**Iframe guidance:** Prefer `embed=1` on status links. Do not put privileged keys inside embedded pages. For production, plan an allowlist of `frame-ancestors` / CSP on your host and (later) short-lived read tokens as described in the build plan.

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

**Env (Vercel → Settings → Environment Variables):** `SOLANA_RPC_URL`, `TREASURY_API_SECRET`, `JWT_EMBED_SECRET` (≥16 chars), `WEBHOOK_SIGNING_SECRET`, optional `WEBHOOK_DELIVERY_URL`.

**Browser env:** `VITE_API_BASE_URL` only if the static site and API differ by origin.

**Build:** `prebuild` copies `idl/creator_treasury.json` to `apps/web/api/idl.json` (gitignored) for reliable serverless bundling.

### Phase D — partial releases / tranches

Still **on-chain design** (new instructions or proposal layout). The server cannot implement partial payouts without program changes; use this API for notifications and read models only until the program supports tranches.

## Seed script operational security

`npm run seed:treasury` uses `KEYPAIR_PATH` (default `~/.config/solana/id.json`). Use a throwaway key on devnet/localnet; never commit keypairs.
