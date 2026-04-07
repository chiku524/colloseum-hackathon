import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PolicySimulatorShare } from './PolicySimulatorShare';
import { PublicStatus } from './PublicStatus';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';

const network = WalletAdapterNetwork.Devnet;
const endpoint = import.meta.env.VITE_RPC_URL ?? clusterApiUrl(network);

function Root() {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function entryView(): 'main' | 'status' | 'simulate' {
  if (typeof window === 'undefined') return 'main';
  const v = new URLSearchParams(window.location.search).get('view');
  if (v === 'status') return 'status';
  if (v === 'simulate') return 'simulate';
  return 'main';
}

const view = entryView();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view === 'status' ? <PublicStatus /> : view === 'simulate' ? <PolicySimulatorShare /> : <Root />}
  </StrictMode>,
);
