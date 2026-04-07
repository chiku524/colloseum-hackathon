/** Best-effort label for the Solana cluster implied by an RPC URL (for UI only). */
export function inferClusterLabel(rpcEndpoint: string): string {
  const u = rpcEndpoint.toLowerCase();
  if (u.includes('devnet')) return 'Devnet';
  if (u.includes('mainnet-beta') || u.includes('api.mainnet-beta')) return 'Mainnet';
  if (u.includes('testnet')) return 'Testnet';
  if (u.includes('localhost') || u.includes('127.0.0.1')) return 'Local';
  return 'Custom RPC';
}
