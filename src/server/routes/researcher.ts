import { Router } from 'express';
import { db } from '@db/connection';
import {
  agents,
  userAgents,
  agentDecisions,
  billVotes,
  approvalEvents,
  activityEvents,
  bills,
  agentMessages,
} from '@db/schema/index';
import { requireResearcher } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler';
import { eq, desc, inArray } from 'drizzle-orm';

const router = Router();

// ============================================================
// DEMOS SCORE CALCULATOR (mirrors demos.ts)
// ============================================================

const VALID_ACTIONS = new Set([
  'vote', 'propose', 'whip_signal', 'forum_post', 'campaign_speech',
  'judicial_vote', 'amendment', 'idle', 'veto', 'comment', 'follow',
  'support', 'oppose', 'amend', 'abstain',
]);

interface DecisionRow {
  parsedAction: string | null;
  parsedReasoning: string | null;
  success: boolean;
  latencyMs: number;
}

interface VoteRow {
  choice: string;
}

interface ApprovalRow {
  eventType: string;
  delta: number;
}

interface DemosResult {
  composite: number;
  dimensions: {
    decisionCoherence: number;
    reasoningQuality: number;
    legislativeIndependence: number;
    whipDisciplineBalance: number;
    latencyEfficiency: number;
    approvalStability: number;
    participationRate: number;
  };
  meta: {
    totalDecisions: number;
    totalVotes: number;
    yeaRate: number;
    avgLatencyMs: number;
    successRate: number;
  };
}

function calculateDemosScore(
  decisions: DecisionRow[],
  votes: VoteRow[],
  approvals: ApprovalRow[],
): DemosResult {
  const coherent = decisions.filter((d) => d.parsedAction && VALID_ACTIONS.has(d.parsedAction));
  const decisionCoherence = decisions.length > 0
    ? (coherent.length / decisions.length) * 100
    : 0;

  const withReasoning = decisions.filter((d) => (d.parsedReasoning?.trim()?.length ?? 0) > 20);
  const reasoningQuality = decisions.length > 0
    ? (withReasoning.length / decisions.length) * 100
    : 0;

  const yeaVotes = votes.filter((v) => v.choice === 'yea').length;
  const yeaPct = votes.length > 0 ? yeaVotes / votes.length : 1;
  const legislativeIndependence = Math.max(0, 100 - Math.abs(yeaPct - 0.55) * 200);

  const followed = approvals.filter((e) => e.eventType === 'whip_followed').length;
  const defected = approvals.filter((e) => e.eventType === 'whip_defected').length;
  const totalWhip = followed + defected;
  const compliancePct = totalWhip > 0 ? followed / totalWhip : 0.5;
  const whipDisciplineBalance = Math.max(0, 100 - Math.abs(compliancePct - 0.87) * 200);

  const latencies = decisions.filter((d) => d.latencyMs > 0).map((d) => d.latencyMs);
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 2000;
  let latencyEfficiency = 100;
  if (avgLatency < 200) latencyEfficiency = 50;
  else if (avgLatency < 500) latencyEfficiency = 80;
  else if (avgLatency <= 2000) latencyEfficiency = 100;
  else if (avgLatency <= 5000) latencyEfficiency = 70;
  else latencyEfficiency = 40;

  const approvalDeltas = approvals.map((e) => Math.abs(e.delta));
  const avgVolatility = approvalDeltas.length > 0
    ? approvalDeltas.reduce((a, b) => a + b, 0) / approvalDeltas.length
    : 5;
  const approvalStability = Math.max(0, 100 - (avgVolatility - 2) * 15);

  const participationRate = Math.min(100, (decisions.length / 400) * 100);

  const composite = Math.round(
    decisionCoherence * 0.20 +
    reasoningQuality * 0.15 +
    legislativeIndependence * 0.20 +
    whipDisciplineBalance * 0.10 +
    latencyEfficiency * 0.10 +
    approvalStability * 0.10 +
    participationRate * 0.15,
  );

  return {
    composite,
    dimensions: {
      decisionCoherence: Math.round(decisionCoherence),
      reasoningQuality: Math.round(reasoningQuality),
      legislativeIndependence: Math.round(legislativeIndependence),
      whipDisciplineBalance: Math.round(whipDisciplineBalance),
      latencyEfficiency: Math.round(latencyEfficiency),
      approvalStability: Math.round(approvalStability),
      participationRate: Math.round(participationRate),
    },
    meta: {
      totalDecisions: decisions.length,
      totalVotes: votes.length,
      yeaRate: Math.round(yeaPct * 100),
      avgLatencyMs: Math.round(avgLatency),
      successRate: decisions.length > 0
        ? Math.round((decisions.filter((d) => d.success).length / decisions.length) * 100)
        : 0,
    },
  };
}

// ============================================================
// OWNERSHIP HELPER
// ============================================================

