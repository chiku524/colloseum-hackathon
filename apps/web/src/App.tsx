import type { Idl } from '@coral-xyz/anchor';
import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import idlJson from '@idl';
import { formatTxError } from './anchorErrors';
import { PolicyBuilder } from './PolicyBuilder';
import {
  canonicalPolicyJson,
  defaultPolicy,
  encodePolicyQueryParam,
  hex32,
  isRecipientAllowedByPolicy,
  parsePolicyJson,
  policyDefaultTimelockSecs,
  policyPayeePubkeys,
  policySuggestArtifactGate,
  sha256BytesUtf8,
  simpleLineDiff,
  simulatePayout,
  validatePolicy,
  type TreasuryPolicy,
} from './policy';
import {
  type AuditPackage,
  type ProposalSnapshot,
  downloadJson,
  downloadTextFile,
  proposalsToCsv,
} from './auditExport';
import { mergeSplitsIntoPolicy } from './csvPolicy';
import { ensureWalletAta, recipientAtaForMint } from './splUtil';
import { TreasuryAnalytics } from './TreasuryAnalytics';

const idl = idlJson as Idl;
const PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);

const STATUS_NAMES = ['Pending', 'Timelock', 'Executed', 'Cancelled'] as const;

function statusLabel(code: number): string {
  return STATUS_NAMES[code] ?? `Unknown(${code})`;
}

function decodeUtf8Truncated(bytes: number[], len: number): string {
  if (len <= 0) return '';
  return new TextDecoder().decode(Uint8Array.from(bytes.slice(0, len)));
}

function parseHex32(s: string): number[] {
  const t = s.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(t)) {
    throw new Error('Artifact SHA-256 must be exactly 64 hex characters.');
  }
  const out: number[] = [];
  for (let i = 0; i < 32; i++) {
    out.push(parseInt(t.slice(i * 2, i * 2 + 2), 16));
  }
  return out;
}

function shortAddr(s: string, left = 4, right = 4): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function isZeroArtifactSha256Hex(hex: string): boolean {
  return /^0{64}$/i.test(hex.trim());
}

function badgeClassForStatus(code: number): string {
  if (code === 0) return 'badge badge-pending';
  if (code === 1) return 'badge badge-timelock';
  if (code === 2) return 'badge badge-executed';
  return 'badge badge-cancelled';
}

function parseApproverPubkeys(text: string, lead: PublicKey): PublicKey[] {
  const parts = text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('Add at least one approver (your wallet first).');
  const keys = parts.map((p) => new PublicKey(p));
  if (!keys[0].equals(lead)) throw new Error('First approver must be your connected wallet.');
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (keys[i].equals(keys[j])) throw new Error('Duplicate approver.');
    }
  }
  return keys;
}

