import { Router } from 'express';
import { db } from '@db/connection';
import { elections, agents, votes, campaigns, parties, partyMemberships } from '@db/schema/index';
import { AppError } from '@core/server/middleware/errorHandler';
import { eq, inArray } from 'drizzle-orm';

const router = Router();

/* GET /api/elections/active -- Returns active/upcoming elections */
router.get('/elections/active', async (_req, res, next) => {
  try {
    const results = await db
      .select()
      .from(elections)
      .where(
        inArray(elections.status, ['scheduled', 'registration', 'campaigning', 'voting', 'counting']),
      );

    const data = results.map((e) => ({
      id: e.id,
      title: `${e.positionType.charAt(0).toUpperCase() + e.positionType.slice(1).replace('_', ' ')} Election`,
      type: e.positionType,
      status: e.status,
      votingStartsAt: e.votingStartDate ?? null,
      votingEndsAt: e.votingEndDate ?? null,
      scheduledDate: e.scheduledDate,
      registrationDeadline: e.registrationDeadline,
    }));

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/* GET /api/elections/past -- Returns completed/certified elections */
router.get('/elections/past', async (_req, res, next) => {
  try {
    const results = await db
      .select()
      .from(elections)
      .where(eq(elections.status, 'certified'));

    const data = await Promise.all(
      results.map(async (e) => {
        let winnerName: string | null = null;
        if (e.winnerId) {
          const [winner] = await db
            .select({ displayName: agents.displayName })
            .from(agents)
            .where(eq(agents.id, e.winnerId))
            .limit(1);
          winnerName = winner?.displayName ?? null;
        }

        /* Compute vote counts for this election */
        const electionVotes = await db
          .select()
          .from(votes)
          .where(eq(votes.electionId, e.id));

        const winnerVotes = winnerName && e.winnerId
          ? electionVotes.filter((v) => v.candidateId === e.winnerId).length
          : 0;
        const votePercentage =
          e.totalVotes > 0 ? Math.round((winnerVotes / e.totalVotes) * 100) : 0;

        return {
          id: e.id,
          title: `${e.positionType.charAt(0).toUpperCase() + e.positionType.slice(1).replace('_', ' ')} Election`,
          type: e.positionType,
          status: e.status,
          winnerId: e.winnerId,
          winnerName,
          totalVotes: e.totalVotes,
          votePercentage,
          certifiedDate: e.certifiedDate,
          scheduledDate: e.scheduledDate,
        };
      }),
    );

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/* GET /api/elections/:id -- Single election detail (enriched) */
router.get('/elections/:id', async (req, res, next) => {
  try {
    const [election] = await db
      .select()
      .from(elections)
      .where(eq(elections.id, req.params.id))
      .limit(1);

    if (!election) throw new AppError(404, 'Election not found');

    const title = `${election.positionType.charAt(0).toUpperCase() + election.positionType.slice(1).replace(/_/g, ' ')} Election`;

    const [electionCampaigns, electionVotes] = await Promise.all([
      db
        .select({
          agentId: campaigns.agentId,
          platform: campaigns.platform,
          status: campaigns.status,
          contributions: campaigns.contributions,
          displayName: agents.displayName,
          avatarConfig: agents.avatarConfig,
          alignment: agents.alignment,
        })
        .from(campaigns)
        .innerJoin(agents, eq(campaigns.agentId, agents.id))
        .where(eq(campaigns.electionId, req.params.id)),
      db
        .select({
          voterId: votes.voterId,
          candidateId: votes.candidateId,
          castAt: votes.castAt,
          voterName: agents.displayName,
        })
        .from(votes)
        .innerJoin(agents, eq(votes.voterId, agents.id))
        .where(eq(votes.electionId, req.params.id)),
    ]);

    const candidateAgentIds = electionCampaigns.map((c) => c.agentId);
    const memberships =
      candidateAgentIds.length > 0
        ? await db
            .select({
              agentId: partyMemberships.agentId,
              partyName: parties.name,
              partyAbbreviation: parties.abbreviation,
            })
            .from(partyMemberships)
            .innerJoin(parties, eq(partyMemberships.partyId, parties.id))
            .where(inArray(partyMemberships.agentId, candidateAgentIds))
        : [];

    const partyByAgent: Record<string, { name: string; abbreviation: string }> = {};
    for (const m of memberships) {
      partyByAgent[m.agentId] = { name: m.partyName, abbreviation: m.partyAbbreviation };
    }

    const voteCounts: Record<string, number> = {};
    for (const v of electionVotes) {
      if (v.candidateId) voteCounts[v.candidateId] = (voteCounts[v.candidateId] ?? 0) + 1;
    }

    const candidates = electionCampaigns
      .map((c) => ({
        agentId: c.agentId,
        displayName: c.displayName,
        avatarConfig: c.avatarConfig,
        alignment: c.alignment,
        platform: c.platform,
        contributions: c.contributions,
        voteCount: voteCounts[c.agentId] ?? 0,
        votePercentage:
          election.totalVotes > 0
            ? Math.round(((voteCounts[c.agentId] ?? 0) / election.totalVotes) * 100)
            : 0,
        party: partyByAgent[c.agentId] ?? null,
        isWinner: c.agentId === election.winnerId,
      }))
      .sort((a, b) => b.voteCount - a.voteCount);

    const rollCall = electionVotes.map((v) => ({
      voterId: v.voterId,
      voterName: v.voterName,
      candidateId: v.candidateId,
      candidateName: candidates.find((c) => c.agentId === v.candidateId)?.displayName ?? null,
      castAt: v.castAt,
    }));

    res.json({
      success: true,
      data: {
        id: election.id,
        title,
        type: election.positionType,
        status: election.status,
        scheduledDate: election.scheduledDate,
        registrationDeadline: election.registrationDeadline,
        votingStartDate: election.votingStartDate,
        votingEndDate: election.votingEndDate,
        certifiedDate: election.certifiedDate,
        totalVotes: election.totalVotes,
        winnerId: election.winnerId,
        candidates,
        rollCall,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
