#!/usr/bin/env node
/**
 * Solana idea spark — uses Colosseum Copilot to surface whitespace and printable build prompts.
 * Requires .env with COLOSSEUM_COPILOT_PAT (and optionally COLOSSEUM_COPILOT_API_BASE).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomInt } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DEFAULT_BASE = 'https://copilot.colosseum.com/api/v1';

function loadDotEnv() {
  try {
    const p = join(ROOT, '.env');
    const text = readFileSync(p, 'utf8');
    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // .env missing — rely on process env only
  }
}

function apiBase() {
  return (process.env.COLOSSEUM_COPILOT_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
}

function bearer() {
  const t = process.env.COLOSSEUM_COPILOT_PAT;
  if (!t) {
    throw new Error(
      'Missing COLOSSEUM_COPILOT_PAT. Add it to .env (see .env.example) or export it. Token: https://arena.colosseum.org/copilot',
    );
  }
  return t;
}

let lastCopilotAt = 0;
async function throttle(ms = 400) {
  const now = Date.now();
  const wait = Math.max(0, ms - (now - lastCopilotAt));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCopilotAt = Date.now();
}

async function copilot(path, { method, body } = {}) {
  await throttle();
  const resolvedMethod = method ?? (body !== undefined ? 'POST' : 'GET');
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { Authorization: `Bearer ${bearer()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method: resolvedMethod,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || text || res.statusText;
    const err = new Error(`Copilot ${res.status}: ${msg}`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Bias toward lower-frequency problem tags by drawing from the bottom of the corpus distribution. */
function pickLowCountTags(items, k, { minCount = 1, poolCap = 36 } = {}) {
  const eligible = (items || []).filter((x) => (x.count ?? 0) >= minCount);
  if (eligible.length === 0) return [];
  const sorted = [...eligible].sort((a, b) => (a.count ?? 0) - (b.count ?? 0));
  const pool = sorted.slice(0, Math.min(sorted.length, Math.max(poolCap, k * 6)));
  shuffleInPlace(pool);
  return pool.slice(0, k);
}

function pickRandom(arr, n) {
  const a = [...arr];
  const out = [];
  while (a.length && out.length < n) {
    const i = randomInt(0, a.length);
    out.push(a.splice(i, 1)[0]);
  }
  return out;
}

function printHelp() {
  console.log(`Solana idea spark (Colosseum Copilot)

Usage:
  node scripts/solana-idea-spark.mjs status
  node scripts/solana-idea-spark.mjs tags [--limit N] [--asc]
  node scripts/solana-idea-spark.mjs spark [--count N] [--seed N]
  node scripts/solana-idea-spark.mjs gaps [--hackathons a,b,c] [--top N]
  node scripts/solana-idea-spark.mjs blend [--count N]
  node scripts/solana-idea-spark.mjs cluster [clusterKey]
  node scripts/solana-idea-spark.mjs archive "<3-6 keywords>" [--limit N]

Examples:
  npm run copilot:status
  npm run ideas:spark
  node scripts/solana-idea-spark.mjs gaps --hackathons breakout,cypherpunk,radar --top 12
  node scripts/solana-idea-spark.mjs archive "solana intent payments ux"

Notes:
  - Outputs are research prompts, not guarantees of novelty. Cross-check with a deep Copilot dive.
  - Copilot search is rate-limited; this CLI spaces requests ~400ms apart.
`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--count') out.count = Number(argv[++i]);
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--top') out.top = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--asc') out.asc = true;
    else if (a === '--hackathons') out.hackathons = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('-')) out._.push(a);
    else out._.push(a);
  }
  return out;
}

async function cmdStatus() {
  const data = await copilot('/status', { method: 'GET' });
  console.log(JSON.stringify(data, null, 2));
}

async function cmdTags(args) {
  const data = await copilot('/filters', { method: 'GET' });
  const limit = Number.isFinite(args.limit) ? args.limit : 30;
  const problems = [...(data.problemTags || [])].sort((a, b) =>
    args.asc ? (a.count ?? 0) - (b.count ?? 0) : (b.count ?? 0) - (a.count ?? 0),
  );
  console.log('problemTags (tag → count):');
  for (const row of problems.slice(0, limit)) {
    console.log(`  ${row.tag}\t${row.count}`);
  }
}

