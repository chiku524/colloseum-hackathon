import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { WalletName } from '@solana/wallet-adapter-base';
import { Keypair } from '@solana/web3.js';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRAND_NAME } from './brand';
import { validateNewPassword } from './embeddedWalletVault';
import {
  buildKeybagPayload,
  generateRecoveryMnemonic,
  rewrapKeybagPasswordFromRecovery,
  type SolanaKeybagRow,
  unlockKeypairFromKeybag,
} from './keybag/cloudKeybagCrypto';
import {
  fetchKeybagForUser,
  insertKeybag,
  isUniqueViolationError,
  updateKeybagPasswordWrap,
} from './keybag/cloudKeybagRepository';
import { getSupabaseBrowserClient, resetSupabaseBrowserClient } from './supabase/client';
import {
  authServiceUnavailableMessage,
  clearSupabaseBrowserAuthStorage,
  isAuthServiceUnavailableError,
} from './supabase/authErrors';
import { getAuthEmailRedirectUrl } from './supabase/authRedirect';
import { getSupabaseProjectRefFromUrl, getSupabaseUrl } from './supabase/supabaseEnv';
import { STRONGHOLD_EMBEDDED_WALLET_NAME, type StrongholdEmbeddedWalletAdapter } from './StrongholdEmbeddedWalletAdapter';
import { LoadingSpinner } from './LoadingSpinner';

type BusyAction =
  | 'sign-in'
  | 'sign-up'
  | 'forgot'
  | 'resend-verify'
  | 'create-keybag'
  | 'unlock'
  | 'password-recovery'
  | 'recovery-rewrap';

function AuthAnimatedStep({ stepKey, children }: { stepKey: string; children: ReactNode }) {
  return (
    <div key={stepKey} className="auth-gate-email auth-flow-step-enter">
      {children}
    </div>
  );
}

