import { Router } from 'express';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import { requireOwner } from '@core/server/middleware/auth.js';

const router = Router();

/* GET /api/admin/models — list available model IDs from OpenAI-compatible endpoint */
router.get('/admin/models', requireOwner, async (_req, res) => {
  try {
    const rc = getRuntimeConfig();
    const baseUrl = process.env.OPENAI_BASE_URL || rc.aggeInferenceUrl || 'http://localhost:8000';

    const cleanBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    const modelsUrl = `${cleanBase}/v1/models`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer none' },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[models] Endpoint returned ${response.status}`);
      res.json({ success: true, data: [] });
      return;
    }

    const body = await response.json() as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id).sort();

    res.json({ success: true, data: models });
  } catch (err) {
    console.warn('[models] Failed to fetch models:', err instanceof Error ? err.message : err);
    res.json({ success: true, data: [] });
  }
});

export default router;
