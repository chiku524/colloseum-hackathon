# colloseum-hackathon

Solana **Creator Team Treasury** (Colosseum / Frontier) — on-chain vault, multi-approver releases, and timelocks. See `docs/CREATOR-TREASURY-BUILD-PLAN.md` for the full roadmap.

## Repo layout

| Path | Purpose |
|------|---------|
| `programs/creator-treasury` | Anchor program (**Phase A** implemented) |
| `idl/creator_treasury.json` | IDL for clients/tests (regenerate with `anchor build` when possible) |
| `tests/creator-treasury.ts` | Integration test — run via **`anchor test`** |
| `docs/INVARIANTS-PHASE-A.md` | On-chain invariants and non-goals |
| `keys/` | Dev program keypair (see `keys/README.md`) |
| `scripts/solana-idea-spark.mjs` | Colosseum Copilot CLI for idea research |
| `apps/web/api` | Vercel serverless: `/api/v1/project`, `/api/v1/embed-token`, `/api/v1/webhooks/emit` |

## Prerequisites

- **Rust** (stable, recent) and **Solana CLI** (`solana --version`) — see Windows notes below if you do not use WSL
- **Anchor 0.30.1** (`anchor --version`)
- **Node 18+**

### Anchor CLI (Cargo — recommended on Windows)

Install from the matching tag. On **Rust 1.74+**, omit `--locked` (the v0.30.1 lockfile can fail to compile on newer compilers):

```bash
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --tag v0.30.1 --force
```

Put **Cargo’s bin directory before npm’s** so `anchor` resolves to `anchor.exe` (not the Linux-only npm shim):

- Bash: `export PATH="$HOME/.cargo/bin:$PATH"`

### Solana on Windows (native, without WSL)

1. Download **Solana** `solana-release-x86_64-pc-windows-msvc.tar.bz2` for **1.18.x** from [Solana releases](https://github.com/solana-labs/solana/releases), extract somewhere stable (e.g. `%USERPROFILE%\solana-install\solana-release`) and add its `bin` folder to `PATH`.
2. Download **platform-tools** `platform-tools-windows-x86_64.tar.bz2` from [anza-xyz/platform-tools **v1.41**](https://github.com/anza-xyz/platform-tools/releases/tag/v1.41). Extract so you have `llvm`, `rust`, and `version.md` under:
   - `%LOCALAPPDATA%\solana\v1.41\platform-tools\`
3. From the repo root, create a **directory junction** (avoids symlink privilege errors during `cargo-build-sbf`):

```bash
node scripts/link-sbf-platform-tools.mjs
```

If `anchor build` still fails with **access denied**, run the terminal **once as Administrator**, or enable **Developer Mode** (Settings → System → For developers) so symlink creation succeeds.

## Program (Phase A)

```bash
npm install
cargo check -p creator-treasury
node scripts/prepare-program-keypair.mjs
anchor build
anchor test
```

`anchor test` starts a local validator, deploys the program, and runs `tests/creator-treasury.ts`. If you see **`no such command: build-sbf`**, install the [Solana CLI](https://docs.solanalabs.com/cli/install) (or a full Anchor toolchain) so **`cargo-build-sbf`** is available—`cargo check` alone is not enough to run **`anchor build`** / **`anchor test`**.

To deploy to **devnet** (after `solana config set --url devnet` and funding the wallet):

```bash
node scripts/prepare-program-keypair.mjs
anchor build
anchor deploy --provider.cluster devnet
```

## Colosseum Copilot (idea research)

Set `COLOSSEUM_COPILOT_PAT` (and optionally `COLOSSEUM_COPILOT_API_BASE`) in `.env`, then:

```bash
npm run ideas:spark
npm run copilot:status
```

## Web app (`apps/web`)

Team-lead UI: **create project**, **init vault / deposit**, **policy** editor + simulator, **release** propose → approve → execute, artifacts/disputes, **JSON + CSV** audit export. Dev server:

```bash
cd apps/web && npm install && npm run dev
```

Optional: `VITE_RPC_URL`, `VITE_PROGRAM_ID` (defaults: devnet cluster + program id from `idl/creator_treasury.json`). On devnet, fund the wallet with SOL + token mint liquidity before depositing.

**Public read-only status (no wallet):** open the app with `?view=status&team_lead=<pubkey>&project_id=<u64>`; add `&rpc=<https://...>` to override the RPC endpoint. For iframes, add `&embed=1`. **Policy simulator share:** `?view=simulate&p=<base64>` (use **Copy simulator link** in the Policy tab). See `docs/SECURITY-AND-EMBED.md`.

### Seed script (local / devnet demo)

After `anchor deploy` to your cluster, fund the payer wallet, then:

```bash
npm run seed:treasury
npm run seed:treasury -- --devnet
```

Env: `RPC_URL`, `KEYPAIR_PATH`, `PROJECT_ID` (default `999`), `DEPOSIT_ATOMS`. Creates mint + project + vault + initial policy + deposit when missing.

### Vercel (serverless API + static UI)

Server routes live in `apps/web/api/`. **In the Vercel project (e.g. colloseum-hackathon), set Root Directory to `apps/web`.** If Root Directory is the monorepo root, the build will not pick up `api/` or `vercel.json` correctly.

1. **Settings → General → Root Directory:** `apps/web`
2. **Settings → Environment Variables:** `SOLANA_RPC_URL`, `TREASURY_API_SECRET`, `JWT_EMBED_SECRET` (≥16 chars), optional `WEBHOOK_SIGNING_SECRET`, `WEBHOOK_DELIVERY_URL` — see `apps/web/.env.example` and `docs/SECURITY-AND-EMBED.md`
3. Redeploy

**Local:** `cd apps/web && npx vercel dev` serves both Vite and `/api/*`.

**Cursor Vercel plugin:** run `npx plugins add vercel/vercel-plugin` and accept the interactive install (was waiting on `Y` in the terminal).

See `docs/CREATOR-TREASURY-BUILD-PLAN.md` for later phases.
