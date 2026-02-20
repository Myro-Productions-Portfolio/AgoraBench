import { Router } from 'express';
import { db } from '@db/connection';
import {
  agents,
  partyMemberships,
  positions,
  bills,
  billVotes,
  campaigns,
  elections,
  activityEvents,
  agentDecisions,
  transactions,
  agentMessages,
  forumThreads,
  approvalEvents,
  parties,
} from '@db/schema/index';
import { AppError } from '@core/server/middleware/errorHandler';
import { requireAuth } from '@core/server/middleware/auth.js';
import { eq, desc, or, and, isNotNull } from 'drizzle-orm';

const router = Router();

/* GET /api/agents/:id/profile -- Comprehensive profile data in one call */
router.get('/agents/:id/profile', async (req, res, next) => {
  try {
    const { id } = req.params;

    /* Base agent */
    const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (!agent) {
      throw new AppError(404, 'Agent not found');
    }

    /* Party membership */
    const [membership] = await db
      .select()
      .from(partyMemberships)
      .where(eq(partyMemberships.agentId, id))
      .limit(1);

    let party: { id: string; name: string; abbreviation: string; alignment: string } | null = null;
    let partyRole: string | null = null;
    if (membership) {
      const [partyRow] = await db
        .select({ id: parties.id, name: parties.name, abbreviation: parties.abbreviation, alignment: parties.alignment })
        .from(parties)
        .where(eq(parties.id, membership.partyId))
        .limit(1);
      if (partyRow) {
        party = partyRow;
        partyRole = membership.role;
      }
    }

    /* Current + past positions */
    const agentPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.agentId, id));

    /* Bills sponsored */
    const sponsoredBills = await db
      .select()
      .from(bills)
      .where(eq(bills.sponsorId, id));

    /* Bill votes cast by this agent (join bills for titles) */
    const billVoteRecords = await db
      .select({
        id: billVotes.id,
        choice: billVotes.choice,
        castAt: billVotes.castAt,
        billId: bills.id,
        billTitle: bills.title,
        billStatus: bills.status,
      })
      .from(billVotes)
      .innerJoin(bills, eq(billVotes.billId, bills.id))
      .where(eq(billVotes.voterId, id));

    /* Campaigns (join elections for type/status) */
    const agentCampaigns = await db
      .select({
        id: campaigns.id,
        platform: campaigns.platform,
        status: campaigns.status,
        contributions: campaigns.contributions,
        endorsements: campaigns.endorsements,
        startDate: campaigns.startDate,
        endDate: campaigns.endDate,
        electionId: elections.id,
        positionType: elections.positionType,
        electionStatus: elections.status,
        winnerId: elections.winnerId,
        totalVotes: elections.totalVotes,
        certifiedDate: elections.certifiedDate,
      })
      .from(campaigns)
      .innerJoin(elections, eq(campaigns.electionId, elections.id))
      .where(eq(campaigns.agentId, id));

    /* Recent activity events */
    const recentActivity = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.agentId, id))
      .orderBy(desc(activityEvents.createdAt))
      .limit(15);

    /* Latest AI decision (for "recent statement") */
    const [latestDecisionRow] = await db
      .select()
      .from(agentDecisions)
      .where(and(eq(agentDecisions.agentId, id), isNotNull(agentDecisions.parsedReasoning)))
      .orderBy(desc(agentDecisions.createdAt))
      .limit(1);

    const latestStatement = latestDecisionRow
      ? {
          reasoning: latestDecisionRow.parsedReasoning ?? '',
          phase: latestDecisionRow.phase ?? '',
          createdAt: latestDecisionRow.createdAt.toISOString(),
        }
      : null;

    /* Forum posts authored by this agent */
    const recentForumPosts = await db
      .select({
        id: agentMessages.id,
        body: agentMessages.body,
        threadId: agentMessages.threadId,
        threadTitle: forumThreads.title,
        threadCategory: forumThreads.category,
        createdAt: agentMessages.createdAt,
      })
      .from(agentMessages)
      .leftJoin(forumThreads, eq(agentMessages.threadId, forumThreads.id))
      .where(eq(agentMessages.fromAgentId, id))
      .orderBy(desc(agentMessages.createdAt))
      .limit(10);

    /* Recent transactions */
    const recentTransactions = await db
      .select()
      .from(transactions)
      .where(or(eq(transactions.fromAgentId, id), eq(transactions.toAgentId, id)))
      .orderBy(desc(transactions.createdAt))
      .limit(10);

    /* Recent approval events */
    const recentApprovalEvents = await db
      .select()
      .from(approvalEvents)
      .where(eq(approvalEvents.agentId, id))
      .orderBy(desc(approvalEvents.createdAt))
      .limit(10);

    /* Compute stats */
    const stats = {
      /* Legislative */
      totalBillsSponsored: sponsoredBills.length,
      billsEnactedToLaw: sponsoredBills.filter((b) => b.status === 'law').length,
      billsPassed: sponsoredBills.filter((b) => ['passed', 'law'].includes(b.status)).length,
      votesCast: billVoteRecords.length,
      votesYea: billVoteRecords.filter((v) => v.choice === 'yea').length,
      votesNay: billVoteRecords.filter((v) => v.choice === 'nay').length,
      votesAbstain: billVoteRecords.filter((v) => v.choice === 'abstain').length,
      /* Elections */
      electionsEntered: agentCampaigns.length,
      electionsWon: agentCampaigns.filter((c) => c.winnerId === id).length,
      totalContributionsRaised: agentCampaigns.reduce((s, c) => s + c.contributions, 0),
      totalEndorsementsReceived: agentCampaigns.reduce((s, c) => {
        try {
          return s + (JSON.parse(c.endorsements) as string[]).length;
        } catch {
          return s;
        }
      }, 0),
      /* Economy */
      currentBalance: agent.balance,
      reputation: agent.reputation,
      /* Forum */
      forumPostCount: recentForumPosts.length,
      /* Approval */
      approvalRating: agent.approvalRating,
    };

    res.json({
      success: true,
      data: {
        agent,
        party,
        partyRole,
        positions: agentPositions,
        sponsoredBills,
        billVotes: billVoteRecords,
        campaigns: agentCampaigns,
        recentActivity,
        latestStatement,
        recentTransactions,
        recentForumPosts: recentForumPosts.map((p) => ({
          ...p,
          createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
        })),
        recentApprovalEvents,
        stats,
      },
    });
  } catch (error) {
    next(error);
  }
});

/* PUT /api/agents/:id/customize -- Update avatar config */
router.put('/agents/:id/customize', requireAuth, async (req, res, next) => {
  try {
    const agentId = req.params['id'] as string;
    const { avatarConfig } = req.body as { avatarConfig?: string };

    if (!avatarConfig) {
      throw new AppError(400, 'avatarConfig is required');
    }

    /* Validate it's valid JSON */
    try {
      JSON.parse(avatarConfig);
    } catch {
      throw new AppError(400, 'avatarConfig must be valid JSON');
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!agent) {
      throw new AppError(404, 'Agent not found');
    }

    /* Allow agent owner or site owner */
    if (agent.ownerUserId !== req.user!.id && req.user!.role !== 'owner') {
      throw new AppError(403, 'Not authorized to customize this agent');
    }

    const [updated] = await db
      .update(agents)
      .set({ avatarConfig })
      .where(eq(agents.id, agentId))
      .returning();

    res.json({ success: true, data: updated, message: 'Avatar updated' });
  } catch (error) {
    next(error);
  }
});

export default router;
