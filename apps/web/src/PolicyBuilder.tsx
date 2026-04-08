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
import {
  SectionHeader,
  UxIconAutomation,
  UxIconClock,
  UxIconPolicy,
  UxIconProposals,
  UxIconSliders,
  UxIconToolbox,
  UxIconVault,
} from './UxVisual';

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
    const t = window.setTimeout(() => {
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
    }, 280);
    return () => window.clearTimeout(t);
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
        <SectionHeader icon={<UxIconPolicy />} title="Policy builder" />
        {parseErr ? (
          <p className="error" role="alert">
            Fix the raw rules under Policy → Advanced, then come back: {parseErr}
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
      <SectionHeader icon={<UxIconPolicy />} title="Payout rules" />
      <p className="muted">
        Pick a template or edit splits below. This drives the “what if” calculator and optional checks before you sign a
        payout. Saving on-chain still uses your approvers, wait times, and payment flow — this page is how you document who
        should get what.
      </p>

      {parseErr && (
        <p className="muted" style={{ color: 'var(--danger)' }}>
          The advanced rules file has an error — fix it to sync. Showing the last version that worked: {parseErr}
        </p>
      )}

      <SectionHeader icon={<UxIconToolbox />} title="Templates" level="sub" />
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
          <span>Four real wallet addresses (you + 3 collaborators).</span>
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
            placeholder="Partner’s Solana wallet address"
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
            placeholder="Contractor wallet address"
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

      <SectionHeader icon={<UxIconSliders />} title="Workflow toggles" level="sub" />
      <div className="toggle-list">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={Boolean(model.workflow?.suggestArtifactGate)}
            onChange={(e) => updateWorkflow({ suggestArtifactGate: e.target.checked })}
          />
          <span>
            Suggest <strong>proof before paying</strong> (turn on under Setup so payouts need a delivery fingerprint —
            good for milestones).
          </span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={Boolean(model.workflow?.payoutRecipientsMustBePolicyPayees)}
            onChange={(e) => updateWorkflow({ payoutRecipientsMustBePolicyPayees: e.target.checked })}
          />
          <span>
            <strong>Only pay wallets listed here</strong> — this app warns before you sign if someone else is chosen (the
            chain still stores a compact fingerprint of these rules).
          </span>
        </label>
      </div>

      <div className="field" style={{ marginTop: '0.75rem' }}>
        <label htmlFor="pb-title">Short title (for your team’s records)</label>
        <input
          id="pb-title"
          type="text"
          value={model.workflow?.title ?? ''}
          onChange={(e) => updateWorkflow({ title: e.target.value || undefined })}
          placeholder="e.g. Q2 collective payout rules"
          maxLength={200}
        />
      </div>

      <SectionHeader icon={<UxIconClock />} title="Timelock default" level="sub" />
      <p className="muted small">Used when you tap “Use rules default” on the Proposals tab.</p>
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

      <SectionHeader icon={<UxIconVault />} title="Holdback" level="sub" />
      <div className="field" style={{ maxWidth: '12rem' }}>
        <label htmlFor="pb-hold">Hold back (points out of 10,000 — 100 = 1%)</label>
        <input
          id="pb-hold"
          type="number"
          min={0}
          max={10000}
          value={model.holdbackBps}
          onChange={(e) => pushModel({ ...model, holdbackBps: Math.min(10_000, Math.max(0, Number(e.target.value) || 0)) })}
        />
      </div>

      <SectionHeader icon={<UxIconAutomation />} title="Automation notes (informational)" level="sub" />
      <p className="muted small">
        The blockchain cannot run a clock by itself. Use this field to leave notes for your team about future auto-payout
        ideas — it does not turn anything on by itself.
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
            <option value="none">None (people trigger every payout)</option>
            <option value="planned_crank">Planned automation (notes only — not live)</option>
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

      <SectionHeader icon={<UxIconProposals />} title="Who gets what (split list)" level="sub" />
      <p className="muted small">
        Each row is a wallet and its share in points (out of 10,000). All rows plus holdback must stay at or under
        10,000 points.
      </p>
      <div className="split-editor">
        {model.splits.map((row, index) => (
          <div key={index} className="split-editor__row">
            <input
              type="text"
              value={row.payee}
              onChange={(e) => updateSplitRow(index, 'payee', e.target.value)}
              placeholder="Wallet address"
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
            <span className="muted">pts / 10k</span>
            <button type="button" className="ghost" disabled={model.splits.length <= 1} onClick={() => removeSplitRow(index)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="ghost" disabled={model.splits.length >= 20} onClick={addSplitRow}>
        Add wallet row
      </button>

      <SectionHeader icon={<UxIconPolicy />} title="Documentation" level="sub" />
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
