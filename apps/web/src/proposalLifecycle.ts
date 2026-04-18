import type { ProposalSnapshot } from './auditExport';

/** Count how many approver bits are set in `approvedMask` (up to `approverCount` slots). */
export function countApprovalsFromMask(mask: number, approverCount: number): number {
  let n = 0;
  const cap = Math.min(Math.max(approverCount, 0), 5);
  for (let i = 0; i < cap; i++) {
    if (mask & (1 << i)) n += 1;
  }
  return n;
}

export type LifecyclePhase = 'propose' | 'approve' | 'timelock' | 'execute' | 'cancelled';

/** Which phase is currently highlighted for a proposal (for the lifecycle UI). */
export function phaseForProposal(
  p: ProposalSnapshot,
  approvalThreshold: number,
  approverCount: number,
): LifecyclePhase {
  if (p.statusCode === 3) return 'cancelled';
  if (p.statusCode === 2) return 'execute';
  if (p.statusCode === 1) return 'timelock';
  const got = countApprovalsFromMask(p.approvedMask, approverCount);
  if (got < approvalThreshold) return 'approve';
  return 'timelock';
}
