/** Served as static file from /widget-manifest.json (see public/widget-manifest.json). */

export const WIDGET_MANIFEST_PATH = '/widget-manifest.json';

export type WidgetManifestPostMessageEvent = {
  type: string;
  description: string;
};

export type WidgetManifest = {
  schema_version: number;
  protocol_version: string;
  name: string;
  description?: string;
  manifest_url_path?: string;
  post_message?: {
    source_field: string;
    source_value: string;
    protocol_field: string;
    parent_origin_query_param: string;
    requires_embed: boolean;
    events?: WidgetManifestPostMessageEvent[];
    snapshot_payload_fields?: string[];
    security_notes?: string[];
  };
};

export async function fetchWidgetManifest(signal?: AbortSignal): Promise<WidgetManifest> {
  const r = await fetch(WIDGET_MANIFEST_PATH, { signal });
  if (!r.ok) {
    throw new Error(`Failed to load widget manifest (${r.status}).`);
  }
  const data: unknown = await r.json();
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid widget manifest JSON.');
  }
  return data as WidgetManifest;
}
