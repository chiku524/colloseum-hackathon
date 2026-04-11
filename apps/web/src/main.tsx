import './polyfills';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { lazy, StrictMode, Suspense, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthOnboardingGate } from './AuthOnboardingGate';
import App from './App';
import { DOCUMENT_TITLES } from './brand';
import { PolicySimulatorShare } from './PolicySimulatorShare';
import { PublicStatus } from './PublicStatus';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { StrongholdEmbeddedWalletAdapter } from './StrongholdEmbeddedWalletAdapter';

const DocsPage = lazy(() => import('./DocsPage').then((m) => ({ default: m.DocsPage })));
const ExecutiveSummaryPage = lazy(() =>
  import('./ExecutiveSummaryPage').then((m) => ({ default: m.ExecutiveSummaryPage })),
);

const network = WalletAdapterNetwork.Devnet;
const endpoint = import.meta.env.VITE_RPC_URL ?? clusterApiUrl(network);

function Root() {
  const embeddedAdapterRef = useRef<StrongholdEmbeddedWalletAdapter | null>(null);
  if (embeddedAdapterRef.current === null) {
    embeddedAdapterRef.current = new StrongholdEmbeddedWalletAdapter();
  }
  const embeddedAdapter = embeddedAdapterRef.current;

  // Phantom registers via the Wallet Standard; omit PhantomWalletAdapter to avoid duplicate registration warnings.
  const wallets = useMemo(
    () => [embeddedAdapter, new SolflareWalletAdapter()],
    [embeddedAdapter],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false} localStorageKey="web3stronghold-wallet-name">
        <WalletModalProvider>
          <AuthOnboardingGate embeddedAdapter={embeddedAdapter}>
            <App />
          </AuthOnboardingGate>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function entryView(): 'main' | 'status' | 'simulate' | 'docs' | 'executive-summary' {
  if (typeof window === 'undefined') return 'main';
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/docs') return 'docs';
  if (path === '/executive-summary') return 'executive-summary';
  const v = new URLSearchParams(window.location.search).get('view');
  if (v === 'status') return 'status';
  if (v === 'simulate') return 'simulate';
  return 'main';
}

const view = entryView();

if (typeof document !== 'undefined') {
  document.title =
    view === 'status'
      ? DOCUMENT_TITLES.status
      : view === 'simulate'
        ? DOCUMENT_TITLES.simulate
        : view === 'docs'
          ? DOCUMENT_TITLES.docs
          : view === 'executive-summary'
            ? DOCUMENT_TITLES.executiveSummary
            : DOCUMENT_TITLES.main;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view === 'status' ? (
      <PublicStatus />
    ) : view === 'simulate' ? (
      <PolicySimulatorShare />
    ) : view === 'docs' ? (
      <Suspense
        fallback={
          <div className="app-shell" style={{ padding: '2rem' }}>
            <p className="muted">Loading documentation…</p>
          </div>
        }
      >
        <DocsPage />
      </Suspense>
    ) : view === 'executive-summary' ? (
      <Suspense
        fallback={
          <div className="app-shell" style={{ padding: '2rem' }}>
            <p className="muted">Loading…</p>
          </div>
        }
      >
        <ExecutiveSummaryPage />
      </Suspense>
    ) : (
      <Root />
    )}
  </StrictMode>,
);
