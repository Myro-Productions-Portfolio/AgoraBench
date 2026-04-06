import { Router } from 'express';
import { db } from '@db/connection';
import { activityEvents, agents } from '@db/schema/index';
import { desc, eq, gte, and, sql } from 'drizzle-orm';

const router = Router();

/* GET /api/activity -- Activity feed with optional filters: agentId, since, type, limit, offset */
router.get('/activity', async (req, res, next) => {
  try {
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    const typeFilter = typeof req.query.type === 'string' ? req.query.type : undefined;
    const sinceMs = typeof req.query.since === 'string' ? Number(req.query.since) : undefined;
    const sinceDate = sinceMs && !isNaN(sinceMs) ? new Date(sinceMs) : undefined;

    /* Support both legacy paginationSchema-style (page/limit) and direct limit/offset */
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
    const rawOffset = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 100 : rawLimit, 200);
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const conditions = [];
    if (agentId) conditions.push(eq(activityEvents.agentId, agentId));
    if (typeFilter) conditions.push(eq(activityEvents.type, typeFilter));
    if (sinceDate) conditions.push(gte(activityEvents.createdAt, sinceDate));

    const whereClause = (() => {
      if (conditions.length === 0) return undefined;
      if (conditions.length === 1) return conditions[0];
      return and(...conditions);
    })();

    const selectFields = {
      id: activityEvents.id,
      type: activityEvents.type,
      agentId: activityEvents.agentId,
      agentName: agents.displayName,
      title: activityEvents.title,
      description: activityEvents.description,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
    };

    const [rows, [countRow]] = await Promise.all([
      (whereClause
        ? db
            .select(selectFields)
            .from(activityEvents)
            .leftJoin(agents, eq(activityEvents.agentId, agents.id))
            .where(whereClause)
            .orderBy(desc(activityEvents.createdAt))
            .limit(limit)
            .offset(offset)
        : db
            .select(selectFields)
            .from(activityEvents)
            .leftJoin(agents, eq(activityEvents.agentId, agents.id))
            .orderBy(desc(activityEvents.createdAt))
            .limit(limit)
            .offset(offset)
      ),
      (whereClause
        ? db.select({ count: sql<number>`COUNT(*)::int` }).from(activityEvents).where(whereClause)
        : db.select({ count: sql<number>`COUNT(*)::int` }).from(activityEvents)
      ),
    ]);

    res.json({ success: true, data: { events: rows, total: countRow?.count ?? 0 } });
  } catch (error) {
    next(error);
  }
});

export default router;
