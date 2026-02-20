import { Router } from 'express';
import { db } from '@db/connection';
import { agents, userAgents, userApiKeys, researcherRequests } from '@db/schema/index';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth } from '@core/server/middleware/auth.js';
import { encryptText, decryptText } from '@core/server/lib/crypto.js';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';

const router = Router();

function maskKey(encrypted: string): string {
  try {
    const decrypted = decryptText(encrypted);
    return decrypted.length > 8 ? `...${decrypted.slice(-4)}` : '****';
  } catch (err) { console.warn('[PROFILE] Key decryption failed:', err instanceof Error ? err.message : err); return '****'; }
}

/* GET /api/profile/me */
router.get('/profile/me', requireAuth, async (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
    },
  });
});

/* GET /api/profile/researcher-request */
router.get('/profile/researcher-request', requireAuth, async (req, res, next) => {
  try {
    const [request] = await db
      .select()
      .from(researcherRequests)
      .where(eq(researcherRequests.userId, req.user!.id))
      .orderBy(desc(researcherRequests.createdAt))
      .limit(1);
    res.json({ success: true, data: request ?? null });
  } catch (error) {
    next(error);
  }
});

/* POST /api/profile/researcher-request */
router.post('/profile/researcher-request', requireAuth, async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const message = String(body.message ?? '').trim();
    if (!message) {
      res.status(400).json({ success: false, error: 'message is required' });
      return;
    }
    // Only one active (pending) request allowed at a time
    const [existing] = await db
      .select({ id: researcherRequests.id, status: researcherRequests.status })
      .from(researcherRequests)
      .where(and(
        eq(researcherRequests.userId, req.user!.id),
        eq(researcherRequests.status, 'pending'),
      ))
      .limit(1);
    if (existing) {
      res.status(409).json({ success: false, error: 'You already have a pending request' });
      return;
    }
    const [created] = await db.insert(researcherRequests).values({
      userId: req.user!.id,
      message,
    }).returning();
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    next(error);
  }
});

/* GET /api/profile/agents */
router.get('/profile/agents', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const userAgentRows = await db.select().from(userAgents).where(eq(userAgents.userId, userId));
    if (userAgentRows.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }
    const agentIds = userAgentRows.map((r) => r.agentId);
    const agentRows = await Promise.all(
      agentIds.map((id) =>
        db.select().from(agents).where(eq(agents.id, id)).limit(1).then((r) => r[0])
      )
    ).then((rows) => rows.filter(Boolean));
    res.json({ success: true, data: agentRows });
  } catch (error) {
    next(error);
  }
});

/* POST /api/profile/agents/create */
router.post('/profile/agents/create', requireAuth, async (req, res, next) => {
  try {
    const rc = getRuntimeConfig();
    const userId = req.user!.id;
    const body = req.body as Record<string, unknown>;

    const displayName = String(body.displayName ?? '').trim();
    const name = String(body.name ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const alignment = String(body.alignment ?? 'moderate');
    const bio = String(body.bio ?? '').trim();
    const personality = String(body.personality ?? '').trim();
    const modelProvider = String(body.modelProvider ?? 'anthropic');
    const model = String(body.model ?? '').trim();

    if (!displayName || !name) {
      res.status(400).json({ success: false, error: 'displayName and name are required' });
      return;
    }

    const [newAgent] = await db.insert(agents).values({
      displayName,
      name,
      agoraId: `agora_${name}_${Date.now()}`,
      alignment,
      bio: bio || undefined,
      personality: personality || undefined,
      modelProvider,
      model: model || undefined,
      balance: rc.initialAgentBalance,
      reputation: 100,
      isActive: true,
      ownerUserId: userId,
    }).returning();

    const existingAgents = await db.select().from(userAgents).where(eq(userAgents.userId, userId));
    await db.insert(userAgents).values({
      userId,
      agentId: newAgent.id,
      isPrimary: existingAgents.length === 0,
    });

    res.json({ success: true, data: newAgent });
  } catch (error) {
    next(error);
  }
});

/* GET /api/profile/apikeys */
router.get('/profile/apikeys', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const keys = await db.select().from(userApiKeys).where(eq(userApiKeys.userId, userId));
    const masked = keys.map((k) => ({ ...k, encryptedKey: undefined, maskedKey: maskKey(k.encryptedKey) }));
    res.json({ success: true, data: masked });
  } catch (error) {
    next(error);
  }
});

/* POST /api/profile/apikeys/:provider */
router.post('/profile/apikeys/:provider', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const provider = String(req.params['provider'] ?? '');
    const body = req.body as Record<string, unknown>;
    const key = String(body.key ?? '').trim();
    const model = typeof body.model === 'string' ? body.model.trim() : undefined;

    if (!key) {
      res.status(400).json({ success: false, error: 'key is required' });
      return;
    }

    const encryptedKey = encryptText(key);
    const [existing] = await db.select({ id: userApiKeys.id }).from(userApiKeys)
      .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.providerName, provider))).limit(1);

    if (existing) {
      await db.update(userApiKeys).set({ encryptedKey, model, isActive: true }).where(eq(userApiKeys.id, existing.id));
    } else {
      await db.insert(userApiKeys).values({ userId, providerName: provider, encryptedKey, model });
    }

    res.json({ success: true, data: { provider, maskedKey: `...${key.slice(-4)}` } });
  } catch (error) {
    next(error);
  }
});

/* DELETE /api/profile/apikeys/:provider */
router.delete('/profile/apikeys/:provider', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const provider = String(req.params['provider'] ?? '');
    await db.delete(userApiKeys).where(
      and(eq(userApiKeys.userId, userId), eq(userApiKeys.providerName, provider))
    );
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});

export default router;
