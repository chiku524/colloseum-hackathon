import { useCallback, useEffect, useMemo, useState } from 'react';
import { BRAND_NAME } from './brand';
import {
  WIDGET_CATALOG,
  appOriginPath,
  buildPolicySimulatorUrl,
  buildProjectApiUrl,
  buildStatusViewUrl,
  curlSnippet,
  fetchSnippet,
  iframeSnippet,
  reactIframeSnippet,
  resolveApiOrigin,
  type WidgetCatalogId,
} from './embedWidgets';
import { encodePolicyQueryParam, parsePolicyJson } from './policy';
import { WIDGET_BRIDGE_PROTOCOL, parentMessageListenerSnippet } from './widgetBridge';
import { WIDGET_MANIFEST_PATH, fetchWidgetManifest, type WidgetManifest } from './widgetManifest';
import { SectionHeader, UxIconLink, UxIconMonitor, UxIconPolicy, UxIconShare } from './UxVisual';

export type WidgetStudioProjectDefaults = {
  teamLead: string;
  projectId: string;
  rpc?: string;
};

type WidgetStudioProps = {
  /** Filled when a project is loaded on Overview; users can still edit fields. */
  projectDefaults: WidgetStudioProjectDefaults | null;
  /** Current policy JSON text from Policy tab — used only to offer a simulator link when valid. */
  policyText: string;
  onCopySuccess: (message: string) => void;
  onCopyError: (message: string) => void;
};

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function WidgetStudio({ projectDefaults, policyText, onCopySuccess, onCopyError }: WidgetStudioProps) {
  const [kind, setKind] = useState<WidgetCatalogId>('status_iframe');
  const [teamLead, setTeamLead] = useState(() => projectDefaults?.teamLead ?? '');
  const [projectId, setProjectId] = useState(() => projectDefaults?.projectId ?? '');
  const [rpc, setRpc] = useState(() => projectDefaults?.rpc ?? import.meta.env.VITE_RPC_URL ?? '');
  const [embedToken, setEmbedToken] = useState('');
  /** Parent page origin for postMessage (e.g. https://myapp.com) — appended as parent_origin= on embed URLs. */
  const [hostParentOrigin, setHostParentOrigin] = useState('');
  const [debugPostMessageToSelf, setDebugPostMessageToSelf] = useState(false);
  const [manifest, setManifest] = useState<WidgetManifest | null>(null);
  const [manifestLoadErr, setManifestLoadErr] = useState<string | null>(null);

  const applyLoadedProject = useCallback(() => {
    if (!projectDefaults) return;
    setTeamLead(projectDefaults.teamLead);
    setProjectId(projectDefaults.projectId);
    setRpc(projectDefaults.rpc ?? import.meta.env.VITE_RPC_URL ?? '');
  }, [projectDefaults]);

  useEffect(() => {
    const ac = new AbortController();
    setManifestLoadErr(null);
    fetchWidgetManifest(ac.signal)
      .then((m) => {
        setManifest(m);
      })
      .catch((e: unknown) => {
        const name = e instanceof Error ? e.name : '';
        if (name === 'AbortError') return;
        setManifestLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => ac.abort();
  }, []);

  const baseOpts = useMemo(
    () => ({
      teamLead: teamLead.trim(),
      projectId: projectId.trim(),
      rpc: rpc.trim() || undefined,
      token: embedToken.trim() || undefined,
    }),
    [teamLead, projectId, rpc, embedToken],
  );

  const statusUrlExtras = useMemo(
    () => ({
      parentOrigin: hostParentOrigin.trim() || undefined,
    }),
    [hostParentOrigin],
  );

  const canBuildChainWidgets = Boolean(
    baseOpts.token || (baseOpts.teamLead.length > 0 && baseOpts.projectId.length > 0),
  );

  const policyShare = useMemo(() => {
    const r = parsePolicyJson(policyText);
    if (!r.ok) return null;
    try {
      return encodePolicyQueryParam(r.policy);
    } catch {
      return null;
    }
  }, [policyText]);

  const fullEmbedSrc = useMemo(
    () =>
      canBuildChainWidgets
        ? buildStatusViewUrl({ ...baseOpts, ...statusUrlExtras, embed: true, compact: false })
        : '',
    [baseOpts, canBuildChainWidgets, statusUrlExtras],
  );

  const compactEmbedSrc = useMemo(
    () =>
      canBuildChainWidgets
        ? buildStatusViewUrl({ ...baseOpts, ...statusUrlExtras, embed: true, compact: true })
        : '',
    [baseOpts, canBuildChainWidgets, statusUrlExtras],
  );

  const publicLink = useMemo(
    () =>
      canBuildChainWidgets ? buildStatusViewUrl({ ...baseOpts, embed: false, compact: false }) : '',
    [baseOpts, canBuildChainWidgets],
  );

  const apiUrl = useMemo(
    () => (canBuildChainWidgets ? buildProjectApiUrl(baseOpts) : ''),
    [baseOpts, canBuildChainWidgets],
  );

  const simulatorUrl = useMemo(
    () => (policyShare ? buildPolicySimulatorUrl(policyShare) : ''),
    [policyShare],
  );

  const treasuryAppOrigin = appOriginPath().origin || 'https://your-deployment.example';

  const snippet = useMemo(() => {
    if (!canBuildChainWidgets && kind !== 'policy_simulator' && kind !== 'parent_listener') return '';
    switch (kind) {
      case 'status_iframe':
        return fullEmbedSrc ? iframeSnippet(fullEmbedSrc, { height: 520 }) : '';
      case 'status_iframe_compact':
        return compactEmbedSrc
          ? iframeSnippet(compactEmbedSrc, { height: 160, title: `${BRAND_NAME} treasury status (compact)` })
          : '';
      case 'status_link':
        return publicLink;
      case 'project_api':
        return apiUrl ? `${fetchSnippet(apiUrl)}\n\n# CLI:\n${curlSnippet(apiUrl)}` : '';
      case 'react_component':
        return fullEmbedSrc ? reactIframeSnippet(fullEmbedSrc, 520) : '';
      case 'policy_simulator':
        return simulatorUrl;
      case 'parent_listener':
        return parentMessageListenerSnippet(treasuryAppOrigin);
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }, [
    kind,
    canBuildChainWidgets,
    fullEmbedSrc,
    compactEmbedSrc,
    publicLink,
    apiUrl,
    simulatorUrl,
    treasuryAppOrigin,
  ]);

  const previewBaseSrc = kind === 'status_iframe_compact' ? compactEmbedSrc : fullEmbedSrc;

  const previewSrc = useMemo(() => {
    if (!previewBaseSrc || !debugPostMessageToSelf) return previewBaseSrc;
    try {
      const u = new URL(previewBaseSrc);
      u.searchParams.set('parent_origin', encodeURIComponent(window.location.origin));
      return u.toString();
    } catch {
      return previewBaseSrc;
    }
  }, [previewBaseSrc, debugPostMessageToSelf]);

  const copyRaw = useCallback(
    async (text: string, okMsg: string) => {
      if (!text.trim()) {
        onCopyError('Nothing to copy yet.');
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        onCopySuccess(okMsg);
      } catch (e) {
        onCopyError(e instanceof Error ? e.message : 'Copy failed.');
      }
    },
    [onCopySuccess, onCopyError],
  );

  const handleCopySnippet = useCallback(async () => {
    if (!snippet) {
      onCopyError(
        kind === 'parent_listener'
          ? 'Listener snippet is unavailable.'
          : 'Fill team lead + project ID, or paste an embed JWT.',
      );
      return;
    }
    try {
      await copyText(snippet);
      onCopySuccess('Copied snippet to clipboard.');
    } catch (e) {
      onCopyError(e instanceof Error ? e.message : 'Copy failed.');
    }
  }, [snippet, kind, onCopySuccess, onCopyError]);

  const apiOrigin = resolveApiOrigin();

  return (
    <div className="panel widget-studio">
      <SectionHeader icon={<UxIconShare />} title="Share & embed" />
      <p className="muted">
        Copy ready-made links or code snippets for your own website or tools. For private dashboards, your backend can mint a
        short-lived token with <code>POST /api/v1/embed-token</code> — paste it below so links never expose wallet addresses.
      </p>

      <div className="widget-studio__manifest">
        <SectionHeader icon={<UxIconPolicy />} title="Widget manifest" level="sub" />
        <p className="muted" style={{ marginTop: 0 }}>
          Versioned contract for embeds and <code>postMessage</code> events (
          <code>protocol {WIDGET_BRIDGE_PROTOCOL}</code>
          {manifest ? ` · manifest ${manifest.protocol_version}` : ''}).{' '}
          <a href={WIDGET_MANIFEST_PATH} target="_blank" rel="noreferrer">
            Open {WIDGET_MANIFEST_PATH}
          </a>
        </p>
        {manifestLoadErr ? (
          <p className="muted" role="status">
            Could not load <code>{WIDGET_MANIFEST_PATH}</code> ({manifestLoadErr}). Using in-app protocol{' '}
            <code>{WIDGET_BRIDGE_PROTOCOL}</code> — embed behavior is unchanged.
          </p>
        ) : null}
        {manifest?.post_message?.events && manifest.post_message.events.length > 0 && (
          <ul className="widget-studio__manifest-events muted">
            {manifest.post_message.events.map((ev) => (
              <li key={ev.type}>
                <code>{ev.type}</code> — {ev.description}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="widget-studio__host-guide">
        <SectionHeader icon={<UxIconLink />} title="Host integration (short version)" level="sub" />
        <ol className="widget-studio__host-steps muted">
          <li>
            Set the iframe <code>src</code> to your status URL with <code>embed=1</code> and{' '}
            <code>parent_origin=</code> plus the <strong>percent-encoded origin of the parent page</strong> (e.g.{' '}
            <code>https%3A%2F%2Fapp.example.com</code>). The <strong>Parent origin for postMessage</strong> field below
            appends this for generated embed URLs.
          </li>
          <li>
            On the parent page, listen for <code>message</code> where <code>event.origin</code> is the{' '}
            <strong>treasury app</strong> origin (where the iframe is hosted), and filter{' '}
            <code>data.source === &apos;creator-treasury-widget&apos;</code> and{' '}
            <code>data.protocol === &apos;{WIDGET_BRIDGE_PROTOCOL}&apos;</code>.
          </li>
          <li>
            When snapshot shape or events change, bump <code>WIDGET_BRIDGE_PROTOCOL</code> in{' '}
            <code>widgetBridge.ts</code> and <code>protocol_version</code> in{' '}
            <code>public/widget-manifest.json</code> together. Full checklist: repo file{' '}
            <code>docs/HOST-WIDGET-INTEGRATION.md</code>.
          </li>
        </ol>
      </div>

      {projectDefaults && (
        <div className="btn-row" style={{ marginBottom: '1rem' }}>
          <button type="button" className="ghost" onClick={applyLoadedProject}>
            Use loaded project from Overview
          </button>
        </div>
      )}

      <div className="widget-studio__quick-copy">
        <SectionHeader icon={<UxIconShare />} title="Quick copy" level="sub" />
        <p className="muted" style={{ marginTop: 0 }}>
          Copy common outputs without changing the snippet type below.
        </p>
        <div className="btn-row widget-studio__quick-copy-btns">
          <button
            type="button"
            className="ghost"
            disabled={!publicLink}
            onClick={() => void copyRaw(publicLink, 'Copied public status link.')}
          >
            Public link
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!fullEmbedSrc}
            onClick={() =>
              void copyRaw(
                fullEmbedSrc ? iframeSnippet(fullEmbedSrc, { height: 520 }) : '',
                'Copied full iframe HTML.',
              )
            }
          >
            Full iframe HTML
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!compactEmbedSrc}
            onClick={() =>
              void copyRaw(
                compactEmbedSrc
                  ? iframeSnippet(compactEmbedSrc, { height: 160, title: `${BRAND_NAME} treasury (compact)` })
                  : '',
                'Copied compact iframe HTML.',
              )
            }
          >
            Compact iframe HTML
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!apiUrl}
            onClick={() => void copyRaw(apiUrl, 'Copied API URL.')}
          >
            API URL
          </button>
        </div>
      </div>

      <div className="form-grid widget-studio__form">
        <div className="field-row widget-studio__fields">
          <div className="field" style={{ flex: '1 1 12rem' }}>
            <label htmlFor="ws-team">Team lead wallet</label>
            <input
              id="ws-team"
              type="text"
              value={teamLead}
              onChange={(e) => setTeamLead(e.target.value)}
              placeholder="Solana wallet address"
              autoComplete="off"
              disabled={Boolean(embedToken.trim())}
            />
          </div>
          <div className="field" style={{ flex: '0 0 7rem' }}>
            <label htmlFor="ws-pid">Project ID</label>
            <input
              id="ws-pid"
              type="text"
              inputMode="numeric"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="0"
              autoComplete="off"
              disabled={Boolean(embedToken.trim())}
            />
          </div>
          <div className="field" style={{ flex: '1 1 10rem' }}>
            <label htmlFor="ws-rpc">Custom network URL (optional)</label>
            <input
              id="ws-rpc"
              type="text"
              value={rpc}
              onChange={(e) => setRpc(e.target.value)}
              placeholder="https://…"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="ws-jwt">Embed JWT (optional)</label>
          <input
            id="ws-jwt"
            type="text"
            value={embedToken}
            onChange={(e) => setEmbedToken(e.target.value)}
            placeholder="From POST /api/v1/embed-token — keeps wallet addresses out of the link"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="ws-parent">Parent origin for postMessage (optional)</label>
          <input
            id="ws-parent"
            type="text"
            value={hostParentOrigin}
            onChange={(e) => setHostParentOrigin(e.target.value)}
            placeholder="https://myapp.com — no path; must match the page that hosts the iframe"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="muted field-hint">
            When set, appended as <code>parent_origin</code> on embed URLs. The iframe sends <code>ready</code>,{' '}
            <code>loading</code>, <code>error</code>, and <code>snapshot</code> events to <code>window.parent</code> only at
            this origin. Use <strong>http://localhost</strong> or <strong>http://127.0.0.1</strong> for local HTTP; production
            parents should use <strong>https</strong>.
          </p>
        </div>
      </div>

      <div className="widget-studio__kind" role="group" aria-label="Widget type">
        {WIDGET_CATALOG.map((w) => (
          <label key={w.id} className={`widget-studio__kind-option ${kind === w.id ? 'is-selected' : ''}`}>
            <input
              type="radio"
              name="widget-kind"
              checked={kind === w.id}
              onChange={() => setKind(w.id)}
              disabled={w.id === 'policy_simulator' && !policyShare}
            />
            <span className="widget-studio__kind-label">{w.label}</span>
            <span className="widget-studio__kind-hint">{w.hint}</span>
          </label>
        ))}
      </div>

      {!canBuildChainWidgets && kind !== 'policy_simulator' && kind !== 'parent_listener' && (
        <p className="error" role="status">
          Enter the team lead wallet and project number, or paste an embed token.
        </p>
      )}

      {kind === 'policy_simulator' && !policyShare && (
        <p className="muted">Save valid payout rules on the Policy tab to build a shareable “what if” link.</p>
      )}

      <p className="muted widget-studio__api-meta">
        Data API for this site: <code>{apiOrigin || '(SSR)'}</code> → <code>/api/v1/project</code>
      </p>

      <div className="btn-row">
        <button
          type="button"
          className="ghost"
          disabled={!snippet}
          onClick={() => void handleCopySnippet()}
        >
          Copy snippet
        </button>
      </div>

      {snippet && (
        <pre className="data-block widget-studio__snippet" style={{ marginTop: '0.75rem' }}>
          {snippet}
        </pre>
      )}

      {(kind === 'status_iframe' || kind === 'status_iframe_compact') && previewSrc && (
        <div className="widget-studio__preview">
          <SectionHeader icon={<UxIconMonitor />} title="Live preview" level="sub" />
          <p className="muted">Rendered in an iframe from this deployment (same as your embed).</p>
          <label className="widget-studio__debug-toggle toggle-row">
            <input
              type="checkbox"
              checked={debugPostMessageToSelf}
              onChange={(e) => setDebugPostMessageToSelf(e.target.checked)}
            />
            <span>
              Debug: add <code>parent_origin</code> for this app so the iframe posts to this window (watch the console on
              the parent page).
            </span>
          </label>
          <div className="widget-studio__preview-frame-wrap">
            <iframe
              title="Widget preview"
              src={previewSrc}
              className="widget-studio__preview-frame"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      )}
    </div>
  );
}
