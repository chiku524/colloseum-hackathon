import { useEffect, useMemo, useState } from 'react';
import type { ProposalSnapshot } from './auditExport';
import { countApprovalsFromMask, phaseForProposal, type LifecyclePhase } from './proposalLifecycle';

type Props = {
  open: boolean;
  onClose: () => void;
  proposals: ProposalSnapshot[];
  approvalThreshold: number;
  approverPubkeys: string[];
};

const PHASES: { id: LifecyclePhase; label: string; hint: string }[] = [
  { id: 'propose', label: 'Propose', hint: 'Team lead opens a payout request with amount, wait time, and recipient.' },
  {
    id: 'approve',
    label: 'Approve',
    hint: 'Enough approvers sign the same request until the threshold is met.',
  },
  {
    id: 'timelock',
    label: 'Timelock',
    hint: 'After approvals, the wait period runs before funds can move.',
  },
  { id: 'execute', label: 'Execute', hint: 'Anyone allowed by the program sends the payment (possibly in parts).' },
];

function StepIcon({ phase, active, done, cancelled }: { phase: LifecyclePhase; active: boolean; done: boolean; cancelled: boolean }) {
  if (cancelled && phase !== 'propose') {
    return (
      <span className="lifecycle-step__dot lifecycle-step__dot--muted" title="Cancelled">
        —
      </span>
    );
  }
  if (done) {
    return (
      <span className="lifecycle-step__dot lifecycle-step__dot--done" title="Complete">
        ✓
      </span>
    );
  }
  if (active) {
    return <span className="lifecycle-step__dot lifecycle-step__dot--active" title="Current" />;
  }
  return <span className="lifecycle-step__dot lifecycle-step__dot--todo" title="Not yet" />;
}

