#!/usr/bin/env node
/**
 * Apply supabase/migrations/001_solana_keybags.sql and 002_solana_keybags_grants.sql using node-postgres (works on Windows).
 *
 * Connection string (first non-empty wins):
 *   STRONGHOLD_APPLY_KEYBAGS_URL — if set, used exclusively (e.g. scripts/supabase-interactive.sh on Git Bash Windows)
 *   SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL_NON_POOLING, POSTGRES_URL, POSTGRES_PRISMA_URL
 *
 * Env is loaded from apps/web/.env.development.local (vercel pull) and optional repo .env.supabase.local.
 *
 * Direct db.<ref>.supabase.co is often IPv6-only; IPv4-only Windows may see ENOTFOUND. With SUPABASE_ACCESS_TOKEN
 * set (e.g. in .env.supabase.local), this script can fall back to the IPv4 session pooler via Management API.
 *
 * Usage: npm run setup:apply-keybags
 *        node scripts/apply-solana-keybags.mjs --migrate-via-psql   # resolve with pg, run SQL file via psql
 */
import dns from 'node:dns';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { loadSetupEnv, REPO_ROOT } from './lib/load-dotenv-files.mjs';

/** Prefer IPv4 when both exist (some Windows networks mis-handle IPv6 for Postgres). */
dns.setDefaultResultOrder('ipv4first');

loadSetupEnv();

const applyKeybagsUrl = process.env.STRONGHOLD_APPLY_KEYBAGS_URL?.trim();

const candidates = applyKeybagsUrl
  ? [applyKeybagsUrl]
  : [
      process.env.SUPABASE_DB_URL,
      process.env.DATABASE_URL,
      process.env.POSTGRES_URL_NON_POOLING,
      process.env.POSTGRES_URL,
      process.env.POSTGRES_PRISMA_URL,
    ].filter(Boolean);

let connectionString = candidates[0];
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

/** Quiets pg v8 sslmode deprecation warning when URLs use sslmode=require. */
function ensureLibpqCompatParam(cs) {
  const s = cs.trim();
  if (/uselibpqcompat\s*=/i.test(s)) return s;
  return s.includes('?') ? `${s}&uselibpqcompat=true` : `${s}?uselibpqcompat=true`;
}

connectionString = ensureLibpqCompatParam(connectionString);

/** Applied in order; 002 is idempotent grants for the Data API + authenticated role. */
const MIGRATION_FILES = ['001_solana_keybags.sql', '002_solana_keybags_grants.sql'];
const migrationsDir = join(REPO_ROOT, 'supabase', 'migrations');
const migrateViaPsql = process.argv.includes('--migrate-via-psql');

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

if (!migrateViaPsql) {
  for (const name of MIGRATION_FILES) {
    const raw = readFileSync(join(migrationsDir, name), 'utf8');
    const stmts = statementsFromSql(raw);
    if (stmts.length === 0) {
      console.error(`No SQL statements found in migration file: ${name}`);
      process.exit(1);
    }
  }
}