async function cmdSpark(args) {
  const count = Number.isFinite(args.count) ? Math.min(12, Math.max(1, args.count)) : 5;
  if (Number.isFinite(args.seed)) {
    console.error('Note: --seed is not implemented yet; tags are chosen randomly from the low-frequency pool.');
  }
  const filters = await copilot('/filters', { method: 'GET' });
  const tags = pickLowCountTags(filters.problemTags || [], count);
  console.log(`Generated ${tags.length} idea seeds (biased toward lower-frequency problem tags).\n`);

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i].tag;
    const search = await copilot('/search/projects', {
      body: {
        limit: 6,
        filters: { problemTags: [tag], winnersOnly: false, acceleratorOnly: false },
      },
    });
    const results = search.results || [];
    console.log(`--- ${i + 1}. Problem tag: ${tag} (corpus count ~${tags[i].count}) ---`);
    console.log(
      'Build prompt: Ship a Solana-native prototype that clearly solves this problem for a specific user; add one mechanism competitors rarely combine (UX, compliance, distribution, or composability).',
    );
    if (results.length === 0) {
      console.log('Prior art (Copilot): none returned for this tag — still verify manually.');
    } else {
      console.log('Prior art (sample submissions — study, then differentiate):');
      for (const r of results.slice(0, 5)) {
        const slug = r.slug || r.projectSlug || 'unknown-slug';
        const name = r.name || slug;
        const one = (r.oneLiner || r.description || '').replace(/\s+/g, ' ').slice(0, 140);
        console.log(`  • ${name} (\`${slug}\`)${one ? ` — ${one}` : ''}`);
      }
    }
    console.log('');
  }
}

async function cmdGaps(args) {
  const hackathons =
    args.hackathons?.length > 0
      ? args.hackathons
      : ['breakout', 'cypherpunk', 'radar', 'renaissance'];
  const topK = Number.isFinite(args.top) ? Math.min(25, Math.max(5, args.top)) : 12;

  const data = await copilot('/analyze', {
    body: {
      cohort: { hackathons, winnersOnly: false },
      dimensions: ['problemTags', 'solutionTags', 'techStack'],
      topK,
      samplePerBucket: 2,
    },
  });

  const totals = data.totals?.projects ?? 0;
  console.log(`Cohort: ${hackathons.join(', ')} — projects in analysis: ~${totals}\n`);

  for (const dim of ['problemTags', 'solutionTags', 'techStack']) {
    const buckets = data.buckets?.[dim] || [];
    if (buckets.length === 0) continue;
    const sorted = [...buckets].sort((a, b) => (a.share ?? 0) - (b.share ?? 0));
    console.log(`Underweighted ${dim} (low share in cohort — possible whitespace, not proof):`);
    for (const b of sorted.slice(0, 8)) {
      const samples = (b.sampleProjectSlugs || []).join(', ');
      console.log(
        `  ${b.label || b.key}\tshare=${((b.share ?? 0) * 100).toFixed(2)}%\tcount=${b.count}${samples ? `\tsamples: ${samples}` : ''}`,
      );
    }
    console.log('');
  }

  console.log(
    'Next step: pick one bucket and run `node scripts/solana-idea-spark.mjs spark` or a Copilot deep dive on that tag pair.',
  );
}

async function cmdBlend(args) {
  const n = Number.isFinite(args.count) ? Math.min(8, Math.max(1, args.count)) : 3;
  const f = await copilot('/filters', { method: 'GET' });

  const primitives = (f.primitives || []).filter((x) => (x.count ?? 0) >= 2);
  const targets = (f.targetUsers || []).filter((x) => (x.count ?? 0) >= 2);
  const problems = (f.problemTags || []).filter((x) => (x.count ?? 0) >= 2);

  if (primitives.length < 2 || targets.length < 2) {
    console.error('Not enough tag diversity in /filters response to blend.');
    return;
  }

  console.log(`Intersection sparks (${n} draws). Primitive × targetUser × optional problemTag.\n`);

  for (let i = 0; i < n; i++) {
    const p = primitives[randomInt(0, primitives.length)].tag;
    const t = targets[randomInt(0, targets.length)].tag;
    const pb = problems.length ? problems[randomInt(0, problems.length)].tag : null;
    const body = {
      limit: 10,
      filters: {
        primitives: [p],
        targetUsers: [t],
        ...(pb ? { problemTags: [pb] } : {}),
        winnersOnly: false,
        acceleratorOnly: false,
      },
    };
    const search = await copilot('/search/projects', { body });
    const results = search.results || [];
    console.log(`--- ${i + 1}. ${p} + ${t}${pb ? ` + problem:${pb}` : ''} — ${results.length} hits ---`);
    console.log(
      'Prompt: Design a Solana program + client where settlement/custody/policy matches this intersection; justify why Solana fees/latency matter for your user.',
    );
    for (const r of results.slice(0, 4)) {
      const slug = r.slug || r.projectSlug || 'unknown-slug';
      const name = r.name || slug;
      console.log(`  • ${name} (\`${slug}\`)`);
    }
    if (results.length <= 2) {
      console.log('  (Few hits — explore carefully; could be sparse tagging rather than a true gap.)');
    }
    console.log('');
  }
}

