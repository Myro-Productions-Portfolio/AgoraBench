import { Router } from 'express';
import { db } from '@db/connection';
import { agentDecisions, agents, tickLog } from '@db/schema/index';
import { paginationSchema } from '@shared/validation';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

const decisionsQuerySchema = paginationSchema.extend({
  agentId: z.string().uuid().optional(),
  phase: z.string().optional(),
  success: z.enum(['true', 'false']).optional(),
  tickId: z.string().uuid().optional(),
});

/* GET /api/decisions -- List AI decision log with optional filters */
router.get('/decisions', async (req, res, next) => {
  try {
    const { page, limit, agentId, phase, success, tickId } = decisionsQuerySchema.parse(req.query);
    const offset = (page - 1) * limit;

    /* Look up tick time boundaries when filtering by tickId */
    let tickBounds: { firedAt: Date; completedAt: Date | null } | null = null;
    if (tickId) {
      const [tick] = await db.select().from(tickLog).where(eq(tickLog.id, tickId)).limit(1);
      if (!tick) {
        res.status(404).json({ success: false, error: 'Tick not found' });
        return;
      }
      tickBounds = tick;
    }

    /* Build conditions array */
    const conditions: SQL[] = [];
    if (agentId) conditions.push(eq(agentDecisions.agentId, agentId));
    if (phase) conditions.push(eq(agentDecisions.phase, phase));
    if (success !== undefined) conditions.push(eq(agentDecisions.success, success === 'true'));
    if (tickBounds) {
      conditions.push(gte(agentDecisions.createdAt, tickBounds.firedAt));
      if (tickBounds.completedAt) {
        conditions.push(lte(agentDecisions.createdAt, tickBounds.completedAt));
      }
    }

    let query = db
      .select({
        id: agentDecisions.id,
        agentId: agentDecisions.agentId,
        agentName: agents.displayName,
        alignment: agents.alignment,
        provider: agentDecisions.provider,
        phase: agentDecisions.phase,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
        createdAt: agentDecisions.createdAt,
      })
      .from(agentDecisions)
      .leftJoin(agents, eq(agentDecisions.agentId, agents.id))
      .$dynamic();

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const results = await query.orderBy(desc(agentDecisions.createdAt)).limit(limit).offset(offset);

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
});

/* GET /api/decisions/:id -- Full detail for one decision including raw response */
router.get('/decisions/:id', async (req, res, next) => {
  try {
    const [row] = await db
      .select({
        id: agentDecisions.id,
        agentId: agentDecisions.agentId,
        agentName: agents.displayName,
        provider: agentDecisions.provider,
        phase: agentDecisions.phase,
        contextMessage: agentDecisions.contextMessage,
        rawResponse: agentDecisions.rawResponse,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
        createdAt: agentDecisions.createdAt,
      })
      .from(agentDecisions)
      .leftJoin(agents, eq(agentDecisions.agentId, agents.id))
      .where(eq(agentDecisions.id, req.params.id));

    if (!row) {
      res.status(404).json({ success: false, error: 'Decision not found' });
      return;
    }

    res.json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
});

export default router;
