import { Router } from 'express';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import { requireOwner } from '@core/server/middleware/auth.js';

const router = Router();

/* Curated model lists for known cloud providers */
const CURATED_MODELS: Record<string, string[]> = {
  'openrouter.ai': [
    'google/gemini-flash-2.5',
    'google/gemini-pro-2.5',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-6',
    'anthropic/claude-haiku-4-5',
    'meta-llama/llama-3.3-70b-instruct',
    'mistralai/mistral-large',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
  ],
  'anthropic.com': [
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-haiku-4-5-20251001',
  ],
  'openai.com': [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o1',
    'o3-mini',
  ],
};

/**
 * Check if a URL matches a known cloud provider and return its curated list.
 * Returns null if no match (caller should do a live query).
 */
function getCuratedModels(url: string): string[] | null {
  const lower = url.toLowerCase();
  for (const [pattern, models] of Object.entries(CURATED_MODELS)) {
    if (lower.includes(pattern)) return models;
  }
  return null;
}

/* GET /api/admin/models — list available model IDs from OpenAI-compatible endpoint */
router.get('/admin/models', requireOwner, async (req, res) => {
  try {
    const rc = getRuntimeConfig();
    const queryUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const baseUrl = queryUrl || process.env.OPENAI_BASE_URL || rc.aggeInferenceUrl || 'http://localhost:8000';

    /* Check for curated cloud provider lists first */
    const curated = getCuratedModels(baseUrl);
    if (curated) {
      res.json({ success: true, data: curated });
      return;
    }

    /* Live query for vLLM / other OpenAI-compatible endpoints */
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
