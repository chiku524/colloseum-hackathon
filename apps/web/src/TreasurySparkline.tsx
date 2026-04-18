/** Decorative trend line; stable shape from `seed` string. */
export function TreasurySparkline({ seed }: { seed: string }) {
  const pts: [number, number][] = [];
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const n = 18;
  for (let i = 0; i < n; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const y = 8 + (h % 1000) / 1000;
    pts.push([(i / (n - 1)) * 100, y]);
  }
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(2)} ${(14 - p[1]).toFixed(2)}`).join(' ');

  return (
    <div className="treasury-sparkline" aria-hidden>
      <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="treasury-sparkline__svg">
        <defs>
          <linearGradient id="treasury-sparkline-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dash-mint, #5ecf9a)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--dash-mint, #5ecf9a)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L 100 16 L 0 16 Z`} fill="url(#treasury-sparkline-grad)" />
        <path d={d} fill="none" stroke="var(--dash-mint, #5ecf9a)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
