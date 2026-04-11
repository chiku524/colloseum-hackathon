import { useEffect, useMemo, type AnchorHTMLAttributes, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BRAND_NAME, DOCUMENT_TITLES } from './brand';
import { BrandMark } from './BrandMark';
import executiveSummaryMd from './executiveSummaryContent.md?raw';
import { SiteFooter } from './SiteFooter';

function MarkdownAnchor(props: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const { node: _node, href, children, ...rest } = props;
  if (!href) {
    return <a {...rest}>{children}</a>;
  }
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
    return (
      <a {...rest} href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }
  if (href.startsWith('/')) {
    return (
      <a {...rest} href={href}>
        {children}
      </a>
    );
  }
  return (
    <a {...rest} href={href}>
      {children}
    </a>
  );
}

export function ExecutiveSummaryPage() {
  useEffect(() => {
    document.title = DOCUMENT_TITLES.executiveSummary;
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', 'noindex, nofollow');
    meta.setAttribute('data-web3stronghold-route', 'executive-summary');
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  const mdComponents = useMemo(
    () => ({
      a: (p: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown; children?: ReactNode }) => (
        <MarkdownAnchor {...p} />
      ),
    }),
    [],
  );

  return (
    <div className="app-shell docs-shell">
      <header className="app-header docs-shell__header">
        <div className="brand">
          <BrandMark className="brand-mark" />
          <div>
            <h1>Executive summary</h1>
            <p className="tagline muted">
              {BRAND_NAME} — high-level overview for stakeholders. This URL is intentionally not linked elsewhere in the app.
            </p>
          </div>
        </div>
        <div className="docs-shell__actions">
          <a className="ghost docs-shell__home" href="/">
            Open app
          </a>
        </div>
      </header>

      <article className="panel docs-article">
        <div className="docs-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {executiveSummaryMd}
          </ReactMarkdown>
        </div>
      </article>

      <SiteFooter />
    </div>
  );
}
