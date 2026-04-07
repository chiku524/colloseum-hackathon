import type { PolicySplit, TreasuryPolicy } from './policy';

/** Each non-empty line: `payee_pubkey_or_label,bps` (comma-separated). */
export function splitsFromCsv(csvText: string): PolicySplit[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  const splits: PolicySplit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 2) {
      throw new Error(`Line ${i + 1}: expected "payee,bps"`);
    }
    const payee = parts[0];
    const bps = Number(parts[1]);
    if (!payee) throw new Error(`Line ${i + 1}: empty payee`);
    if (!Number.isFinite(bps) || !Number.isInteger(bps)) {
      throw new Error(`Line ${i + 1}: bps must be an integer`);
    }
    splits.push({ payee, bps });
  }
  if (splits.length === 0) throw new Error('No rows parsed from CSV');
  return splits;
}

export function mergeSplitsIntoPolicy(p: TreasuryPolicy, csvText: string): TreasuryPolicy {
  const splits = splitsFromCsv(csvText);
  return { ...p, splits };
}
