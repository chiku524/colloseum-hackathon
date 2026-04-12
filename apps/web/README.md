# web3stronghold — Web app (`apps/web`)

Vite + React dashboard for **team leads** (wallet, projects, vault, policy, releases, audit export) plus **public** views (status, policy simulator). Serverless routes under `api/` deploy on **Vercel** with the static site.

## Start locally

```bash
cd apps/web
npm install
npm run dev
```

Create `**apps/web/.env.local**` (gitignored) as needed, for example:

```env
VITE_RPC_URL=https://api.devnet.solana.com
```

`VITE_PROGRAM_ID` is optional; the app defaults to the `address` in `idl/creator_treasury.json` (copied from the repo root IDL).

## Build

```bash
npm run build
```

`prebuild` runs `scripts/copy-idl-to-api.mjs` and writes `**api/idl.json**` (gitignored) so Vercel functions bundle a stable IDL. It also runs **`scripts/copy-docs-for-vite.mjs`**, which copies the monorepo **`docs/*.md`** tree into `**src/bundled-docs/**` (gitignored) so the **`/docs`** page can bundle Markdown (Vite does not ship globs outside `apps/web` in production). The same copy runs at the start of **`npm run dev`**.

## Vercel

1. **Project → Settings → General → Root Directory:** `apps/web` (required).
2. **Environment variables:** generate a paste file from the monorepo root with `npm run vercel:generate-env`, then import `**apps/web/.env.vercel.paste`** in Vercel (or copy keys from `vercel.environment.template` and fill secrets manually). See `**apps/web/.env.example**`.
3. Redeploy after changing `**VITE_***` so the client rebuilds.
4. **SPA deep links:** `vercel.json` rewrites unknown paths to `index.html` so **`/docs`**, **`/executive-summary`**, and other client-only routes work on refresh. **`/api/*`** and real static files still match first.

**Local full stack:** from the **repo root**, run `npx vercel dev --cwd apps/web` so Vite + `/api/*` use the linked project (`.vercel/project.json` lives at the monorepo root to match CI and dashboard Root Directory `apps/web`).

## API routes (serverless)


| Route                        | Role                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/v1/project`        | JSON snapshot for status/embed (`token`, query params, or JWT).                      |
| `POST /api/v1/embed-token`   | Mint embed JWT (`Authorization: Bearer` + `TREASURY_API_SECRET`).                    |
| `POST /api/v1/webhooks/emit` | Signed outbound webhook (`WEBHOOK_SIGNING_SECRET`, optional `WEBHOOK_DELIVERY_URL`). |


Details: `[../docs/SECURITY-AND-EMBED.md](../docs/SECURITY-AND-EMBED.md)`.

## URL modes (browser)


| Path / query                                   | Purpose                                                  |
| ---------------------------------------------- | -------------------------------------------------------- |
| `/docs` (optional `?doc=<slug>`)               | Documentation hub: repo `docs/*.md` inlined at **build** time (slug = filename without `.md`). |
| `?view=status&team_lead=<pk>&project_id=<u64>` | Read-only chain snapshot (optional `&rpc=`, `&embed=1`). |
| `?view=simulate&p=<base64>`                    | Policy simulator share link.                             |


Product context and operator essentials: `[../docs/ESSENTIALS.md](../docs/ESSENTIALS.md)`.