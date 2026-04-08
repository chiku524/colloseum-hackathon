#!/usr/bin/env node
/**
 * Apply supabase/migrations/001_solana_keybags.sql using node-postgres (works on Windows).
 *
 * Connection string (first non-empty wins):
 *   SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL_NON_POOLING, POSTGRES_URL, POSTGRES_PRISMA_URL
 *
 * Env is loaded from apps/web/.env.development.local (vercel pull) and optional repo .env.supabase.local.
 *
 * Usage: npm run setup:apply-keybags
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadSetupEnv, REPO_ROOT } from './lib/load-dotenv-files.mjs';

loadSetupEnv();

const candidates = [
  process.env.SUPABASE_DB_URL,
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.POSTGRES_URL,
  process.env.POSTGRES_PRISMA_URL,
].filter(Boolean);

const connectionString = candidates[0];
if (!connectionString) {
  console.error(`Missing database URL. Set one of:
  SUPABASE_DB_URL   (recommended: direct connection, port 5432)
  DATABASE_URL
  POSTGRES_URL_NON_POOLING / POSTGRES_URL   (from Vercel env pull)

Or add SUPABASE_DB_URL to a gitignored file: .env.supabase.local (repo root)
Example:
  postgresql://postgres:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres?sslmode=require
`);
  process.exit(1);
}

const sqlPath = join(REPO_ROOT, 'supabase', 'migrations', '001_solana_keybags.sql');
const raw = readFileSync(sqlPath, 'utf8');

/** Strip full-line -- comments, then split on semicolons. */
function statementsFromSql(sql) {
  const noLineComments = sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  return noLineComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const statements = statementsFromSql(raw);
if (statements.length === 0) {
  console.error('No SQL statements found in migration file.');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  for (let i = 0; i < statements.length; i++) {
    const st = statements[i];
    await client.query(st);
  }
  console.log('OK: solana_keybags migration applied (' + statements.length + ' statements).');
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  if (String(e).includes('already exists') || String(e).includes('duplicate')) {
    console.error('\nHint: policies/table may already exist. Safe to ignore or edit migration for idempotency.');
  }
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
