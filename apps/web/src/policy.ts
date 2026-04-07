export type PolicySplit = { payee: string; bps: number };

/** Legacy schema; still accepted for import and hashing. */
export type TreasuryPolicyV1 = {
  schema: 'creator_treasury.policy/v1';
  splits: PolicySplit[];
  holdbackBps: number;
  defaultTimelockSecs: number;
  allowedMints?: string[];
};

export type PolicyAutomationV2 = {
  mode: 'none' | 'planned_crank';
  /** Documentary until a crank instruction exists on-chain. */
  notes?: string;
};

export type PolicyWorkflowV2 = {
  templateId?: string;
  /** Short label shown in the UI (not executed on-chain). */
  title?: string;
  /** UI hint: enable artifact gate in Setup for milestone-style escrow. */
  suggestArtifactGate?: boolean;
  /** When true, the dapp blocks propose_release to recipients not listed in splits. */
  payoutRecipientsMustBePolicyPayees?: boolean;
};

/** Current schema: v1 payout math + optional workflow / automation metadata for UX and audit. */
export type TreasuryPolicyV2 = {
  schema: 'creator_treasury.policy/v2';
  splits: PolicySplit[];
  holdbackBps: number;
  defaultTimelockSecs: number;
  allowedMints?: string[];
  workflow?: PolicyWorkflowV2;
  automation?: PolicyAutomationV2;
  /** Plain-language summary for humans (not executed on-chain). */
  documentation?: string;
};

export type TreasuryPolicy = TreasuryPolicyV1 | TreasuryPolicyV2;

export const TIMELOCK_PRESETS = [
  { label: 'No delay', secs: 0 },
  { label: '1 hour', secs: 3600 },
  { label: '24 hours', secs: 86_400 },
  { label: '7 days', secs: 604_800 },
  { label: '30 days', secs: 2_592_000 },
] as const;

export function isPolicyV1(p: TreasuryPolicy): p is TreasuryPolicyV1 {
  return p.schema === 'creator_treasury.policy/v1';
}

export function isPolicyV2(p: TreasuryPolicy): p is TreasuryPolicyV2 {
  return p.schema === 'creator_treasury.policy/v2';
}

export function v1ToV2(p: TreasuryPolicyV1): TreasuryPolicyV2 {
  const w: TreasuryPolicyV2 = {
    schema: 'creator_treasury.policy/v2',
    splits: p.splits.map((s) => ({ ...s })),
    holdbackBps: p.holdbackBps,
    defaultTimelockSecs: p.defaultTimelockSecs,
    ...(p.allowedMints?.length ? { allowedMints: [...p.allowedMints] } : {}),
    workflow: { templateId: 'imported_v1', title: 'Imported v1 policy' },
  };
  return w;
}

export function defaultPolicy(teamLead: string): TreasuryPolicyV2 {
  return {
    schema: 'creator_treasury.policy/v2',
    splits: [{ payee: teamLead, bps: 10_000 }],
    holdbackBps: 0,
    defaultTimelockSecs: 86_400,
    workflow: {
      templateId: 'single_lead',
      title: 'Single wallet (team lead)',
      suggestArtifactGate: false,
      payoutRecipientsMustBePolicyPayees: false,
    },
    automation: { mode: 'none' },
  };
}

/** Well-known program IDs used only as stand-ins in demo templates — replace with real payees before production. */
const DEMO_PAYEE_A = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const DEMO_PAYEE_B = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const DEMO_PAYEE_C = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** Four equal splits (25% each). `payees` must be four distinct base58 pubkeys. */
export function templateFourWaySquad(a: string, b: string, c: string, d: string): TreasuryPolicyV2 {
  return {
    schema: 'creator_treasury.policy/v2',
    splits: [
      { payee: a, bps: 2500 },
      { payee: b, bps: 2500 },
      { payee: c, bps: 2500 },
      { payee: d, bps: 2500 },
    ],
    holdbackBps: 0,
    defaultTimelockSecs: 86_400,
    workflow: {
      templateId: 'four_way_squad',
      title: 'Equal four-way split',
      suggestArtifactGate: false,
      payoutRecipientsMustBePolicyPayees: true,
    },
    automation: { mode: 'none' },
    documentation: 'Revenue-style split across four wallets; releases still go per proposal.',
  };
}