async function cmdCluster(args) {
  const filters = await copilot('/filters', { method: 'GET' });
  const clusters = filters.clusters || [];
  if (clusters.length === 0) {
    console.error('No clusters in /filters.');
    return;
  }
  let key = args._[1];
  if (!key) {
    const mid = clusters.filter((c) => (c.projectCount ?? 0) >= 8 && (c.projectCount ?? 0) <= 400);
    const pool = mid.length ? mid : clusters;
    key = pool[randomInt(0, pool.length)].key;
    console.log(`Picked cluster key: ${key}\n`);
  }
  const detail = await copilot(`/clusters/${encodeURIComponent(key)}`, { method: 'GET' });
  console.log(`${detail.label || key}`);
  if (detail.summary) console.log(`\n${detail.summary}\n`);
  console.log(`Projects: ${detail.projectCount ?? '?'} (winners: ${detail.winnerCount ?? '?'})\n`);
  const reps = detail.representativeProjects || [];
  if (reps.length) {
    console.log('Representative submissions:');
    for (const r of reps.slice(0, 8)) {
      console.log(`  • ${r.name} (\`${r.slug}\`)${r.oneLiner ? ` — ${r.oneLiner}` : ''}`);
    }
  }
  console.log(
    '\nPrompt: Find a sub-niche this cluster underserves (workflow, persona, or integration), then ship a narrow vertical slice on Solana.',
  );
}

async function cmdArchive(args) {
  const q = args._.slice(1).join(' ').trim();
  if (!q) {
    console.error('Usage: archive "<3-6 keywords>"');
    process.exitCode = 1;
    return;
  }
  const limit = Number.isFinite(args.limit) ? Math.min(10, Math.max(1, args.limit)) : 5;
  const data = await copilot('/search/archives', {
    body: {
      query: q,
      limit,
      maxChunksPerDoc: 2,
      intent: 'ideation',
    },
  });
  const results = data.results || [];
  console.log(`Archive search: "${q}" (tier: ${data.searchTier || '?'})\n`);
  for (const r of results) {
    console.log(`• ${r.title || 'Untitled'} (${r.source || 'source ?'})`);
    if (r.snippet) console.log(`  ${String(r.snippet).replace(/\s+/g, ' ').slice(0, 220)}…`);
    console.log(`  documentId=${r.documentId}  similarity=${r.similarity?.toFixed?.(3) ?? r.similarity}`);
    console.log('');
  }
  console.log(
    'Prompt: Translate one archive insight into a concrete Solana feature (accounts, permissions, fee payer, and failure modes).',
  );
}

async function main() {
  const argv = parseArgs(process.argv);
  if (argv.help || argv._.length === 0) {
    printHelp();
    process.exitCode = argv._.length === 0 ? 0 : 0;
    return;
  }
  loadDotEnv();
  const cmd = argv._[0];

  try {
    switch (cmd) {
      case 'status':
        await cmdStatus();
        break;
      case 'tags':
        await cmdTags(argv);
        break;
      case 'spark':
        await cmdSpark(argv);
        break;
      case 'gaps':
        await cmdGaps(argv);
        break;
      case 'blend':
        await cmdBlend(argv);
        break;
      case 'cluster':
        await cmdCluster(argv);
        break;
      case 'archive':
        await cmdArchive(argv);
        break;
      case 'help':
        printHelp();
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (e) {
    console.error(e.message || e);
    if (e.status === 401) {
      console.error('Refresh your PAT at https://arena.colosseum.org/copilot');
    }
    process.exitCode = 1;
  }
}

main();
