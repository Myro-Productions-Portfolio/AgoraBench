import { Router } from 'express';
import { db } from '@db/connection';
import { positions, agents, bills, parties, elections, laws, governmentSettings } from '@db/schema/index';
import { eq } from 'drizzle-orm';

const router = Router();

/* GET /api/government/officials -- Current office holders */
router.get('/government/officials', async (_req, res, next) => {
  try {
    const activePositions = await db
      .select()
      .from(positions)
      .where(eq(positions.isActive, true));

    /* Join with agent data */
    const officials = await Promise.all(
      activePositions.map(async (pos) => {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, pos.agentId))
          .limit(1);

        return {
          position: pos,
          agent: agent || null,
        };
      }),
    );

    res.json({ success: true, data: officials });
  } catch (error) {
    next(error);
  }
});

/* GET /api/government/overview -- Dashboard overview */
router.get('/government/overview', async (_req, res, next) => {
  try {
    const allPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.isActive, true));

    const president = allPositions.find((p) => p.type === 'president');
    let presidentAgent = null;

    if (president) {
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, president.agentId))
        .limit(1);
      presidentAgent = agent;
    }

    const allAgents = await db.select().from(agents);
    const allParties = await db.select().from(parties).where(eq(parties.isActive, true));
    const allLaws = await db.select().from(laws).where(eq(laws.isActive, true));
    const allElections = await db.select().from(elections);
    const activeBills = await db.select().from(bills).where(eq(bills.status, 'floor'));

    const congressMembers = allPositions.filter((p) => p.type === 'congress_member');
    const justices = allPositions.filter((p) => p.type === 'supreme_justice');

    /* Get real treasury balance */
    const [govSettings] = await db.select().from(governmentSettings).limit(1);
    const treasuryBalance = govSettings?.treasuryBalance ?? 50000;

    const overview = {
      executive: {
        president: presidentAgent,
        cabinet: allPositions
          .filter((p) => p.type === 'cabinet_secretary')
          .map((p) => ({
            position: p,
            agent: allAgents.find((a) => a.id === p.agentId) || null,
          })),
        termEndDate: president?.endDate || null,
      },
      legislative: {
        totalSeats: 50,
        filledSeats: congressMembers.length,
        activeBills: activeBills.length,
        pendingVotes: 0,
      },
      judicial: {
        supremeCourtJustices: justices.length,
        activeCases: 0,
      },
      stats: {
        totalAgents: allAgents.length,
        totalParties: allParties.length,
        totalLaws: allLaws.length,
        totalElections: allElections.length,
        treasuryBalance,
      },
    };

    res.json({ success: true, data: overview });
  } catch (error) {
    next(error);
  }
});

export default router;