export type CloudEmailAuthPanelProps = {
  embeddedAdapter: StrongholdEmbeddedWalletAdapter;
  select: (walletName: WalletName) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

type Phase =
  | 'loading'
  | 'auth'
  | 'verify_email'
  | 'create_keybag'
  | 'unlock_keybag'
  | 'password_recovery'
  | 'recovery_rewrap';

/** If GoTrue never emits `onAuthStateChange` (stuck refresh / 503), recover without `signOut` (avoids lock fights). */
const SESSION_INIT_TIMEOUT_MS = 12_000;

function formatAuthFlowError(err: unknown): string {
  if (isAuthServiceUnavailableError(err)) return authServiceUnavailableMessage();
  return err instanceof Error ? err.message : String(err);
}

function recoverFromStuckSupabaseAuth(setSupabaseEpoch: (u: (n: number) => number) => void): void {
  const ref = getSupabaseProjectRefFromUrl(getSupabaseUrl());
  if (ref) clearSupabaseBrowserAuthStorage(ref);
  resetSupabaseBrowserClient();
  setSupabaseEpoch((n) => n + 1);
}

export function CloudEmailAuthPanel({ embeddedAdapter, select, connect, disconnect }: CloudEmailAuthPanelProps) {
  const [supabaseEpoch, setSupabaseEpoch] = useState(0);
  const supabase = useMemo(() => {
    resetSupabaseBrowserClient();
    return getSupabaseBrowserClient()!;
  }, [supabaseEpoch]);

  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [keybagRow, setKeybagRow] = useState<SolanaKeybagRow | null>(null);
  const [emailTab, setEmailTab] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [mnemonicDraft, setMnemonicDraft] = useState('');
  const [savedMnemonicConfirm, setSavedMnemonicConfirm] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  /** When signUp returns a user but no session (email confirmation required), Auth does not expose the user on `session` yet — keep the address for verify UI + resend. */
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const pendingVerificationEmailRef = useRef<string | null>(null);
  pendingVerificationEmailRef.current = pendingVerificationEmail;
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const busy = busyAction !== null;
  const [resendCooldownSec, setResendCooldownSec] = useState(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const resendCooldownActive = resendCooldownSec > 0;
  useEffect(() => {
    if (!resendCooldownActive) return;
    const id = window.setInterval(() => {
      setResendCooldownSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendCooldownActive]);

  const connectEmbedded = useCallback(
    async (kp: Keypair) => {
      try {
        await disconnect();
      } catch {
        /* noop */
      }
      // Must run after disconnect: embedded adapter.disconnect() clears the unlocked keypair.
      embeddedAdapter.setUnlockedKeypair(kp);
      await select(STRONGHOLD_EMBEDDED_WALLET_NAME);
      await connect();
    },
    [connect, disconnect, embeddedAdapter, select],
  );

  useEffect(() => {
    let cancelled = false;

    const route = async (sess: Session | null, event?: AuthChangeEvent) => {
      if (cancelled) return;
      if (event === 'USER_UPDATED' && phaseRef.current === 'password_recovery') {
        return;
      }
      setSession(sess);
      setAuthErr(null);

      if (event === 'PASSWORD_RECOVERY' && sess) {
        try {
          const row = await fetchKeybagForUser(supabase, sess.user.id);
          if (cancelled) return;
          setKeybagRow(row);
          setPhase('password_recovery');
        } catch (e) {
          setAuthErr(e instanceof Error ? e.message : String(e));
          setPhase('password_recovery');
        }
        return;
      }

      if (!sess) {
        // After signUp without session, GoTrue often emits null session — keep verify UI + pending email.
        if (pendingVerificationEmailRef.current) {
          setPhase('verify_email');
          return;
        }
        setPendingVerificationEmail(null);
        setPhase('auth');
        setKeybagRow(null);
        setMnemonicDraft('');
        setSavedMnemonicConfirm(false);
        embeddedAdapter.setUnlockedKeypair(null);
        return;
      }

      if (!sess.user.email_confirmed_at) {
        setPendingVerificationEmail(null);
        setPhase('verify_email');
        return;
      }

      try {
        const row = await fetchKeybagForUser(supabase, sess.user.id);
        if (cancelled) return;
        setKeybagRow(row);
        if (!row) {
          setMnemonicDraft(generateRecoveryMnemonic());
          setSavedMnemonicConfirm(false);
          setPhase('create_keybag');
        } else {
          setPhase('unlock_keybag');
        }
      } catch (e) {
        setAuthErr(e instanceof Error ? e.message : String(e));
        setPhase('auth');
      }
    };

    let authCallbackSeen = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled || authCallbackSeen) return;
      recoverFromStuckSupabaseAuth(setSupabaseEpoch);
      if (cancelled) return;
      setAuthErr(
        'Sign-in is taking too long (often when Supabase Auth is slow or down). Your saved session was cleared locally — try signing in again, or check https://status.supabase.com',
      );
      setPhase('auth');
    }, SESSION_INIT_TIMEOUT_MS);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, sess) => {
      if (!authCallbackSeen) {
        authCallbackSeen = true;
        window.clearTimeout(timeoutId);
      }
      void route(sess, event);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [embeddedAdapter, supabase]);

  const onSignUp = useCallback(async () => {
    setAuthErr(null);
    setInfoMsg(null);
    const pwErr = validateNewPassword(password);
    if (pwErr) {
      setAuthErr(pwErr);
      return;
    }
    if (!email.trim()) {
      setAuthErr('Enter your email.');
      return;
    }
    setBusyAction('sign-up');
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: getAuthEmailRedirectUrl() },
      });
      if (error) throw error;
      if (data.user && !data.session) {
        const addr = (data.user.email ?? email.trim()).trim();
        setPendingVerificationEmail(addr || null);
        setInfoMsg('Check your email to confirm your address, then sign in here.');
        setPhase('verify_email');
      } else if (data.user && data.session) {
        setPendingVerificationEmail(null);
        // Email confirmation disabled in Supabase: session exists immediately; onAuthStateChange will route.
        setInfoMsg('Signed in. Continue when the wallet step appears.');
      }
      setPassword('');
    } catch (e) {
      setAuthErr(formatAuthFlowError(e));
    } finally {
      setBusyAction(null);
    }
  }, [email, password, supabase]);

  const onSignIn = useCallback(async () => {
    setAuthErr(null);
    setInfoMsg(null);
    if (!email.trim() || !password) {
      setAuthErr('Enter email and password.');
      return;
    }
    setBusyAction('sign-in');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword('');
    } catch (e) {
      setAuthErr(formatAuthFlowError(e));
    } finally {
      setBusyAction(null);
    }
  }, [email, password, supabase]);

  const onForgotPassword = useCallback(async () => {
    setAuthErr(null);
    setInfoMsg(null);
    if (!email.trim()) {
      setAuthErr('Enter your email, then request a reset link.');
      return;
    }
    setBusyAction('forgot');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getAuthEmailRedirectUrl(),
      });
      if (error) throw error;
      setInfoMsg('If an account exists, you will receive an email with a reset link.');
    } catch (e) {
      setAuthErr(formatAuthFlowError(e));
    } finally {
      setBusyAction(null);
    }
  }, [email, supabase]);

  const onResendVerification = useCallback(async () => {
    const addr = (session?.user?.email ?? pendingVerificationEmail)?.trim();
    if (!addr) return;
    setAuthErr(null);
    setBusyAction('resend-verify');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: addr,
        options: { emailRedirectTo: getAuthEmailRedirectUrl() },
      });
      if (error) throw error;
      setInfoMsg('Another confirmation email was sent. Check spam or promotions; it can take a minute.');
      setResendCooldownSec(60);
    } catch (e) {
      setAuthErr(formatAuthFlowError(e));
    } finally {
      setBusyAction(null);
    }
  }, [pendingVerificationEmail, session?.user?.email, supabase]);

  const onSignOut = useCallback(async () => {
    setAuthErr(null);
    setInfoMsg(null);
    setPendingVerificationEmail(null);
    await supabase.auth.signOut();
    embeddedAdapter.setUnlockedKeypair(null);
  }, [embeddedAdapter, supabase]);

  const onCreateKeybag = useCallback(async () => {
    setAuthErr(null);
    if (!session?.user.id) return;
    const pwErr = validateNewPassword(password);
    if (pwErr) {
      setAuthErr(pwErr);
      return;
    }
    if (!savedMnemonicConfirm) {
      setAuthErr('Confirm that you saved your recovery phrase.');
      return;
    }
    setBusyAction('create-keybag');
    try {
      const existing = await fetchKeybagForUser(supabase, session.user.id);
      if (existing) {
        setKeybagRow(existing);
        setPhase('unlock_keybag');
        setInfoMsg(
          'A wallet is already linked to this account. Unlock with your account password (the one you use to sign in).',
        );
        setPassword('');
        return;
      }

      const kp = Keypair.generate();
      const payload = await buildKeybagPayload(kp, password, mnemonicDraft);
      await insertKeybag(supabase, session.user.id, payload);
      await connectEmbedded(kp);
      setPassword('');
    } catch (e) {
      if (isUniqueViolationError(e)) {
        try {
          const row = await fetchKeybagForUser(supabase, session.user.id);
          if (row) {
            setKeybagRow(row);
            setPhase('unlock_keybag');
            setInfoMsg('Your wallet was already saved. Unlock with your account password.');
            setPassword('');
            return;
          }
        } catch (fetchErr) {
          setAuthErr(fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
          return;
        }
      }
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }, [connectEmbedded, mnemonicDraft, password, savedMnemonicConfirm, session?.user.id, supabase]);

  const onUnlockKeybag = useCallback(async () => {
    setAuthErr(null);
    if (!keybagRow) return;
    setBusyAction('unlock');
    try {
      const kp = await unlockKeypairFromKeybag(keybagRow, password);
      await connectEmbedded(kp);
      setPassword('');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }, [connectEmbedded, keybagRow, password]);

  const onPasswordRecoveryComplete = useCallback(async () => {
    setAuthErr(null);
    if (!session?.user.id) return;
    if (newPassword !== confirmPassword) {
      setAuthErr('New passwords do not match.');
      return;
    }
    const pwErr = validateNewPassword(newPassword);
    if (pwErr) {
      setAuthErr(pwErr);
      return;
    }
    setBusyAction('password-recovery');
    try {
      const { error: uErr } = await supabase.auth.updateUser({ password: newPassword });
      if (uErr) throw uErr;

      const row = await fetchKeybagForUser(supabase, session.user.id);
      if (!row) {
        setMnemonicDraft(generateRecoveryMnemonic());
        setPhase('create_keybag');
        setNewPassword('');
        setConfirmPassword('');
        setRecoveryInput('');
        setInfoMsg('Password updated. Create your Solana wallet for this account.');
        return;
      }

      const patch = await rewrapKeybagPasswordFromRecovery(row, recoveryInput, newPassword);
      await updateKeybagPasswordWrap(supabase, session.user.id, patch);
      const merged = { ...row, ...patch };
      const kp = await unlockKeypairFromKeybag(merged, newPassword);
      await connectEmbedded(kp);
      setNewPassword('');
      setConfirmPassword('');
      setRecoveryInput('');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }, [confirmPassword, connectEmbedded, newPassword, recoveryInput, session?.user.id, supabase]);

  const onRecoveryRewrapOnly = useCallback(async () => {
    setAuthErr(null);
    if (!session?.user.id || !keybagRow) return;
    if (!password) {
      setAuthErr('Enter your current account password (the one you use to sign in).');
      return;
    }
    setBusyAction('recovery-rewrap');
    try {
      const patch = await rewrapKeybagPasswordFromRecovery(keybagRow, recoveryInput, password);
      await updateKeybagPasswordWrap(supabase, session.user.id, patch);
      const merged = { ...keybagRow, ...patch };
      setKeybagRow(merged);
      const kp = await unlockKeypairFromKeybag(merged, password);
      await connectEmbedded(kp);
      setRecoveryInput('');
      setPhase('unlock_keybag');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }, [connectEmbedded, keybagRow, password, recoveryInput, session?.user.id, supabase]);

  if (phase === 'loading') {
    return (
      <AuthAnimatedStep stepKey="loading">
        <div className="auth-loading-block">
          <LoadingSpinner size="lg" label="Loading account" />
          <p className="muted small">Loading account…</p>
        </div>
      </AuthAnimatedStep>
    );
  }

  if (phase === 'verify_email') {
    const verifyEmail = (session?.user?.email ?? pendingVerificationEmail ?? '').trim();
    const resendBlocked = resendCooldownSec > 0 || busy;
    return (
      <AuthAnimatedStep stepKey="verify_email">
        <form
          className="auth-gate-email-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (resendBlocked || !verifyEmail.length) return;
            void onResendVerification();
          }}
        >
          <p className="auth-gate-lead">
            Confirm your email using the link we sent. After that, sign in with the same address and password.
          </p>
          {verifyEmail ? (
            <p className="muted small">
              Sent to <strong>{verifyEmail}</strong>. If nothing arrives, check spam and that Resend/your SMTP sender domain is verified.
            </p>
          ) : null}
          {infoMsg ? <p className="muted small">{infoMsg}</p> : null}
          {authErr ? <p className="auth-gate-err">{authErr}</p> : null}
          <button
            type="submit"
            className={`auth-gate-submit${busyAction === 'resend-verify' ? ' auth-gate-submit--with-spinner' : ''}`}
            disabled={resendBlocked || !verifyEmail.length}
          >
            {busyAction === 'resend-verify' ? (
              <>
                <LoadingSpinner size="sm" label="Sending" />
                <span>Sending…</span>
              </>
            ) : resendCooldownSec > 0 ? (
              `Resend email (${resendCooldownSec}s)`
            ) : (
              'Resend confirmation email'
            )}
          </button>
        </form>
        <button type="button" className="ghost auth-gate-submit" onClick={() => void onSignOut()}>
          Sign out / use a different email
        </button>
      </AuthAnimatedStep>
    );
  }

  if (phase === 'create_keybag') {
    return (
      <AuthAnimatedStep stepKey="create_keybag">
        <form
          className="auth-gate-email-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            void onCreateKeybag();
          }}
        >
          <h3 className="auth-gate-h3">Save your recovery phrase</h3>
          <p className="muted small">
            This phrase is the only way to recover your Solana wallet if you reset your password. {BRAND_NAME} never sees it
            or your private key — only encrypted data is stored in your Supabase project.
          </p>
          <textarea className="auth-field-textarea auth-mnemonic-display" readOnly rows={3} value={mnemonicDraft} />
          <label className="auth-check">
            <input
              type="checkbox"
              checked={savedMnemonicConfirm}
              onChange={(e) => setSavedMnemonicConfirm(e.target.checked)}
            />
            <span>I wrote this phrase down in a safe place.</span>
          </label>
          <label className="auth-field">
            <span>Account password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Encrypts your keybag (min. 8 characters)"
            />
          </label>
          {authErr ? <p className="auth-gate-err">{authErr}</p> : null}
          <button
            type="submit"
            className={`auth-gate-submit${busyAction === 'create-keybag' ? ' auth-gate-submit--with-spinner' : ''}`}
            disabled={busy}
          >
            {busyAction === 'create-keybag' ? (
              <>
                <LoadingSpinner size="sm" label="Creating wallet" />
                <span>Creating wallet…</span>
              </>
            ) : (
              'Create wallet & continue'
            )}
          </button>
        </form>
        <button type="button" className="ghost auth-gate-back" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </AuthAnimatedStep>
    );
  }

  if (phase === 'unlock_keybag') {
    return (
      <AuthAnimatedStep stepKey="unlock_keybag">
        <form
          className="auth-gate-email-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            void onUnlockKeybag();
          }}
        >
          <p className="muted small">Signed in as {session?.user.email}. Enter your password to unlock your email wallet.</p>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {authErr ? <p className="auth-gate-err">{authErr}</p> : null}
          {infoMsg ? <p className="muted small">{infoMsg}</p> : null}
          <button
            type="submit"
            className={`auth-gate-submit${busyAction === 'unlock' ? ' auth-gate-submit--with-spinner' : ''}`}
            disabled={busy}
          >
            {busyAction === 'unlock' ? (
              <>
                <LoadingSpinner size="sm" label="Unlocking wallet" />
                <span>Unlocking…</span>
              </>
            ) : (
              'Unlock email wallet'
            )}
          </button>
        </form>
        <button type="button" className="ghost auth-gate-back" onClick={() => void onForgotPassword()}>
          Forgot password (email link)
        </button>
        <button
          type="button"
          className="ghost auth-gate-back"
          onClick={() => {
            setAuthErr(null);
            setRecoveryInput('');
            setPhase('recovery_rewrap');
          }}
        >
          Use recovery phrase instead
        </button>
        <button type="button" className="ghost auth-gate-back" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </AuthAnimatedStep>
    );
  }

  if (phase === 'password_recovery') {
    return (
      <AuthAnimatedStep stepKey="password_recovery">
        <form
          className="auth-gate-email-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            void onPasswordRecoveryComplete();
          }}
        >
          <h3 className="auth-gate-h3">Finish password reset</h3>
          <p className="muted small">
            Set a new account password and enter your recovery phrase so your Solana key can be re-encrypted. If you have
            not created a wallet yet, you will be asked to do that next.
          </p>
          <label className="auth-field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          <label className="auth-field">
            <span>Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Recovery phrase</span>
            <textarea
              className="auth-field-textarea"
              rows={3}
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              placeholder="12 words, in order"
            />
          </label>
          {authErr ? <p className="auth-gate-err">{authErr}</p> : null}
          <button
            type="submit"
            className={`auth-gate-submit${busyAction === 'password-recovery' ? ' auth-gate-submit--with-spinner' : ''}`}
            disabled={busy}
          >
            {busyAction === 'password-recovery' ? (
              <>
                <LoadingSpinner size="sm" label="Saving" />
                <span>Saving…</span>
              </>
            ) : (
              'Update password & restore wallet'
            )}
          </button>
        </form>
      </AuthAnimatedStep>
    );
  }

  if (phase === 'recovery_rewrap') {
    return (
      <AuthAnimatedStep stepKey="recovery_rewrap">
        <form
          className="auth-gate-email-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            void onRecoveryRewrapOnly();
          }}
        >
          <h3 className="auth-gate-h3">Restore with recovery phrase</h3>
          <p className="muted small">
            Use this if your password unlock fails but you still know your account password. Your phrase re-wraps the same
            Solana key with your current password.
          </p>
          <label className="auth-field">
            <span>Recovery phrase</span>
            <textarea
              className="auth-field-textarea"
              rows={3}
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
            />
          </label>
          <label className="auth-field">
            <span>Current account password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {authErr ? <p className="auth-gate-err">{authErr}</p> : null}
          <button
            type="submit"
            className={`auth-gate-submit${busyAction === 'recovery-rewrap' ? ' auth-gate-submit--with-spinner' : ''}`}
            disabled={busy}
          >
            {busyAction === 'recovery-rewrap' ? (
              <>
                <LoadingSpinner size="sm" label="Restoring wallet" />
                <span>Restoring…</span>
              </>
            ) : (
              'Restore wallet'
            )}
          </button>
        </form>
        <button type="button" className="ghost auth-gate-back" onClick={() => setPhase('unlock_keybag')}>
          Back
        </button>
      </AuthAnimatedStep>
    );
  }

  /* phase === 'auth' */
  return (
    <AuthAnimatedStep stepKey={`auth-${emailTab}`}>
      <form
        className="auth-gate-email-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (emailTab === 'sign-in') void onSignIn();
          else void onSignUp();
        }}
      >
        <p className="muted small">
          Email accounts use Supabase Auth (verification + password reset). Your Solana key is encrypted in the browser and
          only ciphertext is stored in your database.
        </p>

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
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@team.xyz" />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={emailTab === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={emailTab === 'register' ? 'At least 8 characters' : ''}
          />
        </label>

        {authErr ? <p className="auth-gate-err">{authErr}</p> : null}
        {infoMsg ? <p className="muted small">{infoMsg}</p> : null}

        {emailTab === 'sign-in' ? (
          <button
            type="submit"
            className={`auth-gate-submit${busyAction === 'sign-in' ? ' auth-gate-submit--with-spinner' : ''}`}
            disabled={busy}
          >
            {busyAction === 'sign-in' ? (
              <>
                <LoadingSpinner size="sm" label="Signing in" />
                <span>Signing in…</span>
              </>
            ) : (
              'Sign in'
            )}
          </button>
        ) : (
          <button
            type="submit"
            className={`auth-gate-submit${busyAction === 'sign-up' ? ' auth-gate-submit--with-spinner' : ''}`}
            disabled={busy}
          >
            {busyAction === 'sign-up' ? (
              <>
                <LoadingSpinner size="sm" label="Creating account" />
                <span>Creating account…</span>
              </>
            ) : (
              'Register & verify email'
            )}
          </button>
        )}
      </form>
      {emailTab === 'sign-in' ? (
        <button
          type="button"
          className={`ghost auth-gate-back${busyAction === 'forgot' ? ' auth-gate-submit--with-spinner' : ''}`}
          disabled={busy}
          onClick={() => void onForgotPassword()}
        >
          {busyAction === 'forgot' ? (
            <>
              <LoadingSpinner size="sm" label="Sending reset email" />
              <span>Sending…</span>
            </>
          ) : (
            'Email me a reset link'
          )}
        </button>
      ) : null}
    </AuthAnimatedStep>
  );
}
