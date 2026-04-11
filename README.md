# web3stronghold

Solana **Creator Team Treasury** (**web3stronghold** web app) — on-chain vault, multi-approver releases, timelocks, policy hashing, and a team-lead web dashboard with optional **Vercel** API/embed support.

**New here?** Read **[`docs/ESSENTIALS.md`](docs/ESSENTIALS.md)** for what the app is for, roles, workflows, and configuration. Roadmap: [`docs/CREATOR-TREASURY-BUILD-PLAN.md`](docs/CREATOR-TREASURY-BUILD-PLAN.md).

## Repo layout

| Path | Purpose |
|------|---------|
| `programs/creator-treasury` | Anchor program |
| `idl/creator_treasury.json` | IDL for clients, tests, and web (refresh via full `anchor build` when you change the program API) |
| `tests/creator-treasury.ts` | Integration tests — **`anchor test`** |
| `docs/ESSENTIALS.md` | **Operator guide**: product intent, concepts, env, commands |
| `docs/INVARIANTS-PHASE-A.md` | On-chain invariants |
| `docs/SECURITY-AND-EMBED.md` | API auth, embeds, webhooks, env |
| `keys/` | Dev program keypair — see [`keys/README.md`](keys/README.md) |
| `scripts/` | Docker Anchor build, devnet helpers, Vercel env generator, seed, Copilot CLI |
| `apps/web` | Vite app + Vercel serverless `api/` — see [`apps/web/README.md`](apps/web/README.md) |

## Prerequisites

- **Node 18+**
- **Docker** (recommended) for **`anchor build`** without a full native Solana SBF toolchain
- **Rust** (optional) for `cargo check -p creator-treasury` on the host

## Program: check, build, test

```bash
npm install
npm run check:program          # host cargo check
npm run prepare:keypair        # keys/ → target/deploy/ program keypair
npm run build:program:docker   # Docker: anchor build --no-idl (recommended)
npm test                       # anchor test (local validator + TS tests)
```

Native **`anchor build`** / **`anchor test`** need **`cargo-build-sbf`** and a compatible toolchain (see Solana/Anchor docs). On Windows, Docker avoids many toolchain issues.

## Devnet: deploy and seed

1. Fund the wallet that will pay rent and fees (often **~3 devnet SOL** for deploy).
2. `npm run prepare:keypair`
3. `npm run build:program:docker`
4. `npm run devnet:deploy` — uses Docker Solana CLI. If **`keys/devnet-payer.json`** exists, it is used as the fee payer automatically; otherwise set **`FEE_PAYER_KEYPAIR`** or install **`~/.config/solana/id.json`**.
5. `npm run seed:treasury:devnet` — demo flow; with **`--devnet`**, uses **`keys/devnet-payer.json`** when present.

Helpers: `npm run devnet:help`, `npm run solana:devnet -- <solana args>`.

## Web app

```bash
cd apps/web && npm install && npm run dev
```

The dashboard and public views are documented in [`apps/web/README.md`](apps/web/README.md) and [`docs/ESSENTIALS.md`](docs/ESSENTIALS.md). After deploy (or locally), open **`/docs`** for the bundled documentation hub (same Markdown as `docs/`).

## Vercel

- **Root Directory:** `apps/web`
- **Env:** `npm run vercel:generate-env` → import **`apps/web/.env.vercel.paste`** (gitignored). Template without secrets: **`apps/web/vercel.environment.template`**. Details in **`apps/web/.env.example`** and **`docs/SECURITY-AND-EMBED.md`**.
- After changing **`VITE_*`**, trigger a new deployment.
- **GitHub Actions:** pushes to **`main`** run **`.github/workflows/vercel-production.yml`** when the repo secret **`VERCEL_TOKEN_HACKATHON`** is set (create a token under [Vercel → Account → Tokens](https://vercel.com/account/tokens)). **`/.vercel/project.json`** or **`apps/web/.vercel/project.json`** links the CLI to your Vercel project (e.g. **web3stronghold**); keep **Root Directory** set to **`apps/web`** (do not combine that with `vercel --cwd apps/web` or paths double). If you renamed the GitHub repo, reconnect the project under **Vercel → Project → Settings → Git** to **chiku524/web3stronghold**.

## Colosseum Copilot (idea research)

Set `COLOSSEUM_COPILOT_PAT` (and optionally `COLOSSEUM_COPILOT_API_BASE`) in `.env`, then:

```bash
npm run ideas:spark
npm run copilot:status
```

## Program ID (dev / hackathon)

`BYZFRa7NzDB7bKwxxkntewHfWwjBBqM6nsfrVeakBHjV` — must match `keys/creator_treasury-dev-keypair.json` and `idl/creator_treasury.json`. **Do not reuse that keypair for production mainnet.**
