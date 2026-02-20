import { Router } from 'express';
import { db } from '@db/connection';
import { apiProviders } from '@db/schema/index';
import { eq } from 'drizzle-orm';
import { encryptText, decryptText } from '../lib/crypto.js';
import { requireOwner } from '../middleware/auth.js';

const router = Router();

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  google: ['gemini-2.0-flash', 'gemini-1.5-pro'],
  huggingface: ['meta-llama/Meta-Llama-3-8B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3'],
  ollama: [],
};

const ALL_PROVIDERS = Object.keys(PROVIDER_MODELS);

function maskKey(key: string | null): string | null {
  if (!key) return null;
  try {
    const decrypted = decryptText(key);
    return decrypted.length > 8 ? `...${decrypted.slice(-4)}` : '****';
  } catch { return '****'; }
}

/* GET /api/admin/providers */
router.get('/admin/providers', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db.select().from(apiProviders);
    const providerMap = new Map(rows.map((r) => [r.providerName, r]));

    const result = ALL_PROVIDERS.map((name) => {
      const row = providerMap.get(name);
      return {
        providerName: name,
        isConfigured: !!(row?.encryptedKey),
        isActive: row?.isActive ?? false,
        maskedKey: maskKey(row?.encryptedKey ?? null),
        ollamaBaseUrl: row?.ollamaBaseUrl ?? null,
        models: PROVIDER_MODELS[name] ?? [],
      };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/providers/:name */
router.post('/admin/providers/:name', requireOwner, async (req, res, next) => {
  try {
    const name = String(req.params['name']);
    if (!ALL_PROVIDERS.includes(name)) {
      res.status(400).json({ success: false, error: 'Unknown provider' });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { providerName: name, updatedAt: new Date() };

    if (typeof body.key === 'string' && body.key.trim()) {
      patch.encryptedKey = encryptText(body.key.trim());
      patch.isActive = true;
    }
    if (typeof body.isActive === 'boolean') patch.isActive = body.isActive;
    if (typeof body.ollamaBaseUrl === 'string') patch.ollamaBaseUrl = body.ollamaBaseUrl.trim() || null;

    const [row] = await db
      .insert(apiProviders)
      .values({ providerName: name, updatedAt: new Date(), ...patch })
      .onConflictDoUpdate({ target: apiProviders.providerName, set: patch })
      .returning();

    res.json({ success: true, data: { ...row, encryptedKey: undefined, maskedKey: maskKey(row.encryptedKey) } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/providers/:name/test */
router.post('/admin/providers/:name/test', requireOwner, async (req, res, next) => {
  try {
    const name = String(req.params['name']);
    const start = Date.now();

    if (name === 'ollama') {
      const [row] = await db.select().from(apiProviders).where(eq(apiProviders.providerName, 'ollama')).limit(1);
      const baseUrl = row?.ollamaBaseUrl ?? 'http://localhost:11434';
      const r = await fetch(`${baseUrl}/api/tags`);
      const latencyMs = Date.now() - start;
      if (r.ok) {
        res.json({ success: true, data: { success: true, latencyMs } });
      } else {
        res.json({ success: true, data: { success: false, latencyMs, error: `HTTP ${r.status}` } });
      }
      return;
    }

    const [row] = await db.select().from(apiProviders).where(eq(apiProviders.providerName, name)).limit(1);
    if (!row?.encryptedKey) {
      res.json({ success: true, data: { success: false, latencyMs: 0, error: 'No key configured' } });
      return;
    }

    const apiKey = decryptText(row.encryptedKey);
    let testSuccess = false;
    let testError: string | undefined;

    try {
      if (name === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        });
        testSuccess = r.ok || r.status === 400; // 400 means key works, just bad request
      } else if (name === 'openai') {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        testSuccess = r.ok;
      } else if (name === 'google') {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        testSuccess = r.ok;
      } else if (name === 'huggingface') {
        const r = await fetch('https://huggingface.co/api/whoami', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        testSuccess = r.ok;
      }
    } catch (err) {
      testError = err instanceof Error ? err.message : 'Connection error';
    }

    const latencyMs = Date.now() - start;
    res.json({ success: true, data: { success: testSuccess, latencyMs, error: testError } });
  } catch (error) {
    next(error);
  }
});

/* DELETE /api/admin/providers/:name */
router.delete('/admin/providers/:name', requireOwner, async (req, res, next) => {
  try {
    const name = String(req.params['name']);
    await db.update(apiProviders)
      .set({ encryptedKey: null, isActive: false, updatedAt: new Date() })
      .where(eq(apiProviders.providerName, name));
    res.json({ success: true, data: { cleared: true } });
  } catch (error) {
    next(error);
  }
});

export default router;