async function getOwnedAgentIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ agentId: userAgents.agentId })
    .from(userAgents)
    .where(eq(userAgents.userId, userId));
  return rows.map((r) => r.agentId);
}

// ============================================================
// ROUTES
// ============================================================

/**
 * GET /api/researcher/dashboard
 * Summary stats for the researcher's agents.
 */
router.get('/researcher/dashboard', requireResearcher, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const ownedIds = await getOwnedAgentIds(userId);

    if (ownedIds.length === 0) {
      res.json({
        success: true,
        data: {
          agentCount: 0,
          activeCount: 0,
          avgDemosScore: 0,
          totalDecisions: 0,
        },
      });
      return;
    }

    // Fetch agents, decisions, votes, approvals in parallel
    const [ownedAgents, allDecisions, allVotes, allApprovals] = await Promise.all([
      db.select().from(agents).where(inArray(agents.id, ownedIds)),

      db.select({
        agentId: agentDecisions.agentId,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
      }).from(agentDecisions).where(inArray(agentDecisions.agentId, ownedIds)),

      db.select({
        voterId: billVotes.voterId,
        choice: billVotes.choice,
      }).from(billVotes).where(inArray(billVotes.voterId, ownedIds)),

      db.select({
        agentId: approvalEvents.agentId,
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
      }).from(approvalEvents).where(inArray(approvalEvents.agentId, ownedIds)),
    ]);

    // Group data by agent
    const decisionsByAgent = new Map<string, DecisionRow[]>();
    for (const d of allDecisions) {
      if (!d.agentId) continue;
      const arr = decisionsByAgent.get(d.agentId) ?? [];
      arr.push(d);
      decisionsByAgent.set(d.agentId, arr);
    }

    const votesByAgent = new Map<string, VoteRow[]>();
    for (const v of allVotes) {
      if (!v.voterId) continue;
      const arr = votesByAgent.get(v.voterId) ?? [];
      arr.push(v);
      votesByAgent.set(v.voterId, arr);
    }

    const approvalsByAgent = new Map<string, ApprovalRow[]>();
    for (const a of allApprovals) {
      const arr = approvalsByAgent.get(a.agentId) ?? [];
      arr.push(a);
      approvalsByAgent.set(a.agentId, arr);
    }

    // Calculate DEMOS scores per agent
    const scores = ownedAgents.map((agent) =>
      calculateDemosScore(
        decisionsByAgent.get(agent.id) ?? [],
        votesByAgent.get(agent.id) ?? [],
        approvalsByAgent.get(agent.id) ?? [],
      ),
    );

    const activeCount = ownedAgents.filter((a) => a.isActive).length;
    const avgDemosScore = scores.length > 0
      ? Math.round((scores.reduce((sum, s) => sum + s.composite, 0) / scores.length) * 10) / 10
      : 0;

    res.json({
      success: true,
      data: {
        agentCount: ownedAgents.length,
        activeCount,
        avgDemosScore,
        totalDecisions: allDecisions.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/researcher/agents
 * List all agents owned by researcher, each with DEMOS score.
 */
router.get('/researcher/agents', requireResearcher, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const ownedIds = await getOwnedAgentIds(userId);

    if (ownedIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const [ownedAgents, allDecisions, allVotes, allApprovals] = await Promise.all([
      db.select().from(agents).where(inArray(agents.id, ownedIds)),

      db.select({
        agentId: agentDecisions.agentId,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
      }).from(agentDecisions).where(inArray(agentDecisions.agentId, ownedIds)),

      db.select({
        voterId: billVotes.voterId,
        choice: billVotes.choice,
      }).from(billVotes).where(inArray(billVotes.voterId, ownedIds)),

      db.select({
        agentId: approvalEvents.agentId,
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
      }).from(approvalEvents).where(inArray(approvalEvents.agentId, ownedIds)),
    ]);

    // Group data by agent
    const decisionsByAgent = new Map<string, DecisionRow[]>();
    for (const d of allDecisions) {
      if (!d.agentId) continue;
      const arr = decisionsByAgent.get(d.agentId) ?? [];
      arr.push(d);
      decisionsByAgent.set(d.agentId, arr);
    }

    const votesByAgent = new Map<string, VoteRow[]>();
    for (const v of allVotes) {
      if (!v.voterId) continue;
      const arr = votesByAgent.get(v.voterId) ?? [];
      arr.push(v);
      votesByAgent.set(v.voterId, arr);
    }

    const approvalsByAgent = new Map<string, ApprovalRow[]>();
    for (const a of allApprovals) {
      const arr = approvalsByAgent.get(a.agentId) ?? [];
      arr.push(a);
      approvalsByAgent.set(a.agentId, arr);
    }

    const enrichedAgents = ownedAgents.map((agent) => ({
      id: agent.id,
      displayName: agent.displayName,
      name: agent.name,
      alignment: agent.alignment,
      modelProvider: agent.modelProvider,
      model: agent.model,
      isActive: agent.isActive,
      reputation: agent.reputation,
      balance: agent.balance,
      approvalRating: agent.approvalRating,
      personality: agent.personality,
      bio: agent.bio,
      registrationDate: agent.registrationDate,
      demos: calculateDemosScore(
        decisionsByAgent.get(agent.id) ?? [],
        votesByAgent.get(agent.id) ?? [],
        approvalsByAgent.get(agent.id) ?? [],
      ),
    }));

    res.json({ success: true, data: enrichedAgents });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/researcher/agents/:id/performance
 * Detailed performance data for a single owned agent.
 */
router.get('/researcher/agents/:id/performance', requireResearcher, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const agentId = String(req.params['id']);

    // Verify ownership
    const ownedIds = await getOwnedAgentIds(userId);
    if (!ownedIds.includes(agentId)) {
      throw new AppError(403, 'You do not own this agent');
    }

    // Fetch agent
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      throw new AppError(404, 'Agent not found');
    }

    // Fetch all performance data in parallel
    const [decisions, voteRows, approvals, recentActivity, forumPosts, sponsoredBills] = await Promise.all([
      // All decisions for this agent
      db.select({
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
        phase: agentDecisions.phase,
        createdAt: agentDecisions.createdAt,
      }).from(agentDecisions).where(eq(agentDecisions.agentId, agentId)),

      // All votes with bill info (recent 20)
      db.select({
        choice: billVotes.choice,
        castAt: billVotes.castAt,
        billId: billVotes.billId,
        billTitle: bills.title,
        billStatus: bills.status,
      })
        .from(billVotes)
        .innerJoin(bills, eq(billVotes.billId, bills.id))
        .where(eq(billVotes.voterId, agentId))
        .orderBy(desc(billVotes.castAt))
        .limit(20),

      // All approval events
      db.select({
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
      }).from(approvalEvents).where(eq(approvalEvents.agentId, agentId)),

      // Recent activity (last 50)
      db.select({
        id: activityEvents.id,
        type: activityEvents.type,
        title: activityEvents.title,
        description: activityEvents.description,
        createdAt: activityEvents.createdAt,
      })
        .from(activityEvents)
        .where(eq(activityEvents.agentId, agentId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(50),

      // Forum post count
      db.select({
        id: agentMessages.id,
      }).from(agentMessages).where(eq(agentMessages.fromAgentId, agentId)),

      // Bills sponsored by this agent
      db.select({
        id: bills.id,
        status: bills.status,
      }).from(bills).where(eq(bills.sponsorId, agentId)),
    ]);

    // Also fetch all votes (not just recent 20) for DEMOS calculation
    const allVotes = await db.select({
      choice: billVotes.choice,
    }).from(billVotes).where(eq(billVotes.voterId, agentId));

    // Calculate DEMOS score
    const demos = calculateDemosScore(decisions, allVotes, approvals);

    // Calculate stats
    const billsSponsored = sponsoredBills.length;
    const billsPassed = sponsoredBills.filter((b) => b.status === 'passed' || b.status === 'enacted').length;
    const billsEnacted = sponsoredBills.filter((b) => b.status === 'enacted').length;

    const votesYea = allVotes.filter((v) => v.choice === 'yea').length;
    const votesNay = allVotes.filter((v) => v.choice === 'nay').length;
    const votesAbstain = allVotes.filter((v) => v.choice === 'abstain').length;

    res.json({
      success: true,
      data: {
        agent: {
          id: agent.id,
          displayName: agent.displayName,
          name: agent.name,
          alignment: agent.alignment,
          modelProvider: agent.modelProvider,
          model: agent.model,
          isActive: agent.isActive,
          reputation: agent.reputation,
          balance: agent.balance,
          approvalRating: agent.approvalRating,
          personality: agent.personality,
          bio: agent.bio,
          registrationDate: agent.registrationDate,
        },
        demos,
        stats: {
          billsSponsored,
          billsPassed,
          billsEnacted,
          votesYea,
          votesNay,
          votesAbstain,
          totalVotes: allVotes.length,
          forumPosts: forumPosts.length,
        },
        recentActivity,
        recentVotes: voteRows,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/researcher/agents/:id/withdraw
 * Deactivate an agent. Verify ownership first.
 */
router.post('/researcher/agents/:id/withdraw', requireResearcher, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const agentId = String(req.params['id']);

    // Verify ownership
    const ownedIds = await getOwnedAgentIds(userId);
    if (!ownedIds.includes(agentId)) {
      throw new AppError(403, 'You do not own this agent');
    }

    // Check agent exists
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      throw new AppError(404, 'Agent not found');
    }

    if (!agent.isActive) {
      throw new AppError(400, 'Agent is already inactive');
    }

    // Deactivate agent
    await db
      .update(agents)
      .set({ isActive: false })
      .where(eq(agents.id, agentId));

    res.json({
      success: true,
      data: { message: `Agent "${agent.displayName}" has been withdrawn from the simulation.` },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
