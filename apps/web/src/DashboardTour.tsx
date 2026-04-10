import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';

export type AppMainTab = 'overview' | 'treasury' | 'setup' | 'policy' | 'ledger' | 'widgets';

type TourStep = {
  title: string;
  body: ReactNode;
  tab?: AppMainTab;
  /** Scroll target: element receives a temporary highlight class */
  highlightSelector?: string;
  scrollTop?: boolean;
};

const STEPS: TourStep[] = [
  {
    title: 'Welcome to your treasury',
    body: (
      <>
        <p>
          You are signed in as the <strong>team lead</strong>. This app connects to Solana so you can load your project,
          set payout rules, and coordinate approvals with teammates.
        </p>
        <p className="dashboard-tour__tip">The next screens point at the main controls — follow along, or skip anytime.</p>
      </>
    ),
    scrollTop: true,
  },
  {
    title: 'Wallet and network',
    body: (
      <>
        <p>
          Use the wallet control to <strong>disconnect</strong> or <strong>switch accounts</strong> (including the
          in-browser email wallet). The badge shows which <strong>RPC cluster</strong> this page uses — your wallet should
          use the same network or transactions may fail.
        </p>
      </>
    ),
    highlightSelector: '[data-tour="tour-wallet"]',
    scrollTop: true,
  },
  {
    title: 'Move between sections',
    body: (
      <>
        <p>
          These tabs are the spine of the app: <strong>Overview</strong> loads live data; <strong>Setup</strong> creates or
          updates your on-chain team; <strong>Policy</strong> defines who can be paid; <strong>Proposals</strong> is where
          payout requests live; <strong>Treasury</strong> shows charts; <strong>Share</strong> builds public status links.
        </p>
      </>
    ),
    highlightSelector: '[data-tour="tour-tabs"]',
    scrollTop: true,
  },
  {
    title: 'Start on Overview',
    body: (
      <>
        <p>
          Confirm the <strong>project number</strong> matches what you use on-chain (and in Setup), then tap{' '}
          <strong>Refresh data</strong> to pull vault balance, rules version, and payout requests from Solana.
        </p>
        <p className="dashboard-tour__tip">You will repeat Refresh whenever you want the latest numbers.</p>
      </>
    ),
    tab: 'overview',
    highlightSelector: '[data-tour="tour-overview-actions"]',
  },
  {
    title: 'You are set',
    body: (
      <>
        <p>
          Typical flow: align <strong>Setup</strong> with your program, tune <strong>Policy</strong>, fund the vault, then
          work payout requests under <strong>Proposals</strong>. Use <strong>Share</strong> when you want a read-only link
          for stakeholders.
        </p>
        <p className="dashboard-tour__tip">You will not see this tour again unless you clear site data for this app.</p>
      </>
    ),
    tab: 'overview',
    scrollTop: true,
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
  tab: AppMainTab;
  setTab: (t: AppMainTab) => void;
};

export function DashboardTour({ open, onClose, tab, setTab }: Props) {
  const titleId = useId();
  const [stepIndex, setStepIndex] = useState(0);

  const step = STEPS[stepIndex] ?? STEPS[0];

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (step.tab && step.tab !== tab) {
      setTab(step.tab);
    }
  }, [open, step.tab, tab, setTab]);

  useEffect(() => {
    if (!open) return;

    const run = () => {
      if (step.scrollTop) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (!step.highlightSelector) return;
      const el = document.querySelector(step.highlightSelector);
      if (!(el instanceof HTMLElement)) return;
      el.classList.add('tour-highlight-target');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    let timeoutId: number | undefined;
    const rafId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(run, step.tab ? 80 : 0);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      document.querySelectorAll('.tour-highlight-target').forEach((n) => {
        n.classList.remove('tour-highlight-target');
      });
    };
  }, [open, stepIndex, step.highlightSelector, step.scrollTop, step.tab, tab]);

  const finish = useCallback(() => {
    document.querySelectorAll('.tour-highlight-target').forEach((n) => {
      n.classList.remove('tour-highlight-target');
    });
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish]);

  if (!open) return null;

  const isLast = stepIndex >= STEPS.length - 1;

  return (
    <div
      className="dashboard-tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="dashboard-tour-panel">
        <p className="dashboard-tour__step-label">
          Step {stepIndex + 1} of {STEPS.length}
        </p>
        <h2 id={titleId} className="dashboard-tour__title">
          {step.title}
        </h2>
        <div className="dashboard-tour__body">{step.body}</div>
        <div className="dashboard-tour__actions">
          <button type="button" className="ghost" onClick={finish}>
            Skip tour
          </button>
          <div className="dashboard-tour__nav">
            <button
              type="button"
              className="ghost"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              Back
            </button>
            {isLast ? (
              <button type="button" onClick={finish}>
                Done
              </button>
            ) : (
              <button type="button" onClick={() => setStepIndex((i) => i + 1)}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
