/** Must match public/widget-manifest.json post_message.source_value */
export const WIDGET_BRIDGE_SOURCE = 'creator-treasury-widget' as const;

/**
 * Bump when snapshot shape or event types change; keep in sync with
 * `public/widget-manifest.json` → `protocol_version` and `docs/HOST-WIDGET-INTEGRATION.md`.
 */
export const WIDGET_BRIDGE_PROTOCOL = '1' as const;

export type WidgetSnapshotPayload = {
  projectPda: string;
  projectId: string;
  /** Truncated team lead for display only */
  teamLeadPreview: string;
  policyVersion: number;
  policyHashHex: string;
  frozen: boolean;
  vaultInitialized: boolean;
  vaultBalance?: string;
  /** Truncated mint when present */
  mintPreview?: string;
  proposalCount: number;
  pendingProposalCount: number;
  activeDisputeCount: number;
  compactLayout: boolean;
};

export type WidgetBridgeMessage =
  | {
      source: typeof WIDGET_BRIDGE_SOURCE;
      protocol: typeof WIDGET_BRIDGE_PROTOCOL;
      type: 'ready';
      compact: boolean;
    }
  | {
      source: typeof WIDGET_BRIDGE_SOURCE;
      protocol: typeof WIDGET_BRIDGE_PROTOCOL;
      type: 'loading';
    }
  | {
      source: typeof WIDGET_BRIDGE_SOURCE;
      protocol: typeof WIDGET_BRIDGE_PROTOCOL;
      type: 'error';
      message: string;
    }
  | {
      source: typeof WIDGET_BRIDGE_SOURCE;
      protocol: typeof WIDGET_BRIDGE_PROTOCOL;
      type: 'snapshot';
      payload: WidgetSnapshotPayload;
    };

function previewKey(s: string, left = 4, right = 4): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

export function buildWidgetSnapshotPayload(
  state: {
    projectPda: string;
    teamLead: string;
    projectId: string;
    policyVersion: number;
    policyHashHex: string;
    frozen: boolean;
    vaultInitialized: boolean;
    vaultBalance?: string;
    mint?: string;
    proposals: { statusCode: number; disputeActive: boolean }[];
  },
  compactLayout: boolean,
): WidgetSnapshotPayload {
  const pendingProposalCount = state.proposals.filter((p) => p.statusCode < 2).length;
  const activeDisputeCount = state.proposals.filter((p) => p.disputeActive).length;
  return {
    projectPda: state.projectPda,
    projectId: state.projectId,
    teamLeadPreview: previewKey(state.teamLead, 6, 6),
    policyVersion: state.policyVersion,
    policyHashHex: state.policyHashHex,
    frozen: state.frozen,
    vaultInitialized: state.vaultInitialized,
    vaultBalance: state.vaultBalance,
    mintPreview: state.mint ? previewKey(state.mint, 4, 4) : undefined,
    proposalCount: state.proposals.length,
    pendingProposalCount,
    activeDisputeCount,
    compactLayout,
  };
}

/**
 * Parse and validate `parent_origin` query value. Returns strict origin string for postMessage target,
 * or null if missing/invalid. Only https (any host) or http on localhost / 127.0.0.1.
 */
export function parseAllowedParentOrigin(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  let u: URL;
  try {
    u = new URL(decoded);
  } catch {
    return null;
  }
  if (u.hash || u.search) return null;
  const pathOk = u.pathname === '/' || u.pathname === '';
  if (!pathOk) return null;
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:') {
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1') return u.origin;
  }
  return null;
}

export function postWidgetBridgeMessage(targetOrigin: string, message: WidgetBridgeMessage): void {
  if (typeof window === 'undefined') return;
  if (window.parent === window) return;
  try {
    window.parent.postMessage(message, targetOrigin);
  } catch {
    /* ignore invalid targetOrigin or closed parent */
  }
}

export function parentMessageListenerSnippet(treasuryAppOrigin: string): string {
  return `// Run on your parent page. treasuryOrigin must match the iframe's deployment (exact string).
const treasuryOrigin = ${JSON.stringify(treasuryAppOrigin)};

window.addEventListener('message', (event) => {
  if (event.origin !== treasuryOrigin) return;
  const m = event.data;
  if (!m || m.source !== '${WIDGET_BRIDGE_SOURCE}' || m.protocol !== '${WIDGET_BRIDGE_PROTOCOL}') return;

  switch (m.type) {
    case 'ready':
      // { compact: boolean }
      break;
    case 'loading':
      break;
    case 'error':
      // { message: string }
      break;
    case 'snapshot':
      // m.payload: vault, proposal counts, policy version, etc.
      break;
    default:
      break;
  }
});`;
}
