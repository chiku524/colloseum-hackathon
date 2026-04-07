#!/usr/bin/env node
/**
 * Writes apps/web/.env.vercel.paste — import this file in Vercel:
 *   Project → Settings → Environment Variables → "Import .env"
 *
 * Select environments: Production, Preview, Development (as needed).
 * Redeploy after saving so Vite picks up VITE_* at build time.
 *
 * Usage: node scripts/generate-vercel-paste-env.mjs
 *
 * Optional env:
 *   CRANK_TEAM_LEAD — base58 (defaults: derive from keys/devnet-payer.json if present)
 *   CRANK_PROJECT_ID — default 999 (same as treasury-seed.mjs)
 *
 * If keys/crank-fee-devnet.json exists, CRANK_FEE_PAYER_JSON is included (fund that key on-cluster).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const out = path.join(root, 'apps', 'web', '.env.vercel.paste');

const hex = (bytes) => randomBytes(bytes).toString('hex');

const programId = 'BYZFRa7NzDB7bKwxxkntewHfWwjBBqM6nsfrVeakBHjV';
const devnetRpc = 'https://api.devnet.solana.com';

function defaultTeamLead() {
  const p = path.join(root, 'keys', 'devnet-payer.json');
  try {
    const secret = JSON.parse(readFileSync(p, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey.toBase58();
  } catch {
    return '';
  }
}

const crankTeamLead = (process.env.CRANK_TEAM_LEAD || defaultTeamLead()).trim();
const crankProjectId = (process.env.CRANK_PROJECT_ID || '999').trim();
const crankKeyPath = path.join(root, 'keys', 'crank-fee-devnet.json');
let crankFeeJson = '';
try {
  const arr = JSON.parse(readFileSync(crankKeyPath, 'utf8'));
  if (Array.isArray(arr)) {
    crankFeeJson = JSON.stringify(arr);
  }
} catch {
  /* optional file */
}

// Vercel "Import .env" works best without comment lines in the file body.
const lines = [
  `VITE_RPC_URL=${devnetRpc}`,
  `VITE_PROGRAM_ID=${programId}`,
  `SOLANA_RPC_URL=${devnetRpc}`,
  `TREASURY_API_SECRET=${hex(32)}`,
  `JWT_EMBED_SECRET=${hex(32)}`,
  `WEBHOOK_SIGNING_SECRET=${hex(32)}`,
  `CRON_SECRET=${hex(32)}`,
];

if (crankTeamLead) {
  lines.push(`CRANK_TEAM_LEAD=${crankTeamLead}`);
  lines.push(`CRANK_PROJECT_ID=${crankProjectId}`);
}
if (crankFeeJson) {
  lines.push(`CRANK_FEE_PAYER_JSON=${crankFeeJson}`);
}

const body = `${lines.join('\n')}\n`;

writeFileSync(out, body, 'utf8');
console.log(`Wrote ${out}`);
console.log('Next: Vercel → Settings → Environment Variables → Import .env → choose this file.');
if (!crankTeamLead) {
  console.log('Note: set CRANK_TEAM_LEAD (or add keys/devnet-payer.json) to include crank env lines.');
}
if (!crankFeeJson) {
  console.log('Note: add keys/crank-fee-devnet.json (see .gitignore) to include CRANK_FEE_PAYER_JSON.');
}
