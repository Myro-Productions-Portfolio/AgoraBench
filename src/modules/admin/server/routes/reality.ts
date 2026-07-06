import { Router } from 'express';
import { db } from '@db/connection';
import { realitySnapshots } from '@db/schema/index';
import { sql } from 'drizzle-orm';
import { requireOwner } from '@core/server/middleware/auth.js';

const router = Router();

/* All /admin/reality/* routes are owner-only (CLAUDE.md rule 3: auth on the
   router, not individual routes). Read-only visibility into the divergence
   experiment's reality reference pool -- no config surface here, no UI yet
   (later slice); this just lets the owner confirm the puller is working. */
router.use('/admin/reality', requireOwner);

/* GET /api/admin/reality/status — row counts + latest record_date by source */
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

    res.json({ success: true, data: { bySource } });
  } catch (error) {
    next(error);
  }
});

export default router;
