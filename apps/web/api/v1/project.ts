import type { VercelRequest, VercelResponse } from '@vercel/node';
import { jwtVerify } from 'jose';
import { applyCors } from '../_lib/cors';
import { buildProjectSnapshot } from '../_lib/snapshot';

const DEFAULT_RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

function getJwtSecret(): Uint8Array | null {
  const s = process.env.JWT_EMBED_SECRET;
  if (!s || s.length < 16) return null;
  return new TextEncoder().encode(s);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined;
    const teamLeadQ = typeof req.query.team_lead === 'string' ? req.query.team_lead : undefined;
    const projectIdQ = typeof req.query.project_id === 'string' ? req.query.project_id : undefined;
    const rpcQ = typeof req.query.rpc === 'string' ? req.query.rpc.trim() : undefined;

    let teamLead = teamLeadQ?.trim();
    let projectId = projectIdQ?.trim();
    let rpc = rpcQ || DEFAULT_RPC;

    if (token) {
      const secret = getJwtSecret();
      if (!secret) {
        res.status(503).json({ error: 'JWT_EMBED_SECRET is not configured on the server.' });
        return;
      }
      try {
        const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
        const pl = payload as Record<string, unknown>;
        const tl = pl.team_lead ?? pl.teamLead;
        const pid = pl.project_id ?? pl.projectId;
        if (typeof tl !== 'string' || typeof pid !== 'string') {
          res.status(400).json({ error: 'Invalid embed token payload.' });
          return;
        }
        teamLead = tl;
        projectId = pid;
        const rpcClaim = pl.rpc;
        if (typeof rpcClaim === 'string' && rpcClaim.length > 0) {
          rpc = rpcClaim;
        }
      } catch {
        res.status(401).json({ error: 'Invalid or expired embed token.' });
        return;
      }
    }

    if (!teamLead || !projectId) {
      res.status(400).json({
        error: 'Provide team_lead and project_id query params, or a valid token (embed JWT).',
      });
      return;
    }

    if (rpcQ?.trim()) {
      rpc = rpcQ.trim();
    }

    const snapshot = await buildProjectSnapshot(teamLead, projectId, rpc);
    res.status(200).json(snapshot);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes('No project account') ? 404 : 400;
    res.status(status).json({ error: msg });
  }
}
