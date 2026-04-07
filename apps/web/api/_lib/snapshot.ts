import type { Idl } from '@coral-xyz/anchor';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import { hex32 } from './hex';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadIdl(): Idl & { address: string } {
  const candidates = [
    join(__dirname, '../idl.json'),
    join(__dirname, '../../../idl/creator_treasury.json'),
    join(process.cwd(), 'api', 'idl.json'),
    join(process.cwd(), 'idl/creator_treasury.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf8')) as Idl & { address: string };
    }
  }
  throw new Error('creator_treasury IDL not found (run npm run prebuild in apps/web).');
}

const idlJson = loadIdl();
const idl = idlJson as Idl;
const PROGRAM_ID = new PublicKey(idlJson.address);

const STATUS_NAMES = ['Pending', 'Timelock', 'Executed', 'Cancelled'] as const;

function statusLabel(code: number): string {
  return STATUS_NAMES[code] ?? `Unknown(${code})`;
}

function readOnlyProvider(connection: Connection): AnchorProvider {
  const w = {
    publicKey: PublicKey.unique(),
    signTransaction: async <T extends Parameters<AnchorProvider['wallet']['signTransaction']>[0]>(tx: T) => tx,
    signAllTransactions: async <T extends Parameters<AnchorProvider['wallet']['signAllTransactions']>[0][number]>(
      txs: T[],
    ) => txs,
  };
  return new AnchorProvider(connection, w as AnchorProvider['wallet'], { commitment: 'confirmed' });
}

export type ProposalSnapshotJson = {
  proposalId: string;
  amount: string;
  recipient: string;
  status: string;
  statusCode: number;
  artifactSha256Hex: string;
  disputeActive: boolean;
};

export type ProjectSnapshotJson = {
  projectPda: string;
  teamLead: string;
  projectId: string;
  policyVersion: number;
  policyHashHex: string;
  frozen: boolean;
  requireArtifactForExecute: boolean;
  vaultInitialized: boolean;
  vaultBalance?: string;
  mint?: string;
  proposals: ProposalSnapshotJson[];
  rpcUsed: string;
  programId: string;
};

export async function buildProjectSnapshot(
  teamLeadStr: string,
  projectIdStr: string,
  rpcUrl: string,
): Promise<ProjectSnapshotJson> {
  const teamLeadPk = new PublicKey(teamLeadStr.trim());
  const projectIdBn = BigInt(projectIdStr.trim());
  if (projectIdBn < 0n) throw new Error('project_id must be non-negative');

  const idBuf = Buffer.allocUnsafe(8);
  idBuf.writeBigUInt64LE(projectIdBn, 0);
  const [projectPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('project'), teamLeadPk.toBuffer(), idBuf],
    PROGRAM_ID,
  );

  const connection = new Connection(rpcUrl, 'confirmed');
  const provider = readOnlyProvider(connection);
  const program = new Program(idl, provider);

  // @ts-expect-error account namespace
  const acc = await program.account.project.fetchNullable(projectPda);
  if (!acc) {
    throw new Error(`No project account at PDA ${projectPda.toBase58()}`);
  }

  const hashHex = hex32(Uint8Array.from(acc.policyHash as number[]));
  let vaultBalance: string | undefined;
  let mint: string | undefined;
  if (acc.vaultInitialized) {
    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), projectPda.toBuffer()],
      PROGRAM_ID,
    );
    // @ts-expect-error account namespace
    const vs = await program.account.vaultState.fetch(vaultState);
    mint = vs.mint.toBase58();
    const ata = getAssociatedTokenAddressSync(vs.mint, vaultState, true);
    const bal = await connection.getTokenAccountBalance(ata);
    vaultBalance = bal.value.uiAmountString ?? bal.value.amount;
  }

  const nextProp = Number(acc.nextProposalId);
  const proposalRows: ProposalSnapshotJson[] = [];
  for (let i = 0; i < nextProp; i++) {
    const pidBuf = Buffer.allocUnsafe(8);
    pidBuf.writeBigUInt64LE(BigInt(i), 0);
    const [propPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('proposal'), projectPda.toBuffer(), pidBuf],
      PROGRAM_ID,
    );
    // @ts-expect-error account namespace
    const prop = await program.account.releaseProposal.fetchNullable(propPda);
    if (!prop) continue;
    const st = Number(prop.status);
    proposalRows.push({
      proposalId: String(i),
      amount: prop.amount.toString(),
      recipient: prop.recipient.toBase58(),
      status: statusLabel(st),
      statusCode: st,
      artifactSha256Hex: hex32(Uint8Array.from(prop.artifactSha256 as number[])),
      disputeActive: Boolean(prop.disputeActive),
    });
  }

  return {
    projectPda: projectPda.toBase58(),
    teamLead: acc.teamLead.toBase58(),
    projectId: acc.projectId.toString(),
    policyVersion: acc.policyVersion as number,
    policyHashHex: hashHex,
    frozen: Boolean(acc.frozen),
    requireArtifactForExecute: Boolean(acc.requireArtifactForExecute),
    vaultInitialized: acc.vaultInitialized as boolean,
    vaultBalance,
    mint,
    proposals: proposalRows,
    rpcUsed: rpcUrl,
    programId: PROGRAM_ID.toBase58(),
  };
}
