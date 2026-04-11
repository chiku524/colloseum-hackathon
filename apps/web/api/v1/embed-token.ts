import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SignJWT } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import { applyCors } from '../_lib/cors';

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
    res.status(401).json({ error: 'Unauthorized — set Authorization: Bearer <TREASURY_API_SECRET>.' });
    return;
  }

  const secret = process.env.JWT_EMBED_SECRET;
  if (!secret || secret.length < 16) {
    res.status(503).json({ error: 'JWT_EMBED_SECRET must be set (min 16 chars).' });
    return;
  }

  try {
    const raw = req.body;
    const body: Record<string, unknown> =
      typeof raw === 'string'
        ? (JSON.parse(raw || '{}') as Record<string, unknown>)
        : raw && typeof raw === 'object'
          ? (raw as Record<string, unknown>)
          : {};
    const teamLead = (body.pda_seed_owner ?? body.pdaSeedOwner ?? body.team_lead ?? body.teamLead) as
      | string
      | undefined;
    const projectId = (body.project_id ?? body.projectId) as string | undefined;
    const rpc = (body.rpc as string | undefined)?.trim();

    if (!teamLead?.trim() || !projectId?.trim()) {
      res.status(400).json({ error: 'team_lead (or pda_seed_owner) and project_id are required.' });
      return;
    }

    const key = new TextEncoder().encode(secret);
    const jwt = await new SignJWT({
      team_lead: teamLead.trim(),
      project_id: projectId.trim(),
      ...(rpc ? { rpc } : {}),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(key);

    res.status(200).json({
      token: jwt,
      expires_in_seconds: 604800,
      usage: 'Open /?view=status&token=<token> on this deployment (or pass token to GET /api/v1/project).',
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
