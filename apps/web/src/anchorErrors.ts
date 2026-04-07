/** Maps creator-treasury Anchor error codes to short UI copy (IDL 6000–6035). */

const BY_CODE: Record<number, string> = {
  6000: 'Too many approvers (max 5).',
  6001: 'Invalid approval threshold.',
  6002: 'Unauthorized — wrong signer or role for this instruction.',
  6003: 'Invalid proposal.',
  6004: 'Proposal is not in the right state for this action.',
  6005: 'Timelock has not ended yet.',
  6006: 'Proposal was already executed.',
  6007: 'This approver already signed.',
  6008: 'Vault is frozen.',
  6009: 'Insufficient balance in the vault token account.',
  6010: 'Project name is too long.',
  6011: 'Proposal was cancelled.',
  6012: 'Invalid timelock configuration.',
  6013: 'Vault is not initialized.',
  6014: 'Vault was already initialized.',
  6015: 'Mint does not match the vault.',
  6016: 'Invalid vault state account.',
  6017: 'Vault token account does not match the derived ATA.',
  6018: 'Amount must be greater than zero.',
  6019: 'Invalid recipient.',
  6020: 'Recipient token account owner or mint mismatch.',
  6021: 'Team lead must be the first approver.',
  6022: 'Duplicate approver in the list.',
  6023: 'Invalid approver pubkey.',
  6024: 'Proposal id overflow.',
  6025: 'Timelock arithmetic overflow.',
  6026: 'Policy hash cannot be all zero.',
  6027: 'Policy version overflow.',
  6028: 'Artifact hash cannot be all zero.',
  6029: 'Artifact URI is too long.',
  6030: 'Artifact label is too long.',
  6031: 'Artifact is already attached to this proposal.',
  6032: 'A dispute is already open for this proposal.',
  6033: 'No active dispute on this proposal.',
  6034: 'Cannot execute while a dispute is active.',
  6035: 'This project requires an attached artifact before execute.',
};

function tipForCode(code: number): string | undefined {
  if (code === 6008) return 'Unfreeze the vault in Setup, or wait for the lead.';
  if (code === 6034) return 'Resolve the dispute (team lead) before executing.';
  if (code === 6035) return 'Attach a proposal artifact (Proposals tab) with a non-zero SHA-256.';
  if (code === 6005) return 'Wait until the timelock end time, then try again.';
  return undefined;
}

/**
 * Prefer a friendly line for program errors; pass through wallet/RPC messages otherwise.
 */
export function formatTxError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);

  const numMatch = raw.match(/Error Number:\s*(\d{4,5})\b/);
  if (numMatch) {
    const code = parseInt(numMatch[1], 10);
    const line = BY_CODE[code];
    if (line) {
      const tip = tipForCode(code);
      return tip ? `${line} ${tip}` : line;
    }
  }

  const hexMatch = raw.match(/custom program error:\s*(0x)?([0-9a-f]+)/i);
  if (hexMatch) {
    const code = parseInt(hexMatch[2], 16);
    if (code >= 6000 && code <= 6100) {
      const line = BY_CODE[code];
      if (line) {
        const tip = tipForCode(code);
        return tip ? `${line} ${tip}` : line;
      }
    }
  }

  return raw;
}
