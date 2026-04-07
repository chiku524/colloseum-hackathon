export type ProposalSnapshot = {
  proposalPda: string;
  proposalId: string;
  amount: string;
  recipient: string;
  timelockDurationSecs: string;
  timelockEndsAt: string;
  approvedMask: number;
  status: string;
  statusCode: number;
  policyVersionAtProposal: number;
  artifactSha256Hex: string;
  artifactUri: string;
  artifactLabel: string;
  linkedMilestoneId: string;
  disputeActive: boolean;
};

export type AuditPackage = {
  exportedAt: string;
  rpc: string;
  programId: string;
  projectPda: string;
  teamLead: string;
  projectId: string;
  policyVersion: number;
  policyHashHex: string;
  frozen: boolean;
  requireArtifactForExecute: boolean;
  vaultInitialized: boolean;
  mint?: string;
  vaultBalance?: string;
  proposals: ProposalSnapshot[];
};

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function proposalsToCsv(rows: ProposalSnapshot[]): string {
  const header = [
    'proposal_id',
    'status',
    'amount',
    'recipient',
    'timelock_duration_secs',
    'timelock_ends_at',
    'approved_mask',
    'policy_version_at_proposal',
    'artifact_sha256_hex',
    'artifact_uri',
    'artifact_label',
    'linked_milestone_id',
    'dispute_active',
    'proposal_pda',
  ].join(',');
  const lines = rows.map((p) =>
    [
      p.proposalId,
      p.status,
      p.amount,
      p.recipient,
      p.timelockDurationSecs,
      p.timelockEndsAt,
      String(p.approvedMask),
      String(p.policyVersionAtProposal),
      p.artifactSha256Hex,
      escapeCsvCell(p.artifactUri),
      escapeCsvCell(p.artifactLabel),
      p.linkedMilestoneId,
      String(p.disputeActive),
      p.proposalPda,
    ].join(','),
  );
  return [header, ...lines].join('\r\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
