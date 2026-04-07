type Props = {
  className?: string;
  /** Larger mark in header (default) vs compact embed */
  variant?: 'header' | 'compact';
};

export function BrandMark({ className, variant = 'header' }: Props) {
  const s = variant === 'compact' ? 28 : 40;
  const id = variant === 'compact' ? 'lithos-brand-fg-compact' : 'lithos-brand-fg';
  return (
    <span className={className} aria-hidden>
      <svg
        width={s}
        height={s}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={`${id}-grad`} x1="6" y1="4" x2="36" y2="38" gradientUnits="userSpaceOnUse">
            <stop stopColor="#4a9fe8" />
            <stop offset="0.55" stopColor="#3d8bd4" />
            <stop offset="1" stopColor="#1e4a6e" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="2" y="2" width="36" height="36" rx="9" fill={`url(#${id}-grad)`} />
        <path
          d="M10 14h20M10 20h20M10 26h13"
          stroke="rgba(0,0,0,0.38)"
          strokeWidth="1.15"
          strokeLinecap="round"
        />
        <path
          d="M10 14h20M10 20h20M10 26h13"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="0.55"
          strokeLinecap="round"
          transform="translate(-0.35 -0.35)"
        />
        <circle
          cx="29"
          cy="27"
          r="3.2"
          fill="#5ee0c8"
          fillOpacity="0.95"
          filter={`url(#${id}-glow)`}
        />
        <circle cx="29" cy="27" r="1.35" fill="#e8fffa" fillOpacity="0.55" />
      </svg>
    </span>
  );
}
