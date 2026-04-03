import type { RequestHandler } from 'express';

export const requireOrchestrator: RequestHandler = (req, res, next) => {
  const key = process.env.BOB_ORCHESTRATOR_KEY;
  if (!key) {
    res.status(503).json({ success: false, error: 'Orchestrator not configured' });
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing Authorization header' });
    return;
  }

  const token = auth.slice(7);
  if (token !== key) {
    res.status(403).json({ success: false, error: 'Invalid orchestrator key' });
    return;
  }

  next();
};
