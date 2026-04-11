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
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import idlJson from '@idl';
import { formatTxError } from './anchorErrors';
import { BRAND_NAME, BRAND_TAGLINE } from './brand';
import { BrandMark } from './BrandMark';
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
import { DashboardTour } from './DashboardTour';
import { clearDashboardTourStorage, readDashboardTour, writeDashboardTour } from './dashboardTourStorage';
import { readOnboarding, type OnboardingPayloadV1 } from './onboardingStorage';
import { ensureWalletAta, recipientAtaForMint } from './splUtil';
import { inferClusterLabel } from './rpcCluster';
import { CLUSTER_LABELS } from './solanaCluster';
import { useClusterTransactionGuard } from './useClusterTransactionGuard';
import { ToastStack, useToast } from './ToastStack';
import { TxSignatureBlock } from './TxSignatureBlock';
import { UxAccordion } from './UxAccordion';
import {
  SectionHeader,
  UxIconAlert,
  UxIconAutomation,
  UxIconCode,
  UxIconDownload,
  UxIconLink,
  UxIconOverview,
  UxIconPath,
  UxIconPause,
  UxIconPolicy,
  UxIconProof,
  UxIconProposals,
  UxIconShare,
  UxIconSetup,
  UxIconToolbox,
  UxIconTreasury,
  UxIconVault,
} from './UxVisual';

const PolicyBuilder = lazy(() => import('./PolicyBuilder').then((m) => ({ default: m.PolicyBuilder })));
const TreasuryAnalytics = lazy(() => import('./TreasuryAnalytics').then((m) => ({ default: m.TreasuryAnalytics })));
const WidgetStudio = lazy(() => import('./WidgetStudio').then((m) => ({ default: m.WidgetStudio })));

function TabSectionFallback() {
  return (
    <div className="panel ux-tab-fallback" aria-busy="true" aria-label="Loading this section">
      <div className="ux-sk ux-sk--bar ux-sk--bar-lg" />
      <div className="ux-sk ux-sk--bar" />
      <div className="ux-sk ux-sk--bar ux-sk--bar-short" />
    </div>
  );
}

const idl = idlJson as Idl;
const PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);

const STORAGE_PDA_SEED_OWNER = 'creator-treasury-pda-seed-owner';

function readStoredPdaSeedOwner(): string {
  if (typeof window === 'undefined') return '';
  const fromOnb = readOnboarding()?.pdaSeedOwner?.trim();
  if (fromOnb) return fromOnb;
  try {
    return window.localStorage.getItem(STORAGE_PDA_SEED_OWNER) ?? '';
  } catch {
    return '';
  }
}

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

