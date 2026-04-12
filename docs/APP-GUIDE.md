# Web app — full feature guide

This guide walks through **everything the team-lead dashboard does today**: each tab, the main on-chain actions, read-only sharing, exports, and operational edges. It complements **[`ESSENTIALS.md`](./ESSENTIALS.md)** (runbooks, env, commands) and **[`SECURITY-AND-EMBED.md`](./SECURITY-AND-EMBED.md)** (API, embeds, webhooks).

**In-app docs:** open **`/docs`** on your deployment to read this file (and the rest of `docs/`) inside the browser.

---

## 1. Before you open the app

| Topic | What to know |
|--------|----------------|
| **Cluster** | The UI uses `VITE_RPC_URL` (build-time). Your wallet must target the **same cluster** (devnet vs mainnet). A cluster mismatch blocks signing until you fix wallet settings or RPC. |
| **Program** | Default program id comes from the bundled IDL (`address`). Override with `VITE_PROGRAM_ID` if you deploy your own build. |
| **Wallet** | Browser wallets (e.g. Phantom, Solflare) or the **embedded email wallet** when Supabase env vars are present — same flows after connect. |
| **Project identity** | On-chain project is keyed by **team lead** + **`project_id`** (a number you choose per treasury). **PDA anchor** (lookup seed) defaults to the connected wallet; if the team lead was handed off, you must still enter the **original** creator anchor from project creation so PDAs resolve correctly. |

---

## 2. Tab map (main dashboard)

| Tab (UI label) | Purpose |
|----------------|---------|
| **Overview** | Load project state from chain; set project number, PDA anchor, handoff banner; guided tour entry; first stop after connect. |
| **Treasury** | Vault-centric **snapshot charts** (in vault, reserved, paid out) and per-proposal context — gated by **Private / Public** visibility (browser-only preference, not on-chain). |
| **Setup** | Create project, vault + mint, deposits, emergency pause, proof-before-pay, team-lead handoff, **automation** (split crank) + one-time layout upgrade. |
| **Policy** | Edit structured **policy JSON** (lazy-loaded **Policy Builder**), merge payees from CSV, diff vs baseline, validate, simulate payouts, submit policy on-chain when ready. |
| **Proposals** | Full **release** lifecycle: propose → approve → timelock → **execute** (full or **partial tranche**), cancel (lead, while safe), **artifacts**, **disputes**, **audit export** JSON/CSV, quick action bar. |
| **Share** | **Widget Studio**: build read-only **status** URLs (`?view=status`), optional `embed=1`, `parent_origin` for `postMessage`, policy simulator links — see **[`HOST-WIDGET-INTEGRATION.md`](./HOST-WIDGET-INTEGRATION.md)** and **`/widget-manifest.json`**. |

---

## 3. Overview — load and understand state

1. **Connect wallet** (or complete email onboarding if configured).
2. Set **project number** and **PDA anchor** (almost always the original creator pubkey for that project).
3. Tap **Refresh data** to fetch the **project PDA**, vault, policy version, freeze flag, proposals list, balances.
4. Use **App tour** / **Reset tour** (when connected) for a guided pass over tabs and fields.
5. **Quick path** (when shown) is a lightweight checklist for first vault + policy + payout.

Errors and transaction hints surface in the **toast** region and **status** line; RPC endpoint is shown on errors so you can verify you are not on the wrong cluster.

---

## 4. Treasury — charts and visibility

- **Private (default):** charts only if your wallet is on the **approver list** (matches on-chain approvers).
- **Public:** anyone with this browser profile can see charts for the loaded project — useful for demos; **does not** change who can sign on-chain.
- **Refresh numbers** re-runs the same load path as Overview.

If charts are hidden, the copy explains whether you need **Public** or an approver wallet.

---

## 5. Setup — lifecycle and controls

### 5.1 Create your team project

- Same **project number** as Overview.
- **Approvers:** paste one pubkey per line (or comma-separated); **your connected wallet must be first**.
- **Threshold:** how many approver signatures are required (≤ number of approvers, max 5 in UI).

### 5.2 Vault and deposits

- Paste **mint** of the SPL token (e.g. devnet USDC).
- **Turn vault on** once per project/mint.
- **Deposit** moves tokens from your wallet into the vault ATA (smallest units).

### 5.3 Emergency pause (vault freeze)

- **Pause** stops **new** payout requests and sends; **deposits can still land**.
- **Resume** clears freeze. Team lead only.

### 5.4 Proof before paying

- When enabled, **execute** path requires a **delivery proof** (SHA-256 + optional URI/labels) on the proposal before funds move. Team lead toggles.

### 5.5 Team lead handoff

- Two-step flow: **current** lead starts, **new** wallet connects and **completes**. On-chain project address unchanged; public URLs still use the **PDA anchor** from Overview.

### 5.6 Automatic split payouts (advanced)

