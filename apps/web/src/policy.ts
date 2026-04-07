export type PolicySplit = { payee: string; bps: number };

export type TreasuryPolicyV1 = {
  schema: 'creator_treasury.policy/v1';
  splits: PolicySplit[];
  holdbackBps: number;
  defaultTimelockSecs: number;
  allowedMints?: string[];
};

export function defaultPolicy(teamLead: string): TreasuryPolicyV1 {
  return {
    schema: 'creator_treasury.policy/v1',
    splits: [{ payee: teamLead, bps: 10_000 }],
    holdbackBps: 0,
    defaultTimelockSecs: 86_400,
  };
}

/** Well-known program IDs used only as stand-ins in demo templates — replace with real payees before production. */
const DEMO_PAYEE_A = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const DEMO_PAYEE_B = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const DEMO_PAYEE_C = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** Four equal splits (25% each). `payees` must be four distinct base58 pubkeys. */
export function templateFourWaySquad(
  a: string,
  b: string,
  c: string,
  d: string,
): TreasuryPolicyV1 {
  return {
    schema: 'creator_treasury.policy/v1',
    splits: [
      { payee: a, bps: 2500 },
      { payee: b, bps: 2500 },
      { payee: c, bps: 2500 },
      { payee: d, bps: 2500 },
    ],
    holdbackBps: 0,
    defaultTimelockSecs: 86_400,
  };
}

/**
 * Demo “creator squad”: you as lead + three protocol addresses as placeholders.
 * Replace placeholder payees with collaborators before applying on-chain.
 */
export function templateDemoFourWaySquad(teamLead: string): TreasuryPolicyV1 {
  return templateFourWaySquad(teamLead, DEMO_PAYEE_A, DEMO_PAYEE_B, DEMO_PAYEE_C);
}

/** Lead + contractor split with 10% holdback (3500 + 5500 + 1000). */
export function templateSponsorMilestone(lead: string, contractor: string): TreasuryPolicyV1 {
  return {
    schema: 'creator_treasury.policy/v1',
    splits: [
      { payee: lead, bps: 3500 },
      { payee: contractor, bps: 5500 },
    ],
    holdbackBps: 1000,
    defaultTimelockSecs: 604_800,
  };
}

/** Sponsor-style split with `DEMO_PAYEE_A` standing in for the contractor. */
export function templateDemoSponsorMilestone(teamLead: string): TreasuryPolicyV1 {
  return templateSponsorMilestone(teamLead, DEMO_PAYEE_A);
}

const MAX_SHARE_URL_CHARS = 1950;

/** Base64 (URL-safe not required; we use encodeURIComponent on the param) policy payload for `?view=simulate&p=`. */
export function encodePolicyQueryParam(p: TreasuryPolicyV1): string {
  const bad = validatePolicy(p);
  if (bad) throw new Error(bad);
  const json = canonicalPolicyJson(p);
  if (json.length > 12_000) throw new Error('Policy JSON is too large to share in a URL.');
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  if (b64.length > MAX_SHARE_URL_CHARS) {
    throw new Error('Encoded policy is too large for a reliable share link; reduce splits or fields.');
  }
  return b64;
}

export function decodePolicyFromQueryParam(b64: string): TreasuryPolicyV1 {
  const trimmed = b64.trim();
  if (!trimmed) throw new Error('Empty policy parameter.');
  let json: string;
  try {
    const bin = atob(trimmed);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    json = new TextDecoder().decode(bytes);
  } catch {
    throw new Error('Invalid base64 in policy parameter p.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Policy parameter is not valid JSON.');
  }
  const v = validatePolicy(raw as TreasuryPolicyV1);
  if (v) throw new Error(v);
  return raw as TreasuryPolicyV1;
}

export function validatePolicy(p: TreasuryPolicyV1): string | null {
  if (p.schema !== 'creator_treasury.policy/v1') return 'Invalid schema';
  if (!Array.isArray(p.splits) || p.splits.length === 0 || p.splits.length > 20) {
    return 'Invalid splits (1–20 rows)';
  }
  let sum = 0;
  for (const s of p.splits) {
    if (!s.payee?.trim()) return 'Empty payee';
    if (s.bps < 0 || s.bps > 10_000) return 'bps must be 0–10000';
    sum += s.bps;
  }
  if (p.holdbackBps < 0 || p.holdbackBps > 10_000) return 'holdbackBps must be 0–10000';
  if (sum + p.holdbackBps > 10_000) return 'sum(splits.bps) + holdbackBps must be ≤ 10000';
  if (p.defaultTimelockSecs < 0 || p.defaultTimelockSecs > 30 * 24 * 3600) {
    return 'defaultTimelockSecs out of bounds (max 30d)';
  }
  return null;
}

export function canonicalPolicyJson(p: TreasuryPolicyV1): string {
  const sortedMints = p.allowedMints ? [...p.allowedMints].sort() : undefined;
  const sortedSplits = [...p.splits].sort((a, b) => a.payee.localeCompare(b.payee));
  const norm: TreasuryPolicyV1 = {
    schema: 'creator_treasury.policy/v1',
    splits: sortedSplits,
    holdbackBps: p.holdbackBps,
    defaultTimelockSecs: p.defaultTimelockSecs,
    ...(sortedMints?.length ? { allowedMints: sortedMints } : {}),
  };
  return JSON.stringify(norm);
}

export async function sha256BytesUtf8(s: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(digest);
}

export function hex32(u: Uint8Array): string {
  return [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type SimLine = { payee: string; amount: bigint };

export function simulatePayout(
  depositAtoms: bigint,
  p: TreasuryPolicyV1,
): { lines: SimLine[]; holdback: bigint; remainder: bigint } {
  const err = validatePolicy(p);
  if (err) throw new Error(err);
  const holdback = (depositAtoms * BigInt(p.holdbackBps)) / 10_000n;
  const pool = depositAtoms - holdback;
  const lines: SimLine[] = [];
  let paid = 0n;
  for (const s of p.splits) {
    const amt = (pool * BigInt(s.bps)) / 10_000n;
    lines.push({ payee: s.payee, amount: amt });
    paid += amt;
  }
  const remainder = pool - paid;
  return { lines, holdback, remainder };
}

export function simpleLineDiff(a: string, b: string): string {
  const al = a.split('\n');
  const bl = b.split('\n');
  const out: string[] = [];
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    const x = al[i] ?? '';
    const y = bl[i] ?? '';
    if (x === y) out.push(`  ${x}`);
    else {
      out.push(`- ${x}`);
      out.push(`+ ${y}`);
    }
  }
  return out.join('\n');
}
