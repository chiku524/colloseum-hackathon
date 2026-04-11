import type { SolanaClusterId } from './solanaCluster';
import { explorerTxUrl } from './solanaExplorer';
import type { ToastVariant } from './ToastStack';

type Props = {
  signature: string;
  cluster: SolanaClusterId;
  notify: (message: string, variant?: ToastVariant) => void;
};

export function TxSignatureBlock({ signature, cluster, notify }: Props) {
  const href = explorerTxUrl(signature, cluster);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(signature);
      notify('Transaction signature copied.');
    } catch {
      notify('Could not copy signature to the clipboard.', 'error');
    }
  };

  return (
    <div className="tx-sig-block" role="region" aria-label="Latest transaction signature">
      <div className="tx-sig-block__label">Transaction signature</div>
      <code className="tx-sig-block__hash" title={signature}>
        {signature}
      </code>
      <div className="tx-sig-block__actions">
        <button type="button" className="ghost" onClick={() => void onCopy()}>
          Copy
        </button>
        <a className="ghost tx-sig-block__explorer" href={href} target="_blank" rel="noopener noreferrer">
          Open in explorer
        </a>
      </div>
    </div>
  );
}
