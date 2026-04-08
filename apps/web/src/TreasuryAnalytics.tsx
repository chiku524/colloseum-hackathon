import { useMemo } from 'react';
import type { ProposalSnapshot } from './auditExport';
import {
  computeTreasuryFlowMetrics,
  formatTokenAtoms,
  fractionPercent,
  type TreasuryFlowMetrics,
} from './treasuryMetrics';
import { SectionHeader, UxIconProposals, UxIconTreasury } from './UxVisual';

const COL_VAULT = '#3d8bd4';
const COL_OUTSTANDING = '#c9a227';
const COL_DISBURSED = '#8b5cf6';

function shortAddr(s: string, left = 4, right = 4): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function DonutChart({
  metrics,
  total,
}: {
  metrics: TreasuryFlowMetrics;
  total: bigint;
}) {
  const segs = useMemo(() => {
    if (total <= 0n) return [] as { pct: number; color: string; label: string }[];
    const v = fractionPercent(metrics.inVault, total);
    const o = fractionPercent(metrics.outstandingCommitted, total);
    const d = fractionPercent(metrics.disbursedViaProposals, total);
    // Ensure visual sums to ~100 for conic-gradient
    const sum = v + o + d;
    const scale = sum > 0 && sum < 99.5 ? 100 / sum : 1;
    return [
      { pct: v * scale, color: COL_VAULT, label: 'In vault now' },
      { pct: o * scale, color: COL_OUTSTANDING, label: 'Promised, not paid yet' },
      { pct: d * scale, color: COL_DISBURSED, label: 'Already paid out' },
    ].filter((s) => s.pct > 0.05);
  }, [metrics, total]);

  if (segs.length === 0) {
    return (
      <div className="treasury-donut treasury-donut--empty" aria-hidden>
        <span className="muted">No balances to chart</span>
      </div>
    );
  }

  let acc = 0;
  const parts = segs.map((s) => {
    const start = acc;
    acc += s.pct;
    return `${s.color} ${start}% ${acc}%`;
  });
  const gradient = `conic-gradient(${parts.join(', ')})`;

  return (
    <div className="treasury-donut-wrap">
      <div
        className="treasury-donut"
        style={{ background: gradient }}
        role="img"
        aria-label="Treasury split donut chart"
      />
      <ul className="treasury-legend">
        <li>
          <span className="treasury-swatch" style={{ background: COL_VAULT }} />
          In vault now
        </li>
        <li>
          <span className="treasury-swatch" style={{ background: COL_OUTSTANDING }} />
          Promised, not paid yet
        </li>
        <li>
          <span className="treasury-swatch" style={{ background: COL_DISBURSED }} />
          Already paid out
        </li>
      </ul>
    </div>
  );
}

function StackedBar({ metrics, total }: { metrics: TreasuryFlowMetrics; total: bigint }) {
  if (total <= 0n) return null;
  const v = fractionPercent(metrics.inVault, total);
  const o = fractionPercent(metrics.outstandingCommitted, total);
  const d = fractionPercent(metrics.disbursedViaProposals, total);
  return (
    <div className="treasury-bar" role="presentation">
      <div className="treasury-bar__track">
        {v > 0 && (
          <div className="treasury-bar__seg treasury-bar__seg--vault" style={{ width: `${v}%` }} title={`In vault ${v}%`} />
        )}
        {o > 0 && (
          <div
            className="treasury-bar__seg treasury-bar__seg--out"
            style={{ width: `${o}%` }}
            title={`Committed ${o}%`}
          />
        )}
        {d > 0 && (
          <div className="treasury-bar__seg treasury-bar__seg--paid" style={{ width: `${d}%` }} title={`Paid ${d}%`} />
        )}
      </div>
    </div>
  );
}

type Props = {
  proposals: ProposalSnapshot[];
  vaultInitialized: boolean;
  vaultAmountRaw?: string;
  vaultDecimals: number;
  mint?: string;
};

