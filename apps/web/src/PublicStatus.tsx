import type { Idl } from '@coral-xyz/anchor';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import idlJson from '@idl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BRAND_NAME } from './brand';
import { BrandMark } from './BrandMark';
import { hex32 } from './policy';
import {
  WIDGET_BRIDGE_PROTOCOL,
  WIDGET_BRIDGE_SOURCE,
  buildWidgetSnapshotPayload,
  parseAllowedParentOrigin,
  postWidgetBridgeMessage,
} from './widgetBridge';

const idl = idlJson as Idl;
const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID ?? (idlJson as { address: string }).address,
);

const STATUS_NAMES = ['Pending', 'Timelock', 'Executed', 'Cancelled'] as const;

function statusLabel(code: number): string {
  return STATUS_NAMES[code] ?? `Unknown(${code})`;
}

function shortAddr(s: string, left = 4, right = 4): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function badgeClassForStatus(code: number): string {
  if (code === 0) return 'badge badge-pending';
  if (code === 1) return 'badge badge-timelock';
  if (code === 2) return 'badge badge-executed';
  return 'badge badge-cancelled';
}

type ProposalRow = {
  proposalId: string;
  amount: string;
  releasedSoFar: string;
  amountRemaining: string;
  recipient: string;
  status: string;
  statusCode: number;
  artifactSha256Hex: string;
  disputeActive: boolean;
};

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ok';
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
      proposals: ProposalRow[];
      /** Set when data came from GET /api/v1/project */
      rpcUsed?: string;
    };

function readParams(): {
  teamLead: string;
  projectId: string;
  rpc: string | null;
  token: string | null;
  embed: boolean;
  compact: boolean;
  /** Raw query value (may be percent-encoded). */
  parentOrigin: string | null;
} {
  const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  return {
    teamLead: sp.get('team_lead') ?? sp.get('teamLead') ?? '',
    projectId: sp.get('project_id') ?? sp.get('projectId') ?? '',
    rpc: sp.get('rpc'),
    token: sp.get('token'),
    embed: sp.get('embed') === '1',
    compact: sp.get('compact') === '1',
    parentOrigin: sp.get('parent_origin'),
  };
}

/** Read-only Anchor provider: fetch-only, no signing. */
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

