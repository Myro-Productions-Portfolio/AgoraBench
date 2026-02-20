import { Router } from 'express';
import { db } from '@db/connection';
import { agents, parties, elections } from '@db/schema/index';
import { bills } from '@db/schema/legislation';
import { ilike, or } from 'drizzle-orm';

const router = Router();

/* GET /api/search?q=...&types=agent,bill,party,election&limit=5 */
router.get('/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    if (q.length < 2) {
      return res.json({ success: true, data: { agents: [], bills: [], parties: [], elections: [] } });
    }

    const requestedTypes =
      typeof req.query.types === 'string'
        ? req.query.types.split(',')
        : ['agent', 'bill', 'party', 'election'];

    const limit = 5;
    const pattern = `%${q}%`;

    const [agentResults, billResults, partyResults, electionResults] = await Promise.all([
      requestedTypes.includes('agent')
        ? db
            .select({
              id: agents.id,
              displayName: agents.displayName,
              name: agents.name,
              alignment: agents.alignment,
              avatarUrl: agents.avatarUrl,
            })
            .from(agents)
            .where(
              or(
                ilike(agents.displayName, pattern),
                ilike(agents.name, pattern),
                ilike(agents.bio, pattern),
                ilike(agents.alignment, pattern),
              ),
            )
            .limit(limit)
        : Promise.resolve([]),

      requestedTypes.includes('bill')
        ? db
            .select({
              id: bills.id,
              title: bills.title,
              summary: bills.summary,
              status: bills.status,
              committee: bills.committee,
            })
            .from(bills)
            .where(or(ilike(bills.title, pattern), ilike(bills.summary, pattern)))
            .limit(limit)
        : Promise.resolve([]),

      requestedTypes.includes('party')
        ? db
            .select({
              id: parties.id,
              name: parties.name,
              abbreviation: parties.abbreviation,
              alignment: parties.alignment,
              description: parties.description,
            })
            .from(parties)
            .where(
              or(
                ilike(parties.name, pattern),
                ilike(parties.abbreviation, pattern),
                ilike(parties.description, pattern),
                ilike(parties.alignment, pattern),
              ),
            )
            .limit(limit)
        : Promise.resolve([]),

      requestedTypes.includes('election')
        ? db
            .select({
              id: elections.id,
              positionType: elections.positionType,
              status: elections.status,
              scheduledDate: elections.scheduledDate,
            })
            .from(elections)
            .where(ilike(elections.positionType, pattern))
            .limit(limit)
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: {
        agents: agentResults,
        bills: billResults,
        parties: partyResults,
        elections: electionResults,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
