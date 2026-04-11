# Creator Team Treasury (web3stronghold) — Essentials

This document explains **what the system is for**, **who uses it**, and **what you must know** to run it safely and effectively. It complements the phased roadmap in `[CREATOR-TREASURY-BUILD-PLAN.md](./CREATOR-TREASURY-BUILD-PLAN.md)`, the on-chain rules in `[INVARIANTS-PHASE-A.md](./INVARIANTS-PHASE-A.md)`, and the security/embed contract in `[SECURITY-AND-EMBED.md](./SECURITY-AND-EMBED.md)`.

---

## 1. What this app is for

**Creator Team Treasury** is a Solana-based operations layer for **creator organizations** (channels, studios, collectives) that need to:

- Hold **shared funds** in a vault (SPL token mint you choose, e.g. a stablecoin on devnet or mainnet).
- Enforce **who can move money** through **policies** (hashed on-chain) and **multi-approver** workflows.
- Run **staged payouts**: propose a release, collect approvals, wait for a **timelock**, then **execute** transfers to payee token accounts.
- Keep a **clear trail** for operations and disputes: proposals, approvals, artifacts, freeze/cancel rules, and **audit export** (JSON/CSV) from the web UI.

It is **not** a full accounting suite, payroll provider, or social platform. It is **on-chain treasury logic + a team-lead dashboard + read-only/embed surfaces** you can host (e.g. on Vercel).

---

## 2. Who uses it


| Role                                 | How they interact                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Team lead**                        | Connects wallet in the web app; creates the **project**, initializes **vault**, sets **policy**, proposes releases, may freeze vault, resolves disputes, exports audits.                                           |
| **Approvers**                        | Wallets listed on the project; must sign **approve** on release proposals up to the configured **threshold** (e.g. 2-of-N).                                                                                        |
| **Depositors**                       | Typically the lead or finance; **deposit** tokens into the vault ATA after mint/vault setup.                                                                                                                       |
| **Payees**                           | Do not log into this app by default; **release** instructions send tokens to a **payee-associated token account** chosen at proposal time. Wrong pubkey means **wrong recipient**—there is no clawback in-program. |
| **Observers / sponsors / community** | **Read-only** via **public status** URL (`?view=status`) or JSON from `**GET /api/v1/project`** when deployed with the serverless API.                                                                             |


---

## 3. Core concepts (minimum vocabulary)

- **Program** — The Anchor program deployed at the idl address (see `idl/creator_treasury.json`). Upgrades are controlled by the program **upgrade authority** keypair (separate from day-to-day payer wallets).
- **Project** — A PDA per `(team_lead, project_id)`. Holds policy version, approver set, threshold, freeze flag, etc.
- **Vault** — A PDA tied to the project; holds vault state and uses an SPL **mint** and **vault token ATA** for custody.
- **Policy** — Represented by a **hash** on-chain; the UI edits structured policy JSON and can **simulate** payouts before you commit changes on-chain.
- **Release proposal** — A payout intent: amount, payee, timelock, status. Approvers sign; after timelock, **execute** performs the SPL transfer. Partial releases are supported (`released_so_far` / remaining cap).
- **Split crank (optional automation)** — Team lead configures on-chain **recipients + bps + interval + max_per_tick**; anyone may call `**crank_automation`** after `next_eligible_ts` to move up to `min(vault, max_per_tick)` split by bps. Projects created before this feature may need `**upgrade_project_layout**` once (Setup tab). Vercel can call `**/api/cron/treasury-crank**` when env vars are set (see `apps/web/vercel.json` and `.env.example`). **Vercel Hobby** allows **at most one cron invocation per day** (this repo uses **12:00 UTC** daily); upgrade to Pro or use an external scheduler for higher frequency.
- **Disputes / artifacts** — Workflow hooks for accountability (see UI and program); treat **artifact URIs** and attestations as part of your operational process.

---

## 4. What the web app does (team dashboard)

When you run `apps/web` (locally or on Vercel):

