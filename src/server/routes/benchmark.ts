import { Router } from 'express';
import { db } from '@db/connection';
import { benchmarkScenarios } from '@db/schema/index';
import { eq, asc } from 'drizzle-orm';
import { requireOwner } from '../middleware/auth';

const router = Router();

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ============================================================
// SCENARIO CRUD
// ============================================================

/* GET /api/benchmark/scenarios — list all scenarios (public) */
router.get('/benchmark/scenarios', async (_req, res, next) => {
  try {
    const scenarios = await db
      .select()
      .from(benchmarkScenarios)
      .orderBy(asc(benchmarkScenarios.tier), asc(benchmarkScenarios.name));

    res.json({ success: true, data: { scenarios } });
  } catch (error) {
    next(error);
  }
});

/* GET /api/benchmark/scenarios/:id — get single scenario (public) */
router.get('/benchmark/scenarios/:id', async (req, res, next) => {
  try {
    const [scenario] = await db
      .select()
      .from(benchmarkScenarios)
      .where(eq(benchmarkScenarios.id, req.params.id));

    if (!scenario) {
      res.status(404).json({ success: false, error: 'Scenario not found' });
      return;
    }

    res.json({ success: true, data: { scenario } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/benchmark/scenarios — create scenario (owner only) */
router.post('/benchmark/scenarios', requireOwner, async (req, res, next) => {
  try {
    const {
      id,
      name,
      description,
      worldConfig,
      agentConfig,
      seedData,
      runLength,
      metrics,
      events,
      difficulty,
      category,
      tier,
    } = req.body as {
      id?: string;
      name?: string;
      description?: string;
      worldConfig?: Record<string, unknown>;
      agentConfig?: Record<string, unknown>;
      seedData?: Record<string, unknown>;
      runLength?: number;
      metrics?: Record<string, unknown>;
      events?: unknown[];
      difficulty?: string;
      category?: string;
      tier?: number;
    };

    // Validation
    if (!id || !SLUG_RE.test(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid id: must be a lowercase slug (letters, numbers, hyphens)',
      });
      return;
    }
    if (!name?.trim()) {
      res.status(400).json({ success: false, error: 'name is required' });
      return;
    }
    if (!description?.trim()) {
      res.status(400).json({ success: false, error: 'description is required' });
      return;
    }

    // Check for duplicate
    const [existing] = await db
      .select({ id: benchmarkScenarios.id })
      .from(benchmarkScenarios)
      .where(eq(benchmarkScenarios.id, id));

    if (existing) {
      res.status(409).json({ success: false, error: 'Scenario with this ID already exists' });
      return;
    }

    const now = new Date();
    const [scenario] = await db
      .insert(benchmarkScenarios)
      .values({
        id,
        name: name.trim(),
        description: description.trim(),
        ...(worldConfig !== undefined && { worldConfig }),
        ...(agentConfig !== undefined && { agentConfig }),
        ...(seedData !== undefined && { seedData }),
        ...(runLength !== undefined && { runLength }),
        ...(metrics !== undefined && { metrics }),
        ...(events !== undefined && { events }),
        ...(difficulty !== undefined && { difficulty }),
        ...(category !== undefined && { category }),
        ...(tier !== undefined && { tier }),
        isBuiltIn: false,
        createdBy: req.user?.id ?? 'unknown',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    res.status(201).json({ success: true, data: { scenario } });
  } catch (error) {
    next(error);
  }
});

/* PUT /api/benchmark/scenarios/:id — update scenario (owner only) */
router.put('/benchmark/scenarios/:id', requireOwner, async (req, res, next) => {
  try {
    const [existing] = await db
      .select()
      .from(benchmarkScenarios)
      .where(eq(benchmarkScenarios.id, req.params.id));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Scenario not found' });
      return;
    }

    const {
      name,
      description,
      worldConfig,
      agentConfig,
      seedData,
      runLength,
      metrics,
      events,
      difficulty,
      category,
      tier,
    } = req.body as {
      name?: string;
      description?: string;
      worldConfig?: Record<string, unknown>;
      agentConfig?: Record<string, unknown>;
      seedData?: Record<string, unknown>;
      runLength?: number;
      metrics?: Record<string, unknown>;
      events?: unknown[];
      difficulty?: string;
      category?: string;
      tier?: number;
    };

    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (name !== undefined) patch.name = name.trim();
    if (description !== undefined) patch.description = description.trim();
    if (worldConfig !== undefined) patch.worldConfig = worldConfig;
    if (agentConfig !== undefined) patch.agentConfig = agentConfig;
    if (seedData !== undefined) patch.seedData = seedData;
    if (runLength !== undefined) patch.runLength = runLength;
    if (metrics !== undefined) patch.metrics = metrics;
    if (events !== undefined) patch.events = events;
    if (difficulty !== undefined) patch.difficulty = difficulty;
    if (category !== undefined) patch.category = category;
    if (tier !== undefined) patch.tier = tier;

    const [scenario] = await db
      .update(benchmarkScenarios)
      .set(patch)
      .where(eq(benchmarkScenarios.id, req.params.id))
      .returning();

    res.json({ success: true, data: { scenario } });
  } catch (error) {
    next(error);
  }
});

/* DELETE /api/benchmark/scenarios/:id — delete scenario (owner only) */
router.delete('/benchmark/scenarios/:id', requireOwner, async (req, res, next) => {
  try {
    const [existing] = await db
      .select({ id: benchmarkScenarios.id, isBuiltIn: benchmarkScenarios.isBuiltIn })
      .from(benchmarkScenarios)
      .where(eq(benchmarkScenarios.id, req.params.id));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Scenario not found' });
      return;
    }

    if (existing.isBuiltIn) {
      res.status(403).json({ success: false, error: 'Cannot delete built-in scenarios' });
      return;
    }

    await db
      .delete(benchmarkScenarios)
      .where(eq(benchmarkScenarios.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
