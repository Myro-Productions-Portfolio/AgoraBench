import Bull from 'bull';
import { eq, ne, and, inArray, isNotNull, lte, gte, gt, lt, asc, desc, count, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getRuntimeConfig } from '../runtimeConfig.js';
import { db } from '@db/connection';
import {
  agents,
  bills,
  billVotes,
  activityEvents,
  laws,
  elections,
  campaigns,
  votes,
  positions,
  parties,
  partyMemberships,
  courtCases,
  courtCaseEvents,
  courtCaseVotes,
  governmentSettings,
  transactions,
  forumThreads,
  agentMessages,
  approvalEvents,
  tickLog,
  pendingMentions,
  agentRelationships,
  agentPolicyPositions,
  coalitionSnapshots,
  billAmendments,
  lobbyingEvents,
  agentDeals,
  agentStatements,
  committeeMemberships,
  governmentEvents,
  gazetteIssues,
  fiscalTickSummaries,
} from '@db/schema/index';
import { generateAgentDecision, buildSimulationStateBlock, summarizeAgentDecisions, generateForumPost, generateForumReply, generateGazetteArticle } from '../services/ai.js';
import { applyAmendment } from '../lib/applyAmendment.js';
import { pickTopCommittees, selectChair, tallyWeightedRatification, type CanonicalCommittee } from '../lib/committeeAssignment.js';
import { parseDealField, composeCommitment, commitmentPromisesYea } from '../lib/dealParsing.js';
import { parseFiscalField } from '../lib/fiscalParsing.js';
import { elasticCitizenRevenue, computePaycheck, paydayDue, applyTaxDelta, sunsetDue, lapseDue, budgetSessionDue, composeExpiringProgramsNote, mandatoryEffectiveAmount, tickInterest, settleTreasury, type FiscalKind } from '../lib/fiscalMath.js';
import { computeFiscalApprovalMoves, buildTenureFiscalRecord, type FiscalConsequenceState, type FiscalApprovalConfig, type TenureFiscalRow } from '../lib/consequenceMath.js';
import { ACTIVE_CASE_STATUSES, STALL_GRACE_TICKS, docketDue, hearingDue, deliberationDue, decisionDue, isStalled, distillHolding, buildPrecedentInjection, type PrecedentSummary } from '../lib/courtMath.js';
import { parseJudicialVoteData, parseJudicialOpinionData, parseJudicialFilingData } from '../lib/judicialParsing.js';
import { formatConstitutionForPrompt } from '@shared/constitution';
import { buildGazetteDigest } from '../lib/gazetteDigest.js';
import { computeForumRouting, type RoutingDecision } from '../services/forumRouter.js';
import { broadcast } from '../websocket.js';
import { ALIGNMENT_ORDER, COMMITTEE_TYPES, GOVERNMENT } from '@shared/constants';
import { alignmentDistance } from '../services/simulationCore.js';
import { finalizeElection } from '@modules/elections/server/finalizeElection.js';
import { pickSpeakerNominees, tallyMajorityBallot, type SeatedMember } from '../lib/electionMath.js';
import { runAppointment, getSittingPresident } from '@modules/government/server/appointments.js';
import { pullRealitySnapshots, backfillHistory, REALITY_PULL_EVERY_N_TICKS } from '@modules/government/server/lib/realityFeed.js';
import { pollWorldEvents, sweepWorldEvents } from '@modules/world/server/lib/worldFeedPoller.js';
import { stepMacroEngine } from '@modules/world/server/lib/macroEngine.js';

/* ── Approval Rating Helper ─────────────────────────────────────────── */
export async function updateApproval(
  agentId: string,
  delta: number,
  eventType: string,
  reason: string,
): Promise<void> {
  try {
    const [agent] = await db
      .select({ approvalRating: agents.approvalRating })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) return;

    const newRating = Math.min(100, Math.max(0, agent.approvalRating + delta));
    await Promise.all([
      db.update(agents).set({ approvalRating: newRating }).where(eq(agents.id, agentId)),
      db.insert(approvalEvents).values({ agentId, eventType, delta, reason }),
    ]);
  } catch (err) {
    console.warn('[APPROVAL] updateApproval error:', err);
  }
}

/* Compact dollar string for prompt text (e.g. 75000000000 -> "$75B"). Server-side
   twin of the client formatMoney({compact}); LLM-facing, so no unicode minus. */
