type LoadingSpinnerProps = {
  /** Visual size */
  size?: 'sm' | 'md' | 'lg';
  /** Announced to screen readers */
  label?: string;
  className?: string;
};

/**
 * Accessible loading indicator — use during async auth, registration, and unlock steps.
 */
export function LoadingSpinner({ size = 'md', label = 'Loading', className }: LoadingSpinnerProps) {
  return (
    <span
      className={['sh-spinner', `sh-spinner--${size}`, className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sh-spinner-ring" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
