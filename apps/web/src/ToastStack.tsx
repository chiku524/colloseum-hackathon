import { useCallback, useRef, useState } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export type ToastItem = { id: number; message: string; variant: ToastVariant };

const DEFAULT_MS = 5200;

export function useToast(autoDismissMs = DEFAULT_MS) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = ++seq.current;
      setItems((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => {
        dismiss(id);
      }, autoDismissMs);
    },
    [autoDismissMs, dismiss],
  );

  return { items, push, dismiss };
}

export function ToastStack({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions text">
      {items.map((t) => (
        <div key={t.id} className={`toast toast--${t.variant}`} role="status">
          <span className="toast__msg">{t.message}</span>
          <button type="button" className="toast__dismiss ghost" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