/**
 * Demo “creator squad”: you as lead + three protocol addresses as placeholders.
 * Replace placeholder payees with collaborators before applying on-chain.
 */
export function templateDemoFourWaySquad(teamLead: string): TreasuryPolicyV2 {
  return templateFourWaySquad(teamLead, DEMO_PAYEE_A, DEMO_PAYEE_B, DEMO_PAYEE_C);
}

/** Lead + contractor split with 10% holdback (3500 + 5500 + 1000). */
export function templateSponsorMilestone(lead: string, contractor: string): TreasuryPolicyV2 {
  return {
    schema: 'creator_treasury.policy/v2',
    splits: [
      { payee: lead, bps: 3500 },
      { payee: contractor, bps: 5500 },
    ],
    holdbackBps: 1000,
    defaultTimelockSecs: 604_800,
    workflow: {
      templateId: 'milestone_escrow',
      title: 'Milestone escrow (sponsor + contractor)',
      suggestArtifactGate: true,
      payoutRecipientsMustBePolicyPayees: true,
    },
    automation: { mode: 'none' },
    documentation:
      'Typical escrow: team lead and contractor are policy payees; propose_release pays a chosen milestone; attach artifact hash before execute when artifact gate is on.',
  };
}

/** Sponsor-style split with `DEMO_PAYEE_A` standing in for the contractor. */
export function templateDemoSponsorMilestone(teamLead: string): TreasuryPolicyV2 {
  return templateSponsorMilestone(teamLead, DEMO_PAYEE_A);
}

/** Two-way equal split (50/50). */
export function templateEqualDuo(a: string, b: string): TreasuryPolicyV2 {
  return {
    schema: 'creator_treasury.policy/v2',
    splits: [
      { payee: a, bps: 5000 },
      { payee: b, bps: 5000 },
    ],
    holdbackBps: 0,
    defaultTimelockSecs: 86_400,
    workflow: {
      templateId: 'equal_duo',
      title: '50/50 duo',
      suggestArtifactGate: false,
      payoutRecipientsMustBePolicyPayees: true,
    },
    automation: { mode: 'none' },
  };
}

const MAX_SHARE_URL_CHARS = 1950;
const MAX_DOC_LEN = 4000;
const MAX_WORKFLOW_TITLE = 200;
const MAX_TEMPLATE_ID = 64;
const MAX_AUTOMATION_NOTES = 500;

