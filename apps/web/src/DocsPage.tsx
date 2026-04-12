import { useCallback, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BRAND_NAME, DOCUMENT_TITLES, GITHUB_REPO_URL } from './brand';
import { BrandMark } from './BrandMark';
import { SiteFooter } from './SiteFooter';

const GITHUB_TREE_MAIN = `${GITHUB_REPO_URL}/tree/main`;

/** Populated by `scripts/copy-docs-for-vite.mjs` (runs before `vite` / `vite build`). */
const rawDocModules = import.meta.glob('./bundled-docs/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** Sidebar order: essentials first, then by theme. Unknown files sort last by title. */
const DOC_SIDEBAR_ORDER: readonly string[] = [
  'ESSENTIALS',
  'GETTING-STARTED',
  'APP-GUIDE',
  'SECURITY-AND-EMBED',
  'HOST-WIDGET-INTEGRATION',
  'SUPABASE-AUTH',
  'SUPABASE-CUSTOM-SMTP',
  'SUPABASE-SELF-HOSTED-EMAIL',
  'CREATOR-TREASURY-BUILD-PLAN',
  'INVARIANTS-PHASE-A',
  'DESIGN-AUTOMATED-DISBURSEMENT',
];

/** Short labels for the left Topics nav (full title stays on the page + `title` tooltip). */
const DOC_TOPIC_SHORT_LABEL: Record<string, string> = {
  ESSENTIALS: 'Essentials',
  'GETTING-STARTED': 'Quick start',
  'APP-GUIDE': 'App tour',
  'SECURITY-AND-EMBED': 'Security',
  'HOST-WIDGET-INTEGRATION': 'Embeds',
  'SUPABASE-AUTH': 'Email wallet',
  'SUPABASE-CUSTOM-SMTP': 'SMTP',
  'SUPABASE-SELF-HOSTED-EMAIL': 'Mail stack',
  'CREATOR-TREASURY-BUILD-PLAN': 'Roadmap',
  'INVARIANTS-PHASE-A': 'On-chain',
  'DESIGN-AUTOMATED-DISBURSEMENT': 'Auto splits',
};

function docTopicNavLabel(id: string): string {
  return DOC_TOPIC_SHORT_LABEL[id] ?? id.replace(/-/g, ' ');
}

/** Overview page: themed groups (subset of docs). */
const DOC_HUB_SECTIONS: { title: string; blurb: string; docIds: readonly string[] }[] = [
  {
    title: 'Start here',
    blurb: 'What the product is, how to run it locally, and a straight-line path through the dashboard.',
    docIds: ['ESSENTIALS', 'GETTING-STARTED', 'APP-GUIDE'],
  },
  {
    title: 'Security, API & sharing',
    blurb: 'Auth secrets, read-only status links, embed JWTs, webhooks, and iframe / postMessage integration.',
    docIds: ['SECURITY-AND-EMBED', 'HOST-WIDGET-INTEGRATION'],
  },
  {
    title: 'Optional: email sign-in & mail',
    blurb: 'Supabase-backed accounts, encrypted Solana keybags, SMTP setup and self-hosted mailpit notes.',
    docIds: ['SUPABASE-AUTH', 'SUPABASE-CUSTOM-SMTP', 'SUPABASE-SELF-HOSTED-EMAIL'],
  },
  {
    title: 'Architecture & on-chain rules',
    blurb: 'Roadmap phases, payout automation design, and program invariants.',
    docIds: ['CREATOR-TREASURY-BUILD-PLAN', 'DESIGN-AUTOMATED-DISBURSEMENT', 'INVARIANTS-PHASE-A'],
  },
];

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

function sortDocEntries(list: DocEntry[]): DocEntry[] {
  return [...list].sort((a, b) => {
    const ia = DOC_SIDEBAR_ORDER.indexOf(a.id);
    const ib = DOC_SIDEBAR_ORDER.indexOf(b.id);
    const ra = ia === -1 ? 1000 : ia;
    const rb = ib === -1 ? 1000 : ib;
    if (ra !== rb) return ra - rb;
    return a.title.localeCompare(b.title);
  });
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
    const sorted = sortDocEntries(list);
    const byId = new Map(sorted.map((e) => [e.id, e]));
    return { list: sorted, byId, ids: new Set(sorted.map((e) => e.id)) };
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

      {catalog.list.length === 0 ? (
        <div className="panel docs-empty" role="alert">
          <h2 className="docs-index__title">No topics loaded</h2>
          <p className="muted">
            Markdown was not copied into <code>src/bundled-docs/</code> before this build. From <code>apps/web</code>, run{' '}
            <code>node scripts/copy-docs-for-vite.mjs</code> once, or use <code>npm run dev</code> / <code>npm run build</code> (they run
            the copy automatically).
          </p>
        </div>
      ) : (
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
                  title={e.title}
                >
                  {docTopicNavLabel(e.id)}
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
                <strong>{BRAND_NAME}</strong> is a Solana <strong>creator team treasury</strong>: vault custody, policy hashing,
                multi-approver payout requests with timelocks, optional split automation, audit export (JSON/CSV), read-only{' '}
                <strong>status</strong> and <strong>policy simulator</strong> links, and an optional <strong>Vercel</strong> serverless API
                (snapshot, embed JWT, webhooks). The topics below mirror the repo <code>docs/</code> folder — copied into the app before
                each dev session or production build.
              </p>
              <p className="muted">
                Use the <strong>sidebar</strong> for every guide, or open <strong>Overview</strong> here for a curated map. Each page has
                a <strong>View on GitHub</strong> link when you open a topic.
              </p>

              <div className="docs-index__start" role="navigation" aria-label="Recommended reading order">
                <h3 className="docs-index__start-title">Recommended order</h3>
                <ol className="docs-index__start-list">
                  {(['ESSENTIALS', 'GETTING-STARTED', 'APP-GUIDE', 'SECURITY-AND-EMBED'] as const).flatMap((id) => {
                    const entry = catalog.byId.get(id);
                    if (!entry) return [];
                    return [
                      <li key={id}>
                        <button type="button" className="docs-index__start-link" onClick={() => onSelectDoc(id)}>
                          {entry.title}
                        </button>
                      </li>,
                    ];
                  })}
                </ol>
              </div>

              <div className="docs-hub-sections" aria-label="Documentation by theme">
                {DOC_HUB_SECTIONS.map((section) => {
                  const entries = section.docIds.flatMap((id) => {
                    const e = catalog.byId.get(id);
                    return e ? [e] : [];
                  });
                  if (entries.length === 0) return null;
                  return (
                    <section key={section.title} className="docs-hub-section">
                      <h3 className="docs-hub-section__title">{section.title}</h3>
                      <p className="docs-hub-section__blurb muted">{section.blurb}</p>
                      <ul className="docs-hub-section__links">
                        {entries.map((e) => (
                          <li key={e.id}>
                            <button type="button" className="docs-hub-section__link" onClick={() => onSelectDoc(e.id)}>
                              {e.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>

              <h3 className="docs-index__all-title">All topics (A–Z)</h3>
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
      )}

      <SiteFooter />
    </div>
  );
}
