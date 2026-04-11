import { useEffect, useMemo, useState } from 'react';
import { formatTxError } from './anchorErrors';
import { BRAND_NAME } from './brand';
import { SiteFooter } from './SiteFooter';
import { BrandMark } from './BrandMark';
import { SharedViewBanner } from './SharedViewBanner';
import {
  decodePolicyFromQueryParam,
  simulatePayout,
  validatePolicy,
  type TreasuryPolicy,
} from './policy';
import { SectionHeader, UxIconPolicy } from './UxVisual';

function readPolicyFromUrl(): { policy: TreasuryPolicy | null; error: string | null } {
  const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const p = sp.get('p');
  if (!p) return { policy: null, error: 'This link is missing the rules payload (the p= part). Ask whoever shared it to copy the full URL.' };
  try {
    return { policy: decodePolicyFromQueryParam(p), error: null };
  } catch (e) {
    return { policy: null, error: formatTxError(e) };
  }
}

export function PolicySimulatorShare() {
  const initial = useMemo(() => readPolicyFromUrl(), []);
  const [policy] = useState<TreasuryPolicy | null>(initial.policy);
  const [loadErr] = useState<string | null>(initial.error);
  const [depositSim, setDepositSim] = useState('1000000');
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (loadErr) setErr(loadErr);
  }, [loadErr]);

  const onSimulate = () => {
    setErr(null);
    setStatus(null);
    if (!policy) return;
    try {
      const v = validatePolicy(policy);
      if (v) {
        setErr(v);
        return;
      }
      const atoms = BigInt(depositSim);
      if (atoms <= 0n) {
        setErr('Enter a sample deposit greater than zero (smallest units of the token).');
        return;
      }
      const { lines, holdback, remainder } = simulatePayout(atoms, policy);
      const rows = lines.map((l) => `${l.payee}: ${l.amount.toString()}`).join('\n');
      setStatus(
        `Practice run (smallest units):\nHold back: ${holdback}\n${rows}\nLeft in vault after splits: ${remainder}`,
      );
    } catch (e) {
      setErr(formatTxError(e));
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <BrandMark className="brand-mark" />
          <div>
            <h1>Payout “what if” calculator</h1>
            <p className="muted">
              {BRAND_NAME} · Read-only practice calculator. Rules load from the link — no wallet or blockchain access.
            </p>
          </div>
        </div>
      </header>

      <SharedViewBanner variant="simulate" />

      {policy && (
        <div className="panel">
          <SectionHeader icon={<UxIconPolicy />} title="Rules from the link" />
          <pre className="data-block">{JSON.stringify(policy, null, 2)}</pre>
          <div className="field-row" style={{ marginTop: '0.75rem' }}>
            <div className="field">
              <label htmlFor="sim-dep">Sample deposit (smallest units)</label>
              <input id="sim-dep" type="text" value={depositSim} onChange={(e) => setDepositSim(e.target.value)} />
            </div>
            <button type="button" className="ghost" style={{ alignSelf: 'flex-end' }} onClick={onSimulate}>
              Run sample
            </button>
          </div>
        </div>
      )}

      <div className="toast-area">
        {err && <p className="error">{err}</p>}
        {status && <pre className="ok">{status}</pre>}
      </div>

      <SiteFooter />
    </div>
  );
}