function compactDollars(v: number): string {
  if (!Number.isFinite(v)) return '$0';
  const abs = Math.abs(v);
  const units: Array<[number, string]> = [
    [1_000_000_000_000, 'T'],
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  for (const [value, suffix] of units) {
    if (abs >= value) {
      const scaled = abs / value;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      const text = scaled.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
      return `${v < 0 ? '-' : ''}$${text}${suffix}`;
    }
  }
  return `${v < 0 ? '-' : ''}$${abs.toLocaleString('en-US')}`;
}

/* ── Per-Agent Whip Follow Rate ─────────────────────────────────────── */
function computeWhipFollowRate(
  agentVoteAlignment: number | null,
  approvalRating: number,
  policySupport: number,
  policyOppose: number,
  baseRate: number,
): number {
  let rate = baseRate;

  // Relationship bonus/penalty with party leader
  const alignment = agentVoteAlignment ?? 0.5;
  if (alignment > 0.85) rate += 0.10;
  else if (alignment < 0.40) rate -= 0.15;

  // Approval pressure (low approval = constituent pressure to deviate)
  if (approvalRating < 30) rate -= 0.20;
  else if (approvalRating < 45) rate -= 0.10;

  // Policy congruence with bill category
  const totalVotes = policySupport + policyOppose;
  if (totalVotes > 0) {
    const supportRate = policySupport / totalVotes;
    if (supportRate > 0.65) rate += 0.05;
    else if (supportRate < 0.35) rate -= 0.05;
  }

  return Math.max(0.10, Math.min(0.97, rate));
}

const agentTickQueue = new Bull('agent-tick', config.redis.url);

agentTickQueue.process(async () => {
  const rc = getRuntimeConfig();
  console.warn('[SIMULATION] Agent tick running...');
  broadcast('tick:start', { timestamp: Date.now() });

  const tickFiredAt = new Date();
  const [currentTick] = await db.insert(tickLog).values({ firedAt: tickFiredAt }).returning({ id: tickLog.id });

  /* Tick number — DB-derived (COUNT of completed ticks + 1), so it is
     restart-robust and immune to tick-interval changes. Same COUNT the
     all-time status endpoint already uses. Used by Phase 9 (enactedTick /
     lastRenewedTick) and Phase 13 (fiscal_tick_summaries). */
  let tickNumber = 1;
  try {
    const [tickCountRow] = await db
      .select({ completed: sql<number>`COUNT(*) FILTER (WHERE ${tickLog.completedAt} IS NOT NULL)` })
      .from(tickLog);
    tickNumber = Number(tickCountRow?.completed ?? 0) + 1;
  } catch (err) {
    console.warn('[SIMULATION] tickNumber derivation failed — defaulting to 1:', err);
  }

  /* Fetch all active agents once — used across phases */
  const activeAgents = await db.select().from(agents).where(eq(agents.isActive, true));
  const activeAgentCount = activeAgents.length;

  /* ---- Tick-scoped variables shared across phases ---- */
  /* Populated by Phase 1.5, read by Phase 2 */
  const lobbyNotesMap = new Map<string, string[]>();
  /* Populated by Phase 5, read by Phase 5.5 and Phase 11.5 */
  let passedBillsThisTick: (typeof bills.$inferSelect)[] = [];
  let failedBillsThisTick: (typeof bills.$inferSelect)[] = [];
  /* Populated by Phase 6, read by Phase 11.5 */
  let vetoedByPresidentThisTick: (typeof bills.$inferSelect)[] = [];
  /* Populated by Phase 2c, read by Phase 11.5 */
  let brokenDealsThisTick: { dealId: string; wrongedPartyId: string; wrongedPartyName: string }[] = [];
  /* Election results from Phase 14, read by Phase 11.5 */
  let electionResultsThisTick: { electionId: string; winnerId: string; loserIds: string[] }[] = [];
  /* Government spending this tick (net paychecks + one-time appropriations +
     recurring program debits) — accumulated by Phases 9 and 12, written to
     fiscal_tick_summaries by Phase 13. Integer dollars. */
  let tickSpendingThisTick = 0;

  /* Income tax withheld from paychecks this tick (Phase 12) — counted as
     revenue alongside citizen tax in Phase 13's fiscal summary. */
  let payrollWithheldThisTick = 0;

  /* ------------------------------------------------------------------ */
  /* PHASE 0.5: Committee Assignment & Chair Succession                    */
  /* Deterministic, zero LLM. Every active agent sits on 2 of the four     */
  /* canonical committees (scored from agent_policy_positions; stable      */
  /* hash fallback for new agents), and every canonical committee gets an  */
  /* active chair — the insert that wakes the Phase 3 committee review     */
  /* LLM call and the Phase 1.7 chair amendment bonus. Sticky: existing    */
  /* members are never re-scored, so a mid-life DB stays stable.           */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 0.5: Committee Assignment & Chair Succession');

    const activeAgentIds05 = activeAgents.map((a) => a.id);
    const activeAgentIdSet05 = new Set(activeAgentIds05);
    const agentById05 = new Map(activeAgents.map((a) => [a.id, a]));

    const allMemberships05 = await db.select().from(committeeMemberships);
    const policyRows05 = activeAgentIds05.length > 0
      ? await db
          .select({
            agentId: agentPolicyPositions.agentId,
            category: agentPolicyPositions.category,
            supportCount: agentPolicyPositions.supportCount,
            opposeCount: agentPolicyPositions.opposeCount,
          })
          .from(agentPolicyPositions)
          .where(inArray(agentPolicyPositions.agentId, activeAgentIds05))
      : [];
    const engagementMap05 = new Map<string, number>();
    for (const row of policyRows05) {
      engagementMap05.set(`${row.agentId}:${row.category}`, row.supportCount + row.opposeCount);
    }
    const engagementOf05 = (agentId: string, committee: string): number =>
      engagementMap05.get(`${agentId}:${committee}`) ?? 0;

    /* (1) Deactivate memberships whose agent is no longer active */
    const staleMembershipIds05 = allMemberships05
      .filter((m) => m.isActive && !activeAgentIdSet05.has(m.agentId))
      .map((m) => m.id);
    if (staleMembershipIds05.length > 0) {
      await db
        .update(committeeMemberships)
        .set({ isActive: false, endedAt: new Date() })
        .where(inArray(committeeMemberships.id, staleMembershipIds05));
      console.warn(`[SIMULATION] Phase 0.5: Deactivated ${staleMembershipIds05.length} memberships of inactive agents`);
    }
    const staleMembershipIdSet05 = new Set(staleMembershipIds05);

    /* Local post-deactivation view: agentId -> committees */
    const membershipsByAgent05 = new Map<string, string[]>();
    for (const m of allMemberships05) {
      if (!m.isActive || staleMembershipIdSet05.has(m.id)) continue;
      const list = membershipsByAgent05.get(m.agentId) ?? [];
      list.push(m.committee);
      membershipsByAgent05.set(m.agentId, list);
    }

    /* (2) Seat every active agent with no active membership on their top-2
       committees (reactivate-or-insert via the (agentId, committee) unique) */
    let newlySeated05 = 0;
    for (const agent of activeAgents) {
      if ((membershipsByAgent05.get(agent.id)?.length ?? 0) > 0) continue;
      const topCommittees = pickTopCommittees(agent.id, (committee) => engagementOf05(agent.id, committee), 2);
      for (const committee of topCommittees) {
        await db
          .insert(committeeMemberships)
          .values({ agentId: agent.id, committee, isActive: true, assignedAt: new Date(), endedAt: null })
          .onConflictDoUpdate({
            target: [committeeMemberships.agentId, committeeMemberships.committee],
            set: { isActive: true, assignedAt: new Date(), endedAt: null },
          });
      }
      membershipsByAgent05.set(agent.id, [...topCommittees]);
      newlySeated05++;
    }
    if (newlySeated05 > 0) {
      console.warn(`[SIMULATION] Phase 0.5: Seated ${newlySeated05} agents on committees`);
    }

    /* committee -> active member agentIds (post-assignment view) */
    const membersByCommittee05 = new Map<string, string[]>();
    for (const [agentId, agentCommittees] of membershipsByAgent05) {
      for (const committee of agentCommittees) {
        const list = membersByCommittee05.get(committee) ?? [];
        list.push(agentId);
        membersByCommittee05.set(committee, list);
      }
    }

    /* (3) Chair succession. Title `${committee} Committee Chair` is
       load-bearing: Phase 1.7's chair bonus and Phase 3's chair lookup
       both match chairs via title.includes(committee). */
    const chairPositions05 = await db
      .select()
      .from(positions)
      .where(and(eq(positions.isActive, true), eq(positions.type, 'committee_chair')));

    /* Pass 1 — inventory: keep the newest active chair row per committee,
       retire duplicates and chairs whose agent went inactive. */
    const sittingChairIds05 = new Set<string>();
    const vacantCommittees05: CanonicalCommittee[] = [];
    const chairRowsToRetire05: string[] = [];
    for (const committee of COMMITTEE_TYPES) {
      const rows = chairPositions05
        .filter((p) => p.title.toLowerCase().includes(committee.toLowerCase()))
        .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
      const [newest, ...duplicates] = rows;
      for (const dup of duplicates) chairRowsToRetire05.push(dup.id);
      if (newest && activeAgentIdSet05.has(newest.agentId)) {
        sittingChairIds05.add(newest.agentId);
      } else {
        if (newest) chairRowsToRetire05.push(newest.id);
        vacantCommittees05.push(committee);
      }
    }
    if (chairRowsToRetire05.length > 0) {
      await db
        .update(positions)
        .set({ isActive: false, endDate: new Date() })
        .where(inArray(positions.id, chairRowsToRetire05));
      console.warn(`[SIMULATION] Phase 0.5: Retired ${chairRowsToRetire05.length} stale/duplicate chair positions`);
    }

    /* Pass 2 — fill vacancies: highest engagement + approval among the
       committee's members, excluding sitting chairs of other committees. */
    for (const committee of vacantCommittees05) {
      const candidates = (membersByCommittee05.get(committee) ?? [])
        .filter((id) => activeAgentIdSet05.has(id))
        .map((id) => ({
          agentId: id,
          engagement: engagementOf05(id, committee),
          approvalRating: agentById05.get(id)?.approvalRating ?? 0,
        }));
      const pick = selectChair(candidates, sittingChairIds05);
      const chairAgent = pick ? agentById05.get(pick.agentId) : undefined;
      if (!pick || !chairAgent) {
        console.warn(`[SIMULATION] Phase 0.5: No eligible chair for the ${committee} Committee — Phase 3 auto-advances its bills.`);
        continue;
      }

      await db.insert(positions).values({
        agentId: chairAgent.id,
        type: 'committee_chair',
        title: `${committee} Committee Chair`,
        startDate: new Date(),
        isActive: true,
      });
      sittingChairIds05.add(chairAgent.id);

      await db.insert(activityEvents).values({
        type: 'appointment',
        agentId: chairAgent.id,
        title: `${chairAgent.displayName} appointed ${committee} Committee Chair`,
        description: `Appointed chair of the ${committee} Committee (highest policy engagement and approval among its members)`,
        metadata: JSON.stringify({ committee, engagement: pick.engagement, approvalRating: pick.approvalRating }),
      });
      broadcast('government:chair_appointed', {
        agentId: chairAgent.id,
        agentName: chairAgent.displayName,
        committee,
      });
      console.warn(`[SIMULATION] Phase 0.5: ${chairAgent.displayName} appointed ${committee} Committee Chair`);
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 0.5 error:', err);
  }

  /* ---- Floor working set (Phases 1, 1.5, 1.7, 2) ---------------------- */
  /* Phase 2 voting is the only unbounded O(bills × agents) LLM phase. Cap  */
  /* the per-tick working set at maxFloorBillsPerTick, oldest bills first.  */
  /* Bills outside the set get no new votes this tick and remain queued —  */
  /* Phase 5 still resolves ANY bill that reaches quorum, but its          */
  /* timeExpired escape hatch applies only to in-set bills so queued bills */
  /* are never resolved on partial, stale votes before getting their floor */
  /* vote under the cap.                                                   */
  let floorWorkingSet: (typeof bills.$inferSelect)[] = [];
  try {
    const maxFloorBills = rc.maxFloorBillsPerTick ?? 5;
    const allFloorBills = await db
      .select()
      .from(bills)
      .where(eq(bills.status, 'floor'))
      .orderBy(asc(bills.introducedAt), asc(bills.id));
    floorWorkingSet = allFloorBills.slice(0, maxFloorBills);
    if (allFloorBills.length > floorWorkingSet.length) {
      console.warn(
        `[SIMULATION] Floor working set capped: processing ${floorWorkingSet.length} of ${allFloorBills.length} floor bills this tick (oldest first); the rest remain queued.`,
      );
    }
  } catch (err) {
    console.warn('[SIMULATION] Floor working set fetch error:', err);
  }
  /* Used by Phase 5 to restrict the timeExpired escape hatch to in-set bills. */
  const workingSetIds = new Set(floorWorkingSet.map((b) => b.id));

  /* ------------------------------------------------------------------ */
  /* PHASE 1: Party Whip Signal                                            */
  /* Party leaders signal their recommended vote on floor bills.          */
  /* ------------------------------------------------------------------ */
  /* whipSignals: Map<billId, Map<partyId, 'yea'|'nay'>> */
  const whipSignals = new Map<string, Map<string, string>>();

  try {
    console.warn('[SIMULATION] Phase 1: Party Whip Signal'); broadcast('tick:phase', { phase: 'voting' });

    const floorBills = floorWorkingSet;

    if (floorBills.length === 0) {
      console.warn('[SIMULATION] Phase 1: No floor bills — skipping whip signals.');
    } else {
      /* Get all active party memberships with role='leader' */
      const leaderMemberships = await db
        .select()
        .from(partyMemberships)
        .where(eq(partyMemberships.role, 'leader'));

      const activeParties = await db.select().from(parties).where(eq(parties.isActive, true));

      /* Initialize per-bill signal maps up front so bills with zero leader
         responses still get an empty map (preserves prior behavior). */
      for (const bill of floorBills) {
        whipSignals.set(bill.id, new Map<string, string>());
      }

      /* Build (bill, leader, party) tuples for every whip-signal call */
      const whipTuples: Array<{
        bill: (typeof floorBills)[number];
        leader: (typeof activeAgents)[number];
        party: (typeof activeParties)[number];
      }> = [];
      for (const bill of floorBills) {
        for (const membership of leaderMemberships) {
          const leader = activeAgents.find((a) => a.id === membership.agentId);
          if (!leader) continue;

          const party = activeParties.find((p) => p.id === membership.partyId);
          if (!party) continue;

          whipTuples.push({ bill, leader, party });
        }
      }

      /* Fire all whip-signal LLM calls in parallel */
      const whipResults = await Promise.allSettled(
        whipTuples.map(({ bill, leader, party }) => {
          const contextMessage =
            `As leader of ${party.name}, signal your party's recommended vote on "${bill.title}". ` +
            `Summary: ${bill.summary}. Committee: ${bill.committee}. ` +
            `Your party alignment: ${party.alignment}. ` +
            `Respond with exactly this JSON: {"action":"whip_signal","reasoning":"one sentence","data":{"signal":"yea"}} ` +
            `Use "yea" or "nay" only.`;

          return generateAgentDecision(
            {
              id: leader.id,
              displayName: leader.displayName,
              alignment: leader.alignment,
              modelProvider: rc.providerOverride === 'default' ? leader.modelProvider : rc.providerOverride,
              personality: leader.personality,
              model: leader.model,
              ownerUserId: leader.ownerUserId,
            },
            contextMessage,
            'whip_signal',
          ).then((decision) => ({ bill, leader, party, decision }));
        }),
      );

      /* Process results serially — fills whipSignals and writes DB rows */
      for (const result of whipResults) {
        if (result.status === 'rejected') {
          console.warn('[SIMULATION] Phase 1: Whip signal LLM call rejected:', result.reason);
          continue;
        }
        const { bill, leader, party, decision } = result.value;

        if (decision.action === 'whip_signal' && decision.data) {
          const signal = String(decision.data['signal'] ?? 'yea').toLowerCase();
          const validSignal = signal === 'nay' ? 'nay' : 'yea';
          whipSignals.get(bill.id)?.set(party.id, validSignal);

          await db.insert(activityEvents).values({
            type: 'party_whip',
            agentId: leader.id,
            title: 'Party whip signal',
            description: `${leader.displayName} (${party.name} leader) signals ${validSignal.toUpperCase()} on "${bill.title}"`,
            metadata: JSON.stringify({
              billId: bill.id,
              partyId: party.id,
              partyName: party.name,
              signal: validSignal,
              reasoning: decision.reasoning,
            }),
          });

          console.warn(
            `[SIMULATION] ${leader.displayName} (${party.name}) whip signal: ${validSignal.toUpperCase()} on "${bill.title}"`,
          );
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 1 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 1.5: Pre-Vote Lobbying                                          */
  /* Agents attempt to persuade each other before votes are cast.        */
  /* Arguments are injected into each target's vote prompt in Phase 2.   */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 1.5: Pre-Vote Lobbying');

    const lobbyFloorBills = floorWorkingSet;

    if (!rc.lobbyingEnabled || lobbyFloorBills.length === 0) {
      console.warn('[SIMULATION] Phase 1.5: Skipping — lobbyingEnabled=false or no floor bills.');
    } else {
      const maxLobbyists = rc.maxLobbyistsPerTick ?? 3;

      /* Weight lobbyists: position holders get 2x weight */
      const positionHolderIds = new Set<string>();
      const allPositions15 = await db.select({ agentId: positions.agentId })
        .from(positions)
        .where(and(eq(positions.isActive, true), inArray(positions.type, ['president', 'committee_chair', 'leader'] as string[])));
      for (const p of allPositions15) {
        if (p.agentId) positionHolderIds.add(p.agentId);
      }

      /* Weighted sample: position holders appear twice in candidate pool */
      const candidatePool = activeAgents.flatMap((a) =>
        positionHolderIds.has(a.id) ? [a, a] : [a],
      );
      /* Shuffle and deduplicate to get up to maxLobbyists unique lobbyists */
      const shuffled = candidatePool.sort(() => Math.random() - 0.5);
      const selectedLobbyists: (typeof activeAgents)[number][] = [];
      const seenIds = new Set<string>();
      for (const a of shuffled) {
        if (seenIds.has(a.id)) continue;
        seenIds.add(a.id);
        selectedLobbyists.push(a);
        if (selectedLobbyists.length >= maxLobbyists) break;
      }

      /* Pre-fetch all relationships among active agents for alignment distance */
      const activeAgentIds15 = activeAgents.map((a) => a.id);
      const allRels15 = activeAgentIds15.length > 0
        ? await db.select({
            agentId: agentRelationships.agentId,
            targetAgentId: agentRelationships.targetAgentId,
            voteAlignment: agentRelationships.voteAlignment,
          })
          .from(agentRelationships)
          .where(inArray(agentRelationships.agentId, activeAgentIds15))
        : [];
      const relMap15 = new Map<string, number>();
      for (const r of allRels15) {
        relMap15.set(`${r.agentId}:${r.targetAgentId}`, r.voteAlignment);
      }

      /* Track which (agentId, billId) pairs have been lobbied this tick to avoid duplication */
      const lobbiedPairs = new Set<string>(); // "targetId:billId"

      /* Vote-pact deals parsed from lobbying output (rc.dealParsingEnabled) */
      let dealsCreatedThisTick = 0;
      const dealTriplesThisTick = new Set<string>(); // "initiatorId:targetId:billId"

      for (const lobbyist of selectedLobbyists) {
        /* Pick a random floor bill */
        const bill = lobbyFloorBills[Math.floor(Math.random() * lobbyFloorBills.length)];
        if (!bill) continue;

        /* Pick target: active agent with greatest alignment distance not yet lobbied */
        const candidates = activeAgents.filter(
          (a) => a.id !== lobbyist.id && !lobbiedPairs.has(`${a.id}:${bill.id}`),
        );
        if (candidates.length === 0) continue;

        /* Sort by alignment distance from lobbyist (descending — most distant first) */
        candidates.sort((a, b) => {
          const alignA = relMap15.get(`${lobbyist.id}:${a.id}`) ?? 0.5;
          const alignB = relMap15.get(`${lobbyist.id}:${b.id}`) ?? 0.5;
          return Math.abs(alignA - 0.5) - Math.abs(alignB - 0.5);
        });
        const targetAgent = candidates[0];
        if (!targetAgent) continue;

        lobbiedPairs.add(`${targetAgent.id}:${bill.id}`);

        /* Lobbyist wants the target to vote the same way they themselves lean */
        const lobbyistAlignment = relMap15.get(`${lobbyist.id}:${targetAgent.id}`) ?? 0.5;
        const desiredVote = lobbyistAlignment >= 0.5 ? 'yea' : 'nay';

        const currentAlignment = relMap15.get(`${lobbyist.id}:${targetAgent.id}`) ?? 0.5;
        const billSignals15 = whipSignals.get(bill.id);
        const lobbyPartyId = activeAgents.find((a) => a.id === lobbyist.id)?.id;
        const whipSignal15 = lobbyPartyId && billSignals15
          ? billSignals15.get(lobbyPartyId) ?? null
          : null;

        const contextMessage =
          `Bill "${bill.title}" is on the floor. Summary: ${bill.summary}. ` +
          `You want ${targetAgent.displayName} to vote ${desiredVote.toUpperCase()}. ` +
          `Your current vote alignment with them is ${Math.round(currentAlignment * 100)}%. ` +
          `Party whip signal for their party on this bill: ${whipSignal15 ?? 'none issued'}. ` +
          `Make a direct, politically grounded argument for your position in 1-2 sentences. ` +
          `Respond with exactly this JSON: ` +
          `{"action":"lobby","reasoning":"your persuasive argument","data":{"desiredVote":"${desiredVote}","targetId":"${targetAgent.id}"}}` +
          (rc.dealParsingEnabled
            ? ` Optionally, to offer a binding vote pact, add "deal":{"myVote":"yea"} or "deal":{"myVote":"nay"} inside data — you commit to vote that way on this same bill in exchange for their ${desiredVote.toUpperCase()} vote.`
            : '');

        try {
          const decision = await generateAgentDecision(
            {
              id: lobbyist.id,
              displayName: lobbyist.displayName,
              alignment: lobbyist.alignment,
              modelProvider: rc.providerOverride === 'default' ? lobbyist.modelProvider : rc.providerOverride,
              personality: lobbyist.personality,
              model: lobbyist.model,
              ownerUserId: lobbyist.ownerUserId,
            },
            contextMessage,
            'lobby',
          );

          if (decision.action !== 'lobby' && decision.action !== 'idle') {
            console.warn(`[SIMULATION] Phase 1.5: Unexpected action from ${lobbyist.displayName}: ${decision.action}`);
          }

          if (decision.action === 'idle') continue;

          const argument = decision.reasoning ?? '';

          /* ── Vote-pact deal parsing (Rule 4: LLM output is untrusted) ──
             Only the whitelisted data.deal.myVote key is read; both agent IDs
             and the bill come from server-side loop variables, never from
             model output. Commitments are server-composed so Phase 2c can
             parse vote intent exactly. Acceptance is deterministic:
             target→lobbyist alignment >= 0.5. */
          if (rc.dealParsingEnabled && dealsCreatedThisTick < rc.maxDealsPerTick) {
            const parsedDeal = parseDealField(decision.data);
            const dealKey = `${lobbyist.id}:${targetAgent.id}:${bill.id}`;
            if (parsedDeal && !dealTriplesThisTick.has(dealKey)) {
              dealTriplesThisTick.add(dealKey);
              try {
                const targetToLobbyist = relMap15.get(`${targetAgent.id}:${lobbyist.id}`) ?? 0.5;
                const dealStatus = targetToLobbyist >= 0.5 ? 'accepted' : 'rejected';

                await db.insert(agentDeals).values({
                  initiatorId: lobbyist.id,
                  targetId: targetAgent.id,
                  billId: bill.id,
                  initiatorCommitment: composeCommitment(parsedDeal.myVote, bill.title),
                  targetCommitment: composeCommitment(desiredVote, bill.title),
                  status: dealStatus,
                  expiresAt: new Date(Date.now() + 2 * rc.tickIntervalMs),
                });
                dealsCreatedThisTick += 1;

                await db.insert(activityEvents).values({
                  type: 'deal_proposed',
                  agentId: lobbyist.id,
                  title: `${lobbyist.displayName} proposed a vote pact with ${targetAgent.displayName}`.slice(0, 200),
                  description:
                    `${lobbyist.displayName} commits to vote ${parsedDeal.myVote.toUpperCase()} on "${bill.title}" ` +
                    `in exchange for ${targetAgent.displayName} voting ${desiredVote.toUpperCase()}. ` +
                    `${targetAgent.displayName} ${dealStatus === 'accepted' ? 'accepted' : 'rejected'} the pact.`,
                  metadata: JSON.stringify({
                    billId: bill.id,
                    billTitle: bill.title,
                    initiatorId: lobbyist.id,
                    targetId: targetAgent.id,
                    status: dealStatus,
                  }),
                });

                broadcast('agent:deal_proposed', {
                  initiatorId: lobbyist.id,
                  initiatorName: lobbyist.displayName,
                  targetId: targetAgent.id,
                  targetName: targetAgent.displayName,
                  billId: bill.id,
                  billTitle: bill.title,
                  status: dealStatus,
                });

                console.warn(`[SIMULATION] Phase 1.5: Vote pact ${dealStatus} — ${lobbyist.displayName} → ${targetAgent.displayName} on "${bill.title}"`);
              } catch (dealErr) {
                console.warn('[SIMULATION] Phase 1.5: Deal insert failed:', dealErr);
              }
            }
          }

          /* Insert lobbyingEvents row */
          await db.insert(lobbyingEvents).values({
            lobbyistId: lobbyist.id,
            targetId: targetAgent.id,
            billId: bill.id,
            argument,
            desiredVote,
            sentimentDelta: 0.03,
          });

          /* Apply +0.03 sentiment: target → lobbyist (the approach was noted) */
          await db.insert(agentRelationships)
            .values({
              agentId: targetAgent.id,
              targetAgentId: lobbyist.id,
              voteAlignment: 0.5,
              sentiment: 0.5,
              forumInteractions: 0,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [agentRelationships.agentId, agentRelationships.targetAgentId],
              set: {
                sentiment: sql`LEAST(1.0, agent_relationships.sentiment + 0.03)`,
                updatedAt: new Date(),
              },
            });

          /* Store lobby note for Phase 2 injection */
          const existingNotes = lobbyNotesMap.get(targetAgent.id) ?? [];
          existingNotes.push(`${lobbyist.displayName}: "${argument}" (wants you to vote ${desiredVote.toUpperCase()})`);
          lobbyNotesMap.set(targetAgent.id, existingNotes);

          /* Activity event */
          await db.insert(activityEvents).values({
            type: 'lobby',
            agentId: lobbyist.id,
            title: `${lobbyist.displayName} lobbied ${targetAgent.displayName}`,
            description: argument,
            metadata: JSON.stringify({ billId: bill.id, billTitle: bill.title, desiredVote, targetId: targetAgent.id }),
          });

          broadcast('agent:lobby', {
            lobbyistId: lobbyist.id,
            lobbyistName: lobbyist.displayName,
            targetId: targetAgent.id,
            targetName: targetAgent.displayName,
            billId: bill.id,
            billTitle: bill.title,
            desiredVote,
            argument,
          });

          console.warn(`[SIMULATION] ${lobbyist.displayName} lobbied ${targetAgent.displayName} on "${bill.title}" (wants ${desiredVote.toUpperCase()})`);
        } catch (agentErr) {
          console.warn(`[SIMULATION] Phase 1.5: LLM error for ${lobbyist.displayName}:`, agentErr);
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 1.5 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 1.7: Floor Amendments                                           */
  /* Agents propose modifications to floor bills before voting occurs.   */
  /* Accepted amendments update bills.fullText before Phase 2 votes.     */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 1.7: Floor Amendments');

    const amendFloorBills = floorWorkingSet;

    if (!rc.floorAmendmentsEnabled || amendFloorBills.length === 0) {
      console.warn('[SIMULATION] Phase 1.7: Skipping — floorAmendmentsEnabled=false or no floor bills.');
    } else {
      const maxAmendmentsPerBill = rc.maxAmendmentsPerBillPerTick ?? 2;
      const amendmentChance = rc.amendmentProposalChance ?? 0.15;

      /* Get all active committee_chair positions for bonus */
      const chairPositions17 = await db.select()
        .from(positions)
        .where(and(eq(positions.isActive, true), eq(positions.type, 'committee_chair')));

      /* Pre-fetch all relationships for amendment voting alignment scoring */
      const activeAgentIds17 = activeAgents.map((a) => a.id);
      const allRels17 = activeAgentIds17.length > 0
        ? await db.select({
            agentId: agentRelationships.agentId,
            targetAgentId: agentRelationships.targetAgentId,
            voteAlignment: agentRelationships.voteAlignment,
          })
          .from(agentRelationships)
          .where(inArray(agentRelationships.agentId, activeAgentIds17))
        : [];
      const relMap17 = new Map<string, number>();
      for (const r of allRels17) {
        relMap17.set(`${r.agentId}:${r.targetAgentId}`, r.voteAlignment);
      }

      /* Pre-select proposers per bill via the existing chance gate (serial,
         cheap), then fire every proposer LLM call across all bills in ONE
         parallel batch. Accepted behavior change vs. the old serial loop:
         an invalid LLM response now consumes one of the maxAmendmentsPerBill
         slots instead of falling through to the next shuffled proposer. */
      const amendmentCalls: Array<{
        bill: (typeof amendFloorBills)[number];
        proposer: (typeof activeAgents)[number];
      }> = [];
      for (const bill of amendFloorBills) {
        /* Eligible proposers: active agents who are NOT the sponsor */
        const eligible = activeAgents.filter((a) => a.id !== bill.sponsorId);

        /* Shuffle to randomize order */
        const shuffled17 = eligible.sort(() => Math.random() - 0.5);

        let selectedForBill = 0;
        for (const proposer of shuffled17) {
          if (selectedForBill >= maxAmendmentsPerBill) break;

          /* Per-agent chance; committee chairs for this bill's committee get +0.15 */
          const isChairForCommittee = chairPositions17.some(
            (p) => p.agentId === proposer.id && p.title.toLowerCase().includes(bill.committee.toLowerCase()),
          );
          const effectiveChance = amendmentChance + (isChairForCommittee ? 0.15 : 0);
          if (Math.random() >= effectiveChance) continue;

          amendmentCalls.push({ bill, proposer });
          selectedForBill++;
        }
      }

      /* Fire all amendment-proposal LLM calls in parallel. The prompt uses
         the stale pre-tick bill.fullText (unchanged semantics — the old
         serial loop did the same). */
      const amendmentResults = await Promise.allSettled(
        amendmentCalls.map(({ bill, proposer }) => {
          const contextMessage =
            `Bill "${bill.title}" is on the floor for a vote. ` +
            `Full text: ${bill.fullText.slice(0, 800)}. ` +
            `Summary: ${bill.summary}. ` +
            `You may propose a floor amendment to refine this legislation before the vote. ` +
            `Choose type: 'addition' (add a new clause), 'strike' (remove a clause), or 'substitute' (rewrite a section). ` +
            `For 'strike' or 'substitute', name the target section in your amendment text (e.g. "SECTION 2"). ` +
            `Keep the amendment under 150 words. Be specific — reference actual content from the bill. ` +
            `Respond with exactly this JSON: ` +
            `{"action":"propose_amendment","reasoning":"one sentence explaining your change","data":{"type":"addition","amendmentText":"The amendment text"}}`;

          return generateAgentDecision(
            {
              id: proposer.id,
              displayName: proposer.displayName,
              alignment: proposer.alignment,
              modelProvider: rc.providerOverride === 'default' ? proposer.modelProvider : rc.providerOverride,
              personality: proposer.personality,
              model: proposer.model,
              ownerUserId: proposer.ownerUserId,
            },
            contextMessage,
            'propose_amendment',
          ).then((decision) => ({ bill, proposer, decision }));
        }),
      );

      /* Accumulates accepted amendments within this tick so a second
         amendment builds on the first instead of the stale fetch.
         billId -> current working full text. */
      const workingTexts = new Map<string, string>();
      for (const bill of amendFloorBills) {
        workingTexts.set(bill.id, bill.fullText);
      }

      /* Apply results SERIALLY in selection order (bill-major) — the
         workingFullText accumulation, the amendment-ordinal count query,
         and the weighted ratification vote must not interleave. */
      for (let i = 0; i < amendmentResults.length; i++) {
        const result = amendmentResults[i];
        const { bill, proposer } = amendmentCalls[i];

        if (result.status === 'rejected') {
          console.warn(`[SIMULATION] Phase 1.7: LLM error for ${proposer.displayName}:`, result.reason);
          continue;
        }

        const { decision } = result.value;

        try {
            if (decision.action !== 'propose_amendment' || !decision.data) continue;

            const amendmentText = String(decision.data['amendmentText'] ?? '').trim();
            const amendmentType = String(decision.data['type'] ?? 'addition').trim() as 'addition' | 'strike' | 'substitute';
            if (!amendmentText || amendmentText.length < 10) continue;

            /* Insert bill amendment row */
            const [insertedAmendment] = await db.insert(billAmendments).values({
              billId: bill.id,
              proposerId: proposer.id,
              amendmentText,
              type: amendmentType,
              status: 'pending',
              reasoning: decision.reasoning,
              votesFor: 0,
              votesAgainst: 0,
            }).returning({ id: billAmendments.id });

            if (!insertedAmendment) continue;

            /* Amendment voting via weighted alignment scoring — NO extra LLM calls */
            const existingYeaVotes = await db.select({ voterId: billVotes.voterId })
              .from(billVotes)
              .where(and(eq(billVotes.billId, bill.id), eq(billVotes.choice, 'yea')));
            const supporterIds = existingYeaVotes.map((v) => v.voterId);

            /* If no prior votes, use all active agents as baseline */
            const voterPool = supporterIds.length > 0 ? supporterIds : activeAgentIds17;

            let votesFor = 0;
            let votesAgainst = 0;
            for (const supporterId of voterPool) {
              if (supporterId === proposer.id) continue;
              const alignment = relMap17.get(`${proposer.id}:${supporterId}`) ?? 0.5;
              votesFor += alignment;
              votesAgainst += (1 - alignment);
            }

            const total17 = votesFor + votesAgainst;
            const amendmentPasses = total17 > 0 && (votesFor / total17) >= rc.billPassagePercentage;

            if (amendmentPasses) {
              /* Section-aware application — never overwrite the bill text.
                 Ordinal for '[... Amendment #k]' annotations; the count
                 includes the row inserted just above. */
              const [amendmentCountRow] = await db
                .select({ total: count() })
                .from(billAmendments)
                .where(eq(billAmendments.billId, bill.id));
              const amendmentNumber = Number(amendmentCountRow?.total ?? 1);

              const nextFullText = applyAmendment(workingTexts.get(bill.id) ?? bill.fullText, {
                type: amendmentType,
                amendmentText,
                amendmentNumber,
              });
              workingTexts.set(bill.id, nextFullText);

              await db.update(bills)
                .set({ fullText: nextFullText, lastActionAt: new Date() })
                .where(eq(bills.id, bill.id));

              await db.update(billAmendments)
                .set({ status: 'accepted', resolvedAt: new Date(), votesFor, votesAgainst })
                .where(eq(billAmendments.id, insertedAmendment.id));

              await updateApproval(proposer.id, 5, 'amendment_accepted', `Floor amendment to "${bill.title}" was accepted`);

              await db.insert(activityEvents).values({
                type: 'floor_amendment',
                agentId: proposer.id,
                title: `${proposer.displayName} proposed floor amendment (accepted)`,
                description: decision.reasoning,
                metadata: JSON.stringify({ billId: bill.id, billTitle: bill.title, amendmentType, status: 'accepted' }),
              });

              broadcast('bill:amended', {
                billId: bill.id,
                billTitle: bill.title,
                amendmentId: insertedAmendment.id,
                proposerName: proposer.displayName,
                amendmentType,
              });

              console.warn(`[SIMULATION] ${proposer.displayName} floor amendment ACCEPTED on "${bill.title}"`);
            } else {
              await db.update(billAmendments)
                .set({ status: 'rejected', resolvedAt: new Date(), votesFor, votesAgainst })
                .where(eq(billAmendments.id, insertedAmendment.id));

              await db.insert(activityEvents).values({
                type: 'floor_amendment',
                agentId: proposer.id,
                title: `${proposer.displayName} proposed floor amendment (rejected)`,
                description: decision.reasoning,
                metadata: JSON.stringify({ billId: bill.id, billTitle: bill.title, amendmentType, status: 'rejected' }),
              });

              broadcast('bill:floor_amendment_proposed', {
                billId: bill.id,
                billTitle: bill.title,
                amendmentId: insertedAmendment.id,
                proposerName: proposer.displayName,
                amendmentType,
                status: 'rejected',
              });

              console.warn(`[SIMULATION] ${proposer.displayName} floor amendment rejected on "${bill.title}"`);
            }
          } catch (agentErr) {
            console.warn(`[SIMULATION] Phase 1.7: Result processing error for ${proposer.displayName}:`, agentErr);
          }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 1.7 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 2: Bill Voting                                                  */
  /* Agents vote on bills currently at 'floor' status.                    */
  /* Considers party whip signal — 78% follow rate.                       */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 2: Bill Voting');

    const floorBills = floorWorkingSet;

    if (floorBills.length === 0) {
      console.warn('[SIMULATION] Phase 2: No floor bills — skipping voting.');
    } else {
      const floorBillIds = floorBills.map((b) => b.id);

      /* Build agent -> partyId map and leader lookup */
      const allMemberships = await db.select().from(partyMemberships);
      const agentPartyMap = new Map<string, string>();
      const partyLeaderMap = new Map<string, string>(); // partyId -> leaderId
      for (const m of allMemberships) {
        agentPartyMap.set(m.agentId, m.partyId);
        if (m.role === 'leader') partyLeaderMap.set(m.partyId, m.agentId);
      }

      /* Pre-fetch relationships for per-agent whip follow rate */
      const activeAgentIds = activeAgents.map((a) => a.id);
      const allRelationshipsForWhip = activeAgentIds.length > 0
        ? await db
            .select({
              agentId: agentRelationships.agentId,
              targetAgentId: agentRelationships.targetAgentId,
              voteAlignment: agentRelationships.voteAlignment,
            })
            .from(agentRelationships)
            .where(inArray(agentRelationships.agentId, activeAgentIds))
        : [];
      // Map: "agentId:targetId" -> voteAlignment
      const relationshipMap = new Map<string, number>();
      for (const rel of allRelationshipsForWhip) {
        relationshipMap.set(`${rel.agentId}:${rel.targetAgentId}`, rel.voteAlignment);
      }

      /* Pre-fetch policy positions for all active agents */
      const allPolicyPositions = activeAgentIds.length > 0
        ? await db
            .select({
              agentId: agentPolicyPositions.agentId,
              category: agentPolicyPositions.category,
              supportCount: agentPolicyPositions.supportCount,
              opposeCount: agentPolicyPositions.opposeCount,
            })
            .from(agentPolicyPositions)
            .where(inArray(agentPolicyPositions.agentId, activeAgentIds))
        : [];
      // Map: "agentId:category" -> { support, oppose }
      const policyPositionMap = new Map<string, { support: number; oppose: number }>();
      for (const pp of allPolicyPositions) {
        policyPositionMap.set(`${pp.agentId}:${pp.category}`, { support: pp.supportCount, oppose: pp.opposeCount });
      }

      /* Pre-fetch all existing votes for floor bills in one query */
      const allExistingVotes = await db
        .select({ billId: billVotes.billId, voterId: billVotes.voterId })
        .from(billVotes)
        .where(and(
          inArray(billVotes.billId, floorBillIds),
          inArray(billVotes.voterId, activeAgents.map((a) => a.id)),
        ));
      const votedSet = new Set(allExistingVotes.map((v) => `${v.voterId}:${v.billId}`));

      /* Track votes per agent for absenteeism check */
      const agentVoteCounts = new Map<string, number>();

      for (const bill of floorBills) {
        /* Determine which agents need to vote on this bill */
        const agentsToVote: typeof activeAgents = [];
        const whipChoices = new Map<string, string>(); // agentId -> whip-forced choice

        for (const agent of activeAgents) {
          if (votedSet.has(`${agent.id}:${bill.id}`)) continue;

          const agentPartyId = agentPartyMap.get(agent.id);
          const billSignals = whipSignals.get(bill.id);
          const whipSignal = agentPartyId && billSignals ? billSignals.get(agentPartyId) : undefined;

          /* Per-agent whip follow rate based on relationship, approval, and policy */
          const agentPartyIdForWhip = agentPartyMap.get(agent.id);
          const partyLeaderId = agentPartyIdForWhip ? partyLeaderMap.get(agentPartyIdForWhip) : undefined;
          const leaderAlignment = partyLeaderId ? relationshipMap.get(`${agent.id}:${partyLeaderId}`) ?? null : null;
          const policyPos = bill.committee ? policyPositionMap.get(`${agent.id}:${bill.committee}`) : undefined;
          const agentWhipRate = whipSignal
            ? computeWhipFollowRate(
                leaderAlignment,
                agent.approvalRating,
                policyPos?.support ?? 0,
                policyPos?.oppose ?? 0,
                rc.partyWhipFollowRate,
              )
            : 0;
          if (whipSignal && Math.random() < agentWhipRate) {
            whipChoices.set(agent.id, whipSignal);
          } else {
            agentsToVote.push(agent);
          }
        }

        /* Build context message for this bill (shared across agents) */
        const baseContext =
          `Bill up for vote: "${bill.title}". ` +
          `Summary: ${bill.summary}. ` +
          `Committee: ${bill.committee}. `;

        /* Fire all LLM calls for this bill in parallel */
        const results = await Promise.allSettled(
          agentsToVote.map((agent) => {
            const agentPartyId = agentPartyMap.get(agent.id);
            const billSignals2 = whipSignals.get(bill.id);
            const whipSignal = agentPartyId && billSignals2 ? billSignals2.get(agentPartyId) : undefined;
            const whipNote = whipSignal
              ? ` Your party recommends voting ${whipSignal}. You may follow or vote independently.`
              : '';

            /* Phase 1.5 lobby note injection */
            const lobbyNotes = lobbyNotesMap.get(agent.id) ?? [];
            const lobbyNote = lobbyNotes.length > 0
              ? `\n\n## Lobbying\nBefore this vote, the following agents personally appealed to you:\n` +
                lobbyNotes.map(n => `  - ${n}`).join('\n')
              : '';

            const contextMessage =
              baseContext + whipNote + lobbyNote +
              ` Respond with exactly this JSON structure: {"action":"vote","reasoning":"one sentence","data":{"choice":"yea"}} ` +
              `Use "yea" to support or "nay" to oppose.`;

            return generateAgentDecision(
              {
                id: agent.id,
                displayName: agent.displayName,
                alignment: agent.alignment,
                modelProvider: rc.providerOverride === 'default' ? agent.modelProvider : rc.providerOverride,
                personality: agent.personality,
                model: agent.model,
                ownerUserId: agent.ownerUserId,
              },
              contextMessage,
              'bill_voting',
            ).then((decision) => ({ agent, decision, whipSignal }));
          }),
        );

        /* Process whip-forced votes (no LLM call, immediate insert) */
        for (const [agentId, choice] of whipChoices) {
          const agent = activeAgents.find((a) => a.id === agentId)!;

          await db.insert(billVotes).values({ billId: bill.id, voterId: agent.id, choice });
          await db.insert(activityEvents).values({
            type: 'vote',
            agentId: agent.id,
            title: 'Vote cast',
            description: `${agent.displayName} voted ${choice.toUpperCase()} on "${bill.title}"`,
            metadata: JSON.stringify({ billId: bill.id, choice, followedWhip: true, reasoning: 'Followed party whip signal', provider: agent.modelProvider }),
          });
          broadcast('agent:vote', { agentId: agent.id, agentName: agent.displayName, billId: bill.id, billTitle: bill.title, choice });
          console.warn(`[SIMULATION] ${agent.displayName} voted ${choice.toUpperCase()} on "${bill.title}" (whip)`);
          agentVoteCounts.set(agent.id, (agentVoteCounts.get(agent.id) ?? 0) + 1);
        }

        /* Process LLM decision results */
        for (const result of results) {
          if (result.status === 'rejected') {
            console.warn('[SIMULATION] Phase 2: Agent LLM call rejected:', result.reason);
            continue;
          }
          const { agent, decision, whipSignal } = result.value;

          if (decision.action === 'idle') continue; // API error fallback

          const isVote = decision.action === 'vote' || decision.action === 'yea' || decision.action === 'nay';
          if (!isVote) continue;

          const rawChoice = decision.action === 'yea' || decision.action === 'nay'
            ? decision.action
            : String(decision.data?.['choice'] ?? 'nay');
          const cn = rawChoice.toLowerCase();
          const choice = (cn === 'yea' || cn === 'aye' || cn === 'yes' || cn === 'y' || cn.includes('yea')) ? 'yea' : 'nay';

          await db.insert(billVotes).values({ billId: bill.id, voterId: agent.id, choice });
          await db.insert(activityEvents).values({
            type: 'vote',
            agentId: agent.id,
            title: 'Vote cast',
            description: `${agent.displayName} voted ${choice.toUpperCase()} on "${bill.title}"`,
            metadata: JSON.stringify({
              billId: bill.id,
              choice,
              followedWhip: !!(whipSignal && choice === whipSignal),
              reasoning: (decision.reasoning ?? '').slice(0, 500),
              provider: agent.modelProvider,
            }),
          });
          broadcast('agent:vote', { agentId: agent.id, agentName: agent.displayName, billId: bill.id, billTitle: bill.title, choice });
          console.warn(`[SIMULATION] ${agent.displayName} voted ${choice.toUpperCase()} on "${bill.title}"`);
          agentVoteCounts.set(agent.id, (agentVoteCounts.get(agent.id) ?? 0) + 1);

          /* Approval: whip signal defection */
          if (whipSignal) {
            const followedWhip = choice === whipSignal;
            if (!followedWhip) {
              await updateApproval(
                agent.id,
                -5,
                'whip_defected',
                `Voted against party whip signal on "${bill.title}" (whip said ${whipSignal.toUpperCase()}, voted ${choice.toUpperCase()})`,
              );
            }
          }
        }
      }

      /* Approval: absenteeism */
      for (const agent of activeAgents) {
        if (floorBills.length > 0 && (agentVoteCounts.get(agent.id) ?? 0) === 0) {
          await updateApproval(
            agent.id,
            -3,
            'absenteeism',
            `Missed floor vote${floorBills.length > 1 ? 's' : ''} on ${floorBills.length} bill${floorBills.length > 1 ? 's' : ''}`,
          );
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 2 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 2b: Update Relationship & Policy Tracking                     */
  /* Delta + decay model: decay existing relationships toward neutral,   */
  /* then apply incremental deltas from current-tick votes only.         */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 2b: Updating relationship and policy tracking');

    const activeAgentIds = activeAgents.map((a) => a.id);

    /* Step A — Decay all existing relationships toward neutral (0.5) */
    const decayRate = rc.relationshipDecayRate ?? 0.05;
    if (activeAgentIds.length > 0) {
      /* Use Drizzle query builder to avoid raw SQL array serialization issues */
      await db.update(agentRelationships)
        .set({
          voteAlignment: sql`vote_alignment + (0.5 - vote_alignment) * ${decayRate}`,
          sentiment: sql`sentiment + (0.5 - sentiment) * ${decayRate}`,
          updatedAt: new Date(),
        })
        .where(inArray(agentRelationships.agentId, activeAgentIds));
      await db.update(agentRelationships)
        .set({
          voteAlignment: sql`vote_alignment + (0.5 - vote_alignment) * ${decayRate}`,
          sentiment: sql`sentiment + (0.5 - sentiment) * ${decayRate}`,
          updatedAt: new Date(),
        })
        .where(inArray(agentRelationships.targetAgentId, activeAgentIds));
    }

    /* Step B — Collect current-tick votes from bills currently on the floor */
    const currentTickVoteMap = new Map<string, Map<string, string>>(); // agentId -> (billId -> choice)
    const currentFloorBills = await db.select({ id: bills.id }).from(bills).where(eq(bills.status, 'floor'));
    if (currentFloorBills.length > 0) {
      const currentFloorBillIds = currentFloorBills.map((b) => b.id);
      const tickVotes = await db
        .select({ voterId: billVotes.voterId, billId: billVotes.billId, choice: billVotes.choice })
        .from(billVotes)
        .where(and(
          inArray(billVotes.billId, currentFloorBillIds),
          inArray(billVotes.choice, ['yea', 'nay']),
        ));
      for (const v of tickVotes) {
        if (!currentTickVoteMap.has(v.voterId)) currentTickVoteMap.set(v.voterId, new Map());
        currentTickVoteMap.get(v.voterId)!.set(v.billId, v.choice);
      }
    }

    /* Compute pairwise deltas from current-tick co-votes */
    const pairDeltas = new Map<string, number>(); // "agentA:agentB" -> cumulative delta

    for (let i = 0; i < activeAgentIds.length; i++) {
      const aVotes = currentTickVoteMap.get(activeAgentIds[i]);
      if (!aVotes) continue;

      for (let j = i + 1; j < activeAgentIds.length; j++) {
        const bVotes = currentTickVoteMap.get(activeAgentIds[j]);
        if (!bVotes) continue;

        let delta = 0;
        for (const [billId, choiceA] of aVotes) {
          const choiceB = bVotes.get(billId);
          if (!choiceB) continue;
          delta += choiceA === choiceB ? 0.03 : -0.04;
        }

        if (delta !== 0) {
          const keyAB = `${activeAgentIds[i]}:${activeAgentIds[j]}`;
          const keyBA = `${activeAgentIds[j]}:${activeAgentIds[i]}`;
          pairDeltas.set(keyAB, (pairDeltas.get(keyAB) ?? 0) + delta);
          pairDeltas.set(keyBA, (pairDeltas.get(keyBA) ?? 0) + delta);
        }
      }
    }

    /* Apply deltas as upserts (both directions) */
    for (const [key, delta] of pairDeltas) {
      const [agentA, agentB] = key.split(':');
      await db
        .insert(agentRelationships)
        .values({
          agentId: agentA,
          targetAgentId: agentB,
          voteAlignment: Math.max(0.0, Math.min(1.0, 0.5 + delta)),
          sentiment: 0.5,
          forumInteractions: 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [agentRelationships.agentId, agentRelationships.targetAgentId],
          set: {
            voteAlignment: sql`LEAST(1.0, GREATEST(0.0, agent_relationships.vote_alignment + ${delta}))`,
            updatedAt: new Date(),
          },
        });
    }

    /* Update policy positions from votes on all bills (all-time, not just current tick) */
    const allVotesForPolicy = await db
      .select({ voterId: billVotes.voterId, billId: billVotes.billId, choice: billVotes.choice })
      .from(billVotes)
      .where(inArray(billVotes.choice, ['yea', 'nay']));
    const policyVoteMap = new Map<string, Map<string, string>>();
    for (const v of allVotesForPolicy) {
      if (!policyVoteMap.has(v.voterId)) policyVoteMap.set(v.voterId, new Map());
      policyVoteMap.get(v.voterId)!.set(v.billId, v.choice);
    }

    const allBillsForPolicy = await db.select({ id: bills.id, committee: bills.committee }).from(bills);
    const billCategoryMap = new Map(allBillsForPolicy.map((b) => [b.id, b.committee]));

    for (const agent of activeAgents) {
      const agentVotes = policyVoteMap.get(agent.id);
      if (!agentVotes) continue;

      const categoryCounts = new Map<string, { support: number; oppose: number }>();
      for (const [billId, choice] of agentVotes) {
        const category = billCategoryMap.get(billId);
        if (!category) continue;
        if (!categoryCounts.has(category)) categoryCounts.set(category, { support: 0, oppose: 0 });
        const counts = categoryCounts.get(category)!;
        if (choice === 'yea') counts.support++;
        else counts.oppose++;
      }

      for (const [category, counts] of categoryCounts) {
        await db
          .insert(agentPolicyPositions)
          .values({ agentId: agent.id, category, supportCount: counts.support, opposeCount: counts.oppose, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [agentPolicyPositions.agentId, agentPolicyPositions.category],
            set: { supportCount: counts.support, opposeCount: counts.oppose, updatedAt: new Date() },
          });
      }
    }

    console.warn(`[SIMULATION] Phase 2b: Applied decay + ${pairDeltas.size} relationship deltas`);

    /* ---------------------------------------------------------------- */
    /* PHASE 2c: Deal Honor Check                                         */
    /* After votes cast, check whether agents honored deal commitments.  */
    /* ---------------------------------------------------------------- */
    if (rc.lobbyingEnabled) {
      try {
        console.warn('[SIMULATION] Phase 2c: Deal Honor Check');

        const currentFloorBillIds2c = currentFloorBills.map((b) => b.id);

        if (currentFloorBillIds2c.length > 0) {
          /* Find all accepted, non-expired deals for this tick's floor bills */
          const pendingDeals = await db.select().from(agentDeals)
            .where(and(
              inArray(agentDeals.billId, currentFloorBillIds2c),
              eq(agentDeals.status, 'accepted'),
              gt(agentDeals.expiresAt, new Date()),
            ));

          for (const deal of pendingDeals) {
            const [initiatorVote] = await db.select()
              .from(billVotes)
              .where(and(eq(billVotes.billId, deal.billId), eq(billVotes.voterId, deal.initiatorId)))
              .limit(1);

            const [targetVote] = await db.select()
              .from(billVotes)
              .where(and(eq(billVotes.billId, deal.billId), eq(billVotes.voterId, deal.targetId)))
              .limit(1);

            /* Parse commitment text for 'yea'/'nay' intent — exact match on the
               server-composed 'vote <yea|nay>' prefix (bill titles can contain
               the substring 'yea', e.g. "Fiscal Year..."), with the legacy
               substring heuristic as fallback for non-conforming strings. */
            const initiatorPromisedYea = commitmentPromisesYea(deal.initiatorCommitment);
            const targetPromisedYea = commitmentPromisesYea(deal.targetCommitment);

            const initiatorHonored = initiatorVote
              ? (initiatorPromisedYea ? initiatorVote.choice === 'yea' : initiatorVote.choice === 'nay')
              : false;
            const targetHonored = targetVote
              ? (targetPromisedYea ? targetVote.choice === 'yea' : targetVote.choice === 'nay')
              : false;

            const bothHonored = initiatorHonored && targetHonored;
            const newStatus = bothHonored ? 'honored' : (!initiatorHonored || !targetHonored) ? 'broken' : 'proposed';

            await db.update(agentDeals).set({
              status: newStatus,
              initiatorHonored,
              targetHonored,
              resolvedAt: new Date(),
            }).where(eq(agentDeals.id, deal.id));

            /* Look up display names for WS events */
            const initiatorAgent = activeAgents.find((a) => a.id === deal.initiatorId);
            const targetAgent2c = activeAgents.find((a) => a.id === deal.targetId);
            const initiatorName = initiatorAgent?.displayName ?? 'Unknown';
            const targetName2c = targetAgent2c?.displayName ?? 'Unknown';

            /* Find bill title for WS event — look in tick-scoped bill arrays first */
            const dealBillFull = [...passedBillsThisTick, ...failedBillsThisTick]
              .find((b) => b.id === deal.billId);
            const dealBillTitle = dealBillFull?.title ?? deal.billId;

            if (bothHonored) {
              /* Mutual alignment boost */
              await db.insert(agentRelationships)
                .values({ agentId: deal.initiatorId, targetAgentId: deal.targetId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
                .onConflictDoUpdate({
                  target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                  set: { voteAlignment: sql`LEAST(1.0, agent_relationships.vote_alignment + 0.08)`, updatedAt: new Date() },
                });
              await db.insert(agentRelationships)
                .values({ agentId: deal.targetId, targetAgentId: deal.initiatorId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
                .onConflictDoUpdate({
                  target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                  set: { voteAlignment: sql`LEAST(1.0, agent_relationships.vote_alignment + 0.08)`, updatedAt: new Date() },
                });
              broadcast('agent:deal_honored', {
                dealId: deal.id,
                initiatorName,
                targetName: targetName2c,
                billTitle: dealBillTitle,
              });
              console.warn(`[SIMULATION] Phase 2c: Deal honored — ${initiatorName} & ${targetName2c} on "${dealBillTitle}"`);
            } else {
              /* Breaker penalties */
              if (!initiatorHonored) {
                await db.insert(agentRelationships)
                  .values({ agentId: deal.targetId, targetAgentId: deal.initiatorId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
                  .onConflictDoUpdate({
                    target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                    set: {
                      voteAlignment: sql`GREATEST(0.0, agent_relationships.vote_alignment - 0.15)`,
                      sentiment: sql`GREATEST(0.0, agent_relationships.sentiment - 0.12)`,
                      updatedAt: new Date(),
                    },
                  });
                broadcast('agent:deal_broken', {
                  dealId: deal.id,
                  breakerId: deal.initiatorId,
                  breakerName: initiatorName,
                  billTitle: dealBillTitle,
                });
                brokenDealsThisTick.push({
                  dealId: deal.id,
                  wrongedPartyId: deal.targetId,
                  wrongedPartyName: targetName2c,
                });
                console.warn(`[SIMULATION] Phase 2c: Deal broken by ${initiatorName} on "${dealBillTitle}"`);
              }
              if (!targetHonored) {
                await db.insert(agentRelationships)
                  .values({ agentId: deal.initiatorId, targetAgentId: deal.targetId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
                  .onConflictDoUpdate({
                    target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                    set: {
                      voteAlignment: sql`GREATEST(0.0, agent_relationships.vote_alignment - 0.15)`,
                      sentiment: sql`GREATEST(0.0, agent_relationships.sentiment - 0.12)`,
                      updatedAt: new Date(),
                    },
                  });
                broadcast('agent:deal_broken', {
                  dealId: deal.id,
                  breakerId: deal.targetId,
                  breakerName: targetName2c,
                  billTitle: dealBillTitle,
                });
                brokenDealsThisTick.push({
                  dealId: deal.id,
                  wrongedPartyId: deal.initiatorId,
                  wrongedPartyName: initiatorName,
                });
                console.warn(`[SIMULATION] Phase 2c: Deal broken by ${targetName2c} on "${dealBillTitle}"`);
              }
            }
          }

          console.warn(`[SIMULATION] Phase 2c: Checked ${pendingDeals.length} deals`);
        }
      } catch (err2c) {
        console.warn('[SIMULATION] Phase 2c error:', err2c);
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 2b error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 3: Committee Review                                             */
  /* Committee chairs approve, amend, or table bills in committee.        */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 3: Committee Review'); broadcast('tick:phase', { phase: 'committee' });

    const halfDelay = rc.billAdvancementDelayMs / 2;
    const halfDelayAgo = new Date(Date.now() - halfDelay);

    const committeeBillsForReview = await db
      .select()
      .from(bills)
      .where(
        and(
          eq(bills.status, 'committee'),
          lte(bills.lastActionAt, halfDelayAgo),
          sql`${bills.committeeDecision} IS NULL`,
        ),
      );

    if (committeeBillsForReview.length === 0) {
      console.warn('[SIMULATION] Phase 3: No bills awaiting committee review.');
    } else {
      /* Get all active committee_chair positions */
      const chairPositions = await db
        .select()
        .from(positions)
        .where(and(eq(positions.isActive, true), eq(positions.type, 'committee_chair')));

      /* Pre-fetch chair-sponsor relationships and chair policy positions for enrichment */
      const chairIds = chairPositions.map((p) => p.agentId).filter((id): id is string => id !== null);
      const chairRelRows = chairIds.length > 0
        ? await db
            .select({
              agentId: agentRelationships.agentId,
              targetAgentId: agentRelationships.targetAgentId,
              voteAlignment: agentRelationships.voteAlignment,
            })
            .from(agentRelationships)
            .where(inArray(agentRelationships.agentId, chairIds))
        : [];
      const chairRelMap = new Map<string, number>();
      for (const r of chairRelRows) {
        chairRelMap.set(`${r.agentId}:${r.targetAgentId}`, r.voteAlignment);
      }

      const chairPolicyRows = chairIds.length > 0
        ? await db
            .select({
              agentId: agentPolicyPositions.agentId,
              category: agentPolicyPositions.category,
              supportCount: agentPolicyPositions.supportCount,
              opposeCount: agentPolicyPositions.opposeCount,
            })
            .from(agentPolicyPositions)
            .where(inArray(agentPolicyPositions.agentId, chairIds))
        : [];
      const chairPolicyMap = new Map<string, { support: number; oppose: number }>();
      for (const pp of chairPolicyRows) {
        chairPolicyMap.set(`${pp.agentId}:${pp.category}`, { support: pp.supportCount, oppose: pp.opposeCount });
      }

      /* Active committee memberships (Phase 0.5) — markup ratification
         voters and hearing attendees. Failure-soft: an empty roster only
         means markups can't ratify and hearings list no attendees. */
      const activeAgentIdSet3 = new Set(activeAgents.map((a) => a.id));
      const membersByCommittee3 = new Map<string, string[]>();
      try {
        const membershipRows3 = await db
          .select({ agentId: committeeMemberships.agentId, committee: committeeMemberships.committee })
          .from(committeeMemberships)
          .where(eq(committeeMemberships.isActive, true));
        for (const m of membershipRows3) {
          if (!activeAgentIdSet3.has(m.agentId)) continue;
          const list = membersByCommittee3.get(m.committee) ?? [];
          list.push(m.agentId);
          membersByCommittee3.set(m.committee, list);
        }
      } catch (membershipErr) {
        console.warn('[SIMULATION] Phase 3: Membership fetch error (markup ratification degraded):', membershipErr);
      }

      /* One committee_hearing row per reviewed (bill, tick). The public
         Calendar (GET /api/calendar + CalendarPage) already reads and
         styles committee_hearing — governmentEvents had zero writers. */
      const insertHearing3 = async (
        bill: (typeof committeeBillsForReview)[number],
        chair: (typeof activeAgents)[number],
        outcome: string,
      ): Promise<void> => {
        try {
          await db.insert(governmentEvents).values({
            type: 'committee_hearing',
            title: `${bill.committee} Committee: ${bill.title}`.slice(0, 200),
            description: (bill.summary ?? '').slice(0, 500),
            scheduledAt: new Date(),
            durationMinutes: 60,
            organizerId: chair.id,
            attendeeIds: JSON.stringify(membersByCommittee3.get(bill.committee) ?? []),
            status: 'completed',
            outcome,
            relatedBillId: bill.id,
            isPublic: true,
          });
        } catch (hearingErr) {
          console.warn('[SIMULATION] Phase 3: Hearing insert error:', hearingErr);
        }
      };

      /* Separate bills into auto-tabled (pre-filter) vs LLM-reviewed */
      const billsForLLMReview: typeof committeeBillsForReview = [];

      for (const bill of committeeBillsForReview) {
        const committeeChairPos = chairPositions.find((p) =>
          p.title.toLowerCase().includes(bill.committee.toLowerCase()),
        );
        if (!committeeChairPos) {
          console.warn(`[SIMULATION] Phase 3: No chair for committee "${bill.committee}" — auto-advancing.`);
          billsForLLMReview.push(bill);
          continue;
        }
        const chair = activeAgents.find((a) => a.id === committeeChairPos.agentId);
        if (!chair) {
          billsForLLMReview.push(bill);
          continue;
        }

        const sponsor = activeAgents.find((a) => a.id === bill.sponsorId);
        const distance = alignmentDistance(chair.alignment, sponsor?.alignment ?? null);

        /* Pre-filter: strong opposition alignment tables without LLM call */
        if (distance >= 3 && Math.random() < rc.committeeTableRateOpposing) {
          await db.update(bills).set({ status: 'tabled', committeeDecision: 'tabled', committeeChairId: chair.id, lastActionAt: new Date() }).where(eq(bills.id, bill.id));
          await db.insert(activityEvents).values({
            type: 'committee_review', agentId: chair.id, title: 'Bill tabled in committee',
            description: `${chair.displayName} tabled "${bill.title}" in the ${bill.committee} Committee (ideological opposition)`,
            metadata: JSON.stringify({ billId: bill.id, decision: 'tabled', reasoning: 'Strong ideological opposition — auto-tabled', alignmentDistance: distance }),
          });
          broadcast('bill:tabled', { billId: bill.id, title: bill.title, chairId: chair.id, chairName: chair.displayName, committee: bill.committee });
          console.warn(`[SIMULATION] ${chair.displayName} auto-tabled "${bill.title}" (alignment distance ${distance})`);
          await updateApproval(bill.sponsorId, -8, 'bill_failed_committee', `Sponsored "${bill.title}" which was tabled in committee`);

          await db.insert(agentRelationships)
            .values({ agentId: bill.sponsorId, targetAgentId: chair.id, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
            .onConflictDoUpdate({
              target: [agentRelationships.agentId, agentRelationships.targetAgentId],
              set: { sentiment: sql`GREATEST(0.0, agent_relationships.sentiment - 0.08)`, updatedAt: new Date() },
            });
          await insertHearing3(bill, chair, 'tabled');
          continue;
        }

        billsForLLMReview.push(bill);
      }

      const reviewResults = await Promise.allSettled(
        billsForLLMReview.map((bill) => {
          const committeeChairPos = chairPositions.find((p) =>
            p.title.toLowerCase().includes(bill.committee.toLowerCase()),
          );
          if (!committeeChairPos) {
            return Promise.resolve(null);
          }
          const chair = activeAgents.find((a) => a.id === committeeChairPos.agentId);
          if (!chair) return Promise.resolve(null);

          const sponsor = activeAgents.find((a) => a.id === bill.sponsorId);
          const sponsorName = sponsor?.displayName ?? 'Unknown';
          const sponsorAlignment = sponsor?.alignment ?? 'unknown';
          const distance = alignmentDistance(chair.alignment, sponsor?.alignment ?? null);

          /* Enrich context with chair's policy history and relationship data */
          const chairPolicy = chairPolicyMap.get(`${chair.id}:${bill.committee}`);
          const chairSponsorAlignment = sponsor ? chairRelMap.get(`${chair.id}:${sponsor.id}`) : undefined;

          let enrichmentNote = '';
          if (chairPolicy) {
            const total = chairPolicy.support + chairPolicy.oppose;
            if (total > 0) {
              const supportPct = Math.round((chairPolicy.support / total) * 100);
              enrichmentNote += ` Your voting record on ${bill.committee} bills: ${supportPct}% support (${total} votes).`;
            }
          }
          if (chairSponsorAlignment !== undefined) {
            enrichmentNote += ` Your vote alignment with the sponsor: ${Math.round(chairSponsorAlignment * 100)}%.`;
          }
          if (distance >= 2) {
            enrichmentNote += ` You have historically opposed bills from ${sponsorAlignment}-aligned sponsors.`;
          }

          /* Markup contract (flag on): a scoped amendment the committee
             ratifies deterministically — reuses the Phase 1.7 machinery.
             Legacy contract (flag off): full-text amendedText, verbatim. */
          const decisionContract = rc.committeeMarkupEnabled
            ? ` Options: approve as-is, amend (propose one scoped amendment your committee will vote on), or table (kill) it. ` +
              `Respond with exactly this JSON: {"action":"committee_review","reasoning":"one sentence","data":{"decision":"approved","amendmentType":"addition","amendmentText":""}} ` +
              `Use "approved", "amended", or "tabled" for decision. If amending: set amendmentType to "addition", "strike", or "substitute" and put the amendment (under 150 words) in amendmentText — for "strike" or "substitute", name the target section (e.g. "SECTION 2"). If not amending, leave amendmentText empty.`
            : ` Options: approve as-is, amend the text, or table (kill) it. ` +
              `Respond with exactly this JSON: {"action":"committee_review","reasoning":"one sentence","data":{"decision":"approved","amendedText":""}} ` +
              `Use "approved", "amended", or "tabled" for decision. If amending, provide full revised text in amendedText. If not amending, leave amendedText empty.`;

          const contextMessage =
            `You chair the ${bill.committee} Committee. Review this bill: "${bill.title}". ` +
            `Summary: ${bill.summary}. Full text excerpt: ${bill.fullText.slice(0, 600)}. ` +
            `Sponsored by ${sponsorName} (${sponsorAlignment}).` +
            enrichmentNote +
            decisionContract;

          return generateAgentDecision(
            {
              id: chair.id,
              displayName: chair.displayName,
              alignment: chair.alignment,
              modelProvider: rc.providerOverride === 'default' ? chair.modelProvider : rc.providerOverride,
              personality: chair.personality,
              model: chair.model,
              ownerUserId: chair.ownerUserId,
            },
            contextMessage,
            'committee_review',
          ).then((decision) => ({ bill, chair, decision }));
        }),
      );

      /* Process results sequentially (DB writes are fast) */
      for (const result of reviewResults) {
        if (result.status === 'rejected') {
          console.warn('[SIMULATION] Phase 3: Committee review rejected:', result.reason);
          continue;
        }
        const entry = result.value;
        if (!entry) continue;
        const { bill, chair, decision } = entry;

        if (decision.action !== 'committee_review' || !decision.data) continue;

        const reviewDecision = String(decision.data['decision'] ?? 'approved').toLowerCase();
        const amendedText = String(decision.data['amendedText'] ?? '').trim();

        /* Public hearing record — once per reviewed (bill, tick). Outcome is
           the chair's decision, whitelisted (LLM output is untrusted). */
        const hearingOutcome3 =
          reviewDecision === 'tabled' || reviewDecision === 'amended' ? reviewDecision : 'approved';
        await insertHearing3(bill, chair, hearingOutcome3);

        if (reviewDecision === 'tabled') {
          await db.update(bills).set({ status: 'tabled', committeeDecision: 'tabled', committeeChairId: chair.id, lastActionAt: new Date() }).where(eq(bills.id, bill.id));
          await db.insert(activityEvents).values({
            type: 'committee_review', agentId: chair.id, title: 'Bill tabled in committee',
            description: `${chair.displayName} tabled "${bill.title}" in the ${bill.committee} Committee`,
            metadata: JSON.stringify({ billId: bill.id, decision: 'tabled', reasoning: decision.reasoning }),
          });
          broadcast('bill:tabled', { billId: bill.id, title: bill.title, chairId: chair.id, chairName: chair.displayName, committee: bill.committee });
          console.warn(`[SIMULATION] ${chair.displayName} tabled "${bill.title}" in committee`);
          await updateApproval(bill.sponsorId, -8, 'bill_failed_committee', `Sponsored "${bill.title}" which was tabled in committee`);

          /* Relationship: sponsor resents chair for tabling their bill */
          await db.insert(agentRelationships)
            .values({ agentId: bill.sponsorId, targetAgentId: chair.id, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
            .onConflictDoUpdate({
              target: [agentRelationships.agentId, agentRelationships.targetAgentId],
              set: { sentiment: sql`GREATEST(0.0, agent_relationships.sentiment - 0.08)`, updatedAt: new Date() },
            });
        } else if (reviewDecision === 'amended' && rc.committeeMarkupEnabled) {
          /* Markup path: the chair's scoped amendment is applied through
             applyAmendment (never a wholesale fullText overwrite) after the
             committee members ratify it with the Phase 1.7 weighted-
             alignment arithmetic — no extra LLM calls. */
          const rawMarkupType3 = String(decision.data['amendmentType'] ?? 'addition').trim().toLowerCase();
          const markupType3: 'addition' | 'strike' | 'substitute' =
            rawMarkupType3 === 'strike' || rawMarkupType3 === 'substitute' ? rawMarkupType3 : 'addition';
          const markupText3 = String(decision.data['amendmentText'] ?? '').trim().slice(0, 1500);

          if (markupText3.length < 10) {
            /* No usable amendment text — approve unamended (safe default) */
            await db.update(bills).set({ committeeDecision: 'approved', committeeChairId: chair.id }).where(eq(bills.id, bill.id));
            await db.insert(activityEvents).values({
              type: 'committee_review', agentId: chair.id, title: 'Bill approved by committee',
              description: `${chair.displayName} approved "${bill.title}" out of the ${bill.committee} Committee`,
              metadata: JSON.stringify({ billId: bill.id, decision: 'approved', reasoning: decision.reasoning, markup: 'invalid_amendment_text' }),
            });
            console.warn(`[SIMULATION] ${chair.displayName} approved "${bill.title}" from committee (markup text invalid)`);
          } else {
            const [markupAmendment3] = await db.insert(billAmendments).values({
              billId: bill.id,
              proposerId: chair.id,
              amendmentText: markupText3,
              type: markupType3,
              status: 'pending',
              reasoning: decision.reasoning,
              votesFor: 0,
              votesAgainst: 0,
            }).returning({ id: billAmendments.id });

            /* Deterministic ratification by the committee's members (chair
               excluded): chair→member voteAlignment, default 0.5. An empty
               roster (mid-migration DB) never ratifies — bill advances
               unamended. */
            const memberVoterIds3 = (membersByCommittee3.get(bill.committee) ?? []).filter((id) => id !== chair.id);
            const memberAlignments3 = memberVoterIds3.map((id) => chairRelMap.get(`${chair.id}:${id}`) ?? 0.5);
            const { votesFor, votesAgainst, passed } = tallyWeightedRatification(memberAlignments3, rc.billPassagePercentage);

            if (passed && markupAmendment3) {
              const [markupCountRow3] = await db
                .select({ total: count() })
                .from(billAmendments)
                .where(eq(billAmendments.billId, bill.id));
              const markupOrdinal3 = Number(markupCountRow3?.total ?? 1);

              const nextFullText3 = applyAmendment(bill.fullText, {
                type: markupType3,
                amendmentText: markupText3,
                amendmentNumber: markupOrdinal3,
              });

              await db.update(bills)
                .set({ fullText: nextFullText3, committeeDecision: 'amended', committeeChairId: chair.id, lastActionAt: new Date() })
                .where(eq(bills.id, bill.id));
              await db.update(billAmendments)
                .set({ status: 'accepted', resolvedAt: new Date(), votesFor, votesAgainst })
                .where(eq(billAmendments.id, markupAmendment3.id));
              await db.insert(activityEvents).values({
                type: 'committee_review', agentId: chair.id, title: 'Bill amended in committee',
                description: `${chair.displayName} amended "${bill.title}" in the ${bill.committee} Committee — markup ratified by members`,
                metadata: JSON.stringify({ billId: bill.id, decision: 'amended', reasoning: decision.reasoning, amendmentType: markupType3, votesFor, votesAgainst, ratified: true }),
              });
              broadcast('bill:committee_amended', { billId: bill.id, title: bill.title, chairId: chair.id, chairName: chair.displayName, committee: bill.committee });
              console.warn(`[SIMULATION] ${chair.displayName} markup on "${bill.title}" RATIFIED (${votesFor.toFixed(2)}-${votesAgainst.toFixed(2)})`);
            } else {
              if (markupAmendment3) {
                await db.update(billAmendments)
                  .set({ status: 'rejected', resolvedAt: new Date(), votesFor, votesAgainst })
                  .where(eq(billAmendments.id, markupAmendment3.id));
              }
              await db.update(bills).set({ committeeDecision: 'approved', committeeChairId: chair.id }).where(eq(bills.id, bill.id));
              await db.insert(activityEvents).values({
                type: 'committee_review', agentId: chair.id, title: 'Committee markup rejected — bill approved unamended',
                description: `${chair.displayName} proposed a markup to "${bill.title}" but the ${bill.committee} Committee did not ratify it`,
                metadata: JSON.stringify({ billId: bill.id, decision: 'approved', reasoning: decision.reasoning, amendmentType: markupType3, votesFor, votesAgainst, ratified: false }),
              });
              console.warn(`[SIMULATION] ${chair.displayName} markup on "${bill.title}" NOT ratified (${votesFor.toFixed(2)}-${votesAgainst.toFixed(2)}) — approved unamended`);
            }
          }
        } else if (reviewDecision === 'amended' && amendedText.length > 50) {
          await db.update(bills).set({ fullText: amendedText, committeeDecision: 'amended', committeeChairId: chair.id, lastActionAt: new Date() }).where(eq(bills.id, bill.id));
          await db.insert(activityEvents).values({
            type: 'committee_review', agentId: chair.id, title: 'Bill amended in committee',
            description: `${chair.displayName} amended "${bill.title}" in the ${bill.committee} Committee`,
            metadata: JSON.stringify({ billId: bill.id, decision: 'amended', reasoning: decision.reasoning }),
          });
          broadcast('bill:committee_amended', { billId: bill.id, title: bill.title, chairId: chair.id, chairName: chair.displayName, committee: bill.committee });
          console.warn(`[SIMULATION] ${chair.displayName} amended "${bill.title}" in committee`);
        } else {
          await db.update(bills).set({ committeeDecision: 'approved', committeeChairId: chair.id }).where(eq(bills.id, bill.id));
          await db.insert(activityEvents).values({
            type: 'committee_review', agentId: chair.id, title: 'Bill approved by committee',
            description: `${chair.displayName} approved "${bill.title}" out of the ${bill.committee} Committee`,
            metadata: JSON.stringify({ billId: bill.id, decision: 'approved', reasoning: decision.reasoning }),
          });
          console.warn(`[SIMULATION] ${chair.displayName} approved "${bill.title}" from committee`);
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 3 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 4: Bill Advancement                                             */
  /* proposed -> committee after delay; committee -> floor after delay.   */
  /* Tabled bills are skipped. Bills with no committeeDecision auto-      */
  /* advance after 2x delay to prevent stalling.                          */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 4: Bill Advancement');

    const delayAgo = new Date(Date.now() - rc.billAdvancementDelayMs);
    const doubleDelayAgo = new Date(Date.now() - rc.billAdvancementDelayMs * 2);

    /* proposed -> committee */
    const proposedBills = await db
      .select()
      .from(bills)
      .where(and(eq(bills.status, 'proposed'), lte(bills.lastActionAt, delayAgo)));

    for (const bill of proposedBills) {
      await db
        .update(bills)
        .set({ status: 'committee', lastActionAt: new Date() })
        .where(eq(bills.id, bill.id));

      await db.insert(activityEvents).values({
        type: 'bill_advanced',
        agentId: null,
        title: 'Bill advanced to committee',
        description: `"${bill.title}" has been advanced from proposed to committee`,
        metadata: JSON.stringify({ billId: bill.id, from: 'proposed', to: 'committee' }),
      });

      broadcast('bill:advanced', {
        billId: bill.id,
        title: bill.title,
        from: 'proposed',
        to: 'committee',
      });

      console.warn(`[SIMULATION] "${bill.title}" advanced: proposed -> committee`);
    }

    /* committee -> floor: only approved/amended bills after normal delay */
    /* OR bills with no committeeDecision after 2x delay (no chair exists) */
    const approvedCommitteeBills = await db
      .select()
      .from(bills)
      .where(
        and(
          eq(bills.status, 'committee'),
          lte(bills.lastActionAt, delayAgo),
          inArray(bills.committeeDecision as never, ['approved', 'amended'] as never[]),
        ),
      );

    const stalledCommitteeBills = await db
      .select()
      .from(bills)
      .where(
        and(
          eq(bills.status, 'committee'),
          lte(bills.lastActionAt, doubleDelayAgo),
          sql`${bills.committeeDecision} IS NULL`,
        ),
      );

    const committeeBillsToAdvance = [...approvedCommitteeBills, ...stalledCommitteeBills];

    for (const bill of committeeBillsToAdvance) {
      await db
        .update(bills)
        .set({ status: 'floor', lastActionAt: new Date() })
        .where(eq(bills.id, bill.id));

      await db.insert(activityEvents).values({
        type: 'bill_advanced',
        agentId: null,
        title: 'Bill advanced to floor',
        description: `"${bill.title}" has been advanced from committee to floor`,
        metadata: JSON.stringify({ billId: bill.id, from: 'committee', to: 'floor' }),
      });

      broadcast('bill:advanced', {
        billId: bill.id,
        title: bill.title,
        from: 'committee',
        to: 'floor',
      });

      console.warn(`[SIMULATION] "${bill.title}" advanced: committee -> floor`);
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 4 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 5: Bill Resolution                                              */
  /* Tally votes; passed bills get status='passed' (not yet enacted).     */
  /* Bills voted down on the floor get status='failed'.                   */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 5: Bill Resolution'); broadcast('tick:phase', { phase: 'presidential' });

    const floorBillsForResolution = await db.select().from(bills).where(eq(bills.status, 'floor'));

    for (const bill of floorBillsForResolution) {
      const voteCounts = await db
        .select({ choice: billVotes.choice, total: count() })
        .from(billVotes)
        .where(and(eq(billVotes.billId, bill.id), inArray(billVotes.choice, ['yea', 'nay'])))
        .groupBy(billVotes.choice);

      const voteCount = voteCounts.reduce((sum, row) => sum + Number(row.total), 0);

      /* Resolve once quorum is reached, or — for bills in this tick's floor   */
      /* working set only — once the bill has been on the floor long enough.   */
      /* Out-of-set bills must not resolve on partial, stale votes; they stay  */
      /* queued until they age into the working set (or reach quorum).         */
      const quorumCount = Math.ceil(activeAgentCount * rc.quorumPercentage);
      const floorAgeMs = Date.now() - new Date(bill.lastActionAt).getTime();
      const timeExpired = floorAgeMs >= rc.billAdvancementDelayMs * 2;
      if (voteCount < quorumCount && !(timeExpired && workingSetIds.has(bill.id))) continue;
      if (voteCount === 0) continue;

      const yeaCount = Number(voteCounts.find((r) => r.choice === 'yea')?.total ?? 0);
      const nayCount = Number(voteCounts.find((r) => r.choice === 'nay')?.total ?? 0);

      /* Denormalize vote counts onto bills table for downstream engines (Phase 6, etc.) */
      await db.update(bills).set({ yeaCount, nayCount }).where(eq(bills.id, bill.id));

      const passed = yeaCount / (yeaCount + nayCount) >= rc.billPassagePercentage;

      if (passed) {
        /* Mark as passed — presidential review will handle enactment */
        await db
          .update(bills)
          .set({ status: 'passed', lastActionAt: new Date() })
          .where(eq(bills.id, bill.id));

        /* Track for Phase 11.5 public statements */
        passedBillsThisTick.push({ ...bill, status: 'passed' });

        await db.insert(activityEvents).values({
          type: 'bill_resolved',
          agentId: null,
          title: 'Bill passed the Legislature',
          description: `"${bill.title}" passed the Legislature (${yeaCount} yea, ${nayCount} nay) — awaiting presidential review`,
          metadata: JSON.stringify({ billId: bill.id, result: 'passed', yeaCount, nayCount }),
        });

        broadcast('bill:passed', {
          billId: bill.id,
          title: bill.title,
          yeaCount,
          nayCount,
        });

        console.warn(`[SIMULATION] "${bill.title}" passed the Legislature (${yeaCount} yea, ${nayCount} nay)`);

        /* Approval: sponsor gets credit for passing floor vote — only when there is a
           president who might veto. If no president, the bill becomes law this same tick
           (Phase 9) and the bill_became_law +12 will cover it; granting both would double-stack. */
        const [activePresident] = await db
          .select({ id: positions.id })
          .from(positions)
          .where(and(eq(positions.type, 'president'), eq(positions.isActive, true)))
          .limit(1);

        if (activePresident) {
          await updateApproval(
            bill.sponsorId,
            8,
            'bill_passed_floor',
            `Sponsored "${bill.title}" which passed the floor vote`,
          );
        }

        /* No vote_majority bonus — being on the winning side of a vote isn't a public approval event */
      } else {
        /* Congress voted it down — 'failed', not 'vetoed' (no veto occurred) */
        await db
          .update(bills)
          .set({ status: 'failed', lastActionAt: new Date() })
          .where(eq(bills.id, bill.id));

        /* Track for Phase 5.5 and Phase 11.5 */
        failedBillsThisTick.push({ ...bill, status: 'failed' });

        await db.insert(activityEvents).values({
          type: 'bill_resolved',
          agentId: null,
          title: 'Bill failed floor vote',
          description: `"${bill.title}" was voted down by the Legislature (${yeaCount} yea, ${nayCount} nay)`,
          metadata: JSON.stringify({ billId: bill.id, result: 'failed', yeaCount, nayCount }),
        });

        broadcast('bill:resolved', {
          billId: bill.id,
          title: bill.title,
          result: 'failed',
          yeaCount,
          nayCount,
        });

        console.warn(`[SIMULATION] "${bill.title}" voted down by the Legislature (${yeaCount} yea, ${nayCount} nay)`);

        /* Approval: sponsor penalized for failed floor vote */
        await updateApproval(
          bill.sponsorId,
          -6,
          'bill_failed_floor',
          `Sponsored "${bill.title}" which failed the floor vote`,
        );
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 5 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 5.5: Bill Withdrawal                                            */
  /* Sponsors of Legislature-failed bills may formally withdraw them      */
  /* to revise and reintroduce in the next session.                       */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 5.5: Bill Withdrawal');

    if (!rc.billWithdrawalEnabled || failedBillsThisTick.length === 0) {
      console.warn('[SIMULATION] Phase 5.5: Skipping — billWithdrawalEnabled=false or no failed bills.');
    } else {
      for (const failedBill of failedBillsThisTick) {
        /* Only bills with an active sponsor */
        const sponsor = activeAgents.find((a) => a.id === failedBill.sponsorId);
        if (!sponsor) continue;

        const contextMessage =
          `Your bill "${failedBill.title}" just failed the floor vote (${failedBill.yeaCount ?? 0} yea, ${failedBill.nayCount ?? 0} nay, ` +
          `needed ${Math.ceil(activeAgents.length * rc.billPassagePercentage)} to pass). ` +
          `You may formally withdraw it now to revise and reintroduce a stronger version next session. ` +
          `If you do not withdraw, it dies here. ` +
          `Your current approval rating: ${sponsor.approvalRating}%. ` +
          `Respond with exactly this JSON: ` +
          `{"action":"bill_withdrawal","reasoning":"one sentence","data":{"withdraw":true}}`;

        try {
          const decision = await generateAgentDecision(
            {
              id: sponsor.id,
              displayName: sponsor.displayName,
              alignment: sponsor.alignment,
              modelProvider: rc.providerOverride === 'default' ? sponsor.modelProvider : rc.providerOverride,
              personality: sponsor.personality,
              model: sponsor.model,
              ownerUserId: sponsor.ownerUserId,
            },
            contextMessage,
            'bill_withdrawal',
          );

          if (decision.action !== 'bill_withdrawal' || !decision.data) continue;

          const shouldWithdraw = decision.data['withdraw'] === true || String(decision.data['withdraw']).toLowerCase() === 'true';

          if (shouldWithdraw) {
            await db.update(bills).set({
              status: 'withdrawn',
              withdrawnAt: new Date(),
              lastActionAt: new Date(),
            }).where(eq(bills.id, failedBill.id));

            /* Mark in failedBillsThisTick so Phase 11.5 knows it was withdrawn */
            const idx = failedBillsThisTick.findIndex((b) => b.id === failedBill.id);
            if (idx >= 0) failedBillsThisTick[idx] = { ...failedBillsThisTick[idx], status: 'withdrawn' };

            await db.insert(activityEvents).values({
              type: 'bill_withdrawn',
              agentId: sponsor.id,
              title: `${sponsor.displayName} withdrew "${failedBill.title}"`,
              description: decision.reasoning,
              metadata: JSON.stringify({ billId: failedBill.id, billTitle: failedBill.title }),
            });

            await updateApproval(sponsor.id, -3, 'bill_withdrawn', `Withdrew "${failedBill.title}" after floor failure`);

            broadcast('bill:withdrawn', {
              billId: failedBill.id,
              billTitle: failedBill.title,
              sponsorId: sponsor.id,
              sponsorName: sponsor.displayName,
              reasoning: decision.reasoning,
            });

            console.warn(`[SIMULATION] ${sponsor.displayName} withdrew "${failedBill.title}"`);
          } else {
            console.warn(`[SIMULATION] ${sponsor.displayName} declined to withdraw "${failedBill.title}"`);
          }
        } catch (agentErr) {
          console.warn(`[SIMULATION] Phase 5.5: LLM error for ${sponsor.displayName}:`, agentErr);
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 5.5 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 6: Presidential Review                                          */
  /* President may veto passed bills based on alignment distance.         */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 6: Presidential Review');

    const passedBills = await db.select().from(bills).where(eq(bills.status, 'passed'));

    if (passedBills.length === 0) {
      console.warn('[SIMULATION] Phase 6: No passed bills — skipping.');
    } else {
      /* Find active president */
      const [presidentPos] = await db
        .select()
        .from(positions)
        .where(and(eq(positions.type, 'president'), eq(positions.isActive, true)))
        .limit(1);

      if (!presidentPos) {
        console.warn('[SIMULATION] Phase 6: No president — bills will be enacted directly.');
      } else {
        const president = activeAgents.find((a) => a.id === presidentPos.agentId);
        if (!president) {
          console.warn('[SIMULATION] Phase 6: President agent not found — skipping.');
        } else {
          /* Build party map for coalition discount (agentPartyMap is scoped to Phase 2) */
          const phase6Memberships = await db.select().from(partyMemberships);
          const phase6PartyMap = new Map<string, string>();
          for (const m of phase6Memberships) {
            phase6PartyMap.set(m.agentId, m.partyId);
          }

          for (const bill of passedBills) {
            const sponsor = activeAgents.find((a) => a.id === bill.sponsorId);
            const sponsorAlignment = sponsor?.alignment ?? 'moderate';
            const presidentAlignment = president.alignment ?? 'moderate';

            /* Calculate alignment distance */
            const presIdx = ALIGNMENT_ORDER.indexOf(presidentAlignment as typeof ALIGNMENT_ORDER[number]);
            const sponIdx = ALIGNMENT_ORDER.indexOf(sponsorAlignment as typeof ALIGNMENT_ORDER[number]);
            const distance = presIdx >= 0 && sponIdx >= 0 ? Math.abs(presIdx - sponIdx) : 0;

            /* ── Signal 1: Policy disagreement ── */
            let policyDisagreementMod = 0;
            const [presidentPolicy] = await db.select()
              .from(agentPolicyPositions)
              .where(and(
                eq(agentPolicyPositions.agentId, president.id),
                eq(agentPolicyPositions.category, bill.committee),
              ))
              .limit(1);
            if (presidentPolicy) {
              const total = (presidentPolicy.supportCount ?? 0) + (presidentPolicy.opposeCount ?? 0);
              if (total > 0) {
                const opposeRate = (presidentPolicy.opposeCount ?? 0) / total;
                const supportRate = (presidentPolicy.supportCount ?? 0) / total;
                if (opposeRate > 0.60) policyDisagreementMod = rc.vetoRatePerTier;
                else if (supportRate > 0.60) policyDisagreementMod = -rc.vetoRatePerTier * 0.5;
              }
            }

            /* ── Signal 2: Legislative mandate discount ── */
            let mandateDiscount = 0;
            const totalVotes = (bill.yeaCount ?? 0) + (bill.nayCount ?? 0);
            if (totalVotes > 0) {
              const yeaFraction = (bill.yeaCount ?? 0) / totalVotes;
              if (yeaFraction > 0.75) mandateDiscount = 0.15;
              else if (yeaFraction > 0.60) mandateDiscount = 0.07;
            }

            /* ── Signal 3: Cross-party coalition discount ── */
            let coalitionDiscount = 0;
            const coSponsorIds: string[] = (() => {
              try { return JSON.parse(bill.coSponsorIds ?? '[]') as string[]; } catch { return []; }
            })();
            if (coSponsorIds.length >= 2) {
              const sponsorParty = phase6PartyMap.get(bill.sponsorId ?? '');
              const crossPartyCount = coSponsorIds.filter(id => {
                const party = phase6PartyMap.get(id);
                return party && party !== sponsorParty;
              }).length;
              if (crossPartyCount >= 2) coalitionDiscount = 0.10;
              else if (crossPartyCount >= 1) coalitionDiscount = 0.05;
            }

            /* ── Signal 4: Presidential approval factor ── */
            let approvalMod = 0;
            if ((president.approvalRating ?? 50) > 70) approvalMod = 0.05;
            else if ((president.approvalRating ?? 50) < 35) approvalMod = -0.10;

            /* ── Composite veto probability ── */
            const vetoProbFinal = Math.min(
              rc.vetoMaxRate,
              Math.max(
                rc.vetoBaseRate,
                rc.vetoBaseRate + distance * rc.vetoRatePerTier
                  + policyDisagreementMod
                  - mandateDiscount
                  - coalitionDiscount
                  + approvalMod,
              ),
            );

            /* Only call AI if random check triggers veto consideration */
            if (Math.random() >= vetoProbFinal) {
              /* President signs — low-probability signing statement for notable bills */
              const isNotable = coSponsorIds.length >= 2 || (bill.yeaCount ?? 0) > (bill.nayCount ?? 0) * 2;
              if (isNotable && Math.random() < 0.10) {
                void generateAgentDecision(
                  {
                    id: president.id,
                    displayName: president.displayName,
                    alignment: president.alignment,
                    modelProvider: rc.providerOverride === 'default' ? president.modelProvider : rc.providerOverride,
                    personality: president.personality,
                    model: president.model,
                    ownerUserId: president.ownerUserId,
                  },
                  `You are signing into law: "${bill.title}". Write a brief (1-2 sentence) signing statement explaining why you support this legislation. JSON: {"action":"sign_statement","reasoning":"<your statement>","data":{}}`,
                  'sign_statement',
                ).then(signingDecision => {
                  if (signingDecision.reasoning) {
                    void db.insert(activityEvents).values({
                      type: 'bill_signed_statement',
                      agentId: president.id,
                      title: `${president.displayName} signs ${bill.title}`,
                      description: signingDecision.reasoning,
                    });
                  }
                }).catch(() => { /* fire-and-forget */ });
              }
              continue;
            }

            const contextMessage =
              `The Legislature has passed: "${bill.title}". ` +
              `Summary: ${bill.summary}. ` +
              `Sponsor alignment: ${sponsorAlignment}. Your alignment: ${presidentAlignment}. ` +
              `As President, you may sign this bill into law or veto it. ` +
              `Respond with exactly this JSON: {"action":"presidential_review","reasoning":"one sentence","data":{"decision":"sign"}} ` +
              `Use "sign" or "veto".`;

            const decision = await generateAgentDecision(
              {
                id: president.id,
                displayName: president.displayName,
                alignment: president.alignment,
                modelProvider: rc.providerOverride === 'default' ? president.modelProvider : rc.providerOverride,
                personality: president.personality,
                model: president.model,
                ownerUserId: president.ownerUserId,
              },
              contextMessage,
              'presidential_review',
            );

            if (decision.action === 'presidential_review' && decision.data?.['decision'] === 'veto') {
              await db
                .update(bills)
                .set({
                  status: 'presidential_veto',
                  presidentialVetoedById: president.id,
                  vetoedAt: new Date(),
                  lastActionAt: new Date(),
                })
                .where(eq(bills.id, bill.id));

              /* Track for Phase 11.5 public statements */
              vetoedByPresidentThisTick.push({ ...bill, status: 'presidential_veto' });

              await db.insert(activityEvents).values({
                type: 'presidential_veto',
                agentId: president.id,
                title: 'Presidential veto',
                description: `${president.displayName} vetoed "${bill.title}"`,
                metadata: JSON.stringify({
                  billId: bill.id,
                  reasoning: decision.reasoning,
                  alignmentDistance: distance,
                }),
              });

              broadcast('bill:presidential_veto', {
                billId: bill.id,
                title: bill.title,
                presidentId: president.id,
                presidentName: president.displayName,
              });

              console.warn(`[SIMULATION] ${president.displayName} vetoed "${bill.title}"`);

              /* Approval: sponsor penalized for veto */
              await updateApproval(
                bill.sponsorId,
                -10,
                'bill_vetoed',
                `Sponsored "${bill.title}" which was vetoed by the President`,
              );

              /* Relationship: sponsor resents president for veto */
              await db.insert(agentRelationships)
                .values({ agentId: bill.sponsorId, targetAgentId: president.id, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
                .onConflictDoUpdate({
                  target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                  set: { sentiment: sql`GREATEST(0.0, agent_relationships.sentiment - 0.10)`, updatedAt: new Date() },
                });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 6 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 7: Veto Override Voting                                         */
  /* Agents vote on override of presidential_veto bills.                  */
  /* Uses billVotes with choice 'override_yea' or 'override_nay'.        */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 7: Veto Override Voting');

    const vetoBills = await db.select().from(bills).where(eq(bills.status, 'presidential_veto'));

    if (vetoBills.length === 0) {
      console.warn('[SIMULATION] Phase 7: No vetoed bills — skipping.');
    } else {
      /* Find active president for relationship lookup */
      const [presidentPosP7] = await db
        .select()
        .from(positions)
        .where(and(eq(positions.type, 'president'), eq(positions.isActive, true)))
        .limit(1);
      const presidentIdP7 = presidentPosP7?.agentId ?? null;

      /* Pre-fetch original floor votes and agent-president relationships for all vetoed bills */
      const vetoBillIds = vetoBills.map((b) => b.id);
      const originalFloorVotes = await db
        .select({ billId: billVotes.billId, voterId: billVotes.voterId, choice: billVotes.choice })
        .from(billVotes)
        .where(
          and(
            inArray(billVotes.billId, vetoBillIds),
            inArray(billVotes.choice, ['yea', 'nay']),
          ),
        );
      // Map: "voterId:billId" -> choice
      const originalVoteMap = new Map<string, string>();
      for (const v of originalFloorVotes) {
        originalVoteMap.set(`${v.voterId}:${v.billId}`, v.choice);
      }

      /* Fetch veto reasoning from activityEvents */
      const vetoEvents = await db
        .select({ metadata: activityEvents.metadata })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.type, 'presidential_veto'),
            inArray(activityEvents.agentId, presidentIdP7 ? [presidentIdP7] : []),
          ),
        );
      // Map: billId -> reasoning
      const vetoReasonMap = new Map<string, string>();
      for (const evt of vetoEvents) {
        try {
          const meta = typeof evt.metadata === 'string' ? JSON.parse(evt.metadata) : evt.metadata;
          if (meta?.billId && meta?.reasoning) {
            vetoReasonMap.set(String(meta.billId), String(meta.reasoning));
          }
        } catch { /* ignore parse errors */ }
      }

      /* Fetch agent-president vote alignment relationships */
      const p7AgentIds = activeAgents.map((a) => a.id);
      const presidentRelRows = presidentIdP7 && p7AgentIds.length > 0
        ? await db
            .select({
              agentId: agentRelationships.agentId,
              voteAlignment: agentRelationships.voteAlignment,
            })
            .from(agentRelationships)
            .where(
              and(
                inArray(agentRelationships.agentId, p7AgentIds),
                eq(agentRelationships.targetAgentId, presidentIdP7),
              ),
            )
        : [];
      const presidentAlignmentMap = new Map<string, number>();
      for (const r of presidentRelRows) {
        presidentAlignmentMap.set(r.agentId, r.voteAlignment);
      }

      for (const bill of vetoBills) {
        /* Pre-fetch existing override votes for this bill */
        const existingOverrides = await db
          .select({ voterId: billVotes.voterId })
          .from(billVotes)
          .where(
            and(
              eq(billVotes.billId, bill.id),
              inArray(billVotes.choice, ['override_yea', 'override_nay']),
            ),
          );
        const alreadyVoted = new Set(existingOverrides.map((v) => v.voterId));

        const agentsToVote = activeAgents.filter((a) => !alreadyVoted.has(a.id));
        if (agentsToVote.length === 0) continue;

        const vetoReason = vetoReasonMap.get(bill.id) ?? 'no reason provided';

        const results = await Promise.allSettled(
          agentsToVote.map((agent) => {
            const originalVote = originalVoteMap.get(`${agent.id}:${bill.id}`) ?? null;
            const presidentAlignment = presidentAlignmentMap.get(agent.id) ?? 0.5;

            const contextMessage =
              `The President has vetoed "${bill.title}". ` +
              `Summary: ${bill.summary}. ` +
              `Your original floor vote on this bill: ${originalVote ?? 'not recorded'}. ` +
              `President's stated reason for veto: ${vetoReason}. ` +
              `Your vote alignment with the president: ${Math.round(presidentAlignment * 100)}%. ` +
              `The Legislature can override the veto with a 2/3 supermajority. ` +
              `Vote to override the veto or sustain it. ` +
              `Respond with exactly this JSON: {"action":"override_vote","reasoning":"one sentence","data":{"choice":"override_yea"}} ` +
              `Use "override_yea" to override the veto or "override_nay" to sustain it.`;

            return generateAgentDecision(
              {
                id: agent.id,
                displayName: agent.displayName,
                alignment: agent.alignment,
                modelProvider: rc.providerOverride === 'default' ? agent.modelProvider : rc.providerOverride,
                personality: agent.personality,
                model: agent.model,
                ownerUserId: agent.ownerUserId,
              },
              contextMessage,
              'veto_override',
            ).then((decision) => ({ agent, decision, originalVote }));
          }),
        );

        for (const result of results) {
          if (result.status === 'rejected') {
            console.warn('[SIMULATION] Phase 7: Agent override vote rejected:', result.reason);
            continue;
          }
          const { agent, decision, originalVote } = result.value;

          if (decision.action === 'idle') continue;
          if (decision.action !== 'override_vote' || !decision.data) continue;

          const rawChoice = String(decision.data['choice'] ?? '');
          /* Default toward agent's original vote direction if known */
          const defaultOverrideChoice = originalVote === 'yea' ? 'override_yea' : 'override_nay';
          const overrideChoice = rawChoice.includes('override_yea')
            ? 'override_yea'
            : rawChoice.includes('override_nay')
              ? 'override_nay'
              : defaultOverrideChoice;

          await db.insert(billVotes).values({ billId: bill.id, voterId: agent.id, choice: overrideChoice });
          await db.insert(activityEvents).values({
            type: 'veto_override_attempt', agentId: agent.id, title: 'Veto override vote',
            description: `${agent.displayName} voted ${overrideChoice === 'override_yea' ? 'OVERRIDE' : 'SUSTAIN'} on "${bill.title}"`,
            metadata: JSON.stringify({ billId: bill.id, choice: overrideChoice, reasoning: decision.reasoning, originalVote }),
          });
          console.warn(`[SIMULATION] ${agent.displayName} voted ${overrideChoice} on veto of "${bill.title}"`);
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 7 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 8: Veto Override Resolution                                     */
  /* Resolve override vote once all agents have voted.                    */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 8: Veto Override Resolution');

    const vetoBills = await db.select().from(bills).where(eq(bills.status, 'presidential_veto'));

    for (const bill of vetoBills) {
      const overrideVotes = await db
        .select({ choice: billVotes.choice, total: count() })
        .from(billVotes)
        .where(
          and(
            eq(billVotes.billId, bill.id),
            inArray(billVotes.choice, ['override_yea', 'override_nay']),
          ),
        )
        .groupBy(billVotes.choice);

      const totalOverrideVotes = overrideVotes.reduce((sum, r) => sum + Number(r.total), 0);

      const overrideQuorum = Math.ceil(activeAgentCount * rc.quorumPercentage);
      const vetoAgeMs = Date.now() - new Date(bill.lastActionAt).getTime();
      const vetoTimeExpired = vetoAgeMs >= rc.billAdvancementDelayMs * 2;
      if (totalOverrideVotes < overrideQuorum && !vetoTimeExpired) continue;
      if (totalOverrideVotes === 0) continue;

      const overrideYea = Number(overrideVotes.find((r) => r.choice === 'override_yea')?.total ?? 0);

      if (overrideYea / Math.max(1, totalOverrideVotes) >= rc.vetoOverrideThreshold) {
        /* Override succeeded — back to passed for enactment */
        await db
          .update(bills)
          .set({ status: 'passed', lastActionAt: new Date() })
          .where(eq(bills.id, bill.id));

        await db.insert(activityEvents).values({
          type: 'veto_override_success',
          agentId: null,
          title: 'Veto overridden',
          description: `The Legislature overrode the presidential veto of "${bill.title}" (${overrideYea}/${activeAgentCount} voted override)`,
          metadata: JSON.stringify({ billId: bill.id, overrideYea, totalAgents: activeAgentCount }),
        });

        broadcast('bill:veto_overridden', {
          billId: bill.id,
          title: bill.title,
          overrideYea,
          totalAgents: activeAgentCount,
        });

        console.warn(`[SIMULATION] Veto overridden for "${bill.title}" (${overrideYea}/${activeAgentCount})`);
      } else {
        /* Veto sustained */
        await db
          .update(bills)
          .set({ status: 'vetoed', lastActionAt: new Date() })
          .where(eq(bills.id, bill.id));

        await db.insert(activityEvents).values({
          type: 'veto_sustained',
          agentId: null,
          title: 'Veto sustained',
          description: `Presidential veto of "${bill.title}" was sustained (${overrideYea}/${activeAgentCount} voted override)`,
          metadata: JSON.stringify({ billId: bill.id, overrideYea, totalAgents: activeAgentCount }),
        });

        broadcast('bill:veto_sustained', {
          billId: bill.id,
          title: bill.title,
          overrideYea,
          totalAgents: activeAgentCount,
        });

        console.warn(`[SIMULATION] Veto sustained for "${bill.title}" (${overrideYea}/${activeAgentCount})`);
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 8 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 9: Law Enactment                                                */
  /* Passed bills become laws. Amendment bills update existing law text.  */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 9: Law Enactment'); broadcast('tick:phase', { phase: 'legislation' });

    const passedBillsForEnactment = await db.select().from(bills).where(eq(bills.status, 'passed'));

    /* Build agent -> partyId map once for all enactment branches */
    const lawMemberships = await db.select({ agentId: partyMemberships.agentId, partyId: partyMemberships.partyId }).from(partyMemberships);
    const lawPartyMap = new Map<string, string>();
    for (const m of lawMemberships) lawPartyMap.set(m.agentId, m.partyId);

    for (const bill of passedBillsForEnactment) {
      if (bill.billType === 'amendment' && bill.amendsLawId) {
        /* Amendment — update existing law */
        const [existingLaw] = await db
          .select()
          .from(laws)
          .where(eq(laws.id, bill.amendsLawId))
          .limit(1);

        if (!existingLaw) {
          console.warn(`[SIMULATION] Amendment bill "${bill.title}" references missing law ${bill.amendsLawId}`);
          /* Fall through to create new law instead */
        } else {
          const previousText = existingLaw.text;
          let history: Array<{ date: string; billId: string; previousText: string }> = [];
          try {
            history = JSON.parse(existingLaw.amendmentHistory) as typeof history;
          } catch {
            history = [];
          }
          history.push({
            date: new Date().toISOString(),
            billId: bill.id,
            previousText,
          });

          await db
            .update(laws)
            .set({
              text: bill.fullText,
              amendmentHistory: JSON.stringify(history),
            })
            .where(eq(laws.id, existingLaw.id));

          /* Phase 3 renewal hook: amending a recurring-program law renews
             its funding clock. If the amendment bill itself carries a
             validated spend_recurring provision, the program's per-tick
             amount is updated (clamped at Phase 11) and a lapsed program
             re-activates — renewal after lapse must be possible, otherwise
             lapse is a death sentence. Bookkeeping only (no treasury
             movement), so it stores regardless of the kill switch. */
          if (existingLaw.fiscalKind === 'spend_recurring') {
            const renewalPatch: Partial<typeof laws.$inferInsert> = { lastRenewedTick: tickNumber };
            if (
              bill.fiscalKind === 'spend_recurring' &&
              typeof bill.fiscalAmount === 'number' && Number.isFinite(bill.fiscalAmount) && bill.fiscalAmount > 0
            ) {
              renewalPatch.fiscalAmount = bill.fiscalAmount;
              renewalPatch.programActive = true;
              if (bill.fiscalProgramName) renewalPatch.fiscalProgramName = bill.fiscalProgramName;
            }
            await db.update(laws).set(renewalPatch).where(eq(laws.id, existingLaw.id));
            console.warn(`[SIMULATION] Program "${existingLaw.fiscalProgramName ?? existingLaw.title}" renewed at tick ${tickNumber} by "${bill.title}"`);
          } else if (
            existingLaw.fiscalKind === 'mandatory' &&
            bill.fiscalKind === 'mandatory' &&
            typeof bill.fiscalAmount === 'number' && Number.isFinite(bill.fiscalAmount) && bill.fiscalAmount > 0
          ) {
            /* Divergence E1 slice 1: mandatory laws never lapse (no renewal
               clock to reset — programActive/lastRenewedTick are irrelevant
               to them), but an amendment MAY adjust the base amount within
               the ±fiscalMaxMandatoryDeltaPct clamp already applied at
               Phase 11 parse time. Bookkeeping only here (no treasury
               movement — Phase 12 debits at the NEW base next tick), so it
               stores regardless of the debt-engine kill switch, same as
               the spend_recurring renewal hook above. */
            const oldAmount = existingLaw.fiscalAmount;
            await db.update(laws).set({ fiscalAmount: bill.fiscalAmount }).where(eq(laws.id, existingLaw.id));

            await db.insert(activityEvents).values({
              type: 'mandatory_amended',
              agentId: null,
              title: 'Mandatory program adjusted',
              description: `"${existingLaw.fiscalProgramName ?? existingLaw.title}" base amount changed from $${oldAmount}/day to $${bill.fiscalAmount}/day by "${bill.title}"`,
              metadata: JSON.stringify({ lawId: existingLaw.id, billId: bill.id, oldAmount, newAmount: bill.fiscalAmount }),
            });

            console.warn(`[SIMULATION] Mandatory program "${existingLaw.fiscalProgramName ?? existingLaw.title}" base amount $${oldAmount} -> $${bill.fiscalAmount} at tick ${tickNumber} by "${bill.title}"`);
          }

          await db
            .update(bills)
            .set({ status: 'law', lastActionAt: new Date() })
            .where(eq(bills.id, bill.id));

          await db.insert(activityEvents).values({
            type: 'law_amended',
            agentId: null,
            title: 'Law amended',
            description: `"${existingLaw.title}" has been amended by "${bill.title}"`,
            metadata: JSON.stringify({ billId: bill.id, lawId: existingLaw.id }),
          });

          broadcast('law:amended', {
            lawId: existingLaw.id,
            lawTitle: existingLaw.title,
            billId: bill.id,
            billTitle: bill.title,
          });

          console.warn(`[SIMULATION] Law "${existingLaw.title}" amended by "${bill.title}"`);

          /* Approval: bill became law (amendment path) — sponsor + co-sponsors */
          await updateApproval(
            bill.sponsorId,
            8,
            'bill_became_law',
            `Sponsored "${bill.title}" which was enacted into law`,
          );

          {
            const coSponsorIds: string[] = JSON.parse(bill.coSponsorIds || '[]') as string[];

            for (const coId of coSponsorIds) {
              if (coId === bill.sponsorId) continue;
              const sponsorParty = lawPartyMap.get(bill.sponsorId);
              const cosponsorParty = lawPartyMap.get(coId);
              const crossParty = !!sponsorParty && !!cosponsorParty && sponsorParty !== cosponsorParty;

              await updateApproval(
                coId,
                crossParty ? 10 : 6,
                crossParty ? 'cross_party_law' : 'bill_cosponsor_law',
                crossParty
                  ? `Cross-party co-sponsored "${bill.title}" which became law`
                  : `Co-sponsored "${bill.title}" which became law`,
              );

              /* Relationship: co-sponsor → sponsor sentiment bonus */
              await db.insert(agentRelationships)
                .values({ agentId: coId, targetAgentId: bill.sponsorId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
                .onConflictDoUpdate({
                  target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                  set: { sentiment: sql`LEAST(1.0, agent_relationships.sentiment + 0.08)`, updatedAt: new Date() },
                });
              /* Relationship: sponsor → co-sponsor sentiment bonus (smaller) */
              await db.insert(agentRelationships)
                .values({ agentId: bill.sponsorId, targetAgentId: coId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
                .onConflictDoUpdate({
                  target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                  set: { sentiment: sql`LEAST(1.0, agent_relationships.sentiment + 0.04)`, updatedAt: new Date() },
                });
            }

            if (coSponsorIds.length >= 3) {
              await updateApproval(
                bill.sponsorId,
                5,
                'cosponsor_bonus',
                `"${bill.title}" attracted ${coSponsorIds.length} co-sponsors`,
              );
            }
          }

          continue;
        }
      }

      /* Original bill or amendment without valid law — create new law */
      /* ON CONFLICT DO NOTHING handles bills that were enacted by the old tick code.
         Phase 3: fiscal provisions (validated + clamped at Phase 11 — the bill
         columns are NULL unless parseFiscalField approved them) are copied to
         the law row. .returning() detects a conflict-skip: fiscal effects must
         apply exactly once, never on a re-run of an already-enacted bill. */
      const hasFiscalProvision = bill.fiscalKind !== null;
      const [enactedLaw] = await db.insert(laws).values({
        billId: bill.id,
        title: bill.title,
        text: bill.fullText,
        enactedDate: new Date(),
        isActive: true,
        fiscalKind: bill.fiscalKind,
        fiscalAmount: bill.fiscalAmount,
        fiscalTaxDelta: bill.fiscalTaxDelta,
        fiscalProgramName: bill.fiscalProgramName,
        sunsetTicks: bill.sunsetTicks,
        programActive: bill.fiscalKind === 'spend_recurring' ? true : null,
        enactedTick: tickNumber,
        lastRenewedTick: tickNumber,
      }).onConflictDoNothing().returning({ id: laws.id });

      /* Deterministic fiscal effects at enactment — zero LLM, integer M$,
         gated on the kill switch AND on the insert actually having happened. */
      if (enactedLaw && hasFiscalProvision && rc.fiscalEffectsEnabled) {
        try {
          if (
            bill.fiscalKind === 'spend_once' &&
            typeof bill.fiscalAmount === 'number' && Number.isFinite(bill.fiscalAmount) && bill.fiscalAmount > 0
          ) {
            /* One-time appropriation: debit once, at enactment. May drive the
               treasury negative (Engine 6 reacts). Read settings fresh per
               bill — Phase 9 iterates serially and each debit must see the
               previous one. */
            const [gs] = await db.select().from(governmentSettings).limit(1);
            if (gs) {
              const newBalance = gs.treasuryBalance - bill.fiscalAmount;
              await db.update(governmentSettings)
                .set({ treasuryBalance: newBalance, updatedAt: new Date() })
                .where(eq(governmentSettings.id, gs.id));
              tickSpendingThisTick += bill.fiscalAmount;

              await db.insert(transactions).values({
                fromAgentId: undefined,
                toAgentId: undefined,
                amount: bill.fiscalAmount ?? 0,
                type: 'appropriation_onetime',
                description: `One-time appropriation: "${bill.title}"`,
                relatedLawId: enactedLaw.id,
              });

              await db.insert(activityEvents).values({
                type: 'appropriation_onetime',
                agentId: null,
                title: 'One-time appropriation',
                description: `$${bill.fiscalAmount} appropriated from the treasury for "${bill.title}"`,
                metadata: JSON.stringify({ lawId: enactedLaw.id, billId: bill.id, amount: bill.fiscalAmount, treasuryAfter: newBalance }),
              });

              broadcast('treasury:appropriation', { lawId: enactedLaw.id, title: bill.title, amount: bill.fiscalAmount, treasuryAfter: newBalance });
              console.warn(`[SIMULATION] One-time appropriation $${bill.fiscalAmount} for "${bill.title}" — treasury now $${newBalance}`);
            }
          } else if (
            bill.fiscalKind === 'tax_change' &&
            typeof bill.fiscalTaxDelta === 'number' && Number.isFinite(bill.fiscalTaxDelta) && bill.fiscalTaxDelta !== 0
          ) {
            /* Revenue law: the ONLY non-admin path that changes taxRatePercent.
               Applied once at enactment; Phase 13 then collects at the new rate. */
            const [gs] = await db.select().from(governmentSettings).limit(1);
            if (gs) {
              const oldRate = gs.taxRatePercent;
              const newRate = applyTaxDelta(oldRate, bill.fiscalTaxDelta, rc.taxRateMinPercent, rc.taxRateMaxPercent);
              if (newRate !== oldRate) {
                await db.update(governmentSettings)
                  .set({ taxRatePercent: newRate, updatedAt: new Date() })
                  .where(eq(governmentSettings.id, gs.id));

                await db.insert(activityEvents).values({
                  type: 'tax_rate_changed',
                  agentId: null,
                  title: 'Tax rate changed by law',
                  description: `"${bill.title}" ${bill.fiscalTaxDelta > 0 ? 'raised' : 'lowered'} the tax rate from ${oldRate}% to ${newRate}%`,
                  metadata: JSON.stringify({ lawId: enactedLaw.id, billId: bill.id, oldRate, newRate, delta: bill.fiscalTaxDelta }),
                });

                broadcast('treasury:tax_rate_changed', { lawId: enactedLaw.id, title: bill.title, oldRate, newRate });
                console.warn(`[SIMULATION] Tax rate ${oldRate}% -> ${newRate}% via "${bill.title}"`);
              } else {
                console.warn(`[SIMULATION] Tax delta of "${bill.title}" saturated at bound ${oldRate}% — no change`);
              }
            }
          } else if (bill.fiscalKind === 'spend_recurring') {
            /* Recurring program: no debit at enactment — Phase 12 debits it
               each tick alongside salaries while program_active stays true. */
            console.warn(`[SIMULATION] Program "${bill.fiscalProgramName ?? bill.title}" enacted at $${bill.fiscalAmount}/day`);
          }
        } catch (err) {
          console.warn('[SIMULATION] Phase 9 fiscal effect error (law stands, effect skipped):', err);
        }
      }

      await db
        .update(bills)
        .set({ status: 'law', lastActionAt: new Date() })
        .where(eq(bills.id, bill.id));

      await db.insert(activityEvents).values({
        type: 'bill_resolved',
        agentId: null,
        title: 'Bill enacted into law',
        description: `"${bill.title}" has been enacted into law`,
        metadata: JSON.stringify({ billId: bill.id, result: 'passed' }),
      });

      broadcast('bill:resolved', {
        billId: bill.id,
        title: bill.title,
        result: 'passed',
      });

      console.warn(`[SIMULATION] "${bill.title}" enacted into law`);

      /* Approval: bill became law — sponsor + co-sponsors */
      await updateApproval(
        bill.sponsorId,
        12,
        'bill_became_law',
        `Sponsored "${bill.title}" which was enacted into law`,
      );

      {
        const coSponsorIds: string[] = JSON.parse(bill.coSponsorIds || '[]') as string[];

        for (const coId of coSponsorIds) {
          if (coId === bill.sponsorId) continue;
          const sponsorParty = lawPartyMap.get(bill.sponsorId);
          const cosponsorParty = lawPartyMap.get(coId);
          const crossParty = !!sponsorParty && !!cosponsorParty && sponsorParty !== cosponsorParty;

          await updateApproval(
            coId,
            crossParty ? 10 : 6,
            crossParty ? 'cross_party_law' : 'bill_cosponsor_law',
            crossParty
              ? `Cross-party co-sponsored "${bill.title}" which became law`
              : `Co-sponsored "${bill.title}" which became law`,
          );

          /* Relationship: co-sponsor → sponsor sentiment bonus */
          await db.insert(agentRelationships)
            .values({ agentId: coId, targetAgentId: bill.sponsorId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
            .onConflictDoUpdate({
              target: [agentRelationships.agentId, agentRelationships.targetAgentId],
              set: { sentiment: sql`LEAST(1.0, agent_relationships.sentiment + 0.08)`, updatedAt: new Date() },
            });
          /* Relationship: sponsor → co-sponsor sentiment bonus (smaller) */
          await db.insert(agentRelationships)
            .values({ agentId: bill.sponsorId, targetAgentId: coId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
            .onConflictDoUpdate({
              target: [agentRelationships.agentId, agentRelationships.targetAgentId],
              set: { sentiment: sql`LEAST(1.0, agent_relationships.sentiment + 0.04)`, updatedAt: new Date() },
            });
        }

        if (coSponsorIds.length >= 3) {
          await updateApproval(
            bill.sponsorId,
            5,
            'cosponsor_bonus',
            `"${bill.title}" attracted ${coSponsorIds.length} co-sponsors`,
          );
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 9 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 9.7: Sunset Expiry & Budget Session                             */
  /* Deterministic, zero LLM. Placed after Phase 9 enactment and before   */
  /* Phase 10 judicial review so Phases 10/11 see a consistent active-law */
  /* picture the same tick.                                               */
  /*   Sunset: laws with a sunset_ticks provision deactivate via the SAME */
  /*   isActive flip judicial strike-down uses — the only fiscal path     */
  /*   that deactivates a law. Legacy laws (NULL sunset_ticks or NULL     */
  /*   enacted_tick) are never due, structurally.                         */
  /*   Budget session: every rc.budgetCycleTicks ticks (DB-persisted      */
  /*   last_budget_session_tick marker — restart-robust), recurring       */
  /*   programs older than one cycle LAPSE unless renewed: program_active */
  /*   flips false, the LAW stays active — funding dies, the statute      */
  /*   survives, and a later amendment can re-fund it (Phase 9 renewal    */
  /*   hook). Kill switch: fiscalEffectsEnabled=false skips sunsets AND   */
  /*   lapse AND does NOT advance the session marker, so re-enabling      */
  /*   resumes the cycle naturally.                                       */
  /*   Divergence E1 slice 1: `mandatory` rows are naturally exempt from  */
  /*   BOTH loops below with zero extra code — the sunset query filters   */
  /*   isNotNull(sunsetTicks), and fiscalParsing.ts's mandatory branch    */
  /*   always returns sunsetTicks: null; the lapse query filters          */
  /*   fiscalKind = 'spend_recurring' explicitly, which a 'mandatory' row */
  /*   never matches. This is the "exemption costs zero code" the spec    */
  /*   calls for — verified here, not re-implemented.                     */
  /* ------------------------------------------------------------------ */
  if (rc.fiscalEffectsEnabled) {
    try {
      /* ---- Sunset expiry ---------------------------------------------- */
      const sunsetCandidates = await db
        .select()
        .from(laws)
        .where(and(eq(laws.isActive, true), isNotNull(laws.sunsetTicks)));

      const dueSunsets = sunsetCandidates.filter((law) =>
        sunsetDue(tickNumber, law.enactedTick, law.sunsetTicks),
      );

      if (dueSunsets.length > 0) {
        /* Rule 2: inArray(), never raw ANY(). Same flip as strike-down. */
        await db
          .update(laws)
          .set({ isActive: false })
          .where(inArray(laws.id, dueSunsets.map((l) => l.id)));

        /* A sunsetting recurring program also stops being funded. */
        const sunsetProgramIds = dueSunsets
          .filter((l) => l.fiscalKind === 'spend_recurring')
          .map((l) => l.id);
        if (sunsetProgramIds.length > 0) {
          await db
            .update(laws)
            .set({ programActive: false })
            .where(inArray(laws.id, sunsetProgramIds));
        }

        for (const law of dueSunsets) {
          await db.insert(activityEvents).values({
            type: 'law_sunset',
            agentId: null,
            title: 'Law sunset',
            description: `"${law.title}" expired under its sunset clause after ${law.sunsetTicks} ticks`,
            metadata: JSON.stringify({
              lawId: law.id,
              enactedTick: law.enactedTick,
              sunsetTicks: law.sunsetTicks,
              expiredAtTick: tickNumber,
            }),
          });

          broadcast('law:sunset', {
            lawId: law.id,
            lawTitle: law.title,
            sunsetTicks: law.sunsetTicks,
          });

          console.warn(`[SIMULATION] Phase 9.7: "${law.title}" sunset at tick ${tickNumber} (enacted tick ${law.enactedTick}, sunset ${law.sunsetTicks})`);
        }
      }

      /* ---- Budget session ---------------------------------------------- */
      const [gs97] = await db.select().from(governmentSettings).limit(1);

      if (gs97 && budgetSessionDue(tickNumber, gs97.lastBudgetSessionTick, rc.budgetCycleTicks)) {
        console.warn(`[SIMULATION] Phase 9.7: Budget session at tick ${tickNumber} (last session tick ${gs97.lastBudgetSessionTick}, cycle ${rc.budgetCycleTicks})`);

        const activePrograms97 = await db
          .select()
          .from(laws)
          .where(and(eq(laws.isActive, true), eq(laws.programActive, true), eq(laws.fiscalKind, 'spend_recurring')));

        const lapsingPrograms = activePrograms97.filter((p) =>
          lapseDue(tickNumber, p.enactedTick, p.lastRenewedTick, rc.budgetCycleTicks),
        );
        const survivingPrograms = activePrograms97.filter(
          (p) => !lapsingPrograms.some((l) => l.id === p.id),
        );

        const sumPerTick = (rows: typeof activePrograms97): number =>
          rows.reduce((s, r) => s + (typeof r.fiscalAmount === 'number' && Number.isFinite(r.fiscalAmount) ? r.fiscalAmount : 0), 0);
        const lapsedPerTick = sumPerTick(lapsingPrograms);
        const survivingPerTick = sumPerTick(survivingPrograms);

        if (lapsingPrograms.length > 0) {
          /* Lapse flips program_active ONLY — the law itself stays active.
             Funding dies; the statute survives; renewal-by-amendment can
             re-activate it later (and that re-activation re-enters the
             aggregate recurring cap check at Phase 11 proposal time). */
          await db
            .update(laws)
            .set({ programActive: false })
            .where(inArray(laws.id, lapsingPrograms.map((l) => l.id)));

          for (const program of lapsingPrograms) {
            const programName = program.fiscalProgramName ?? program.title;
            await db.insert(activityEvents).values({
              type: 'program_lapsed',
              agentId: null,
              title: 'Spending program lapsed',
              description: `"${programName}" ($${program.fiscalAmount}/day) was not renewed and lapsed at the budget session`,
              metadata: JSON.stringify({
                lawId: program.id,
                programName,
                perTick: program.fiscalAmount,
                enactedTick: program.enactedTick,
                lastRenewedTick: program.lastRenewedTick,
                lapsedAtTick: tickNumber,
              }),
            });
            console.warn(`[SIMULATION] Phase 9.7: Program "${programName}" lapsed ($${program.fiscalAmount}/day, last renewed tick ${program.lastRenewedTick ?? program.enactedTick})`);
          }
        }

        /* Calendar entry — CalendarPage/EventDetailModal already style
           budget_session; zero client changes needed. */
        const sessionDescription =
          `Budget session at tick ${tickNumber}: ` +
          `${lapsingPrograms.length} program(s) lapsed ($${lapsedPerTick}/day freed), ` +
          `${survivingPrograms.length} program(s) continue ($${survivingPerTick}/day). ` +
          `Treasury $${gs97.treasuryBalance}.`;

        await db.insert(governmentEvents).values({
          type: 'budget_session',
          title: `Budget Session — Tick ${tickNumber}`.slice(0, 200),
          description: sessionDescription.slice(0, 500),
          scheduledAt: new Date(),
          durationMinutes: 60,
          status: 'completed',
          outcome: lapsingPrograms.length > 0
            ? `${lapsingPrograms.length} program(s) lapsed`
            : 'All programs renewed or within cycle',
          isPublic: true,
        });

        /* One summary activity event (Gazette whitelist picks it up). */
        await db.insert(activityEvents).values({
          type: 'budget_session',
          agentId: null,
          title: 'Budget session held',
          description: sessionDescription,
          metadata: JSON.stringify({
            tickNumber,
            lapsedCount: lapsingPrograms.length,
            lapsedPerTick,
            survivingCount: survivingPrograms.length,
            survivingPerTick,
            treasuryBalance: gs97.treasuryBalance,
          }),
        });

        /* Advance the DB-persisted cycle marker LAST — if anything above
           threw, the session re-fires next tick instead of silently skipping
           a cycle. Single-column update on the settings row (not JSONB). */
        await db
          .update(governmentSettings)
          .set({ lastBudgetSessionTick: tickNumber, updatedAt: new Date() })
          .where(eq(governmentSettings.id, gs97.id));

        broadcast('budget:session', {
          tickNumber,
          lapsedCount: lapsingPrograms.length,
          lapsedPerTick,
          survivingCount: survivingPrograms.length,
          survivingPerTick,
        });
      }
    } catch (err) {
      console.warn('[SIMULATION] Phase 9.7 error:', err);
    }
  } else {
    console.warn('[SIMULATION] Phase 9.7: Skipped — fiscalEffectsEnabled=false (sunset/lapse paused, session marker frozen).');
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 10: Judicial Arc (Phase 4)                                      */
  /* Case-centric state machine: filed -> docketed -> argued ->            */
  /* deliberating -> decided/dismissed. Stage gates are TICK NUMBERS       */
  /* (courtMath.ts due-functions keyed off status), so the arc survives    */
  /* restarts and interval changes, and a same-tick re-run after a crash   */
  /* sees the advanced status and skips. Existing cases are processed by   */
  /* status FIRST (queried from the DB — restart-safe); new cases are      */
  /* filed LAST, gated by docket room. Every stage commits its DB writes   */
  /* in ONE transaction so a re-run can never double-insert.               */
  /* judicial_reviews / judicial_votes no longer receive writes — they     */
  /* stay readable as the legacy archive.                                  */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 10: Judicial Arc'); broadcast('tick:phase', { phase: 'judiciary' });

    if (!rc.courtEnabled) {
      console.warn('[SIMULATION] Phase 10: Skipped — courtEnabled=false (docket frozen, no mutations).');
    } else {
      /* Get all active supreme_justice positions */
      const justicePositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.isActive, true),
            inArray(positions.type, ['supreme_justice']),
          ),
        );

      /* Fill justice vacancies up to supremeCourtJustices config. Two paths:
         - appointmentConfirmationEnabled (Slice 3, dark by default): the
           sitting president nominates and the Legislature confirms — ONE seat
           per tick to bound LLM load; if no president or the nominee is
           rejected, the seat stays vacant (faithful).
         - default (byte-identical to before Slice 3): reputation-rank auto-fill
           of all vacancies. */
      if (justicePositions.length < rc.supremeCourtJustices) {
        const vacancyCount = rc.supremeCourtJustices - justicePositions.length;
        console.warn(`[SIMULATION] Phase 10: ${vacancyCount} justice vacancies — filling...`);

        /* Get agents not currently holding any position, sorted by reputation */
        const currentPositionHolders = await db
          .select({ agentId: positions.agentId })
          .from(positions)
          .where(eq(positions.isActive, true));
        const heldAgentIds = new Set(currentPositionHolders.map((p) => p.agentId));

        if (rc.appointmentConfirmationEnabled) {
          const president10 = await getSittingPresident(rc.providerOverride);
          if (!president10) {
            console.warn('[SIMULATION] Phase 10: appointmentConfirmationEnabled but no sitting president — justice seat(s) stay vacant (faithful).');
          } else {
            const candidates10 = activeAgents
              .filter((a) => !heldAgentIds.has(a.id))
              .sort((a, b) => b.reputation - a.reputation)
              .slice(0, 20)
              .map((a) => ({ id: a.id, displayName: a.displayName, alignment: a.alignment }));
            const seatedCongress10 = await db
              .select({ agentId: positions.agentId })
              .from(positions)
              .where(and(eq(positions.isActive, true), eq(positions.type, 'congress_member')));
            const result10 = await runAppointment({
              positionType: 'supreme_justice',
              title: 'Supreme Court Justice',
              officeLabel: 'Supreme Court Justice',
              president: president10,
              candidates: candidates10,
              confirmVoterIds: seatedCongress10.map((c) => c.agentId),
              confirmThreshold: rc.appointmentConfirmationThreshold ?? 0.5,
            });
            console.warn(`[SIMULATION] Phase 10: justice appointment cycle — ${result10.status}.`);
          }
        } else {
          const eligibleAgents = activeAgents
            .filter((a) => !heldAgentIds.has(a.id))
            .sort((a, b) => b.reputation - a.reputation)
            .slice(0, vacancyCount);

          for (const agent of eligibleAgents) {
            await db.insert(positions).values({
              agentId: agent.id,
              type: 'supreme_justice',
              title: 'Supreme Court Justice',
              startDate: new Date(),
              isActive: true,
            });

            await db.insert(activityEvents).values({
              type: 'appointment',
              agentId: agent.id,
              title: `${agent.displayName} appointed to Supreme Court`,
              description: `Appointed as Supreme Court Justice to fill vacancy`,
            });

            console.warn(`[SIMULATION] Phase 10: Appointed ${agent.displayName} as Supreme Court Justice`);
          }
        }

        /* Re-fetch justice positions after filling vacancies */
        const updatedJusticePositions = await db
          .select()
          .from(positions)
          .where(
            and(
              eq(positions.isActive, true),
              inArray(positions.type, ['supreme_justice']),
            ),
          );

        /* Replace justicePositions — clear and push since it is const */
        justicePositions.length = 0;
        justicePositions.push(...updatedJusticePositions);
      }

      /* Sitting bench — active agents holding a justice seat, ordered by
         appointment date. The chief justice is the earliest-appointed. */
      const benchPositions10 = [...justicePositions].sort(
        (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      );
      const justiceAgents10 = benchPositions10
        .map((jp) => activeAgents.find((a) => a.id === jp.agentId))
        .filter((j): j is (typeof activeAgents)[number] => j !== undefined);
      const chiefJustice10 = justiceAgents10.length > 0 ? justiceAgents10[0] : null;

      const agentById10 = new Map(activeAgents.map((a) => [a.id, a]));

      const asAgentRecord10 = (a: (typeof activeAgents)[number]) => ({
        id: a.id,
        displayName: a.displayName,
        alignment: a.alignment,
        modelProvider: rc.providerOverride === 'default' ? a.modelProvider : rc.providerOverride,
        personality: a.personality,
        model: a.model,
        ownerUserId: a.ownerUserId,
      });

      /* Whitespace-collapsed, length-capped excerpt for prompt budgets. */
      const excerpt10 = (text: string | null | undefined, max: number): string => {
        const t = (text ?? '').replace(/\s+/g, ' ').trim();
        return t.length > max ? `${t.slice(0, Math.max(0, max - 3))}...` : t;
      };

      const constitutionBlock10 = `The Constitution of Agora:\n${formatConstitutionForPrompt(1200)}`;

      type CourtCaseRow10 = typeof courtCases.$inferSelect;

      /* Dispute facts come from agent_deals via the durable dealId FK —
         brokenDealsThisTick is per-tick memory and is gone after restart. */
      const buildDealBlock10 = async (dealId: string): Promise<string> => {
        const [deal] = await db.select().from(agentDeals).where(eq(agentDeals.id, dealId)).limit(1);
        if (!deal) return 'The underlying agreement record could not be retrieved.';
        const initiatorName = agentById10.get(deal.initiatorId)?.displayName ?? 'The initiator';
        const targetName = agentById10.get(deal.targetId)?.displayName ?? 'the other party';
        return (
          `The agreement at issue: ${initiatorName} committed to "${excerpt10(deal.initiatorCommitment, 240)}"; ` +
          `${targetName} committed to "${excerpt10(deal.targetCommitment, 240)}".`
        );
      };

      /* Precedent injection — prior DECIDED rulings a court/counsel would
         actually cite. Direct precedent (same challenged law, newest first)
         leads; general precedent (most recent decided cases of the same type)
         fills the rest. Merged direct-first, deduped by id, capped at 5, and
         formatted via the pure courtMath helpers. Returns '' when no
         precedent exists — the common early-sim case pays zero prompt cost.
         Both queries use inArray/eq only (never raw ANY, per project rule 2). */
      const PRECEDENT_CAP = 5;
      const buildPrecedentInjection10 = async (c: CourtCaseRow10): Promise<string> => {
        const precedentColumns = {
          id: courtCases.id,
          caseNumber: courtCases.caseNumber,
          caption: courtCases.caption,
          outcome: courtCases.outcome,
          votesFor: courtCases.votesFor,
          votesAgainst: courtCases.votesAgainst,
          majorityOpinion: courtCases.majorityOpinion,
        };

        /* Direct precedent — other decided cases challenging the same law. */
        const directRows = c.lawId
          ? await db
              .select(precedentColumns)
              .from(courtCases)
              .where(and(
                eq(courtCases.status, 'decided'),
                eq(courtCases.lawId, c.lawId),
                ne(courtCases.id, c.id),
              ))
              .orderBy(desc(courtCases.decidedTick))
              .limit(PRECEDENT_CAP)
          : [];

        /* General precedent — most recent decided cases of the same type. */
        const generalRows = directRows.length < PRECEDENT_CAP
          ? await db
              .select(precedentColumns)
              .from(courtCases)
              .where(and(
                eq(courtCases.status, 'decided'),
                eq(courtCases.caseType, c.caseType),
                ne(courtCases.id, c.id),
              ))
              .orderBy(desc(courtCases.decidedTick))
              .limit(PRECEDENT_CAP)
          : [];

        /* Merge direct-first, dedup by id, cap. */
        const seen = new Set<string>();
        const merged: typeof directRows = [];
        for (const row of [...directRows, ...generalRows]) {
          if (seen.has(row.id) || merged.length >= PRECEDENT_CAP) continue;
          seen.add(row.id);
          merged.push(row);
        }

        const summaries: PrecedentSummary[] = merged.map((row) => ({
          caseNumber: row.caseNumber,
          caption: row.caption,
          outcome: row.outcome,
          votesFor: row.votesFor ?? 0,
          votesAgainst: row.votesAgainst ?? 0,
          holding: distillHolding(row.majorityOpinion),
        }));
        return buildPrecedentInjection(summaries);
      };

      /* Mootness gate — first check at EVERY stage entry, before any LLM
         call. Challenges die with their law (Phase 9.7 sunset/lapse can
         kill it mid-arc); all cases die with an inactive party. */
      const mootReason10 = async (c: CourtCaseRow10): Promise<string | null> => {
        if (c.lawId) {
          const [lawRow] = await db
            .select({ isActive: laws.isActive })
            .from(laws)
            .where(eq(laws.id, c.lawId))
            .limit(1);
          if (!lawRow || !lawRow.isActive) return 'Case mooted: the challenged law is no longer in force.';
        }
        const partyIds = [c.petitionerId, ...(c.respondentId ? [c.respondentId] : [])];
        const partyRows = await db
          .select({ id: agents.id, isActive: agents.isActive })
          .from(agents)
          .where(inArray(agents.id, partyIds));
        for (const pid of partyIds) {
          const row = partyRows.find((p) => p.id === pid);
          if (!row || !row.isActive) return 'Case mooted: a party to the case is no longer active.';
        }
        return null;
      };

      /* Terminal dismissal (mootness or forced stall dismissal) — zero LLM
         calls, one transaction. Cancels a still-scheduled hearing row. */
      const dismissCase10 = async (c: CourtCaseRow10, content: string, calendarOutcome: string): Promise<void> => {
        await db.transaction(async (tx) => {
          await tx
            .update(courtCases)
            .set({ status: 'dismissed', outcome: 'dismissed', decidedTick: tickNumber, decidedAt: new Date() })
            .where(eq(courtCases.id, c.id));
          await tx.insert(courtCaseEvents).values({
            caseId: c.id,
            tick: tickNumber,
            type: 'dismissed',
            content,
          });
          if (c.hearingEventId) {
            await tx
              .update(governmentEvents)
              .set({ status: 'cancelled', outcome: calendarOutcome })
              .where(and(eq(governmentEvents.id, c.hearingEventId), eq(governmentEvents.status, 'scheduled')));
          }
        });
        console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} dismissed — ${content}`);
      };

      /* ---- Process existing cases by status (restart-safe) ------------ */
      const openCases10 = await db
        .select()
        .from(courtCases)
        .where(inArray(courtCases.status, [...ACTIVE_CASE_STATUSES]))
        .orderBy(asc(courtCases.filedTick));

      for (const c of openCases10) {
        try {
          /* Gates are strictly increasing ticks, so at most ONE stage fires
             per case per tick. */
          const stage = docketDue(c, tickNumber) ? 'B'
            : hearingDue(c, tickNumber) ? 'C'
            : deliberationDue(c, tickNumber) ? 'D'
            : decisionDue(c, tickNumber) ? 'E'
            : null;
          if (!stage) continue;

          const moot = await mootReason10(c);
          if (moot) {
            await dismissCase10(c, moot, 'Mooted');
            continue;
          }

          /* ---- Stage B: Docketing (0 LLM calls, unconditional) --------- */
          if (stage === 'B') {
            const hearingTick = tickNumber + rc.courtHearingDelayTicks;
            const attendeeIds = [
              ...justiceAgents10.map((j) => j.id),
              c.petitionerId,
              ...(c.respondentId ? [c.respondentId] : []),
            ];
            await db.transaction(async (tx) => {
              /* scheduledAt is a DISPLAY-ONLY estimate — Day N (hearingTick)
                 is authoritative; Stage C rewrites this to the actual fire
                 time so pauses/overruns never strand a stale timestamp. */
              const [hearingEvent] = await tx
                .insert(governmentEvents)
                .values({
                  type: 'judicial_hearing',
                  title: `Oral Argument: ${c.caption}`.slice(0, 200),
                  description: excerpt10(c.questionPresented, 500) || `The Supreme Court will hear ${c.caption}.`,
                  scheduledAt: new Date(Date.now() + (hearingTick - tickNumber) * rc.tickIntervalMs),
                  durationMinutes: 90,
                  organizerId: chiefJustice10?.id ?? null,
                  attendeeIds: JSON.stringify(attendeeIds),
                  status: 'scheduled',
                  isPublic: true,
                })
                .returning({ id: governmentEvents.id });
              await tx
                .update(courtCases)
                .set({ status: 'docketed', hearingTick, hearingEventId: hearingEvent?.id ?? null })
                .where(eq(courtCases.id, c.id));
              await tx.insert(courtCaseEvents).values({
                caseId: c.id,
                tick: tickNumber,
                type: 'hearing_scheduled',
                content: `The Court will hear argument on Day ${hearingTick}.`,
              });
            });
            console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} docketed — argument Day ${hearingTick}`);
            continue;
          }

          /* ---- Stage C: Oral argument (2 + Q LLM calls, one wall) ------ */
          if (stage === 'C') {
            /* Empty-bench guard: postpone (bounded), never argue to nobody. */
            if (justiceAgents10.length === 0) {
              const priorPostponements = (await db
                .select({ content: courtCaseEvents.content })
                .from(courtCaseEvents)
                .where(and(eq(courtCaseEvents.caseId, c.id), eq(courtCaseEvents.type, 'postponed'))))
                .filter((e) => e.content.startsWith('Argument postponed')).length;
              if (priorPostponements >= STALL_GRACE_TICKS) {
                await dismissCase10(c, 'Dismissed without prejudice: the bench remained vacant and argument could not be heard.', 'Dismissed');
              } else {
                const pushedTick = tickNumber + 1;
                await db.transaction(async (tx) => {
                  await tx.update(courtCases).set({ hearingTick: pushedTick }).where(eq(courtCases.id, c.id));
                  await tx.insert(courtCaseEvents).values({
                    caseId: c.id,
                    tick: tickNumber,
                    type: 'postponed',
                    content: 'Argument postponed: the bench is vacant.',
                  });
                });
                console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} argument postponed to Day ${pushedTick} — bench vacant`);
              }
              continue;
            }

            const petitioner = agentById10.get(c.petitionerId);
            const respondent = c.respondentId ? agentById10.get(c.respondentId) : undefined;
            if (!petitioner) {
              /* Should be unreachable past the mootness gate — defensive. */
              await dismissCase10(c, 'Case mooted: a party to the case is no longer active.', 'Mooted');
              continue;
            }

            /* Subject block: law excerpt for challenges, deal terms (via the
               durable dealId FK) for disputes. <= ~600 chars. */
            let subjectBlock = '';
            if (c.caseType === 'constitutional_challenge' && c.lawId) {
              const [lawRow] = await db.select().from(laws).where(eq(laws.id, c.lawId)).limit(1);
              subjectBlock = lawRow
                ? `The challenged law "${lawRow.title}": ${excerpt10(lawRow.text, 500)}`
                : 'The challenged law text could not be retrieved.';
            } else if (c.dealId) {
              subjectBlock = await buildDealBlock10(c.dealId);
            }

            const questionBlock = `Question presented: ${excerpt10(c.questionPresented, 300)}`;
            /* Prior rulings counsel and the bench can cite ('' if none). */
            const precedentBlock10 = await buildPrecedentInjection10(c);
            const jsonFirst = (role: string): string =>
              `Respond with exactly this JSON: {"action":"${role}","reasoning":"..."} `;

            type HearingCall10 = { kind: 'petitioner' | 'respondent' | 'question'; actor: (typeof activeAgents)[number] };
            const hearingCalls: HearingCall10[] = [{ kind: 'petitioner', actor: petitioner }];
            if (respondent) hearingCalls.push({ kind: 'respondent', actor: respondent });
            const questionJustices = [...justiceAgents10]
              .sort(() => Math.random() - 0.5)
              .slice(0, Math.max(0, rc.courtJusticeQuestionsPerHearing));
            for (const j of questionJustices) hearingCalls.push({ kind: 'question', actor: j });

            const hearingResults = await Promise.allSettled(
              hearingCalls.map((call) => {
                let prompt: string;
                if (call.kind === 'question') {
                  prompt =
                    jsonFirst('ask_question').replace('"..."', '"one probing question from the bench, one sentence"') +
                    `You are Justice ${call.actor.displayName} of the Supreme Court of Agora, hearing oral argument in ${c.caption} (${c.caseNumber}). ` +
                    `Ask counsel one pointed question. ${questionBlock} ${subjectBlock} ${precedentBlock10}${constitutionBlock10}`;
                } else {
                  const side = call.kind === 'petitioner'
                    ? (c.caseType === 'constitutional_challenge'
                        ? 'counsel for the petitioner, arguing the challenged law is unconstitutional'
                        : 'counsel for the petitioner, arguing a binding commitment was broken (Article 7)')
                    : (c.caseType === 'constitutional_challenge'
                        ? 'counsel for the respondent, defending the law as constitutional'
                        : 'counsel for the respondent, defending against the claim');
                  prompt =
                    jsonFirst('present_argument').replace('"..."', '"your oral argument in 2-4 sentences"') +
                    `You are ${call.actor.displayName}, ${side}, before the Supreme Court of Agora in ${c.caption} (${c.caseNumber}). ` +
                    `${questionBlock} ${subjectBlock} ${precedentBlock10}${constitutionBlock10}`;
                }
                return generateAgentDecision(
                  asAgentRecord10(call.actor),
                  prompt,
                  call.kind === 'question' ? 'justice_question' : 'oral_argument',
                ).then((decision) => ({ call, decision }));
              }),
            );

            /* Every seat gets an event row: fulfilled + valid -> model text;
               anything else -> one-line deterministic fallback. The arc
               never stalls on an LLM failure. */
            const eventRows: Array<typeof courtCaseEvents.$inferInsert> = [];
            for (let i = 0; i < hearingResults.length; i++) {
              const call = hearingCalls[i];
              const result = hearingResults[i];
              const expectedAction = call.kind === 'question' ? 'ask_question' : 'present_argument';
              let content: string | null = null;
              if (result.status === 'fulfilled') {
                const { decision } = result.value;
                if (decision.action === expectedAction && typeof decision.reasoning === 'string' && decision.reasoning.trim().length > 0) {
                  content = excerpt10(decision.reasoning, 1200);
                }
              } else {
                console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} hearing LLM call rejected:`, result.reason);
              }
              if (!content) {
                content = call.kind === 'petitioner'
                  ? `${call.actor.displayName} rested on the written petition without oral elaboration.`
                  : call.kind === 'respondent'
                    ? `${call.actor.displayName} rested on the written record in defense.`
                    : `Justice ${call.actor.displayName} reserved questioning.`;
              }
              eventRows.push({
                caseId: c.id,
                tick: tickNumber,
                type: call.kind === 'question' ? 'justice_question' : 'oral_argument',
                actorId: call.actor.id,
                role: call.kind === 'question' ? 'justice' : call.kind,
                content,
              });
            }

            await db.transaction(async (tx) => {
              if (eventRows.length > 0) await tx.insert(courtCaseEvents).values(eventRows);
              await tx.update(courtCases).set({ status: 'argued' }).where(eq(courtCases.id, c.id));
              if (c.hearingEventId) {
                /* Day N was authoritative all along — now that the hearing
                   actually fired, rewrite the display timestamp to reality. */
                await tx
                  .update(governmentEvents)
                  .set({ status: 'completed', outcome: 'Argument heard', scheduledAt: new Date() })
                  .where(eq(governmentEvents.id, c.hearingEventId));
              }
            });

            broadcast('court:hearing', {
              caseId: c.id,
              caseNumber: c.caseNumber,
              caption: c.caption,
              caseType: c.caseType,
              tickNumber,
            });
            console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} argued (${eventRows.length} record entries)`);
            continue;
          }

          /* ---- Stage D: Deliberation + votes (<= 7 LLM calls, one wall) - */
          if (stage === 'D') {
            /* Subject + argument excerpts for the vote prompts. */
            let subjectBlock = '';
            if (c.caseType === 'constitutional_challenge' && c.lawId) {
              const [lawRow] = await db.select().from(laws).where(eq(laws.id, c.lawId)).limit(1);
              subjectBlock = lawRow
                ? `The challenged law "${lawRow.title}": ${excerpt10(lawRow.text, 550)}`
                : 'The challenged law text could not be retrieved.';
            } else if (c.dealId) {
              subjectBlock = await buildDealBlock10(c.dealId);
            }

            const argEvents = await db
              .select()
              .from(courtCaseEvents)
              .where(and(eq(courtCaseEvents.caseId, c.id), eq(courtCaseEvents.type, 'oral_argument')))
              .orderBy(asc(courtCaseEvents.createdAt));
            const petArg = argEvents.find((e) => e.role === 'petitioner')?.content ?? '';
            const resArg = argEvents.find((e) => e.role === 'respondent')?.content ?? '';
            const argumentsBlock =
              (petArg ? `Petitioner argued: ${excerpt10(petArg, 350)} ` : '') +
              (resArg ? `Respondent argued: ${excerpt10(resArg, 350)}` : '');

            /* Prior rulings the justices can cite in conference ('' if none). */
            const precedentBlock10 = await buildPrecedentInjection10(c);

            /* JSON instruction FIRST — ai.ts truncates the TAIL of
               contextMessage, so the instruction must lead. Per-section
               budgets keep the total <= ~3,400 chars. */
            const voteInstruction = c.caseType === 'constitutional_challenge'
              ? `Respond with exactly this JSON: {"action":"judicial_vote","reasoning":"2-3 sentences","data":{"vote":"uphold","citedArticles":[2,5]}} ` +
                `Use "strike" or "uphold". citedArticles must be article numbers 1-8. `
              : `Respond with exactly this JSON: {"action":"judicial_vote","reasoning":"2-3 sentences","data":{"vote":"respondent","citedArticles":[7]}} ` +
                `Use "petitioner" or "respondent". citedArticles must be article numbers 1-8. `;

            const voteResults = await Promise.allSettled(
              justiceAgents10.map((justice) => {
                const contextMessage =
                  voteInstruction +
                  `You are Justice ${justice.displayName} of the Supreme Court of Agora, deciding ${c.caption} (${c.caseNumber}) in conference. ` +
                  `Question presented: ${excerpt10(c.questionPresented, 300)} ` +
                  `${subjectBlock} ${argumentsBlock} ${precedentBlock10}${constitutionBlock10}`;
                return generateAgentDecision(asAgentRecord10(justice), contextMessage, 'judicial_review')
                  .then((decision) => ({ justice, decision }));
              }),
            );

            const voteRows: Array<typeof courtCaseVotes.$inferInsert> = [];
            let votesFor = 0;
            let votesAgainst = 0;
            for (const result of voteResults) {
              if (result.status === 'rejected') {
                console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} justice vote call rejected (abstention):`, result.reason);
                continue;
              }
              const { justice, decision } = result.value;
              if (decision.action !== 'judicial_vote' || !decision.data) continue; // abstention
              const parsed = parseJudicialVoteData(decision.data, c.caseType as 'constitutional_challenge' | 'agent_dispute');
              if (!parsed) {
                console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} vote payload rejected by validator (abstention) — ${justice.displayName}`);
                continue;
              }
              voteRows.push({
                caseId: c.id,
                justiceId: justice.id,
                vote: parsed.vote,
                reasoning: typeof decision.reasoning === 'string' ? excerpt10(decision.reasoning, 800) : null,
                citedArticles: JSON.stringify(parsed.citedArticles),
              });
              if (parsed.vote === 'strike' || parsed.vote === 'petitioner') votesFor++;
              else votesAgainst++;
              console.warn(`[SIMULATION] Phase 10: ${justice.displayName} voted ${parsed.vote} in ${c.caseNumber}`);
            }

            await db.transaction(async (tx) => {
              if (voteRows.length > 0) await tx.insert(courtCaseVotes).values(voteRows);
              await tx
                .update(courtCases)
                .set({ status: 'deliberating', votesFor, votesAgainst })
                .where(eq(courtCases.id, c.id));
              await tx.insert(courtCaseEvents).values({
                caseId: c.id,
                tick: tickNumber,
                type: 'deliberation',
                content: `The justices met in conference on ${c.caption}. ${voteRows.length} of ${justiceAgents10.length} votes recorded.`,
              });
            });
            console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} deliberated — ${votesFor}-${votesAgainst} (${justiceAgents10.length - voteRows.length} abstentions)`);
            continue;
          }

          /* ---- Stage E: Decision (1-2 LLM calls, one wall) ------------- */
          if (stage === 'E') {
            /* Zero-vote guard — a 0-0 case can never strike a law. Reset to
               'argued' so Stage D re-runs; bounded by isStalled (the stall
               clock keys off the FIXED hearingTick, so after 2 failed
               re-runs the case is dismissed without prejudice). */
            if ((c.votesFor ?? 0) + (c.votesAgainst ?? 0) === 0) {
              if (isStalled(c, tickNumber)) {
                await dismissCase10(c, 'Dismissed without prejudice: no votes could be recorded.', 'Dismissed');
              } else {
                await db.transaction(async (tx) => {
                  await tx.update(courtCases).set({ status: 'argued' }).where(eq(courtCases.id, c.id));
                  await tx.insert(courtCaseEvents).values({
                    caseId: c.id,
                    tick: tickNumber,
                    type: 'postponed',
                    content: 'Decision deferred: no votes were recorded.',
                  });
                });
                console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} decision deferred — zero votes, deliberation re-runs`);
              }
              continue;
            }

            const votesFor = c.votesFor ?? 0;
            const votesAgainst = c.votesAgainst ?? 0;
            const isChallenge = c.caseType === 'constitutional_challenge';
            /* Tie -> petitioner side (the existing determineJudicialOutcome
               tie->strike semantics — now only reachable with real votes). */
            const petitionerWins = votesFor >= votesAgainst;
            const outcome = isChallenge
              ? (petitionerWins ? 'struck_down' : 'upheld')
              : (petitionerWins ? 'petitioner' : 'respondent');
            const winningVote = isChallenge
              ? (petitionerWins ? 'strike' : 'uphold')
              : (petitionerWins ? 'petitioner' : 'respondent');

            const caseVotes = await db.select().from(courtCaseVotes).where(eq(courtCaseVotes.caseId, c.id));
            const majorityVotes = caseVotes.filter((v) => v.vote === winningVote);
            const dissentVotes = caseVotes.filter((v) => v.vote !== winningVote);

            /* Majority author: chief justice if in the majority, else the
               highest-reputation majority justice. */
            const highestReputation = (ids: string[]): (typeof activeAgents)[number] | null => {
              const rows = ids
                .map((id) => agentById10.get(id))
                .filter((a): a is (typeof activeAgents)[number] => a !== undefined)
                .sort((a, b) => b.reputation - a.reputation);
              return rows.length > 0 ? rows[0] : null;
            };
            const majorityJusticeIds = majorityVotes.map((v) => v.justiceId);
            const majorityAuthor = (chiefJustice10 && majorityJusticeIds.includes(chiefJustice10.id))
              ? chiefJustice10
              : highestReputation(majorityJusticeIds);
            const dissentAuthor = highestReputation(dissentVotes.map((v) => v.justiceId));

            /* Case facts for the opinion prompts. */
            let lawRow: typeof laws.$inferSelect | null = null;
            let subjectBlock = '';
            if (isChallenge && c.lawId) {
              const [row] = await db.select().from(laws).where(eq(laws.id, c.lawId)).limit(1);
              lawRow = row ?? null;
              subjectBlock = lawRow
                ? `The challenged law "${lawRow.title}": ${excerpt10(lawRow.text, 500)}`
                : '';
            } else if (c.dealId) {
              subjectBlock = await buildDealBlock10(c.dealId);
            }
            const holdingText = isChallenge
              ? (petitionerWins ? 'strikes down the law as unconstitutional' : 'upholds the law as constitutional')
              : (petitionerWins ? 'finds for the petitioner' : 'finds for the respondent');
            const majorityReasonings = majorityVotes
              .map((v) => excerpt10(v.reasoning, 150))
              .filter((r) => r.length > 0)
              .slice(0, 3)
              .join(' | ');

            /* Prior rulings the opinion authors can cite ('' if none) — real
               opinions lean hardest on precedent. */
            const precedentBlock10 = await buildPrecedentInjection10(c);

            const opinionInstruction =
              `Respond with exactly this JSON: {"action":"write_opinion","reasoning":"one sentence","data":{"opinion":"the opinion text, about 150-200 words","citedArticles":[2,5]}} ` +
              `citedArticles must be article numbers 1-8. `;

            type OpinionCall10 = { kind: 'majority' | 'dissent'; author: (typeof activeAgents)[number] };
            const opinionCalls: OpinionCall10[] = [];
            if (majorityAuthor) opinionCalls.push({ kind: 'majority', author: majorityAuthor });
            if (dissentAuthor && dissentVotes.length > 0) opinionCalls.push({ kind: 'dissent', author: dissentAuthor });

            const opinionResults = await Promise.allSettled(
              opinionCalls.map((call) => {
                const stance = call.kind === 'majority'
                  ? `writing the majority opinion — the Court ${holdingText}, ${votesFor}-${votesAgainst}`
                  : `writing the dissent — you disagree with the Court's judgment (${votesFor}-${votesAgainst})`;
                const contextMessage =
                  opinionInstruction +
                  `You are Justice ${call.author.displayName} of the Supreme Court of Agora, ${stance} in ${c.caption} (${c.caseNumber}). ` +
                  `Question presented: ${excerpt10(c.questionPresented, 300)} ` +
                  `${subjectBlock} ` +
                  (call.kind === 'majority' && majorityReasonings ? `Views of the majority: ${majorityReasonings} ` : '') +
                  precedentBlock10 +
                  constitutionBlock10;
                return generateAgentDecision(asAgentRecord10(call.author), contextMessage, 'court_opinion')
                  .then((decision) => ({ call, decision }));
              }),
            );

            /* Deterministic fallbacks — a failed opinion call never blocks
               the ruling. */
            const winnerName = petitionerWins
              ? (agentById10.get(c.petitionerId)?.displayName ?? 'the petitioner')
              : (c.respondentId ? (agentById10.get(c.respondentId)?.displayName ?? 'the respondent') : 'the respondent');
            let majorityOpinion = isChallenge
              ? `The Court holds that "${lawRow?.title ?? 'the challenged law'}" ${petitionerWins ? 'cannot stand under the Constitution of Agora and is struck down' : 'is consistent with the Constitution of Agora and stands'}. Judgment entered ${votesFor}-${votesAgainst}.`
              : `The Court finds for ${winnerName}. Judgment entered ${votesFor}-${votesAgainst}.`;
            let majorityCitations: number[] = [];
            let dissentOpinion: string | null = null;
            let dissentCitations: number[] = [];
            for (let i = 0; i < opinionResults.length; i++) {
              const call = opinionCalls[i];
              const result = opinionResults[i];
              let parsedOpinion: { opinion: string; citedArticles: number[] } | null = null;
              if (result.status === 'fulfilled') {
                const { decision } = result.value;
                if (decision.action === 'write_opinion' && decision.data) {
                  parsedOpinion = parseJudicialOpinionData(decision.data);
                }
              } else {
                console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} opinion LLM call rejected:`, result.reason);
              }
              if (call.kind === 'majority') {
                if (parsedOpinion) {
                  majorityOpinion = parsedOpinion.opinion;
                  majorityCitations = parsedOpinion.citedArticles;
                }
              } else {
                dissentOpinion = parsedOpinion
                  ? parsedOpinion.opinion
                  : `Justice ${call.author.displayName}, dissenting: the judgment of the Court is entered over dissent.`;
                dissentCitations = parsedOpinion ? parsedOpinion.citedArticles : [];
              }
            }
            const dissentAuthorId = dissentVotes.length > 0 && dissentAuthor !== null ? dissentAuthor.id : null;
            const finalDissentOpinion = dissentAuthorId !== null ? dissentOpinion : null;

            /* Dispute damages — clamped to the loser's live balance. */
            const loserId = petitionerWins ? c.respondentId : c.petitionerId;
            const winnerId = petitionerWins ? c.petitionerId : c.respondentId;
            let damages = 0;
            if (!isChallenge && loserId && winnerId) {
              const [loserBalanceRow] = await db
                .select({ balance: agents.balance })
                .from(agents)
                .where(eq(agents.id, loserId))
                .limit(1);
              damages = Math.max(0, Math.min(rc.courtDamagesAmount, loserBalanceRow?.balance ?? 0));
            }

            await db.transaction(async (tx) => {
              if (isChallenge && c.lawId) {
                if (petitionerWins) {
                  await tx.update(laws).set({ isActive: false }).where(eq(laws.id, c.lawId));
                  await tx.insert(activityEvents).values({
                    type: 'law_struck_down',
                    agentId: null,
                    title: 'Law struck down',
                    description: `The Supreme Court struck down "${lawRow?.title ?? 'a law'}" in ${c.caption} (${votesFor}-${votesAgainst})`,
                    metadata: JSON.stringify({ lawId: c.lawId, caseId: c.id, caseNumber: c.caseNumber, votesFor, votesAgainst }),
                  });
                } else {
                  await tx.insert(activityEvents).values({
                    type: 'law_upheld',
                    agentId: null,
                    title: 'Law upheld',
                    description: `The Supreme Court upheld "${lawRow?.title ?? 'a law'}" in ${c.caption} (${votesAgainst}-${votesFor})`,
                    metadata: JSON.stringify({ lawId: c.lawId, caseId: c.id, caseNumber: c.caseNumber, votesFor, votesAgainst }),
                  });
                }
              } else if (!isChallenge && loserId && winnerId) {
                if (damages > 0) {
                  const [winnerBalanceRow] = await tx
                    .select({ balance: agents.balance })
                    .from(agents)
                    .where(eq(agents.id, winnerId))
                    .limit(1);
                  const winnerBalanceAfter = (winnerBalanceRow?.balance ?? 0) + damages;
                  await tx.update(agents).set({ balance: sql`${agents.balance} - ${damages}` }).where(eq(agents.id, loserId));
                  await tx.update(agents).set({ balance: sql`${agents.balance} + ${damages}` }).where(eq(agents.id, winnerId));
                  await tx.insert(transactions).values({
                    fromAgentId: loserId,
                    toAgentId: winnerId,
                    amount: damages,
                    type: 'court_damages',
                    description: `Damages awarded in ${c.caption} (${c.caseNumber})`,
                    balanceAfter: winnerBalanceAfter,
                  });
                }
                /* Litigation sours relations — Phase 2b/2c upsert pattern. */
                await tx.insert(agentRelationships)
                  .values({ agentId: loserId, targetAgentId: winnerId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
                  .onConflictDoUpdate({
                    target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                    set: {
                      voteAlignment: sql`GREATEST(0.0, agent_relationships.vote_alignment - 0.10)`,
                      sentiment: sql`GREATEST(0.0, agent_relationships.sentiment - 0.12)`,
                      updatedAt: new Date(),
                    },
                  });
                await tx.insert(agentRelationships)
                  .values({ agentId: winnerId, targetAgentId: loserId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
                  .onConflictDoUpdate({
                    target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                    set: {
                      sentiment: sql`GREATEST(0.0, agent_relationships.sentiment - 0.05)`,
                      updatedAt: new Date(),
                    },
                  });
              }

              await tx
                .update(courtCases)
                .set({
                  status: 'decided',
                  outcome,
                  decidedTick: tickNumber,
                  decidedAt: new Date(),
                  majorityOpinion,
                  majorityAuthorId: majorityAuthor?.id ?? null,
                  majorityCitations: JSON.stringify(majorityCitations),
                  dissentOpinion: finalDissentOpinion,
                  dissentAuthorId,
                  dissentCitations: dissentAuthorId !== null ? JSON.stringify(dissentCitations) : null,
                })
                .where(eq(courtCases.id, c.id));

              await tx.insert(courtCaseEvents).values({
                caseId: c.id,
                tick: tickNumber,
                type: 'majority_opinion',
                actorId: majorityAuthor?.id ?? null,
                role: 'justice',
                content: majorityOpinion,
              });
              if (dissentAuthorId !== null && finalDissentOpinion !== null) {
                await tx.insert(courtCaseEvents).values({
                  caseId: c.id,
                  tick: tickNumber,
                  type: 'dissent',
                  actorId: dissentAuthorId,
                  role: 'justice',
                  content: finalDissentOpinion,
                });
              }
              await tx.insert(courtCaseEvents).values({
                caseId: c.id,
                tick: tickNumber,
                type: 'ruling',
                content: isChallenge
                  ? `Decided ${votesFor}-${votesAgainst}: the law is ${petitionerWins ? 'struck down' : 'upheld'}.`
                  : `Decided ${votesFor}-${votesAgainst} for the ${petitionerWins ? 'petitioner' : 'respondent'}.${damages > 0 ? ` Damages of $${damages} awarded.` : ''}`,
              });
            });

            /* Post-transaction effects — failure-soft helpers + broadcasts. */
            if (!isChallenge && loserId && winnerId) {
              await updateApproval(winnerId, 2, 'court_ruling', `Won ${c.caption} before the Supreme Court`);
              await updateApproval(loserId, -3, 'court_ruling', `Lost ${c.caption} before the Supreme Court`);
            }
            if (isChallenge && petitionerWins && c.lawId) {
              broadcast('law:struck_down', {
                lawId: c.lawId,
                lawTitle: lawRow?.title ?? 'a law',
                caseId: c.id,
                caseNumber: c.caseNumber,
                constitutionalCount: votesAgainst,
                unconstitutionalCount: votesFor,
              });
            }
            broadcast('court:ruling', {
              caseId: c.id,
              caseNumber: c.caseNumber,
              caption: c.caption,
              caseType: c.caseType,
              outcome,
              votesFor,
              votesAgainst,
            });
            console.warn(`[SIMULATION] Phase 10: ${c.caseNumber} decided ${votesFor}-${votesAgainst} — ${outcome}`);
            continue;
          }
        } catch (caseErr) {
          console.warn(`[SIMULATION] Phase 10: case ${c.caseNumber} stage error:`, caseErr);
        }
      }

      /* ---- Stage A: New filings LAST (docket-room gate applies HERE ---- */
      /* only — Stage B docketing is unconditional). Both sources share     */
      /* one per-tick cap. Re-run safety: laws/deals already under an       */
      /* active case are skipped, and UNIQUE(case_number) backstops.        */
      const [activeCountRow10] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(courtCases)
        .where(inArray(courtCases.status, [...ACTIVE_CASE_STATUSES]));
      const activeCount10 = Number(activeCountRow10?.count ?? 0);

      type FilingCandidate10 = {
        caseType: 'constitutional_challenge' | 'agent_dispute';
        petitioner: (typeof activeAgents)[number];
        respondentId: string | null;
        respondentName: string | null;
        lawId: string | null;
        dealId: string | null;
        caption: string;
        subjectBlock: string;
        subjectTitle: string;
      };
      const candidates10: FilingCandidate10[] = [];
      const docketHasRoom = (): boolean => activeCount10 + candidates10.length < rc.courtMaxConcurrentCases;
      const underTickCap = (): boolean => candidates10.length < rc.courtMaxNewCasesPerTick;

      /* Source 1 — constitutional challenges: Engine 7 weighted roll over
         the 20 MOST RECENT active laws (recency-ordered so the recency
         bonus actually sees young laws). */
      if (underTickCap() && docketHasRoom()) {
        const recentActiveLaws = await db
          .select()
          .from(laws)
          .where(eq(laws.isActive, true))
          .orderBy(desc(laws.enactedDate))
          .limit(20);

        /* Batch-fetch source bills for contestation scoring + sponsor. */
        const lawBillIds = recentActiveLaws.map((l) => l.billId).filter(Boolean);
        const sourceBills = lawBillIds.length > 0
          ? await db.select({ id: bills.id, yeaCount: bills.yeaCount, nayCount: bills.nayCount, sponsorId: bills.sponsorId })
              .from(bills)
              .where(inArray(bills.id, lawBillIds))
          : [];
        const sourceBillMap = new Map(sourceBills.map((b) => [b.id, b]));

        /* Skip laws already under an active case. */
        const challengedLawRows = await db
          .select({ lawId: courtCases.lawId })
          .from(courtCases)
          .where(and(isNotNull(courtCases.lawId), inArray(courtCases.status, [...ACTIVE_CASE_STATUSES])));
        const challengedLawIds = new Set(challengedLawRows.map((r) => r.lawId));

        for (const law of recentActiveLaws) {
          /* Break the instant the cap is reached — worst case stays at
             courtMaxNewCasesPerTick filings, not ~20 rate-hits. */
          if (!underTickCap() || !docketHasRoom()) break;
          if (challengedLawIds.has(law.id)) continue;

          /* Weighted judicial challenge score (Engine 7) */
          let challengeScore = rc.judicialChallengeRatePerLaw;

          /* Recency bonus: laws enacted within 2 ticks are more likely to be challenged */
          const lawAgeTicks = law.enactedDate
            ? Math.floor((Date.now() - new Date(law.enactedDate).getTime()) / (rc.tickIntervalMs ?? 900000))
            : 999;
          if (lawAgeTicks <= 2) {
            challengeScore *= (rc.judicialRecencyBonus ?? 1.5);
          }

          /* Contested law bonus: bills that passed with a narrow margin face more scrutiny */
          const sourceBill = sourceBillMap.get(law.billId);
          if (sourceBill) {
            const totalLawVotes = (sourceBill.yeaCount ?? 0) + (sourceBill.nayCount ?? 0);
            if (totalLawVotes > 0) {
              const yeaFraction = (sourceBill.yeaCount ?? 0) / totalLawVotes;
              if (yeaFraction < 0.60) {
                challengeScore *= (rc.judicialContestationBonus ?? 1.8);
              }
            }
          }

          /* Cap at 0.40 */
          challengeScore = Math.min(0.40, challengeScore);

          if (Math.random() >= challengeScore) continue;

          /* Petitioner: the nay voter on the source bill with the LOWEST
             approvalRating (the aggrieved underdog); fallback random nay
             voter; fallback lowest-approval active non-sponsor. NO
             alignment math — agents.alignment is categorical. */
          const sponsorId = sourceBill?.sponsorId ?? null;
          const nayVoterRows = await db
            .select({ voterId: billVotes.voterId })
            .from(billVotes)
            .where(and(eq(billVotes.billId, law.billId), eq(billVotes.choice, 'nay')));
          const nayAgents = nayVoterRows
            .map((v) => agentById10.get(v.voterId))
            .filter((a): a is (typeof activeAgents)[number] => a !== undefined)
            .sort((a, b) => a.approvalRating - b.approvalRating);
          /* nayAgents is approval-sorted, so [0] IS the lowest-approval nay
             voter. (The "random nay voter" fallback of the spec chain is
             unreachable: approvalRating is NOT NULL, so a nonempty pool
             always yields a lowest.) Final fallback: lowest-approval
             active non-sponsor. */
          let petitioner: (typeof activeAgents)[number] | undefined = nayAgents[0];
          if (!petitioner) {
            const nonSponsors = activeAgents
              .filter((a) => a.id !== sponsorId)
              .sort((a, b) => a.approvalRating - b.approvalRating);
            petitioner = nonSponsors[0];
          }
          if (!petitioner) continue;

          /* Respondent: the law's sponsor when still active; the case is
             captioned against Agora either way. */
          const sponsor = sponsorId ? agentById10.get(sponsorId) : undefined;
          candidates10.push({
            caseType: 'constitutional_challenge',
            petitioner,
            respondentId: sponsor?.id ?? null,
            respondentName: sponsor?.displayName ?? null,
            lawId: law.id,
            dealId: null,
            caption: `${petitioner.displayName} v. Agora`.slice(0, 200),
            subjectBlock: `The law "${law.title}": ${excerpt10(law.text, 500)}`,
            subjectTitle: law.title,
          });
        }
      }

      /* Source 2 — agent disputes: one roll per deal broken THIS tick
         (Phase 2c), petitioner = the wronged party, respondent = the
         breaker, dealId stored as the durable source of dispute facts. */
      for (const broken of brokenDealsThisTick) {
        if (!underTickCap() || !docketHasRoom()) break;
        if (Math.random() >= rc.courtDisputeChancePerBrokenDeal) continue;
        if (candidates10.some((cand) => cand.dealId === broken.dealId)) continue;

        const [existingDealCase] = await db
          .select({ id: courtCases.id })
          .from(courtCases)
          .where(and(eq(courtCases.dealId, broken.dealId), inArray(courtCases.status, [...ACTIVE_CASE_STATUSES])))
          .limit(1);
        if (existingDealCase) continue;

        const [deal] = await db.select().from(agentDeals).where(eq(agentDeals.id, broken.dealId)).limit(1);
        if (!deal) continue;
        const petitioner = agentById10.get(broken.wrongedPartyId);
        const breakerId = deal.initiatorId === broken.wrongedPartyId ? deal.targetId : deal.initiatorId;
        const respondent = agentById10.get(breakerId);
        if (!petitioner || !respondent) continue;

        candidates10.push({
          caseType: 'agent_dispute',
          petitioner,
          respondentId: respondent.id,
          respondentName: respondent.displayName,
          lawId: null,
          dealId: deal.id,
          caption: `${petitioner.displayName} v. ${respondent.displayName}`.slice(0, 200),
          subjectBlock:
            `The agreement at issue: ${agentById10.get(deal.initiatorId)?.displayName ?? 'The initiator'} committed to ` +
            `"${excerpt10(deal.initiatorCommitment, 240)}"; ${agentById10.get(deal.targetId)?.displayName ?? 'the other party'} ` +
            `committed to "${excerpt10(deal.targetCommitment, 240)}".`,
          subjectTitle: 'a broken agreement',
        });
      }

      if (candidates10.length > 0) {
        /* One filing LLM call per candidate, single wall. */
        const filingResults = await Promise.allSettled(
          candidates10.map((cand) => {
            const framing = cand.caseType === 'constitutional_challenge'
              ? `You are ${cand.petitioner.displayName}, filing a case before the Supreme Court of Agora challenging ${cand.subjectBlock} as unconstitutional. `
              : `You are ${cand.petitioner.displayName}, filing a case before the Supreme Court of Agora against ${cand.respondentName} seeking relief under Article 7 (Contracts & Compacts). ${cand.subjectBlock} `;
            const prompt =
              `Respond with exactly this JSON: {"action":"file_case","reasoning":"one sentence","data":{"filing":"your petition in 2-3 sentences","questionPresented":"the legal question in one sentence"}} ` +
              framing +
              constitutionBlock10;
            return generateAgentDecision(asAgentRecord10(cand.petitioner), prompt, 'court_filing')
              .then((decision) => ({ decision }));
          }),
        );

        /* caseNumber = AB-{filedTick}-{seq}; seq base counted ONCE before
           the sequential inserts (no race inside the phase). The UNIQUE
           constraint backstops a same-tick refile. */
        const [filedTodayRow] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(courtCases)
          .where(eq(courtCases.filedTick, tickNumber));
        let seq10 = Number(filedTodayRow?.count ?? 0);

        for (let i = 0; i < candidates10.length; i++) {
          const cand = candidates10[i];
          const result = filingResults[i];

          /* Rule-4 whitelist parse; a failed call files with deterministic
             fallback text — a rolled filing is never suppressed by an LLM
             failure. */
          let filing: string | null = null;
          let questionPresented: string | null = null;
          if (result.status === 'fulfilled') {
            const { decision } = result.value;
            if (decision.action === 'file_case' && decision.data) {
              const parsed = parseJudicialFilingData(decision.data);
              if (parsed) {
                filing = parsed.filing;
                questionPresented = parsed.questionPresented;
              }
            }
          } else {
            console.warn(`[SIMULATION] Phase 10: filing LLM call rejected for ${cand.caption}:`, result.reason);
          }
          if (!filing || !questionPresented) {
            if (cand.caseType === 'constitutional_challenge') {
              filing = `${cand.petitioner.displayName} petitions the Court to strike down "${cand.subjectTitle}" as inconsistent with the Constitution of Agora.`;
              questionPresented = `Is "${excerpt10(cand.subjectTitle, 150)}" consistent with the Constitution of Agora?`;
            } else {
              filing = `${cand.petitioner.displayName} seeks relief for a commitment broken by ${cand.respondentName ?? 'the respondent'}.`;
              questionPresented = `Did ${cand.respondentName ?? 'the respondent'} break a binding commitment under Article 7, and is relief owed?`;
            }
          }

          seq10 += 1;
          const caseNumber = `AB-${tickNumber}-${seq10}`;
          try {
            let newCaseId: string | null = null;
            await db.transaction(async (tx) => {
              const [inserted] = await tx
                .insert(courtCases)
                .values({
                  caseNumber,
                  caption: cand.caption,
                  caseType: cand.caseType,
                  status: 'filed',
                  lawId: cand.lawId,
                  dealId: cand.dealId,
                  petitionerId: cand.petitioner.id,
                  respondentId: cand.respondentId,
                  questionPresented,
                  filingText: filing,
                  filedTick: tickNumber,
                })
                .returning({ id: courtCases.id });
              newCaseId = inserted?.id ?? null;
              if (!newCaseId) throw new Error('court_cases insert returned no id');
              await tx.insert(courtCaseEvents).values({
                caseId: newCaseId,
                tick: tickNumber,
                type: 'filing',
                actorId: cand.petitioner.id,
                role: 'petitioner',
                content: filing,
              });
              await tx.insert(activityEvents).values({
                type: 'court_case_filed',
                agentId: cand.petitioner.id,
                title: `Case filed: ${cand.caption}`.slice(0, 200),
                description: questionPresented ?? filing ?? '',
                metadata: JSON.stringify({
                  caseId: newCaseId,
                  caseNumber,
                  caseType: cand.caseType,
                  lawId: cand.lawId,
                  dealId: cand.dealId,
                }),
              });
            });
            broadcast('court:case_filed', {
              caseId: newCaseId,
              caseNumber,
              caption: cand.caption,
              caseType: cand.caseType,
              petitionerId: cand.petitioner.id,
              respondentId: cand.respondentId,
            });
            console.warn(`[SIMULATION] Phase 10: ${caseNumber} filed — ${cand.caption} (${cand.caseType})`);
          } catch (insertErr) {
            /* UNIQUE(case_number) conflict = same-tick refile backstop. */
            console.warn(`[SIMULATION] Phase 10: filing insert skipped for ${caseNumber} (${cand.caption}):`, insertErr);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 10 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* Macro Engine step (E5 world-model Layer 1, docs/specs/world-model.md */
  /* §2). Deterministic, no LLM. OBSERVE-ONLY: writes world_state, read   */
  /* by nothing in this slice. Dark by default (rc.macroEngineEnabled).   */
  /* stepMacroEngine never throws; try/catch here is belt-and-suspenders, */
  /* mirroring the world-feed block.                                      */
  /* ------------------------------------------------------------------ */
  if (rc.macroEngineEnabled && tickNumber % rc.macroStepEveryNTicks === 0) {
    try {
      const result = await stepMacroEngine(tickNumber, currentTick?.id ?? null);
      if (result) {
        const s = result.state;
        console.warn(
          `[SIMULATION] Macro: ${result.seeded ? 'seeded T0' : 'stepped'} — ` +
          `regime=${s.regime}, g=${s.gdpGrowthPct.toFixed(2)}%, u=${s.unemploymentPct.toFixed(2)}%, ` +
          `pi=${s.inflationPct.toFixed(2)}%, sent=${s.sentiment.toFixed(1)}`,
        );
      }
    } catch (err) {
      console.warn('[SIMULATION] Macro step error:', err);
    }
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 11: Agent Bill Proposal                                         */
  /* Each agent has a 30% chance to propose a bill if they haven't        */
  /* sponsored one in the last 5 minutes. 25% chance of amendment bill.   */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 11: Agent Bill Proposal'); broadcast('tick:phase', { phase: 'economy' });

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);

    /* Fetch treasury state once for economy-pressure modifiers and the
       budget-cycle position (Phase 3 renewal pressure). */
    const [govSettings11] = await db.select({
      treasuryBalance: governmentSettings.treasuryBalance,
      taxRatePercent: governmentSettings.taxRatePercent,
      lastBudgetSessionTick: governmentSettings.lastBudgetSessionTick,
      debtOutstanding: governmentSettings.debtOutstanding,
    }).from(governmentSettings).limit(1);

    /* Get top 10 active laws for potential amendment. fiscalKind/fiscalAmount
       are carried alongside id/title (not just for display) so the mandatory-
       amendment path below can build parseFiscalField's amendedLaw context
       without a second per-bill query — same "read once, reuse" shape as the
       existing renewal-pressure query just below. */
    const topActiveLaws = await db
      .select({ id: laws.id, title: laws.title, fiscalKind: laws.fiscalKind, fiscalAmount: laws.fiscalAmount })
      .from(laws)
      .where(eq(laws.isActive, true))
      .limit(10);

    /* Phase 3 renewal pressure: programs that will lapse at the NEXT budget
       session unless renewed. Deterministic and bounded (<= 3 programs,
       <= 220 chars via composeExpiringProgramsNote) — no new LLM surface.
       Their laws also join the amendable list below: renewal rides the
       existing amendment path, which validates amendsLawId against that
       list, so an expiring program outside the arbitrary top-10 slice would
       otherwise be structurally impossible to renew. */
    let expiringPrograms: { id: string; title: string; name: string; perTick: number }[] = [];
    if (rc.fiscalEffectsEnabled) {
      try {
        /* Sessions fire when tickNumber - lastSessionTick >= cycleTicks, so
           the next one is at lastSessionTick + cycleTicks (never in the past:
           Phase 9.7 ran earlier this same tick and re-baselined if due). */
        const nextSessionTick = Math.max(
          tickNumber,
          (govSettings11?.lastBudgetSessionTick ?? 0) + rc.budgetCycleTicks,
        );
        const programRows11 = await db
          .select()
          .from(laws)
          .where(and(eq(laws.isActive, true), eq(laws.programActive, true), eq(laws.fiscalKind, 'spend_recurring')));
        expiringPrograms = programRows11
          .filter((p) => lapseDue(nextSessionTick, p.enactedTick, p.lastRenewedTick, rc.budgetCycleTicks))
          .map((p) => ({
            id: p.id,
            title: p.title,
            name: p.fiscalProgramName ?? p.title,
            perTick: typeof p.fiscalAmount === 'number' && Number.isFinite(p.fiscalAmount) ? p.fiscalAmount : 0,
          }));
      } catch (err) {
        console.warn('[SIMULATION] Phase 11: expiring-program query failed — no renewal note:', err);
      }
    }

    /* Uniform shape across both sources so the mandatory-amendment lookup
       below (keyed on fiscalKind/fiscalAmount) works regardless of which
       query surfaced the law. Expiring programs are always spend_recurring
       (mandatory never lapses — Phase 9.7), so their fiscalKind/perTick are
       already known from that query. */
    const amendableLaws: { id: string; title: string; fiscalKind: string | null; fiscalAmount: number | null }[] = [
      ...topActiveLaws,
      ...expiringPrograms
        .filter((p) => !topActiveLaws.some((l) => l.id === p.id))
        .map((p) => ({ id: p.id, title: p.title, fiscalKind: 'spend_recurring', fiscalAmount: p.perTick })),
    ];
    const lawsList = amendableLaws.map((l) => `${l.title} (ID: ${l.id})`).join(', ');

    const expiringNote = composeExpiringProgramsNote(expiringPrograms);
    const renewalNote = expiringNote
      ? `${expiringNote} Renew one by proposing an amendment to its law with a spend_recurring fiscal provision.`
      : '';

    /* Crisis ratio is measured against the dollar-era treasury seed (1.5T),
       matching TREASURY_SEED_VALUE in ai.ts — not the retired 50k MoltDollar seed. */
    const TREASURY_SEED_11 = 1_500_000_000_000;
    const treasuryRatio = (govSettings11?.treasuryBalance ?? TREASURY_SEED_11) / TREASURY_SEED_11;
    const crisisThreshold = rc.treasuryCrisisThreshold ?? 0.20;
    const crisisMultiplier = rc.economyProposalMultiplierCrisis ?? 1.4;

    /* Divergence E1 slice 1: debt-ratio crisis condition, additive to the
       existing treasury-level check above — only evaluated when the debt
       engine is on (debtOutstanding is always 0 otherwise, so the ratio
       would be a meaningless 0% anyway). Real debt/GDP is ~120%; default
       threshold 150% per spec (nobody calls 120% a crisis today). */
    const debtRatioPct11 = rc.debtEngineEnabled && rc.gdpAnnual > 0
      ? ((govSettings11?.debtOutstanding ?? 0) / rc.gdpAnnual) * 100
      : 0;
    const debtCrisis11 = rc.debtEngineEnabled && debtRatioPct11 > rc.debtCrisisRatioPct;

    /* Advertised spend_once ceiling for the prompt: the live clamp is
       fiscalMaxOneTimePctOfTreasury% of the current treasury (fiscalParsing.ts),
       so quote that instead of a hardcoded range that the validator would reject. */
    const treasury11 = govSettings11?.treasuryBalance ?? 0;
    const maxOnce11 = treasury11 > 0
      ? Math.max(1, Math.floor((treasury11 * rc.fiscalMaxOneTimePctOfTreasury) / 100))
      : 0;
    const maxOnceCompact = compactDollars(maxOnce11);

    /* Divergence E1 slice 1: compact debt-context line for the proposal
       prompt — debt outstanding, daily interest, mandatory total/day, and
       the amend-mandatory allowance. Computed once (agent-invariant), not
       per-agent. Zero cost when the debt engine is off. */
    let debtContextNote11 = '';
    if (rc.debtEngineEnabled) {
      try {
        const mandatoryRows11 = await db
          .select({ fiscalAmount: laws.fiscalAmount, enactedTick: laws.enactedTick })
          .from(laws)
          .where(and(eq(laws.isActive, true), eq(laws.fiscalKind, 'mandatory')));
        const mandatoryTotal11 = mandatoryRows11.reduce((sum, r) => {
          if (typeof r.fiscalAmount !== 'number' || typeof r.enactedTick !== 'number') return sum;
          return sum + mandatoryEffectiveAmount(r.fiscalAmount, r.enactedTick, tickNumber, rc.mandatoryGrowthPctAnnual);
        }, 0);
        const debtOutstanding11 = govSettings11?.debtOutstanding ?? 0;
        const dailyInterest11 = tickInterest(debtOutstanding11, rc.debtInterestRatePct);
        debtContextNote11 =
          `\n\nNational debt: ${compactDollars(debtOutstanding11)} outstanding, ${compactDollars(dailyInterest11)}/day interest. ` +
          `Mandatory spending (Social Security, Medicare, etc.): ${compactDollars(mandatoryTotal11)}/day, automatic, not subject to lapse. ` +
          `You may amend an existing mandatory law's funding level by up to ±${rc.fiscalMaxMandatoryDeltaPct}% per amendment — you cannot create new mandatory programs.`;
      } catch (err) {
        console.warn('[SIMULATION] Phase 11: debt-context query failed — omitting debt note:', err);
      }
    }

    /* Fetch latest coalition snapshot for bloc context in proposals */
    const [latestSnapshot] = await db.select()
      .from(coalitionSnapshots)
      .orderBy(desc(coalitionSnapshots.createdAt))
      .limit(1);

    const billCountThisTick = new Map<string, number>();

    /* One pre-query replaces the per-agent recent-sponsorship check */
    const activeAgentIds11 = activeAgents.map((a) => a.id);
    const recentSponsorRows = activeAgentIds11.length > 0
      ? await db
          .select({ sponsorId: bills.sponsorId })
          .from(bills)
          .where(and(inArray(bills.sponsorId, activeAgentIds11), gte(bills.introducedAt, fiveMinutesAgo)))
      : [];
    const recentSponsorIds = new Set(recentSponsorRows.map((r) => r.sponsorId));

    /* Selection pass (serial, cheap/deterministic): chance gates + context
       assembly. Each agent appears at most once, which enforces
       maxBillsPerAgentPerTick at selection time exactly as before. */
    const proposalCalls: Array<{ agent: (typeof activeAgents)[number]; contextMessage: string }> = [];

    for (const agent of activeAgents) {
      if ((billCountThisTick.get(agent.id) ?? 0) >= rc.maxBillsPerAgentPerTick) continue;

      /* Economy-pressure-modified bill proposal rate (Engine 7) */
      let effectiveProposalChance = rc.billProposalChance;

      /* Treasury pressure: fiscal crisis drives more legislation */
      if (treasuryRatio < crisisThreshold) {
        const alignment = agent.alignment ?? 'moderate';
        if (alignment === 'conservative' || alignment === 'libertarian') {
          effectiveProposalChance *= crisisMultiplier; // austerity urgency
        } else if (alignment === 'progressive') {
          effectiveProposalChance *= (crisisMultiplier * 0.9); // tax reform urgency
        }
      }

      /* Divergence E1 slice 1: debt-ratio crisis is additive to the
         treasury-level check above (both may apply) — same alignment-based
         urgency split, since a debt crisis is a distress signal exactly
         like a depleted treasury. No-op entirely when the debt engine is
         off (debtCrisis11 is always false). */
      if (debtCrisis11) {
        const alignment = agent.alignment ?? 'moderate';
        if (alignment === 'conservative' || alignment === 'libertarian') {
          effectiveProposalChance *= crisisMultiplier; // austerity urgency
        } else if (alignment === 'progressive') {
          effectiveProposalChance *= (crisisMultiplier * 0.9); // tax reform urgency
        }
      }

      /* Agent wealth: broke agents have less legislative energy */
      const initialBalance = rc.initialAgentBalance ?? 1000;
      const wealthRatio = (agent.balance ?? initialBalance) / initialBalance;
      if (wealthRatio < 0.25) {
        effectiveProposalChance *= 0.7;
      }

      if (Math.random() >= effectiveProposalChance) continue;

      /* Skip agents who sponsored a bill in the last 5 minutes */
      if (recentSponsorIds.has(agent.id)) continue;

      /* Amendment chance — uses rc.amendmentProposalChance instead of hardcoded 0.25 */
      const proposeAmendment = amendableLaws.length > 0 && Math.random() < (rc.amendmentProposalChance ?? 0.25);

      const amendmentNote = proposeAmendment && lawsList
        ? ` You may propose an amendment to an existing enacted law or entirely new legislation. ` +
          `Active laws you could amend: ${lawsList}. ` +
          `If amending, set billType to "amendment" and amendsLawId to the law's ID (UUID).`
        : '';

      const treasuryLabel = treasuryRatio < 0.2 ? 'CRITICAL' : treasuryRatio < 0.5 ? 'strained' : 'healthy';
      const economyContext =
        `\n\nCurrent economic context: Treasury $${govSettings11?.treasuryBalance?.toLocaleString() ?? 'unknown'} (${treasuryLabel}), tax rate ${govSettings11?.taxRatePercent ?? 2}%`;

      /* Coalition context — tell the agent about its voting bloc */
      const snapshotBlocs = latestSnapshot
        ? (latestSnapshot.blocs as Array<{ name: string; members: string[] }>)
        : null;
      const agentBloc = snapshotBlocs
        ? snapshotBlocs.find(b => b.members.some(m =>
            m === agent.displayName || activeAgents.find(a => a.displayName === m)?.id === agent.id))
        : null;
      const coalitionNote = agentBloc && agentBloc.members.length > 1
        ? `\n\nYou are part of an informal voting bloc with: ${agentBloc.members.filter(m => m !== agent.displayName).join(', ')}. Consider them as potential co-sponsors.`
        : '';

      /* Phase 3: optional fiscal payload — extracted from structured JSON only
         (never fullText), validated by parseFiscalField, no-op on any failure. */
      const fiscalNote11 =
        ` Optional fiscal provision (all amounts in US dollars at national scale): ` +
        `"spend_once" spends amount from the treasury once — capped this tick at ${maxOnceCompact} ` +
        `(${rc.fiscalMaxOneTimePctOfTreasury}% of the current treasury); ` +
        `"spend_recurring" funds a named program at amount per tick until it lapses; ` +
        `"tax_change" moves the tax rate by taxDelta whole points; use kind "none" for no fiscal effect.`;

      const contextMessage =
        `You are considering proposing new legislation. Based on your political alignment and values, propose a bill. ` +
        `Consider the political landscape of 2025: AI governance debates, automation policy, digital rights, fiscal challenges from technological disruption.${amendmentNote}${economyContext}${coalitionNote}${fiscalNote11}${renewalNote}${debtContextNote11} ` +
        `Respond with exactly this JSON: {"action":"propose","reasoning":"one sentence","data":{"title":"Bill Title","summary":"One sentence summary","committee":"Budget|Technology|Foreign Affairs|Judiciary","billType":"original","amendsLawId":"","fiscal":{"kind":"none|spend_once|spend_recurring|tax_change","amount":0,"taxDelta":0,"programName":"","sunsetTicks":0}}}`;

      proposalCalls.push({ agent, contextMessage });
    }

    /* Fire all bill-proposal LLM calls in parallel */
    const proposalResults = await Promise.allSettled(
      proposalCalls.map(({ agent, contextMessage }) =>
        generateAgentDecision(
          {
            id: agent.id,
            displayName: agent.displayName,
            alignment: agent.alignment,
            modelProvider: rc.providerOverride === 'default' ? agent.modelProvider : rc.providerOverride,
            personality: agent.personality,
            model: agent.model,
            ownerUserId: agent.ownerUserId,
          },
          contextMessage,
          'bill_proposal',
        ).then((decision) => ({ agent, decision })),
      ),
    );

    /* Phase 3: fiscal clamp context, fetched ONCE before the processing loop.
       activeRecurringSpend11 is a RUNNING total — every provision approved in
       this loop adds to it, so multiple same-tick programs cannot jointly
       bust the aggregate recurring cap. */
    const expectedRevenue11 = elasticCitizenRevenue(rc.gdpAnnual, govSettings11?.taxRatePercent ?? 0, { elasticityStrength: rc.taxElasticityStrength, neutralRatePercent: rc.taxNeutralRatePercent, peakRatePercent: rc.taxRevenuePeakPercent });
    let activeRecurringSpend11 = 0;
    try {
      const [spendRow] = await db
        .select({ total: sql<number>`COALESCE(SUM(${laws.fiscalAmount}), 0)` })
        .from(laws)
        .where(and(eq(laws.isActive, true), eq(laws.programActive, true), eq(laws.fiscalKind, 'spend_recurring')));
      activeRecurringSpend11 = Number(spendRow?.total ?? 0);
      if (!Number.isFinite(activeRecurringSpend11) || activeRecurringSpend11 < 0) activeRecurringSpend11 = 0;
    } catch (err) {
      console.warn('[SIMULATION] Phase 11: active recurring spend query failed — using 0:', err);
    }

    /* Process results serially: validation, sanitization, inserts, broadcasts */
    for (const result of proposalResults) {
      if (result.status === 'rejected') {
        console.warn('[SIMULATION] Phase 11: Bill proposal LLM call rejected:', result.reason);
        continue;
      }
      const { agent, decision } = result.value;

      if (decision.action !== 'propose' || !decision.data) continue;

      const title = String(decision.data['title'] ?? '').trim();
      const summary = String(decision.data['summary'] ?? '').trim();
      /* Sanitize committee — AI sometimes returns pipe-separated options */
      const VALID_COMMITTEES = ['Budget', 'Technology', 'Foreign Affairs', 'Judiciary'];
      let rawCommittee = String(decision.data['committee'] ?? '').trim();
      if (rawCommittee.includes('|')) {
        rawCommittee = rawCommittee.split('|').map((s) => s.trim()).find((s) => VALID_COMMITTEES.includes(s)) ?? 'Technology';
      }
      const committee = VALID_COMMITTEES.includes(rawCommittee) ? rawCommittee : 'Technology';
      const billType = String(decision.data['billType'] ?? 'original').trim();
      const amendsLawIdRaw = String(decision.data['amendsLawId'] ?? '').trim();

      if (!title || !summary) continue;

      /* Validate amendsLawId if amendment — against the merged amendable
         list (top-10 + expiring programs), so renewal amendments survive. */
      const isAmendment = billType === 'amendment' && amendsLawIdRaw.length > 0;
      const validLawId = isAmendment
        ? amendableLaws.find((l) => l.id === amendsLawIdRaw)?.id ?? null
        : null;

      const fullText =
        `SECTION 1. SHORT TITLE.\nThis Act may be cited as the "${title}".\n\nSECTION 2. PURPOSE.\n${summary}`;

      /* Divergence E1 slice 1: minimal amendment-target context for the
         mandatory clamp path — the SAME amendableLaws row validLawId was
         just resolved against, so no extra query. Undefined for original
         bills / unresolved amendments (parseFiscalField then structurally
         rejects any kind:'mandatory' request, per spec). */
      const amendedLawTarget = validLawId ? amendableLaws.find((l) => l.id === validLawId) : undefined;

      /* Phase 3: Rule-4 fiscal extraction — the ONLY point where LLM output
         can create fiscal state. Null (any parse/clamp failure, kind "none",
         cap bust) stores all-NULL fiscal columns: a guaranteed no-op. */
      const fiscal = parseFiscalField(decision.data, {
        treasury: govSettings11?.treasuryBalance ?? 0,
        expectedTickRevenue: expectedRevenue11,
        activeRecurringSpend: activeRecurringSpend11,
        rc: {
          fiscalMaxOneTimePctOfTreasury: rc.fiscalMaxOneTimePctOfTreasury,
          fiscalMaxProgramPctOfRevenue: rc.fiscalMaxProgramPctOfRevenue,
          fiscalRecurringCapPctOfRevenue: rc.fiscalRecurringCapPctOfRevenue,
          fiscalMaxTaxDeltaPerLaw: rc.fiscalMaxTaxDeltaPerLaw,
          maxSunsetTicks: rc.maxSunsetTicks,
          fiscalMaxMandatoryDeltaPct: rc.fiscalMaxMandatoryDeltaPct,
        },
        fallbackProgramName: title,
        amendedLaw: amendedLawTarget
          ? { kind: amendedLawTarget.fiscalKind as FiscalKind | null, currentAmount: amendedLawTarget.fiscalAmount }
          : undefined,
      });
      if (fiscal?.kind === 'spend_recurring' && typeof fiscal.amount === 'number') {
        /* Count this approval against the cap for later results in the same loop. */
        activeRecurringSpend11 += fiscal.amount;
      }

      /* Observability: the model asked for a real fiscal effect but
         validation/clamping dropped it (cap bust, bad amount, R=0, T<=0...).
         The bill still proposes fine — provision-free. Read-only probe of the
         untrusted payload; nothing from it is persisted beyond a label. */
      let fiscalRequestRejected: string | null = null;
      if (!fiscal && decision.data && typeof decision.data === 'object' && !Array.isArray(decision.data)) {
        const rawFiscal = (decision.data as Record<string, unknown>)['fiscal'];
        if (rawFiscal && typeof rawFiscal === 'object' && !Array.isArray(rawFiscal)) {
          const rawKind = (rawFiscal as Record<string, unknown>)['kind'];
          if (typeof rawKind === 'string') {
            const k = rawKind.toLowerCase().trim();
            if (k === 'spend_once' || k === 'spend_recurring' || k === 'tax_change') {
              fiscalRequestRejected = k;
            }
          }
        }
      }

      const [newBill] = await db
        .insert(bills)
        .values({
          title,
          summary,
          fullText,
          sponsorId: agent.id,
          coSponsorIds: '[]',
          committee,
          status: 'proposed',
          billType: validLawId ? 'amendment' : 'original',
          amendsLawId: validLawId ?? undefined,
          fiscalKind: fiscal?.kind,
          fiscalAmount: fiscal?.amount ?? undefined,
          fiscalTaxDelta: fiscal?.taxDelta ?? undefined,
          fiscalProgramName: fiscal?.programName ?? undefined,
          sunsetTicks: fiscal?.sunsetTicks ?? undefined,
        })
        .returning({ id: bills.id, title: bills.title });

      await db.insert(activityEvents).values({
        type: 'bill_proposed',
        agentId: agent.id,
        title: 'New bill proposed',
        description: `${agent.displayName} proposed "${title}" — ${summary}`,
        metadata: JSON.stringify({
          billId: newBill.id,
          committee,
          billType: validLawId ? 'amendment' : 'original',
          amendsLawId: validLawId,
          reasoning: decision.reasoning,
          fiscal: fiscal
            ? { kind: fiscal.kind, amount: fiscal.amount, taxDelta: fiscal.taxDelta, sunsetTicks: fiscal.sunsetTicks }
            : null,
        }),
      });

      if (fiscalRequestRejected) {
        console.warn(`[SIMULATION] Fiscal provision (${fiscalRequestRejected}) on "${title}" rejected by validation — bill proposed without it`);
        await db.insert(activityEvents).values({
          type: 'appropriation_rejected',
          agentId: agent.id,
          title: 'Fiscal provision rejected',
          description: `The ${fiscalRequestRejected.replace('_', ' ')} provision on "${title}" failed validation or busted a spending cap — the bill advances without fiscal effect`,
          metadata: JSON.stringify({ billId: newBill.id, requestedKind: fiscalRequestRejected }),
        });
      }

      broadcast('bill:proposed', {
        billId: newBill.id,
        title,
        summary,
        committee,
        billType: validLawId ? 'amendment' : 'original',
        sponsorId: agent.id,
        sponsorName: agent.displayName,
      });

      billCountThisTick.set(agent.id, (billCountThisTick.get(agent.id) ?? 0) + 1);
      console.warn(`[SIMULATION] ${agent.displayName} proposed bill: "${title}"`);
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 11 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 11.5: Public Statements                                         */
  /* Agents issue press statements in response to tick events.           */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 11.5: Public Statements');

    if (!rc.publicStatementsEnabled) {
      console.warn('[SIMULATION] Phase 11.5: Skipping — publicStatementsEnabled=false.');
    } else {
      type StatementTrigger = {
        agentId: string;
        triggerType: string;
        triggerBillId?: string;
        triggerElectionId?: string;
        triggerDealId?: string;
      };

      const triggers115: StatementTrigger[] = [];

      /* bill_passed — sponsors of bills that passed Phase 5 this tick */
      for (const bill of passedBillsThisTick) {
        if (bill.sponsorId) {
          triggers115.push({ agentId: bill.sponsorId, triggerType: 'bill_passed', triggerBillId: bill.id });
        }
      }

      /* bill_failed — sponsors of bills that failed and were NOT withdrawn */
      for (const bill of failedBillsThisTick) {
        if (bill.status !== 'withdrawn' && bill.sponsorId) {
          triggers115.push({ agentId: bill.sponsorId, triggerType: 'bill_failed', triggerBillId: bill.id });
        }
      }

      /* bill_vetoed — sponsor + president */
      const [presPos115] = await db.select({ agentId: positions.agentId })
        .from(positions)
        .where(and(eq(positions.type, 'president'), eq(positions.isActive, true)))
        .limit(1);
      const presidentAgent115 = presPos115?.agentId
        ? activeAgents.find((a) => a.id === presPos115.agentId) ?? null
        : null;

      for (const bill of vetoedByPresidentThisTick) {
        if (bill.sponsorId) {
          triggers115.push({ agentId: bill.sponsorId, triggerType: 'bill_vetoed', triggerBillId: bill.id });
        }
        if (presidentAgent115) {
          triggers115.push({ agentId: presidentAgent115.id, triggerType: 'bill_vetoed', triggerBillId: bill.id });
        }
      }

      /* election_won / election_lost — from Phase 14 */
      for (const result of electionResultsThisTick) {
        triggers115.push({ agentId: result.winnerId, triggerType: 'election_won', triggerElectionId: result.electionId });
        for (const loserId of result.loserIds) {
          triggers115.push({ agentId: loserId, triggerType: 'election_lost', triggerElectionId: result.electionId });
        }
      }

      /* deal_broken — from Phase 2c */
      for (const broken of brokenDealsThisTick) {
        triggers115.push({ agentId: broken.wrongedPartyId, triggerType: 'deal_broken', triggerDealId: broken.dealId });
      }

      /* proactive — random chance for any agent not already triggered */
      const triggeredAgentIds115 = new Set(triggers115.map((t) => t.agentId));
      for (const agent of activeAgents) {
        if (!triggeredAgentIds115.has(agent.id) && Math.random() < (rc.proactiveStatementChance ?? 0.05)) {
          triggers115.push({ agentId: agent.id, triggerType: 'proactive' });
        }
      }

      /* Priority dedup: one statement per agent, highest-priority trigger wins */
      const PRIORITY115 = ['deal_broken', 'bill_vetoed', 'bill_passed', 'bill_failed', 'election_won', 'election_lost', 'bill_proposed', 'proactive'];
      const finalTriggers115 = new Map<string, StatementTrigger>();
      for (const trigger of triggers115) {
        const existing = finalTriggers115.get(trigger.agentId);
        if (!existing || PRIORITY115.indexOf(trigger.triggerType) < PRIORITY115.indexOf(existing.triggerType)) {
          finalTriggers115.set(trigger.agentId, trigger);
        }
      }

      /* Per-agent cap (maxStatementsPerAgentPerTick is actually a total cap per spec — apply as slice) */
      const maxStatements = rc.maxStatementsPerAgentPerTick ?? 1;
      const cappedTriggers115 = [...finalTriggers115.values()].slice(0, maxStatements * activeAgents.length);

      if (cappedTriggers115.length === 0) {
        console.warn('[SIMULATION] Phase 11.5: No statement triggers this tick.');
      } else {
        /* Approval deltas by trigger type */
        const approvalDeltaByTrigger: Record<string, number> = {
          bill_passed: 2,
          bill_failed: 0,
          bill_vetoed: -1,
          election_won: 3,
          election_lost: 0,
          deal_broken: 1,
          proactive: 0,
          bill_proposed: 0,
        };

        /* Build trigger context lines for LLM */
        const buildTriggerLine = (trigger: StatementTrigger): string => {
          const bill = [...passedBillsThisTick, ...failedBillsThisTick, ...vetoedByPresidentThisTick]
            .find((b) => b.id === trigger.triggerBillId);
          const billTitle = bill?.title ?? 'a bill';
          switch (trigger.triggerType) {
            case 'bill_passed': return `Your bill "${billTitle}" just passed the Legislature`;
            case 'bill_failed': return `Your bill "${billTitle}" just failed the floor vote`;
            case 'bill_vetoed': return `Your bill "${billTitle}" was vetoed by the President`;
            case 'election_won': return `You just won a government election`;
            case 'election_lost': return `You just lost a government election`;
            case 'deal_broken': return `A political deal you made was broken by the other party`;
            default: return `You have thoughts on the current state of the legislature`;
          }
        };

        /* Fire all LLM calls in parallel */
        const stmtResults = await Promise.allSettled(
          cappedTriggers115.map((trigger) => {
            const agent = activeAgents.find((a) => a.id === trigger.agentId);
            if (!agent) return Promise.reject(new Error(`Agent not found: ${trigger.agentId}`));

            const triggerLine = buildTriggerLine(trigger);
            const contextMessage =
              `${triggerLine}. ` +
              `Issue a brief public press statement responding to this event. ` +
              `Be specific — reference actual names, bill titles, and what happened. ` +
              `Keep it to 2-3 sentences. Do not be generic. ` +
              `Respond with exactly this JSON: ` +
              `{"action":"public_statement","reasoning":"your statement text","data":{"triggerType":"${trigger.triggerType}"}}`;

            return generateAgentDecision(
              {
                id: agent.id,
                displayName: agent.displayName,
                alignment: agent.alignment,
                modelProvider: rc.providerOverride === 'default' ? agent.modelProvider : rc.providerOverride,
                personality: agent.personality,
                model: agent.model,
                ownerUserId: agent.ownerUserId,
              },
              contextMessage,
              'public_statement',
            ).then((decision) => ({ agent, trigger, decision }));
          }),
        );

        let stmtCount = 0;
        for (const result of stmtResults) {
          if (result.status === 'rejected') {
            console.warn('[SIMULATION] Phase 11.5: Statement LLM call rejected:', result.reason);
            continue;
          }
          const { agent, trigger, decision } = result.value;

          if (decision.action === 'idle') continue;
          if (decision.action !== 'public_statement') continue;

          const approvalDelta = approvalDeltaByTrigger[trigger.triggerType] ?? 0;

          await db.insert(agentStatements).values({
            agentId: agent.id,
            statementText: decision.reasoning,
            triggerType: trigger.triggerType,
            triggerBillId: trigger.triggerBillId ?? null,
            triggerElectionId: trigger.triggerElectionId ?? null,
            triggerDealId: trigger.triggerDealId ?? null,
            approvalDelta,
          });

          await db.insert(activityEvents).values({
            type: 'public_statement',
            agentId: agent.id,
            title: `${agent.displayName} issued a statement`,
            description: decision.reasoning,
            metadata: JSON.stringify({ triggerType: trigger.triggerType }),
          });

          if (approvalDelta !== 0) {
            await updateApproval(agent.id, approvalDelta, 'public_statement', `Statement on ${trigger.triggerType}`);
          }

          broadcast('agent:statement', {
            agentId: agent.id,
            agentName: agent.displayName,
            statementText: decision.reasoning,
            triggerType: trigger.triggerType,
            triggerBillId: trigger.triggerBillId,
          });

          console.warn(`[SIMULATION] ${agent.displayName} issued statement (${trigger.triggerType})`);
          stmtCount++;
        }

        console.warn(`[SIMULATION] Phase 11.5: ${stmtCount} public statements issued`);
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 11.5 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 12: Payroll                                                     */
  /* Bi-weekly paychecks (annual/26, net of income-tax withholding) to     */
  /* every active position holder, plus recurring program appropriations.  */
  /* Paychecks fire only on a payday tick (tickNumber % payPeriodTicks);    */
  /* recurring appropriations run every tick.                              */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 12: Payroll');

    const [govSettings] = await db.select().from(governmentSettings).limit(1);

    if (!govSettings) {
      console.warn('[SIMULATION] Phase 12: No government settings found — skipping payroll.');
    } else {
      let treasuryBalance = govSettings.treasuryBalance;
      const taxRatePct = govSettings.taxRatePercent;
      const isPayday = paydayDue(tickNumber, rc.payPeriodTicks);
      let withheldThisTick = 0;

      const annualSalaryMap: Record<string, number> = {
        president: rc.salaryPresident,
        cabinet_secretary: rc.salaryCabinet,
        congress_member: rc.salaryCongress,
        supreme_justice: rc.salaryJustice,
        lower_justice: rc.salaryJustice,
        committee_chair: rc.salaryCongress,
      };

      if (isPayday) {
        const allActivePositions = await db
          .select()
          .from(positions)
          .where(eq(positions.isActive, true));

        /* Running per-agent balance so each ledger row's balance_after is
           computed in memory (no re-select per row). Seeded from current DB. */
        const balanceByAgent = new Map<string, number>();
        for (const pos of allActivePositions) {
          if (!balanceByAgent.has(pos.agentId)) {
            const [a] = await db.select({ balance: agents.balance }).from(agents).where(eq(agents.id, pos.agentId));
            balanceByAgent.set(pos.agentId, a?.balance ?? 0);
          }
        }

        for (const pos of allActivePositions) {
          const annual = annualSalaryMap[pos.type] ?? 0;
          if (annual === 0) continue;
          const { gross, withheld, net } = computePaycheck(annual, taxRatePct);
          if (net <= 0) continue;
          /* Treasury pays the FULL gross: net lands in the agent's balance and
             the withheld portion is remitted back as revenue in Phase 13. The
             solvency gate is therefore on gross, not net. */
          if (treasuryBalance < gross) {
            console.warn(`[SIMULATION] Phase 12: Treasury too low to pay ${pos.type} paycheck`);
            await db.insert(activityEvents).values({
              type: 'treasury_crisis',
              agentId: pos.agentId,
              title: `Treasury too low to pay ${pos.type} paycheck`,
              description: `Treasury balance insufficient to cover $${gross} gross paycheck`,
              metadata: JSON.stringify({ positionType: pos.type, gross, net, treasuryBalance }),
            });
            continue;
          }

          await db
            .update(agents)
            .set({ balance: sql`${agents.balance} + ${net}` })
            .where(eq(agents.id, pos.agentId));

          const newBalance = (balanceByAgent.get(pos.agentId) ?? 0) + net;
          balanceByAgent.set(pos.agentId, newBalance);

          /* Treasury debits GROSS; Phase 13 re-credits withheld as revenue.
             Net treasury effect per paycheck is therefore −net (gross − withheld),
             spending reports gross, revenue reports the withholding. */
          treasuryBalance -= gross;
          tickSpendingThisTick += gross;
          withheldThisTick += withheld;

          /* Two ledger rows: gross salary in (balance_after reflects the net
             credit — the agent never holds the withheld portion) and the tax
             withholding out. */
          await db.insert(transactions).values({
            fromAgentId: undefined,
            toAgentId: pos.agentId,
            amount: gross,
            type: 'salary',
            description: `Salary (gross, ${pos.type})`,
            balanceAfter: newBalance,
          });
          await db.insert(transactions).values({
            fromAgentId: pos.agentId,
            toAgentId: undefined,
            amount: withheld,
            type: 'tax',
            description: 'Income tax withholding',
            balanceAfter: newBalance,
          });

          await db.insert(activityEvents).values({
            type: 'salary_payment',
            agentId: pos.agentId,
            title: 'Paycheck deposited',
            description: `$${net} net paycheck ($${gross} gross − $${withheld} withheld) for ${pos.type}`,
            metadata: JSON.stringify({ positionId: pos.id, positionType: pos.type, gross, withheld, net }),
          });
        }

        console.warn(`[SIMULATION] Phase 12: Payday — paid ${allActivePositions.length} position(s), $${withheldThisTick} withheld.`);
      } else {
        console.warn(`[SIMULATION] Phase 12: Not a payday (tick ${tickNumber}, period ${rc.payPeriodTicks}) — skipping paychecks.`);
      }

      /* Stash withholding for Phase 13 revenue accounting. */
      payrollWithheldThisTick = withheldThisTick;

      /* ---- Phase 3: recurring program appropriations ------------------ */
      /* Same in-memory treasuryBalance, same single final update — a second
         phase touching the treasury row in the same tick would race it.
         Unlike salaries (which skip when treasury < salary — deliberate
         asymmetry, kept), program debits DO drive the treasury negative
         (Engine 6 reacts) down to rc.treasuryHardFloor, below which debits
         suspend with a treasury_crisis event. Amounts are fixed integers
         set at validation time — never percentages, so no compounding. */
      if (rc.fiscalEffectsEnabled) {
        const activePrograms = await db
          .select()
          .from(laws)
          .where(and(eq(laws.isActive, true), eq(laws.programActive, true), eq(laws.fiscalKind, 'spend_recurring')));

        for (const program of activePrograms) {
          const perTick = program.fiscalAmount;
          if (typeof perTick !== 'number' || !Number.isFinite(perTick) || perTick <= 0) continue;

          if (treasuryBalance <= rc.treasuryHardFloor) {
            await db.insert(activityEvents).values({
              type: 'treasury_crisis',
              agentId: null,
              title: 'Program funding suspended',
              description: `Treasury at $${treasuryBalance} — below the hard floor; "${program.fiscalProgramName ?? program.title}" ($${perTick}/tick) goes unfunded this tick`,
              metadata: JSON.stringify({ lawId: program.id, perTick, treasuryBalance, treasuryHardFloor: rc.treasuryHardFloor }),
            });
            continue;
          }

          treasuryBalance -= perTick;
          tickSpendingThisTick += perTick;

          await db.insert(transactions).values({
            fromAgentId: undefined,
            toAgentId: undefined,
            amount: perTick,
            type: 'appropriation',
            description: `Recurring appropriation: ${program.fiscalProgramName ?? program.title}`,
            relatedLawId: program.id,
          });
        }

        if (activePrograms.length > 0) {
          console.warn(`[SIMULATION] Phase 12: ${activePrograms.length} recurring program(s) processed. Treasury: $${treasuryBalance}`);
        }
      }

      /* ---- Divergence E1 slice 1: mandatory programs + debt interest --
         Entirely gated on rc.debtEngineEnabled — flag off means this block
         never runs and behavior is byte-identical to pre-slice-1 Phase 12.
         Mandatory debits use the SAME in-memory treasuryBalance/
         tickSpendingThisTick as recurring programs above (one final write
         below), and are NOT subject to the treasuryHardFloor suspension
         recurring programs use — mandatory spending is unconditional by
         design (autopilot, no vote required), exactly like real entitlement
         outlays; a shortfall is absorbed by the debt engine at Phase 13
         settlement, not by suspending the program. */
      if (rc.debtEngineEnabled) {
        const mandatoryPrograms = await db
          .select()
          .from(laws)
          .where(and(eq(laws.isActive, true), eq(laws.fiscalKind, 'mandatory')));

        for (const program of mandatoryPrograms) {
          const base = program.fiscalAmount;
          if (typeof base !== 'number' || !Number.isFinite(base) || base <= 0) continue;
          if (typeof program.enactedTick !== 'number' || !Number.isFinite(program.enactedTick)) continue;

          const effective = mandatoryEffectiveAmount(base, program.enactedTick, tickNumber, rc.mandatoryGrowthPctAnnual);
          if (effective <= 0) continue;

          treasuryBalance -= effective;
          tickSpendingThisTick += effective;

          await db.insert(transactions).values({
            fromAgentId: undefined,
            toAgentId: undefined,
            amount: effective,
            type: 'mandatory_spend',
            description: `Mandatory spending: ${program.fiscalProgramName ?? program.title}`,
            relatedLawId: program.id,
          });
        }

        if (mandatoryPrograms.length > 0) {
          console.warn(`[SIMULATION] Phase 12: ${mandatoryPrograms.length} mandatory program(s) processed (debt engine on). Treasury: $${treasuryBalance}`);
        }

        /* Daily interest accrual on the outstanding debt stock — an
           automatic outflow, not tied to any law. Uses the debt figure as
           of the START of this tick (govSettings.debtOutstanding); the
           actual debtOutstanding column update happens at Phase 13
           settlement, after this tick's interest and mandatory spend are
           both already netted into treasuryBalance/tickSpendingThisTick. */
        const interest = tickInterest(govSettings.debtOutstanding, rc.debtInterestRatePct);
        if (interest > 0) {
          treasuryBalance -= interest;
          tickSpendingThisTick += interest;

          await db.insert(transactions).values({
            fromAgentId: undefined,
            toAgentId: undefined,
            amount: interest,
            type: 'debt_interest',
            description: `Interest on outstanding debt ($${govSettings.debtOutstanding} @ ${rc.debtInterestRatePct}%/yr)`,
          });

          console.warn(`[SIMULATION] Phase 12: Debt interest $${interest} accrued (debt $${govSettings.debtOutstanding}). Treasury: $${treasuryBalance}`);
        }
      }
      /* Phase 13 re-reads governmentSettings fresh and owns the
         read-modify-write of debtOutstanding (Rule 6: single read-merge-
         write, not two phases racing the same column) — this phase only
         ever touches treasuryBalance. */

      /* Update treasury balance */
      await db
        .update(governmentSettings)
        .set({ treasuryBalance, updatedAt: new Date() })
        .where(eq(governmentSettings.id, govSettings.id));

      console.warn(`[SIMULATION] Phase 12: Payroll complete. Treasury: $${treasuryBalance}`);
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 12 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 13: Citizen Revenue                                            */
  /* Accrue the daily citizen tax base to the treasury (GDP × rate / 365) */
  /* and record the tick's fiscal summary. No per-agent wealth tax — the   */
  /* only tax on agents is paycheck withholding (Phase 12).               */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 13: Citizen Revenue');

    const [govSettings] = await db.select().from(governmentSettings).limit(1);

    if (!govSettings) {
      console.warn('[SIMULATION] Phase 13: No government settings found — skipping revenue accrual.');
    } else {
      const citizenRevenue = elasticCitizenRevenue(rc.gdpAnnual, govSettings.taxRatePercent, { elasticityStrength: rc.taxElasticityStrength, neutralRatePercent: rc.taxNeutralRatePercent, peakRatePercent: rc.taxRevenuePeakPercent });
      const totalRevenue = citizenRevenue + payrollWithheldThisTick;
      let treasuryBalance = govSettings.treasuryBalance + totalRevenue;

      /* ---- Divergence E1 slice 1: end-of-tick debt/treasury settlement --
         Gated entirely on rc.debtEngineEnabled — flag off skips this block
         and treasuryBalance/debtOutstanding behave exactly as pre-slice-1
         (debtOutstanding column exists but is never read or written, stays
         0 forever, matching the migration's stated zero-behavior-change
         guarantee). When on: cash below 0 issues debt and floors treasury
         at 0 (treasuryHardFloor becomes dead config per spec — the debt
         engine floor supersedes it); cash above the operating buffer
         retires debt with the excess, capped at the current debt stock. */
      let debtOutstanding = govSettings.debtOutstanding;
      let debtDelta = 0;
      if (rc.debtEngineEnabled) {
        const settlement = settleTreasury(treasuryBalance, rc.treasuryOperatingBufferDollars, govSettings.debtOutstanding);
        treasuryBalance = settlement.treasury;
        debtDelta = settlement.debtDelta;
        debtOutstanding = govSettings.debtOutstanding + debtDelta;
      }

      /* Single read-merge-write of governmentSettings for this phase —
         treasuryBalance always, debtOutstanding only moves when the debt
         engine is on (debtDelta is 0 otherwise, a true no-op write). */
      await db
        .update(governmentSettings)
        .set({ treasuryBalance, debtOutstanding, updatedAt: new Date() })
        .where(eq(governmentSettings.id, govSettings.id));

      await db.insert(activityEvents).values({
        type: 'revenue_collected',
        agentId: null,
        title: 'Revenue collected',
        description: `$${totalRevenue} collected ($${citizenRevenue} citizen tax + $${payrollWithheldThisTick} payroll withholding)`,
        metadata: JSON.stringify({
          totalRevenue,
          citizenRevenue,
          payrollWithheld: payrollWithheldThisTick,
          taxRatePercent: govSettings.taxRatePercent,
          gdpAnnual: rc.gdpAnnual,
          newTreasuryBalance: treasuryBalance,
        }),
      });

      if (rc.debtEngineEnabled && debtDelta !== 0) {
        await db.insert(activityEvents).values({
          type: debtDelta > 0 ? 'debt_issued' : 'debt_retired',
          agentId: null,
          title: debtDelta > 0 ? 'Debt issued to cover shortfall' : 'Debt retired with treasury surplus',
          description: debtDelta > 0
            ? `Treasury shortfall covered by issuing $${debtDelta} in debt — outstanding debt now $${debtOutstanding}`
            : `Treasury surplus above the $${rc.treasuryOperatingBufferDollars} buffer retired $${-debtDelta} of debt — outstanding debt now $${debtOutstanding}`,
          metadata: JSON.stringify({ debtDelta, debtOutstanding, treasuryBalance, buffer: rc.treasuryOperatingBufferDollars }),
        });

        broadcast('treasury:debt_settled', { debtDelta, debtOutstanding, treasuryBalance });
      }

      /* Phase 3: one fiscal summary row per tick — powers the budget
         dashboard's treasury chart. Writes regardless of the kill switch
         (revenue and treasury are real either way). Inside Phase 13's try:
         a summary failure never kills the tick. Schema unchanged — debt
         movement is NOT added as a new summary column (spec constraint);
         it's fully recoverable from governmentSettings.debtOutstanding +
         the debt_issued/debt_retired activity events above. */
      await db.insert(fiscalTickSummaries).values({
        tickId: currentTick?.id ?? undefined,
        tickNumber,
        revenue: totalRevenue,
        spending: tickSpendingThisTick,
        treasuryEnd: treasuryBalance,
      });

      console.warn(`[SIMULATION] Phase 13: Revenue accrued $${totalRevenue}. Treasury: $${treasuryBalance}${rc.debtEngineEnabled ? ` (debt $${debtOutstanding})` : ''}`);
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 13 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 14: Election Lifecycle                                          */
  /* campaigning -> voting when votingStartDate <= now                    */
  /* voting -> certified when votingEndDate <= now (via finalizeElection) */
  /* Also: auto-fill congress/president vacancies if below configured     */
  /* seat counts.                                                         */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 14: Election Lifecycle'); broadcast('tick:phase', { phase: 'elections' });

    const now = new Date();

    /* campaigning -> voting */
    const electionsThatShouldBeginVoting = await db
      .select()
      .from(elections)
      .where(and(eq(elections.status, 'campaigning'), lte(elections.votingStartDate, now)));

    for (const election of electionsThatShouldBeginVoting) {
      await db
        .update(elections)
        .set({ status: 'voting' })
        .where(eq(elections.id, election.id));

      await db.insert(activityEvents).values({
        type: 'election_voting_started',
        agentId: null,
        title: 'Election voting started',
        description: `Voting has begun for the ${election.positionType} election`,
        metadata: JSON.stringify({ electionId: election.id, positionType: election.positionType }),
      });

      broadcast('election:voting_started', {
        electionId: election.id,
        positionType: election.positionType,
      });

      console.warn(`[SIMULATION] Election voting started: ${election.positionType}`);
    }

    /* ---- Vote casting window (E3 slice A) --------------------------- */
    /* Every tick an election sits in 'voting', eligible agents who have   */
    /* not yet cast a ballot in it make one LLM ballot decision each.      */
    /* Mirrors the Phase 2 bill-voting pattern: parallel LLM calls via     */
    /* Promise.allSettled, failure-isolated (a rejected/idle call = that   */
    /* agent abstains this tick, logged, never throws into the tick).     */
    /* Eligibility: active agents, excluding the candidates on that        */
    /* election's own ballot (no self/rival voting on your own race).     */
    const electionsCurrentlyVoting = await db
      .select()
      .from(elections)
      .where(eq(elections.status, 'voting'));

    for (const election of electionsCurrentlyVoting) {
      const candidates = await db
        .select({
          agentId: campaigns.agentId,
          platform: campaigns.platform,
          contributions: campaigns.contributions,
          displayName: agents.displayName,
          alignment: agents.alignment,
          approvalRating: agents.approvalRating,
        })
        .from(campaigns)
        .innerJoin(agents, eq(campaigns.agentId, agents.id))
        .where(and(eq(campaigns.electionId, election.id), eq(campaigns.status, 'active')));

      if (candidates.length === 0) continue; // no active candidates — nothing to vote on yet

      const candidateIds = new Set(candidates.map((c) => c.agentId));

      const existingBallots = await db
        .select({ voterId: votes.voterId })
        .from(votes)
        .where(eq(votes.electionId, election.id));
      const alreadyVoted = new Set(existingBallots.map((v) => v.voterId));

      const eligibleVoters = activeAgents.filter(
        (a) => !candidateIds.has(a.id) && !alreadyVoted.has(a.id),
      );
      if (eligibleVoters.length === 0) continue;

      /* Candidate party affiliation, batched */
      const partyMemberRows = candidateIds.size > 0
        ? await db
            .select({ agentId: partyMemberships.agentId, partyName: parties.name })
            .from(partyMemberships)
            .innerJoin(parties, eq(partyMemberships.partyId, parties.id))
            .where(inArray(partyMemberships.agentId, [...candidateIds]))
        : [];
      const candidatePartyMap = new Map(partyMemberRows.map((p) => [p.agentId, p.partyName]));

      /* Voter-candidate vote-alignment, batched (agent_relationships is
         directional agentId -> targetAgentId; the voter's row toward each
         candidate is the "relationship alignment" signal from the spec). */
      const voterIds = eligibleVoters.map((v) => v.id);
      const alignmentRows = await db
        .select({
          agentId: agentRelationships.agentId,
          targetAgentId: agentRelationships.targetAgentId,
          voteAlignment: agentRelationships.voteAlignment,
        })
        .from(agentRelationships)
        .where(
          and(
            inArray(agentRelationships.agentId, voterIds),
            inArray(agentRelationships.targetAgentId, [...candidateIds]),
          ),
        );
      const alignmentMap = new Map<string, number>();
      for (const r of alignmentRows) {
        alignmentMap.set(`${r.agentId}:${r.targetAgentId}`, r.voteAlignment);
      }

      /* Slice 3: per-candidate tenure fiscal record, computed once per election
         (identical for all voters), gated on ballotFiscalRecordEnabled. Tenure
         window comes from positions (timestamps) mapped onto fiscal_tick_summaries
         by createdAt; debt/tax have no per-tick history so the record shows the
         deficit + treasury trajectory only. Failure never breaks the election. */
      const fiscalRecordMap = new Map<string, string>();
      if (rc.ballotFiscalRecordEnabled) {
        try {
          const tenureRows = await db
            .select({ agentId: positions.agentId, startDate: positions.startDate, endDate: positions.endDate })
            .from(positions)
            .where(inArray(positions.agentId, [...candidateIds]));
          const tenureByAgent = new Map<string, { start: Date; end: Date }>();
          for (const t of tenureRows) {
            const start = t.startDate;
            const end = t.endDate ?? new Date();
            const existing = tenureByAgent.get(t.agentId);
            if (!existing) tenureByAgent.set(t.agentId, { start, end });
            else tenureByAgent.set(t.agentId, {
              start: start < existing.start ? start : existing.start,
              end: end > existing.end ? end : existing.end,
            });
          }
          for (const [agentId, window] of tenureByAgent) {
            const summaries = await db
              .select({ revenue: fiscalTickSummaries.revenue, spending: fiscalTickSummaries.spending, treasuryEnd: fiscalTickSummaries.treasuryEnd })
              .from(fiscalTickSummaries)
              .where(and(gte(fiscalTickSummaries.createdAt, window.start), lte(fiscalTickSummaries.createdAt, window.end)))
              .orderBy(asc(fiscalTickSummaries.createdAt));
            const rows: TenureFiscalRow[] = summaries.map((s) => ({ deficit: s.spending - s.revenue, treasuryEnd: s.treasuryEnd }));
            const record = buildTenureFiscalRecord(rows, compactDollars);
            if (record) fiscalRecordMap.set(agentId, record);
          }
        } catch (err) {
          console.warn('[SIMULATION] Phase 14 ballot: fiscal-record aggregation failed (ballots proceed without it):', err);
        }
      }

      const candidateBlock = candidates
        .map((c) => {
          const party = candidatePartyMap.get(c.agentId) ?? 'Independent';
          const base = `  - ${c.displayName} (id: ${c.agentId}, party: ${party}, approval: ${c.approvalRating ?? 50}%): ${c.platform}`;
          const record = fiscalRecordMap.get(c.agentId);
          return record ? `${base}\n    ${record}` : base;
        })
        .join('\n');

      const results = await Promise.allSettled(
        eligibleVoters.map((voter) => {
          const alignmentLines = candidates
            .map((c) => {
              const alignment = alignmentMap.get(`${voter.id}:${c.agentId}`);
              return alignment !== undefined
                ? `  Your alignment with ${c.displayName}: ${Math.round(alignment * 100)}%`
                : null;
            })
            .filter((l): l is string => l !== null)
            .join('\n');

          const contextMessage =
            `You are voting in the ${election.positionType} election. Candidates:\n${candidateBlock}` +
            (alignmentLines ? `\n\n${alignmentLines}` : '') +
            `\n\nRespond with exactly this JSON structure: ` +
            `{"action":"election_vote","reasoning":"one sentence","data":{"candidateId":"<the id of your chosen candidate>"}}`;

          return generateAgentDecision(
            {
              id: voter.id,
              displayName: voter.displayName,
              alignment: voter.alignment,
              modelProvider: rc.providerOverride === 'default' ? voter.modelProvider : rc.providerOverride,
              personality: voter.personality,
              model: voter.model,
              ownerUserId: voter.ownerUserId,
            },
            contextMessage,
            'election_voting',
          ).then((decision) => ({ voter, decision }));
        }),
      );

      let ballotsCastThisElection = 0;
      for (const result of results) {
        if (result.status === 'rejected') {
          console.warn('[SIMULATION] Phase 14 ballot: LLM call rejected (agent abstains):', result.reason);
          continue;
        }
        const { voter, decision } = result.value;

        if (decision.action === 'idle') continue; // API error fallback — agent abstains

        const isVote = decision.action === 'election_vote' || decision.action === 'vote';
        if (!isVote) continue;

        const rawCandidateId = String(decision.data?.['candidateId'] ?? '');
        if (!candidateIds.has(rawCandidateId)) {
          console.warn(`[SIMULATION] Phase 14 ballot: ${voter.displayName} named an unrecognized candidate — abstaining.`);
          continue;
        }
        const chosenCandidate = candidates.find((c) => c.agentId === rawCandidateId)!;

        /* DB-level one-ballot-per-voter-per-election guarantee (partial
           unique index votes_election_voter_unique). onConflictDoNothing +
           returning() closes the check-then-act race the in-memory
           alreadyVoted set leaves open under Bull tick retries: a losing
           race inserts nothing and returns [], so we skip the activity
           event / broadcast / counter for it. */
        const inserted = await db
          .insert(votes)
          .values({
            voterId: voter.id,
            electionId: election.id,
            candidateId: rawCandidateId,
            choice: chosenCandidate.displayName,
          })
          .onConflictDoNothing()
          .returning({ id: votes.id });

        if (inserted.length === 0) continue; // duplicate ballot — already recorded

        await db.insert(activityEvents).values({
          type: 'election_ballot_cast',
          agentId: voter.id,
          title: 'Ballot cast',
          description: `${voter.displayName} voted for ${chosenCandidate.displayName} in the ${election.positionType} election`,
          metadata: JSON.stringify({
            electionId: election.id,
            candidateId: rawCandidateId,
            reasoning: (decision.reasoning ?? '').slice(0, 500),
          }),
        });
        broadcast('election:ballot_cast', {
          electionId: election.id,
          voterId: voter.id,
          candidateId: rawCandidateId,
        });
        ballotsCastThisElection += 1;
      }
      if (ballotsCastThisElection > 0) {
        console.warn(`[SIMULATION] Phase 14 ballot: ${ballotsCastThisElection} ballot(s) cast in ${election.positionType} election ${election.id}`);
      }
    }

    /* voting -> certified (via shared finalizeElection helper) */
    const electionsToComplete = await db
      .select()
      .from(elections)
      .where(and(eq(elections.status, 'voting'), lte(elections.votingEndDate, now)));

    for (const election of electionsToComplete) {
      const result = await finalizeElection(election.id);
      if (result.status === 'ok' && result.winnerId) {
        /* Track for Phase 11.5 public statements (already-consumed this tick —
           see known ordering quirk; left intact for future tick v2 refactor) */
        electionResultsThisTick.push({
          electionId: election.id,
          winnerId: result.winnerId,
          loserIds: result.loserIds ?? [],
        });
      } else if (result.status === 'no_campaigns') {
        console.warn(`[SIMULATION] Election ${election.id} had no campaigns — skipping finalize.`);
      }
    }

    /* ---- Vacancy auto-fill ---------------------------------------- */
    /* Match the justice auto-fill pattern from Phase 10. Before this fix,
     * seats only got filled when an organic election completed — so a
     * fresh DB with 50 congressSeats and nothing campaigning sat at zero
     * sitting congress members indefinitely. */
    const allActivePositions = await db
      .select({ agentId: positions.agentId, type: positions.type })
      .from(positions)
      .where(eq(positions.isActive, true));

    const activeCongress = allActivePositions.filter((p) => p.type === 'congress_member');
    const activePresident = allActivePositions.find((p) => p.type === 'president');
    const heldAgentIds = new Set(allActivePositions.map((p) => p.agentId));

    /* Congress: direct auto-fill (mirrors justice pattern) */
    if (activeCongress.length < rc.congressSeats) {
      const vacancyCount = rc.congressSeats - activeCongress.length;
      console.warn(`[SIMULATION] Phase 14: ${vacancyCount} congress vacancies — filling...`);

      const eligible = activeAgents
        .filter((a) => !heldAgentIds.has(a.id))
        .sort((a, b) => b.reputation - a.reputation)
        .slice(0, vacancyCount);

      for (const agent of eligible) {
        const termEnd = new Date(now.getTime() + (rc.congressTermDays ?? 60) * 24 * 60 * 60 * 1000);
        await db.insert(positions).values({
          agentId: agent.id,
          type: 'congress_member',
          title: 'Member of the Legislature',
          startDate: now,
          endDate: termEnd,
          isActive: true,
        });

        await db.insert(activityEvents).values({
          type: 'appointment',
          agentId: agent.id,
          title: `${agent.displayName} seated in the Legislature`,
          description: `Appointed to fill a congress vacancy (reputation rank fill)`,
        });

        heldAgentIds.add(agent.id);
        console.warn(`[SIMULATION] Phase 14: Seated ${agent.displayName} as Congress Member`);
      }
    }

    /* President: if no sitting president and no election currently in flight,
     * auto-trigger a new election in 'registration' state. We do NOT appoint
     * by fiat — presidents come from elections, not appointments. */
    if (!activePresident) {
      const [inflightPresElection] = await db
        .select({ id: elections.id })
        .from(elections)
        .where(
          and(
            eq(elections.positionType, 'president'),
            inArray(elections.status, ['scheduled', 'registration', 'campaigning', 'voting']),
          ),
        )
        .limit(1);

      if (!inflightPresElection) {
        console.warn('[SIMULATION] Phase 14: No sitting president and no election in flight — triggering new election');
        const registrationDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const votingStartDate = new Date(now.getTime() + (rc.campaignDurationDays ?? 14) * 24 * 60 * 60 * 1000);
        const votingEndDate = new Date(votingStartDate.getTime() + (rc.votingDurationHours ?? 48) * 60 * 60 * 1000);

        const [newElection] = await db
          .insert(elections)
          .values({
            positionType: 'president',
            status: 'registration',
            scheduledDate: now,
            registrationDeadline,
            votingStartDate,
            votingEndDate,
          })
          .returning({ id: elections.id });

        await db.insert(activityEvents).values({
          type: 'election_triggered',
          agentId: null,
          title: 'Presidential election triggered',
          description: 'Office of the President vacant — a new presidential election has been called',
          metadata: JSON.stringify({ electionId: newElection?.id, positionType: 'president', reason: 'vacancy' }),
        });

        broadcast('election:triggered', {
          electionId: newElection?.id,
          positionType: 'president',
        });
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 14 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 14.5: Speaker of the Legislature (office-selection Slice 2)     */
  /* The Legislature elects its own presiding officer by internal          */
  /* roll-call vote of sitting members — one nominee per party bloc        */
  /* (most-senior seated member), winner is the majority of votes cast.    */
  /* Each member's ballot is derived from their own relationship-alignment */
  /* toward the nominees (the same unaltered signal Phase 1.7 uses — deals,*/
  /* lobbying and bloc dynamics all shape it; the engine only counts). No  */
  /* majority → the seat stays vacant this tick and the race re-runs next  */
  /* tick (a Legislature that cannot organize). Byte-identical no-op when   */
  /* speakerElectionEnabled is false (default).                            */
  /* ------------------------------------------------------------------ */
  if (rc.speakerElectionEnabled) {
    try {
      const [sittingSpeaker] = await db
        .select({ id: positions.id })
        .from(positions)
        .where(and(eq(positions.isActive, true), eq(positions.type, 'speaker')))
        .limit(1);

      if (!sittingSpeaker) {
        const seatedCongress = await db
          .select({ agentId: positions.agentId, startDate: positions.startDate })
          .from(positions)
          .where(and(eq(positions.isActive, true), eq(positions.type, 'congress_member')));

        const quorum = Math.ceil(rc.congressSeats * (rc.quorumPercentage ?? 0.5));
        if (seatedCongress.length >= quorum && seatedCongress.length > 0) {
          const alignmentByAgent = new Map(activeAgents.map((a) => [a.id, a.alignment]));
          const members: SeatedMember[] = seatedCongress.map((m) => ({
            agentId: m.agentId,
            alignment: alignmentByAgent.get(m.agentId) ?? null,
            startDate: m.startDate,
          }));
          const nominees = pickSpeakerNominees(members);

          if (nominees.length > 0) {
            /* Each seated member's vote-alignment toward every nominee. */
            const memberIds = seatedCongress.map((m) => m.agentId);
            const relRows = await db
              .select({
                agentId: agentRelationships.agentId,
                targetAgentId: agentRelationships.targetAgentId,
                voteAlignment: agentRelationships.voteAlignment,
              })
              .from(agentRelationships)
              .where(and(
                inArray(agentRelationships.agentId, memberIds),
                inArray(agentRelationships.targetAgentId, nominees),
              ));
            const alignByMember = new Map<string, Map<string, number>>();
            for (const r of relRows) {
              if (!alignByMember.has(r.agentId)) alignByMember.set(r.agentId, new Map());
              alignByMember.get(r.agentId)!.set(r.targetAgentId, r.voteAlignment);
            }

            /* Cast one round of ballots over the given nominee slate. Each
               member votes for the nominee they are most aligned with (a member
               who IS a nominee votes for themselves; ties / no relationship data
               fall to the first nominee in deterministic order). Purely reads
               relationship state — no engine rule dictates the vote. */
            const castRound = (slate: string[]): { candidateId: string }[] => {
              const slateSet = new Set(slate);
              const round: { candidateId: string }[] = [];
              for (const memberId of memberIds) {
                if (slateSet.has(memberId)) { round.push({ candidateId: memberId }); continue; }
                const aligns = alignByMember.get(memberId);
                let choice = slate[0]!;
                let best = -1;
                for (const nomineeId of slate) {
                  const a = aligns?.get(nomineeId) ?? -1;
                  if (a > best) { best = a; choice = nomineeId; }
                }
                round.push({ candidateId: choice });
              }
              return round;
            };

            /* Multi-ballot runoff (mirrors a real multiple-ballot Speaker race):
               no majority → the weakest nominee drops and members re-vote among
               the rest, up to speakerReballotCap rounds. Still deadlocked → the
               seat stays vacant and the race re-runs next tick (a Legislature
               that cannot organize — this really happened in 2023). */
            let slate = [...nominees];
            let result = tallyMajorityBallot(castRound(slate), slate);
            let round = 1;
            const cap = Math.max(1, rc.speakerReballotCap ?? 3);
            while (!result.hasMajority && slate.length > 2 && round < cap) {
              /* Drop the lowest-vote nominee (last in deterministic order breaks
                 ties, keeping the runoff deterministic). */
              let weakest = slate[slate.length - 1]!;
              let weakestVotes = Infinity;
              for (const id of slate) {
                const v = result.voteCounts[id] ?? 0;
                if (v <= weakestVotes) { weakestVotes = v; weakest = id; }
              }
              slate = slate.filter((id) => id !== weakest);
              result = tallyMajorityBallot(castRound(slate), slate);
              round += 1;
            }

            if (result.hasMajority && result.winnerId) {
              const winnerAgent = activeAgents.find((a) => a.id === result.winnerId);
              const winnerName = winnerAgent?.displayName ?? 'Unknown';
              await db.insert(positions).values({
                agentId: result.winnerId,
                type: 'speaker',
                title: 'Speaker of the Legislature',
                startDate: new Date(),
                /* No endDate — the Speaker serves until they lose their congress
                   seat (which cascades to the speaker seat via getSeatsToVacate
                   ranking) or a new term forces a re-vote. Deliberately NOT
                   added to the payday salary map: the Speaker draws their single
                   congress salary via their retained congress_member seat, so no
                   double pay. */
                isActive: true,
              });
              await db.insert(activityEvents).values({
                type: 'speaker_elected',
                agentId: result.winnerId,
                title: `${winnerName} elected Speaker of the Legislature`,
                description: `Elected Speaker by internal roll-call vote (${result.voteCounts[result.winnerId] ?? 0} of ${result.totalVotes} votes cast, ${nominees.length} nominee(s))`,
                metadata: JSON.stringify({ winnerId: result.winnerId, votesFor: result.voteCounts[result.winnerId] ?? 0, totalVotes: result.totalVotes, nominees }),
              });
              broadcast('government:speaker_elected', { agentId: result.winnerId, agentName: winnerName });
              console.warn(`[SIMULATION] Phase 14.5: ${winnerName} elected Speaker (${result.voteCounts[result.winnerId] ?? 0}/${result.totalVotes})`);
            } else {
              console.warn(`[SIMULATION] Phase 14.5: Speaker race deadlocked after ${round} ballot(s) — no majority (${slate.length} nominee(s) remaining); re-runs next tick.`);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[SIMULATION] Phase 14.5 (Speaker) error:', err);
    }
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 14.6: Cabinet secretaries (office-selection Slice 3)            */
  /* The 4 cabinet seats — never created before this slice — are filled by */
  /* president-nominate → Legislature-confirm, ONE vacant seat per tick to */
  /* bound LLM load. No president → no cabinet (faithful). Byte-identical  */
  /* no-op when appointmentConfirmationEnabled is false (default): the     */
  /* cabinet simply never exists, exactly as today.                       */
  /* ------------------------------------------------------------------ */
  if (rc.appointmentConfirmationEnabled) {
    try {
      const seatedCabinet = await db
        .select({ agentId: positions.agentId, title: positions.title })
        .from(positions)
        .where(and(eq(positions.isActive, true), eq(positions.type, 'cabinet_secretary')));

      const filledRoles = new Set(seatedCabinet.map((c) => c.title));
      const vacantRole = GOVERNMENT.EXECUTIVE.CABINET_POSITIONS.find((r) => !filledRoles.has(r));

      if (vacantRole) {
        const president146 = await getSittingPresident(rc.providerOverride);
        if (!president146) {
          console.warn('[SIMULATION] Phase 14.6: appointmentConfirmationEnabled but no sitting president — cabinet stays vacant (faithful).');
        } else {
          const heldAgentIds146 = new Set(
            (await db.select({ agentId: positions.agentId }).from(positions).where(eq(positions.isActive, true)))
              .map((p) => p.agentId),
          );
          const candidates146 = activeAgents
            .filter((a) => !heldAgentIds146.has(a.id))
            .sort((a, b) => b.reputation - a.reputation)
            .slice(0, 20)
            .map((a) => ({ id: a.id, displayName: a.displayName, alignment: a.alignment }));
          const seatedCongress146 = await db
            .select({ agentId: positions.agentId })
            .from(positions)
            .where(and(eq(positions.isActive, true), eq(positions.type, 'congress_member')));
          const result146 = await runAppointment({
            positionType: 'cabinet_secretary',
            title: vacantRole,
            officeLabel: vacantRole,
            president: president146,
            candidates: candidates146,
            confirmVoterIds: seatedCongress146.map((c) => c.agentId),
            confirmThreshold: rc.appointmentConfirmationThreshold ?? 0.5,
            seatDescriptor: `The role is ${vacantRole}.`,
          });
          console.warn(`[SIMULATION] Phase 14.6: cabinet (${vacantRole}) appointment cycle — ${result146.status}.`);
        }
      }
    } catch (err) {
      console.warn('[SIMULATION] Phase 14.6 (Cabinet) error:', err);
    }
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 15: Agent Campaigning                                           */
  /* Campaigning agents have a 20% chance per tick to make a speech.      */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 15: Agent Campaigning'); broadcast('tick:phase', { phase: 'campaign' });

    const activeCampaigningElections = await db
      .select()
      .from(elections)
      .where(eq(elections.status, 'campaigning'));

    if (activeCampaigningElections.length === 0) {
      console.warn('[SIMULATION] Phase 15: No campaigning elections — skipping.');
    } else {
      const campaigningElectionIds = activeCampaigningElections.map((e) => e.id);

      const activeCampaigns = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.status, 'active'), inArray(campaigns.electionId, campaigningElectionIds)));

      /* Filter eligible campaigns with desperation-gradient speech chance */
      const eligibleCampaigns: typeof activeCampaigns = [];
      for (const campaign of activeCampaigns) {
        const election = activeCampaigningElections.find((e) => e.id === campaign.electionId);
        if (!election) continue;
        const campaignAgent = activeAgents.find((a) => a.id === campaign.agentId);
        if (!campaignAgent) continue;

        /* Contribution deficit ratio: how far behind the leader */
        const allCampaignsForElection = activeCampaigns.filter((c) => c.electionId === campaign.electionId);
        const leaderContributions15 = Math.max(...allCampaignsForElection.map((c) => c.contributions ?? 0), 1);
        const ownContributions15 = campaign.contributions ?? 0;
        const deficitRatio = Math.max(0, (leaderContributions15 - ownContributions15) / leaderContributions15);

        /* Time urgency: 1.0 at start -> 2.0 at deadline */
        const votingStart = election.votingStartDate ? new Date(election.votingStartDate).getTime() : null;
        const campaignDurationMs = (rc.campaignDurationDays ?? 3) * 24 * 60 * 60 * 1000;
        const timeRemainingMs = votingStart ? Math.max(0, votingStart - Date.now()) : campaignDurationMs;
        const urgencyFactor = 1 + (1 - timeRemainingMs / campaignDurationMs);

        /* Approval modifier: popular agents campaign more effectively */
        const approvalModifier15 = (campaignAgent.approvalRating ?? 50) / 50;

        const dynamicSpeechChance = Math.min(
          0.90,
          rc.campaignSpeechChance * urgencyFactor * (1 + deficitRatio * 0.5) * approvalModifier15,
        );

        if (Math.random() >= dynamicSpeechChance) continue;
        eligibleCampaigns.push(campaign);
      }

      const results = await Promise.allSettled(
        eligibleCampaigns.map((campaign) => {
          const election = activeCampaigningElections.find((e) => e.id === campaign.electionId)!;
          const campaignAgent = activeAgents.find((a) => a.id === campaign.agentId)!;

          const contextMessage =
            `You are campaigning for ${election.positionType}. Make a brief campaign statement that reflects your values and platform. ` +
            `Respond with: {"action":"campaign_speech","reasoning":"your one-line speech","data":{"boost":50}}`;

          return generateAgentDecision(
            {
              id: campaignAgent.id,
              displayName: campaignAgent.displayName,
              alignment: campaignAgent.alignment,
              modelProvider: rc.providerOverride === 'default' ? campaignAgent.modelProvider : rc.providerOverride,
              personality: campaignAgent.personality,
              model: campaignAgent.model,
              ownerUserId: campaignAgent.ownerUserId,
            },
            contextMessage,
            'campaigning',
          ).then((decision) => ({ campaign, election, campaignAgent, decision }));
        }),
      );

      const speechCountThisTick = new Map<string, number>();

      for (const result of results) {
        if (result.status === 'rejected') {
          console.warn('[SIMULATION] Phase 15: Campaign speech rejected:', result.reason);
          continue;
        }
        const { campaign, election, campaignAgent, decision } = result.value;

        if (decision.action === 'idle') continue;
        if (decision.action !== 'campaign_speech') continue;

        /* Enforce max speeches per tick */
        if ((speechCountThisTick.get(campaign.agentId) ?? 0) >= rc.maxCampaignSpeechesPerTick) continue;

        const rawBoost = Number(decision.data?.['boost'] ?? 50);
        const clampedBoost = Math.max(10, Math.min(100, rawBoost));

        /* Scale boost by approval and endorsement count */
        const endorsementCount = (() => {
          try { return (JSON.parse(campaign.endorsements ?? '[]') as string[]).length; } catch { return 0; }
        })();
        const boost = Math.round(
          clampedBoost
          * ((campaignAgent.approvalRating ?? 50) / 50)
          * (1 + endorsementCount * 0.10),
        );

        await db.update(campaigns).set({ contributions: sql`${campaigns.contributions} + ${boost}` }).where(eq(campaigns.id, campaign.id));
        await db.insert(activityEvents).values({
          type: 'campaign_speech', agentId: campaignAgent.id, title: 'Campaign speech',
          description: decision.reasoning,
          metadata: JSON.stringify({ campaignId: campaign.id, electionId: election.id, positionType: election.positionType, boost }),
        });
        broadcast('campaign:speech', {
          campaignId: campaign.id, electionId: election.id, agentId: campaignAgent.id,
          agentName: campaignAgent.displayName, positionType: election.positionType, speech: decision.reasoning, boost,
        });
        speechCountThisTick.set(campaign.agentId, (speechCountThisTick.get(campaign.agentId) ?? 0) + 1);
        await updateApproval(campaignAgent.id, 1, 'campaign_speech', `${campaignAgent.displayName} gave a campaign speech`);
        console.warn(`[SIMULATION] ${campaignAgent.displayName} made campaign speech for ${election.positionType} (+${boost} contributions)`);
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 15 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 16: Forum Posts (via Forum Routing Engine)                     */
  /* The router scores all agents, picks post/reply/silent per agent.    */
  /* This phase handles posts; Phase 17 handles replies.                 */
  /* ------------------------------------------------------------------ */
  let forumRoutingMap: Map<string, RoutingDecision> | null = null;
  try {
    console.warn('[SIMULATION] Phase 16: Forum Posts'); broadcast('tick:phase', { phase: 'forum' });

    // Prune stale pending_mentions (older than 3 ticks)
    const pruneOlderThan = new Date(Date.now() - 3 * rc.tickIntervalMs);
    await db.delete(pendingMentions).where(lt(pendingMentions.createdAt, pruneOlderThan));

    // Run the forum routing engine for all active agents
    forumRoutingMap = await computeForumRouting(activeAgents, rc);

    // Filter for post decisions
    const postDecisions: Array<{ agent: (typeof activeAgents)[number]; category: string }> = [];
    for (const [agentId, decision] of forumRoutingMap) {
      if (decision.action !== 'post') continue;
      const agent = activeAgents.find(a => a.id === agentId);
      if (!agent) continue;
      postDecisions.push({ agent, category: decision.category });
    }

    // Cap at maxForumPostsPerTick
    const maxPosts = rc.maxForumPostsPerTick ?? 3;
    const cappedPosts = postDecisions.slice(0, maxPosts);

    if (cappedPosts.length === 0) {
      console.warn('[SIMULATION] Phase 16: No agents routed to post — skipping.');
    } else {
      // Load simulation state once for all forum candidates this tick
      const simState = await buildSimulationStateBlock().catch((err) => { console.warn('[TICK] Simulation state build failed:', err instanceof Error ? err.message : err); return { block: '', threadTitles: [] as string[] }; });
      const recentTopicsNote = simState.threadTitles.length > 0
        ? `\n\nTopics already discussed recently — do NOT repeat these angles:\n${simState.threadTitles.slice(0, 10).map((t) => `  - "${t}"`).join('\n')}`
        : '';
      const simStateNote = simState.block
        ? `\n\nCurrent simulation events to react to:\n${simState.block}`
        : '';

      // Fire all LLM calls in parallel via generateForumPost
      const results = await Promise.allSettled(
        cappedPosts.map(({ agent, category }) => {
          const postAgent = {
            ...agent,
            modelProvider: rc.providerOverride === 'default' ? agent.modelProvider : rc.providerOverride,
          };
          return generateForumPost(postAgent, category, simStateNote, recentTopicsNote)
            .then((decision) => ({ agent, decision, category }));
        }),
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          console.warn('[SIMULATION] Phase 16: Forum post rejected:', result.reason);
          continue;
        }
        const { agent, decision, category } = result.value;

        try {
          if (decision.action === 'idle') continue;
          if (decision.action !== 'forum_post') continue;

          const title = (decision.data?.['title'] as string | undefined) ?? `${agent.displayName}'s thoughts on ${category}`;
          const body = decision.reasoning;
          if (!body || body.length < 10) continue;

          /* Deduplication */
          const sevenDaysAgo16 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const existingTitles = await db.select({ title: forumThreads.title }).from(forumThreads).where(gt(forumThreads.createdAt, sevenDaysAgo16));
          const sigWords = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
          const newWords = sigWords(title);
          const isDupe = existingTitles.some(({ title: t }) => {
            const overlap = [...sigWords(t)].filter((w) => newWords.has(w)).length;
            return overlap >= 3;
          });
          if (isDupe) {
            console.warn(`[SIMULATION] ${agent.displayName} skipped duplicate forum topic: "${title.slice(0, 60)}"`);
            continue;
          }

          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          const [thread] = await db.insert(forumThreads).values({
            title: title.slice(0, 299), category, authorId: agent.id, replyCount: 0, lastActivityAt: new Date(), expiresAt,
          }).returning();

          await db.insert(agentMessages).values({ type: 'forum_post', fromAgentId: agent.id, body, threadId: thread.id, isPublic: true });
          broadcast('forum:post', { threadId: thread.id, agentId: agent.id, agentName: agent.displayName, category, title: thread.title });
          console.warn(`[SIMULATION] ${agent.displayName} posted to ${category} forum: "${title.slice(0, 60)}"`);
        } catch (agentErr) {
          console.warn(`[SIMULATION] Phase 16: Error for agent ${agent.displayName}:`, agentErr);
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 16 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 17: Forum Replies (via Forum Routing Engine)                  */
  /* Uses routing decisions from Phase 16 or recomputes if needed.       */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 17: Forum Replies');

    // Recompute routing if Phase 16 failed
    if (!forumRoutingMap) {
      forumRoutingMap = await computeForumRouting(activeAgents, rc);
    }

    // Filter for reply decisions
    const replyDecisions: Array<{
      agent: (typeof activeAgents)[number];
      threadId: string;
      replyContext: NonNullable<Extract<RoutingDecision, { action: 'reply' }>['replyContext']>;
    }> = [];

    for (const [agentId, decision] of forumRoutingMap) {
      if (decision.action !== 'reply') continue;
      const agent = activeAgents.find(a => a.id === agentId);
      if (!agent) continue;
      replyDecisions.push({ agent, threadId: decision.threadId, replyContext: decision.replyContext });
    }

    // Cap at maxForumRepliesPerTick
    const maxReplies = rc.maxForumRepliesPerTick ?? 5;
    const cappedReplies = replyDecisions.slice(0, maxReplies);

    if (cappedReplies.length === 0) {
      console.warn('[SIMULATION] Phase 17: No agents routed to reply — skipping.');
    } else {
      const allAgentNames = activeAgents.map(a => a.displayName);

      /* Fire all LLM calls in parallel via generateForumReply */
      const replyResults = await Promise.allSettled(
        cappedReplies.map(({ agent, threadId, replyContext }) => {
          const replyAgent = {
            ...agent,
            modelProvider: rc.providerOverride === 'default' ? agent.modelProvider : rc.providerOverride,
          };
          return generateForumReply(replyAgent, replyContext, allAgentNames)
            .then((decision) => ({ agent, threadId, decision }));
        }),
      );

      /* Process results */
      for (const result of replyResults) {
        if (result.status === 'rejected') {
          console.warn('[SIMULATION] Phase 17: Forum reply rejected:', result.reason);
          continue;
        }
        const { agent, threadId, decision } = result.value;

        try {
          if (decision.action === 'idle') continue;
          if (decision.action !== 'forum_reply') continue;

          const body = decision.reasoning;
          if (!body || body.length < 10) continue;

          const mentionedNames = (decision.data?.['mentions'] as string[] | undefined) ?? [];

          /* parentId = most recent post in thread, not always the OP */
          const [mostRecentPost] = await db.select({ id: agentMessages.id }).from(agentMessages)
            .where(eq(agentMessages.threadId, threadId)).orderBy(desc(agentMessages.createdAt)).limit(1);

          await db.insert(agentMessages).values({ type: 'forum_reply', fromAgentId: agent.id, body, threadId, parentId: mostRecentPost?.id ?? null, isPublic: true });
          await db.update(forumThreads).set({ replyCount: sql`${forumThreads.replyCount} + 1`, lastActivityAt: new Date() }).where(eq(forumThreads.id, threadId));

          /* Relationship: increment forumInteractions + sentiment bonus between replier and thread author */
          const thread = await db.select({ authorId: forumThreads.authorId }).from(forumThreads).where(eq(forumThreads.id, threadId)).limit(1);
          const threadAuthorId = thread[0]?.authorId;
          if (threadAuthorId && threadAuthorId !== agent.id) {
            const sentimentBonus = rc.forumInteractionSentimentBonus ?? 0.02;
            await db.insert(agentRelationships)
              .values({ agentId: agent.id, targetAgentId: threadAuthorId, voteAlignment: 0.5, sentiment: 0.5, forumInteractions: 0 })
              .onConflictDoUpdate({
                target: [agentRelationships.agentId, agentRelationships.targetAgentId],
                set: {
                  forumInteractions: sql`agent_relationships.forum_interactions + 1`,
                  sentiment: sql`LEAST(1.0, agent_relationships.sentiment + ${sentimentBonus})`,
                  updatedAt: new Date(),
                },
              });
          }

          for (const name of mentionedNames) {
            const mentioned = activeAgents.find((a) => a.displayName.toLowerCase() === name.toLowerCase());
            if (!mentioned || mentioned.id === agent.id) continue;
            await db.insert(pendingMentions).values({ mentionedAgentId: mentioned.id, threadId, mentionerName: agent.displayName });
          }

          await db.delete(pendingMentions).where(and(eq(pendingMentions.mentionedAgentId, agent.id), eq(pendingMentions.threadId, threadId)));
          broadcast('forum:reply', { threadId, agentId: agent.id, agentName: agent.displayName, mentionedNames });
          console.warn(
            `[SIMULATION] ${agent.displayName} replied in thread ${threadId.slice(0, 8)}` +
            (mentionedNames.length ? ` mentioning ${mentionedNames.join(', ')}` : ''),
          );
        } catch (agentErr) {
          console.warn(`[SIMULATION] Phase 17: Error for agent ${agent.displayName}:`, agentErr);
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 17 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* Reality reference pool — periodic pull, divergence experiment       */
  /* (docs/DIVERGENCE_EXPERIMENT.md §2.3). Runs regardless of            */
  /* rc.debtEngineEnabled: reality data collection is independent of the */
  /* sim's own debt mechanics, and the pool needs depth before T0 seeds. */
  /* Failure-isolated -- backfillHistory()/pullRealitySnapshots() never  */
  /* throw (both wrap + log internally), but this block is still        */
  /* try/caught so a future change to either can never take down a tick.*/
  /* ------------------------------------------------------------------ */
  if (tickNumber % REALITY_PULL_EVERY_N_TICKS === 0) {
    try {
      const backfilled = await backfillHistory();
      const { inserted, errors } = await pullRealitySnapshots();
      console.warn(
        `[SIMULATION] Reality pool: backfilled ${backfilled}, pulled ${inserted} snapshot(s)` +
        (errors.length > 0 ? ` (${errors.length} source error(s): ${errors.join('; ')})` : ''),
      );
    } catch (err) {
      console.warn('[SIMULATION] Reality pool error:', err);
    }
  }

  /* ------------------------------------------------------------------ */
  /* World events feed — exogenous reality feed, E2 slice 1              */
  /* (docs/specs/exogenous-reality-feed.md). READ-ONLY: writes to        */
  /* world_events only, nothing here is consumed by prompt-building or   */
  /* any other tick phase. Dark by default (rc.worldFeedEnabled=false).  */
  /* Failure-isolated -- pollWorldEvents() never throws (wraps + logs    */
  /* per source internally), but this block is still try/caught so a    */
  /* future change there can never take down a tick.                    */
  /* ------------------------------------------------------------------ */
  if (rc.worldFeedEnabled && tickNumber % rc.worldFeedPollTicks === 0) {
    try {
      const { inserted, errors } = await pollWorldEvents();
      const swept = await sweepWorldEvents();
      console.warn(
        `[SIMULATION] World events: pulled ${inserted} event(s), swept ${swept} aged row(s)` +
        (errors.length > 0 ? ` (${errors.length} source error(s): ${errors.join('; ')})` : ''),
      );
    } catch (err) {
      console.warn('[SIMULATION] World events poll error:', err);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Inactivity decay — gentle pull toward rc.approvalDecayTarget        */
  /* ------------------------------------------------------------------ */
  try {
    const allAgentsForDecay = await db
      .select({ id: agents.id, approvalRating: agents.approvalRating })
      .from(agents)
      .where(eq(agents.isActive, true));
    const decayTarget = rc.approvalDecayTarget ?? 40;
    for (const a of allAgentsForDecay) {
      if (a.approvalRating === decayTarget) continue;
      const decayDelta = Math.round((decayTarget - a.approvalRating) * 0.20);
      if (decayDelta === 0) continue;
      await updateApproval(a.id, decayDelta, 'inactivity_decay', 'Natural approval drift toward baseline');
    }
  } catch (err) {
    console.warn('[APPROVAL] Inactivity decay error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* Fiscal Consequence — settled fiscal state -> officeholder approval  */
  /* (Fiscal Consequence Loop §3.1). Runs AFTER all procedural approval  */
  /* moves + decay so it reads settled fiscal state. Gated on            */
  /* rc.fiscalConsequenceEnabled; off = no reads, no writes (dark-safe). */
  /* Failure-isolated: a fault here never fails the tick.                */
  /* ------------------------------------------------------------------ */
  if (rc.fiscalConsequenceEnabled) {
    try {
      const [gsFisc] = await db.select().from(governmentSettings).limit(1);
      /* This tick's fiscal-summary row (written in Phase 13): non-divergent
         revenue/spending source. createdAt DESC — id is a random uuid. */
      const [summaryFisc] = await db
        .select({ revenue: fiscalTickSummaries.revenue, spending: fiscalTickSummaries.spending })
        .from(fiscalTickSummaries)
        .where(eq(fiscalTickSummaries.tickNumber, tickNumber))
        .orderBy(desc(fiscalTickSummaries.createdAt))
        .limit(1);

      if (gsFisc && summaryFisc) {
        const state: FiscalConsequenceState = {
          treasuryBalance: gsFisc.treasuryBalance,
          debtOutstanding: gsFisc.debtOutstanding,
          gdpAnnual: rc.gdpAnnual,
          taxRatePercent: gsFisc.taxRatePercent,
          deficitPerTick: summaryFisc.spending - summaryFisc.revenue,
          treasuryBufferDollars: rc.treasuryOperatingBufferDollars,
        };
        const cfg: FiscalApprovalConfig = {
          debtWeight: rc.fiscalApprovalDebtWeight,
          treasuryWeight: rc.fiscalApprovalTreasuryWeight,
          deficitWeight: rc.fiscalApprovalDeficitWeight,
          taxWeight: rc.fiscalApprovalTaxWeight,
          partyWeight: rc.fiscalConsequencePartyWeight,
          maxDeltaPerTick: rc.fiscalApprovalMaxDeltaPerTick,
          debtHealthBand: rc.fiscalApprovalDebtHealthBand,
          debtCrisisBand: rc.fiscalApprovalDebtCrisisBand,
          taxNeutralRatePercent: rc.taxNeutralRatePercent,
          deficitCrisisRatio: rc.fiscalApprovalDeficitCrisisRatio,
        };

        const officeholderRows = await db
          .select({ agentId: positions.agentId })
          .from(positions)
          .where(and(eq(positions.isActive, true), inArray(positions.type, ['president', 'committee_chair', 'leader'] as string[])));
        const alignByAgent = new Map(activeAgents.map((a) => [a.id, a.alignment]));
        const officeholders = [...new Set(officeholderRows.map((r) => r.agentId))]
          .map((agentId) => ({ agentId, alignment: alignByAgent.get(agentId) ?? null }));

        const moves = computeFiscalApprovalMoves(true, state, cfg, officeholders);
        for (const m of moves) {
          await updateApproval(m.agentId, m.delta, 'fiscal_consequence', 'Approval response to fiscal state');
        }
        console.warn(`[SIMULATION] Fiscal consequence: applied ${moves.length} officeholder approval move(s)`);
      }
    } catch (err) {
      console.warn('[APPROVAL] Fiscal consequence error:', err);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Memory Summarization — compress old decisions periodically          */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Memory summarization: checking agents');
    await Promise.allSettled(
      activeAgents.map((agent) => summarizeAgentDecisions(agent.id)),
    );
  } catch (err) {
    console.warn('[SIMULATION] Memory summarization error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* Coalition Snapshot — persist detected blocs for this tick           */
  /* ------------------------------------------------------------------ */
  try {
    const allRels = await db.select({
      agentId: agentRelationships.agentId,
      targetAgentId: agentRelationships.targetAgentId,
      voteAlignment: agentRelationships.voteAlignment,
    }).from(agentRelationships)
      .where(gte(agentRelationships.voteAlignment, 0.70));

    /* Build adjacency list from high-alignment pairs */
    const adjacency = new Map<string, Set<string>>();
    for (const rel of allRels) {
      if (!adjacency.has(rel.agentId)) adjacency.set(rel.agentId, new Set());
      adjacency.get(rel.agentId)!.add(rel.targetAgentId);
    }

    /* BFS greedy clustering */
    const visited = new Set<string>();
    const blocs: Array<{ name: string; members: string[] }> = [];

    for (const [agentId] of adjacency) {
      if (visited.has(agentId)) continue;
      const bloc = new Set<string>();
      const queue = [agentId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        bloc.add(current);
        for (const neighbor of adjacency.get(current) ?? []) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      if (bloc.size >= 2) {
        const members = [...bloc];
        const names = members.map(id => activeAgents.find(a => a.id === id)?.displayName ?? id);
        blocs.push({ name: `Bloc ${blocs.length + 1}`, members: names });
      }
    }

    if (blocs.length > 0) {
      await db.insert(coalitionSnapshots).values({ blocs });
    }
  } catch (err) {
    console.warn('[SIMULATION] Coalition snapshot failed:', err);
  }

  /* ------------------------------------------------------------------ */
  /* Daily Gazette — ONE LLM recap of the tick's notable events           */
  /* Failure-soft by construction: the digest is deterministic (never     */
  /* raw model output), the LLM call returns null instead of throwing,    */
  /* and the whole block is try/caught — a failed Gazette never fails     */
  /* the tick.                                                            */
  /* ------------------------------------------------------------------ */
  if (rc.gazetteEnabled) {
    try {
      const gazetteEvents = await db
        .select({
          type: activityEvents.type,
          title: activityEvents.title,
          description: activityEvents.description,
        })
        .from(activityEvents)
        .where(and(
          inArray(activityEvents.type, [
            'committee_review', 'law_struck_down', 'media_event', 'appointment', 'tax_collected', 'revenue_collected', 'floor_amendment',
            /* Phase 3 fiscal events — pickup is this hard whitelist, NOT automatic:
               without these entries fiscal news never reaches the Gazette. */
            'law_sunset', 'budget_session', 'program_lapsed', 'tax_rate_changed', 'appropriation_onetime',
            /* Phase 4 judicial arc — same hard-whitelist rule: without this
               entry, upheld rulings never reach the Gazette
               (law_struck_down is already listed above). */
            'law_upheld',
          ]),
          gte(activityEvents.createdAt, tickFiredAt),
        ))
        .orderBy(asc(activityEvents.createdAt))
        .limit(40);

      const agentNameById = new Map(activeAgents.map((a) => [a.id, a.displayName]));
      const digest = buildGazetteDigest({
        passedBills: passedBillsThisTick.map((b) => ({ title: b.title })),
        failedBills: failedBillsThisTick.map((b) => ({ title: b.title })),
        vetoedBills: vetoedByPresidentThisTick.map((b) => ({ title: b.title })),
        electionWinners: electionResultsThisTick.map((r) => agentNameById.get(r.winnerId) ?? 'a challenger'),
        brokenDeals: brokenDealsThisTick.map((d) => ({ wrongedPartyName: d.wrongedPartyName })),
        events: gazetteEvents,
      });

      if (!digest) {
        console.warn('[SIMULATION] Gazette: nothing notable this tick — skipping issue');
      } else {
        const article = await generateGazetteArticle(digest);
        if (!article) {
          console.warn('[SIMULATION] Gazette: article generation failed or invalid — skipping issue');
        } else {
          const [issue] = await db.insert(gazetteIssues).values({
            tickId: currentTick?.id ?? null,
            headline: article.headline,
            body: article.body,
            digest,
          }).returning({ id: gazetteIssues.id, createdAt: gazetteIssues.createdAt });

          broadcast('press:gazette', {
            id: issue?.id,
            headline: article.headline,
            createdAt: issue?.createdAt,
          });
          console.warn(`[SIMULATION] Gazette published: "${article.headline}"`);
        }
      }
    } catch (err) {
      console.warn('[SIMULATION] Gazette error (non-fatal):', err);
    }
  }

  if (currentTick?.id) {
    await db.update(tickLog).set({ completedAt: new Date() }).where(eq(tickLog.id, currentTick.id));
  }

  broadcast('tick:complete', { timestamp: Date.now() });
  console.warn('[SIMULATION] Agent tick complete.');
});

export function startAgentTick(): void {
  const rc = getRuntimeConfig();
  agentTickQueue
    .add({}, {
      repeat: { every: rc.tickIntervalMs },
      removeOnComplete: 10,
      removeOnFail: 5,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    })
    .catch((err: unknown) => console.error('[SIMULATION] Failed to add tick job:', err));
  console.warn(`[SIMULATION] Agent tick started — interval: ${rc.tickIntervalMs}ms`);
}

export async function changeTickInterval(newIntervalMs: number): Promise<void> {
  const jobs = await agentTickQueue.getRepeatableJobs();
  for (const job of jobs) {
    await agentTickQueue.removeRepeatableByKey(job.key);
  }
  await agentTickQueue.add({}, {
    repeat: { every: newIntervalMs },
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
  console.warn(`[SIMULATION] Tick interval changed to ${newIntervalMs}ms`);
}

export async function pauseSimulation(): Promise<void> {
  await agentTickQueue.pause();
  console.warn('[SIMULATION] Paused by admin');
}

export async function resumeSimulation(): Promise<void> {
  await agentTickQueue.resume();
  console.warn('[SIMULATION] Resumed by admin');
}

export async function triggerManualTick(): Promise<void> {
  await agentTickQueue.add({}, { removeOnComplete: true, removeOnFail: true });
  console.warn('[SIMULATION] Manual tick triggered by admin');
}

export async function getSimulationStatus(): Promise<{
  isPaused: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const isPaused = await agentTickQueue.isPaused();
  const counts = await agentTickQueue.getJobCounts();

  // Use tick_log for the real all-time completed count (Bull's completed count is capped by removeOnComplete)
  const [tickCounts] = await db
    .select({
      completed: sql<number>`COUNT(*) FILTER (WHERE ${tickLog.completedAt} IS NOT NULL)`,
    })
    .from(tickLog);

  return {
    isPaused,
    waiting: counts.waiting,
    active: counts.active,
    completed: Number(tickCounts?.completed ?? 0),
    failed: counts.failed,
  };
}

export async function retryFailedJobs(): Promise<number> {
  const failedJobs = await agentTickQueue.getFailed();
  await Promise.all(failedJobs.map((job) => job.retry()));
  console.warn(`[SIMULATION] Retried ${failedJobs.length} failed jobs`);
  return failedJobs.length;
}
