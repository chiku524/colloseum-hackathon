#!/usr/bin/env node
/**
 * Devnet helpers using @solana/web3.js (no local solana CLI required).
 *
 * Commands:
 *   node scripts/devnet.mjs balance [ADDRESS]
 *   node scripts/devnet.mjs airdrop [ADDRESS] [SOL]   # default 1 SOL; retries on rate limits
 *
 * Env:
 *   RPC_URL          — devnet RPC (default https://api.devnet.solana.com)
 *   DEVNET_ADDRESS   — default wallet if ADDRESS omitted
 *
 * If airdrops keep failing, use the web faucet: https://faucet.solana.com/
 * Or run: npm run solana:devnet -- airdrop 2 <ADDRESS> --url https://api.devnet.solana.com
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const DEFAULT_RPC = process.env.RPC_URL || 'https://api.devnet.solana.com';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseAddress(arg, envFallback = process.env.DEVNET_ADDRESS) {
  const s = arg || envFallback;
  if (!s) {
    console.error(
      'Missing address. Pass as argument or set DEVNET_ADDRESS.\nExample:\n  node scripts/devnet.mjs airdrop 92HeixkGY1bwQPN7qChLSyktvzo6qoDiroEspNvYHB2Q 2',
    );
    process.exit(1);
  }
  try {
    return new PublicKey(s);
  } catch {
    console.error('Invalid base58 public key:', s);
    process.exit(1);
  }
}

async function cmdBalance(argv) {
  const pk = parseAddress(argv[0]);
  const c = new Connection(DEFAULT_RPC, 'confirmed');
  const lamports = await c.getBalance(pk);
  console.log('RPC:', DEFAULT_RPC);
  console.log('Address:', pk.toBase58());
  console.log('Balance:', lamports / LAMPORTS_PER_SOL, 'SOL');
}

async function requestAirdropWithRetries(connection, pubkey, lamports) {
  const maxAttempts = Number(process.env.AIRDROP_ATTEMPTS || '8');
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const sig = await connection.requestAirdrop(pubkey, lamports);
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
      return sig;
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      const code = e.code;
      const retryable =
        code === 429 ||
        /429|rate limit|Too Many Requests|Internal error|-32603/i.test(msg);
      if (!retryable || i === maxAttempts - 1) throw e;
      const wait = Math.min(120_000, 8000 * 2 ** i);
      console.error(
        `Airdrop attempt ${i + 1}/${maxAttempts} failed (${msg.slice(0, 140)}…). Waiting ${wait / 1000}s…`,
      );
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function cmdAirdrop(argv) {
  const pk = parseAddress(argv[0]);
  const sol = argv[1] != null ? Number(argv[1]) : Number(process.env.AIRDROP_SOL || '1');
  if (!Number.isFinite(sol) || sol <= 0) {
    console.error('Invalid SOL amount');
    process.exit(1);
  }
  const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
  const c = new Connection(DEFAULT_RPC, 'confirmed');
  console.log('RPC:', DEFAULT_RPC);
  console.log('Airdrop', sol, 'SOL (', lamports, 'lamports ) →', pk.toBase58());
  const sig = await requestAirdropWithRetries(c, pk, lamports);
  console.log('Signature:', sig);
  const after = await c.getBalance(pk);
  console.log('New balance:', after / LAMPORTS_PER_SOL, 'SOL');
}

function cmdHelp() {
  console.log(`Solana devnet helpers

Usage:
  node scripts/devnet.mjs balance [ADDRESS]
  node scripts/devnet.mjs airdrop [ADDRESS] [SOL]

Env:
  RPC_URL           Custom devnet RPC (Helius, QuickNode, etc.)
  DEVNET_ADDRESS    Default address for balance (optional)
  AIRDROP_ATTEMPTS  Retry count (default 8)
  AIRDROP_SOL       Default SOL for airdrop when amount omitted (default 1)

Web faucet (if RPC airdrops are rate-limited):
  https://faucet.solana.com/

Docker Solana CLI (needs Docker):
  npm run solana:devnet -- balance
  npm run solana:devnet -- airdrop 2 <ADDRESS> --url https://api.devnet.solana.com

Deploy program (after npm run build:program:docker):
  npm run devnet:deploy
`);
}

const cmd = process.argv[2] || 'help';
const rest = process.argv.slice(3);

const runners = {
  balance: () => cmdBalance(rest),
  airdrop: () => cmdAirdrop(rest),
  help: () => {
    cmdHelp();
    process.exit(0);
  },
};

const run = runners[cmd];
if (!run) {
  console.error('Unknown command:', cmd);
  cmdHelp();
  process.exit(1);
}

run().catch((e) => {
  console.error(e.message || e);
  if (/429|rate|limit/i.test(String(e.message))) {
    console.error('\nTip: open https://faucet.solana.com/ or set RPC_URL to a provider that allows airdrops.');
  }
  process.exit(1);
});