export function ProposalLifecycleSimulator({
  open,
  onClose,
  proposals,
  approvalThreshold,
  approverPubkeys,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>('');
  /** Index of highlighted step during demo, or `PHASES.length` when the tour finished. */
  const [demoStep, setDemoStep] = useState(0);
  const [demoRunning, setDemoRunning] = useState(false);

  const selected = useMemo(
    () => proposals.find((p) => p.proposalId === selectedId) ?? null,
    [proposals, selectedId],
  );

  useEffect(() => {
    if (!open || proposals.length === 0) return;
    const last = proposals[proposals.length - 1]!.proposalId;
    setSelectedId((prev) => (prev === '' ? last : prev));
  }, [open, proposals]);

  useEffect(() => {
    if (!open) {
      setDemoRunning(false);
      setDemoStep(0);
    }
  }, [open]);

  const approverCount = approverPubkeys.length;
  const threshold = Math.max(1, Math.min(approvalThreshold || 1, Math.max(approverCount, 1)));

  const approvalCount = selected
    ? countApprovalsFromMask(selected.approvedMask, approverCount)
    : 0;

  const currentPhase: LifecyclePhase | null = selected ? phaseForProposal(selected, threshold, approverCount) : null;

  const stepDone = (idx: number): boolean => {
    if (demoRunning) {
      return demoStep > idx || demoStep >= PHASES.length;
    }
    const id = PHASES[idx]!.id;
    if (!selected) return false;
    if (selected.statusCode === 3) return id === 'propose';
    if (selected.statusCode === 2) return true;
    const order: LifecyclePhase[] = ['propose', 'approve', 'timelock', 'execute'];
    const cur = phaseForProposal(selected, threshold, approverCount);
    const curIdx = order.indexOf(cur);
    const idIdx = order.indexOf(id);
    if (cur === 'cancelled') return id === 'propose';
    return idIdx < curIdx;
  };

  const stepActive = (idx: number): boolean => {
    if (demoRunning) {
      if (demoStep >= PHASES.length) return false;
      return idx === demoStep;
    }
    if (!selected) return idx === 0;
    const id = PHASES[idx]!.id;
    if (selected.statusCode === 3) return id === 'propose';
    return currentPhase === id;
  };

  const runSimulate = () => {
    setDemoRunning(true);
    let i = 0;
    const advance = () => {
      if (i >= PHASES.length) {
        setDemoStep(PHASES.length);
        window.setTimeout(() => {
          setDemoRunning(false);
          setDemoStep(0);
        }, 700);
        return;
      }
      setDemoStep(i);
      i += 1;
      window.setTimeout(advance, 880);
    };
    advance();
  };

  if (!open) return null;

  const cancelled = selected?.statusCode === 3;

  return (
    <div className="lifecycle-modal-root" role="presentation">
      <button type="button" className="lifecycle-modal-root__backdrop" aria-label="Close" onClick={onClose} />
      <div
        className="lifecycle-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lifecycle-modal-title"
      >
        <div className="lifecycle-modal__head">
          <h2 id="lifecycle-modal-title" className="lifecycle-modal__title">
            Proposal lifecycle
          </h2>
          <button type="button" className="lifecycle-modal__close ghost" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        <p className="lifecycle-modal__lede muted">
          Walk through how a payout request moves from draft to execution. Use <strong>Simulate</strong> for a quick
          animated tour, or pick a loaded request to see where it sits today.
        </p>

        {proposals.length > 0 ? (
          <div className="field" style={{ marginBottom: '0.75rem' }}>
            <label htmlFor="lifecycle-pick">Request</label>
            <select
              id="lifecycle-pick"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {proposals.map((p) => (
                <option key={p.proposalId} value={p.proposalId}>
                  #{p.proposalId} — {p.status}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="muted lifecycle-modal__empty">No payout requests loaded yet. Refresh Overview after activity on-chain.</p>
        )}

        {selected ? (
          <p className="lifecycle-modal__meta muted">
            Approvals recorded: <strong>{approvalCount}</strong> / {threshold} needed · Status:{' '}
            <strong>{selected.status}</strong>
            {cancelled ? ' · This request was cancelled.' : null}
          </p>
        ) : null}

        <div className="lifecycle-rail">
          {PHASES.map((ph, idx) => (
            <div key={ph.id} className="lifecycle-rail__segment">
              <div className="lifecycle-rail__nodes">
                <StepIcon
                  phase={ph.id}
                  active={stepActive(idx)}
                  done={stepDone(idx)}
                  cancelled={!!cancelled}
                />
                {idx < PHASES.length - 1 ? (
                  <span
                    className={`lifecycle-rail__bar ${stepDone(idx) ? 'lifecycle-rail__bar--done' : ''}`}
                  />
                ) : null}
              </div>
              <div className="lifecycle-rail__label">
                <span className="lifecycle-rail__title">{ph.label}</span>
                {ph.id === 'approve' && approverCount > 0 ? (
                  <span className="lifecycle-rail__avatars" aria-hidden>
                    {approverPubkeys.slice(0, 5).map((pk, i) => {
                      const bit = selected ? ((selected.approvedMask >> i) & 1) === 1 : false;
                      return (
                        <span
                          key={pk.slice(0, 8)}
                          className={`lifecycle-avatar ${bit ? 'lifecycle-avatar--on' : ''}`}
                          title={pk}
                        >
                          {bit ? '✓' : ''}
                        </span>
                      );
                    })}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <p className="lifecycle-modal__hint muted">
          {demoRunning
            ? demoStep < PHASES.length
              ? PHASES[demoStep]!.hint
              : 'Full path: propose → approvals → timelock → execute. Use the Proposals tab to run each step on-chain.'
            : selected
              ? PHASES.find((p) => p.id === phaseForProposal(selected, threshold, approverCount))?.hint
              : PHASES[0]!.hint}
        </p>

        <div className="lifecycle-modal__actions">
          <button type="button" className="lifecycle-modal__simulate" onClick={runSimulate} disabled={demoRunning}>
            <span className="lifecycle-modal__simulate-icon" aria-hidden>
              ⚙
            </span>
            {demoRunning ? 'Running…' : 'Simulate'}
          </button>
        </div>
      </div>
    </div>
  );
}
