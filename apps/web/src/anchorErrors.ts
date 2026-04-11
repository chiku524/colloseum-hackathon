/** Maps creator-treasury Anchor error codes to plain-language UI copy (IDL 6000–6053). */

const BY_CODE: Record<number, string> = {
  6000: 'You can only list up to five people who can approve payouts.',
  6001: 'The “how many approvals” number does not match your team setup.',
  6002: 'This wallet is not allowed to do that step — check you are signed in with the right role.',
  6003: 'That payout request is missing or does not belong to this project.',
  6004: 'This action does not match where that payout request is in its lifecycle (e.g. already finished or waiting on something else).',
  6005: 'The waiting period after approval is not over yet.',
  6006: 'That payout request has already been fully processed.',
  6007: 'This wallet already approved this request.',
  6008: 'Payouts are paused for this vault (emergency stop is on).',
  6009: 'There is not enough of this token in the vault to cover this action.',
  6010: 'Team name is too long — shorten it and try again.',
  6011: 'That payout request was cancelled.',
  6012: 'The wait-time setting for this request is not valid.',
  6013: 'The vault is not set up yet — finish vault setup first.',
  6014: 'The vault is already set up for this project.',
  6015: 'The token you picked does not match the token this vault uses.',
  6016: 'Something is wrong with the vault record on-chain.',
  6017: 'The vault’s token account does not match what the program expects (try refreshing or check the deployment).',
  6018: 'Enter an amount greater than zero.',
  6019: 'The recipient wallet address is not valid for this action.',
  6020: 'The recipient’s token account does not match this coin — they may need the same token in their wallet.',
  6021: 'The team lead’s wallet must be first in the approver list.',
  6022: 'The same approver wallet appears more than once.',
  6023: 'One of the approver wallet addresses is not valid.',
  6024: 'Too many payout requests for the program counter — contact support if this was unexpected.',
  6025: 'The wait-time value overflowed — pick a smaller wait time.',
  6026: 'Rules must have a real fingerprint before saving — try validating again.',
  6027: 'Rules version overflow — contact support if this was unexpected.',
  6028: 'Delivery proof fingerprint cannot be empty.',
  6029: 'The file link is too long.',
  6030: 'The short label for the proof is too long.',
  6031: 'A delivery proof is already attached to this payout request.',
  6032: 'A dispute is already open on this payout request.',
  6033: 'There is no open dispute on this payout request.',
  6034: 'You cannot send money on this request while a dispute is open.',
  6035: 'This team requires a delivery proof before money can be sent.',
  6036: 'That payment amount is more than what is still allowed on this request.',
  6037: 'You cannot cancel this request after money has already been sent from it.',
  6038: 'Project data on-chain looks wrong or outdated for this action — try upgrading layout (Setup) or refreshing.',
  6039: 'The project number in this action does not match the project you loaded.',
  6040: 'That automation mode is not supported.',
  6041: 'Automation wallets or share points are set up incorrectly.',
  6042: 'Automation can send to at most eight wallets at once.',
  6043: 'Automation wait time between runs must be greater than zero.',
  6044: 'When automation is on, the max amount per run must be greater than zero.',
  6045: 'Automation share points (out of 10,000) are invalid or do not add up correctly.',
  6046: 'Automatic payouts are not turned on for this project.',
  6047: 'Automatic payouts are paused — unpause in Setup.',
  6048: 'It is not time for the next automatic run yet — wait and try again.',
  6049: 'Extra accounts for automation are missing or in the wrong order (one token account per recipient).',
  6050: 'A team-lead handoff is already waiting — cancel it or have the invited wallet complete it.',
  6051: 'No team-lead handoff is pending right now.',
  6052: 'The connected wallet is not the one invited for the handoff — switch to the pending wallet.',
  6053: 'That wallet cannot be used as the new team lead (invalid or already on the approver list).',
};

function tipForCode(code: number): string | undefined {
  if (code === 6008) return 'Team lead can resume payouts under Setup → Emergency pause.';
  if (code === 6034) return 'Team lead should close the dispute first (Proposals → Proof & disputes).';
  if (code === 6035) return 'Add a delivery proof with a real fingerprint on the Proposals tab.';
  if (code === 6005) return 'Check back after the wait time you set when creating the request.';
  if (code === 6036) return 'Try a smaller amount or send exactly what is left on the request.';
  if (code === 6037) return 'If money already moved, cancelling is no longer available.';
  if (code === 6009) return 'Deposit more tokens, or lower the payout amount.';
  if (code === 6013) return 'Open Setup and turn the vault on for your token.';
  if (code === 6020) return 'Recipient may need to receive this token once in their wallet first.';
  if (code === 6048) return 'Automatic runs respect a schedule — wait for the next eligible time.';
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
    if (code >= 6000 && code <= 6053) {
      const line = BY_CODE[code];
      if (line) {
        const tip = tipForCode(code);
        return tip ? `${line} ${tip}` : line;
      }
    }
  }

  return raw;
}