export function PublicStatus() {
  const displayParams = readParams();
  const defaultRpc =
    displayParams.rpc?.trim() || import.meta.env.VITE_RPC_URL || 'https://api.devnet.solana.com';

  const [state, setState] = useState<LoadState>({ kind: 'idle' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    const p = readParams();
    const endpoint = p.rpc?.trim() || import.meta.env.VITE_RPC_URL || 'https://api.devnet.solana.com';
    const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';

    try {
      const q = new URLSearchParams();
      if (p.token?.trim()) {
        q.set('token', p.token.trim());
      } else {
        if (!p.teamLead.trim() || !p.projectId.trim()) {
          setState({
            kind: 'error',
            message: 'Add team_lead and project_id to the URL, or pass token= from POST /api/v1/embed-token.',
          });
          return;
        }
        q.set('team_lead', p.teamLead.trim());
        q.set('project_id', p.projectId.trim());
        if (p.rpc?.trim()) q.set('rpc', p.rpc.trim());
      }

      const url = `${apiBase}/api/v1/project?${q.toString()}`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const data = (await r.json()) as Record<string, unknown>;
        if (!data.error && typeof data.projectPda === 'string') {
          const raw = Array.isArray(data.proposals) ? data.proposals : [];
          const proposals: ProposalRow[] = raw.map((row) => {
            const r = row as Record<string, unknown>;
            const amount = String(r.amount ?? '0');
            const releasedSoFar = String(r.releasedSoFar ?? '0');
            let amountRemaining = String(r.amountRemaining ?? '');
            if (!amountRemaining) {
              try {
                const cap = BigInt(amount);
                const rel = BigInt(releasedSoFar);
                amountRemaining = (cap >= rel ? cap - rel : 0n).toString();
              } catch {
                amountRemaining = amount;
              }
            }
            return {
              proposalId: String(r.proposalId ?? ''),
              amount,
              releasedSoFar,
              amountRemaining,
              recipient: String(r.recipient ?? ''),
              status: String(r.status ?? ''),
              statusCode: Number(r.statusCode ?? 0),
              artifactSha256Hex: String(r.artifactSha256Hex ?? ''),
              disputeActive: Boolean(r.disputeActive),
            };
          });
          setState({
            kind: 'ok',
            projectPda: data.projectPda as string,
            teamLead: data.teamLead as string,
            projectId: data.projectId as string,
            policyVersion: Number(data.policyVersion),
            policyHashHex: data.policyHashHex as string,
            frozen: Boolean(data.frozen),
            requireArtifactForExecute: Boolean(data.requireArtifactForExecute),
            vaultInitialized: Boolean(data.vaultInitialized),
            vaultBalance: data.vaultBalance as string | undefined,
            mint: data.mint as string | undefined,
            proposals,
            rpcUsed: typeof data.rpcUsed === 'string' ? data.rpcUsed : undefined,
          });
          return;
        }
      }
    } catch {
      /* try in-browser RPC */
    }

    if (p.token?.trim()) {
      setState({
        kind: 'error',
        message:
          'Could not load project via API. For token= links, deploy this app to Vercel (or set VITE_API_BASE_URL to your API origin).',
      });
      return;
    }

    let teamLeadPk: PublicKey;
    let projectIdBn: bigint;
    try {
      teamLeadPk = new PublicKey(p.teamLead.trim());
      projectIdBn = BigInt(p.projectId.trim());
      if (projectIdBn < 0n) throw new Error('project_id must be non-negative');
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Invalid team_lead or project_id.',
      });
      return;
    }

    const idBuf = Buffer.allocUnsafe(8);
    idBuf.writeBigUInt64LE(projectIdBn, 0);
    const [projectPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('project'), teamLeadPk.toBuffer(), idBuf],
      PROGRAM_ID,
    );

    const connection = new Connection(endpoint, 'confirmed');
    const provider = readOnlyProvider(connection);
    const program = new Program(idl, provider);

    try {
      // @ts-expect-error account namespace from IDL
      const acc = await program.account.project.fetchNullable(projectPda);
      if (!acc) {
        setState({
          kind: 'error',
          message: `No project account at PDA ${projectPda.toBase58()} (check team_lead, project_id, RPC, and program id).`,
        });
        return;
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
      const proposalRows: ProposalRow[] = [];
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
        const cap = BigInt(prop.amount.toString());
        const rel = BigInt(prop.releasedSoFar.toString());
        const remaining = cap >= rel ? cap - rel : 0n;
        proposalRows.push({
          proposalId: String(i),
          amount: prop.amount.toString(),
          releasedSoFar: prop.releasedSoFar.toString(),
          amountRemaining: remaining.toString(),
          recipient: prop.recipient.toBase58(),
          status: statusLabel(st),
          statusCode: st,
          artifactSha256Hex: hex32(Uint8Array.from(prop.artifactSha256 as number[])),
          disputeActive: Boolean(prop.disputeActive),
        });
      }

      setState({
        kind: 'ok',
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
      });
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bridgeTargetOrigin = useMemo(() => {
    if (!displayParams.embed) return null;
    return parseAllowedParentOrigin(displayParams.parentOrigin);
  }, [displayParams.embed, displayParams.parentOrigin]);

  useEffect(() => {
    if (!bridgeTargetOrigin) return;
    postWidgetBridgeMessage(bridgeTargetOrigin, {
      source: WIDGET_BRIDGE_SOURCE,
      protocol: WIDGET_BRIDGE_PROTOCOL,
      type: 'ready',
      compact: displayParams.compact,
    });
  }, [bridgeTargetOrigin, displayParams.compact]);

  useEffect(() => {
    if (!bridgeTargetOrigin) return;
    if (state.kind === 'idle') return;
    if (state.kind === 'loading') {
      postWidgetBridgeMessage(bridgeTargetOrigin, {
        source: WIDGET_BRIDGE_SOURCE,
        protocol: WIDGET_BRIDGE_PROTOCOL,
        type: 'loading',
      });
      return;
    }
    if (state.kind === 'error') {
      postWidgetBridgeMessage(bridgeTargetOrigin, {
        source: WIDGET_BRIDGE_SOURCE,
        protocol: WIDGET_BRIDGE_PROTOCOL,
        type: 'error',
        message: state.message,
      });
      return;
    }
    postWidgetBridgeMessage(bridgeTargetOrigin, {
      source: WIDGET_BRIDGE_SOURCE,
      protocol: WIDGET_BRIDGE_PROTOCOL,
      type: 'snapshot',
      payload: buildWidgetSnapshotPayload(state, displayParams.compact),
    });
  }, [state, bridgeTargetOrigin, displayParams.compact]);

  const shellClass = ['app-shell', displayParams.embed && 'app-shell--embed', displayParams.compact && 'app-shell--embed-compact']
    .filter(Boolean)
    .join(' ');

  const pendingCount = state.kind === 'ok' ? state.proposals.filter((p) => p.statusCode < 2).length : 0;
  const disputeCount = state.kind === 'ok' ? state.proposals.filter((p) => p.disputeActive).length : 0;

  return (
    <div className={shellClass}>
      {displayParams.compact ? (
        <>
          {state.kind === 'loading' && <p className="muted widget-embed-compact__pad">Loading…</p>}
          {state.kind === 'error' && <p className="error widget-embed-compact__pad">{state.message}</p>}
          {state.kind === 'ok' && (
            <div className="widget-embed-compact" aria-label="Treasury status">
              <div className="widget-embed-compact__head">
                <div className="widget-embed-compact__brand">
                  <BrandMark variant="compact" className="widget-embed-compact__mark" />
                  <span className="widget-embed-compact__title">{BRAND_NAME}</span>
                </div>
                <button
                  type="button"
                  className="ghost widget-embed-compact__refresh"
                  onClick={() => void load()}
                  aria-label="Refresh status"
                >
                  Refresh
                </button>
              </div>
              <div className="widget-embed-compact__kpis">
                <div className="widget-embed-compact__kpi">
                  <span className="widget-embed-compact__kpi-label">Vault</span>
                  <span className="widget-embed-compact__kpi-value">{state.vaultBalance ?? '—'}</span>
                </div>
                <div className="widget-embed-compact__kpi">
                  <span className="widget-embed-compact__kpi-label">Policy</span>
                  <span className="widget-embed-compact__kpi-value">v{state.policyVersion}</span>
                </div>
                <div className="widget-embed-compact__kpi">
                  <span className="widget-embed-compact__kpi-label">Proposals</span>
                  <span className="widget-embed-compact__kpi-value">{state.proposals.length}</span>
                </div>
                <div className="widget-embed-compact__kpi">
                  <span className="widget-embed-compact__kpi-label">Open</span>
                  <span className="widget-embed-compact__kpi-value">{pendingCount}</span>
                </div>
                <div className="widget-embed-compact__kpi">
                  <span className="widget-embed-compact__kpi-label">Frozen</span>
                  <span className="widget-embed-compact__kpi-value">{state.frozen ? 'Yes' : 'No'}</span>
                </div>
                {disputeCount > 0 && (
                  <div className="widget-embed-compact__kpi widget-embed-compact__kpi--alert">
                    <span className="widget-embed-compact__kpi-label">Disputes</span>
                    <span className="widget-embed-compact__kpi-value">{disputeCount}</span>
                  </div>
                )}
              </div>
              <p className="widget-embed-compact__foot muted">
                Project #{state.projectId} · {shortAddr(state.teamLead, 4, 4)}
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <header className="app-header">
            <div className="brand">
              <BrandMark className="brand-mark" />
              <div>
                <h1>
                  {BRAND_NAME} — public treasury status
                </h1>
                {!displayParams.embed && <p className="muted">Read-only view. No wallet required.</p>}
              </div>
            </div>
            <button type="button" className="ghost" onClick={() => void load()} disabled={state.kind === 'loading'}>
              Refresh
            </button>
          </header>

          <div className={displayParams.embed ? 'panel app-shell__embed-hide' : 'panel'}>
            <h2>URL parameters</h2>
            <p className="muted">
              <code>?view=status&amp;team_lead=&lt;pubkey&gt;&amp;project_id=&lt;u64&gt;</code> — optional{' '}
              <code>&amp;rpc=&lt;https endpoint&gt;</code> — or <code>&amp;token=&lt;JWT&gt;</code> from{' '}
              <code>POST /api/v1/embed-token</code>. On Vercel, data is fetched via <code>/api/v1/project</code> first.
              Add <code>&amp;embed=1&amp;compact=1</code> for a minimal iframe widget. With <code>&amp;embed=1</code>, optional{' '}
              <code>&amp;parent_origin=&lt;encoded origin&gt;</code> enables <code>postMessage</code> to the parent (see{' '}
              <code>/widget-manifest.json</code>).
            </p>
            <pre className="compact-block">
              {`team_lead: ${displayParams.teamLead || '(missing)'}
project_id: ${displayParams.projectId || '(missing)'}
token: ${displayParams.token ? '(present)' : '(none)'}
rpc: ${defaultRpc}`}
            </pre>
          </div>

          {state.kind === 'loading' && <p className="muted">Loading…</p>}

          {state.kind === 'error' && <p className="error">{state.message}</p>}

          {state.kind === 'ok' && (
            <>
              <div className="panel">
                <h2>Project</h2>
                <pre className="compact-block">
                  {`PDA: ${state.projectPda}
team_lead: ${shortAddr(state.teamLead, 8, 8)}
on-chain project_id: ${state.projectId}
policy_version: ${state.policyVersion}
policy_hash: ${state.policyHashHex}
frozen: ${state.frozen}
require_artifact_for_execute: ${state.requireArtifactForExecute}
vault_initialized: ${state.vaultInitialized}
mint: ${state.mint ? shortAddr(state.mint, 8, 8) : '—'}
vault_balance: ${state.vaultBalance ?? '—'}
rpc (read): ${state.rpcUsed ?? 'client'}`}
                </pre>
              </div>

              {state.proposals.length > 0 && (
                <div className="panel">
                  <h2>Proposals</h2>
                  <div className="proposal-list" aria-label="Proposals">
                    {state.proposals.map((p) => (
                      <div key={p.proposalId} className="proposal-card">
                        <div className="proposal-card-top">
                          <span className={badgeClassForStatus(p.statusCode)}>{p.status}</span>
                          <span className="proposal-meta">Proposal #{p.proposalId}</span>
                        </div>
                        <div className="proposal-meta">
                          cap {p.amount} · released {p.releasedSoFar} · remaining {p.amountRemaining} →{' '}
                          {shortAddr(p.recipient)} · artifact {shortAddr(p.artifactSha256Hex, 6, 6)}
                          {p.disputeActive ? ' · dispute' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
