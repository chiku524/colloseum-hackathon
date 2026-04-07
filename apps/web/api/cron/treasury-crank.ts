import type { Idl } from '@coral-xyz/anchor';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadIdl(): Idl & { address: string } {
  const p = join(__dirname, '../idl.json');
  return JSON.parse(readFileSync(p, 'utf8')) as Idl & { address: string };
}

/**
 * Vercel Cron: calls `crank_automation` for one configured project.
 *
 * Env (all required to actually send a tx):
 * - CRANK_TEAM_LEAD, CRANK_PROJECT_ID — same as the team dashboard / public status.
 * - CRANK_FEE_PAYER_JSON — byte array JSON of a funded keypair (devnet: small SOL for fees only).
 * - SOLANA_RPC_URL — cluster for that project.
 *
 * Optional: CRON_SECRET — if set, require `Authorization: Bearer <CRON_SECRET>` (Vercel sets this when you add CRON_SECRET in project env).
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const teamLeadStr = process.env.CRANK_TEAM_LEAD?.trim();
  const projectIdStr = process.env.CRANK_PROJECT_ID?.trim();
  const kpJson = process.env.CRANK_FEE_PAYER_JSON?.trim();
  const rpc = process.env.SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com';

  if (!teamLeadStr || !projectIdStr || !kpJson) {
    res.status(200).json({
      ok: false,
      skipped: true,
      reason: 'Set CRANK_TEAM_LEAD, CRANK_PROJECT_ID, and CRANK_FEE_PAYER_JSON to enable cron cranks.',
    });
    return;
  }

  let feePayer: Keypair;
  try {
    const arr = JSON.parse(kpJson) as unknown;
    if (!Array.isArray(arr)) throw new Error('not an array');
    feePayer = Keypair.fromSecretKey(Uint8Array.from(arr.map((n: unknown) => Number(n))));
  } catch {
    res.status(500).json({ error: 'Invalid CRANK_FEE_PAYER_JSON (expect [1,2,...] secret key bytes).' });
    return;
  }

  try {
    const idlJson = loadIdl();
    const idl = idlJson as Idl;
    const programId = new PublicKey(idlJson.address);
    const connection = new Connection(rpc, 'confirmed');
    const wallet = new Wallet(feePayer);
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl, provider);

    const teamLeadPk = new PublicKey(teamLeadStr);
    const idBuf = Buffer.allocUnsafe(8);
    idBuf.writeBigUInt64LE(BigInt(projectIdStr), 0);
    const [projectPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('project'), teamLeadPk.toBuffer(), idBuf],
      programId,
    );

    const proj = (await program.account.project.fetch(projectPda)) as Record<string, unknown>;
    const mode = Number(proj.automationMode ?? proj.automation_mode ?? 0);
    const paused = Boolean(proj.automationPaused ?? proj.automation_paused);
    const rawCount = proj.autoRecipientCount ?? proj.auto_recipient_count;
    const count =
      rawCount && typeof rawCount === 'object' && 'toNumber' in rawCount
        ? (rawCount as { toNumber: () => number }).toNumber()
        : Number(rawCount ?? 0);

    if (mode !== 1 || paused || count <= 0) {
      res.status(200).json({
        ok: false,
        skipped: true,
        reason: 'Automation not active, paused, or no recipients configured on-chain.',
        projectPda: projectPda.toBase58(),
      });
      return;
    }

    const recipientsRaw = (proj.autoRecipients ?? proj.auto_recipients) as PublicKey[];
    const recipientOwners: PublicKey[] = [];
    for (let i = 0; i < count; i++) {
      const pk = recipientsRaw[i];
      if (!pk) break;
      recipientOwners.push(pk instanceof PublicKey ? pk : new PublicKey(pk as string));
    }

    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), projectPda.toBuffer()],
      programId,
    );
    const vs = await program.account.vaultState.fetch(vaultState);
    const mint = vs.mint as PublicKey;
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);

    const remainingAccounts = recipientOwners.map((owner) => ({
      pubkey: getAssociatedTokenAddressSync(mint, owner, true),
      isWritable: true,
      isSigner: false,
    }));

    const sig = await program.methods
      .crankAutomation()
      .accounts({
        executor: feePayer.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();

    res.status(200).json({ ok: true, signature: sig, projectPda: projectPda.toBase58() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(200).json({ ok: false, error: msg });
  }
}