- **One-time upgrade** for older projects unlocks automation account layout.
- **Mode:** Off vs **Split payouts**.
- **Interval**, **max per run**, **recipients**, **bps** (shares out of 10_000), optional **next run** timestamp.
- **Save automation** commits config; **Run once now** calls the on-chain crank (your wallet pays fee). Optional **Vercel cron** hits `/api/cron/treasury-crank` when configured (see **`vercel.json`**, **`.env.example`**); Hobby tier is limited to **one cron per day** in this repo’s default schedule.

---

## 6. Policy — rules, builder, and simulation

- **Policy JSON** drives allowed payees, splits, timelock defaults, holdbacks, artifact requirements, etc. (see program + **[`INVARIANTS-PHASE-A.md`](./INVARIANTS-PHASE-A.md)**).
- **Policy Builder** (lazy tab content) helps author valid JSON without hand-editing every field.
- **Merge splits from CSV** combines spreadsheet payees into the policy.
- **Baseline / diff** supports review before on-chain update.
- **Simulate** runs **payout math in the browser** against a sample deposit.
- **Submit** / update policy on-chain when valid (team lead path).

**Policy simulator share links** (`?view=simulate&p=…`) are documented in **[`SECURITY-AND-EMBED.md`](./SECURITY-AND-EMBED.md)** — URL length limits apply for huge policies.

---

## 7. Proposals — payouts, proofs, disputes, export

### 7.1 Happy path

1. **Start payout request** — max amount, timelock (seconds), recipient (pick from policy payees or paste pubkey). Optional **execute tranche** field for partial sends later.
2. Approvers tap **Approve** until **threshold** met.
3. After **timelock**, **Send payment** (full remaining or tranche).
4. Repeat **execute** until cap reached if using **partial releases**.

### 7.2 Lead-only cancel

- Cancel while the proposal is still in a cancellable state and **no funds released yet** on that proposal (see program rules).

### 7.3 Artifacts and disputes

- Under **Proof & disputes**, use the **same proposal id** for attach / open / resolve.
- **Artifact:** 64-hex SHA-256, optional URI, label, milestone.
- **Dispute:** lead or approver may **open**; **resolve** is lead-only; open dispute blocks execution for that proposal.

### 7.4 Audit export

- **Download full report (JSON)** and **Download payout list (CSV)** after data is fresh (refresh Overview first).

### 7.5 Sticky quick actions (ledger tab)

- Duplicates the core four buttons for fast access while scrolling long proposal lists.

---

## 8. Share — embeds and public links

- Compose **status** links with `team_lead`, `project_id`, optional `rpc`, `token` (JWT from API), `embed=1`, `compact=1`, `parent_origin`.
- Copy helpers and explanations live in **Widget Studio**.
- Full iframe + `postMessage` contract: **[`HOST-WIDGET-INTEGRATION.md`](./HOST-WIDGET-INTEGRATION.md)**.

---

## 9. Serverless API (when deployed)

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/v1/project` | JSON snapshot for status/embed consumers. |
| `POST` | `/api/v1/embed-token` | Mint short-lived JWT for `?view=status&token=` (bearer secret). |
| `POST` | `/api/v1/webhooks/emit` | Signed outbound webhook delivery. |

Details, env vars, and threat notes: **[`SECURITY-AND-EMBED.md`](./SECURITY-AND-EMBED.md)**.

---

## 10. Email auth + cloud keybags (optional)

When `VITE_PUBLIC_SUPABASE_*` (or `VITE_SUPABASE_*`) is set, the gate offers **email** sign-in / register with encrypted Solana key material stored in Postgres under RLS — see **[`SUPABASE-AUTH.md`](./SUPABASE-AUTH.md)** and related SMTP docs.

---

## 11. Deployment note — `/docs` and other deep links

This app is a **Vite SPA**: routes like **`/docs`** are resolved in **`main.tsx`**, not as separate HTML files. On **Vercel**, the repo’s **`vercel.json`** includes a **catch-all rewrite** to **`index.html`** so direct navigation and refresh on `/docs` (and `/executive-summary`, etc.) return the app shell instead of a static **404**. Static files and **`/api/*`** still take precedence over that rewrite.

The **`/docs`** Markdown files live under the monorepo **`docs/`** directory; **`prebuild`** / **`npm run dev`** copy them into **`apps/web/src/bundled-docs/`** so Vite can **bundle** them (production builds do not include `import.meta.glob` targets outside the `apps/web` root).

---

## 12. Further reading (by topic)

| Topic | Doc |
|--------|-----|
| Operator essentials & commands | [`ESSENTIALS.md`](./ESSENTIALS.md) |
| API, embed, webhooks, public URLs | [`SECURITY-AND-EMBED.md`](./SECURITY-AND-EMBED.md) |
| Iframe + `postMessage` | [`HOST-WIDGET-INTEGRATION.md`](./HOST-WIDGET-INTEGRATION.md) |
| Roadmap / phases | [`CREATOR-TREASURY-BUILD-PLAN.md`](./CREATOR-TREASURY-BUILD-PLAN.md) |
| On-chain rules | [`INVARIANTS-PHASE-A.md`](./INVARIANTS-PHASE-A.md) |
| Automation design notes | [`DESIGN-AUTOMATED-DISBURSEMENT.md`](./DESIGN-AUTOMATED-DISBURSEMENT.md) |