export default function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();

  const provider = useMemo(() => {
    if (!anchorWallet) return null;
    return new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });
  }, [anchorWallet, connection]);

  const program = useMemo(() => {
    if (!provider) return null;
    return new Program(idl, provider);
  }, [provider]);

  const [projectIdStr, setProjectIdStr] = useState('0');
  const [policyText, setPolicyText] = useState('');
  const [baselineText, setBaselineText] = useState('');
  const [depositSim, setDepositSim] = useState('1000000');
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [onChain, setOnChain] = useState<{
    project: PublicKey;
    teamLead: string;
    onChainProjectId: string;
    policyVersion: number;
    policyHashHex: string;
    vaultInitialized: boolean;
    vaultBalance?: string;
    /** SPL raw amount string from getTokenAccountBalance (atomic units). */
    vaultAmountRaw?: string;
    vaultDecimals: number;
    mint?: string;
    /** First `approver_count` entries — used to gate treasury analytics. */
    approverPubkeys: string[];
    nextProposalId: number;
    frozen: boolean;
    requireArtifactForExecute: boolean;
  } | null>(null);

  const [proposals, setProposals] = useState<ProposalSnapshot[]>([]);
  const [opsProposalId, setOpsProposalId] = useState('0');
  /** Smallest units for next execute; empty = release full remainder under cap. */
  const [execTrancheAmount, setExecTrancheAmount] = useState('');
  const [artHex, setArtHex] = useState('');
  const [artUri, setArtUri] = useState('');
  const [artLabel, setArtLabel] = useState('');
  const [artMilestone, setArtMilestone] = useState('0');
  const [csvText, setCsvText] = useState('');
  const [showAdvancedPolicy, setShowAdvancedPolicy] = useState(false);
  const [tab, setTab] = useState<'overview' | 'treasury' | 'setup' | 'policy' | 'ledger'>('overview');

  const [treasuryVisibility, setTreasuryVisibility] = useState<'private' | 'public'>(() => {
    if (typeof window === 'undefined') return 'private';
    try {
      return window.localStorage.getItem('creator-treasury-treasury-visibility') === 'public' ? 'public' : 'private';
    } catch {
      return 'private';
    }
  });

  const persistTreasuryVisibility = useCallback((v: 'private' | 'public') => {
    setTreasuryVisibility(v);
    try {
      window.localStorage.setItem('creator-treasury-treasury-visibility', v);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const [initName, setInitName] = useState('My treasury');
  const [initApproversText, setInitApproversText] = useState('');
  const [initThreshold, setInitThreshold] = useState('1');
  const [autoMode, setAutoMode] = useState('1');
  const [autoPaused, setAutoPaused] = useState(false);
  const [autoInterval, setAutoInterval] = useState('60');
  const [autoMaxPerTick, setAutoMaxPerTick] = useState('1000000');
  const [autoNextTs, setAutoNextTs] = useState('');
  const [autoRecipientsText, setAutoRecipientsText] = useState('');
  const [autoBpsText, setAutoBpsText] = useState('5000,5000');
  const [vaultMintStr, setVaultMintStr] = useState('');
  const [depositAmount, setDepositAmount] = useState('1000000');
  const [relAmount, setRelAmount] = useState('100000');
  const [relRecipient, setRelRecipient] = useState('');
  const [relTimelock, setRelTimelock] = useState('0');

  const isProjectApprover = useMemo(() => {
    if (!wallet.publicKey || !onChain?.approverPubkeys?.length) return false;
    const me = wallet.publicKey.toBase58();
    return onChain.approverPubkeys.includes(me);
  }, [wallet.publicKey, onChain?.approverPubkeys]);

  const canViewTreasuryAnalytics = treasuryVisibility === 'public' || isProjectApprover;

  const projectPda = useMemo(() => {
    if (!wallet.publicKey) return null;
    const id = Number(projectIdStr);
    if (!Number.isFinite(id) || id < 0) return null;
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64LE(BigInt(id), 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('project'), wallet.publicKey.toBuffer(), buf],
      PROGRAM_ID,
    )[0];
  }, [wallet.publicKey, projectIdStr]);

  const policyPayees = useMemo(() => {
    const r = parsePolicyJson(policyText);
    if (!r.ok) return [] as string[];
    return policyPayeePubkeys(r.policy);
  }, [policyText]);

  const publicStatusUrl = useMemo(() => {
    if (typeof window === 'undefined' || !onChain) return '';
    const base = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams({
      view: 'status',
      team_lead: onChain.teamLead,
      project_id: onChain.onChainProjectId,
    });
    const rpc = import.meta.env.VITE_RPC_URL;
    if (rpc) params.set('rpc', rpc);
    return `${base}?${params.toString()}`;
  }, [onChain]);

  const publicEmbedStatusUrl = useMemo(
    () => (publicStatusUrl ? `${publicStatusUrl}&embed=1` : ''),
    [publicStatusUrl],
  );

  useEffect(() => {
    if (!wallet.publicKey) {
      setPolicyText('');
      return;
    }
    setPolicyText(JSON.stringify(defaultPolicy(wallet.publicKey.toBase58()), null, 2));
  }, [wallet.publicKey]);

  useEffect(() => {
    if (wallet.publicKey) {
      setInitApproversText(`${wallet.publicKey.toBase58()}\n`);
    } else {
      setInitApproversText('');
    }
  }, [wallet.publicKey]);

  const loadOnChain = useCallback(async () => {
    setErr(null);
    setStatus(null);
    if (!program || !projectPda || !wallet.publicKey) {
      setErr('Connect wallet and ensure project id is valid.');
      return;
    }
    setBusy(true);
    try {
      // @ts-expect-error account namespace from IDL
      const acc = await program.account.project.fetchNullable(projectPda);
      if (!acc) {
        setOnChain(null);
        setProposals([]);
        setStatus('No project account at this PDA (initialize on-chain first).');
        return;
      }
      const hashHex = hex32(Uint8Array.from(acc.policyHash as number[]));
      let vaultBalance: string | undefined;
      let vaultAmountRaw: string | undefined;
      let vaultDecimals = 0;
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
        vaultAmountRaw = bal.value.amount;
        vaultDecimals = bal.value.decimals;
      }

      const approverCount = Number(acc.approverCount);
      const approverList = acc.approvers as PublicKey[];
      const approverPubkeys: string[] = [];
      for (let i = 0; i < approverCount && i < approverList.length; i++) {
        approverPubkeys.push(approverList[i].toBase58());
      }

      const nextProp = Number(acc.nextProposalId);
      const proposalRows: ProposalSnapshot[] = [];
      for (let i = 0; i < nextProp; i++) {
        const idBuf = Buffer.allocUnsafe(8);
        idBuf.writeBigUInt64LE(BigInt(i), 0);
        const [propPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('proposal'), projectPda.toBuffer(), idBuf],
          PROGRAM_ID,
        );
        // @ts-expect-error account namespace
        const prop = await program.account.releaseProposal.fetchNullable(propPda);
        if (!prop) continue;
        const uriLen = Number(prop.artifactUriLen);
        const labelLen = Number(prop.artifactLabelLen);
        const st = Number(prop.status);
        proposalRows.push({
          proposalPda: propPda.toBase58(),
          proposalId: String(i),
          amount: prop.amount.toString(),
          releasedSoFar: prop.releasedSoFar.toString(),
          recipient: prop.recipient.toBase58(),
          timelockDurationSecs: prop.timelockDurationSecs.toString(),
          timelockEndsAt: prop.timelockEndsAt.toString(),
          approvedMask: Number(prop.approvedMask),
          status: statusLabel(st),
          statusCode: st,
          policyVersionAtProposal: Number(prop.policyVersionAtProposal),
          artifactSha256Hex: hex32(Uint8Array.from(prop.artifactSha256 as number[])),
          artifactUri: decodeUtf8Truncated(prop.artifactUri as number[], uriLen),
          artifactLabel: decodeUtf8Truncated(prop.artifactLabel as number[], labelLen),
          linkedMilestoneId: prop.linkedMilestoneId.toString(),
          disputeActive: Boolean(prop.disputeActive),
        });
      }
      setProposals(proposalRows);

      setOnChain({
        project: projectPda,
        teamLead: acc.teamLead.toBase58(),
        onChainProjectId: acc.projectId.toString(),
        policyVersion: acc.policyVersion as number,
        policyHashHex: hashHex,
        vaultInitialized: acc.vaultInitialized as boolean,
        vaultBalance,
        vaultAmountRaw,
        vaultDecimals,
        mint,
        approverPubkeys,
        nextProposalId: nextProp,
        frozen: Boolean(acc.frozen),
        requireArtifactForExecute: Boolean(acc.requireArtifactForExecute),
      });
      setStatus('Loaded on-chain project.');
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  }, [program, projectPda, wallet.publicKey, connection]);

  const parsePolicy = (): TreasuryPolicy => {
    const raw = JSON.parse(policyText) as TreasuryPolicy;
    return raw;
  };

  const onValidate = () => {
    setErr(null);
    try {
      const p = parsePolicy();
      const v = validatePolicy(p);
      if (v) {
        setErr(v);
        return;
      }
      setStatus('Policy JSON is valid.');
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  const onHash = async () => {
    setErr(null);
    try {
      const p = parsePolicy();
      const v = validatePolicy(p);
      if (v) {
        setErr(v);
        return;
      }
      const canon = canonicalPolicyJson(p);
      const h = await sha256BytesUtf8(canon);
      setStatus(`Canonical hash (hex): ${hex32(h)}`);
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  const onSimulate = () => {
    setErr(null);
    try {
      const p = parsePolicy();
      const v = validatePolicy(p);
      if (v) {
        setErr(v);
        return;
      }
      const atoms = BigInt(depositSim);
      if (atoms <= 0n) {
        setErr('Deposit must be a positive integer (token smallest units).');
        return;
      }
      const { lines, holdback, remainder } = simulatePayout(atoms, p);
      const rows = lines.map((l) => `${l.payee}: ${l.amount.toString()}`).join('\n');
      setStatus(
        `Simulated (atomic units):\nholdback: ${holdback}\n${rows}\nremainder (stays in vault math): ${remainder}`,
      );
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  const onCopySimulatorLink = async () => {
    setErr(null);
    setStatus(null);
    try {
      const p = parsePolicy();
      const v = validatePolicy(p);
      if (v) {
        setErr(v);
        return;
      }
      const enc = encodePolicyQueryParam(p);
      const u = new URL(window.location.href);
      u.search = '';
      u.hash = '';
      u.searchParams.set('view', 'simulate');
      u.searchParams.set('p', enc);
      const url = u.toString();
      if (url.length > 2200) {
        setErr('URL would be too long for some browsers; shorten the policy (fewer payees / mints).');
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus('Copied read-only simulator link (no wallet).');
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  const onApplyPolicy = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !projectPda || !wallet.publicKey) {
      setErr('Connect wallet first.');
      return;
    }
    setBusy(true);
    try {
      const p = parsePolicy();
      const v = validatePolicy(p);
      if (v) {
        setErr(v);
        return;
      }
      const canon = canonicalPolicyJson(p);
      const h = await sha256BytesUtf8(canon);
      const arr = Array.from(h);
      const sig = await program.methods
        .setPolicy(arr)
        .accounts({
          teamLead: wallet.publicKey,
          project: projectPda,
        })
        .rpc();
      setStatus(`set_policy tx: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onDiff = () => {
    setErr(null);
    try {
      setStatus(simpleLineDiff(baselineText, policyText));
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  const proposalPdaFromId = (projectKey: PublicKey, proposalId: number): PublicKey => {
    const idBuf = Buffer.allocUnsafe(8);
    idBuf.writeBigUInt64LE(BigInt(proposalId), 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('proposal'), projectKey.toBuffer(), idBuf],
      PROGRAM_ID,
    )[0];
  };

  const onAttachArtifact = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load a project first.');
      return;
    }
    const pid = Number(opsProposalId);
    if (!Number.isFinite(pid) || pid < 0) {
      setErr('Invalid proposal id.');
      return;
    }
    const propPda = proposalPdaFromId(onChain.project, pid);
    setBusy(true);
    try {
      const sha = parseHex32(artHex);
      const uriBytes = Array.from(new TextEncoder().encode(artUri));
      const labelBytes = Array.from(new TextEncoder().encode(artLabel));
      const ms = BigInt(artMilestone || '0');
      const sig = await program.methods
        .attachProposalArtifact(new BN(pid), sha, uriBytes, labelBytes, new BN(ms.toString()))
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
          proposal: propPda,
        })
        .rpc();
      setStatus(`attach_proposal_artifact tx: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onOpenDispute = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load a project first.');
      return;
    }
    const pid = Number(opsProposalId);
    const propPda = proposalPdaFromId(onChain.project, pid);
    setBusy(true);
    try {
      const sig = await program.methods
        .openDispute(new BN(pid))
        .accounts({
          opener: wallet.publicKey,
          project: onChain.project,
          proposal: propPda,
        })
        .rpc();
      setStatus(`open_dispute tx: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onResolveDispute = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load a project first.');
      return;
    }
    const pid = Number(opsProposalId);
    const propPda = proposalPdaFromId(onChain.project, pid);
    setBusy(true);
    try {
      const sig = await program.methods
        .resolveDispute(new BN(pid))
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
          proposal: propPda,
        })
        .rpc();
      setStatus(`resolve_dispute tx: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onMergeCsvSplits = () => {
    setErr(null);
    try {
      const p = parsePolicy();
      const merged = mergeSplitsIntoPolicy(p, csvText);
      const v = validatePolicy(merged);
      if (v) {
        setErr(v);
        return;
      }
      setPolicyText(JSON.stringify(merged, null, 2));
      setStatus('Merged CSV rows into policy splits (validate again before applying on-chain).');
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  const onCreateProject = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !projectPda) {
      setErr('Connect wallet and pick a project ID.');
      return;
    }
    let approvers: PublicKey[];
    try {
      approvers = parseApproverPubkeys(initApproversText, wallet.publicKey);
    } catch (e) {
      setErr(formatTxError(e));
      return;
    }
    const th = Number(initThreshold);
    if (!Number.isInteger(th) || th < 1 || th > approvers.length) {
      setErr('Threshold must be an integer from 1 to the number of approvers.');
      return;
    }
    setBusy(true);
    try {
      const nameBuf = Buffer.from(initName.slice(0, 64), 'utf8');
      const sig = await program.methods
        .initializeProject(new BN(projectIdStr), nameBuf, approvers, th)
        .accounts({
          payer: wallet.publicKey,
          teamLead: wallet.publicKey,
          project: projectPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus(`initialize_project: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onInitVault = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !projectPda || !onChain) {
      setErr('Load an existing project first.');
      return;
    }
    let mint: PublicKey;
    try {
      mint = new PublicKey(vaultMintStr.trim());
    } catch {
      setErr('Invalid mint address.');
      return;
    }
    setBusy(true);
    try {
      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), projectPda.toBuffer()],
        PROGRAM_ID,
      );
      const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);
      const sig = await program.methods
        .initializeVault()
        .accounts({
          payer: wallet.publicKey,
          teamLead: wallet.publicKey,
          project: projectPda,
          mint,
          vaultState,
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus(`initialize_vault: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onDeposit = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain?.mint) {
      setErr('Load project with an initialized vault.');
      return;
    }
    let amount: BN;
    try {
      amount = new BN(depositAmount);
      if (amount.lte(new BN(0))) throw new Error('Amount must be > 0');
    } catch (e) {
      setErr(formatTxError(e));
      return;
    }
    setBusy(true);
    try {
      const mint = new PublicKey(onChain.mint);
      const depositorAta = await ensureWalletAta(connection, wallet, mint);
      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), onChain.project.toBuffer()],
        PROGRAM_ID,
      );
      const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);
      const sig = await program.methods
        .deposit(amount)
        .accounts({
          depositor: wallet.publicKey,
          project: onChain.project,
          vaultState,
          vaultTokenAccount: vaultAta,
          depositorTokenAccount: depositorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      setStatus(`deposit: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onProposeRelease = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load project first.');
      return;
    }
    let recipient: PublicKey;
    try {
      recipient = new PublicKey(relRecipient.trim());
    } catch {
      setErr('Invalid recipient pubkey.');
      return;
    }
    const parsedForGate = parsePolicyJson(policyText);
    if (
      parsedForGate.ok &&
      !isRecipientAllowedByPolicy(parsedForGate.policy, relRecipient.trim())
    ) {
      setErr(
        'Policy restricts payout recipients to wallets listed in splits. Pick a listed payee or turn off that toggle in Policy.',
      );
      return;
    }
    let amount: BN;
    let timelock: BN;
    try {
      amount = new BN(relAmount);
      timelock = new BN(relTimelock);
      if (amount.lte(new BN(0))) throw new Error('Amount must be > 0');
      if (timelock.isNeg()) throw new Error('Timelock must be >= 0');
    } catch (e) {
      setErr(formatTxError(e));
      return;
    }
    const nextId = onChain.nextProposalId;
    const proposalPda = proposalPdaFromId(onChain.project, nextId);
    setBusy(true);
    try {
      const sig = await program.methods
        .proposeRelease(amount, recipient, timelock)
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
          proposal: proposalPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus(`propose_release #${nextId}: ${sig}`);
      setOpsProposalId(String(nextId));
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onApproveRelease = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain) return;
    const pid = Number(opsProposalId);
    if (!Number.isInteger(pid) || pid < 0) {
      setErr('Invalid proposal id.');
      return;
    }
    const proposalPda = proposalPdaFromId(onChain.project, pid);
    setBusy(true);
    try {
      const sig = await program.methods
        .approveRelease(new BN(pid))
        .accounts({
          approver: wallet.publicKey,
          project: onChain.project,
          proposal: proposalPda,
        })
        .rpc();
      setStatus(`approve_release: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onExecuteRelease = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain?.mint) {
      setErr('Load project with vault.');
      return;
    }
    const pid = Number(opsProposalId);
    if (!Number.isInteger(pid) || pid < 0) {
      setErr('Invalid proposal id.');
      return;
    }
    const prop = proposals.find((p) => p.proposalId === String(pid));
    if (!prop) {
      setErr('Proposal not in loaded list — refresh Overview.');
      return;
    }
    if (onChain.requireArtifactForExecute && isZeroArtifactSha256Hex(prop.artifactSha256Hex)) {
      setErr(
        'This project requires a non-zero proposal artifact before execute. Attach one under Proposals → Artifacts & disputes.',
      );
      return;
    }
    const capBn = new BN(prop.amount);
    const releasedBn = new BN(prop.releasedSoFar);
    const remainderBn = capBn.sub(releasedBn);
    const rawExec = execTrancheAmount.trim();
    let releaseBn: BN;
    if (!rawExec) {
      if (remainderBn.lte(new BN(0))) {
        setErr('Nothing left to release for this proposal under the approved cap.');
        return;
      }
      releaseBn = remainderBn;
    } else {
      let parsed: BN;
      try {
        parsed = new BN(rawExec, 10);
      } catch {
        setErr('Execute tranche amount must be a non-negative integer (smallest units).');
        return;
      }
      if (parsed.lte(new BN(0))) {
        setErr('Execute tranche amount must be greater than zero.');
        return;
      }
      if (parsed.gt(remainderBn)) {
        setErr(`Tranche exceeds remainder under cap (${remainderBn.toString()} smallest units left).`);
        return;
      }
      releaseBn = parsed;
    }
    const mint = new PublicKey(onChain.mint);
    const recipient = new PublicKey(prop.recipient);
    const recipientAta = recipientAtaForMint(recipient, mint);
    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), onChain.project.toBuffer()],
      PROGRAM_ID,
    );
    const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);
    const proposalPda = proposalPdaFromId(onChain.project, pid);
    setBusy(true);
    try {
      const sig = await program.methods
        .executeRelease(new BN(pid), releaseBn)
        .accounts({
          executor: wallet.publicKey,
          project: onChain.project,
          vaultState,
          vaultTokenAccount: vaultAta,
          recipientTokenAccount: recipientAta,
          proposal: proposalPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      setStatus(`execute_release: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onCancelProposal = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain) return;
    const pid = Number(opsProposalId);
    if (!Number.isInteger(pid) || pid < 0) {
      setErr('Invalid proposal id.');
      return;
    }
    const proposalPda = proposalPdaFromId(onChain.project, pid);
    setBusy(true);
    try {
      const sig = await program.methods
        .cancelProposal(new BN(pid))
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
          proposal: proposalPda,
        })
        .rpc();
      setStatus(`cancel_proposal: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onSetFrozen = async (frozen: boolean) => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain) return;
    setBusy(true);
    try {
      const sig = await program.methods
        .setFrozen(frozen)
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
        })
        .rpc();
      setStatus(`set_frozen(${frozen}): ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onSetRequireArtifact = async (require: boolean) => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain) return;
    setBusy(true);
    try {
      const sig = await program.methods
        .setRequireArtifact(require)
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
        })
        .rpc();
      setStatus(`set_require_artifact(${require}): ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const AUTOMATION_MODE_NONE = 0;
  const AUTOMATION_MODE_SPLIT = 1;

  const onUpgradeProjectLayout = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !projectPda) {
      setErr('Connect wallet and set project ID.');
      return;
    }
    const pid = Number(projectIdStr);
    if (!Number.isInteger(pid) || pid < 0) {
      setErr('Invalid project ID.');
      return;
    }
    setBusy(true);
    try {
      const sig = await program.methods
        .upgradeProjectLayout(new BN(pid))
        .accounts({
          payer: wallet.publicKey,
          teamLead: wallet.publicKey,
          project: projectPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus(`upgrade_project_layout: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onConfigureAutomation = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load project first.');
      return;
    }
    const mode = Number(autoMode);
    if (mode !== AUTOMATION_MODE_NONE && mode !== AUTOMATION_MODE_SPLIT) {
      setErr('Mode must be 0 (off) or 1 (split crank).');
      return;
    }
    let recipients: PublicKey[] = [];
    let bps: number[] = [];
    if (mode === AUTOMATION_MODE_SPLIT) {
      const rparts = autoRecipientsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const bparts = autoBpsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s));
      if (rparts.length === 0 || rparts.length > 8) {
        setErr('Provide 1–8 recipient pubkeys for split crank.');
        return;
      }
      if (bparts.length !== rparts.length) {
        setErr('Recipients and bps counts must match.');
        return;
      }
      try {
        recipients = rparts.map((s) => new PublicKey(s));
      } catch {
        setErr('Invalid recipient pubkey.');
        return;
      }
      for (const b of bparts) {
        if (!Number.isInteger(b) || b < 0 || b > 10_000) {
          setErr('Each bps must be an integer 0–10000.');
          return;
        }
      }
      const sum = bparts.reduce((a, b) => a + b, 0);
      if (sum <= 0 || sum > 10_000) {
        setErr('Sum of bps must be 1–10000.');
        return;
      }
      bps = bparts;
    }
    const interval = Number(autoInterval);
    const maxPer = autoMaxPerTick.trim();
    if (mode === AUTOMATION_MODE_SPLIT) {
      if (!Number.isInteger(interval) || interval <= 0) {
        setErr('Interval (seconds) must be a positive integer.');
        return;
      }
      if (!maxPer || BigInt(maxPer) <= 0n) {
        setErr('Max per tick must be > 0 (smallest token units).');
        return;
      }
    }
    let nextBn: BN;
    if (autoNextTs.trim()) {
      try {
        nextBn = new BN(autoNextTs.trim(), 10);
        if (nextBn.isNeg()) throw new Error('neg');
      } catch {
        setErr('Next eligible must be a non-negative integer (unix seconds).');
        return;
      }
    } else {
      nextBn = new BN(Math.floor(Date.now() / 1000));
    }
    setBusy(true);
    try {
      const sig = await program.methods
        .configureAutomation(
          mode,
          autoPaused,
          new BN(mode === AUTOMATION_MODE_SPLIT ? interval : 0),
          mode === AUTOMATION_MODE_SPLIT ? new BN(maxPer) : new BN(0),
          nextBn,
          recipients,
          bps,
        )
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
        })
        .rpc();
      setStatus(`configure_automation: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onCrankAutomation = async () => {
    setErr(null);
    setStatus(null);
    if (!program || !wallet.publicKey || !onChain?.mint) {
      setErr('Load project with vault.');
      return;
    }
    setBusy(true);
    try {
      // @ts-expect-error IDL account namespace
      const proj = await program.account.project.fetch(onChain.project);
      const countRaw = proj.autoRecipientCount ?? proj.auto_recipient_count;
      const count =
        countRaw && typeof countRaw === 'object' && 'toNumber' in countRaw
          ? (countRaw as { toNumber: () => number }).toNumber()
          : Number(countRaw ?? 0);
      if (!count) {
        setErr('No automation recipients on-chain; configure automation first.');
        return;
      }
      const list = (proj.autoRecipients ?? proj.auto_recipients) as PublicKey[];
      const mint = new PublicKey(onChain.mint);
      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), onChain.project.toBuffer()],
        PROGRAM_ID,
      );
      const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);
      const remainingAccounts = [];
      for (let i = 0; i < count; i++) {
        const owner = list[i];
        if (!owner) break;
        remainingAccounts.push({
          pubkey: recipientAtaForMint(owner, mint),
          isWritable: true,
          isSigner: false,
        });
      }
      const sig = await program.methods
        .crankAutomation()
        .accounts({
          executor: wallet.publicKey,
          project: onChain.project,
          vaultState,
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();
      setStatus(`crank_automation: ${sig}`);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onExportCsv = () => {
    setErr(null);
    if (!onChain) {
      setErr('Load a project first.');
      return;
    }
    downloadTextFile(`creator-treasury-proposals-${onChain.onChainProjectId}.csv`, proposalsToCsv(proposals));
    setStatus('Proposal CSV downloaded.');
  };

  const onExportAudit = () => {
    setErr(null);
    if (!onChain) {
      setErr('Load a project first.');
      return;
    }
    const pkg: AuditPackage = {
      exportedAt: new Date().toISOString(),
      rpc: connection.rpcEndpoint,
      programId: PROGRAM_ID.toBase58(),
      projectPda: onChain.project.toBase58(),
      teamLead: onChain.teamLead,
      projectId: onChain.onChainProjectId,
      policyVersion: onChain.policyVersion,
      policyHashHex: onChain.policyHashHex,
      frozen: onChain.frozen,
      requireArtifactForExecute: onChain.requireArtifactForExecute,
      vaultInitialized: onChain.vaultInitialized,
      mint: onChain.mint,
      vaultBalance: onChain.vaultBalance,
      proposals,
    };
    downloadJson(`creator-treasury-audit-${onChain.onChainProjectId}.json`, pkg);
    setStatus('Audit JSON downloaded.');
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            CT
          </span>
          <div>
            <h1>Creator Treasury</h1>
            <p className="tagline">
              Team escrow vault, policy templates, multi-approver releases, artifacts, and disputes — on Solana.
            </p>
          </div>
        </div>
        <WalletMultiButton />
      </header>

      <nav className="tabs" role="tablist" aria-label="Sections">
        <button type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button type="button" role="tab" aria-selected={tab === 'treasury'} onClick={() => setTab('treasury')}>
          Treasury
        </button>
        <button type="button" role="tab" aria-selected={tab === 'setup'} onClick={() => setTab('setup')}>
          Setup
        </button>
        <button type="button" role="tab" aria-selected={tab === 'policy'} onClick={() => setTab('policy')}>
          Policy
        </button>
        <button type="button" role="tab" aria-selected={tab === 'ledger'} onClick={() => setTab('ledger')}>
          Proposals
        </button>
      </nav>

      {tab === 'overview' && (
        <div className="panel">
          <h2>Load project</h2>
          <p className="muted">Uses your connected wallet as team lead and derives the project PDA from the numeric ID.</p>
          <div className="field-row">
            <div className="field" style={{ flex: '0 0 7.5rem' }}>
              <label htmlFor="pid">Project ID</label>
              <input
                id="pid"
                type="number"
                min={0}
                value={projectIdStr}
                onChange={(e) => setProjectIdStr(e.target.value)}
              />
            </div>
            <button type="button" className="ghost" disabled={busy || !program || !projectPda} onClick={loadOnChain}>
              {busy ? 'Loading…' : 'Refresh on-chain'}
            </button>
          </div>
          {projectPda && (
            <p className="muted">
              PDA <code>{projectPda.toBase58()}</code>
            </p>
          )}
          {onChain && (
            <>
              <div className="stat-grid">
                <div className="stat">
                  <div className="stat-label">Policy v</div>
                  <div className="stat-value">{onChain.policyVersion}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Proposals</div>
                  <div className="stat-value">{onChain.nextProposalId}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Vault</div>
                  <div className="stat-value">{onChain.vaultInitialized ? 'Ready' : 'Off'}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Balance</div>
                  <div className="stat-value">{onChain.vaultBalance ?? '—'}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Frozen</div>
                  <div className="stat-value">{onChain.frozen ? 'Yes' : 'No'}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Artifact gate</div>
                  <div className="stat-value">{onChain.requireArtifactForExecute ? 'On' : 'Off'}</div>
                </div>
              </div>
              <pre className="data-block">
                {`team_lead: ${shortAddr(onChain.teamLead, 6, 6)} (${onChain.teamLead})
project_id: ${onChain.onChainProjectId}
policy_hash: ${onChain.policyHashHex}
require_artifact_for_execute: ${onChain.requireArtifactForExecute}
mint: ${onChain.mint ? shortAddr(onChain.mint, 6, 6) : '—'}`}
              </pre>
              <p className="muted" style={{ marginTop: '0.75rem' }}>
                Share a read-only snapshot (no wallet): copy link opens the same app in public status mode.
              </p>
              <div className="btn-row">
                <button
                  type="button"
                  className="ghost"
                  onClick={async () => {
                    if (!publicStatusUrl) return;
                    setErr(null);
                    try {
                      await navigator.clipboard.writeText(publicStatusUrl);
                      setStatus('Copied public status link.');
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : 'Could not copy link.');
                    }
                  }}
                >
                  Copy public status link
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={async () => {
                    if (!publicEmbedStatusUrl) return;
                    setErr(null);
                    try {
                      await navigator.clipboard.writeText(publicEmbedStatusUrl);
                      setStatus('Copied iframe-friendly status link (embed=1).');
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : 'Could not copy link.');
                    }
                  }}
                >
                  Copy embed link
                </button>
              </div>
            </>
          )}
          {proposals.length > 0 && (
            <div className="proposal-list" aria-label="Proposals">
              {proposals.map((p) => (
                <div key={p.proposalId} className="proposal-card">
                  <div className="proposal-card-top">
                    <span className={badgeClassForStatus(p.statusCode)}>{p.status}</span>
                    <span className="proposal-meta">Proposal #{p.proposalId}</span>
                  </div>
                  <div className="proposal-meta">
                    cap {p.amount} · released {p.releasedSoFar} → {shortAddr(p.recipient)} · policy v{p.policyVersionAtProposal}
                    {p.disputeActive ? ' · dispute' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'treasury' && (
        <div className="panel">
          <h2>Treasury analytics</h2>
          <p className="muted">
            Vault balance, committed (unpaid) proposal caps, and cumulative disbursements through{' '}
            <code>execute_release</code>. Choose who may see these charts in this browser.
          </p>
          <div className="treasury-visibility-toggle" role="group" aria-label="Treasury tab visibility">
            <button
              type="button"
              className={treasuryVisibility === 'private' ? 'is-selected' : undefined}
              aria-pressed={treasuryVisibility === 'private'}
              onClick={() => persistTreasuryVisibility('private')}
            >
              Private
            </button>
            <button
              type="button"
              className={treasuryVisibility === 'public' ? 'is-selected' : undefined}
              aria-pressed={treasuryVisibility === 'public'}
              onClick={() => persistTreasuryVisibility('public')}
            >
              Public
            </button>
          </div>
          <p className="muted treasury-visibility-hint">
            <strong>Private</strong> — only wallets in the on-chain approver list see charts.{' '}
            <strong>Public</strong> — anyone who can load this project in this session (same wallet + project ID as
            Overview) sees charts without being an approver. This setting is saved in{' '}
            <code>localStorage</code> for this origin only; it does not change on-chain permissions.
          </p>
          {treasuryVisibility === 'public' && onChain && canViewTreasuryAnalytics && wallet.publicKey && (
            <p className="treasury-public-banner" role="status">
              Public view — figures are visible without an approver check. Data still comes from RPC for your loaded
              project.
            </p>
          )}
          {!wallet.publicKey ? (
            <p className="muted">Connect your wallet.</p>
          ) : !onChain ? (
            <p className="muted">Load the project from Overview first (Refresh on-chain).</p>
          ) : !canViewTreasuryAnalytics ? (
            <p className="muted">
              Your wallet is not an approver for this project. Turn on <strong>Public</strong> above to view analytics
              anyway in this browser, or connect with an approver wallet.
            </p>
          ) : (
            <TreasuryAnalytics
              proposals={proposals}
              vaultInitialized={onChain.vaultInitialized}
              vaultAmountRaw={onChain.vaultAmountRaw}
              vaultDecimals={onChain.vaultInitialized ? onChain.vaultDecimals : 6}
              mint={onChain.mint}
            />
          )}
          <div className="btn-row" style={{ marginTop: '1rem' }}>
            <button type="button" className="ghost" disabled={busy || !program || !projectPda} onClick={loadOnChain}>
              {busy ? 'Refreshing…' : 'Refresh figures'}
            </button>
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <>
          <div className="panel">
            <h2>Create project</h2>
            <p className="muted">
              Uses the numeric <strong>Project ID</strong> from Overview (same PDA). First approver must be your wallet;
              one pubkey per line or comma-separated.
            </p>
            <div className="field-row">
              <div className="field" style={{ flex: '0 0 7.5rem' }}>
                <label htmlFor="setup-pid">Project ID</label>
                <input
                  id="setup-pid"
                  type="number"
                  min={0}
                  value={projectIdStr}
                  onChange={(e) => setProjectIdStr(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="pname">Name</label>
              <input id="pname" type="text" value={initName} onChange={(e) => setInitName(e.target.value)} maxLength={64} />
            </div>
            <div className="field">
              <label htmlFor="approvers">Approvers</label>
              <textarea
                id="approvers"
                className="compact"
                value={initApproversText}
                onChange={(e) => setInitApproversText(e.target.value)}
                spellCheck={false}
                placeholder="Your pubkey first, then finance / collaborators"
              />
            </div>
            <div className="field" style={{ maxWidth: '8rem' }}>
              <label htmlFor="thr">Threshold</label>
              <input id="thr" type="number" min={1} max={5} value={initThreshold} onChange={(e) => setInitThreshold(e.target.value)} />
            </div>
            <div className="btn-row">
              <button type="button" disabled={busy || !program || !wallet.publicKey || !projectPda} onClick={onCreateProject}>
                Create project on-chain
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Vault & liquidity</h2>
            <p className="muted">
              Paste the SPL <strong>mint</strong> (e.g. devnet USDC). Initializes vault ATA once. Deposit pulls from your
              wallet ATA (created automatically if missing).
            </p>
            <div className="field">
              <label htmlFor="mint">Mint address</label>
              <input
                id="mint"
                type="text"
                value={vaultMintStr}
                onChange={(e) => setVaultMintStr(e.target.value)}
                placeholder="Mint pubkey (base58)"
              />
            </div>
            <div className="btn-row">
              <button
                type="button"
                disabled={busy || !program || !wallet.publicKey || !onChain || onChain.vaultInitialized}
                onClick={onInitVault}
              >
                Initialize vault
              </button>
            </div>
            <div className="field-row" style={{ marginTop: '0.75rem' }}>
              <div className="field">
                <label htmlFor="depamt">Deposit amount (smallest units)</label>
                <input id="depamt" type="text" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
              </div>
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain?.vaultInitialized}
                onClick={onDeposit}
              >
                Deposit to vault
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Vault safety</h2>
            <p className="muted">While frozen, new proposals and releases are blocked; deposits still land.</p>
            <div className="btn-row">
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain || onChain.frozen}
                onClick={() => onSetFrozen(true)}
              >
                Freeze vault
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain || !onChain.frozen}
                onClick={() => onSetFrozen(false)}
              >
                Unfreeze
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Execute gate — artifact</h2>
            <p className="muted">
              When enabled, <code>execute_release</code> requires a non-zero <code>artifact_sha256</code> on the proposal
              (team lead only to toggle).
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain || onChain.requireArtifactForExecute}
                onClick={() => onSetRequireArtifact(true)}
              >
                Require artifact before execute
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain || !onChain.requireArtifactForExecute}
                onClick={() => onSetRequireArtifact(false)}
              >
                Allow execute without artifact
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Automation — split crank</h2>
            <p className="muted">
              On-chain automation moves up to <code>min(vault, max_per_tick)</code> each crank, split by bps. Anyone can
              pay fees to <code>crank_automation</code> when <code>next_eligible_ts</code> has passed. Older projects may
              need a one-time layout upgrade before configuring.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !projectPda}
                onClick={onUpgradeProjectLayout}
              >
                Upgrade project layout (one-time)
              </button>
            </div>
            <div className="field-row" style={{ marginTop: '0.75rem' }}>
              <div className="field" style={{ maxWidth: '8rem' }}>
                <label htmlFor="amode">Mode</label>
                <select id="amode" value={autoMode} onChange={(e) => setAutoMode(e.target.value)}>
                  <option value={String(AUTOMATION_MODE_NONE)}>0 — Off</option>
                  <option value={String(AUTOMATION_MODE_SPLIT)}>1 — Split crank</option>
                </select>
              </div>
              <label className="toggle-row" style={{ marginTop: '1.5rem' }}>
                <input
                  type="checkbox"
                  checked={autoPaused}
                  onChange={(e) => setAutoPaused(e.target.checked)}
                />
                <span>Paused</span>
              </label>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="aint">Interval (sec)</label>
                <input id="aint" type="text" value={autoInterval} onChange={(e) => setAutoInterval(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="amax">Max per tick (atoms)</label>
                <input id="amax" type="text" value={autoMaxPerTick} onChange={(e) => setAutoMaxPerTick(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="anext">Next eligible (unix, blank = now)</label>
                <input id="anext" type="text" value={autoNextTs} onChange={(e) => setAutoNextTs(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="arec">Recipients (comma or newline)</label>
              <textarea
                id="arec"
                className="compact"
                value={autoRecipientsText}
                onChange={(e) => setAutoRecipientsText(e.target.value)}
                spellCheck={false}
                placeholder="One base58 pubkey per line or comma-separated"
              />
            </div>
            <div className="field">
              <label htmlFor="abps">Bps per recipient (same order)</label>
              <input
                id="abps"
                type="text"
                value={autoBpsText}
                onChange={(e) => setAutoBpsText(e.target.value)}
                placeholder="5000,5000"
              />
            </div>
            <div className="btn-row">
              <button type="button" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onConfigureAutomation}>
                Save automation on-chain
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onCrankAutomation}>
                Crank now (connected wallet pays fee)
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'policy' && (
        <>
          <PolicyBuilder
            policyText={policyText}
            onPolicyTextChange={setPolicyText}
            teamLead={wallet.publicKey?.toBase58() ?? null}
          />

          {onChain &&
            (() => {
              const r = parsePolicyJson(policyText);
              if (
                !r.ok ||
                !policySuggestArtifactGate(r.policy) ||
                onChain.requireArtifactForExecute
              ) {
                return null;
              }
              return (
                <div className="panel">
                  <h2>Match policy to vault settings</h2>
                  <p className="muted">
                    This policy recommends requiring a deliverable hash before execute (milestone escrow). Enable it on
                    the project to align on-chain behavior.
                  </p>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy || !program || !wallet.publicKey}
                      onClick={() => onSetRequireArtifact(true)}
                    >
                      Enable artifact gate on-chain
                    </button>
                  </div>
                </div>
              );
            })()}

          <div className="panel">
            <div className="field-row" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
              <h2 style={{ margin: 0, flex: 1 }}>Advanced — raw JSON</h2>
              <button type="button" className="ghost" onClick={() => setShowAdvancedPolicy((v) => !v)}>
                {showAdvancedPolicy ? 'Hide' : 'Show'}
              </button>
            </div>
            {showAdvancedPolicy && (
              <>
                <p className="muted">
                  Canonical JSON is hashed in-browser; only the digest is stored on-chain via set_policy.
                </p>
                <textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} spellCheck={false} />
              </>
            )}
            <div className="btn-row" style={{ marginTop: showAdvancedPolicy ? '0.75rem' : 0 }}>
              <button type="button" className="ghost" onClick={onValidate}>
                Validate
              </button>
              <button type="button" className="ghost" onClick={onHash}>
                Show hash
              </button>
              <button type="button" disabled={busy || !program || !wallet.publicKey} onClick={onApplyPolicy}>
                Apply on-chain
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Payout simulator</h2>
            <p className="muted">
              Share a read-only link so finance can try deposit math without a wallet (policy is embedded as base64 in the
              URL — keep policies small).
            </p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="dep">Deposit (smallest units)</label>
                <input id="dep" type="text" value={depositSim} onChange={(e) => setDepositSim(e.target.value)} />
              </div>
              <button type="button" className="ghost" onClick={onSimulate}>
                Simulate
              </button>
              <button type="button" className="ghost" onClick={onCopySimulatorLink}>
                Copy simulator link
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>CSV → splits</h2>
            <p className="muted">
              Rows: <code>payee,bps</code>. Lines with <code>#</code> are comments. Merges into the current policy JSON.
            </p>
            <textarea
              className="compact"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              spellCheck={false}
              placeholder={'# Example\nSo11111111111111111111111111111111111111112,7000\nSo11111111111111111111111111111111111111113,3000'}
            />
            <div className="btn-row">
              <button type="button" className="ghost" onClick={onMergeCsvSplits}>
                Merge into policy
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Diff vs baseline</h2>
            <p className="muted">Paste a baseline JSON or copy the current draft as baseline, then compare line-by-line.</p>
            <textarea className="compact" value={baselineText} onChange={(e) => setBaselineText(e.target.value)} spellCheck={false} />
            <div className="btn-row">
              <button type="button" className="ghost" onClick={() => setBaselineText(policyText)}>
                Use draft as baseline
              </button>
              <button type="button" className="ghost" onClick={onDiff}>
                Line diff
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'ledger' && (
        <>
          <div className="panel">
            <h2>Release pipeline</h2>
            <p className="muted">
              Propose as team lead, then each approver signs <strong>Approve</strong> with the same proposal #. After
              timelock, anyone can <strong>Execute</strong> one or more tranches up to the approved cap (recipient needs an
              ATA for the vault mint). If <strong>Artifact gate</strong> is on (Setup), attach a deliverable hash before
              execute. Use <strong>Cancel</strong> as lead while pending or in timelock — not after any tranche has moved
              funds.
            </p>
            <div className="form-grid">
              <div className="field-row">
                <div className="field">
                  <label htmlFor="rel-amt">Proposed cap (smallest units)</label>
                  <input id="rel-amt" type="text" value={relAmount} onChange={(e) => setRelAmount(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="rel-tl">Timelock (seconds)</label>
                  <input id="rel-tl" type="text" value={relTimelock} onChange={(e) => setRelTimelock(e.target.value)} />
                </div>
                <button
                  type="button"
                  className="ghost"
                  style={{ alignSelf: 'flex-end' }}
                  onClick={() => {
                    setErr(null);
                    const r = parsePolicyJson(policyText);
                    if (!r.ok) {
                      setErr(`Cannot read policy for default timelock: ${r.error}`);
                      return;
                    }
                    setRelTimelock(String(policyDefaultTimelockSecs(r.policy)));
                    setStatus(`Timelock set to policy default (${policyDefaultTimelockSecs(r.policy)}s).`);
                  }}
                >
                  Use policy default
                </button>
              </div>
              {policyPayees.length > 0 && (
                <div className="field" style={{ maxWidth: '28rem' }}>
                  <label htmlFor="rel-pick">Payee quick pick (from policy splits)</label>
                  <select
                    id="rel-pick"
                    value={policyPayees.includes(relRecipient.trim()) ? relRecipient.trim() : ''}
                    onChange={(e) => setRelRecipient(e.target.value)}
                  >
                    <option value="">— Paste custom recipient below —</option>
                    {policyPayees.map((pk) => (
                      <option key={pk} value={pk}>
                        {shortAddr(pk, 6, 6)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="rel-rec">Recipient wallet</label>
                <input
                  id="rel-rec"
                  type="text"
                  value={relRecipient}
                  onChange={(e) => setRelRecipient(e.target.value)}
                  placeholder="Recipient pubkey (base58)"
                />
              </div>
            </div>
            <div className="field" style={{ maxWidth: '22rem' }}>
              <label htmlFor="exec-tranche">Execute tranche (smallest units)</label>
              <input
                id="exec-tranche"
                type="text"
                value={execTrancheAmount}
                onChange={(e) => setExecTrancheAmount(e.target.value)}
                placeholder="Leave blank to release full remainder"
              />
            </div>
            <div className="btn-row">
              <button type="button" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onProposeRelease}>
                Propose release
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onApproveRelease}>
                Approve (my wallet)
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onExecuteRelease}>
                Execute
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onCancelProposal}>
                Cancel (lead)
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Artifacts & disputes</h2>
            <p className="muted">
              Same proposal ID for all actions. Open dispute: lead or approver. Resolve: lead only. Execution is blocked
              while <code>dispute_active</code>.
            </p>
            <div className="form-grid">
              <div className="field-row">
                <div className="field" style={{ flex: '0 0 6rem' }}>
                  <label htmlFor="opid">Proposal</label>
                  <input id="opid" type="number" min={0} value={opsProposalId} onChange={(e) => setOpsProposalId(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="ah">Artifact SHA-256 (64 hex)</label>
                <input id="ah" type="text" placeholder="64 hex characters" value={artHex} onChange={(e) => setArtHex(e.target.value)} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="au">URI</label>
                  <input id="au" type="text" value={artUri} onChange={(e) => setArtUri(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="al">Label</label>
                  <input id="al" type="text" value={artLabel} onChange={(e) => setArtLabel(e.target.value)} />
                </div>
              </div>
              <div className="field" style={{ maxWidth: '12rem' }}>
                <label htmlFor="am">Milestone id</label>
                <input id="am" type="text" value={artMilestone} onChange={(e) => setArtMilestone(e.target.value)} />
              </div>
            </div>
            <div className="btn-row">
              <button type="button" disabled={busy || !program || !wallet.publicKey} onClick={onAttachArtifact}>
                Attach artifact
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey} onClick={onOpenDispute}>
                Open dispute
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey} onClick={onResolveDispute}>
                Resolve dispute
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Audit export</h2>
            <p className="muted">JSON bundle of the loaded project, vault fields, and decoded proposals (refresh Overview first).</p>
            <div className="btn-row">
              <button type="button" className="ghost" disabled={!onChain} onClick={onExportAudit}>
                Download JSON
              </button>
              <button type="button" className="ghost" disabled={!onChain} onClick={onExportCsv}>
                Download proposals CSV
              </button>
            </div>
          </div>
        </>
      )}

      <div className="toast-area">
        {err && <p className="error">{err}</p>}
        {status && <pre className="ok">{status}</pre>}
      </div>
    </div>
  );
}
