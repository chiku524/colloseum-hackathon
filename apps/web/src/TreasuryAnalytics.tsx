import { useMemo } from 'react';
import type { ProposalSnapshot } from './auditExport';
import {
  computeTreasuryFlowMetrics,
  formatTokenAtoms,
  fractionPercent,
  type TreasuryFlowMetrics,
} from './treasuryMetrics';

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
      { pct: v * scale, color: COL_VAULT, label: 'In vault' },
      { pct: o * scale, color: COL_OUTSTANDING, label: 'Committed (unpaid)' },
      { pct: d * scale, color: COL_DISBURSED, label: 'Disbursed (proposals)' },
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
        aria-label="Treasury allocation donut chart"
      />
      <ul className="treasury-legend">
        <li>
          <span className="treasury-swatch" style={{ background: COL_VAULT }} />
          In vault
        </li>
        <li>
          <span className="treasury-swatch" style={{ background: COL_OUTSTANDING }} />
          Committed (unpaid)
        </li>
        <li>
          <span className="treasury-swatch" style={{ background: COL_DISBURSED }} />
          Disbursed (proposals)
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
          <div className="treasury-bar__seg treasury-bar__seg--vault" style={{ width: `${v}%` }} title={`Vault ${v}%`} />
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
      <p className="muted treasury-analytics__intro">
        Snapshot from the vault token account and on-chain release proposals.{' '}
        <strong>Split automation</strong> can transfer tokens without updating proposal totals; <strong>in vault</strong>{' '}
        always matches the live ATA.
      </p>

      {!vaultInitialized ? (
        <p className="muted">Vault not initialized yet — initialize in Setup to see balances.</p>
      ) : (
        <>
          <div className="treasury-kpi-grid">
            <div className="treasury-kpi">
              <div className="treasury-kpi__label">In vault (liquid)</div>
              <div className="treasury-kpi__value">{formatTokenAtoms(inVault, vaultDecimals)}</div>
              {mint && (
                <div className="treasury-kpi__meta">
                  mint <code>{shortAddr(mint, 6, 6)}</code>
                </div>
              )}
            </div>
            <div className="treasury-kpi">
              <div className="treasury-kpi__label">Committed, not yet paid</div>
              <div className="treasury-kpi__value">{formatTokenAtoms(outstandingCommitted, vaultDecimals)}</div>
              <div className="treasury-kpi__meta">Approved caps minus released (non-cancelled)</div>
            </div>
            <div className="treasury-kpi">
              <div className="treasury-kpi__label">Disbursed via proposals</div>
              <div className="treasury-kpi__value">{formatTokenAtoms(disbursedViaProposals, vaultDecimals)}</div>
              <div className="treasury-kpi__meta">Sum of released amounts (execute_release)</div>
            </div>
            <div className="treasury-kpi treasury-kpi--total">
              <div className="treasury-kpi__label">Attributed total</div>
              <div className="treasury-kpi__value">{formatTokenAtoms(totalAttributable, vaultDecimals)}</div>
              <div className="treasury-kpi__meta">Vault + committed + disbursed (see note above)</div>
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
          <h3 className="treasury-subhead">By proposal status</h3>
          <table className="treasury-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
                <th>Released (sum)</th>
                <th>Remaining cap (sum)</th>
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