- **In-app documentation** — open **`/docs`** for a browsable copy of the Markdown under `docs/` (bundled at build time). Use **`?doc=<filename-without-md>`** to deep-link, e.g. **`/docs?doc=ESSENTIALS`**.
- **Wallet connect** (Phantom, Solflare, embedded email wallet when Supabase is configured) against the configured **cluster** (devnet by default in code).
- **Project lifecycle**: initialize project, vault, mint (where applicable), deposit, policy editor + **simulator**, **release** propose → approve → execute.
- **Audit**: export **JSON** and **CSV** for reconciliation and external tools.
- **Shareable policy simulator link** (`?view=simulate&p=...`) — runs **only in the browser**; large policies may hit URL length limits.

Public **status** view (`?view=status&team_lead=...&project_id=...`) loads **read-only** chain data via RPC (and optionally via your `**/api/v1/project`** when `VITE_API_BASE_URL` or same-origin API is set). See `[SECURITY-AND-EMBED.md](./SECURITY-AND-EMBED.md)` for embed mode (`embed=1`), JWT tokens, and webhooks.

---

## 5. What you must configure (essentials)

### 5.1 Cluster and RPC

- **Browser**: `VITE_RPC_URL` (e.g. `https://api.devnet.solana.com` for devnet). Defaults in code target **devnet** for wallet adapter + connection.
- **Serverless (Vercel)**: `SOLANA_RPC_URL` for `GET /api/v1/project` and JWT-backed reads.

Use an RPC you **trust** for high-stakes reads; public endpoints can be rate-limited.

### 5.2 Program ID

- Default in the UI comes from the bundled `**idl/creator_treasury.json`** (`address` field).
- Optional override: `VITE_PROGRAM_ID` at **build time** (Vercel env).

The on-chain deployment **must** match this id (or you must redeploy clients with the new idl).

### 5.3 Wallets and keys

- **Payer / team operations**: normal Solana keypair (file or wallet adapter). For scripts, `KEYPAIR_PATH` or `~/.config/solana/id.json`.
- **Program upgrade authority**: `keys/creator_treasury-dev-keypair.json` (dev) — **never reuse for production mainnet**; see `keys/README.md`.
- **Never commit** funded keypairs or `.env.vercel.paste`. `keys/devnet-payer.json` is gitignored and only for local/devnet automation if you create it.

### 5.4 Vercel hosting

1. **Root Directory** = `apps/web` (required so `api/` and `vercel.json` deploy together).
2. **Environment variables** (see `apps/web/.env.example` and `apps/web/vercel.environment.template`):
  - **Build-time**: `VITE_RPC_URL`, `VITE_PROGRAM_ID` (recommended explicit on Vercel).
  - **Runtime (API)**: `SOLANA_RPC_URL`, `TREASURY_API_SECRET`, `JWT_EMBED_SECRET` (≥16 chars), `WEBHOOK_SIGNING_SECRET` (for webhooks), optional `WEBHOOK_DELIVERY_URL`.
3. Regenerate a paste-ready file: `npm run vercel:generate-env` → import `apps/web/.env.vercel.paste` in the Vercel UI (file is gitignored).
4. **Redeploy** after changing `VITE_`* so the client bundle rebuilds.

---

## 6. Typical workflows

### 6.1 Local development (validator + tests)

From repo root: `anchor test` (starts local validator, deploys, runs TS tests). Requires a working Solana/Anchor **SBF** toolchain (often easiest via **Docker**: `npm run build:program:docker`).

### 6.2 Devnet: build, deploy, seed

1. `npm run prepare:keypair` — syncs program keypair into `target/deploy/`.
2. `npm run build:program:docker` — reproducible Linux build (`anchor build --no-idl`).
3. Fund the **deployer** wallet on devnet (enough SOL for rent + fees; large `.so` may need **~3 SOL** on devnet).
4. `npm run devnet:deploy` — uses Docker Solana CLI; if `keys/devnet-payer.json` exists, it is used automatically as `-k` fee payer (see `scripts/devnet-deploy-docker.sh`).
5. `npm run seed:treasury:devnet` — demo project/vault/mint/deposit; uses `keys/devnet-payer.json` automatically when present and `--devnet` is passed.

