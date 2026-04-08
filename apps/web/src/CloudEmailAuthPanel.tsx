import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { WalletName } from '@solana/wallet-adapter-base';
import { Keypair } from '@solana/web3.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { validateNewPassword } from './embeddedWalletVault';
import {
  buildKeybagPayload,
  generateRecoveryMnemonic,
  rewrapKeybagPasswordFromRecovery,
  type SolanaKeybagRow,
  unlockKeypairFromKeybag,
} from './keybag/cloudKeybagCrypto';
import { fetchKeybagForUser, insertKeybag, updateKeybagPasswordWrap } from './keybag/cloudKeybagRepository';
import { getSupabaseBrowserClient } from './supabase/client';
import { STRONGHOLD_EMBEDDED_WALLET_NAME, type StrongholdEmbeddedWalletAdapter } from './StrongholdEmbeddedWalletAdapter';

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

export function CloudEmailAuthPanel({ embeddedAdapter, select, connect, disconnect }: CloudEmailAuthPanelProps) {
  const supabase = getSupabaseBrowserClient()!;

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
  const [busy, setBusy] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const connectEmbedded = useCallback(
    async (kp: Keypair) => {
      embeddedAdapter.setUnlockedKeypair(kp);
      try {
        await disconnect();
      } catch {
        /* noop */
      }
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
        setPhase('auth');
        setKeybagRow(null);
        setMnemonicDraft('');
        setSavedMnemonicConfirm(false);
        embeddedAdapter.setUnlockedKeypair(null);
        return;
      }

      if (!sess.user.email_confirmed_at) {
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

    void (async () => {
      const {
        data: { session: initial },
      } = await supabase.auth.getSession();
      await route(initial ?? null);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, sess) => {
      void route(sess, event);
    });

    return () => {
      cancelled = true;
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
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      if (data.user && !data.session) {
        setInfoMsg('Check your email to confirm your address, then sign in here.');
        setPhase('verify_email');
      } else if (data.user && data.session) {
        // Email confirmation disabled in Supabase: session exists immediately; onAuthStateChange will route.
        setInfoMsg('Signed in. Continue when the wallet step appears.');
      }
      setPassword('');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [email, password, supabase]);

  const onSignIn = useCallback(async () => {
    setAuthErr(null);
    setInfoMsg(null);
    if (!email.trim() || !password) {
      setAuthErr('Enter email and password.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword('');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [email, password, supabase]);

  const onForgotPassword = useCallback(async () => {
    setAuthErr(null);
    setInfoMsg(null);
    if (!email.trim()) {
      setAuthErr('Enter your email, then request a reset link.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/`,
      });
      if (error) throw error;
      setInfoMsg('If an account exists, you will receive an email with a reset link.');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [email, supabase]);

  const onSignOut = useCallback(async () => {
    setAuthErr(null);
    setInfoMsg(null);
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
    setBusy(true);
    try {
      const kp = Keypair.generate();
      const payload = await buildKeybagPayload(kp, password, mnemonicDraft);
      await insertKeybag(supabase, session.user.id, payload);
      await connectEmbedded(kp);
      setPassword('');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [connectEmbedded, mnemonicDraft, password, savedMnemonicConfirm, session?.user.id, supabase]);

  const onUnlockKeybag = useCallback(async () => {
    setAuthErr(null);
    if (!keybagRow) return;
    setBusy(true);
    try {
      const kp = await unlockKeypairFromKeybag(keybagRow, password);
      await connectEmbedded(kp);
      setPassword('');
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
    setBusy(true);
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
      setBusy(false);
    }
  }, [confirmPassword, connectEmbedded, newPassword, recoveryInput, session?.user.id, supabase]);

  const onRecoveryRewrapOnly = useCallback(async () => {
    setAuthErr(null);
    if (!session?.user.id || !keybagRow) return;
    if (!password) {
      setAuthErr('Enter your current account password (the one you use to sign in).');
      return;
    }
    setBusy(true);
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
      setBusy(false);
    }
  }, [connectEmbedded, keybagRow, password, recoveryInput, session?.user.id, supabase]);

  if (phase === 'loading') {
    return (
      <div className="auth-gate-email">
        <p className="muted small">Loading account…</p>
      </div>
    );
  }

  if (phase === 'verify_email') {
    return (
      <div className="auth-gate-email">
        <p className="auth-gate-lead">
          Confirm your email using the link we sent. After that, sign in with the same address and password.
        </p>
        {infoMsg ? <p className="muted small">{infoMsg}</p> : null}
        <button type="button" className="ghost auth-gate-submit" onClick={() => void onSignOut()}>
          Sign out / use a different email
        </button>
      </div>
    );
  }

  if (phase === 'create_keybag') {
    return (
      <div className="auth-gate-email">
        <h3 className="auth-gate-h3">Save your recovery phrase</h3>
        <p className="muted small">
          This phrase is the only way to recover your Solana wallet if you reset your password. Stronghold never sees it
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
            placeholder="Encrypts your keybag (min. 10 characters)"
          />
        </label>
        {authErr ? <p className="auth-gate-err">{authErr}</p> : null}
        <button type="button" className="auth-gate-submit" disabled={busy} onClick={() => void onCreateKeybag()}>
          {busy ? 'Creating wallet…' : 'Create wallet & continue'}
        </button>
        <button type="button" className="ghost auth-gate-back" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </div>
    );
  }

  if (phase === 'unlock_keybag') {
    return (
      <div className="auth-gate-email">
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
        <button type="button" className="auth-gate-submit" disabled={busy} onClick={() => void onUnlockKeybag()}>
          {busy ? 'Unlocking…' : 'Unlock email wallet'}
        </button>
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
      </div>
    );
  }

  if (phase === 'password_recovery') {
    return (
      <div className="auth-gate-email">
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
          type="button"
          className="auth-gate-submit"
          disabled={busy}
          onClick={() => void onPasswordRecoveryComplete()}
        >
          {busy ? 'Saving…' : 'Update password & restore wallet'}
        </button>
      </div>
    );
  }

  if (phase === 'recovery_rewrap') {
    return (
      <div className="auth-gate-email">
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
        <button type="button" className="auth-gate-submit" disabled={busy} onClick={() => void onRecoveryRewrapOnly()}>
          {busy ? 'Restoring…' : 'Restore wallet'}
        </button>
        <button type="button" className="ghost auth-gate-back" onClick={() => setPhase('unlock_keybag')}>
          Back
        </button>
      </div>
    );
  }

  /* phase === 'auth' */
  return (
    <div className="auth-gate-email">
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
          placeholder={emailTab === 'register' ? 'At least 10 characters' : ''}
        />
      </label>

      {authErr ? <p className="auth-gate-err">{authErr}</p> : null}
      {infoMsg ? <p className="muted small">{infoMsg}</p> : null}

      {emailTab === 'sign-in' ? (
        <>
          <button type="button" className="auth-gate-submit" disabled={busy} onClick={() => void onSignIn()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button type="button" className="ghost auth-gate-back" disabled={busy} onClick={() => void onForgotPassword()}>
            Email me a reset link
          </button>
        </>
      ) : (
        <button type="button" className="auth-gate-submit" disabled={busy} onClick={() => void onSignUp()}>
          {busy ? 'Creating account…' : 'Register & verify email'}
        </button>
      )}
    </div>
  );
}
