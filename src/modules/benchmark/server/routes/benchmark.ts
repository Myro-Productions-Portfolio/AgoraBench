import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '@db/connection';
import { benchmarkScenarios, benchmarkRuns } from '@db/schema/index';
import { eq, asc, desc, and, sql, count } from 'drizzle-orm';
import { requireOwner } from '@core/server/middleware/auth';
import { benchmarkQueue } from '../jobs/benchmarkJob.js';
import type { RunConfig } from '../services/benchmarkRunner.js';

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
    const scenarioId = req.params.id as string;
    const [existing] = await db
      .select()
      .from(benchmarkScenarios)
      .where(eq(benchmarkScenarios.id, scenarioId));

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
      .where(eq(benchmarkScenarios.id, scenarioId))
      .returning();

    res.json({ success: true, data: { scenario } });
  } catch (error) {
    next(error);
  }
});

/* DELETE /api/benchmark/scenarios/:id — delete scenario (owner only) */
router.delete('/benchmark/scenarios/:id', requireOwner, async (req, res, next) => {
  try {
    const scenarioId = req.params.id as string;
    const [existing] = await db
      .select({ id: benchmarkScenarios.id, isBuiltIn: benchmarkScenarios.isBuiltIn })
      .from(benchmarkScenarios)
      .where(eq(benchmarkScenarios.id, scenarioId));

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
      .where(eq(benchmarkScenarios.id, scenarioId));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================================
// BENCHMARK RUNS
// ============================================================

/* POST /api/benchmark/run — trigger a benchmark run (owner only) */
router.post('/benchmark/run', requireOwner, async (req, res, next) => {
  try {
    const {
      scenarioId,
      modelName,
      modelBackend,
      modelEndpoint,
      agentAssignment = 'all',
      runs = 1,
      callbackUrl,
    } = req.body as {
      scenarioId?: string;
      modelName?: string;
      modelBackend?: 'internal' | 'external';
      modelEndpoint?: string;
      agentAssignment?: string;
      runs?: number;
      callbackUrl?: string;
    };

    // Validate required fields
    if (!scenarioId || !modelName || !modelBackend) {
      res.status(400).json({
        success: false,
        error: 'scenarioId, modelName, and modelBackend are required',
      });
      return;
    }

    if (!['internal', 'external'].includes(modelBackend)) {
      res.status(400).json({
        success: false,
        error: 'modelBackend must be "internal" or "external"',
      });
      return;
    }

    if (modelBackend === 'external' && !modelEndpoint) {
      res.status(400).json({
        success: false,
        error: 'modelEndpoint is required when modelBackend is "external"',
      });
      return;
    }

    const runCount = Math.min(Math.max(1, Number(runs) || 1), 10);

    // Validate scenario exists
    const [scenario] = await db
      .select({ id: benchmarkScenarios.id })
      .from(benchmarkScenarios)
      .where(eq(benchmarkScenarios.id, scenarioId));

    if (!scenario) {
      res.status(404).json({ success: false, error: 'Scenario not found' });
      return;
    }

    const configHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ scenarioId, modelName, modelBackend, agentAssignment }))
      .digest('hex');

    const triggeredBy = req.user?.id ?? 'unknown';
    const runIds: string[] = [];

    for (let i = 0; i < runCount; i++) {
      const runId = crypto.randomUUID();
      runIds.push(runId);

      await db.insert(benchmarkRuns).values({
        id: runId,
        scenarioId,
        status: 'queued',
        modelName,
        modelBackend,
        modelEndpoint: modelEndpoint ?? null,
        configHash,
        agentAssignment,
        triggeredBy,
        callbackUrl: callbackUrl ?? null,
      });

      const jobData: RunConfig = {
        runId,
        scenarioId,
        modelName,
        modelBackend,
        modelEndpoint,
        configHash,
        agentAssignment,
        callbackUrl,
        triggeredBy,
      };
      await benchmarkQueue.add(jobData);
    }

    res.status(201).json({
      success: true,
      data: { runIds, totalRuns: runCount },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/benchmark/results/:runId — fetch results for a run (public) */
router.get('/benchmark/results/:runId', async (req, res, next) => {
  try {
    const [run] = await db
      .select()
      .from(benchmarkRuns)
      .where(eq(benchmarkRuns.id, req.params.runId));

    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }

    res.json({ success: true, data: { run } });
  } catch (error) {
    next(error);
  }
});

/* GET /api/benchmark/runs — list runs with filters (public) */
router.get('/benchmark/runs', async (req, res, next) => {
  try {
    const {
      scenarioId,
      modelName,
      status,
      limit: rawLimit,
      offset: rawOffset,
    } = req.query as {
      scenarioId?: string;
      modelName?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };

    const limit = Math.min(Math.max(1, Number(rawLimit) || 20), 100);
    const offset = Math.max(0, Number(rawOffset) || 0);

    // Build where conditions
    const conditions = [];
    if (scenarioId) conditions.push(eq(benchmarkRuns.scenarioId, scenarioId));
    if (modelName) conditions.push(eq(benchmarkRuns.modelName, modelName));
    if (status) conditions.push(eq(benchmarkRuns.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [runs, totalResult] = await Promise.all([
      db
        .select()
        .from(benchmarkRuns)
        .where(whereClause)
        .orderBy(desc(benchmarkRuns.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(benchmarkRuns)
        .where(whereClause),
    ]);

    res.json({
      success: true,
      data: { runs, total: totalResult[0]?.total ?? 0 },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/benchmark/runs/:runId/export — export raw data as JSON (public) */
router.get('/benchmark/runs/:runId/export', async (req, res, next) => {
  try {
    const [run] = await db
      .select({
        id: benchmarkRuns.id,
        rawData: benchmarkRuns.rawData,
        scenarioId: benchmarkRuns.scenarioId,
        modelName: benchmarkRuns.modelName,
      })
      .from(benchmarkRuns)
      .where(eq(benchmarkRuns.id, req.params.runId));

    if (!run || !run.rawData) {
      res.status(404).json({
        success: false,
        error: run ? 'No raw data available for this run' : 'Run not found',
      });
      return;
    }

    const filename = `benchmark-${run.scenarioId}-${run.modelName}-${run.id}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(run.rawData, null, 2));
  } catch (error) {
    next(error);
  }
});

/* GET /api/benchmark/leaderboard — model rankings (public) */
router.get('/benchmark/leaderboard', async (req, res, next) => {
  try {
    const { scenarioId } = req.query as { scenarioId?: string };

    const conditions = [eq(benchmarkRuns.status, 'completed')];
    if (scenarioId) conditions.push(eq(benchmarkRuns.scenarioId, scenarioId));

    const whereClause = and(...conditions);

    const rows = await db
      .select({
        modelName: benchmarkRuns.modelName,
        avgComposite: sql<number>`AVG(CAST(${benchmarkRuns.metricsReport}->>'composite' AS FLOAT))`,
        bestGrade: sql<string>`MODE() WITHIN GROUP (ORDER BY ${benchmarkRuns.metricsReport}->>'grade')`,
        totalRuns: count(),
        avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${benchmarkRuns.completedAt} - ${benchmarkRuns.startedAt})))`,
      })
      .from(benchmarkRuns)
      .where(whereClause)
      .groupBy(benchmarkRuns.modelName)
      .orderBy(sql`AVG(CAST(${benchmarkRuns.metricsReport}->>'composite' AS FLOAT)) DESC`);

    const leaderboard = rows.map((row, idx) => ({
      rank: idx + 1,
      modelName: row.modelName,
      avgComposite: row.avgComposite != null ? Number(Number(row.avgComposite).toFixed(4)) : null,
      bestGrade: row.bestGrade,
      totalRuns: row.totalRuns,
      avgDurationSeconds: row.avgDuration != null ? Number(Number(row.avgDuration).toFixed(2)) : null,
    }));

    res.json({ success: true, data: { leaderboard } });
  } catch (error) {
    next(error);
  }
});

export default router;
