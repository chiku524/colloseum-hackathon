import { type CSSProperties, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

const SPOTLIGHT_PAD = 8;
const PANEL_GAP = 14;
const VIEW_PAD = 16;

/** Place the panel so it does not cover the highlight rectangle (viewport coords). */
function layoutTourPanel(rect: DOMRect, panelW: number, panelH: number, vw: number, vh: number): { top: number; left: number } {
  const left = Math.max(
    VIEW_PAD,
    Math.min(rect.left + rect.width / 2 - panelW / 2, vw - panelW - VIEW_PAD),
  );

  const spaceBelow = vh - rect.bottom - VIEW_PAD;
  const spaceAbove = rect.top - VIEW_PAD;
  const preferBelow = spaceBelow >= spaceAbove;

  let top: number;
  if (preferBelow && spaceBelow >= panelH + PANEL_GAP) {
    top = rect.bottom + PANEL_GAP;
  } else if (!preferBelow && spaceAbove >= panelH + PANEL_GAP) {
    top = rect.top - panelH - PANEL_GAP;
  } else if (spaceBelow >= panelH + PANEL_GAP) {
    top = rect.bottom + PANEL_GAP;
  } else if (spaceAbove >= panelH + PANEL_GAP) {
    top = rect.top - panelH - PANEL_GAP;
  } else {
    top = Math.max(VIEW_PAD, Math.min(vh - panelH - VIEW_PAD, rect.bottom + PANEL_GAP));
  }

  const pBottom = top + panelH;
  if (top < rect.bottom + PANEL_GAP * 0.5 && pBottom > rect.top - PANEL_GAP * 0.5) {
    if (rect.bottom < vh * 0.55) {
      top = Math.min(rect.bottom + PANEL_GAP, vh - panelH - VIEW_PAD);
    } else {
      top = Math.max(VIEW_PAD, rect.top - panelH - PANEL_GAP);
    }
  }

  top = Math.max(VIEW_PAD, Math.min(top, vh - panelH - VIEW_PAD));
  return { top, left };
}

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
  const panelRef = useRef<HTMLDivElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [panelBox, setPanelBox] = useState<{ top: number; left: number; width: number } | null>(null);

  const step = STEPS[stepIndex] ?? STEPS[0];

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
      setSpotlight(null);
      setPanelBox(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (step.tab && step.tab !== tab) {
      setTab(step.tab);
    }
  }, [open, step.tab, tab, setTab]);

  const syncSpotlightAndPanel = useCallback(() => {
    if (!open) return;
    if (!step.highlightSelector) {
      setSpotlight(null);
      setPanelBox(null);
      return;
    }
    const el = document.querySelector(step.highlightSelector);
    if (!(el instanceof HTMLElement)) {
      setSpotlight(null);
      setPanelBox(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setSpotlight({
      top: r.top - SPOTLIGHT_PAD,
      left: r.left - SPOTLIGHT_PAD,
      width: r.width + SPOTLIGHT_PAD * 2,
      height: r.height + SPOTLIGHT_PAD * 2,
    });
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = Math.min(420, vw - VIEW_PAD * 2);
    const ph = panelRef.current?.getBoundingClientRect().height ?? 280;
    const { top, left } = layoutTourPanel(r, pw, ph, vw, vh);
    setPanelBox({ top, left, width: pw });
  }, [open, step.highlightSelector]);

  useEffect(() => {
    if (!open) return;

    const run = () => {
      if (step.scrollTop) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      document.querySelectorAll('.tour-highlight-target').forEach((n) => {
        n.classList.remove('tour-highlight-target');
      });
      if (!step.highlightSelector) {
        setSpotlight(null);
        setPanelBox(null);
        return;
      }
      const el = document.querySelector(step.highlightSelector);
      if (!(el instanceof HTMLElement)) {
        setSpotlight(null);
        setPanelBox(null);
        return;
      }
      el.classList.add('tour-highlight-target');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      syncSpotlightAndPanel();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => syncSpotlightAndPanel());
      });
      window.setTimeout(syncSpotlightAndPanel, 420);
    };

    const delayMs = step.highlightDelayMs ?? (step.tab ? 80 : 0);
    let timeoutId: number | undefined;
    const rafId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(run, delayMs);
    });

    const onScrollOrResize = () => {
      syncSpotlightAndPanel();
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    return () => {
      window.cancelAnimationFrame(rafId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      document.querySelectorAll('.tour-highlight-target').forEach((n) => {
        n.classList.remove('tour-highlight-target');
      });
      setSpotlight(null);
      setPanelBox(null);
    };
  }, [open, stepIndex, step.highlightSelector, step.highlightDelayMs, step.scrollTop, step.tab, tab, syncSpotlightAndPanel]);

  useEffect(() => {
    if (!open || !step.highlightSelector) return;
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      syncSpotlightAndPanel();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, step.highlightSelector, stepIndex, syncSpotlightAndPanel]);

  const finish = useCallback(() => {
    document.querySelectorAll('.tour-highlight-target').forEach((n) => {
      n.classList.remove('tour-highlight-target');
    });
    setSpotlight(null);
    setPanelBox(null);
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
  const highlightMode = Boolean(step.highlightSelector);

  const panelStyle: CSSProperties | undefined = highlightMode
    ? panelBox
      ? {
          position: 'fixed',
          top: panelBox.top,
          left: panelBox.left,
          width: panelBox.width,
          maxHeight: 'min(70vh, 28rem)',
          zIndex: 2,
        }
      : {
          position: 'fixed',
          left: '50%',
          bottom: 'max(1rem, env(safe-area-inset-bottom, 0px))',
          transform: 'translateX(-50%)',
          width: 'min(420px, calc(100% - 2rem))',
          maxHeight: 'min(70vh, 28rem)',
          zIndex: 2,
        }
    : undefined;

  return (
    <div
      className={`dashboard-tour-overlay${highlightMode ? ' dashboard-tour-overlay--spotlight' : ' dashboard-tour-overlay--dimmed'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {!highlightMode ? <div className="dashboard-tour-dim-full" aria-hidden /> : null}
      {highlightMode && spotlight ? (
        <div
          className="dashboard-tour-spotlight-hole"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
          aria-hidden
        />
      ) : null}
      <div className={`dashboard-tour-panel-wrap${highlightMode ? '' : ' dashboard-tour-panel-wrap--center'}`}>
        <div ref={panelRef} className="dashboard-tour-panel" style={panelStyle}>
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
    </div>
  );
}
