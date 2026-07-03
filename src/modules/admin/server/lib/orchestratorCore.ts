import { db } from '@db/connection';
import {
  agents, bills, laws, elections, activityEvents,
  governmentSettings, tickLog, agentDecisions, agentRelationships,
  orchestratorInterventions, aggeInterventions, agentMemorySummaries,
  agentPolicyPositions, coalitionSnapshots, courtCases,
} from '@db/schema/index';
import { eq, desc, sql, gte, and, inArray } from 'drizzle-orm';
import { getRuntimeConfig, updateRuntimeConfig } from '@core/server/runtimeConfig.js';
import { ACTIVE_CASE_STATUSES } from '@core/server/lib/courtMath.js';

export type InterventionInput = {
  type: 'personality_mod' | 'inject_event' | 'config_change' | 'agent_toggle' | 'trigger_election';
  reasoning?: string;
  [key: string]: unknown;
};

export async function observeSimulation() {
  const rc = getRuntimeConfig();

  const agentRows = await db
    .select({
      id: agents.id, displayName: agents.displayName, alignment: agents.alignment,
      approvalRating: agents.approvalRating, isActive: agents.isActive,
      personalityMod: agents.personalityMod, balance: agents.balance,
      bio: agents.bio, personality: agents.personality,
    })
    .from(agents).orderBy(agents.displayName);

  const agentMap = new Map(agentRows.map((a) => [a.id, a.displayName]));
  const activeAgentIds = agentRows
    .filter((a) => a.isActive && a.id !== '00000000-0000-0000-0000-000000000001')
    .map((a) => a.id);

  const billRows = await db.select({ status: bills.status, count: sql<number>`COUNT(*)` }).from(bills).groupBy(bills.status);
  const byStatus: Record<string, number> = {};
  for (const row of billRows) byStatus[row.status] = Number(row.count);
  const recentLaws = await db.select({ title: laws.title, enactedDate: laws.enactedDate }).from(laws).orderBy(desc(laws.enactedDate)).limit(5);

  const activeElections = await db.select({ id: elections.id, positionType: elections.positionType, status: elections.status })
    .from(elections).where(inArray(elections.status, ['scheduled', 'registration', 'campaigning', 'voting', 'counting']));

  const recentActivity = await db.select({ type: activityEvents.type, agentId: activityEvents.agentId, title: activityEvents.title, createdAt: activityEvents.createdAt })
    .from(activityEvents).orderBy(desc(activityEvents.createdAt)).limit(30);

  const [econ] = await db.select().from(governmentSettings).limit(1);

  const [lastTick] = await db.select({ firedAt: tickLog.firedAt, completedAt: tickLog.completedAt })
    .from(tickLog).where(sql`${tickLog.completedAt} IS NOT NULL`).orderBy(desc(tickLog.firedAt)).limit(1);
  const lastTickDuration = lastTick?.completedAt && lastTick?.firedAt
    ? new Date(lastTick.completedAt).getTime() - new Date(lastTick.firedAt).getTime() : null;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [totalRow] = await db.select({ count: sql<number>`COUNT(*)` }).from(agentDecisions).where(gte(agentDecisions.createdAt, oneHourAgo));
  const [errorRow] = await db.select({ count: sql<number>`COUNT(*)` }).from(agentDecisions).where(and(gte(agentDecisions.createdAt, oneHourAgo), eq(agentDecisions.success, false)));
  const total = Number(totalRow?.count ?? 0);
  const errors = Number(errorRow?.count ?? 0);

  const allRels = await db.select({
    agentId: agentRelationships.agentId,
    targetAgentId: agentRelationships.targetAgentId,
    voteAlignment: agentRelationships.voteAlignment,
    sentiment: agentRelationships.sentiment,
  }).from(agentRelationships)
    .where(sql`${agentRelationships.agentId} < ${agentRelationships.targetAgentId}`)
    .orderBy(desc(agentRelationships.voteAlignment));
  const topAlliances = allRels.slice(0, 10).map((r) => ({
    agent1: agentMap.get(r.agentId) ?? r.agentId,
    agent2: agentMap.get(r.targetAgentId) ?? r.targetAgentId,
    voteAlignment: r.voteAlignment,
    sentiment: r.sentiment,
  }));
  const topRivalries = allRels.slice(-10).reverse().map((r) => ({
    agent1: agentMap.get(r.agentId) ?? r.agentId,
    agent2: agentMap.get(r.targetAgentId) ?? r.targetAgentId,
    voteAlignment: r.voteAlignment,
    sentiment: r.sentiment,
  }));

  const memorySummaries = activeAgentIds.length > 0
    ? await db.select({
        agentId: agentMemorySummaries.agentId,
        summary: agentMemorySummaries.summary,
        createdAt: agentMemorySummaries.createdAt,
      }).from(agentMemorySummaries)
        .where(inArray(agentMemorySummaries.agentId, activeAgentIds))
        .orderBy(desc(agentMemorySummaries.createdAt))
    : [];
  const latestSummaryByAgent = new Map<string, string>();
  for (const s of memorySummaries) {
    if (!latestSummaryByAgent.has(s.agentId)) latestSummaryByAgent.set(s.agentId, s.summary);
  }

  const policyPositions = activeAgentIds.length > 0
    ? await db.select({
        agentId: agentPolicyPositions.agentId,
        category: agentPolicyPositions.category,
        supportCount: agentPolicyPositions.supportCount,
        opposeCount: agentPolicyPositions.opposeCount,
      }).from(agentPolicyPositions)
        .where(inArray(agentPolicyPositions.agentId, activeAgentIds))
    : [];
  const policyByAgent = new Map<string, Array<{ category: string; net: number }>>();
  for (const p of policyPositions) {
    const arr = policyByAgent.get(p.agentId) ?? [];
    arr.push({ category: p.category, net: p.supportCount - p.opposeCount });
    policyByAgent.set(p.agentId, arr);
  }

  const recentInterventions = await db.select({
    type: orchestratorInterventions.type,
    payload: orchestratorInterventions.payload,
    reasoning: orchestratorInterventions.reasoning,
    createdAt: orchestratorInterventions.createdAt,
  }).from(orchestratorInterventions)
    .orderBy(desc(orchestratorInterventions.createdAt))
    .limit(20);

  const aggeHistory = activeAgentIds.length > 0
    ? await db.select({
        agentId: aggeInterventions.agentId,
        action: aggeInterventions.action,
        previousMod: aggeInterventions.previousMod,
        newMod: aggeInterventions.newMod,
        reasoning: aggeInterventions.reasoning,
        createdAt: aggeInterventions.createdAt,
      }).from(aggeInterventions)
        .where(inArray(aggeInterventions.agentId, activeAgentIds))
        .orderBy(desc(aggeInterventions.createdAt))
        .limit(30)
    : [];

  const [latestCoalition] = await db.select({ blocs: coalitionSnapshots.blocs, createdAt: coalitionSnapshots.createdAt })
    .from(coalitionSnapshots)
    .orderBy(desc(coalitionSnapshots.createdAt))
    .limit(1);

  /* Phase 4 judicial arc — read-only docket view for the orchestrator. */
  const activeCases = await db.select({
    caseNumber: courtCases.caseNumber,
    caption: courtCases.caption,
    caseType: courtCases.caseType,
    status: courtCases.status,
    filedTick: courtCases.filedTick,
    hearingTick: courtCases.hearingTick,
  }).from(courtCases)
    .where(inArray(courtCases.status, [...ACTIVE_CASE_STATUSES]))
    .orderBy(desc(courtCases.filedTick));
  const recentDecisions = await db.select({
    caseNumber: courtCases.caseNumber,
    caption: courtCases.caption,
    caseType: courtCases.caseType,
    outcome: courtCases.outcome,
    votesFor: courtCases.votesFor,
    votesAgainst: courtCases.votesAgainst,
    decidedTick: courtCases.decidedTick,
  }).from(courtCases)
    .where(eq(courtCases.status, 'decided'))
    .orderBy(desc(courtCases.decidedAt))
    .limit(3);

  const enrichedAgents = agentRows
    .filter((a) => a.id !== '00000000-0000-0000-0000-000000000001')
    .map((a) => ({
      ...a,
      memorySummary: latestSummaryByAgent.get(a.id) ?? null,
      policyPositions: (policyByAgent.get(a.id) ?? [])
        .sort((x, y) => Math.abs(y.net) - Math.abs(x.net))
        .slice(0, 5),
      recentMods: aggeHistory
        .filter((h) => h.agentId === a.id)
        .slice(0, 3)
        .map((h) => ({ action: h.action, mod: h.newMod, reasoning: h.reasoning, when: h.createdAt })),
    }));

  return {
    timestamp: new Date().toISOString(),
    simulation: {
      isRunning: true,
      lastTickDuration,
      tickIntervalMs: rc.tickIntervalMs,
      errorRate: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0,
    },
    agents: enrichedAgents,
    legislation: { byStatus, recentLaws },
    coalitions: {
      topAlliances,
      topRivalries,
      latestBlocs: latestCoalition?.blocs ?? null,
    },
    elections: activeElections,
    judicial: { activeCases, recentDecisions },
    recentActivity,
    economy: { treasuryBalance: econ?.treasuryBalance ?? 0, taxRate: econ?.taxRatePercent ?? 0 },
    orchestratorHistory: recentInterventions,
  };
}

