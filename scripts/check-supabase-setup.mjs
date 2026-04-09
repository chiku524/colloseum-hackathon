#!/usr/bin/env node
/**
 * Check local env for Supabase + web3stronghold web setup (no secrets printed).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadSetupEnv,
  projectRefFromSupabaseUrl,
  REPO_ROOT,
} from './lib/load-dotenv-files.mjs';

loadSetupEnv();

const web = join(REPO_ROOT, 'apps', 'web');
const devLocal = join(web, '.env.development.local');

const url =
  process.env.VITE_PUBLIC_SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const anon =
  process.env.VITE_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || '';

const ref = projectRefFromSupabaseUrl(url);
const dbUrlPresent = Boolean(
  process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL,
);

let ok = true;
const lines = [];

lines.push('=== web3stronghold / Supabase setup check ===\n');

lines.push(devLocal + (existsSync(devLocal) ? ' — found' : ' — missing (run: cd apps/web && vercel env pull .env.development.local)'));
if (!existsSync(devLocal)) ok = false;

lines.push('');
lines.push('Browser (Vite) Supabase:');
lines.push('  VITE_PUBLIC_SUPABASE_URL or VITE_SUPABASE_URL: ' + (url ? `${url.slice(0, 40)}…` : 'MISSING'));
lines.push('  VITE_PUBLIC_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY: ' + (anon ? `set (${anon.length} chars)` : 'MISSING'));
if (!url || !anon) ok = false;

lines.push('  Project ref: ' + (ref || 'unknown (fix URL)'));

lines.push('');
lines.push('Database migration (npm run setup:apply-keybags):');
lines.push('  Connection string: ' + (dbUrlPresent ? 'found in env' : 'MISSING'));
if (!dbUrlPresent) {
  lines.push('    Add POSTGRES_URL* from Vercel pull, or SUPABASE_DB_URL in .env.supabase.local (gitignored)');
  ok = false;
}

lines.push('');
lines.push('Auth redirect URLs:');
lines.push('  Automate: SUPABASE_ACCESS_TOKEN=... npm run setup:supabase-auth-urls');
lines.push('  Or: npm run setup:supabase-open -- auth');

lines.push('');
lines.push(ok ? 'Result: ready to run npm run dev (apps/web) and test Email sign-in.' : 'Result: fix items above.');

console.log(lines.join('\n'));
process.exit(ok ? 0 : 1);
