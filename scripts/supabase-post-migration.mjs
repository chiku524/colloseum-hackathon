#!/usr/bin/env node
/**
 * After keybags migrations (`001` + `002_solana_keybags_grants.sql`) are applied: run setup check and print follow-ups.
 *
 * Usage: npm run setup:post-keybags
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkScript = join(root, 'scripts', 'check-supabase-setup.mjs');

console.log('--- 1) Environment check ---\n');
const r = spawnSync(process.execPath, [checkScript], { cwd: root, stdio: 'inherit' });

console.log('\n--- 2) Typical next steps (after migration) ---\n');
console.log([
  '  • Auth URLs for local dev: Supabase → Authentication → URL configuration must include',
  '    http://localhost:5173 (Site URL and/or Redirect URLs). If you only set production, run:',
  '    npm run setup:supabase:auth-bash',
  '    Use Site URL http://localhost:5173 for local testing, or add both localhost and your Vercel URL in redirect allow list.',
  '',
  '  • Run the app:  cd apps/web && npm install && npm run dev',
    '    Open http://localhost:5173 → Email → register → confirm email → cloud wallet flow (see docs/SUPABASE-AUTH.md, UI testing checklist).',
  '',
  '  • Verify in dashboard: Table Editor → solana_keybags (empty until a user completes cloud signup).',
  '',
  '  • Optional — Supabase CLI (already installed to ~/.local/bin on your machine):',
  '    supabase login && supabase init && supabase link --project-ref <ref>',
  '    Keeps remote project metadata in supabase/ for db pull/push workflows.',
  '',
  '  • Production: ensure Vercel env has VITE_PUBLIC_SUPABASE_* and redeploy after env changes.',
].join('\n'));

if (r.status !== 0) {
  console.error('\nFix setup:check issues above, then re-run: npm run setup:post-keybags\n');
  process.exit(r.status ?? 1);
}

console.log('\n--- Done ---\n');
