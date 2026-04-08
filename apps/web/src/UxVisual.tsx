import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.65,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function UxIconOverview(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function UxIconTreasury(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M4 18V6h16v12H4z" />
      <path d="M8 14v-4M12 16V8M16 13v-2" />
    </svg>
  );
}

export function UxIconSetup(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.5 4.5l1.8 1.8M17.7 17.7l1.8 1.8M19.5 4.5l-1.8 1.8M6.3 17.7l-1.8 1.8" />
    </svg>
  );
}

export function UxIconVault(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M6 10V8a6 6 0 0 1 12 0v2" />
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <circle cx="12" cy="15.5" r="1.8" />
      <path d="M12 17.3V18" />
    </svg>
  );
}

export function UxIconPause(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </svg>
  );
}

export function UxIconProof(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M8 4h11v16H5V8l3-4z" />
      <path d="M9 11l2.2 2.2L16 8.5" />
    </svg>
  );
}

export function UxIconAutomation(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M4 14h4v4H4zM10 6h4v4h-4zM16 14h4v4h-4z" />
      <path d="M12 10v3M8 14h12" />
    </svg>
  );
}

export function UxIconPolicy(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M15 4v3h3M8 12h8M8 16h6" />
    </svg>
  );
}

export function UxIconProposals(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function UxIconShare(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M15.5 6.5l-7 3M8.5 13.5l7 3" />
    </svg>
  );
}

export function UxIconLink(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M10 13a4 4 0 0 1 0-5.5l1-1a4 4 0 0 1 5.66 5.66l-1 1M14 11a4 4 0 0 1 0 5.5l-1 1a4 4 0 0 1-5.66-5.66l1-1" />
    </svg>
  );
}

export function UxIconCode(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 6l-4 12" />
    </svg>
  );
}

export function UxIconToolbox(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M12 8v3" />
    </svg>
  );
}

export function UxIconDownload(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M12 4v10M8 11l4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function UxIconAlert(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

export function UxIconPath(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <circle cx="5" cy="18" r="2.5" />
      <circle cx="12" cy="6" r="2.5" />
      <circle cx="19" cy="14" r="2.5" />
      <path d="M7 16.5l4-8.5M14.5 8.5L17 12" />
    </svg>
  );
}

export function UxIconClock(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function UxIconMonitor(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function UxIconSliders(props: IconProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden {...stroke} {...props}>
      <path d="M4 7h4M15 7h6M4 12h10M18 12h2M4 17h7M14 17h6" />
      <circle cx="10" cy="7" r="2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

type SectionHeaderProps = {
  icon?: ReactNode;
  title: string;
  className?: string;
  /** `sub` renders an h3 with a smaller glyph (subsections inside a panel). */
  level?: 'panel' | 'sub';
};

/** Icon + title row for panel headings (h2) or subsections (h3). */
export function SectionHeader({ icon, title, className, level = 'panel' }: SectionHeaderProps) {
  if (level === 'sub') {
    return (
      <div className={['subsection-header', className].filter(Boolean).join(' ')}>
        {icon ? (
          <div className="subsection-header__glyph" aria-hidden>
            {icon}
          </div>
        ) : null}
        <h3 className="subsection-header__title">{title}</h3>
      </div>
    );
  }

  return (
    <div className={['section-header', className].filter(Boolean).join(' ')}>
      {icon ? (
        <div className="section-header__glyph" aria-hidden>
          {icon}
        </div>
      ) : null}
      <h2 className="section-header__title">{title}</h2>
    </div>
  );
}
