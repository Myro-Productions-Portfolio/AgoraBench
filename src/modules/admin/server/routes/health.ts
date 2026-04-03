import { Router } from 'express';
import { db } from '@db/connection';
import { tickLog, agentDecisions } from '@db/schema/index';
import { desc, sql, gte, eq, and } from 'drizzle-orm';

const router = Router();

/* GET /api/admin/health/ticks — recent tick durations */
router.get('/admin/health/ticks', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const ticks = await db
      .select({
        id: tickLog.id,
        firedAt: tickLog.firedAt,
        completedAt: tickLog.completedAt,
      })
      .from(tickLog)
      .where(sql`${tickLog.completedAt} IS NOT NULL`)
      .orderBy(desc(tickLog.firedAt))
      .limit(limit);

    const data = ticks.map((t) => ({
      id: t.id,
      firedAt: t.firedAt,
      completedAt: t.completedAt,
      durationMs: t.completedAt && t.firedAt
        ? new Date(t.completedAt).getTime() - new Date(t.firedAt).getTime()
        : null,
    }));

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/health/latency — LLM latency stats */
router.get('/admin/health/latency', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const recent = await db
      .select({
        provider: agentDecisions.provider,
        phase: agentDecisions.phase,
        latencyMs: agentDecisions.latencyMs,
        success: agentDecisions.success,
      })
      .from(agentDecisions)
      .where(sql`${agentDecisions.latencyMs} IS NOT NULL`)
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit);

    const latencies = recent.filter((r) => r.latencyMs != null).map((r) => r.latencyMs!);
    latencies.sort((a, b) => a - b);

    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const idx = Math.ceil(arr.length * p / 100) - 1;
      return arr[Math.max(0, idx)];
    };

    const byProvider: Record<string, { avg: number; count: number }> = {};
    for (const r of recent) {
      const p = r.provider ?? 'unknown';
      if (!byProvider[p]) byProvider[p] = { avg: 0, count: 0 };
      byProvider[p].count++;
      byProvider[p].avg += (r.latencyMs ?? 0);
    }
    for (const p of Object.keys(byProvider)) {
      byProvider[p].avg = Math.round(byProvider[p].avg / byProvider[p].count);
    }

    const byPhase: Record<string, { avg: number; count: number }> = {};
    for (const r of recent) {
      const ph = r.phase ?? 'unknown';
      if (!byPhase[ph]) byPhase[ph] = { avg: 0, count: 0 };
      byPhase[ph].count++;
      byPhase[ph].avg += (r.latencyMs ?? 0);
    }
    for (const ph of Object.keys(byPhase)) {
      byPhase[ph].avg = Math.round(byPhase[ph].avg / byPhase[ph].count);
    }

    res.json({
      success: true,
      data: {
        avg: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        count: latencies.length,
        byProvider,
        byPhase,
        recent: latencies.slice(0, 20),
      },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/health/errors — error rate stats */
router.get('/admin/health/errors', async (req, res, next) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 24, 168);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [totalRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(agentDecisions)
      .where(gte(agentDecisions.createdAt, since));

    const [errorRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(agentDecisions)
      .where(and(gte(agentDecisions.createdAt, since), eq(agentDecisions.success, false)));

    const total = Number(totalRow?.count ?? 0);
    const errors = Number(errorRow?.count ?? 0);

    const byPhase = await db
      .select({
        phase: agentDecisions.phase,
        count: sql<number>`COUNT(*)`,
      })
      .from(agentDecisions)
      .where(and(gte(agentDecisions.createdAt, since), eq(agentDecisions.success, false)))
      .groupBy(agentDecisions.phase);

    const byPhaseMap: Record<string, number> = {};
    for (const row of byPhase) {
      byPhaseMap[row.phase ?? 'unknown'] = Number(row.count);
    }

    res.json({
      success: true,
      data: {
        total,
        errors,
        rate: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0,
        hours,
        byPhase: byPhaseMap,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
