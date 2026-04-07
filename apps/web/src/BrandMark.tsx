type Props = {
  className?: string;
  /** Larger mark in header (default) vs compact embed */
  variant?: 'header' | 'compact';
};

/** Vault-door mark: reinforced panel, locking bars, combination wheel, secure indicator. */
export function BrandMark({ className, variant = 'header' }: Props) {
  const s = variant === 'compact' ? 28 : 40;
  const id = variant === 'compact' ? 'vault-brand-fg-compact' : 'vault-brand-fg';
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
            <stop stopColor="#3d7fd4" />
            <stop offset="0.5" stopColor="#2d6bb8" />
            <stop offset="1" stopColor="#15365c" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-45%" y="-45%" width="190%" height="190%">
            <feGaussianBlur stdDeviation="1.1" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="2" y="2" width="36" height="36" rx="9" fill={`url(#${id}-grad)`} />
        {/* Door frame */}
        <rect
          x="8"
          y="6.5"
          width="24"
          height="27"
          rx="4.5"
          fill="rgba(4, 12, 24, 0.55)"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="0.85"
        />
        {/* Rivets */}
        <circle cx="11" cy="10.5" r="0.9" fill="rgba(255,255,255,0.22)" />
        <circle cx="11" cy="20" r="0.9" fill="rgba(255,255,255,0.22)" />
        <circle cx="11" cy="29.5" r="0.9" fill="rgba(255,255,255,0.22)" />
        <circle cx="29" cy="10.5" r="0.9" fill="rgba(255,255,255,0.22)" />
        <circle cx="29" cy="20" r="0.9" fill="rgba(255,255,255,0.22)" />
        <circle cx="29" cy="29.5" r="0.9" fill="rgba(255,255,255,0.22)" />
        {/* Locking bars */}
        <path
          d="M12.5 16.5h15M12.5 20h15M12.5 23.5h15"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        <path
          d="M12.5 16.5h15M12.5 20h15M12.5 23.5h15"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="0.5"
          strokeLinecap="round"
          transform="translate(-0.25 -0.2)"
        />
        {/* Combination wheel */}
        <circle
          cx="20"
          cy="20"
          r="4.8"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="1.05"
          fill="rgba(0,0,0,0.2)"
        />
        <circle cx="20" cy="20" r="2.1" stroke="rgba(255,255,255,0.14)" strokeWidth="0.55" fill="none" />
        <path
          d="M23.2 20h2.6"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        {/* Secure seal */}
        <circle
          cx="30.5"
          cy="29.5"
          r="3"
          fill="#5ee0c8"
          fillOpacity="0.95"
          filter={`url(#${id}-glow)`}
        />
        <circle cx="30.5" cy="29.5" r="1.2" fill="#e8fffa" fillOpacity="0.55" />
      </svg>
    </span>
  );
}
