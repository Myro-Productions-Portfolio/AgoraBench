import { Router } from 'express';
import { db } from '@db/connection';
import { activityEvents } from '@db/schema/index';
import { paginationSchema } from '@shared/validation';
import { desc, eq, gte, and } from 'drizzle-orm';

const router = Router();

/* GET /api/activity -- List recent activity (optionally filtered by agentId) */
router.get('/activity', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const offset = (page - 1) * limit;
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    const sinceMs = typeof req.query.since === 'string' ? Number(req.query.since) : undefined;
    const sinceDate = sinceMs && !isNaN(sinceMs) ? new Date(sinceMs) : undefined;

    const whereClause = (() => {
      const conditions = [];
      if (agentId) conditions.push(eq(activityEvents.agentId, agentId));
      if (sinceDate) conditions.push(gte(activityEvents.createdAt, sinceDate));
      if (conditions.length === 0) return undefined;
      if (conditions.length === 1) return conditions[0];
      return and(...conditions);
    })();

    const query = db
      .select()
      .from(activityEvents)
      .orderBy(desc(activityEvents.createdAt))
      .limit(limit)
      .offset(offset);

    const results = whereClause
      ? await query.where(whereClause)
      : await query;

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
});

export default router;
