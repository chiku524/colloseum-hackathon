#!/usr/bin/env node
/**
 * PATCH Supabase Auth config (Site URL + redirect allow list) via Management API.
 *
 * Prerequisites:
 *   1. Create a personal access token: https://supabase.com/dashboard/account/tokens
 *   2. Token needs permission to update project auth config (organization / project owner).
 *
 * Env:
 *   SUPABASE_ACCESS_TOKEN  (required) — Bearer token for https://api.supabase.com
 *   SUPABASE_PROJECT_REF   (optional if VITE_PUBLIC_SUPABASE_URL or VITE_SUPABASE_URL is set)
 *   SUPABASE_SITE_URL      (default http://localhost:5173)
 *   SUPABASE_URI_ALLOW_LIST — comma-separated extra redirect URLs (optional; site URL is always included)
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run setup:supabase-auth-urls
 *   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_SITE_URL=https://myapp.vercel.app npm run setup:supabase-auth-urls
 */
import { loadSetupEnv, projectRefFromSupabaseUrl } from './lib/load-dotenv-files.mjs';

loadSetupEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const ref =
  process.env.SUPABASE_PROJECT_REF?.trim() ||
  projectRefFromSupabaseUrl(process.env.VITE_PUBLIC_SUPABASE_URL || '') ||
  projectRefFromSupabaseUrl(process.env.VITE_SUPABASE_URL || '');

const siteUrl = (process.env.SUPABASE_SITE_URL || 'http://localhost:5173').trim().replace(/\/$/, '');

const extra = (process.env.SUPABASE_URI_ALLOW_LIST || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

const allowSet = new Set([siteUrl, ...extra]);
const uriAllowList = [...allowSet].join(',');

if (!token) {
  console.error(`Set SUPABASE_ACCESS_TOKEN (from https://supabase.com/dashboard/account/tokens )`);
  process.exit(1);
}

if (token.startsWith('eyJ')) {
  console.error(`Wrong token type: value looks like a Supabase project JWT (anon or service_role key).

The Management API needs a **personal access token** from your **Supabase account**, not from Vercel env:
  1. Open https://supabase.com/dashboard/account/tokens
  2. Generate new token (may look like sbp_... or a long opaque string — not eyJ...)

Then:
  SUPABASE_ACCESS_TOKEN=<that token> npm run setup:supabase-auth-urls

Or set URLs manually: Dashboard → Authentication → URL configuration
`);
  process.exit(1);
}

if (!ref) {
  console.error(
    `Set SUPABASE_PROJECT_REF or VITE_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL (e.g. https://xxxxx.supabase.co)`,
  );
  process.exit(1);
}

const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const body = {
  site_url: siteUrl,
  uri_allow_list: uriAllowList,
};

const res = await fetch(url, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = text;
}

if (!res.ok) {
  console.error('Request failed:', res.status, res.statusText);
  console.error(typeof json === 'string' ? json : JSON.stringify(json, null, 2));
  console.error(`
Hints:
  - Use a token from Account → Access tokens with access to this project.
  - Fine-grained tokens may need "Auth" / project config write scopes.
  - If PATCH is rejected, set URLs manually: Dashboard → Authentication → URL configuration
`);
  process.exit(1);
}

console.log('OK: Supabase Auth URLs updated.');
console.log('  site_url:', siteUrl);
console.log('  uri_allow_list:', uriAllowList);
if (typeof json === 'object' && json !== null && Object.keys(json).length > 0) {
  console.log('  response:', JSON.stringify(json, null, 2).slice(0, 2000));
}