export function TreasuryAnalytics({ proposals, vaultInitialized, vaultAmountRaw, vaultDecimals, mint }: Props) {
  const metrics = useMemo(
    () => computeTreasuryFlowMetrics(proposals, vaultAmountRaw, vaultInitialized),
    [proposals, vaultAmountRaw, vaultInitialized],
  );

  const { inVault, disbursedViaProposals, outstandingCommitted, totalAttributable } = metrics;

  const byStatus = useMemo(() => {
    const rows: { status: string; count: number; remaining: bigint; released: bigint }[] = [];
    const map = new Map<string, { count: number; remaining: bigint; released: bigint }>();
    for (const p of proposals) {
      const key = p.status;
      const cap = BigInt(p.amount);
      const rel = BigInt(p.releasedSoFar);
      const rem = p.statusCode === 3 ? 0n : cap > rel ? cap - rel : 0n;
      const cur = map.get(key) ?? { count: 0, remaining: 0n, released: 0n };
      cur.count += 1;
      cur.remaining += rem;
      cur.released += rel;
      map.set(key, cur);
    }
    for (const [status, v] of map) {
      rows.push({ status, ...v });
    }
    return rows.sort((a, b) => a.status.localeCompare(b.status));
  }, [proposals]);

  return (
    <div className="treasury-analytics">
      <SectionHeader icon={<UxIconTreasury />} title="Flow & breakdown" />
      <p className="muted treasury-analytics__intro">
        Numbers come from your vault’s token balance and approved payout requests. If you use <strong>automatic split</strong>{' '}
        payouts in Setup, some tokens may move without changing these request totals — <strong>in vault now</strong> always
        matches the live balance.
      </p>

      {!vaultInitialized ? (
        <p className="muted">Turn the vault on under Setup to see balances here.</p>
      ) : (
        <>
          <div className="treasury-kpi-grid">
            <div className="treasury-kpi" data-accent="sky">
              <div className="treasury-kpi__label">In vault now</div>
              <div className="treasury-kpi__value">{formatTokenAtoms(inVault, vaultDecimals)}</div>
              {mint && (
                <div className="treasury-kpi__meta">
                  Token <code>{shortAddr(mint, 6, 6)}</code>
                </div>
              )}
            </div>
            <div className="treasury-kpi" data-accent="amber">
              <div className="treasury-kpi__label">Promised, not paid yet</div>
              <div className="treasury-kpi__value">{formatTokenAtoms(outstandingCommitted, vaultDecimals)}</div>
              <div className="treasury-kpi__meta">Approved limits minus what already went out (ignores cancelled)</div>
            </div>
            <div className="treasury-kpi" data-accent="violet">
              <div className="treasury-kpi__label">Paid out on requests</div>
              <div className="treasury-kpi__value">{formatTokenAtoms(disbursedViaProposals, vaultDecimals)}</div>
              <div className="treasury-kpi__meta">Total sent after approvals</div>
            </div>
            <div className="treasury-kpi treasury-kpi--total" data-accent="mint">
              <div className="treasury-kpi__label">All tracked funds</div>
              <div className="treasury-kpi__value">{formatTokenAtoms(totalAttributable, vaultDecimals)}</div>
              <div className="treasury-kpi__meta">Vault + promised + paid (see note above about automation)</div>
            </div>
          </div>

          <div className="treasury-visuals">
            <DonutChart metrics={metrics} total={totalAttributable} />
            <StackedBar metrics={metrics} total={totalAttributable} />
          </div>
        </>
      )}

      {proposals.length > 0 && (
        <div className="treasury-table-wrap">
          <SectionHeader icon={<UxIconProposals />} title="By payout request status" level="sub" />
          <table className="treasury-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
                <th>Paid so far (sum)</th>
                <th>Still allowed (sum)</th>
              </tr>
            </thead>
            <tbody>
              {byStatus.map((row) => (
                <tr key={row.status}>
                  <td>{row.status}</td>
                  <td>{row.count}</td>
                  <td>{formatTokenAtoms(row.released, vaultDecimals)}</td>
                  <td>{formatTokenAtoms(row.remaining, vaultDecimals)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
