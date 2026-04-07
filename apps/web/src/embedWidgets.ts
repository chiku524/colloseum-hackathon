/**
 * URL builders and copy-paste snippets for embedding Lithos (treasury status) in other apps.
 * See Widget Studio in the main app for interactive configuration.
 */

import { BRAND_NAME } from './brand';

export type StatusUrlOptions = {
  teamLead: string;
  projectId: string;
  /** Optional RPC override (passed through to the status page). */
  rpc?: string;
  /** JWT from POST /api/v1/embed-token — when set, team_lead/project_id need not appear in the URL. */
  token?: string;
  embed?: boolean;
  /** Minimal layout for small iframes (adds compact=1). */
  compact?: boolean;
  /**
   * Parent page origin (e.g. https://myapp.com). Encoded as parent_origin= — when embed=1, the iframe
   * posts snapshot updates to window.parent via postMessage (see /widget-manifest.json).
   */
  parentOrigin?: string;
};

export function appOriginPath(): { origin: string; pathname: string } {
  if (typeof window === 'undefined') return { origin: '', pathname: '/' };
  return { origin: window.location.origin, pathname: window.location.pathname || '/' };
}

export function buildStatusViewUrl(opts: StatusUrlOptions): string {
  const { origin, pathname } = appOriginPath();
  const base = `${origin}${pathname}`;
  const q = new URLSearchParams();
  q.set('view', 'status');
  if (opts.token?.trim()) {
    q.set('token', opts.token.trim());
  } else {
    q.set('team_lead', opts.teamLead.trim());
    q.set('project_id', opts.projectId.trim());
  }
  if (opts.rpc?.trim()) q.set('rpc', opts.rpc.trim());
  if (opts.embed) q.set('embed', '1');
  if (opts.compact) q.set('compact', '1');
  if (opts.parentOrigin?.trim()) {
    q.set('parent_origin', encodeURIComponent(opts.parentOrigin.trim()));
  }
  return `${base}?${q.toString()}`;
}

export function resolveApiOrigin(): string {
  const v = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
  if (v) return v;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export type ProjectApiOptions = {
  teamLead: string;
  projectId: string;
  rpc?: string;
  token?: string;
};

export function buildProjectApiUrl(opts: ProjectApiOptions): string {
  const api = resolveApiOrigin();
  const q = new URLSearchParams();
  if (opts.token?.trim()) q.set('token', opts.token.trim());
  else {
    q.set('team_lead', opts.teamLead.trim());
    q.set('project_id', opts.projectId.trim());
  }
  if (opts.rpc?.trim()) q.set('rpc', opts.rpc.trim());
  return `${api}/api/v1/project?${q.toString()}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function iframeSnippet(src: string, opts?: { title?: string; height?: number }): string {
  const h = opts?.height ?? 520;
  const title = opts?.title ?? `${BRAND_NAME} treasury status`;
  return `<iframe
  title="${escapeAttr(title)}"
  src="${escapeAttr(src)}"
  width="100%"
  height="${h}"
  style="border:0;border-radius:12px;max-width:100%"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
></iframe>`;
}

export function fetchSnippet(url: string): string {
  return `const r = await fetch(${JSON.stringify(url)});
if (!r.ok) throw new Error(await r.text());
const data = await r.json();
// Snapshot: vault, proposals, policy hash, etc.
console.log(data);`;
}

export function curlSnippet(url: string): string {
  return `curl -sS ${JSON.stringify(url)}`;
}

export function reactIframeSnippet(src: string, height: number): string {
  return `export function TreasuryStatusEmbed() {
  return (
    <iframe
      title="${BRAND_NAME} treasury status"
      src={${JSON.stringify(src)}}
      width="100%"
      height={${height}}
      style={{ border: 0, borderRadius: 12, maxWidth: '100%' }}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}`;
}

export function buildPolicySimulatorUrl(policyB64: string): string {
  const { origin, pathname } = appOriginPath();
  const q = new URLSearchParams();
  q.set('view', 'simulate');
  q.set('p', policyB64.trim());
  return `${origin}${pathname}?${q.toString()}`;
}

export const WIDGET_CATALOG = [
  {
    id: 'status_iframe',
    label: 'Status — full iframe',
    hint: 'Height ~520px. Uses read-only status UI inside your site.',
  },
  {
    id: 'status_iframe_compact',
    label: 'Status — compact iframe',
    hint: 'Height ~160px. Vault + key counts only; best for footers and sidebars.',
  },
  {
    id: 'status_link',
    label: 'Public status link',
    hint: 'Opens full status page in a new tab (no iframe).',
  },
  {
    id: 'project_api',
    label: 'JSON API (fetch / curl)',
    hint: 'Same snapshot as the status page: GET /api/v1/project. CORS enabled.',
  },
  {
    id: 'react_component',
    label: 'React iframe component',
    hint: 'Drop-in JSX using the full or compact iframe src.',
  },
  {
    id: 'policy_simulator',
    label: 'Policy simulator link',
    hint: 'Share deposit math for a policy JSON (no chain). Requires valid policy from Policy tab.',
  },
  {
    id: 'parent_listener',
    label: 'Parent page — postMessage listener',
    hint: 'TypeScript snippet for the host page. Add parent_origin to the iframe URL (Widget Studio field).',
  },
] as const;

export type WidgetCatalogId = (typeof WIDGET_CATALOG)[number]['id'];