/** Supabase / pooler TLS chains often fail Node's default verification; match by hostname too (Vercel URLs vary). */
function sslOptionForConnectionString(cs) {
  let host = '';
  try {
    host = new URL(cs.trim().replace(/^postgres(ql)?:/i, 'http:')).hostname;
  } catch {
    /* ignore */
  }
  if (
    host &&
    (/\.supabase\.co$/i.test(host) ||
      /\.supabase\.com$/i.test(host) ||
      /\.supabase\.in$/i.test(host) ||
      /pooler\.supabase\.com$/i.test(host))
  ) {
    return { rejectUnauthorized: false };
  }
  if (/supabase\.(co|com)|pooler\.supabase\.com/i.test(cs)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

function parsePostgresUrl(cs) {
  const normalized = cs.trim().replace(/^postgres(ql)?:/i, 'http:');
  const u = new URL(normalized);
  const database = (u.pathname || '/postgres').replace(/^\//, '') || 'postgres';
  return {
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    host: u.hostname,
    port: Number(u.port) || 5432,
    database,
  };
}

function isDnsConnectFailure(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /ENOTFOUND|getaddrinfo|EAI_AGAIN|Name or service not known/i.test(msg);
}

/** @returns {Promise<string | null>} AWS-style region slug e.g. eu-central-1 */
async function fetchSupabaseProjectRegion(projectRef) {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) return null;
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const r = data?.region;
  if (typeof r !== 'string' || !r) return null;
  return r.replace(/_/g, '-');
}

/**
 * Replace password in a dashboard-style URI (handles [YOUR-PASSWORD] and similar).
 * Always applies `password` so the interactive script’s value wins.
 * Supavisor session pooler requires username `postgres.<project_ref>`; the Management API template often uses plain `postgres`.
 */
function injectPasswordIntoPoolerUri(uri, password, projectRef) {
  const u = new URL(uri.trim().replace(/^postgres(ql)?:/i, 'http:'));
  u.password = password;
  const ref = projectRef?.toLowerCase?.() || projectRef;
  if (ref && /pooler\.supabase\.com$/i.test(u.hostname)) {
    let user = '';
    try {
      user = decodeURIComponent((u.username || '').replace(/\+/g, '%20'));
    } catch {
      user = u.username || '';
    }
    if (user === 'postgres' || user === '') {
      console.warn(
        `Pooler URI used user "${user || '(empty)'}"; using postgres.${ref} for Supavisor session mode.`,
      );
      u.username = `postgres.${ref}`;
    }
  }
  return `postgresql:${u.href.slice('http:'.length)}`;
}

/** Shared pooler hostname pattern; some projects use aws-1-*, not aws-0-*. */
function buildSessionPoolerConnectionString(ref, password, region, shardPrefix = 'aws-0') {
  const reg = region.replace(/_/g, '-');
  const enc = encodeURIComponent(password);
  return `postgresql://postgres.${ref}:${enc}@${shardPrefix}-${reg}.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true`;
}

function normalizePoolerApiBody(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.poolers)) return body.poolers;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

/**
 * Session-mode URI from Management API, or built from db_host/db_user when connectionString is omitted.
 * @returns {{ uri: string | null, detail: string }}
 */
async function fetchSessionPoolerUriFromApi(projectRef, password) {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    return { uri: null, detail: 'SUPABASE_ACCESS_TOKEN not set' };
  }
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/database/pooler`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  );
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    return { uri: null, detail: `pooler API non-JSON (${res.status}): ${text.slice(0, 80)}` };
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      console.warn(
        'Pooler API returned 401/403 — use a personal access token with project access, or add database_pooling_config_read for fine-grained tokens.',
      );
    }
    return { uri: null, detail: `pooler API HTTP ${res.status}: ${text.slice(0, 120)}` };
  }
  const rows = normalizePoolerApiBody(body);
  if (rows.length === 0) {
    return { uri: null, detail: 'pooler API returned no rows (empty array or unexpected JSON shape)' };
  }

  const modeStr = (r) => String(r.pool_mode || r.mode || '').toLowerCase();
  const sessionRow = rows.find((r) => modeStr(r) === 'session');
  const raw =
    sessionRow?.connectionString ||
    sessionRow?.connection_string ||
    sessionRow?.connectionStringUri;

  if (typeof raw === 'string' && raw.trim()) {
    return {
      uri: ensureLibpqCompatParam(injectPasswordIntoPoolerUri(raw, password, projectRef)),
      detail: 'connectionString from session pool_mode row (username fixed for pooler if needed)',
    };
  }

  /** Shared Supavisor host: session uses port 5432; transaction row often has the same db_host on 6543. */
  const withHost =
    sessionRow ||
    rows.find((r) => /pooler\.supabase\.com/i.test(String(r.db_host || r.dbHost || ''))) ||
    rows[0];
  const host = withHost?.db_host || withHost?.dbHost;
  /** Session mode always uses postgres.<project_ref>; API transaction rows often report db_user "postgres". */
  const sessionUser = `postgres.${projectRef}`;
  if (typeof host === 'string' && host.includes('.')) {
    const enc = encodeURIComponent(password);
    const cs = ensureLibpqCompatParam(
      `postgresql://${encodeURIComponent(sessionUser)}:${enc}@${host}:5432/postgres?sslmode=require`,
    );
    return {
      uri: cs,
      detail: `built session URI from db_host=${host} user=${sessionUser}`,
    };
  }

  return {
    uri: null,
    detail: `no connectionString or db_host in pooler rows (pool_mode values: ${rows.map((r) => r.pool_mode || r.mode || '?').join(', ')})`,
  };
}

