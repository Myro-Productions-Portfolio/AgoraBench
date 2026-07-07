import { Router } from 'express';
import { db } from '@db/connection';
import { worldEvents } from '@db/schema/index';
import { desc, sql } from 'drizzle-orm';

const router = Router();

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/* GET /api/world/events -- exogenous world-events feed, E2 slice 1
   (docs/specs/exogenous-reality-feed.md). Public, read-only, same posture as
   GET /government/budget and GET /divergence: no auth gate, nothing here
   mutates state. Spectator surface only -- this is NOT consumed by
   prompt-building or any tick phase. Paginated, newest occurredAt first. */
router.get('/world/events', async (req, res, next) => {
  try {
    const pageParam = Number.parseInt(String(req.query.page ?? '1'), 10);
    const limitParam = Number.parseInt(String(req.query.limit ?? String(DEFAULT_PAGE_SIZE)), 10);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;

    const [rows, [countRow]] = await Promise.all([
      db
        .select({
          id: worldEvents.id,
          source: worldEvents.source,
          externalId: worldEvents.externalId,
          occurredAt: worldEvents.occurredAt,
          category: worldEvents.category,
          severity: worldEvents.severity,
          title: worldEvents.title,
          summary: worldEvents.summary,
          location: worldEvents.location,
          status: worldEvents.status,
          exogeneityNote: worldEvents.exogeneityNote,
          fetchedAt: worldEvents.fetchedAt,
        })
        .from(worldEvents)
        .orderBy(desc(worldEvents.occurredAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)` }).from(worldEvents),
    ]);

    const total = Number(countRow?.count ?? 0);

    res.json({
      success: true,
      data: {
        events: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