function isAllZeroPubkey(pk: PublicKey): boolean {
  return pk.toBytes().every((b) => b === 0);
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
  const [pdaSeedOwnerInput, setPdaSeedOwnerInput] = useState(readStoredPdaSeedOwner);
  const [handoffDestination, setHandoffDestination] = useState('');
  const [policyText, setPolicyText] = useState('');
  const [baselineText, setBaselineText] = useState('');
  const [depositSim, setDepositSim] = useState('1000000');
  const [status, setStatus] = useState<string | null>(null);
  const [statusTxSig, setStatusTxSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { items: toastItems, push: pushToast, dismiss: dismissToast } = useToast();

  const {
    rpcCluster,
    walletCluster,
    mismatch: clusterMismatch,
    walletClusterUnknown,
    rpcClusterLabel,
    genesisError: clusterGenesisError,
    guardBeforeSignTransaction,
  } = useClusterTransactionGuard(connection, wallet);

  const assertTxGuardOk = useCallback(async () => {
    const g = await guardBeforeSignTransaction();
    if (!g.ok && g.message) setErr(g.message);
    return g.ok;
  }, [guardBeforeSignTransaction]);

  const clearStatusLine = useCallback(() => {
    setStatus(null);
    setStatusTxSig(null);
  }, []);

  const [onChain, setOnChain] = useState<{
    project: PublicKey;
    teamLead: string;
    /** Immutable pubkey used in project PDA seeds (original creator unless upgraded). */
    pdaSeedOwner: string;
    /** Pending handoff target, if any. */
    pendingTeamLead: string | null;
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
  const [tab, setTab] = useState<'overview' | 'treasury' | 'setup' | 'policy' | 'ledger' | 'widgets'>('overview');
  const [dashboardTourOpen, setDashboardTourOpen] = useState(false);
  const [quickPathDismissed, setQuickPathDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('web3stronghold-quick-path-dismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const t = pdaSeedOwnerInput.trim();
      if (t) window.localStorage.setItem(STORAGE_PDA_SEED_OWNER, t);
      else window.localStorage.removeItem(STORAGE_PDA_SEED_OWNER);
    } catch {
      /* ignore */
    }
  }, [pdaSeedOwnerInput]);

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

  useEffect(() => {
    const apply = (o: OnboardingPayloadV1 | null | undefined) => {
      if (!o?.complete || o.v !== 1) return;
      setInitName(o.projectName);
      setProjectIdStr(o.projectId);
      setInitApproversText(o.approversText);
      setInitThreshold(o.threshold);
    };
    apply(readOnboarding());
    const onApplied = (e: Event) => {
      apply((e as CustomEvent<OnboardingPayloadV1>).detail);
    };
    window.addEventListener('web3stronghold-onboarding-applied', onApplied);
    return () => window.removeEventListener('web3stronghold-onboarding-applied', onApplied);
  }, []);

  useEffect(() => {
    if (!wallet.publicKey) return;
    if (readDashboardTour()?.completed) return;
    const id = window.setTimeout(() => setDashboardTourOpen(true), 450);
    return () => window.clearTimeout(id);
  }, [wallet.publicKey]);

  const closeDashboardTour = useCallback(() => {
    writeDashboardTour({ completed: true });
    setDashboardTourOpen(false);
  }, []);

  const resetAndOpenDashboardTour = useCallback(() => {
    clearDashboardTourStorage();
    setDashboardTourOpen(false);
    queueMicrotask(() => setDashboardTourOpen(true));
    pushToast('Tour reset — starts from step 1. It will auto-open after sign-in again until you finish or skip.');
  }, [pushToast]);

  const dismissQuickPath = useCallback(() => {
    setQuickPathDismissed(true);
    try {
      window.localStorage.setItem('web3stronghold-quick-path-dismissed', '1');
    } catch {
      /* ignore */
    }
  }, []);

  const showQuickPath = useCallback(() => {
    setQuickPathDismissed(false);
    try {
      window.localStorage.removeItem('web3stronghold-quick-path-dismissed');
    } catch {
      /* ignore */
    }
  }, []);

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

  const projectLoaded = Boolean(onChain);

  const projectSeedPublicKey = useMemo(() => {
    const t = pdaSeedOwnerInput.trim();
    if (t) {
      try {
        return new PublicKey(t);
      } catch {
        return null;
      }
    }
    return wallet.publicKey;
  }, [pdaSeedOwnerInput, wallet.publicKey]);

  const projectPda = useMemo(() => {
    if (!projectSeedPublicKey) return null;
    const id = Number(projectIdStr);
    if (!Number.isFinite(id) || id < 0) return null;
    const buf = Buffer.allocUnsafe(8);
    buf.writeBigUInt64LE(BigInt(id), 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('project'), projectSeedPublicKey.toBuffer(), buf],
      PROGRAM_ID,
    )[0];
  }, [projectSeedPublicKey, projectIdStr]);

  /** PDA for *new* `initialize_project` — always uses the connected wallet as seed (Anchor init constraint). */
  const createProjectPda = useMemo(() => {
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
      team_lead: onChain.pdaSeedOwner,
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

  const widgetProjectDefaults = useMemo(
    () =>
      onChain
        ? {
            teamLead: onChain.pdaSeedOwner,
            projectId: onChain.onChainProjectId,
            rpc: import.meta.env.VITE_RPC_URL,
          }
        : null,
    [onChain],
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
    if (!program || !projectPda) {
      setErr('Enter a valid project number and PDA anchor wallet (or connect your wallet and leave anchor blank).');
      return;
    }
    setBusy(true);
    try {
      // @ts-expect-error account namespace from IDL
      const acc = await program.account.project.fetchNullable(projectPda);
      if (!acc) {
        setOnChain(null);
        setProposals([]);
        pushToast('No project found for this wallet and number yet. Create one under Setup first.', 'info');
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

      const accRec = acc as Record<string, unknown>;
      const pendingPk = (accRec.pendingTeamLead ?? accRec.pending_team_lead) as PublicKey | undefined;
      const pdaSeedPk = (accRec.pdaSeedOwner ?? accRec.pda_seed_owner) as PublicKey | undefined;
      const pdaSeedResolved = pdaSeedPk ? pdaSeedPk.toBase58() : acc.teamLead.toBase58();
      const pendingStr =
        pendingPk && !isAllZeroPubkey(pendingPk) ? pendingPk.toBase58() : null;

      setOnChain({
        project: projectPda,
        teamLead: acc.teamLead.toBase58(),
        pdaSeedOwner: pdaSeedResolved,
        pendingTeamLead: pendingStr,
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
      if (!pdaSeedOwnerInput.trim()) {
        setPdaSeedOwnerInput(pdaSeedResolved);
      }
      pushToast('Project loaded.');
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  }, [program, projectPda, wallet.publicKey, connection, pushToast, pdaSeedOwnerInput]);

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
      pushToast('Rules look valid.');
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
      setStatus(`Fingerprint of your rules (for checking they match on-chain): ${hex32(h)}`);
      setStatusTxSig(null);
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
        setErr('Enter a deposit amount greater than zero (smallest units of the token).');
        return;
      }
      const { lines, holdback, remainder } = simulatePayout(atoms, p);
      const rows = lines.map((l) => `${l.payee}: ${l.amount.toString()}`).join('\n');
      setStatus(
        `Practice run (smallest units):\nHold back: ${holdback}\n${rows}\nLeft over in the vault after splits: ${remainder}`,
      );
      setStatusTxSig(null);
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  const onCopySimulatorLink = async () => {
    setErr(null);
    clearStatusLine();
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
        setErr('That link would be too long for some browsers. Use fewer people or tokens in the rules, then try again.');
        return;
      }
      await navigator.clipboard.writeText(url);
      pushToast('Copied the read-only “what if” link (no wallet needed).');
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  const onApplyPolicy = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !projectPda || !wallet.publicKey) {
      setErr('Connect your wallet first.');
      return;
    }
    let p: TreasuryPolicy;
    try {
      p = parsePolicy();
      const v = validatePolicy(p);
      if (v) {
        setErr(v);
        return;
      }
    } catch (e) {
      setErr(formatTxError(e));
      return;
    }
    if (!(await assertTxGuardOk())) return;
    setBusy(true);
    try {
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
      setStatus('Rules saved on-chain.');
      setStatusTxSig(sig);
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
      setStatusTxSig(null);
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
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    const pid = Number(opsProposalId);
    if (!Number.isFinite(pid) || pid < 0) {
      setErr('Enter a valid payout request number.');
      return;
    }
    const propPda = proposalPdaFromId(onChain.project, pid);
    if (!(await assertTxGuardOk())) return;
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
      setStatus('Delivery proof saved.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onOpenDispute = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    const pid = Number(opsProposalId);
    const propPda = proposalPdaFromId(onChain.project, pid);
    if (!(await assertTxGuardOk())) return;
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
      setStatus('Dispute opened.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onResolveDispute = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    const pid = Number(opsProposalId);
    const propPda = proposalPdaFromId(onChain.project, pid);
    if (!(await assertTxGuardOk())) return;
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
      setStatus('Dispute closed.');
      setStatusTxSig(sig);
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
      pushToast('Imported spreadsheet rows into your split list. Validate, then save on-chain when ready.');
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  const onCreateProject = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !createProjectPda) {
      setErr('Connect your wallet and enter the same project number you use on Overview.');
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
      setErr('Approvals needed must be a whole number between 1 and how many approvers you listed.');
      return;
    }
    if (!(await assertTxGuardOk())) return;
    setBusy(true);
    try {
      const nameBuf = Buffer.from(initName.slice(0, 64), 'utf8');
      const sig = await program.methods
        .initializeProject(new BN(projectIdStr), nameBuf, approvers, th)
        .accounts({
          payer: wallet.publicKey,
          teamLead: wallet.publicKey,
          project: createProjectPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus('Project created.');
      setStatusTxSig(sig);
      setPdaSeedOwnerInput(wallet.publicKey.toBase58());
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onInitVault = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    let mint: PublicKey;
    try {
      mint = new PublicKey(vaultMintStr.trim());
    } catch {
      setErr('That token address does not look valid. Paste the full mint address for the coin you want to hold.');
      return;
    }
    if (
      projectPda &&
      onChain.project &&
      !onChain.project.equals(projectPda)
    ) {
      setErr(
        'Overview’s project number or PDA anchor no longer matches the treasury you loaded. Click Refresh data (or fix those fields) so they match, then try again.',
      );
      return;
    }
    if (!(await assertTxGuardOk())) return;
    setBusy(true);
    try {
      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), onChain.project.toBuffer()],
        PROGRAM_ID,
      );
      const vaultAta = getAssociatedTokenAddressSync(mint, vaultState, true);
      const sig = await program.methods
        .initializeVault()
        .accounts({
          payer: wallet.publicKey,
          teamLead: wallet.publicKey,
          project: onChain.project,
          mint,
          vaultState,
          vaultTokenAccount: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      setStatus('Vault is ready for this token.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onDeposit = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain?.mint) {
      setErr('Finish vault setup first (Setup → turn the vault on).');
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
    if (!(await assertTxGuardOk())) return;
    setBusy(true);
    try {
      const mint = new PublicKey(onChain.mint);
      const depositorAta = await ensureWalletAta(connection, wallet, mint);
      const depBal = await connection.getTokenAccountBalance(depositorAta);
      const depBalBn = new BN(depBal.value.amount);
      if (amount.gt(depBalBn)) {
        setErr(
          `That deposit (${amount.toString()} in the token’s smallest units) is more than this wallet holds for this mint (${depBalBn.toString()}). ` +
            `Try a smaller amount, or send yourself more of this token on ${rpcClusterLabel} first (mint ${onChain.mint}).`,
        );
        return;
      }
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
      setStatus('Deposit submitted.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onProposeRelease = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    let recipient: PublicKey;
    try {
      recipient = new PublicKey(relRecipient.trim());
    } catch {
      setErr('That recipient wallet address does not look valid.');
      return;
    }
    const parsedForGate = parsePolicyJson(policyText);
    if (
      parsedForGate.ok &&
      !isRecipientAllowedByPolicy(parsedForGate.policy, relRecipient.trim())
    ) {
      setErr(
        'Your rules only allow paying wallets that are listed in the split. Pick someone from that list, or turn off “Restrict proposals” on the Policy tab.',
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
    if (!(await assertTxGuardOk())) return;
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
      setStatus(`Payout request #${nextId} created.`);
      setStatusTxSig(sig);
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
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) return;
    const pid = Number(opsProposalId);
    if (!Number.isInteger(pid) || pid < 0) {
      setErr('Enter a valid payout request number.');
      return;
    }
    const proposalPda = proposalPdaFromId(onChain.project, pid);
    if (!(await assertTxGuardOk())) return;
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
      setStatus('Your approval was recorded.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onExecuteRelease = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain?.mint) {
      setErr('Load your project and finish vault setup first.');
      return;
    }
    const pid = Number(opsProposalId);
    if (!Number.isInteger(pid) || pid < 0) {
      setErr('Enter a valid payout request number.');
      return;
    }
    const prop = proposals.find((p) => p.proposalId === String(pid));
    if (!prop) {
      setErr('That payout request is not in the list. Go to Overview and tap Refresh data.');
      return;
    }
    if (onChain.requireArtifactForExecute && isZeroArtifactSha256Hex(prop.artifactSha256Hex)) {
      setErr(
        'This team requires a delivery proof before money can be sent. Add one under Proposals → Proof & disputes.',
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
        setErr('There is nothing left to pay out for this request within the approved limit.');
        return;
      }
      releaseBn = remainderBn;
    } else {
      let parsed: BN;
      try {
        parsed = new BN(rawExec, 10);
      } catch {
        setErr('Payment amount must be a whole number (use the smallest unit of your token, same as your wallet often shows).');
        return;
      }
      if (parsed.lte(new BN(0))) {
        setErr('Enter a payment amount greater than zero.');
        return;
      }
      if (parsed.gt(remainderBn)) {
        setErr(`That amount is more than what is left to pay on this request (${remainderBn.toString()} smallest units remaining).`);
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
    if (!(await assertTxGuardOk())) return;
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
      setStatus('Payment sent.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onCancelProposal = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) return;
    const pid = Number(opsProposalId);
    if (!Number.isInteger(pid) || pid < 0) {
      setErr('Enter a valid payout request number.');
      return;
    }
    const proposalPda = proposalPdaFromId(onChain.project, pid);
    if (!(await assertTxGuardOk())) return;
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
      setStatus('Payout request cancelled.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onSetFrozen = async (frozen: boolean) => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) return;
    if (!(await assertTxGuardOk())) return;
    setBusy(true);
    try {
      const sig = await program.methods
        .setFrozen(frozen)
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
        })
        .rpc();
      setStatus(frozen ? 'Payouts are paused (emergency stop on).' : 'Payouts are unpaused.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onSetRequireArtifact = async (require: boolean) => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) return;
    if (!(await assertTxGuardOk())) return;
    setBusy(true);
    try {
      const sig = await program.methods
        .setRequireArtifact(require)
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
        })
        .rpc();
      setStatus(
        require ? 'Delivery proof now required before paying out.' : 'Delivery proof no longer required to pay out.',
      );
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onBeginTeamLeadHandoff = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    const dest = handoffDestination.trim();
    if (!dest) {
      setErr('Paste the new team lead’s Solana wallet address.');
      return;
    }
    let destPk: PublicKey;
    try {
      destPk = new PublicKey(dest);
    } catch {
      setErr('That new team lead address does not look valid.');
      return;
    }
    if (!(await assertTxGuardOk())) return;
    setBusy(true);
    try {
      const sig = await program.methods
        .beginTeamLeadTransfer(destPk)
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
        })
        .rpc();
      setStatus('Handoff started — the new wallet must sign “Complete handoff”.');
      setStatusTxSig(sig);
      setHandoffDestination('');
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onAcceptTeamLeadHandoff = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    if (!onChain.pendingTeamLead) {
      setErr('There is no pending handoff for this project.');
      return;
    }
    if (wallet.publicKey.toBase58() !== onChain.pendingTeamLead) {
      setErr('Connect the wallet that was invited — it must match the pending address.');
      return;
    }
    if (!(await assertTxGuardOk())) return;
    setBusy(true);
    try {
      const sig = await program.methods
        .acceptTeamLeadTransfer()
        .accounts({
          newTeamLead: wallet.publicKey,
          project: onChain.project,
        })
        .rpc();
      setStatus('You are now the team lead for this project.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onCancelTeamLeadHandoff = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) return;
    if (!onChain.pendingTeamLead) {
      setErr('There is no pending handoff to cancel.');
      return;
    }
    if (!(await assertTxGuardOk())) return;
    setBusy(true);
    try {
      const sig = await program.methods
        .cancelTeamLeadTransfer()
        .accounts({
          teamLead: wallet.publicKey,
          project: onChain.project,
        })
        .rpc();
      setStatus('Handoff cancelled.');
      setStatusTxSig(sig);
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
    clearStatusLine();
    if (!program || !wallet.publicKey || !projectPda) {
      setErr('Connect your wallet and set the project number.');
      return;
    }
    const pid = Number(projectIdStr);
    if (!Number.isInteger(pid) || pid < 0) {
      setErr('Enter a valid project number (0 or higher).');
      return;
    }
    if (!(await assertTxGuardOk())) return;
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
      setStatus('Project upgraded for automation (one-time step).');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onConfigureAutomation = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain) {
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    const mode = Number(autoMode);
    if (mode !== AUTOMATION_MODE_NONE && mode !== AUTOMATION_MODE_SPLIT) {
      setErr('Choose Off or Split payouts in the mode menu.');
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
        setErr('Add 1–8 wallet addresses that should receive split payouts.');
        return;
      }
      if (bparts.length !== rparts.length) {
        setErr('Each wallet needs a matching share number — same count in both boxes.');
        return;
      }
      try {
        recipients = rparts.map((s) => new PublicKey(s));
      } catch {
        setErr('That recipient wallet address does not look valid.');
        return;
      }
      for (const b of bparts) {
        if (!Number.isInteger(b) || b < 0 || b > 10_000) {
          setErr('Each share must be a whole number from 0 to 10,000 (points out of 10,000).');
          return;
        }
      }
      const sum = bparts.reduce((a, b) => a + b, 0);
      if (sum <= 0 || sum > 10_000) {
        setErr('Shares must add up to between 1 and 10,000 points.');
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
        setErr('Max amount per run must be greater than zero (smallest units of your token).');
        return;
      }
    }
    let nextBn: BN;
    if (autoNextTs.trim()) {
      try {
        nextBn = new BN(autoNextTs.trim(), 10);
        if (nextBn.isNeg()) throw new Error('neg');
      } catch {
        setErr('Next run time must be a valid Unix timestamp in seconds (or leave blank to start from now).');
        return;
      }
    } else {
      nextBn = new BN(Math.floor(Date.now() / 1000));
    }
    if (!(await assertTxGuardOk())) return;
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
      setStatus('Automation settings saved.');
      setStatusTxSig(sig);
      await loadOnChain();
    } catch (e) {
      setErr(formatTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onCrankAutomation = async () => {
    setErr(null);
    clearStatusLine();
    if (!program || !wallet.publicKey || !onChain?.mint) {
      setErr('Load your project and finish vault setup first.');
      return;
    }
    if (!(await assertTxGuardOk())) return;
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
        setErr('Set up split payouts first, then try running them.');
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
      setStatus('Automation run finished.');
      setStatusTxSig(sig);
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
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    downloadTextFile(`web3stronghold-proposals-${onChain.onChainProjectId}.csv`, proposalsToCsv(proposals));
    pushToast('Payout list downloaded as CSV.');
  };

  const onExportAudit = () => {
    setErr(null);
    if (!onChain) {
      setErr('Load your project first (Overview → Refresh data).');
      return;
    }
    const pkg: AuditPackage = {
      exportedAt: new Date().toISOString(),
      rpc: connection.rpcEndpoint,
      programId: PROGRAM_ID.toBase58(),
      projectPda: onChain.project.toBase58(),
      teamLead: onChain.teamLead,
      pdaSeedOwner: onChain.pdaSeedOwner,
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
    downloadJson(`web3stronghold-audit-${onChain.onChainProjectId}.json`, pkg);
    pushToast('Audit file downloaded.');
  };

  return (
    <div className={`app${tab === 'ledger' ? ' app--ledger-tab' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <BrandMark className="brand-mark" />
          <div>
            <h1>{BRAND_NAME}</h1>
            <p className="tagline">{BRAND_TAGLINE}</p>
            {wallet.publicKey ? (
              <div className="app-header__aux-links" role="group" aria-label="Help and guided tour">
                <button
                  type="button"
                  className="app-header__tour-btn"
                  onClick={() => setDashboardTourOpen(true)}
                  aria-label="Open guided app tour"
                >
                  App tour
                </button>
                <span className="app-header__aux-sep" aria-hidden>
                  ·
                </span>
                <button
                  type="button"
                  className="app-header__tour-btn"
                  onClick={resetAndOpenDashboardTour}
                  aria-label="Reset guided tour and open from step 1"
                >
                  Reset tour
                </button>
                {quickPathDismissed ? (
                  <>
                    <span className="app-header__aux-sep" aria-hidden>
                      ·
                    </span>
                    <button
                      type="button"
                      className="app-header__tour-btn"
                      onClick={showQuickPath}
                      aria-label="Show quick path checklist"
                    >
                      Quick path
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="app-header__wallet" data-tour="tour-wallet">
          <span className="rpc-cluster-badge" title={connection.rpcEndpoint}>
            {inferClusterLabel(connection.rpcEndpoint)}
          </span>
          <WalletMultiButton />
          <p className="muted app-header__wallet-hint">
            Disconnect or switch accounts from your wallet, including the in-browser email wallet.
          </p>
        </div>
      </header>

      {!wallet.publicKey ? (
        <div className="start-here-strip" role="region" aria-label="Getting started">
          <div className="start-here-strip__art" aria-hidden>
            <UxIconPath />
          </div>
          <div className="start-here-strip__content">
            <strong className="start-here-strip__head">Start here</strong>
            <ol className="start-here-strip__steps">
              <li>
                <strong>Sign in</strong> — Wallet extension or email wallet (header).
              </li>
              <li>
                <strong>Project #</strong> — Match onboarding; fix in Setup if needed.
              </li>
              <li>
                <strong>Overview → Refresh</strong> — Load balances and payout queue.
              </li>
            </ol>
          </div>
        </div>
      ) : null}

      {clusterGenesisError ||
      (wallet.connected && rpcCluster !== 'unknown' && (clusterMismatch || walletClusterUnknown)) ? (
        <div
          className={`cluster-alignment-banner${
            clusterGenesisError || clusterMismatch ? ' cluster-alignment-banner--danger' : ''
          }`}
          role={clusterGenesisError || clusterMismatch ? 'alert' : 'status'}
        >
          <div className="cluster-alignment-banner__inner">
            <div className="cluster-alignment-banner__icon" aria-hidden>
              {clusterGenesisError || clusterMismatch ? <UxIconAlert /> : <UxIconPath />}
            </div>
            <div className="cluster-alignment-banner__body">
              {clusterGenesisError ? (
                <p className="cluster-alignment-banner__text">{clusterGenesisError}</p>
              ) : clusterMismatch ? (
                <p className="cluster-alignment-banner__text">
                  <strong>Network mismatch:</strong> This app is on <strong>{rpcClusterLabel}</strong> (from your RPC), but
                  your wallet reported <strong>{walletCluster ? CLUSTER_LABELS[walletCluster] : '—'}</strong>. Signing may
                  fail — switch your wallet to the same network or change <code>VITE_RPC_URL</code>.
                </p>
              ) : (
                <p className="cluster-alignment-banner__text">
                  <strong>Wallet network unknown.</strong> This app uses <strong>{rpcClusterLabel}</strong>. Confirm your
                  wallet extension is set to that network before signing; you will be asked once per browser session if we
                  still cannot detect it.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {wallet.publicKey && !quickPathDismissed ? (
        <section className="quick-path-strip" aria-labelledby="quick-path-heading">
          <div className="quick-path-strip__head">
            <h2 id="quick-path-heading" className="quick-path-strip__title">
              Quick path
            </h2>
            <button type="button" className="ghost quick-path-strip__dismiss" onClick={dismissQuickPath}>
              Hide
            </button>
          </div>
          <ol className="quick-path-strip__steps">
            <li>
              <strong>Project #</strong> — One number on Overview, Setup, and chain.
            </li>
            <li>
              <strong>Refresh Overview</strong> — Sync vault, rules, and payout queue.
            </li>
            <li>
              <strong>Policy</strong> — Who can be paid; set before you spend.
            </li>
            <li>
              <strong>Proposals</strong> — Queue, approve, execute payouts.
            </li>
            <li>
              <strong>Share</strong> — Optional read-only links for others.
            </li>
          </ol>
        </section>
      ) : null}

      <div className="tabs-mobile-wrap">
        <label htmlFor="main-section-select" className="sr-only">
          Main section
        </label>
        <select
          id="main-section-select"
          className="tabs-mobile-select"
          value={tab}
          onChange={(e) => setTab(e.target.value as typeof tab)}
          aria-label="Main section"
        >
          <option value="overview">Overview</option>
          <option value="treasury">Treasury</option>
          <option value="setup">Setup</option>
          <option value="policy">Policy</option>
          <option value="ledger">Proposals</option>
          <option value="widgets">Share</option>
        </select>
      </div>

      <nav className="tabs tabs--scroll" role="tablist" aria-label="Main sections" data-tour="tour-tabs">
        <button type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
          <span className="tab-btn__glyph" aria-hidden>
            <UxIconOverview />
          </span>
          <span className="tab-btn__label">Overview</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'treasury'}
          onClick={() => setTab('treasury')}
          aria-label={
            !projectLoaded && wallet.publicKey ? 'Treasury — load project on Overview first' : 'Treasury'
          }
        >
          <span className="tab-btn__glyph" aria-hidden>
            <UxIconTreasury />
          </span>
          <span className="tab-btn__label">
            Treasury
            {!projectLoaded && wallet.publicKey ? (
              <span className="tab-needs-load" title="Load project on Overview first" aria-hidden>
                ●
              </span>
            ) : null}
          </span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'setup'} onClick={() => setTab('setup')}>
          <span className="tab-btn__glyph" aria-hidden>
            <UxIconSetup />
          </span>
          <span className="tab-btn__label">Setup</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'policy'} onClick={() => setTab('policy')}>
          <span className="tab-btn__glyph" aria-hidden>
            <UxIconPolicy />
          </span>
          <span className="tab-btn__label">Policy</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'ledger'}
          onClick={() => setTab('ledger')}
          aria-label={!projectLoaded && wallet.publicKey ? 'Proposals — load project on Overview first' : 'Proposals'}
        >
          <span className="tab-btn__glyph" aria-hidden>
            <UxIconProposals />
          </span>
          <span className="tab-btn__label">
            Proposals
            {!projectLoaded && wallet.publicKey ? (
              <span className="tab-needs-load" title="Load project on Overview first" aria-hidden>
                ●
              </span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'widgets'}
          onClick={() => setTab('widgets')}
          aria-label={!projectLoaded && wallet.publicKey ? 'Share — load project on Overview first' : 'Share'}
        >
          <span className="tab-btn__glyph" aria-hidden>
            <UxIconShare />
          </span>
          <span className="tab-btn__label">
            Share
            {!projectLoaded && wallet.publicKey ? (
              <span className="tab-needs-load" title="Load project on Overview first" aria-hidden>
                ●
              </span>
            ) : null}
          </span>
        </button>
      </nav>

      {tab === 'overview' && (
        <div className="panel">
          <SectionHeader icon={<UxIconOverview />} title="Your project" />
          <p className="muted">
            Enter the <strong>project number</strong>, then load from Solana. Lookup uses the <strong>PDA anchor wallet</strong>{' '}
            below (defaults to your connected wallet — the creator when the project was first made). Email wallets work
            the same as Phantom/Solflare; if a button stays greyed out, you usually still need to tap <strong>Refresh data</strong>{' '}
            here first. After handing team lead to another wallet, keep the <strong>original</strong> creator address in
            the anchor field so the app finds the same on-chain project.
          </p>
          <div className="field-row" data-tour="tour-overview-actions">
            <div className="field" style={{ flex: '0 0 7.5rem' }}>
              <label htmlFor="pid">Project number</label>
              <input
                id="pid"
                type="number"
                min={0}
                value={projectIdStr}
                onChange={(e) => setProjectIdStr(e.target.value)}
                aria-describedby="pid-hint"
              />
            </div>
            <button
              type="button"
              className="ghost"
              disabled={busy || !program || !projectPda}
              onClick={() => {
                clearStatusLine();
                void loadOnChain();
              }}
            >
              {busy ? 'Loading…' : 'Refresh data'}
            </button>
          </div>
          <div className="field" style={{ marginTop: '0.5rem' }}>
            <label htmlFor="pda-seed">PDA anchor wallet (for lookup)</label>
            <input
              id="pda-seed"
              type="text"
              spellCheck={false}
              value={pdaSeedOwnerInput}
              onChange={(e) => setPdaSeedOwnerInput(e.target.value)}
              placeholder="Leave blank to use your connected wallet"
              aria-describedby="pid-hint"
            />
          </div>
          <p id="pid-hint" className="muted field-hint">
            Must match the number you used under Setup. The anchor wallet + number decide the on-chain project address.
            Amounts elsewhere are in the token’s smallest units (see field hints).
          </p>
          <div data-tour="tour-overview-stats">
          {wallet.publicKey && !busy && !onChain ? (
            <div className="ux-empty-hint" role="status">
              <div className="ux-empty-hint__art" aria-hidden>
                <UxIconVault />
              </div>
              <p>
                Tap <strong>Refresh data</strong> to load your vault balance, rules version, and payout requests from
                Solana.
              </p>
            </div>
          ) : null}
          {busy && !onChain ? (
            <div className="ux-overview-skeleton" aria-busy="true" aria-label="Loading project data">
              <div className="ux-sk-grid">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="ux-sk ux-sk--tile" />
                ))}
              </div>
              <div className="ux-sk ux-sk--bar ux-sk--bar-lg" style={{ marginTop: '0.75rem' }} />
            </div>
          ) : null}
          {projectPda && (
            <p className="muted">
              On-chain project address: <code>{projectPda.toBase58()}</code>
            </p>
          )}
          {onChain && (
            <>
              <div className="stat-grid">
                <div className="stat" data-accent="sky">
                  <div className="stat-label">Rules version</div>
                  <div className="stat-value">{onChain.policyVersion}</div>
                </div>
                <div className="stat" data-accent="mint">
                  <div className="stat-label">Next payout #</div>
                  <div className="stat-value">{onChain.nextProposalId}</div>
                </div>
                <div className="stat" data-accent="amber">
                  <div className="stat-label">Vault ready</div>
                  <div className="stat-value">{onChain.vaultInitialized ? 'Yes' : 'Not yet'}</div>
                </div>
                <div className="stat" data-accent="sky">
                  <div className="stat-label">Vault balance</div>
                  <div className="stat-value">{onChain.vaultBalance ?? '—'}</div>
                </div>
                <div className="stat" data-accent="rose">
                  <div className="stat-label">Payouts paused</div>
                  <div className="stat-value">{onChain.frozen ? 'Yes' : 'No'}</div>
                </div>
                <div className="stat" data-accent="mint">
                  <div className="stat-label">Proof before pay</div>
                  <div className="stat-value">{onChain.requireArtifactForExecute ? 'Required' : 'Off'}</div>
                </div>
              </div>
              <pre className="data-block">
                {`Team lead (operates payouts): ${shortAddr(onChain.teamLead, 6, 6)}
Team lead full: ${onChain.teamLead}
PDA anchor (lookup / links): ${shortAddr(onChain.pdaSeedOwner, 6, 6)}
PDA anchor full: ${onChain.pdaSeedOwner}
${onChain.pendingTeamLead ? `Pending handoff to: ${onChain.pendingTeamLead}\n` : ''}Project number: ${onChain.onChainProjectId}
Rules fingerprint: ${onChain.policyHashHex}
Delivery proof required to pay: ${onChain.requireArtifactForExecute ? 'yes' : 'no'}
Token in vault: ${onChain.mint ? shortAddr(onChain.mint, 6, 6) : '—'}
Token full address: ${onChain.mint ?? '—'}`}
              </pre>
              <p className="muted" style={{ marginTop: '0.75rem' }}>
                Share a <strong>read-only</strong> view (no wallet needed): anyone with the link can see balances and
                status.
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
                      pushToast('Copied public status link.');
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
                      pushToast('Copied embed link for a website iframe.');
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
          </div>
          {proposals.length > 0 && (
            <div className="proposal-list" aria-label="Payout requests">
              {proposals.map((p) => (
                <div key={p.proposalId} className={`proposal-card proposal-card--st-${p.statusCode}`}>
                  <div className="proposal-card-top">
                    <span className={badgeClassForStatus(p.statusCode)}>{p.status}</span>
                    <span className="proposal-meta">Proposal #{p.proposalId}</span>
                  </div>
                  <div className="proposal-meta">
                    Limit {p.amount} · paid {p.releasedSoFar} → {shortAddr(p.recipient)} · rules v{p.policyVersionAtProposal}
                    {p.disputeActive ? ' · in dispute' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          <details className="overview-help-details">
            <summary className="overview-help-details__summary">Help — guided tour & this device</summary>
            <p className="muted overview-help-details__body">
              <strong>App tour</strong> opens the vault setup walkthrough. <strong>Reset tour</strong> clears completion on
              this browser, opens from step 1, and restores the automatic tour after sign-in until you finish or skip.
              The same shortcuts appear under the brand in the header.
            </p>
            <div className="overview-help-details__actions">
              <button type="button" className="ghost" onClick={() => setDashboardTourOpen(true)}>
                App tour
              </button>
              <button type="button" className="ghost" onClick={resetAndOpenDashboardTour}>
                Reset tour
              </button>
            </div>
          </details>
        </div>
      )}

      {tab === 'treasury' && (
        <div className="panel">
          <SectionHeader icon={<UxIconTreasury />} title="Treasury snapshot" />
          <p className="muted">
            See how much sits in the vault, how much is promised but not yet paid, and how much has already gone out on
            approved payout requests. Choose who can see these charts in <em>this</em> browser.
          </p>
          <div className="treasury-visibility-toggle" role="group" aria-label="Who can see treasury charts">
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
            <strong>Private</strong> — only people whose wallets are on the approver list see the charts.{' '}
            <strong>Public</strong> — anyone using this browser with the same wallet and project number can see the charts,
            even if they are not an approver. This choice is saved only on your device; it does not change who can approve
            payouts on-chain.
          </p>
          {treasuryVisibility === 'public' && onChain && canViewTreasuryAnalytics && wallet.publicKey && (
            <p className="treasury-public-banner" role="status">
              You turned on public view — numbers show without checking if you are an approver. Data still comes from the
              Solana network for the project you loaded.
            </p>
          )}
          {!wallet.publicKey ? (
            <p className="muted">Connect your wallet to continue.</p>
          ) : !onChain ? (
            <p className="muted">Open the Overview tab and tap Refresh data first.</p>
          ) : !canViewTreasuryAnalytics ? (
            <p className="muted">
              This wallet is not on the approver list. Turn on <strong>Public</strong> above to see charts anyway on this
              device, or connect with a wallet that can approve payouts.
            </p>
          ) : (
            <Suspense fallback={<TabSectionFallback />}>
              <TreasuryAnalytics
                proposals={proposals}
                vaultInitialized={onChain.vaultInitialized}
                vaultAmountRaw={onChain.vaultAmountRaw}
                vaultDecimals={onChain.vaultInitialized ? onChain.vaultDecimals : 6}
                mint={onChain.mint}
              />
            </Suspense>
          )}
          <div className="btn-row" style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="ghost"
              disabled={busy || !program || !projectPda}
              onClick={() => {
                clearStatusLine();
                void loadOnChain();
              }}
            >
              {busy ? 'Refreshing…' : 'Refresh numbers'}
            </button>
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <>
          <div className="panel" data-tour="tour-setup-project">
            <SectionHeader icon={<UxIconSetup />} title="Create your team project" />
            <p className="muted">
              Use the same <strong>project number</strong> as on Overview. List everyone who can approve payouts —{' '}
              <strong>your wallet must be first</strong>. One Solana wallet address per line (or separate with commas).
            </p>
            <div className="field-row">
              <div className="field" style={{ flex: '0 0 7.5rem' }}>
                <label htmlFor="setup-pid">Project number</label>
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
              <label htmlFor="pname">Team name</label>
              <input id="pname" type="text" value={initName} onChange={(e) => setInitName(e.target.value)} maxLength={64} />
            </div>
            <div className="field">
              <label htmlFor="approvers">Who can approve payouts</label>
              <textarea
                id="approvers"
                className="compact"
                value={initApproversText}
                onChange={(e) => setInitApproversText(e.target.value)}
                spellCheck={false}
                placeholder="Your wallet address first, then teammates (one per line)"
              />
            </div>
            <div className="field" style={{ maxWidth: '8rem' }}>
              <label htmlFor="thr">Approvals needed</label>
              <input id="thr" type="number" min={1} max={5} value={initThreshold} onChange={(e) => setInitThreshold(e.target.value)} />
            </div>
            <p className="muted" style={{ marginTop: '-0.25rem', fontSize: '0.82rem' }}>
              How many approvers must sign before a payout can go out (between 1 and the number of wallets you listed).
            </p>
            <div className="btn-row">
              <button type="button" disabled={busy || !program || !wallet.publicKey || !createProjectPda} onClick={onCreateProject}>
                Create project
              </button>
            </div>
          </div>

          <div className="panel" data-tour="tour-setup-vault">
            <SectionHeader icon={<UxIconVault />} title="Vault & deposits" />
            <p className="muted">
              Pick <strong>which token</strong> the vault should hold (paste its <strong>mint address</strong> — the same
              long address your wallet uses for that coin, e.g. devnet USDC). You only turn the vault on once. Deposits
              move tokens from your wallet into the team vault; if your wallet does not have an account for that token yet,
              we create it for you.
            </p>
            {!onChain ? (
              <p className="muted">
                Buttons stay disabled until the project is loaded — open <strong>Overview</strong> and tap{' '}
                <strong>Refresh data</strong>. Email wallets work the same as browser wallets here.
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="mint">Token mint address</label>
              <input
                id="mint"
                type="text"
                value={vaultMintStr}
                onChange={(e) => setVaultMintStr(e.target.value)}
                placeholder="Paste the token mint address from a block explorer or wallet"
              />
            </div>
            <div className="btn-row">
              <button
                type="button"
                disabled={busy || !program || !wallet.publicKey || !onChain || onChain.vaultInitialized}
                onClick={onInitVault}
              >
                Turn vault on for this token
              </button>
            </div>
            <div className="field-row" style={{ marginTop: '0.75rem' }}>
              <div className="field">
                <label htmlFor="depamt">Amount to deposit (smallest units)</label>
                <input id="depamt" type="text" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
              </div>
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain?.vaultInitialized}
                onClick={onDeposit}
              >
                Deposit into vault
              </button>
            </div>
            <p className="muted" style={{ marginTop: '0.35rem', fontSize: '0.82rem' }}>
              “Smallest units” are the tiny increments of the token (often what wallets show as the raw number before
              decimals).
            </p>
          </div>

          <div className="panel">
            <SectionHeader icon={<UxIconPause />} title="Emergency pause" />
            <p className="muted">
              While paused, <strong>new payout requests and payments stop</strong>. Deposits can still arrive. Team lead
              only.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain || onChain.frozen}
                onClick={() => onSetFrozen(true)}
              >
                Pause payouts
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain || !onChain.frozen}
                onClick={() => onSetFrozen(false)}
              >
                Resume payouts
              </button>
            </div>
          </div>

          <div className="panel">
            <SectionHeader icon={<UxIconProof />} title="Proof before paying" />
            <p className="muted">
              When this is on, the team must attach a <strong>delivery proof</strong> (a file fingerprint) to a payout
              request before money can be sent. Good for milestones. Team lead only.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain || onChain.requireArtifactForExecute}
                onClick={() => onSetRequireArtifact(true)}
              >
                Require proof before paying
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain || !onChain.requireArtifactForExecute}
                onClick={() => onSetRequireArtifact(false)}
              >
                Allow paying without proof
              </button>
            </div>
          </div>

          <div className="panel">
            <SectionHeader icon={<UxIconPath />} title="Hand off team lead (different wallet)" />
            <p className="muted">
              Two steps so each wallet signs with its own key: the <strong>current</strong> team lead starts the handoff,
              then the <strong>new</strong> wallet connects and completes it. The on-chain project address does not move;
              public links keep using the <strong>PDA anchor</strong> from Overview.
            </p>
            {onChain?.pendingTeamLead ? (
              <p className="muted">
                Pending invite for: <code>{shortAddr(onChain.pendingTeamLead, 6, 6)}</code>
              </p>
            ) : (
              <p className="muted">No handoff pending.</p>
            )}
            <div className="field">
              <label htmlFor="handoff-to">New team lead wallet address</label>
              <input
                id="handoff-to"
                type="text"
                spellCheck={false}
                value={handoffDestination}
                onChange={(e) => setHandoffDestination(e.target.value)}
                placeholder="Paste the Solana address that should become team lead"
              />
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain}
                onClick={() => void onBeginTeamLeadHandoff()}
              >
                Start handoff (current lead)
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain}
                onClick={() => void onAcceptTeamLeadHandoff()}
              >
                Complete handoff (pending wallet)
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy || !program || !wallet.publicKey || !onChain}
                onClick={() => void onCancelTeamLeadHandoff()}
              >
                Cancel handoff (current lead)
              </button>
            </div>
          </div>

          <div className="panel">
            <SectionHeader icon={<UxIconAutomation />} title="Automatic split payouts (advanced)" />
            <p className="muted">
              Periodically move a capped amount from the vault and split it across wallets by share. Anyone can trigger a
              run after the wait time; your wallet pays the small Solana network fee. Older projects may need the one-time
              upgrade first.
            </p>
            <UxAccordion title="Show automation controls" storageKey="ct-ux-setup-auto">
              <div className="btn-row">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || !program || !wallet.publicKey || !projectPda}
                  onClick={onUpgradeProjectLayout}
                >
                  One-time upgrade for automation
                </button>
              </div>
              <div className="field-row" style={{ marginTop: '0.75rem' }}>
              <div className="field" style={{ maxWidth: '8rem' }}>
                <label htmlFor="amode">Mode</label>
                <select id="amode" value={autoMode} onChange={(e) => setAutoMode(e.target.value)}>
                  <option value={String(AUTOMATION_MODE_NONE)}>Off</option>
                  <option value={String(AUTOMATION_MODE_SPLIT)}>Split payouts</option>
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
                <label htmlFor="aint">Wait between runs (seconds)</label>
                <input id="aint" type="text" value={autoInterval} onChange={(e) => setAutoInterval(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="amax">Max per run (smallest units)</label>
                <input id="amax" type="text" value={autoMaxPerTick} onChange={(e) => setAutoMaxPerTick(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="anext">Next run after (Unix time, blank = now)</label>
                <input id="anext" type="text" value={autoNextTs} onChange={(e) => setAutoNextTs(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="arec">Wallets to pay (comma or new line)</label>
              <textarea
                id="arec"
                className="compact"
                value={autoRecipientsText}
                onChange={(e) => setAutoRecipientsText(e.target.value)}
                spellCheck={false}
                placeholder="One wallet address per line"
              />
            </div>
            <div className="field">
              <label htmlFor="abps">Share per wallet (points out of 10,000 — same order)</label>
              <input
                id="abps"
                type="text"
                value={autoBpsText}
                onChange={(e) => setAutoBpsText(e.target.value)}
                placeholder="e.g. 5000,5000 for a 50/50 split"
              />
            </div>
            <div className="btn-row">
              <button type="button" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onConfigureAutomation}>
                Save automation
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onCrankAutomation}>
                Run once now (your wallet pays the fee)
              </button>
            </div>
            </UxAccordion>
          </div>
        </>
      )}

      {tab === 'policy' && (
        <>
          <Suspense fallback={<TabSectionFallback />}>
            <PolicyBuilder
              policyText={policyText}
              onPolicyTextChange={setPolicyText}
              teamLead={wallet.publicKey?.toBase58() ?? null}
            />
          </Suspense>

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
                  <SectionHeader icon={<UxIconLink />} title="Match rules to vault settings" />
                  <p className="muted">
                    These rules suggest requiring a delivery proof before paying (typical for milestones). Turn that on
                    under Setup so the chain matches.
                  </p>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy || !program || !wallet.publicKey}
                      onClick={() => onSetRequireArtifact(true)}
                    >
                      Require proof before paying (on-chain)
                    </button>
                  </div>
                </div>
              );
            })()}

          <div className="panel" data-tour="tour-policy-apply">
            <div className="policy-advanced-head">
              <SectionHeader
                icon={<UxIconCode />}
                title="Advanced — raw rules file"
                className="section-header--inline"
              />
              <button type="button" className="ghost" onClick={() => setShowAdvancedPolicy((v) => !v)}>
                {showAdvancedPolicy ? 'Hide' : 'Show'}
              </button>
            </div>
            {showAdvancedPolicy && (
              <>
                <p className="muted">
                  For developers: edit the full rules JSON here. We fingerprint it in your browser; only the fingerprint is
                  saved on-chain when you apply.
                </p>
                <textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} spellCheck={false} />
              </>
            )}
            <div className="btn-row" style={{ marginTop: showAdvancedPolicy ? '0.75rem' : 0 }}>
              <button type="button" className="ghost" onClick={onValidate}>
                Check rules
              </button>
              <button type="button" className="ghost" onClick={onHash}>
                Show fingerprint
              </button>
              <button type="button" disabled={busy || !program || !wallet.publicKey} onClick={onApplyPolicy}>
                Save rules on-chain
              </button>
            </div>
          </div>

          <div className="panel">
            <SectionHeader icon={<UxIconToolbox />} title="More policy tools" />
            <p className="muted">
              Shareable calculator, spreadsheet import, and diff — tucked away until you need them.
            </p>
            <UxAccordion title="Open calculator, import & compare" storageKey="ct-ux-policy-extra">
              <div className="policy-tools-section">
                <SectionHeader icon={<UxIconShare />} title="“What if” calculator (shareable link)" level="sub" />
                <p className="muted">
                  Send finance a read-only link to try deposit math — no wallet. The rules are tucked inside the link, so
                  keep the team small if the link gets long.
                </p>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="dep">Sample deposit (smallest units)</label>
                    <input
                      id="dep"
                      type="text"
                      value={depositSim}
                      onChange={(e) => setDepositSim(e.target.value)}
                      aria-describedby="units-hint-policy"
                    />
                  </div>
                  <button type="button" className="ghost" onClick={onSimulate}>
                    Try it here
                  </button>
                  <button type="button" className="ghost" onClick={onCopySimulatorLink}>
                    Copy link
                  </button>
                </div>
                <p id="units-hint-policy" className="muted field-hint">
                  Amounts are in the token’s smallest units (same as elsewhere in this app).
                </p>
              </div>

              <div className="policy-tools-section">
                <SectionHeader icon={<UxIconProposals />} title="Import splits from a spreadsheet" level="sub" />
                <p className="muted">
                  Each row: <code>wallet_address,share_points</code> (share is points out of 10,000). Lines starting with{' '}
                  <code>#</code> are notes. This merges into the rules you are editing above.
                </p>
                <textarea
                  className="compact"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  spellCheck={false}
                  placeholder={
                    '# Example\nSo11111111111111111111111111111111111111112,7000\nSo11111111111111111111111111111111111111113,3000'
                  }
                />
                <div className="btn-row">
                  <button type="button" className="ghost" onClick={onMergeCsvSplits}>
                    Import into rules
                  </button>
                </div>
              </div>

              <div className="policy-tools-section">
                <SectionHeader icon={<UxIconCode />} title="Compare to an older version" level="sub" />
                <p className="muted">
                  Paste an older rules file, or save your current draft as the baseline, then see line-by-line changes.
                </p>
                <textarea
                  className="compact"
                  value={baselineText}
                  onChange={(e) => setBaselineText(e.target.value)}
                  spellCheck={false}
                />
                <div className="btn-row">
                  <button type="button" className="ghost" onClick={() => setBaselineText(policyText)}>
                    Use current draft as baseline
                  </button>
                  <button type="button" className="ghost" onClick={onDiff}>
                    Show line-by-line diff
                  </button>
                </div>
              </div>
            </UxAccordion>
          </div>
        </>
      )}

      {tab === 'ledger' && (
        <>
          <div className="panel">
            <SectionHeader icon={<UxIconProposals />} title="Payout requests" />
            <p className="muted">
              <strong>1.</strong> Team lead starts a request with a max amount, wait time, and who gets paid.{' '}
              <strong>2.</strong> Enough approvers tap <strong>Approve</strong> (same request number).{' '}
              <strong>3.</strong> After the wait, anyone can tap <strong>Send payment</strong> for part or all of what is
              left. The recipient must already use that token in their wallet (same coin as the vault). If{' '}
              <strong>Proof before paying</strong> is on in Setup, add a delivery proof first. Lead can{' '}
              <strong>Cancel</strong> while it is still pending — not after money has moved.
            </p>
            <div className="form-grid">
              <div className="field-row">
                <div className="field">
                  <label htmlFor="rel-amt">Max amount for this request (smallest units)</label>
                  <input
                    id="rel-amt"
                    type="text"
                    value={relAmount}
                    onChange={(e) => setRelAmount(e.target.value)}
                    aria-describedby="ledger-units-hint"
                  />
                </div>
                <div className="field">
                  <label htmlFor="rel-tl">Wait after approval (seconds)</label>
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
                      setErr(`Could not read your rules for the default wait time: ${r.error}`);
                      return;
                    }
                    setRelTimelock(String(policyDefaultTimelockSecs(r.policy)));
                    pushToast(`Wait time set to your rules default (${policyDefaultTimelockSecs(r.policy)} seconds).`);
                  }}
                >
                  Use rules default
                </button>
              </div>
              {policyPayees.length > 0 && (
                <div className="field" style={{ maxWidth: '28rem' }}>
                  <label htmlFor="rel-pick">Pick from your split list</label>
                  <select
                    id="rel-pick"
                    value={policyPayees.includes(relRecipient.trim()) ? relRecipient.trim() : ''}
                    onChange={(e) => setRelRecipient(e.target.value)}
                  >
                    <option value="">— Or type a wallet address below —</option>
                    {policyPayees.map((pk) => (
                      <option key={pk} value={pk}>
                        {shortAddr(pk, 6, 6)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="rel-rec">Recipient wallet address</label>
                <input
                  id="rel-rec"
                  type="text"
                  value={relRecipient}
                  onChange={(e) => setRelRecipient(e.target.value)}
                  placeholder="Paste the recipient’s Solana wallet address"
                />
              </div>
            </div>
            <div className="field" style={{ maxWidth: '22rem' }}>
              <label htmlFor="exec-tranche">Amount to send now (smallest units)</label>
              <input
                id="exec-tranche"
                type="text"
                value={execTrancheAmount}
                onChange={(e) => setExecTrancheAmount(e.target.value)}
                placeholder="Leave blank to send everything still allowed"
                aria-describedby="ledger-units-hint"
              />
            </div>
            <p id="ledger-units-hint" className="muted field-hint">
              All amounts here use the vault token’s smallest units (atomic amount), not human “whole coins.”
            </p>
            <div className="btn-row">
              <button type="button" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onProposeRelease}>
                Start payout request
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onApproveRelease}>
                Approve with my wallet
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onExecuteRelease}>
                Send payment
              </button>
              <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onCancelProposal}>
                Cancel request (lead)
              </button>
            </div>
          </div>

          <div className="panel">
            <SectionHeader icon={<UxIconProof />} title="Proof & disputes" />
            <p className="muted">
              Use the <strong>same payout request number</strong> for each step. Open a dispute: team lead or any approver.
              Close it: lead only. While a dispute is open, payments on that request are blocked.
            </p>
            <UxAccordion title="Show proof & dispute forms" storageKey="ct-ux-ledger-proof">
              <div className="form-grid">
                <div className="field-row">
                  <div className="field" style={{ flex: '0 0 6rem' }}>
                    <label htmlFor="opid">Request #</label>
                    <input id="opid" type="number" min={0} value={opsProposalId} onChange={(e) => setOpsProposalId(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="ah">File fingerprint (SHA-256, 64 hex characters)</label>
                  <input id="ah" type="text" placeholder="64 hex characters" value={artHex} onChange={(e) => setArtHex(e.target.value)} />
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="au">Link to file (optional)</label>
                    <input id="au" type="text" value={artUri} onChange={(e) => setArtUri(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="al">Short label</label>
                    <input id="al" type="text" value={artLabel} onChange={(e) => setArtLabel(e.target.value)} />
                  </div>
                </div>
                <div className="field" style={{ maxWidth: '12rem' }}>
                  <label htmlFor="am">Milestone label (optional)</label>
                  <input id="am" type="text" value={artMilestone} onChange={(e) => setArtMilestone(e.target.value)} />
                </div>
              </div>
              <div className="btn-row">
                <button type="button" disabled={busy || !program || !wallet.publicKey} onClick={onAttachArtifact}>
                  Attach delivery proof
                </button>
                <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey} onClick={onOpenDispute}>
                  Open dispute
                </button>
                <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey} onClick={onResolveDispute}>
                  Resolve dispute
                </button>
              </div>
            </UxAccordion>
          </div>

          <div className="panel">
            <SectionHeader icon={<UxIconDownload />} title="Download records" />
            <p className="muted">
              Export everything you see for this project (refresh Overview first so numbers are current).
            </p>
            <div className="btn-row">
              <button type="button" className="ghost" disabled={!onChain} onClick={onExportAudit}>
                Download full report (JSON)
              </button>
              <button type="button" className="ghost" disabled={!onChain} onClick={onExportCsv}>
                Download payout list (CSV)
              </button>
            </div>
          </div>

          <div className="app-ledger-sticky" role="toolbar" aria-label="Quick payout actions">
            <button type="button" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onProposeRelease}>
              Start request
            </button>
            <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onApproveRelease}>
              Approve
            </button>
            <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onExecuteRelease}>
              Send payment
            </button>
            <button type="button" className="ghost" disabled={busy || !program || !wallet.publicKey || !onChain} onClick={onCancelProposal}>
              Cancel
            </button>
          </div>
        </>
      )}

      {tab === 'widgets' && (
        <Suspense fallback={<TabSectionFallback />}>
          <WidgetStudio
            projectDefaults={widgetProjectDefaults}
            policyText={policyText}
            onCopySuccess={(msg) => {
              setErr(null);
              pushToast(msg);
            }}
            onCopyError={(msg) => {
              pushToast(msg, 'error');
            }}
          />
        </Suspense>
      )}

      <DashboardTour open={dashboardTourOpen} onClose={closeDashboardTour} tab={tab} setTab={setTab} />

      <ToastStack items={toastItems} onDismiss={dismissToast} />

      <div className="toast-area" aria-live="polite" aria-relevant="additions text">
        {err && (
          <div className="error-with-actions" role="alert">
            <p className="error">{err}</p>
            {tab === 'overview' && wallet.publicKey && program && projectPda ? (
              <div className="btn-row">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    clearStatusLine();
                    void loadOnChain();
                  }}
                >
                  Try loading again
                </button>
              </div>
            ) : null}
            <p className="muted rpc-endpoint-hint" style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>
              RPC in use: <code>{connection.rpcEndpoint}</code>
            </p>
          </div>
        )}
        {statusTxSig ? (
          <TxSignatureBlock signature={statusTxSig} cluster={rpcCluster} notify={pushToast} />
        ) : null}
        {status ? <pre className="ok">{status}</pre> : null}
      </div>
    </div>
  );
}
