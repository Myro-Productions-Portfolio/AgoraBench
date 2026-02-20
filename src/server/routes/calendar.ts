import { Router } from 'express';
import { db } from '@db/connection';
import { governmentEvents } from '@db/schema/governmentEvents';
import { agents } from '../../modules/agents/db/schema/agents';
import { elections, positions } from '@db/schema/index';
import { desc, eq, gte, lte, and, inArray } from 'drizzle-orm';

const router = Router();

/* GET /api/calendar -- All public events (future + recent 7 days) */
router.get('/calendar', async (_req, res, next) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    /* Government events from the new table */
    const govEvents = await db
      .select()
      .from(governmentEvents)
      .where(
        and(
          eq(governmentEvents.isPublic, true),
          gte(governmentEvents.scheduledAt, sevenDaysAgo),
          lte(governmentEvents.scheduledAt, thirtyDaysOut),
        ),
      )
      .orderBy(desc(governmentEvents.scheduledAt));

    /* Legacy: upcoming elections */
    const upcomingElections = await db
      .select()
      .from(elections)
      .where(inArray(elections.status, ['scheduled', 'registration', 'campaigning', 'voting']));

    /* Legacy: expiring positions */
    const expiringPositions = await db
      .select({ p: positions, a: agents })
      .from(positions)
      .innerJoin(agents, eq(agents.id, positions.agentId))
      .where(and(eq(positions.isActive, true), lte(positions.endDate, thirtyDaysOut)));

    /* Build legacy event objects for backward-compat with DashboardPage */
    const legacyEvents: Array<{ type: string; label: string; date: string; detail: string }> = [];

    for (const election of upcomingElections) {
      if (election.votingStartDate) {
        legacyEvents.push({
          type: 'election',
          label: `${election.positionType} election voting`,
          date: election.votingStartDate.toISOString(),
          detail: 'Voting opens',
        });
      }
      if (election.votingEndDate) {
        legacyEvents.push({
          type: 'election',
          label: `${election.positionType} election closes`,
          date: election.votingEndDate.toISOString(),
          detail: 'Voting closes',
        });
      }
    }

    for (const { p, a } of expiringPositions) {
      if (p.endDate) {
        legacyEvents.push({
          type: 'position_expiry',
          label: `${p.title} term ends`,
          date: p.endDate.toISOString(),
          detail: a.displayName,
        });
      }
    }

    legacyEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    res.json({
      success: true,
      data: {
        events: govEvents,
        legacy: legacyEvents,
      },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/calendar/events -- Just the government_events table */
router.get('/calendar/events', async (req, res, next) => {
  try {
    const now = new Date();
    const view = typeof req.query.view === 'string' ? req.query.view : 'upcoming';

    let query;
    if (view === 'past') {
      query = db
        .select()
        .from(governmentEvents)
        .where(and(eq(governmentEvents.isPublic, true), lte(governmentEvents.scheduledAt, now)))
        .orderBy(desc(governmentEvents.scheduledAt));
    } else {
      const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      query = db
        .select()
        .from(governmentEvents)
        .where(
          and(
            eq(governmentEvents.isPublic, true),
            gte(governmentEvents.scheduledAt, now),
            lte(governmentEvents.scheduledAt, thirtyDaysOut),
          ),
        )
        .orderBy(governmentEvents.scheduledAt);
    }

    const events = await query;
    res.json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
});

/* GET /api/calendar/events/:id */
router.get('/calendar/events/:id', async (req, res, next) => {
  try {
    const [event] = await db
      .select()
      .from(governmentEvents)
      .where(eq(governmentEvents.id, req.params.id))
      .limit(1);

    if (!event) {
      return res.status(404).json({ success: false, error: 'Event not found' });
    }
    res.json({ success: true, data: event });
  } catch (error) {
    next(error);
  }
});

export default router;
