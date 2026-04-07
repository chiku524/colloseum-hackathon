import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { applyCors } from '../../_lib/cors';

function requireApiSecret(req: VercelRequest): boolean {
  const expected = process.env.TREASURY_API_SECRET;
  if (!expected) return false;
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return false;
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!requireApiSecret(req)) {
    res.status(401).json({ error: 'Unauthorized — Authorization: Bearer <TREASURY_API_SECRET>.' });
    return;
  }

  const signingSecret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!signingSecret || signingSecret.length < 16) {
    res.status(503).json({ error: 'WEBHOOK_SIGNING_SECRET not configured (min 16 chars).' });
    return;
  }

  try {
    const raw = req.body;
    const parsed: Record<string, unknown> =
      typeof raw === 'string'
        ? (JSON.parse(raw || '{}') as Record<string, unknown>)
        : raw && typeof raw === 'object'
          ? (raw as Record<string, unknown>)
          : {};

    const event = typeof parsed.event === 'string' ? parsed.event : 'treasury.custom';
    const payload = parsed.payload !== undefined ? parsed.payload : parsed;
    const deliveryUrl =
      (typeof parsed.delivery_url === 'string' && parsed.delivery_url) ||
      process.env.WEBHOOK_DELIVERY_URL ||
      '';

    if (!deliveryUrl) {
      res.status(400).json({
        error: 'No delivery_url in body and WEBHOOK_DELIVERY_URL env not set.',
      });
      return;
    }

    const bodyObj = {
      event,
      payload,
      sent_at: new Date().toISOString(),
    };
    const bodyStr = JSON.stringify(bodyObj);
    const sig = createHmac('sha256', signingSecret).update(bodyStr, 'utf8').digest('hex');

    const r = await fetch(deliveryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Treasury-Event': event,
        'X-Treasury-Signature': `sha256=${sig}`,
      },
      body: bodyStr,
    });

    const text = await r.text();
    res.status(200).json({
      delivered: true,
      status: r.status,
      response_preview: text.slice(0, 500),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
