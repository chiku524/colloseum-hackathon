import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';

export type AppMainTab = 'overview' | 'treasury' | 'setup' | 'policy' | 'ledger' | 'widgets';

type TourStep = {
  title: string;
  body: ReactNode;
  tab?: AppMainTab;
  /** Scroll target: element receives a temporary highlight class */
  highlightSelector?: string;
  scrollTop?: boolean;
  /** Extra wait after tab switch (e.g. lazy-loaded panels) before highlighting */
  highlightDelayMs?: number;
};

const STEPS: TourStep[] = [
  {
    title: 'Set up your team escrow vault',
    body: (
      <>
        <p>
          As <strong>team lead</strong>, you will register the project on Solana, turn on the shared token vault, define
          who can be paid, and put those rules on-chain. Approvers then sign payout requests against that vault.
        </p>
        <p className="dashboard-tour__tip">Use Next to walk the path in order, or skip anytime.</p>
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
          For vault setup you will mainly use <strong>Overview</strong> (load status), <strong>Setup</strong> (project +
          vault + deposits), and <strong>Policy</strong> (payout rules). Later: <strong>Proposals</strong> for payout
          requests, <strong>Treasury</strong> for charts, <strong>Share</strong> for read-only links.
        </p>
      </>
    ),
    highlightSelector: '[data-tour="tour-tabs"]',
    scrollTop: true,
  },
  {
    title: 'Load your project from Solana',
    body: (
      <>
        <p>
          Enter your <strong>project number</strong> (the same value you will use under Setup). Tap{' '}
          <strong>Refresh data</strong> to see whether the project exists yet and to load vault status. If nothing is found,
          create the project next under Setup, then refresh again.
        </p>
        <p className="dashboard-tour__tip">Refresh whenever you want the latest balances and rules version.</p>
      </>
    ),
    tab: 'overview',
    highlightSelector: '[data-tour="tour-overview-actions"]',
  },
  {
    title: 'Create the on-chain team project',
    body: (
      <>
        <p>
          First-time only: set the <strong>team name</strong>, list <strong>approver wallets</strong> (yours first), and
          how many signatures are required. Then run <strong>Create project</strong>. If the project already exists for
          this wallet and number, you can skip this and continue.
        </p>
      </>
    ),
    tab: 'setup',
    highlightSelector: '[data-tour="tour-setup-project"]',
  },
  {
    title: 'Turn on the vault and fund it',
    body: (
      <>
        <p>
          Paste the token <strong>mint address</strong> (e.g. devnet USDC) and run <strong>Turn vault on for this token</strong>{' '}
          once. After it succeeds, use <strong>Deposit into vault</strong> to move funds from your wallet into the team
          escrow. Amounts are in the token&apos;s smallest units.
        </p>
        <p className="dashboard-tour__tip">You need a successful Refresh on Overview before vault actions unlock.</p>
      </>
    ),
    tab: 'setup',
    highlightSelector: '[data-tour="tour-setup-vault"]',
  },
  {
    title: 'Define payout rules',
    body: (
      <>
        <p>
          Pick a <strong>template</strong> or edit splits and workflow here. This is the off-chain rules document your team
          follows; it should match who you expect to pay. You will commit a fingerprint on-chain in the next step.
        </p>
      </>
    ),
    tab: 'policy',
    highlightSelector: '[data-tour="tour-policy-builder"]',
    highlightDelayMs: 220,
  },
  {
    title: 'Save rules on-chain',
    body: (
      <>
        <p>
          Use <strong>Check rules</strong> if you want validation, then <strong>Save rules on-chain</strong> so Solana stores
          the policy fingerprint. Payout proposals reference that version so everyone agrees which rules apply.
        </p>
      </>
    ),
    tab: 'policy',
    highlightSelector: '[data-tour="tour-policy-apply"]',
    highlightDelayMs: 220,
  },
  {
    title: 'Confirm the vault is live',
    body: (
      <>
        <p>
          Back on Overview, <strong>Refresh data</strong> and check <strong>Vault ready</strong>, <strong>Vault balance</strong>,
          and <strong>Rules version</strong>. Then you are ready to open <strong>Proposals</strong> for payout requests, or{' '}
          <strong>Share</strong> for stakeholders.
        </p>
        <p className="dashboard-tour__tip">
          Open it anytime from the header (<strong>App tour</strong>), or choose <strong>Reset tour</strong> there to
          start over and turn the automatic sign-in tour back on until you finish or skip.
        </p>
      </>
    ),
    tab: 'overview',
    highlightSelector: '[data-tour="tour-overview-stats"]',
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

    const delayMs = step.highlightDelayMs ?? (step.tab ? 80 : 0);
    let timeoutId: number | undefined;
    const rafId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(run, delayMs);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      document.querySelectorAll('.tour-highlight-target').forEach((n) => {
        n.classList.remove('tour-highlight-target');
      });
    };
  }, [open, stepIndex, step.highlightSelector, step.highlightDelayMs, step.scrollTop, step.tab, tab]);

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
