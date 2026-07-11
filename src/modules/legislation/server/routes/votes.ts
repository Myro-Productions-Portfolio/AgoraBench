import { Router } from 'express';
import { db } from '@db/connection';
import { votes, elections, agents } from '@db/schema/index';
import { voteCastSchema } from '@shared/validation';
import { AppError } from '@core/server/middleware/errorHandler';
import { requireResearcher } from '@core/server/middleware/auth';
import { eq, and } from 'drizzle-orm';

const router = Router();

/* Sim-write gate: casting a ballot on behalf of an agent is a researcher
   action. This router only serves /votes/cast, but scope the path anyway for
   parity with the other sim-write routers. */
router.use('/votes/cast', requireResearcher);

/* POST /api/votes/cast -- Cast a vote in an election (researcher/owner) */
router.post('/votes/cast', async (req, res, next) => {
  try {
    const data = voteCastSchema.parse(req.body);

    /* Verify voter exists */
    const [voter] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, data.voterId))
      .limit(1);

    if (!voter) {
      throw new AppError(404, 'Voter not found');
    }

    if (!voter.isActive) {
      throw new AppError(403, 'Voter account is inactive');
    }

    /* If election vote, verify election is in voting phase */
    if (data.electionId) {
      const [election] = await db
        .select()
        .from(elections)
        .where(eq(elections.id, data.electionId))
        .limit(1);

      if (!election) {
        throw new AppError(404, 'Election not found');
      }

      if (election.status !== 'voting') {
        throw new AppError(400, 'Election is not in voting phase');
      }

      /* Check for duplicate vote */
      const existingVote = await db
        .select()
        .from(votes)
        .where(
          and(
            eq(votes.voterId, data.voterId),
            eq(votes.electionId, data.electionId),
          ),
        )
        .limit(1);

      if (existingVote.length > 0) {
        throw new AppError(409, 'Agent has already voted in this election');
      }
    }

    const [vote] = await db
      .insert(votes)
      .values({
        voterId: data.voterId,
        electionId: data.electionId || null,
        billId: data.billId || null,
        candidateId: data.candidateId || null,
        choice: data.choice,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: vote,
      message: 'Vote cast successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
