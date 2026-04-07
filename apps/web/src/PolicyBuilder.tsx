import { useCallback, useEffect, useState } from 'react';
import {
  defaultPolicy,
  parsePolicyJson,
  templateDemoFourWaySquad,
  templateDemoSponsorMilestone,
  templateEqualDuo,
  templateFourWaySquad,
  templateSponsorMilestone,
  TIMELOCK_PRESETS,
  toPolicyV2ForEdit,
  type TreasuryPolicyV2,
} from './policy';

export type PolicyBuilderProps = {
  policyText: string;
  onPolicyTextChange: (next: string) => void;
  teamLead: string | null;
};

function commitModel(m: TreasuryPolicyV2, onPolicyTextChange: (s: string) => void) {
  onPolicyTextChange(JSON.stringify(m, null, 2));
}

export function PolicyBuilder({ policyText, onPolicyTextChange, teamLead }: PolicyBuilderProps) {
  const [model, setModel] = useState<TreasuryPolicyV2 | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [partnerPubkey, setPartnerPubkey] = useState('');
  const [contractorPubkey, setContractorPubkey] = useState('');
  const [fourWayB, setFourWayB] = useState('');
  const [fourWayC, setFourWayC] = useState('');
  const [fourWayD, setFourWayD] = useState('');

  useEffect(() => {
    if (!policyText.trim()) {
      setParseErr(null);
      setModel(null);
      return;
    }
    const r = parsePolicyJson(policyText);
    if (!r.ok) {
      setParseErr(r.error);
      return;
    }
    setParseErr(null);
    setModel(toPolicyV2ForEdit(r.policy));
  }, [policyText]);

  const pushModel = useCallback(
    (next: TreasuryPolicyV2) => {
      setModel(next);
      commitModel(next, onPolicyTextChange);
    },
    [onPolicyTextChange],
  );

  const updateWorkflow = (partial: Partial<NonNullable<TreasuryPolicyV2['workflow']>>) => {
    if (!model) return;
    pushModel({
      ...model,
      workflow: { ...model.workflow, ...partial },
    });
  };

  const updateSplitRow = (index: number, field: 'payee' | 'bps', value: string) => {
    if (!model) return;
    const splits = model.splits.map((s, i) => {
      if (i !== index) return s;
      if (field === 'payee') return { ...s, payee: value };
      const n = Number(value);
      return { ...s, bps: Number.isFinite(n) ? Math.trunc(n) : 0 };
    });
    pushModel({ ...model, splits });
  };

  const addSplitRow = () => {
    if (!model || model.splits.length >= 20) return;
    pushModel({
      ...model,
      splits: [...model.splits, { payee: '', bps: 0 }],
    });
  };

  const removeSplitRow = (index: number) => {
    if (!model || model.splits.length <= 1) return;
    pushModel({
      ...model,
      splits: model.splits.filter((_, i) => i !== index),
    });
  };

  const loadTemplate = (t: TreasuryPolicyV2) => {
    pushModel(t);
  };

  if (!model) {
    return (
      <div className="panel policy-builder">
        <h2>Policy builder</h2>
        {parseErr ? (
          <p className="error" role="alert">
            Fix JSON in Advanced view: {parseErr}
          </p>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
    );
  }

  const matchedTimelockPreset = TIMELOCK_PRESETS.find((x) => x.secs === model.defaultTimelockSecs);

  return (
    <div className="panel policy-builder">
      <h2>Policy builder</h2>
      <p className="muted">
        Templates and toggles produce canonical JSON + hash for <code>set_policy</code>. On-chain rules are still
        approvers, timelock, and execute — policy splits guide the simulator and optional payout checks in this app.
      </p>

      {parseErr && (
        <p className="muted" style={{ color: 'var(--danger)' }}>
          Advanced JSON does not parse or validate — fix it to sync. Showing last good builder state: {parseErr}
        </p>
      )}

      <h3 className="policy-builder__h3">Templates</h3>
      <div className="policy-template-grid">
        <button
          type="button"
          className="policy-template-card"
          disabled={!teamLead}
          onClick={() => teamLead && loadTemplate(defaultPolicy(teamLead))}
        >
          <strong>Single lead</strong>
          <span>100% to team lead; default 24h timelock.</span>
        </button>
        <button
          type="button"
          className="policy-template-card"
          disabled={!teamLead || !partnerPubkey.trim()}
          onClick={() => teamLead && partnerPubkey.trim() && loadTemplate(templateEqualDuo(teamLead, partnerPubkey.trim()))}
        >
          <strong>50/50 duo</strong>
          <span>Needs partner wallet below.</span>
        </button>
        <button
          type="button"
          className="policy-template-card"
          disabled={!teamLead}
          onClick={() => teamLead && loadTemplate(templateDemoFourWaySquad(teamLead))}
        >
          <strong>Demo 4-way</strong>
          <span>25% each; placeholder payees — replace before mainnet.</span>
        </button>
        <button
          type="button"
          className="policy-template-card"
          disabled={!teamLead || !fourWayB.trim() || !fourWayC.trim() || !fourWayD.trim()}
          onClick={() =>
            teamLead &&
            loadTemplate(
              templateFourWaySquad(teamLead, fourWayB.trim(), fourWayC.trim(), fourWayD.trim()),
            )
          }
        >
          <strong>4-way custom</strong>
          <span>Four real pubkeys (you + 3 collaborators).</span>
        </button>
        <button
          type="button"
          className="policy-template-card"
          disabled={!teamLead}
          onClick={() => teamLead && loadTemplate(templateDemoSponsorMilestone(teamLead))}
        >
          <strong>Demo milestone</strong>
          <span>Lead + contractor + holdback; placeholder contractor.</span>
        </button>
        <button
          type="button"
          className="policy-template-card"
          disabled={!teamLead || !contractorPubkey.trim()}
          onClick={() =>
            teamLead && contractorPubkey.trim() && loadTemplate(templateSponsorMilestone(teamLead, contractorPubkey.trim()))
          }
        >
          <strong>Milestone escrow</strong>
          <span>Lead + contractor; suggests artifact gate.</span>
        </button>
      </div>

      <div className="field-row" style={{ marginTop: '0.75rem' }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pb-partner">Partner wallet (50/50)</label>
          <input
            id="pb-partner"
            type="text"
            value={partnerPubkey}
            onChange={(e) => setPartnerPubkey(e.target.value)}
            placeholder="Second pubkey (base58)"
            spellCheck={false}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pb-contractor">Contractor (milestone)</label>
          <input
            id="pb-contractor"
            type="text"
            value={contractorPubkey}
            onChange={(e) => setContractorPubkey(e.target.value)}
            placeholder="Contractor pubkey"
            spellCheck={false}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pb-4b">4-way wallet B</label>
          <input id="pb-4b" type="text" value={fourWayB} onChange={(e) => setFourWayB(e.target.value)} spellCheck={false} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pb-4c">4-way wallet C</label>
          <input id="pb-4c" type="text" value={fourWayC} onChange={(e) => setFourWayC(e.target.value)} spellCheck={false} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pb-4d">4-way wallet D</label>
          <input id="pb-4d" type="text" value={fourWayD} onChange={(e) => setFourWayD(e.target.value)} spellCheck={false} />
        </div>
      </div>

      <h3 className="policy-builder__h3">Workflow toggles</h3>
      <div className="toggle-list">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={Boolean(model.workflow?.suggestArtifactGate)}
            onChange={(e) => updateWorkflow({ suggestArtifactGate: e.target.checked })}
          />
          <span>
            Suggest <strong>artifact gate</strong> (enable in Setup so execute requires a deliverable hash — good for
            milestone escrow).
          </span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={Boolean(model.workflow?.payoutRecipientsMustBePolicyPayees)}
            onChange={(e) => updateWorkflow({ payoutRecipientsMustBePolicyPayees: e.target.checked })}
          />
          <span>
            <strong>Restrict proposals</strong> to recipient wallets listed in splits (this app enforces before
            signing; chain still stores policy hash only).
          </span>
        </label>
      </div>

      <div className="field" style={{ marginTop: '0.75rem' }}>
        <label htmlFor="pb-title">Policy title (display / audit)</label>
        <input
          id="pb-title"
          type="text"
          value={model.workflow?.title ?? ''}
          onChange={(e) => updateWorkflow({ title: e.target.value || undefined })}
          placeholder="e.g. Q2 collective payout rules"
          maxLength={200}
        />
      </div>

      <h3 className="policy-builder__h3">Timelock default</h3>
      <p className="muted small">Used as the default when you click “Use policy timelock” on Proposals.</p>
      <div className="field-row">
        <div className="field" style={{ maxWidth: '14rem' }}>
          <label htmlFor="pb-tl-preset">Preset</label>
          <select
            id="pb-tl-preset"
            value={matchedTimelockPreset ? String(matchedTimelockPreset.secs) : 'custom'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') return;
              pushModel({ ...model, defaultTimelockSecs: Number(v) });
            }}
          >
            {TIMELOCK_PRESETS.map((p) => (
              <option key={p.secs} value={p.secs}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pb-tl-secs">Seconds</label>
          <input
            id="pb-tl-secs"
            type="number"
            min={0}
            value={model.defaultTimelockSecs}
            onChange={(e) => pushModel({ ...model, defaultTimelockSecs: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
      </div>

      <h3 className="policy-builder__h3">Holdback</h3>
      <div className="field" style={{ maxWidth: '12rem' }}>
        <label htmlFor="pb-hold">Holdback (basis points, 100 = 1%)</label>
        <input
          id="pb-hold"
          type="number"
          min={0}
          max={10000}
          value={model.holdbackBps}
          onChange={(e) => pushModel({ ...model, holdbackBps: Math.min(10_000, Math.max(0, Number(e.target.value) || 0)) })}
        />
      </div>

      <h3 className="policy-builder__h3">Automation (informational)</h3>
      <p className="muted small">
        Solana has no cron inside the program. <code>planned_crank</code> documents future permissionless or keeper
        flows — not active on-chain in this build.
      </p>
      <div className="field-row">
        <div className="field" style={{ maxWidth: '16rem' }}>
          <label htmlFor="pb-auto-mode">Mode</label>
          <select
            id="pb-auto-mode"
            value={model.automation?.mode ?? 'none'}
            onChange={(e) => {
              const mode = e.target.value === 'planned_crank' ? 'planned_crank' : 'none';
              pushModel({
                ...model,
                automation: { ...model.automation, mode, notes: model.automation?.notes },
              });
            }}
          >
            <option value="none">None (human-triggered releases only)</option>
            <option value="planned_crank">Planned crank / keeper (design only)</option>
          </select>
        </div>
      </div>
      {(model.automation?.mode === 'planned_crank' || model.automation?.notes) && (
        <div className="field">
          <label htmlFor="pb-auto-notes">Notes</label>
          <input
            id="pb-auto-notes"
            type="text"
            value={model.automation?.notes ?? ''}
            onChange={(e) =>
              pushModel({
                ...model,
                automation: { mode: model.automation?.mode ?? 'none', notes: e.target.value || undefined },
              })
            }
            placeholder="e.g. Evaluate Vercel cron calling crank weekly"
            maxLength={500}
          />
        </div>
      )}

      <h3 className="policy-builder__h3">Splits (policy payees)</h3>
      <p className="muted small">Basis points across rows + holdback must total at most 10,000.</p>
      <div className="split-editor">
        {model.splits.map((row, index) => (
          <div key={index} className="split-editor__row">
            <input
              type="text"
              value={row.payee}
              onChange={(e) => updateSplitRow(index, 'payee', e.target.value)}
              placeholder="Payee pubkey"
              spellCheck={false}
            />
            <input
              type="number"
              min={0}
              max={10000}
              value={row.bps}
              onChange={(e) => updateSplitRow(index, 'bps', e.target.value)}
              className="split-editor__bps"
            />
            <span className="muted">bps</span>
            <button type="button" className="ghost" disabled={model.splits.length <= 1} onClick={() => removeSplitRow(index)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="ghost" disabled={model.splits.length >= 20} onClick={addSplitRow}>
        Add payee row
      </button>

      <h3 className="policy-builder__h3">Documentation</h3>
      <div className="field">
        <label htmlFor="pb-doc">Plain-language summary (optional)</label>
        <textarea
          id="pb-doc"
          className="compact"
          rows={3}
          maxLength={4000}
          value={model.documentation ?? ''}
          onChange={(e) => pushModel({ ...model, documentation: e.target.value || undefined })}
          placeholder="How your team uses milestones, who approves, etc."
        />
      </div>
    </div>
  );
}
