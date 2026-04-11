import { BRAND_NAME, GITHUB_REPO_URL, SITE_CANONICAL_ORIGIN } from './brand';

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer" role="contentinfo">
      <nav className="site-footer__nav" aria-label="Site footer">
        <a className="site-footer__link" href="/">
          Home
        </a>
        <span className="site-footer__sep" aria-hidden>
          ·
        </span>
        <a className="site-footer__link" href="/docs">
          Documentation
        </a>
        <span className="site-footer__sep" aria-hidden>
          ·
        </span>
        <a className="site-footer__link" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">
          GitHub
        </a>
        <span className="site-footer__sep" aria-hidden>
          ·
        </span>
        <a className="site-footer__link" href={SITE_CANONICAL_ORIGIN} target="_blank" rel="noreferrer noopener">
          {SITE_CANONICAL_ORIGIN.replace(/^https:\/\//, '')}
        </a>
      </nav>
      <p className="site-footer__meta muted">
        © {year} {BRAND_NAME}
      </p>
    </footer>
  );
}
