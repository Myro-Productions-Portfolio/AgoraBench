import { Router } from 'express';
import { db } from '@db/connection';
import { tickLog, agentDecisions, activityEvents, billVotes, aggeInterventions } from '@db/schema/index';
import { desc, isNotNull, and, gte, lte, sql, eq } from 'drizzle-orm';
import { forumThreads } from '@modules/forum/db/schema/forumThreads';
import { agentMessages } from '@modules/forum/db/schema/agentMessages';

const router = Router();

/* GET /api/ticks?limit=5 -- List recent completed ticks */
router.get('/ticks', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '5'), 10) || 5, 20);
    const ticks = await db
      .select()
      .from(tickLog)
      .where(isNotNull(tickLog.completedAt))
      .orderBy(desc(tickLog.firedAt))
      .limit(limit);
    res.json({ success: true, data: ticks });
  } catch (error) {
    next(error);
  }
});

/* GET /api/ticks/:id/summary -- Breakdown of a single tick */
router.get('/ticks/:id/summary', async (req, res, next) => {
  try {
    const tickId = req.params.id;

    // Fetch the tick itself
    const [tick] = await db
      .select()
      .from(tickLog)
      .where(eq(tickLog.id, tickId))
      .limit(1);

    if (!tick) {
      res.status(404).json({ success: false, error: 'Tick not found' });
      return;
    }

    const firedAt = new Date(tick.firedAt);
    const completedAt = tick.completedAt ? new Date(tick.completedAt) : null;
    const durationMs = completedAt
      ? completedAt.getTime() - firedAt.getTime()
      : null;

    const timeWindow = and(
      gte(agentDecisions.createdAt, firedAt),
      completedAt
        ? lte(agentDecisions.createdAt, completedAt)
        : sql`true`,
    );

    // Decisions grouped by phase
    const phaseRows = await db
      .select({
        phase: agentDecisions.phase,
        count: sql<number>`COUNT(*)`,
      })
      .from(agentDecisions)
      .where(timeWindow)
      .groupBy(agentDecisions.phase);

    const decisionsByPhase: Record<string, number> = {};
    let totalDecisions = 0;
    for (const row of phaseRows) {
      const key = row.phase ?? 'unknown';
      const count = Number(row.count);
      decisionsByPhase[key] = count;
      totalDecisions += count;
    }

    // Activity event window
    const activityWindow = and(
      gte(activityEvents.createdAt, firedAt),
      completedAt
        ? lte(activityEvents.createdAt, completedAt)
        : sql`true`,
    );

    // Activity events grouped by type
    const activityRows = await db
      .select({
        type: activityEvents.type,
        count: sql<number>`COUNT(*)`,
      })
      .from(activityEvents)
      .where(activityWindow)
      .groupBy(activityEvents.type);

    const eventsByType: Record<string, number> = {};
    for (const row of activityRows) {
      eventsByType[row.type] = Number(row.count);
    }

    // Votes cast in this window
    const voteWindow = and(
      gte(billVotes.castAt, firedAt),
      completedAt ? lte(billVotes.castAt, completedAt) : sql`true`,
    );
    const [voteRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(billVotes)
      .where(voteWindow);
    const votesCast = Number(voteRow?.count ?? 0);

    // Forum threads created in this window
    const threadWindow = and(
      gte(forumThreads.createdAt, firedAt),
      completedAt ? lte(forumThreads.createdAt, completedAt) : sql`true`,
    );
    const [threadRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(forumThreads)
      .where(threadWindow);
    const forumThreadsCreated = Number(threadRow?.count ?? 0);

    // Forum messages (posts/replies) in this window
    const msgWindow = and(
      gte(agentMessages.createdAt, firedAt),
      completedAt ? lte(agentMessages.createdAt, completedAt) : sql`true`,
    );
    const [msgRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(agentMessages)
      .where(msgWindow);
    const forumMessages = Number(msgRow?.count ?? 0);

    // AGGE interventions in this window
    const aggeWindow = and(
      gte(aggeInterventions.createdAt, firedAt),
      completedAt ? lte(aggeInterventions.createdAt, completedAt) : sql`true`,
    );
    const [aggeRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(aggeInterventions)
      .where(aggeWindow);
    const interventions = Number(aggeRow?.count ?? 0);

    res.json({
      success: true,
      data: {
        id: tick.id,
        firedAt: tick.firedAt,
        completedAt: tick.completedAt,
        durationMs,
        totalDecisions,
        decisionsByPhase,
        votesCast,
        forumThreadsCreated,
        forumMessages,
        interventions,
        eventsByType,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