function validateCoreSplitsAndTimelock(p: {
  splits: PolicySplit[];
  holdbackBps: number;
  defaultTimelockSecs: number;
}): string | null {
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

function validateWorkflowOptional(w: PolicyWorkflowV2 | undefined): string | null {
  if (!w) return null;
  if (w.templateId != null && w.templateId.length > MAX_TEMPLATE_ID) return 'workflow.templateId too long';
  if (w.title != null && w.title.length > MAX_WORKFLOW_TITLE) return 'workflow.title too long';
  return null;
}

function validateV2Extras(p: TreasuryPolicyV2): string | null {
  if (p.documentation != null && p.documentation.length > MAX_DOC_LEN) {
    return 'documentation too long (max 4000 chars)';
  }
  const wErr = validateWorkflowOptional(p.workflow);
  if (wErr) return wErr;
  if (p.automation) {
    if (p.automation.mode !== 'none' && p.automation.mode !== 'planned_crank') {
      return 'automation.mode must be none or planned_crank';
    }
    if (p.automation.notes != null && p.automation.notes.length > MAX_AUTOMATION_NOTES) {
      return 'automation.notes too long';
    }
  }
  return null;
}

export function validatePolicy(p: TreasuryPolicy): string | null {
  if (isPolicyV1(p)) {
    if (p.schema !== 'creator_treasury.policy/v1') return 'Invalid schema';
    const c = validateCoreSplitsAndTimelock(p);
    if (c) return c;
    if (p.allowedMints) {
      for (const m of p.allowedMints) {
        if (!m?.trim()) return 'Empty allowedMint entry';
      }
    }
    return null;
  }
  if (isPolicyV2(p)) {
    if (p.schema !== 'creator_treasury.policy/v2') return 'Invalid schema';
    const c = validateCoreSplitsAndTimelock(p);
    if (c) return c;
    if (p.allowedMints) {
      for (const m of p.allowedMints) {
        if (!m?.trim()) return 'Empty allowedMint entry';
      }
    }
    return validateV2Extras(p);
  }
  return 'Unknown policy schema';
}

export function canonicalPolicyJson(p: TreasuryPolicy): string {
  if (isPolicyV1(p)) {
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

  const sortedMints = p.allowedMints ? [...p.allowedMints].sort() : undefined;
  const sortedSplits = [...p.splits].sort((a, b) => a.payee.localeCompare(b.payee));
  const wf = p.workflow;
  const workflowCanon = wf
    ? {
        ...(wf.payoutRecipientsMustBePolicyPayees != null
          ? { payoutRecipientsMustBePolicyPayees: wf.payoutRecipientsMustBePolicyPayees }
          : {}),
        ...(wf.suggestArtifactGate != null ? { suggestArtifactGate: wf.suggestArtifactGate } : {}),
        ...(wf.templateId != null ? { templateId: wf.templateId } : {}),
        ...(wf.title != null ? { title: wf.title } : {}),
      }
    : undefined;
  const auto = p.automation;
  const automationCanon = auto
    ? {
        mode: auto.mode,
        ...(auto.notes != null && auto.notes.length > 0 ? { notes: auto.notes } : {}),
      }
    : undefined;
  const norm: TreasuryPolicyV2 = {
    schema: 'creator_treasury.policy/v2',
    splits: sortedSplits,
    holdbackBps: p.holdbackBps,
    defaultTimelockSecs: p.defaultTimelockSecs,
    ...(sortedMints?.length ? { allowedMints: sortedMints } : {}),
    ...(workflowCanon && Object.keys(workflowCanon).length > 0 ? { workflow: workflowCanon } : {}),
    ...(automationCanon ? { automation: automationCanon } : {}),
    ...(p.documentation != null && p.documentation.trim().length > 0
      ? { documentation: p.documentation.trim() }
      : {}),
  };
  return JSON.stringify(norm);
}

/** Base64 policy payload for `?view=simulate&p=`. */
export function encodePolicyQueryParam(p: TreasuryPolicy): string {
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

export function decodePolicyFromQueryParam(b64: string): TreasuryPolicy {
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
  const v = validatePolicy(raw as TreasuryPolicy);
  if (v) throw new Error(v);
  return raw as TreasuryPolicy;
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
  p: TreasuryPolicy,
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

/** Distinct payee pubkeys from splits (order preserved). */
export function policyPayeePubkeys(p: TreasuryPolicy): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of p.splits) {
    const k = s.payee.trim();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export function isRecipientAllowedByPolicy(p: TreasuryPolicy, recipientBase58: string): boolean {
  const w = isPolicyV2(p) ? p.workflow : undefined;
  if (!w?.payoutRecipientsMustBePolicyPayees) return true;
  const r = recipientBase58.trim();
  return p.splits.some((s) => s.payee.trim() === r);
}

export function policyDefaultTimelockSecs(p: TreasuryPolicy): number {
  return p.defaultTimelockSecs;
}

export function policySuggestArtifactGate(p: TreasuryPolicy): boolean {
  return isPolicyV2(p) && Boolean(p.workflow?.suggestArtifactGate);
}

export function parsePolicyJson(
  text: string,
): { ok: true; policy: TreasuryPolicy } | { ok: false; error: string } {
  try {
    const raw = JSON.parse(text) as unknown;
    const v = validatePolicy(raw as TreasuryPolicy);
    if (v) return { ok: false, error: v };
    return { ok: true, policy: raw as TreasuryPolicy };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

/** Normalize to v2 for the visual editor (v1 becomes v2 with workflow metadata). */
export function toPolicyV2ForEdit(p: TreasuryPolicy): TreasuryPolicyV2 {
  return isPolicyV1(p) ? v1ToV2(p) : p;
}
