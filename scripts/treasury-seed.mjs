#!/usr/bin/env node
/**
 * End-to-end demo seed: optional new SPL mint, project, vault, policy, deposit.
 *
 * Usage:
 *   npm run seed:treasury                 # localnet (http://127.0.0.1:8899)
 *   npm run seed:treasury -- --devnet     # devnet + airdrop if balance low
 *
 * Env: RPC_URL, KEYPAIR_PATH (default ~/.config/solana/id.json), PROJECT_ID (default 999), DEPOSIT_ATOMS (default 1000000)
 *
 * Requires: deployed program matching idl/creator_treasury.json (same as `anchor deploy`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import anchor from '@coral-xyz/anchor';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';

const { AnchorProvider, BN, Program, Wallet } = anchor;
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
} from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function argFlag(name) {
  return process.argv.includes(name);
}

function rpcUrl(devnet) {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  return devnet ? clusterApiUrl('devnet') : 'http://127.0.0.1:8899';
}

function loadKeypair() {
  const p = process.env.KEYPAIR_PATH || path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (!fs.existsSync(p)) {
    throw new Error(`Missing keypair at ${p}. Set KEYPAIR_PATH or create a wallet (solana-keygen new).`);
  }
  const secret = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function ensureSol(connection, pubkey, devnet) {
  const bal = await connection.getBalance(pubkey);
  if (bal >= 1.5 * LAMPORTS_PER_SOL) return;
  if (!devnet) {
    console.error('Payer needs SOL; on localnet run: solana airdrop 5', pubkey.toBase58());
    process.exit(1);
  }
  const sig = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest });
  console.log('Requested devnet airdrop');
}

async function main() {
  const devnet = argFlag('--devnet');
  const rpc = rpcUrl(devnet);
  const projectId = new BN(process.env.PROJECT_ID || '999');
  const depositAtoms = new BN(process.env.DEPOSIT_ATOMS || '1000000');

  const payer = loadKeypair();
  const connection = new Connection(rpc, 'confirmed');
  console.log('RPC:', rpc);
  console.log('Payer:', payer.publicKey.toBase58());

  await ensureSol(connection, payer.publicKey, devnet);

  const idl = JSON.parse(fs.readFileSync(path.join(root, 'idl', 'creator_treasury.json'), 'utf8'));
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(idl, provider);

  const [projectPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('project'), payer.publicKey.toBuffer(), projectId.toArrayLike(Buffer, 'le', 8)],
    program.programId,
  );

  const existingProject = await program.account.project.fetchNullable(projectPda);
  if (!existingProject) {
    await program.methods
      .initializeProject(projectId, Buffer.from('seed-demo', 'utf8'), [payer.publicKey], 1)
      .accounts({
        payer: payer.publicKey,
        teamLead: payer.publicKey,
        project: projectPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();
    console.log('initialize_project →', projectPda.toBase58());
  } else {
    console.log('Project already exists:', projectPda.toBase58());
  }

  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), projectPda.toBuffer()],
    program.programId,
  );

  let mint;
  const vaultInfo = await connection.getAccountInfo(vaultState);
  if (!vaultInfo) {
    mint = await createMint(connection, payer, payer.publicKey, null, 6);
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);
    await program.methods
      .initializeVault()
      .accounts({
        payer: payer.publicKey,
        teamLead: payer.publicKey,
        project: projectPda,
        mint,
        vaultState,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();
    console.log('initialize_vault, mint:', mint.toBase58());
  } else {
    const vs = await program.account.vaultState.fetch(vaultState);
    mint = vs.mint;
    console.log('Vault already initialized; using mint', mint.toBase58());
  }

  const proj = await program.account.project.fetch(projectPda);
  const ph = Array.from(proj.policyHash);
  const hashUnset = ph.every((b) => b === 0);
  if (Number(proj.policyVersion) === 0 && hashUnset) {
    const policyHash = Array.from({ length: 32 }, (_, i) => (i === 0 ? 11 : 0));
    await program.methods
      .setPolicy(policyHash)
      .accounts({ teamLead: payer.publicKey, project: projectPda })
      .signers([payer])
      .rpc();
    console.log('set_policy (initial)');
  }

  const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);
  const depositorAta = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey)).address;
  await mintTo(connection, payer, mint, depositorAta, payer, 10_000_000n);

  await program.methods
    .deposit(depositAtoms)
    .accounts({
      depositor: payer.publicKey,
      project: projectPda,
      vaultState,
      vaultTokenAccount: vaultAta,
      depositorTokenAccount: depositorAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([payer])
    .rpc();

  console.log('deposit', depositAtoms.toString(), 'token atoms');
  console.log('\nSummary');
  console.log('  project PDA:', projectPda.toBase58());
  console.log('  project_id:', projectId.toString());
  console.log('  mint:', mint.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
