#!/usr/bin/env node
/**
 * Configure hosted Supabase Auth to use Resend SMTP via Management API.
 *
 * Prerequisites:
 *   - Personal access token: https://supabase.com/dashboard/account/tokens
 *   - Resend: domain verified, API key created
 *
 * Env (required):
 *   SUPABASE_ACCESS_TOKEN — Account token (not eyJ… project JWT)
 *   RESEND_API_KEY — Resend API key (or set SMTP_PASS instead)
 *
 * Env (optional):
 *   SUPABASE_PROJECT_REF — if not inferrable from VITE_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SMTP_SENDER_EMAIL — default noreply@web3stronghold.app
 *   SUPABASE_SMTP_SENDER_NAME — default web3stronghold
 *   SUPABASE_SMTP_HOST — default smtp.resend.com
 *   SUPABASE_SMTP_PORT — default 465 (string)
 *   SUPABASE_SMTP_USER — default resend
 *   SMTP_PASS — alternative to RESEND_API_KEY (not printed)
 *
 * Usage (from repo root, after vercel env pull or with .env.supabase.local):
 *   RESEND_API_KEY=re_... SUPABASE_ACCESS_TOKEN=sbp_... npm run setup:supabase-smtp-resend
 *
 * Docs: https://supabase.com/docs/reference/api/v1-patch-project-auth-config
 * Resend: https://resend.com/docs/send-with-supabase-smtp
 */
import { loadSetupEnv, projectRefFromSupabaseUrl } from './lib/load-dotenv-files.mjs';

loadSetupEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const ref =
  process.env.SUPABASE_PROJECT_REF?.trim() ||
  projectRefFromSupabaseUrl(process.env.VITE_PUBLIC_SUPABASE_URL || '') ||
  projectRefFromSupabaseUrl(process.env.VITE_SUPABASE_URL || '');

const resendKey = (process.env.RESEND_API_KEY || process.env.SMTP_PASS || '').trim();
const senderEmail = (process.env.SUPABASE_SMTP_SENDER_EMAIL || 'noreply@web3stronghold.app').trim();
const senderName = (process.env.SUPABASE_SMTP_SENDER_NAME || 'web3stronghold').trim();
const smtpHost = (process.env.SUPABASE_SMTP_HOST || 'smtp.resend.com').trim();
const smtpPort = String(process.env.SUPABASE_SMTP_PORT || '465').trim();
const smtpUser = (process.env.SUPABASE_SMTP_USER || 'resend').trim();

if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)');
  process.exit(1);
}

if (token.startsWith('eyJ')) {
  console.error(`Wrong token: use a personal access token (sbp_...), not a project JWT (eyJ...).`);
  process.exit(1);
}

if (!ref) {
  console.error(
    'Set SUPABASE_PROJECT_REF or VITE_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL (https://xxx.supabase.co)',
  );
  process.exit(1);
}

if (!resendKey) {
  console.error('Set RESEND_API_KEY (or SMTP_PASS) to your Resend API key.');
  process.exit(1);
}

const body = {
  smtp_admin_email: senderEmail,
  smtp_host: smtpHost,
  smtp_port: smtpPort,
  smtp_user: smtpUser,
  smtp_pass: resendKey,
  smtp_sender_name: senderName,
};

const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`;

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
  - Fine-grained tokens need permission to update Auth config (e.g. auth_config / project settings write).
  - Confirm the domain and sender email in Resend (sender must be on a verified domain).
  - If port 465 fails in your region/UI, try SUPABASE_SMTP_PORT=587 (see Resend docs).
  - Or set SMTP in the dashboard: Authentication → Email → SMTP settings
`);
  process.exit(1);
}

console.log('OK: Supabase Auth SMTP updated for Resend.');
console.log('  project ref:', ref);
console.log('  smtp_host:', smtpHost);
console.log('  smtp_port:', smtpPort);
console.log('  smtp_user:', smtpUser);
console.log('  smtp_admin_email:', senderEmail);
console.log('  smtp_sender_name:', senderName);
console.log('  (smtp_pass not shown)');
if (typeof json === 'object' && json !== null && Object.keys(json).length > 0) {
  const out = JSON.stringify(json, null, 2);
  console.log('  response (truncated):', out.length > 1500 ? `${out.slice(0, 1500)}…` : out);
}
