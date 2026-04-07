# Host integration — embedded treasury status

This page is the canonical checklist for embedding **Creator Treasury** read-only status in **your** app and optionally receiving **`postMessage`** updates from the iframe.

Machine-readable details (iframe heights, event names, payload fields): **[`/widget-manifest.json`](../apps/web/public/widget-manifest.json)** on your deployed treasury app (same origin as the UI).

---

## 1. Iframe URL

Point the iframe at your treasury deployment’s status view with **`embed=1`**.

Add **`parent_origin=`** followed by the **percent-encoded origin** of the page that **hosts** the iframe (the parent document), not the iframe’s URL.

**Example:** parent app lives at `https://app.example.com` → use:

```text
parent_origin=https%3A%2F%2Fapp.example.com
```

Full URL shape (other query params vary):

```text
https://<treasury-deployment>/…?view=status&embed=1&parent_origin=<encoded-parent-origin>&…
```

You can also set **Parent origin for postMessage** in the in-app **Widgets** tab; it appends this parameter for you.

**Rules for `parent_origin`:**

- Must be an **origin only** (scheme + host + optional port). No path, query string, or fragment.
- **Production:** use **`https://…`**.
- **Local HTTP:** only **`http://localhost`** or **`http://127.0.0.1`** (any port) is accepted.

If `parent_origin` is missing or invalid, the iframe still works; it simply will not call `postMessage`.

---

## 2. Parent page listener

On the **host** page (the parent of the iframe), listen for `message` events.

1. **Check `event.origin`** — it must equal the **treasury app’s origin** (where the iframe `src` is hosted), not your own site’s origin.
2. **Check the payload:**
   - `data.source === 'creator-treasury-widget'`
   - `data.protocol === '1'` (see [Protocol version](#protocol-version) below)

Then handle `data.type`:

| `type`      | Meaning |
|-------------|---------|
| `ready`     | Bridge is up; optional `compact` boolean. |
| `loading`   | A refresh started. |
| `error`     | Load failed; `message` is safe to show in UI. |
| `snapshot`  | Success; summary fields in `payload` (see manifest). |

A copy-paste listener snippet is available in the app under **Widgets → Parent page — postMessage listener**.

---

## Protocol version

The string **`'1'`** is the widget **`postMessage` protocol** version.

When you change **snapshot shape** or **event types** in code:

1. Bump **`WIDGET_BRIDGE_PROTOCOL`** in **`apps/web/src/widgetBridge.ts`**.
2. Bump **`protocol_version`** (and any affected descriptions) in **`apps/web/public/widget-manifest.json`**.
3. Update this doc if the integration steps change.

Keep all three in sync so hosts can rely on `data.protocol`.

---

## Related

- **[`SECURITY-AND-EMBED.md`](./SECURITY-AND-EMBED.md)** — API, JWT embed tokens, CSP notes.
- **`apps/web/src/widgetBridge.ts`** — runtime constants and `postMessage` helpers.