### 6.3 Day-to-day in the UI

1. Connect wallet (same cluster as `VITE_RPC_URL`).
2. Open or create **project** (team lead pubkey + `project_id` you use consistently in URLs and API).
3. **Initialize vault** and **mint** if not done; **deposit** tokens.
4. Set **policy** (and simulate); submit on-chain when ready.
5. **Propose release** → approvers **approve** → wait **timelock** → **execute**.
6. Use **audit export** for records.

---

## 7. Command cheat sheet (repo root)


| Command                        | Purpose                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `npm run check:program`        | `cargo check` the Anchor program (host Rust).                                                    |
| `npm run build:program:docker` | Dockerized `anchor build --no-idl` (recommended when native SBF toolchain is painful).           |
| `npm run prepare:keypair`      | Copy `keys/creator_treasury-dev-keypair.json` → `target/deploy/creator_treasury-keypair.json`.   |
| `npm run devnet:deploy`        | Deploy `.so` to devnet via Docker (optional `FEE_PAYER_KEYPAIR`, auto `keys/devnet-payer.json`). |
| `npm run seed:treasury:devnet` | Devnet demo seed (auto payer file when present).                                                 |
| `npm run devnet:help`          | Devnet helper usage (`scripts/devnet.mjs`).                                                      |
| `npm run vercel:generate-env`  | Generate `apps/web/.env.vercel.paste` for Vercel import.                                         |
| `npm test` / `anchor test`     | Integration tests on local validator.                                                            |


---

## 8. Trust and safety (short list)

- **Verify addresses** before signing: payee pubkey, mint, PDAs, explorer links.
- **Team lead key** is powerful (freeze, policy, cancel before release, disputes). Prefer **hardware wallet** or **multisig** patterns on mainnet.
- **Embeds and public URLs** are read surfaces; do not put **secrets** in query strings. Use `**POST /api/v1/embed-token`** with `TREASURY_API_SECRET` for short-lived JWTs when you enable token mode.
- **Webhook** payloads are **HMAC-signed** with `WEBHOOK_SIGNING_SECRET`; verify on the receiver.

Full detail: `[SECURITY-AND-EMBED.md](./SECURITY-AND-EMBED.md)`.

---

## 9. Further reading


| Document                                                                 | Contents                                                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **[`APP-GUIDE.md`](./APP-GUIDE.md)**                                   | **Full UI walkthrough:** every tab (Overview → Share), payouts, automation, exports, embeds. |
| **In-app docs** (`/docs` on the web deployment)                          | Same guides as this folder, rendered in the UI; optional `?doc=SLUG` (slug = markdown filename without `.md`). |
| `[CREATOR-TREASURY-BUILD-PLAN.md](./CREATOR-TREASURY-BUILD-PLAN.md)`     | Phased roadmap, architecture, future embeds.                                            |
| `[DESIGN-AUTOMATED-DISBURSEMENT.md](./DESIGN-AUTOMATED-DISBURSEMENT.md)` | Feasibility of opt-in “set and forget” / scheduled payouts (no on-chain plain English). |
| `[INVARIANTS-PHASE-A.md](./INVARIANTS-PHASE-A.md)`                       | On-chain invariants and non-goals.                                                      |
| `[SECURITY-AND-EMBED.md](./SECURITY-AND-EMBED.md)`                       | Threat model, API auth, env vars, iframe notes.                                         |
| Repository `[README.md](../README.md)`                                   | Install paths, layout, Copilot CLI, quickstarts.                                        |
| `[apps/web/README.md](../apps/web/README.md)`                            | Frontend/env/build specifics.                                                           |
| `[keys/README.md](../keys/README.md)`                                    | Program keypair and rotation warnings.                                                  |


---

## 10. One-line product summary

**Creator Team Treasury** helps creator teams **custody**, **govern**, and **payout** shared on-chain funds with **explicit policies**, **approvals**, **timelocks**, and **auditability**—through an Anchor program, a team-lead web dashboard, and optional **public status** and **serverless API** on Vercel.