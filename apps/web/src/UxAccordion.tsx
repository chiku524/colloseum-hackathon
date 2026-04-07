import { useCallback, useId, useState } from 'react';

type UxAccordionProps = {
  storageKey: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

/** Collapsible section with open state persisted in sessionStorage. */
export function UxAccordion({ storageKey, title, defaultOpen = false, children }: UxAccordionProps) {
  const baseId = useId();
  const panelId = `${baseId}-panel`;

  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return defaultOpen;
    try {
      const v = sessionStorage.getItem(storageKey);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch {
      /* ignore */
    }
    return defaultOpen;
  });

  const toggle = useCallback(() => {
    setOpen((o) => {
      const n = !o;
      try {
        sessionStorage.setItem(storageKey, n ? '1' : '0');
      } catch {
        /* ignore */
      }
      return n;
    });
  }, [storageKey]);

  return (
    <div className="ux-accordion">
      <button
        type="button"
        className="ux-accordion__trigger"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="ux-accordion__title">{title}</span>
        <span className="ux-accordion__chevron" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div className="ux-accordion__panel" id={panelId} role="region">
          {children}
        </div>
      ) : null}
    </div>
  );
}
