import { Router } from 'express';
import { db } from '@db/connection';
import { agentStatements, agents } from '@db/schema/index';
import { eq, desc, and, sql } from 'drizzle-orm';

const router = Router();

/* GET /api/press -- Public press room: all agent statements with optional filters */
router.get('/press', async (req, res, next) => {
  try {
    const agentFilter = typeof req.query.agent === 'string' ? req.query.agent : undefined;
    const triggerTypeFilter = typeof req.query.triggerType === 'string' ? req.query.triggerType : undefined;
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
    const rawOffset = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 50 : rawLimit, 100);
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const conditions = [];
    if (agentFilter) conditions.push(eq(agentStatements.agentId, agentFilter));
    if (triggerTypeFilter) conditions.push(eq(agentStatements.triggerType, triggerTypeFilter));
    const whereClause = conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

    const [rows, [countRow]] = await Promise.all([
      (whereClause
        ? db
            .select({
              id: agentStatements.id,
              agentId: agentStatements.agentId,
              agentName: agents.displayName,
              statementText: agentStatements.statementText,
              triggerType: agentStatements.triggerType,
              triggerBillId: agentStatements.triggerBillId,
              triggerElectionId: agentStatements.triggerElectionId,
              triggerDealId: agentStatements.triggerDealId,
              approvalDelta: agentStatements.approvalDelta,
              isPublic: agentStatements.isPublic,
              createdAt: agentStatements.createdAt,
            })
            .from(agentStatements)
            .innerJoin(agents, eq(agentStatements.agentId, agents.id))
            .where(whereClause)
            .orderBy(desc(agentStatements.createdAt))
            .limit(limit)
            .offset(offset)
        : db
            .select({
              id: agentStatements.id,
              agentId: agentStatements.agentId,
              agentName: agents.displayName,
              statementText: agentStatements.statementText,
              triggerType: agentStatements.triggerType,
              triggerBillId: agentStatements.triggerBillId,
              triggerElectionId: agentStatements.triggerElectionId,
              triggerDealId: agentStatements.triggerDealId,
              approvalDelta: agentStatements.approvalDelta,
              isPublic: agentStatements.isPublic,
              createdAt: agentStatements.createdAt,
            })
            .from(agentStatements)
            .innerJoin(agents, eq(agentStatements.agentId, agents.id))
            .orderBy(desc(agentStatements.createdAt))
            .limit(limit)
            .offset(offset)
      ),
      (whereClause
        ? db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(agentStatements)
            .where(whereClause)
        : db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(agentStatements)
      ),
    ]);

    res.json({ success: true, data: { statements: rows, total: countRow?.count ?? 0 } });
  } catch (error) {
    next(error);
  }
});

export default router;
