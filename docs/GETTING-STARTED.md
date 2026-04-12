# Getting started — web3stronghold in one pass

Use this page when you want a **linear path** from zero to a working treasury on **devnet** (or the same mental model on mainnet). Deep detail lives in **[`ESSENTIALS.md`](./ESSENTIALS.md)** and **[`APP-GUIDE.md`](./APP-GUIDE.md)**.

---

## 1. What you are building

You will have:

1. A **Solana program** instance (IDL address in the client) for **creator treasury** logic.
2. A **project** on-chain (team lead + numeric `project_id`).
3. A **vault** holding an SPL token you choose.
4. A **policy** (hashed on-chain) and optional **payout requests** with approvers + timelocks.

---

## 2. Prerequisites (local)

| Need | Notes |
|------|--------|
| **Node 18+** | For `apps/web` and repo scripts. |
| **Wallet** | Phantom, Solflare, or embedded email wallet if Supabase is configured. |
| **RPC URL** | Set `VITE_RPC_URL` (e.g. devnet public or your provider). |
| **SOL on devnet** | For fees + rent; deploy/seed scripts may need multiple SOL for large programs. |

From repo root, Docker-based program build is common on Windows: **`npm run build:program:docker`**. See **[`ESSENTIALS.md`](./ESSENTIALS.md)** §6–7 for deploy/seed commands.

---

## 3. Open the web app

```bash
cd apps/web
npm install
npm run dev
```

`npm run dev` copies `docs/*.md` into the app bundle folder automatically. Open **`http://localhost:5173/`** (or the port Vite prints).

---

## 4. First session in the UI (happy path)

1. **Connect wallet** (same cluster as your RPC).
2. **Overview** — set **project number** (often `0` for your first test), confirm **PDA anchor** (usually the original creator wallet), tap **Refresh data**.
3. **Setup** → **Create your team project** — approvers list (**your wallet first**), threshold, **Create project**.
4. **Setup** → **Vault** — paste **mint** of your test token, **Turn vault on**, then **Deposit** a small amount (smallest units).
5. **Policy** — edit or build **policy JSON**, **Simulate**, then submit policy on-chain when satisfied.
6. **Proposals** — **Start payout request** → collect **Approve** signatures → wait **timelock** → **Send payment**.

Always double-check **recipient addresses** and **amounts** before signing; mistakes on-chain are expensive.

---

## 5. Share read-only views (optional)

- **Status:** `?view=status&team_lead=<pk>&project_id=<id>` — see **[`SECURITY-AND-EMBED.md`](./SECURITY-AND-EMBED.md)**.
- **Policy calculator share:** `?view=simulate&p=…` — browser-only; URL size limits apply.
- **Embeds:** **[`HOST-WIDGET-INTEGRATION.md`](./HOST-WIDGET-INTEGRATION.md)** and **`widget-manifest.json`**.

---

## 6. Deploy to Vercel (outline)

1. **Root Directory** = `apps/web`.
2. Import env from **`npm run vercel:generate-env`** output (see **`apps/web/.env.example`**).
3. **`vercel.json`** includes an SPA rewrite so **`/docs`** works on cold load.
4. Redeploy whenever **`VITE_*`** variables change.

---

## 7. Where to go next

| Goal | Doc |
|------|-----|
| Full tab-by-tab UI | [`APP-GUIDE.md`](./APP-GUIDE.md) |
| Env, scripts, devnet, Vercel | [`ESSENTIALS.md`](./ESSENTIALS.md) |
| API, JWT, webhooks, threat model | [`SECURITY-AND-EMBED.md`](./SECURITY-AND-EMBED.md) |
| Email auth + keybags | [`SUPABASE-AUTH.md`](./SUPABASE-AUTH.md) |
| On-chain rules | [`INVARIANTS-PHASE-A.md`](./INVARIANTS-PHASE-A.md) |