function logTargetLine(label, cs) {
  try {
    const u = new URL(cs.replace(/^postgres(ql)?:/i, 'http:'));
    console.warn(`Trying ${label} → ${u.hostname}:${u.port || 5432} user=${u.username}`);
  } catch {
    console.warn(`Trying ${label}…`);
  }
}

/** Try API-provided session URI, then aws-0-REGION and aws-1-REGION guesses. */
async function trySessionPoolerClients(projectRef, password) {
  const urls = [];
  const api = await fetchSessionPoolerUriFromApi(projectRef, password);
  if (api.uri) {
    urls.push({ label: 'Session pooler (Management API)', cs: api.uri });
  } else {
    console.warn(`Management API pooler: ${api.detail}`);
  }
  const region = await fetchSupabaseProjectRegion(projectRef);
  if (region) {
    for (const shard of ['aws-0', 'aws-1']) {
      urls.push({
        label: `guess ${shard}-${region}.pooler.supabase.com`,
        cs: buildSessionPoolerConnectionString(projectRef, password, region, shard),
      });
    }
  }
  const seen = new Set();
  for (const { label, cs } of urls) {
    if (seen.has(cs)) continue;
    seen.add(cs);
    logTargetLine(label, cs);
    const c2 = new pg.Client({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await c2.connect();
      return c2;
    } catch (err) {
      await c2.end().catch(() => {});
      console.warn(`  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

/** When Windows / corporate DNS returns NXDOMAIN for db.*.supabase.co, public DoH often still resolves it. */
async function resolveHostViaPublicDns(hostname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    for (const type of ['A', 'AAAA']) {
      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`;
      const res = await fetch(url, {
        headers: { accept: 'application/dns-json' },
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const j = await res.json();
      if (j.Status !== 0) continue;
      const want = type === 'A' ? 1 : 28;
      const rec = j.Answer?.find((a) => a.type === want && a.data);
      if (rec?.data) {
        return { address: rec.data.trim(), ipv6: type === 'AAAA' };
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return null;
}

function sslForIpConnect(cs, hostname) {
  const base = sslOptionForConnectionString(cs);
  if (base) {
    return { ...base, servername: hostname };
  }
  if (/sslmode=(require|prefer|verify)/i.test(cs)) {
    return { rejectUnauthorized: false, servername: hostname };
  }
  if (/\.supabase\.(co|com)$/i.test(hostname) || /pooler\.supabase\.com$/i.test(hostname)) {
    return { rejectUnauthorized: false, servername: hostname };
  }
  return undefined;
}

async function createConnectedClient(cs) {
  const ssl = sslOptionForConnectionString(cs);
  const clientOpts = ssl ? { connectionString: cs, ssl } : { connectionString: cs };
  let client = new pg.Client(clientOpts);
  try {
    await client.connect();
    return client;
  } catch (e) {
    await client.end().catch(() => {});
    const errStr = String(e);
    if (
      !ssl &&
      /certificate|self-signed|SSL/i.test(errStr) &&
      /supabase|pooler\.supabase/i.test(cs)
    ) {
      console.warn('Retrying with relaxed TLS verification (Supabase-style connection string).');
      const cTls = new pg.Client({
        connectionString: cs,
        ssl: { rejectUnauthorized: false },
      });
      await cTls.connect();
      return cTls;
    }
    if (!isDnsConnectFailure(e)) {
      throw e;
    }
    let parsed;
    try {
      parsed = parsePostgresUrl(cs);
    } catch {
      throw e;
    }

    const directRef = parsed.host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1];
    if (directRef) {
      console.warn(
        `Direct host ${parsed.host} uses IPv6-only DNS on many networks; trying IPv4 session pooler first…`,
      );
      if (process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
        const pooled = await trySessionPoolerClients(directRef, parsed.password);
        if (pooled) {
          return pooled;
        }
        console.warn(
          'Session pooler attempts failed. Copy the exact "Session mode" URI from Supabase → Connect, set SUPABASE_DB_URL (or STRONGHOLD_APPLY_KEYBAGS_URL), and re-run.',
        );
      } else {
        console.warn(
          'Tip: set SUPABASE_ACCESS_TOKEN (PAT) or paste the Session mode URI into SUPABASE_DB_URL — see docs/SUPABASE-AUTH.md.',
        );
      }
    }

    const resolved = await resolveHostViaPublicDns(parsed.host);
    if (!resolved) {
      console.error(
        `Could not resolve "${parsed.host}" with system DNS or Cloudflare DNS-over-HTTPS.`,
      );
      console.error(
        'Supabase direct connections are IPv6-only unless you use the session pooler or IPv4 add-on. See docs/SUPABASE-AUTH.md.',
      );
      throw e;
    }
    if (resolved.ipv6 && process.platform === 'win32') {
      throw new Error(
        'IPv4-only Windows cannot reach Supabase direct DB (IPv6 only). Session pooler failed — add SUPABASE_ACCESS_TOKEN to .env.supabase.local (or paste when prompted), or set SUPABASE_DB_URL to the Session URI from Supabase → Connect.',
      );
    }
    console.warn(
      `Note: system DNS failed for ${parsed.host}; connecting to ${resolved.address} (public DNS-over-HTTPS). TLS SNI: ${parsed.host}.`,
    );
    const ipSsl = sslForIpConnect(cs, parsed.host);
    client = new pg.Client({
      host: resolved.address,
      port: parsed.port,
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
      ...(ipSsl ? { ssl: ipSsl } : {}),
    });
    await client.connect();
    return client;
  }
}

/** @param {import('pg').Client} client */
function partsFromPgClient(client) {
  const p = client.connectionParameters;
  return {
    host: p.host,
    port: Number(p.port) || 5432,
    user: p.user,
    password: p.password,
    database: p.database || 'postgres',
  };
}

function escapePgPassField(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

/**
 * Run migration file with psql (libpq), using a temp .pgpass file (avoids shell quoting issues).
 */
function runPsqlMigrationFile(parts, fileAbs) {
  const passFile = join(tmpdir(), `stronghold-pgpass-${process.pid}-${Date.now()}`);
  const line = `${escapePgPassField(parts.host)}:${parts.port}:${escapePgPassField(parts.database)}:${escapePgPassField(parts.user)}:${escapePgPassField(parts.password)}\n`;
  writeFileSync(passFile, line, { encoding: 'utf8', mode: 0o600 });
  try {
    const env = {
      ...process.env,
      PGPASSFILE: passFile,
      PGSSLMODE: 'require',
    };
    const args = [
      '-w',
      '-h',
      parts.host,
      '-p',
      String(parts.port),
      '-U',
      parts.user,
      '-d',
      parts.database,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      fileAbs,
    ];
    const r = spawnSync('psql', args, {
      stdio: 'inherit',
      env,
      windowsHide: true,
    });
    if (r.error) {
      throw r.error;
    }
    if (r.status !== 0) {
      throw new Error(`psql exited with code ${r.status ?? 'unknown'}`);
    }
  } finally {
    try {
      unlinkSync(passFile);
    } catch {
      /* ignore */
    }
  }
}

async function migrateThroughPsqlThenDisconnect(cs, fileAbs) {
  const client = await createConnectedClient(cs);
  const parts = partsFromPgClient(client);
  await client.end().catch(() => {});
  runPsqlMigrationFile(parts, fileAbs);
}

let client;
let exitCode = 0;
try {
  if (migrateViaPsql) {
    for (const name of MIGRATION_FILES) {
      const fileAbs = join(migrationsDir, name);
      await migrateThroughPsqlThenDisconnect(connectionString, fileAbs);
      console.log(`OK: applied ${name} (psql -f).`);
    }
    console.log('OK: all keybags migrations applied.');
  } else {
    client = await createConnectedClient(connectionString);
    let totalStatements = 0;
    for (const name of MIGRATION_FILES) {
      const raw = readFileSync(join(migrationsDir, name), 'utf8');
      const statements = statementsFromSql(raw);
      for (let i = 0; i < statements.length; i++) {
        const st = statements[i];
        await client.query(st);
      }
      totalStatements += statements.length;
      console.log(`OK: ${name} (${statements.length} statements).`);
    }
    console.log('OK: all keybags migrations applied (' + totalStatements + ' statements total).');
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  const es = String(e);
  if (es.includes('self-signed certificate') || es.includes('certificate')) {
    console.error(
      '\nHint: for Supabase, prefer SUPABASE_DB_URL / Session URI from the dashboard, or ensure the host is *.supabase.co / *.pooler.supabase.com so TLS verification is relaxed.',
    );
  }
  if (es.includes('already exists') || es.includes('duplicate')) {
    console.error('\nHint: policies/table may already exist. Safe to ignore or edit migration for idempotency.');
  }
  exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
process.exitCode = exitCode;
