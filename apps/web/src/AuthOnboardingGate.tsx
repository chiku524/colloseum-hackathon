import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { CloudEmailAuthPanel } from './CloudEmailAuthPanel';
import { BRAND_NAME, BRAND_TAGLINE } from './brand';
import { BrandMark } from './BrandMark';
import { LoadingSpinner } from './LoadingSpinner';
import { createVault, hasEmbeddedVault, readVaultRecord, unlockVault, validateNewPassword } from './embeddedWalletVault';
import {
  dispatchOnboardingApplied,
  readOnboarding,
  writeOnboarding,
  type OnboardingPayloadV1,
} from './onboardingStorage';
import { getSupabaseBrowserClient, isSupabaseConfigured } from './supabase/client';
import {
  STRONGHOLD_EMBEDDED_WALLET_NAME,
  type StrongholdEmbeddedWalletAdapter,
} from './StrongholdEmbeddedWalletAdapter';

function resetOnboardingProgress(): void {
  writeOnboarding({
    complete: false,
    projectName: 'My treasury',
    projectId: '0',
    approversText: '',
    threshold: '1',
  });
}

type Props = {
  children: ReactNode;
  embeddedAdapter: StrongholdEmbeddedWalletAdapter;
};

export function AuthOnboardingGate({ children, embeddedAdapter }: Props) {
  const wallet = useWallet();
  const { publicKey, select, connect, disconnect } = wallet;

  const [onboardingDone, setOnboardingDone] = useState(() => readOnboarding()?.complete ?? false);
  const [authMode, setAuthMode] = useState<'wallet' | 'email'>(() => {
    if (typeof window === 'undefined') return 'wallet';
    if (isSupabaseConfigured()) return 'email';
    return hasEmbeddedVault() ? 'email' : 'wallet';
  });
  const [emailTab, setEmailTab] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    const onApplied = (e: Event) => {
      const d = (e as CustomEvent<OnboardingPayloadV1>).detail;
      if (d?.complete) setOnboardingDone(true);
    };
    window.addEventListener('stronghold-onboarding-applied', onApplied);
    return () => window.removeEventListener('stronghold-onboarding-applied', onApplied);
  }, []);

  useEffect(() => {
    const v = readVaultRecord();
    if (v && emailTab === 'sign-in' && !email) {
      setEmail(v.emailNorm);
    }
  }, [emailTab, email]);

  const showVaultHint = hasEmbeddedVault();

  const onUnlockEmbedded = useCallback(async () => {
    setAuthErr(null);
    setAuthBusy(true);
    try {
      const kp = await unlockVault(email, password);
      embeddedAdapter.setUnlockedKeypair(kp);
      try {
        await disconnect();
      } catch {
        /* noop if nothing connected */
      }
      await select(STRONGHOLD_EMBEDDED_WALLET_NAME);
      await connect();
      setPassword('');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  }, [connect, disconnect, email, embeddedAdapter, password, select]);

  const onRegisterEmbedded = useCallback(async () => {
    setAuthErr(null);
    const pwErr = validateNewPassword(password);
    if (pwErr) {
      setAuthErr(pwErr);
      return;
    }
    if (!email.trim()) {
      setAuthErr('Enter your email.');
      return;
    }
    setAuthBusy(true);
    try {
      const kp = await createVault(email, password);
      embeddedAdapter.setUnlockedKeypair(kp);
      try {
        await disconnect();
      } catch {
        /* noop */
      }
      await select(STRONGHOLD_EMBEDDED_WALLET_NAME);
      await connect();
      setPassword('');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  }, [connect, disconnect, email, embeddedAdapter, password, select]);

  const [projName, setProjName] = useState('My treasury');
  const [projId, setProjId] = useState('0');
  const [approversExtra, setApproversExtra] = useState('');
  const [threshold, setThreshold] = useState('1');
  const [onboardErr, setOnboardErr] = useState<string | null>(null);

  const leadLine = publicKey ? publicKey.toBase58() : '';

  const finishOnboarding = useCallback(() => {
    setOnboardErr(null);
    const idNum = Number(projId);
    if (!Number.isFinite(idNum) || idNum < 0 || !Number.isInteger(idNum)) {
      setOnboardErr('Project number must be a whole number ≥ 0.');
      return;
    }
    const th = Number(threshold);
    const extraParts = approversExtra.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    for (const p of extraParts) {
      try {
        new PublicKey(p);
      } catch {
        setOnboardErr(`Invalid approver address: ${p.slice(0, 8)}…`);
        return;
      }
    }
    const lines = [leadLine, ...extraParts];
    const unique = new Set(lines);
    if (unique.size !== lines.length) {
      setOnboardErr('Each approver pubkey must be unique.');
      return;
    }
    if (!Number.isInteger(th) || th < 1 || th > lines.length) {
      setOnboardErr(`Approvals needed must be between 1 and ${lines.length}.`);
      return;
    }
    const approversText = lines.join('\n');
    const payload: OnboardingPayloadV1 = {
      v: 1,
      complete: true,
      projectName: projName.trim() || 'My treasury',
      projectId: String(Math.floor(idNum)),
      approversText,
      threshold: String(th),
    };
    writeOnboarding(payload);
    dispatchOnboardingApplied(payload);
    setOnboardingDone(true);
  }, [approversExtra, leadLine, projId, projName, threshold]);

  const gateOpen = Boolean(publicKey && onboardingDone);

  if (gateOpen) {
    return <>{children}</>;
  }

  return (
    <>
      <div
        className="auth-gate-overlay auth-gate-overlay--enter"
        role="dialog"
        aria-modal="true"
        aria-label="Sign in and onboarding"
      >
        <div
          className={`auth-gate-panel auth-gate-panel--enter${!publicKey ? ' auth-gate-panel--signin-flow' : ''}`}
        >
          <div className="auth-gate-brand">
            <BrandMark className={`auth-gate-brand-mark${!publicKey ? ' auth-intro-stagger-1' : ''}`} />
            <div className={!publicKey ? 'auth-intro-stagger-2' : undefined}>
              <h1 className="auth-gate-title">{BRAND_NAME}</h1>
              <p className="auth-gate-tagline">{BRAND_TAGLINE}</p>
            </div>
          </div>

          {!publicKey ? (
            <div
              key="signin"
              className="auth-gate-section auth-flow-step-enter auth-flow-step-enter--delayed"
            >
              <h2 className="auth-gate-h2">Sign in</h2>
              <p className="muted auth-gate-lead">
                {isSupabaseConfigured()
                  ? 'Use a Solana wallet extension, or sign in with email (verified account + optional multi-device sync via your Supabase project).'
                  : 'Use a Solana wallet extension, or create an in-browser wallet with your email (encrypted on this device only — add Supabase env vars for cloud accounts).'}
              </p>

              <div className="auth-gate-tabs" role="tablist" aria-label="Sign-in method">
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === 'wallet'}
                  className={`auth-gate-tab${authMode === 'wallet' ? ' auth-gate-tab--active' : ''}`}
                  onClick={() => {
                    setAuthMode('wallet');
                    setAuthErr(null);
                  }}
                >
                  Wallet
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === 'email'}
                  className={`auth-gate-tab${authMode === 'email' ? ' auth-gate-tab--active' : ''}`}
                  onClick={() => {
                    setAuthMode('email');
                    setAuthErr(null);
                  }}
                >
                  Email
                </button>
              </div>

              {authMode === 'wallet' ? (
                <div key="wallet" className="auth-gate-wallet auth-flow-step-enter">
                  <WalletMultiButton className="auth-gate-wallet-btn" />
                  <p className="muted small">
                    Phantom, Solflare, or another supported wallet. After it connects, you will set up your team treasury.
                  </p>
                </div>
              ) : isSupabaseConfigured() ? (
                <CloudEmailAuthPanel
                  embeddedAdapter={embeddedAdapter}
                  select={(name) => Promise.resolve(select(name))}
                  connect={() => Promise.resolve(connect())}
                  disconnect={() => Promise.resolve(disconnect())}
                />
              ) : (
                <div key="embedded-email" className="auth-gate-email auth-flow-step-enter">
                  {showVaultHint ? (
                    <p className="muted small auth-gate-recovery-hint">
                      This browser already has an email wallet. Sign in below, or register a new one only if you intend to
                      replace it (you will lose access to the old vault unless you exported keys elsewhere).
                    </p>
                  ) : null}

                  <div className="auth-gate-email-tabs">
                    <button
                      type="button"
                      className={emailTab === 'sign-in' ? 'auth-link auth-link--active' : 'auth-link'}
                      onClick={() => setEmailTab('sign-in')}
                    >
                      Sign in
                    </button>
                    <span className="muted" aria-hidden>
                      ·
                    </span>
                    <button
                      type="button"
                      className={emailTab === 'register' ? 'auth-link auth-link--active' : 'auth-link'}
                      onClick={() => setEmailTab('register')}
                    >
                      Register
                    </button>
                  </div>

                  <label className="auth-field">
                    <span>Email</span>
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@team.xyz"
                    />
                  </label>
                  <label className="auth-field">
                    <span>Password</span>
                    <input
                      type="password"
                      autoComplete={emailTab === 'register' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={emailTab === 'register' ? 'At least 10 characters' : ''}
                    />
                  </label>

                  {authErr ? <p className="auth-gate-err">{authErr}</p> : null}

                  {emailTab === 'sign-in' ? (
                    <button
                      type="button"
                      className={`auth-gate-submit${authBusy ? ' auth-gate-submit--with-spinner' : ''}`}
                      disabled={authBusy}
                      onClick={() => void onUnlockEmbedded()}
                    >
                      {authBusy ? (
                        <>
                          <LoadingSpinner size="sm" label="Unlocking wallet" />
                          <span>Unlocking…</span>
                        </>
                      ) : (
                        'Unlock email wallet'
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`auth-gate-submit${authBusy ? ' auth-gate-submit--with-spinner' : ''}`}
                      disabled={authBusy}
                      onClick={() => void onRegisterEmbedded()}
                    >
                      {authBusy ? (
                        <>
                          <LoadingSpinner size="sm" label="Creating wallet" />
                          <span>Creating…</span>
                        </>
                      ) : (
                        'Create email wallet & continue'
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div key="onboard" className="auth-gate-section auth-flow-step-enter">
              <h2 className="auth-gate-h2">Create your team / project</h2>
              <p className="muted auth-gate-lead">
                Your connected address is the <strong>team lead</strong> on-chain. You can add co-approvers now or later in
                Setup.
              </p>
              <p className="auth-gate-pubkey mono" title={leadLine}>
                {leadLine}
              </p>

              <label className="auth-field">
                <span>Treasury display name</span>
                <input value={projName} onChange={(e) => setProjName(e.target.value)} maxLength={64} />
              </label>
              <label className="auth-field">
                <span>Project number</span>
                <input
                  value={projId}
                  onChange={(e) => setProjId(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  placeholder="0"
                />
                <span className="muted small">Same number you use when initializing the on-chain project PDA.</span>
              </label>
              <label className="auth-field">
                <span>Extra approvers (optional)</span>
                <textarea
                  value={approversExtra}
                  onChange={(e) => setApproversExtra(e.target.value)}
                  rows={3}
                  placeholder="One Solana address per line or comma-separated (team lead is already first)"
                  className="auth-field-textarea"
                />
              </label>
              <label className="auth-field">
                <span>Approvals required</span>
                <input value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/[^\d]/g, ''))} />
              </label>

              {onboardErr ? <p className="auth-gate-err">{onboardErr}</p> : null}

              <button type="button" className="auth-gate-submit" onClick={finishOnboarding}>
                Finish & open dashboard
              </button>
              <button
                type="button"
                className="ghost auth-gate-back"
                onClick={() => {
                  resetOnboardingProgress();
                  setOnboardingDone(false);
                  if (isSupabaseConfigured()) void getSupabaseBrowserClient()?.auth.signOut();
                  void disconnect();
                  embeddedAdapter.setUnlockedKeypair(null);
                }}
              >
                Use a different account
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Keep tree mounted so hooks in children stay valid; hide until gate passes */}
      <div className={gateOpen ? undefined : 'auth-gate-hidden-app'} aria-hidden={!gateOpen}>
        {children}
      </div>
    </>
  );
}
