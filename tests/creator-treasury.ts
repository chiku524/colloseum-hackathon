import type { Idl } from '@coral-xyz/anchor';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { assert } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';

const idl = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../idl/creator_treasury.json'), 'utf8'),
) as Idl;

describe('creator_treasury (Phases A–D + artifact gate)', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(idl, provider);

  const wallet = provider.wallet as anchor.Wallet & { payer?: Keypair };
  const payerKp = wallet.payer;
  if (!payerKp) {
    throw new Error(
      'Tests expect a file-system wallet with a secret key (use `anchor test` or AnchorProvider.local()).',
    );
  }

  const finance = Keypair.generate();
  const recipient = Keypair.generate();

  it('vault → deposit → 2-of-2 approvals → timelock 0 → execute', async () => {
    const connection = provider.connection;

    const airdropSig = await connection.requestAirdrop(finance.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: airdropSig, ...latest });

    const mint = await createMint(connection, payerKp, payerKp.publicKey, null, 6);

    const projectId = new anchor.BN(0);
    const [projectPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('project'),
        payerKp.publicKey.toBuffer(),
        projectId.toArrayLike(Buffer, 'le', 8),
      ],
      program.programId,
    );

    await program.methods
      .initializeProject(projectId, Buffer.from('phase-a-demo'), [payerKp.publicKey, finance.publicKey], 2)
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), projectPda.toBuffer()],
      program.programId,
    );
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);

    await program.methods
      .initializeVault()
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        mint,
        vaultState,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const policyHash: number[] = Array.from({ length: 32 }, (_, i) => (i === 0 ? 9 : 0));
    await program.methods
      .setPolicy(policyHash)
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
      })
      .signers([payerKp])
      .rpc();

    const depositorAta = (
      await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, payerKp.publicKey)
    ).address;
    await mintTo(connection, payerKp, mint, depositorAta, payerKp, 5_000_000n);

    await program.methods
      .deposit(new anchor.BN(1_000_000))
      .accounts({
        depositor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        depositorTokenAccount: depositorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();

    const recipientAta = (
      await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, recipient.publicKey)
    ).address;

    const [proposal0] = PublicKey.findProgramAddressSync(
      [Buffer.from('proposal'), projectPda.toBuffer(), new anchor.BN(0).toArrayLike(Buffer, 'le', 8)],
      program.programId,
    );

    await program.methods
      .proposeRelease(new anchor.BN(400_000), recipient.publicKey, new anchor.BN(0))
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const artifactSha = Array.from({ length: 32 }, (_, i) => ((i % 254) + 1) & 0xff);
    await program.methods
      .attachProposalArtifact(
        new anchor.BN(0),
        artifactSha,
        Buffer.from('https://example.com/deliverable'),
        Buffer.from('v1 cut'),
        new anchor.BN(7),
      )
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .approveRelease(new anchor.BN(0))
      .accounts({
        approver: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .approveRelease(new anchor.BN(0))
      .accounts({
        approver: finance.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([finance])
      .rpc();

    const before = (await connection.getTokenAccountBalance(recipientAta)).value.amount;

    await program.methods
      .executeRelease(new anchor.BN(0), new anchor.BN(400_000))
      .accounts({
        executor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        recipientTokenAccount: recipientAta,
        proposal: proposal0,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();

    const after = (await connection.getTokenAccountBalance(recipientAta)).value.amount;
    assert.equal(BigInt(after) - BigInt(before), 400_000n);
  });

  it('dispute blocks execute until team lead resolves', async () => {
    const connection = provider.connection;

    const airdropSig = await connection.requestAirdrop(finance.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: airdropSig, ...latest });

    const mint = await createMint(connection, payerKp, payerKp.publicKey, null, 6);

    const projectId = new anchor.BN(1);
    const [projectPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('project'),
        payerKp.publicKey.toBuffer(),
        projectId.toArrayLike(Buffer, 'le', 8),
      ],
      program.programId,
    );

    await program.methods
      .initializeProject(projectId, Buffer.from('dispute-demo'), [payerKp.publicKey, finance.publicKey], 2)
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), projectPda.toBuffer()],
      program.programId,
    );
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);

    await program.methods
      .initializeVault()
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        mint,
        vaultState,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const policyHash: number[] = Array.from({ length: 32 }, (_, i) => (i === 31 ? 3 : 0));
    await program.methods
      .setPolicy(policyHash)
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
      })
      .signers([payerKp])
      .rpc();

    const depositorAta = (
      await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, payerKp.publicKey)
    ).address;
    await mintTo(connection, payerKp, mint, depositorAta, payerKp, 5_000_000n);

    await program.methods
      .deposit(new anchor.BN(1_000_000))
      .accounts({
        depositor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        depositorTokenAccount: depositorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();

    const recipientAta = (
      await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, recipient.publicKey)
    ).address;

    const [proposal0] = PublicKey.findProgramAddressSync(
      [Buffer.from('proposal'), projectPda.toBuffer(), new anchor.BN(0).toArrayLike(Buffer, 'le', 8)],
      program.programId,
    );

    await program.methods
      .proposeRelease(new anchor.BN(200_000), recipient.publicKey, new anchor.BN(0))
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const art = Array.from({ length: 32 }, (_, i) => ((i + 10) % 254) + 1);
    await program.methods
      .attachProposalArtifact(new anchor.BN(0), art, Buffer.from(''), Buffer.from(''), new anchor.BN(0))
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .approveRelease(new anchor.BN(0))
      .accounts({
        approver: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .approveRelease(new anchor.BN(0))
      .accounts({
        approver: finance.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([finance])
      .rpc();

    await program.methods
      .openDispute(new anchor.BN(0))
      .accounts({
        opener: finance.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([finance])
      .rpc();

    let executeFailed = false;
    try {
      await program.methods
        .executeRelease(new anchor.BN(0), new anchor.BN(200_000))
        .accounts({
          executor: payerKp.publicKey,
          project: projectPda,
          vaultState,
          vaultTokenAccount: vaultAta,
          recipientTokenAccount: recipientAta,
          proposal: proposal0,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([payerKp])
        .rpc();
    } catch {
      executeFailed = true;
    }
    assert.isTrue(executeFailed, 'execute should fail while dispute_active');

    await program.methods
      .resolveDispute(new anchor.BN(0))
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .executeRelease(new anchor.BN(0), new anchor.BN(200_000))
      .accounts({
        executor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        recipientTokenAccount: recipientAta,
        proposal: proposal0,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();
  });

  it('require_artifact_for_execute blocks execute until artifact attached', async () => {
    const connection = provider.connection;

    const airdropSig = await connection.requestAirdrop(finance.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: airdropSig, ...latest });

    const mint = await createMint(connection, payerKp, payerKp.publicKey, null, 6);

    const projectId = new anchor.BN(2);
    const [projectPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('project'),
        payerKp.publicKey.toBuffer(),
        projectId.toArrayLike(Buffer, 'le', 8),
      ],
      program.programId,
    );

    await program.methods
      .initializeProject(projectId, Buffer.from('artifact-gate'), [payerKp.publicKey, finance.publicKey], 2)
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), projectPda.toBuffer()],
      program.programId,
    );
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);

    await program.methods
      .initializeVault()
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        mint,
        vaultState,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const policyHash: number[] = Array.from({ length: 32 }, (_, i) => (i === 15 ? 7 : 0));
    await program.methods
      .setPolicy(policyHash)
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .setRequireArtifact(true)
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
      })
      .signers([payerKp])
      .rpc();

    const depositorAta = (
      await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, payerKp.publicKey)
    ).address;
    await mintTo(connection, payerKp, mint, depositorAta, payerKp, 5_000_000n);

    await program.methods
      .deposit(new anchor.BN(1_000_000))
      .accounts({
        depositor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        depositorTokenAccount: depositorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();

    const recipientAta = (
      await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, recipient.publicKey)
    ).address;

    const [proposal0] = PublicKey.findProgramAddressSync(
      [Buffer.from('proposal'), projectPda.toBuffer(), new anchor.BN(0).toArrayLike(Buffer, 'le', 8)],
      program.programId,
    );

    await program.methods
      .proposeRelease(new anchor.BN(250_000), recipient.publicKey, new anchor.BN(0))
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .approveRelease(new anchor.BN(0))
      .accounts({
        approver: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .approveRelease(new anchor.BN(0))
      .accounts({
        approver: finance.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([finance])
      .rpc();

    let blocked = false;
    try {
      await program.methods
        .executeRelease(new anchor.BN(0), new anchor.BN(250_000))
        .accounts({
          executor: payerKp.publicKey,
          project: projectPda,
          vaultState,
          vaultTokenAccount: vaultAta,
          recipientTokenAccount: recipientAta,
          proposal: proposal0,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([payerKp])
        .rpc();
    } catch {
      blocked = true;
    }
    assert.isTrue(blocked, 'execute should fail without artifact when gate is on');

    const art = Array.from({ length: 32 }, (_, i) => ((i + 20) % 254) + 1);
    await program.methods
      .attachProposalArtifact(new anchor.BN(0), art, Buffer.from(''), Buffer.from(''), new anchor.BN(0))
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .executeRelease(new anchor.BN(0), new anchor.BN(250_000))
      .accounts({
        executor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        recipientTokenAccount: recipientAta,
        proposal: proposal0,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();
  });

  it('partial execute: two tranches settle cap; over-remainder fails; cancel blocked after first tranche', async () => {
    const connection = provider.connection;

    const airdropSig = await connection.requestAirdrop(finance.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: airdropSig, ...latest });

    const mint = await createMint(connection, payerKp, payerKp.publicKey, null, 6);

    const projectId = new anchor.BN(3);
    const [projectPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('project'),
        payerKp.publicKey.toBuffer(),
        projectId.toArrayLike(Buffer, 'le', 8),
      ],
      program.programId,
    );

    await program.methods
      .initializeProject(projectId, Buffer.from('partial-demo'), [payerKp.publicKey, finance.publicKey], 2)
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), projectPda.toBuffer()],
      program.programId,
    );
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);

    await program.methods
      .initializeVault()
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        mint,
        vaultState,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const depositorAta = (
      await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, payerKp.publicKey)
    ).address;
    await mintTo(connection, payerKp, mint, depositorAta, payerKp, 5_000_000n);

    await program.methods
      .deposit(new anchor.BN(2_000_000))
      .accounts({
        depositor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        depositorTokenAccount: depositorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();

    const recipientAta = (
      await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, recipient.publicKey)
    ).address;

    const [proposal0] = PublicKey.findProgramAddressSync(
      [Buffer.from('proposal'), projectPda.toBuffer(), new anchor.BN(0).toArrayLike(Buffer, 'le', 8)],
      program.programId,
    );

    await program.methods
      .proposeRelease(new anchor.BN(500_000), recipient.publicKey, new anchor.BN(0))
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .approveRelease(new anchor.BN(0))
      .accounts({
        approver: payerKp.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([payerKp])
      .rpc();

    await program.methods
      .approveRelease(new anchor.BN(0))
      .accounts({
        approver: finance.publicKey,
        project: projectPda,
        proposal: proposal0,
      })
      .signers([finance])
      .rpc();

    const before1 = BigInt((await connection.getTokenAccountBalance(recipientAta)).value.amount);
    await program.methods
      .executeRelease(new anchor.BN(0), new anchor.BN(200_000))
      .accounts({
        executor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        recipientTokenAccount: recipientAta,
        proposal: proposal0,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();
    const mid = BigInt((await connection.getTokenAccountBalance(recipientAta)).value.amount);
    assert.equal(mid - before1, 200_000n);

    // @ts-expect-error account namespace
    const propMid = await program.account.releaseProposal.fetch(proposal0);
    assert.equal(propMid.releasedSoFar.toNumber(), 200_000);
    assert.equal(propMid.status, 1);

    let overFailed = false;
    try {
      await program.methods
        .executeRelease(new anchor.BN(0), new anchor.BN(400_000))
        .accounts({
          executor: payerKp.publicKey,
          project: projectPda,
          vaultState,
          vaultTokenAccount: vaultAta,
          recipientTokenAccount: recipientAta,
          proposal: proposal0,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([payerKp])
        .rpc();
    } catch {
      overFailed = true;
    }
    assert.isTrue(overFailed, 'execute over remainder should fail');

    let cancelFailed = false;
    try {
      await program.methods
        .cancelProposal(new anchor.BN(0))
        .accounts({
          teamLead: payerKp.publicKey,
          project: projectPda,
          proposal: proposal0,
        })
        .signers([payerKp])
        .rpc();
    } catch {
      cancelFailed = true;
    }
    assert.isTrue(cancelFailed, 'cancel after partial release should fail');

    await program.methods
      .executeRelease(new anchor.BN(0), new anchor.BN(300_000))
      .accounts({
        executor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        recipientTokenAccount: recipientAta,
        proposal: proposal0,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();

    const after2 = BigInt((await connection.getTokenAccountBalance(recipientAta)).value.amount);
    assert.equal(after2 - before1, 500_000n);

    // @ts-expect-error account namespace
    const propDone = await program.account.releaseProposal.fetch(proposal0);
    assert.equal(propDone.releasedSoFar.toNumber(), 500_000);
    assert.equal(propDone.status, 2);
  });

  it('split crank automation: configure, crank, wait, crank again', async () => {
    const connection = provider.connection;
    const crankA = Keypair.generate();
    const crankB = Keypair.generate();
    const airdropA = await connection.requestAirdrop(crankA.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);
    const airdropB = await connection.requestAirdrop(crankB.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);
    const lb = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: airdropA, ...lb });
    await connection.confirmTransaction({ signature: airdropB, ...lb });

    const mint = await createMint(connection, payerKp, payerKp.publicKey, null, 6);
    const projectId = new anchor.BN(42);
    const [projectPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('project'),
        payerKp.publicKey.toBuffer(),
        projectId.toArrayLike(Buffer, 'le', 8),
      ],
      program.programId,
    );

    await program.methods
      .initializeProject(projectId, Buffer.from('crank-demo'), [payerKp.publicKey], 1)
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), projectPda.toBuffer()],
      program.programId,
    );
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);

    await program.methods
      .initializeVault()
      .accounts({
        payer: payerKp.publicKey,
        teamLead: payerKp.publicKey,
        project: projectPda,
        mint,
        vaultState,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payerKp])
      .rpc();

    const depositorAta = (
      await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, payerKp.publicKey)
    ).address;
    await mintTo(connection, payerKp, mint, depositorAta, payerKp, 10_000_000n);

    await program.methods
      .deposit(new anchor.BN(5_000_000))
      .accounts({
        depositor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        depositorTokenAccount: depositorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payerKp])
      .rpc();

    const ataA = (await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, crankA.publicKey)).address;
    const ataB = (await getOrCreateAssociatedTokenAccount(connection, payerKp, mint, crankB.publicKey)).address;

    const AUTOMATION_SPLIT = 1;
    const nowBn = new anchor.BN(Math.floor(Date.now() / 1000) - 5);
    await program.methods
      .configureAutomation(
        AUTOMATION_SPLIT,
        false,
        new anchor.BN(2),
        new anchor.BN(1_000_000),
        nowBn,
        [crankA.publicKey, crankB.publicKey],
        [5000, 5000],
      )
      .accounts({
        teamLead: payerKp.publicKey,
        project: projectPda,
      })
      .signers([payerKp])
      .rpc();

    const beforeA = BigInt((await connection.getTokenAccountBalance(ataA)).value.amount);
    const beforeB = BigInt((await connection.getTokenAccountBalance(ataB)).value.amount);

    await program.methods
      .crankAutomation()
      .accounts({
        executor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: ataA, isWritable: true, isSigner: false },
        { pubkey: ataB, isWritable: true, isSigner: false },
      ])
      .signers([payerKp])
      .rpc();

    const midA = BigInt((await connection.getTokenAccountBalance(ataA)).value.amount);
    const midB = BigInt((await connection.getTokenAccountBalance(ataB)).value.amount);
    assert.equal(midA - beforeA, 500_000n);
    assert.equal(midB - beforeB, 500_000n);

    let tooSoon = false;
    try {
      await program.methods
        .crankAutomation()
        .accounts({
          executor: payerKp.publicKey,
          project: projectPda,
          vaultState,
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: ataA, isWritable: true, isSigner: false },
          { pubkey: ataB, isWritable: true, isSigner: false },
        ])
        .signers([payerKp])
        .rpc();
    } catch {
      tooSoon = true;
    }
    assert.isTrue(tooSoon, 'second crank before interval should fail');

    await new Promise((r) => setTimeout(r, 2500));

    await program.methods
      .crankAutomation()
      .accounts({
        executor: payerKp.publicKey,
        project: projectPda,
        vaultState,
        vaultTokenAccount: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: ataA, isWritable: true, isSigner: false },
        { pubkey: ataB, isWritable: true, isSigner: false },
      ])
      .signers([payerKp])
      .rpc();

    const afterA = BigInt((await connection.getTokenAccountBalance(ataA)).value.amount);
    const afterB = BigInt((await connection.getTokenAccountBalance(ataB)).value.amount);
    assert.equal(afterA - midA, 500_000n);
    assert.equal(afterB - midB, 500_000n);
  });
});
