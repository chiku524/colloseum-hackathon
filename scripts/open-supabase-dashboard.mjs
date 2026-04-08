#!/usr/bin/env node
/**
 * Open useful Supabase dashboard pages for this project (browser).
 *
 * Env: SUPABASE_PROJECT_REF or VITE_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL
 *
 * Usage:
 *   npm run setup:supabase-open
 *   npm run setup:supabase-open -- sql
 *   npm run setup:supabase-open -- auth
 *
 * Targets: sql | auth | all (default: all)
 */
import { spawn } from 'node:child_process';
import { loadSetupEnv, projectRefFromSupabaseUrl } from './lib/load-dotenv-files.mjs';

loadSetupEnv();

const ref =
  process.env.SUPABASE_PROJECT_REF?.trim() ||
  projectRefFromSupabaseUrl(process.env.VITE_PUBLIC_SUPABASE_URL || '') ||
  projectRefFromSupabaseUrl(process.env.VITE_SUPABASE_URL || '');

if (!ref) {
  console.error('Set SUPABASE_PROJECT_REF or pull VITE_PUBLIC_SUPABASE_URL into apps/web/.env.development.local');
  process.exit(1);
}

const target = (process.argv[2] || 'all').toLowerCase();
const urls = [];

if (target === 'all' || target === 'sql') {
  urls.push(`https://supabase.com/dashboard/project/${ref}/sql/new`);
}
if (target === 'all' || target === 'auth') {
  urls.push(`https://supabase.com/dashboard/project/${ref}/auth/url-configuration`);
}
if (target === 'settings') {
  urls.push(`https://supabase.com/dashboard/project/${ref}/settings/general`);
}

if (urls.length === 0) {
  console.error('Unknown target. Use: sql | auth | settings | all');
  process.exit(1);
}

function openUrl(u) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [u], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'win32') {
    spawn('powershell', ['-NoProfile', '-Command', `Start-Process '${u.replace(/'/g, "''")}'`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    spawn('xdg-open', [u], { detached: true, stdio: 'ignore' }).unref();
  }
}

for (const u of urls) {
  console.log('Open:', u);
  openUrl(u);
}
