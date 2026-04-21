import type { RequestHandler } from 'express';

/* Extract bearer from (in order): Authorization header, X-Orchestrator-Key header,
 * then ?key= / ?auth= query params. The query-param fallback exists because some
 * MCP SSE clients (notably OpenClaw's bundle loader) cannot attach custom headers
 * to the GET stream that carries server→client events, so header-only auth would
 * leave them unable to complete the session. Query-param auth is safe here because
 * the endpoint is served exclusively over HTTPS through the Cloudflare tunnel. */
function extractToken(req: Parameters<RequestHandler>[0]): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);

  const headerKey = req.headers['x-orchestrator-key'];
  if (typeof headerKey === 'string' && headerKey.length > 0) return headerKey;

  const q = req.query;
  const qKey = typeof q.key === 'string' ? q.key : typeof q.auth === 'string' ? q.auth : null;
  if (qKey && qKey.length > 0) return qKey;

  return null;
}

export const requireOrchestrator: RequestHandler = (req, res, next) => {
  const key = process.env.BOB_ORCHESTRATOR_KEY;
  if (!key) {
    res.status(503).json({ success: false, error: 'Orchestrator not configured' });
    return;
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'Missing orchestrator credential' });
    return;
  }

  if (token !== key) {
    res.status(403).json({ success: false, error: 'Invalid orchestrator key' });
    return;
  }

  next();
};