export async function executeIntervention(input: InterventionInput) {
  const { type, reasoning, ...payload } = input;
  let result: Record<string, unknown> = {};

  switch (type) {
    case 'personality_mod': {
      const { agentId, mod } = payload as { agentId: string; mod: string };
      if (!agentId) throw new Error('agentId required');
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
      if (!agent) throw new Error(`Agent ${agentId} not found`);
      const previousMod = agent.personalityMod ?? null;
      const newMod = (mod ?? '').trim() || null;
      await db.update(agents).set({ personalityMod: newMod, updatedAt: new Date() }).where(eq(agents.id, agentId));
      await db.insert(activityEvents).values({ type: 'orchestrator_intervention', agentId, title: `${agent.displayName} personality modified by orchestrator`, description: reasoning ?? `Changed mod to: ${newMod ?? 'cleared'}` });
      result = { agentId, agentName: agent.displayName, previousMod, newMod };
      break;
    }
    case 'inject_event': {
      const { eventType, config: eventConfig, description } = payload as { eventType: string; config: Record<string, unknown>; description?: string };
      if (!eventType) throw new Error('eventType required');
      if (eventType === 'crisis') {
        const treasuryDrain = Number(eventConfig?.treasuryDrain ?? 0.3);
        const approvalImpact = Number(eventConfig?.approvalImpact ?? -10);
        const [settings] = await db.select().from(governmentSettings).limit(1);
        if (settings) {
          const newBalance = Math.max(0, Math.round(settings.treasuryBalance * (1 - treasuryDrain)));
          await db.update(governmentSettings).set({ treasuryBalance: newBalance }).where(eq(governmentSettings.id, settings.id));
        }
        if (approvalImpact !== 0) {
          await db.execute(sql`UPDATE agents SET approval_rating = GREATEST(0, LEAST(100, approval_rating + ${approvalImpact})) WHERE is_active = true`);
        }
        result = { eventType, treasuryDrain, approvalImpact };
      } else if (eventType === 'media_event') {
        await db.insert(activityEvents).values({ type: 'media_event', agentId: null, title: String(eventConfig?.headline ?? 'Breaking News'), description: String(eventConfig?.context ?? description ?? 'External media event') });
        result = { eventType, headline: eventConfig?.headline };
      } else if (eventType === 'external_pressure') {
        const { agentId: targetId, approvalDelta } = eventConfig as { agentId?: string; approvalDelta?: number };
        if (targetId && approvalDelta) {
          await db.execute(sql`UPDATE agents SET approval_rating = GREATEST(0, LEAST(100, approval_rating + ${approvalDelta})) WHERE id = ${targetId}`);
        }
        result = { eventType, targetId, approvalDelta };
      } else {
        result = { eventType, note: 'Logged but no direct DB mutation' };
      }
      await db.insert(activityEvents).values({ type: 'orchestrator_event_injection', agentId: null, title: `Orchestrator injected ${eventType}`, description: description ?? reasoning ?? eventType });
      break;
    }
    case 'config_change': {
      const { changes } = payload as { changes: Record<string, unknown> };
      if (!changes) throw new Error('changes required');
      const updated = await updateRuntimeConfig(changes as Parameters<typeof updateRuntimeConfig>[0]);
      result = { applied: Object.keys(changes), config: updated };
      break;
    }
    case 'agent_toggle': {
      const { agentId, isActive } = payload as { agentId: string; isActive: boolean };
      if (!agentId) throw new Error('agentId required');
      await db.update(agents).set({ isActive: !!isActive, updatedAt: new Date() }).where(eq(agents.id, agentId));
      result = { agentId, isActive: !!isActive };
      break;
    }
    case 'trigger_election': {
      const { positionType } = payload as { positionType: string };
      if (!positionType) throw new Error('positionType required');
      const rc = getRuntimeConfig();
      const now = new Date();
      const registrationDeadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const votingStartDate = new Date(now.getTime() + rc.campaignDurationDays * 24 * 60 * 60 * 1000);
      const votingEndDate = new Date(votingStartDate.getTime() + rc.votingDurationHours * 60 * 60 * 1000);
      const [election] = await db.insert(elections).values({ positionType, status: 'registration', scheduledDate: now, registrationDeadline, votingStartDate, votingEndDate }).returning();
      await db.insert(activityEvents).values({ type: 'election_called', agentId: null, title: `${positionType} election called by orchestrator`, description: reasoning ?? `Emergency election for ${positionType}` });
      result = { electionId: election.id, positionType, status: 'registration' };
      break;
    }
    default:
      throw new Error(`Unknown type: ${type}`);
  }

  const [intervention] = await db.insert(orchestratorInterventions).values({
    type, payload: { ...payload, type } as Record<string, unknown>, result: result as Record<string, unknown>, reasoning: reasoning ?? null,
  }).returning();

  return { id: intervention.id, type, timestamp: intervention.createdAt, result };
}

export async function getInterventionHistory(limit = 50, offset = 0) {
  const clampedLimit = Math.min(Math.max(limit, 1), 200);
  const clampedOffset = Math.max(offset, 0);
  return db.select().from(orchestratorInterventions).orderBy(desc(orchestratorInterventions.createdAt)).limit(clampedLimit).offset(clampedOffset);
}
