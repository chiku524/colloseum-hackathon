import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (web3stronghold/). */
export const REPO_ROOT = join(__dirname, '..', '..');

/**
 * Merge key=value pairs from a dotenv file into process.env (does not override existing).
 */
export function loadEnvFile(absPath) {
  if (!existsSync(absPath)) return;
  const text = readFileSync(absPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** Same as loadEnvFile but always overwrites keys present in the file. */
export function loadEnvFileOverride(absPath) {
  if (!existsSync(absPath)) return;
  const text = readFileSync(absPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

/**
 * Load apps/web Vercel-pulled env, then optional repo-root `.env.supabase.local` (overrides for secrets).
 */
export function loadSetupEnv() {
  const web = join(REPO_ROOT, 'apps', 'web');
  loadEnvFile(join(web, '.env.development.local'));
  loadEnvFile(join(web, '.env.local'));
  loadEnvFile(join(web, '.env'));
  loadEnvFile(join(REPO_ROOT, '.env.local'));
  loadEnvFileOverride(join(REPO_ROOT, '.env.supabase.local'));
}

/**
 * Extract Supabase project ref from `https://xxxxx.supabase.co`.
 */
export function projectRefFromSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.trim().match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1].toLowerCase() : null;
}
