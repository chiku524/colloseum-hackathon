import type { ProposalSnapshot } from './auditExport';

export type TreasuryFlowMetrics = {
  /** Current SPL token balance in the vault ATA (atomic units). */
  inVault: bigint;
  /** Sum of `released_so_far` across all proposals (tokens sent via execute_release). */
  disbursedViaProposals: bigint;
  /** Remaining approved caps: non-cancelled proposals, amount minus released_so_far. */
  outstandingCommitted: bigint;
  /** inVault + outstandingCommitted + disbursedViaProposals — coherent if no automation outflows. */
  totalAttributable: bigint;
};

const STATUS_CANCELLED = 3;

/**
 * Derive treasury flow figures from the vault ATA and release proposals.
 * Does not include split-crank automation (those transfers are not reflected in proposals).
 */
export function computeTreasuryFlowMetrics(
  proposals: ProposalSnapshot[],
  vaultAmountRaw: string | undefined,
  vaultInitialized: boolean,
): TreasuryFlowMetrics {
  const inVault =
    vaultInitialized && vaultAmountRaw !== undefined && vaultAmountRaw !== '' ? BigInt(vaultAmountRaw) : 0n;

  let disbursedViaProposals = 0n;
  let outstandingCommitted = 0n;

  for (const p of proposals) {
    const cap = BigInt(p.amount);
    const released = BigInt(p.releasedSoFar);
    disbursedViaProposals += released;
    if (p.statusCode !== STATUS_CANCELLED) {
      outstandingCommitted += cap > released ? cap - released : 0n;
    }
  }

  const totalAttributable = inVault + outstandingCommitted + disbursedViaProposals;

  return {
    inVault,
    disbursedViaProposals,
    outstandingCommitted,
    totalAttributable,
  };
}

/** Format SPL raw amount (no scientific notation). */
export function formatTokenAtoms(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  if (frac === 0n) return `${neg ? '-' : ''}${whole}`;
  let fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  if (!fracStr) return `${neg ? '-' : ''}${whole}`;
  return `${neg ? '-' : ''}${whole}.${fracStr}`;
}

export function fractionPercent(part: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}
