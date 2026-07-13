import { Router } from 'express';
import { db } from '@db/connection';
import { worldEvents } from '@db/schema/index';
import { desc, sql, eq, and, gte } from 'drizzle-orm';
import { isStateFips } from '@modules/world/server/lib/worldSeverity';
import { getRuntimeConfig } from '@core/server/runtimeConfig';

const router = Router();

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface StateAgg { fips: string; count: number; maxSeverity: number; topCategory: string; }
interface AggRow { location: string | null; count: number; maxSeverity: number; topCategory: string; }

export function splitStateAggregates(rows: AggRow[]) {
  const states: StateAgg[] = [];
  const coastal: StateAgg[] = [];
  for (const r of rows) {
    if (r.location == null) continue;
    const agg: StateAgg = { fips: r.location, count: Number(r.count), maxSeverity: Number(r.maxSeverity), topCategory: r.topCategory };
    (isStateFips(r.location) ? states : coastal).push(agg);
  }
  return {
    states, coastal,
    nationwide: {
      totalAlerts: states.reduce((a, s) => a + s.count, 0),
      statesWithAlerts: states.length,
    },
  };
}

const ALLOWED_CATEGORIES = new Set(['all', 'weather', 'disaster', 'earthquake', 'news', 'market']);

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

    const stateParam = typeof req.query.state === 'string' && /^[0-9]{2}$/.test(req.query.state)
      ? req.query.state : null;
    const whereState = stateParam ? eq(worldEvents.location, stateParam) : sql`TRUE`;

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
        .where(whereState)
        .orderBy(desc(worldEvents.occurredAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`COUNT(*)` }).from(worldEvents).where(whereState),
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

/* GET /api/world/state-summary -- per-state aggregate for the choropleth map.
   Public, read-only, same posture as GET /world/events: no auth gate, nothing
   here mutates state or feeds prompt-building/tick phases. */
router.get('/world/state-summary', async (req, res, next) => {
  try {
    const catParam = String(req.query.category ?? 'all');
    const category = ALLOWED_CATEGORIES.has(catParam) ? catParam : 'all';
    const whereCat = category === 'all' ? sql`TRUE` : sql`category = ${category}`;
    const windowHours = getRuntimeConfig().worldMapRecencyHours;
    const since = new Date(Date.now() - windowHours * 3_600_000);
    const rows = await db
      .select({
        location: worldEvents.location,
        count: sql<number>`COUNT(*)`,
        maxSeverity: sql<number>`MAX(${worldEvents.severity})`,
        topCategory: sql<string>`MODE() WITHIN GROUP (ORDER BY ${worldEvents.category})`,
      })
      .from(worldEvents)
      .where(and(gte(worldEvents.occurredAt, since), whereCat))
      .groupBy(worldEvents.location);
    res.json({ success: true, data: { ...splitStateAggregates(rows as AggRow[]), windowHours } });
  } catch (error) {
    next(error);
  }
});

export default router;
