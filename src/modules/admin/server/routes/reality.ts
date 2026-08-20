import { Router } from 'express';
import { db } from '@db/connection';
import { realitySnapshots, metricSnapshots } from '@db/schema/index';
import { eq, sql } from 'drizzle-orm';
import { requireOwner } from '@core/server/middleware/auth.js';

const router = Router();

/* All /admin/reality/* routes are owner-only (CLAUDE.md rule 3: auth on the
   router, not individual routes). Read-only visibility into the divergence
   experiment's reality reference pool -- no config surface here, no UI yet
   (later slice); this just lets the owner confirm the puller is working. */
router.use('/admin/reality', requireOwner);

/* GET /api/admin/reality/status — row counts + latest record_date by source,
   plus the scoreboard's reality-side metric ages (E4 slice 2: the approval
   scrape's staleness alarm surfaces here as ageHours on approval_trend). */
router.get('/admin/reality/status', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        source: realitySnapshots.source,
        count: sql<number>`COUNT(*)`,
        latestRecordDate: sql<string | null>`MAX(${realitySnapshots.recordDate})`,
      })
      .from(realitySnapshots)
      .groupBy(realitySnapshots.source);

    const bySource = rows.map((r) => ({
      source: r.source,
      count: Number(r.count),
      latestRecordDate: r.latestRecordDate,
    }));

    const metricRows = await db
      .select({
        metricKey: metricSnapshots.metricKey,
        count: sql<number>`COUNT(*)`,
        latestAtDate: sql<string | null>`MAX(${metricSnapshots.atDate})`,
        latestWriteAt: sql<string | null>`MAX(${metricSnapshots.createdAt})`,
      })
      .from(metricSnapshots)
      .where(eq(metricSnapshots.side, 'reality'))
      .groupBy(metricSnapshots.metricKey);

    const scoreboardReality = metricRows.map((r) => {
      const latestWriteMs = r.latestWriteAt ? new Date(r.latestWriteAt).getTime() : NaN;
      return {
        metricKey: r.metricKey,
        count: Number(r.count),
        latestAtDate: r.latestAtDate,
        ageHours: Number.isFinite(latestWriteMs) ? Math.round((Date.now() - latestWriteMs) / 3_600_000) : null,
      };
    });

    res.json({ success: true, data: { bySource, scoreboardReality } });
  } catch (error) {
    next(error);
  }
});

export default router;
