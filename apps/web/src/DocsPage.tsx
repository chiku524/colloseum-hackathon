import { useCallback, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BRAND_NAME, DOCUMENT_TITLES, GITHUB_REPO_URL } from './brand';
import { BrandMark } from './BrandMark';
import { SiteFooter } from './SiteFooter';

const GITHUB_TREE_MAIN = `${GITHUB_REPO_URL}/tree/main`;

const rawDocModules = import.meta.glob('../../docs/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function docIdFromModulePath(modulePath: string): string {
  const base = modulePath.replace(/^.*[/\\]/, '');
  return base.replace(/\.md$/i, '');
}

function resolveMarkdownHrefFromDocs(href: string): string {
  const base: string[] = ['docs'];
  const parts = href.trim().split('/').filter((p) => p !== '' && p !== '.');
  for (const part of parts) {
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

type DocEntry = { id: string; title: string; content: string };

function titleFromMarkdown(content: string, fallbackId: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  if (m?.[1]) return m[1].trim();
  return fallbackId.replace(/-/g, ' ');
}

function readDocQuery(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('doc');
  const t = raw?.trim();
  return t || null;
}

type MarkdownLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  validDocIds: ReadonlySet<string>;
  onSelectDoc: (id: string) => void;
};

function MarkdownLink({ href, children, validDocIds, onSelectDoc, ...rest }: MarkdownLinkProps) {
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

  const hashIdx = href.indexOf('#');
  const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const hash = hashIdx >= 0 ? href.slice(hashIdx) : '';

  const sameDir = pathPart.match(/^\.\/([^/]+\.md)$/i);
  if (sameDir) {
    const stem = sameDir[1].replace(/\.md$/i, '');
    if (validDocIds.has(stem)) {
      const next = `/docs?doc=${encodeURIComponent(stem)}${hash}`;
      return (
        <a
          {...rest}
          href={next}
          onClick={(e) => {
            e.preventDefault();
            onSelectDoc(stem);
          }}
        >
          {children}
        </a>
      );
    }
  }

  if (pathPart.toLowerCase().endsWith('.md')) {
    const repoPath = resolveMarkdownHrefFromDocs(pathPart);
    const url = `${GITHUB_TREE_MAIN}/${repoPath}`;
    return (
      <a {...rest} href={url} target="_blank" rel="noreferrer noopener">
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

export function DocsPage() {
  const catalog = useMemo(() => {
    const list: DocEntry[] = Object.entries(rawDocModules).map(([path, content]) => {
      const id = docIdFromModulePath(path);
      return { id, title: titleFromMarkdown(content, id), content };
    });
    list.sort((a, b) => a.title.localeCompare(b.title));
    const byId = new Map(list.map((e) => [e.id, e]));
    return { list, byId, ids: new Set(list.map((e) => e.id)) };
  }, []);

  const [activeId, setActiveId] = useState<string | null>(() => {
    const q = readDocQuery();
    if (!q) return null;
    const exact = catalog.byId.get(q);
    if (exact) return exact.id;
    const ci = catalog.list.find((e) => e.id.toLowerCase() === q.toLowerCase());
    return ci?.id ?? null;
  });

  useEffect(() => {
    const onPop = () => {
      const q = readDocQuery();
      if (!q) {
        setActiveId(null);
        return;
      }
      const exact = catalog.byId.get(q);
      if (exact) {
        setActiveId(exact.id);
        return;
      }
      const ci = catalog.list.find((e) => e.id.toLowerCase() === q.toLowerCase());
      setActiveId(ci?.id ?? null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [catalog.byId, catalog.list]);

  useEffect(() => {
    if (!activeId) {
      document.title = DOCUMENT_TITLES.docs;
      return;
    }
    const entry = catalog.byId.get(activeId);
    document.title = entry ? `${entry.title} — Docs — ${BRAND_NAME}` : DOCUMENT_TITLES.docs;
  }, [activeId, catalog.byId]);

  const onSelectDoc = useCallback(
    (id: string) => {
      setActiveId(id);
      const url = new URL(window.location.href);
      url.pathname = '/docs';
      url.searchParams.set('doc', id);
      window.history.pushState({}, '', url);
    },
    [],
  );

  const onClearDoc = useCallback(() => {
    setActiveId(null);
    const url = new URL(window.location.href);
    url.pathname = '/docs';
    url.searchParams.delete('doc');
    window.history.pushState({}, '', url.pathname + (url.search ? url.search : ''));
  }, []);

  const active = activeId ? catalog.byId.get(activeId) : null;

  const mdComponents = useMemo(
    () => ({
      a: (props: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode; node?: unknown }) => {
        const { node: _node, children, ...anchor } = props;
        return (
          <MarkdownLink {...anchor} validDocIds={catalog.ids} onSelectDoc={onSelectDoc}>
            {children}
          </MarkdownLink>
        );
      },
    }),
    [catalog.ids, onSelectDoc],
  );

  return (
    <div className="app-shell docs-shell">
      <header className="app-header docs-shell__header">
        <div className="brand">
          <BrandMark className="brand-mark" />
          <div>
            <h1>Documentation</h1>
            <p className="tagline muted">Operator guides and technical notes for {BRAND_NAME} (bundled from the repo docs folder).</p>
          </div>
        </div>
        <div className="docs-shell__actions">
          <a className="ghost docs-shell__home" href="/">
            Open app
          </a>
        </div>
      </header>

      <div className="docs-layout">
        <aside className="docs-layout__nav panel" aria-label="Documentation topics">
          <p className="docs-layout__nav-title">Topics</p>
          <ul className="docs-nav-list">
            <li>
              <button type="button" className={`docs-nav-item${activeId === null ? ' docs-nav-item--active' : ''}`} onClick={onClearDoc}>
                Overview
              </button>
            </li>
            {catalog.list.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={`docs-nav-item${e.id === activeId ? ' docs-nav-item--active' : ''}`}
                  onClick={() => onSelectDoc(e.id)}
                >
                  {e.title}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="docs-layout__main">
          {active ? (
            <article className="panel docs-article">
              <div className="docs-article__toolbar">
                <a className="ghost" href={`${GITHUB_TREE_MAIN}/docs/${active.id}.md`} target="_blank" rel="noreferrer noopener">
                  View on GitHub
                </a>
              </div>
              <div className="docs-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {active.content}
                </ReactMarkdown>
              </div>
            </article>
          ) : (
            <div className="panel docs-index">
              <h2 className="docs-index__title">Docs overview</h2>
              <p className="muted">
                These pages mirror the Markdown in <code>docs/</code> at build time. Use the sidebar to open a guide, or jump in below.
              </p>
              <ul className="docs-index__cards">
                {catalog.list.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="docs-index__card" onClick={() => onSelectDoc(e.id)}>
                      <span className="docs-index__card-title">{e.title}</span>
                      <span className="docs-index__card-id muted">{e.id}.md</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}
