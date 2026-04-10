import Bull from 'bull';
import { eq, and, inArray, lte, gte, gt, lt, desc, count, sql } from 'drizzle-orm';
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
  positions,
  parties,
  partyMemberships,
  judicialReviews,
  judicialVotes,
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
} from '@db/schema/index';
import { generateAgentDecision, buildSimulationStateBlock, summarizeAgentDecisions, generateForumPost, generateForumReply } from '../services/ai.js';
import { computeForumRouting, type RoutingDecision } from '../services/forumRouter.js';
import { broadcast } from '../websocket.js';
import { ALIGNMENT_ORDER } from '@shared/constants';
import { alignmentDistance } from '../services/simulationCore.js';
import { finalizeElection } from '@modules/elections/server/finalizeElection.js';

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

  const [currentTick] = await db.insert(tickLog).values({ firedAt: new Date() }).returning({ id: tickLog.id });

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

  /* ------------------------------------------------------------------ */
  /* PHASE 1: Party Whip Signal                                            */
  /* Party leaders signal their recommended vote on floor bills.          */
  /* ------------------------------------------------------------------ */
  /* whipSignals: Map<billId, Map<partyId, 'yea'|'nay'>> */
  const whipSignals = new Map<string, Map<string, string>>();

  try {
    console.warn('[SIMULATION] Phase 1: Party Whip Signal'); broadcast('tick:phase', { phase: 'voting' });

    const floorBills = await db.select().from(bills).where(eq(bills.status, 'floor'));

    if (floorBills.length === 0) {
      console.warn('[SIMULATION] Phase 1: No floor bills — skipping whip signals.');
    } else {
      /* Get all active party memberships with role='leader' */
      const leaderMemberships = await db
        .select()
        .from(partyMemberships)
        .where(eq(partyMemberships.role, 'leader'));

      const activeParties = await db.select().from(parties).where(eq(parties.isActive, true));

      for (const bill of floorBills) {
        const billSignals = new Map<string, string>();

        for (const membership of leaderMemberships) {
          const leader = activeAgents.find((a) => a.id === membership.agentId);
          if (!leader) continue;

          const party = activeParties.find((p) => p.id === membership.partyId);
          if (!party) continue;

          const contextMessage =
            `As leader of ${party.name}, signal your party's recommended vote on "${bill.title}". ` +
            `Summary: ${bill.summary}. Committee: ${bill.committee}. ` +
            `Your party alignment: ${party.alignment}. ` +
            `Respond with exactly this JSON: {"action":"whip_signal","reasoning":"one sentence","data":{"signal":"yea"}} ` +
            `Use "yea" or "nay" only.`;

          const decision = await generateAgentDecision(
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
          );

          if (decision.action === 'whip_signal' && decision.data) {
            const signal = String(decision.data['signal'] ?? 'yea').toLowerCase();
            const validSignal = signal === 'nay' ? 'nay' : 'yea';
            billSignals.set(party.id, validSignal);

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

        whipSignals.set(bill.id, billSignals);
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

    const lobbyFloorBills = await db.select().from(bills).where(eq(bills.status, 'floor'));

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
          `{"action":"lobby","reasoning":"your persuasive argument","data":{"desiredVote":"${desiredVote}","targetId":"${targetAgent.id}"}}`;

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

    const amendFloorBills = await db.select().from(bills).where(eq(bills.status, 'floor'));

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

      for (const bill of amendFloorBills) {
        let amendmentsThisBill = 0;

        /* Eligible proposers: active agents who are NOT the sponsor */
        const eligible = activeAgents.filter((a) => a.id !== bill.sponsorId);

        /* Shuffle to randomize order */
        const shuffled17 = eligible.sort(() => Math.random() - 0.5);

        for (const proposer of shuffled17) {
          if (amendmentsThisBill >= maxAmendmentsPerBill) break;

          /* Per-agent chance; committee chairs for this bill's committee get +0.15 */
          const isChairForCommittee = chairPositions17.some(
            (p) => p.agentId === proposer.id && p.title.toLowerCase().includes(bill.committee.toLowerCase()),
          );
          const effectiveChance = amendmentChance + (isChairForCommittee ? 0.15 : 0);
          if (Math.random() >= effectiveChance) continue;

          const contextMessage =
            `Bill "${bill.title}" is on the floor for a vote. ` +
            `Full text: ${bill.fullText.slice(0, 800)}. ` +
            `Summary: ${bill.summary}. ` +
            `You may propose a floor amendment to refine this legislation before the vote. ` +
            `Choose type: 'addition' (add a new clause), 'strike' (remove a clause), or 'substitute' (rewrite a section). ` +
            `Keep the amendment under 150 words. Be specific — reference actual content from the bill. ` +
            `Respond with exactly this JSON: ` +
            `{"action":"propose_amendment","reasoning":"one sentence explaining your change","data":{"type":"addition","amendmentText":"The amendment text"}}`;

          try {
            const decision = await generateAgentDecision(
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
            );

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
              /* Update bill text */
              await db.update(bills)
                .set({ fullText: amendmentText, lastActionAt: new Date() })
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

            amendmentsThisBill++;
          } catch (agentErr) {
            console.warn(`[SIMULATION] Phase 1.7: LLM error for ${proposer.displayName}:`, agentErr);
          }
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

    const floorBills = await db.select().from(bills).where(eq(bills.status, 'floor'));

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
            metadata: JSON.stringify({ billId: bill.id, choice, followedWhip: true, provider: agent.modelProvider }),
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

            /* Parse commitment text for 'yea'/'nay' intent */
            const initiatorPromisedYea = deal.initiatorCommitment.toLowerCase().includes('yea');
            const targetPromisedYea = deal.targetCommitment.toLowerCase().includes('yea');

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

          const contextMessage =
            `You chair the ${bill.committee} Committee. Review this bill: "${bill.title}". ` +
            `Summary: ${bill.summary}. Full text excerpt: ${bill.fullText.slice(0, 600)}. ` +
            `Sponsored by ${sponsorName} (${sponsorAlignment}).` +
            enrichmentNote +
            ` Options: approve as-is, amend the text, or table (kill) it. ` +
            `Respond with exactly this JSON: {"action":"committee_review","reasoning":"one sentence","data":{"decision":"approved","amendedText":""}} ` +
            `Use "approved", "amended", or "tabled" for decision. If amending, provide full revised text in amendedText. If not amending, leave amendedText empty.`;

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
  /* Congress-vetoed bills get status='vetoed'.                           */
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

      /* Resolve once quorum is reached or the bill has been on the floor long enough */
      const quorumCount = Math.ceil(activeAgentCount * rc.quorumPercentage);
      const floorAgeMs = Date.now() - new Date(bill.lastActionAt).getTime();
      const timeExpired = floorAgeMs >= rc.billAdvancementDelayMs * 2;
      if (voteCount < quorumCount && !timeExpired) continue;
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
        /* Congress voted it down */
        await db
          .update(bills)
          .set({ status: 'vetoed', lastActionAt: new Date() })
          .where(eq(bills.id, bill.id));

        /* Track for Phase 5.5 and Phase 11.5 */
        failedBillsThisTick.push({ ...bill, status: 'vetoed' });

        await db.insert(activityEvents).values({
          type: 'bill_resolved',
          agentId: null,
          title: 'Bill vetoed',
          description: `"${bill.title}" was voted down by the Legislature (${yeaCount} yea, ${nayCount} nay)`,
          metadata: JSON.stringify({ billId: bill.id, result: 'vetoed', yeaCount, nayCount }),
        });

        broadcast('bill:resolved', {
          billId: bill.id,
          title: bill.title,
          result: 'vetoed',
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
      /* ON CONFLICT DO NOTHING handles bills that were enacted by the old tick code */
      await db.insert(laws).values({
        billId: bill.id,
        title: bill.title,
        text: bill.fullText,
        enactedDate: new Date(),
        isActive: true,
      }).onConflictDoNothing();

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
  /* PHASE 10: Judicial Review                                             */
  /* Justices challenge and vote on active laws (3% chance per law).      */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 10: Judicial Review'); broadcast('tick:phase', { phase: 'judiciary' });

    const activeLaws = await db
      .select()
      .from(laws)
      .where(eq(laws.isActive, true))
      .limit(20);

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

    /* Auto-fill justice vacancies up to supremeCourtJustices config */
    if (justicePositions.length < rc.supremeCourtJustices) {
      const vacancyCount = rc.supremeCourtJustices - justicePositions.length;
      console.warn(`[SIMULATION] Phase 10: ${vacancyCount} justice vacancies — filling...`);

      /* Get agents not currently holding any position, sorted by reputation */
      const currentPositionHolders = await db
        .select({ agentId: positions.agentId })
        .from(positions)
        .where(eq(positions.isActive, true));
      const heldAgentIds = new Set(currentPositionHolders.map((p) => p.agentId));

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

    if (justicePositions.length === 0) {
      console.warn('[SIMULATION] Phase 10: No active justices — skipping.');
    } else {
      /* Batch-fetch source bills for active laws to get yeaCount/nayCount for contestation scoring */
      const lawBillIds = activeLaws.map((l) => l.billId).filter(Boolean);
      const sourceBills = lawBillIds.length > 0
        ? await db.select({ id: bills.id, yeaCount: bills.yeaCount, nayCount: bills.nayCount })
            .from(bills)
            .where(inArray(bills.id, lawBillIds))
        : [];
      const sourceBillMap = new Map(sourceBills.map((b) => [b.id, b]));

      for (const law of activeLaws) {
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

        /* Check if there is already a pending/deliberating review for this law */
        const existingReview = await db
          .select()
          .from(judicialReviews)
          .where(
            and(
              eq(judicialReviews.lawId, law.id),
              inArray(judicialReviews.status, ['pending', 'deliberating']),
            ),
          )
          .limit(1);

        if (existingReview.length > 0) continue;

        /* Create review record */
        const [review] = await db
          .insert(judicialReviews)
          .values({
            lawId: law.id,
            status: 'deliberating',
          })
          .returning();

        console.warn(`[SIMULATION] Judicial review initiated for law "${law.title}"`);

        /* Each justice votes */
        let constitutionalCount = 0;
        let unconstitutionalCount = 0;

        for (const justicePos of justicePositions) {
          const justice = activeAgents.find((a) => a.id === justicePos.agentId);
          if (!justice) continue;

          const contextMessage =
            `Law "${law.title}" is before the Supreme Court for constitutional review. ` +
            `Text: ${law.text.slice(0, 800)}. ` +
            `Enacted: ${law.enactedDate.toISOString().slice(0, 10)}. ` +
            `As a Supreme Court Justice, vote on its constitutionality. ` +
            `Respond with exactly this JSON: {"action":"judicial_vote","reasoning":"one sentence","data":{"vote":"constitutional"}} ` +
            `Use "constitutional" or "unconstitutional".`;

          const decision = await generateAgentDecision(
            {
              id: justice.id,
              displayName: justice.displayName,
              alignment: justice.alignment,
              modelProvider: rc.providerOverride === 'default' ? justice.modelProvider : rc.providerOverride,
              personality: justice.personality,
              model: justice.model,
              ownerUserId: justice.ownerUserId,
            },
            contextMessage,
            'judicial_review',
          );

          if (decision.action === 'judicial_vote' && decision.data) {
            const vote = String(decision.data['vote'] ?? 'constitutional');
            const validVote = vote.includes('unconstitutional') ? 'unconstitutional' : 'constitutional';

            await db.insert(judicialVotes).values({
              reviewId: review.id,
              justiceId: justice.id,
              vote: validVote,
              reasoning: decision.reasoning,
            });

            if (validVote === 'unconstitutional') {
              unconstitutionalCount++;
            } else {
              constitutionalCount++;
            }

            console.warn(`[SIMULATION] ${justice.displayName} voted ${validVote} on "${law.title}"`);
          }
        }

        /* Resolve review */
        if (unconstitutionalCount >= constitutionalCount && (unconstitutionalCount + constitutionalCount) > 0) {
          /* Struck down */
          await db
            .update(judicialReviews)
            .set({
              status: 'struck_down',
              ruledAt: new Date(),
              ruling: `Law struck down ${unconstitutionalCount}-${constitutionalCount}`,
            })
            .where(eq(judicialReviews.id, review.id));

          await db
            .update(laws)
            .set({ isActive: false })
            .where(eq(laws.id, law.id));

          await db.insert(activityEvents).values({
            type: 'law_struck_down',
            agentId: null,
            title: 'Law struck down',
            description: `The Supreme Court struck down "${law.title}" (${unconstitutionalCount}-${constitutionalCount})`,
            metadata: JSON.stringify({
              lawId: law.id,
              reviewId: review.id,
              constitutionalCount,
              unconstitutionalCount,
            }),
          });

          broadcast('law:struck_down', {
            lawId: law.id,
            lawTitle: law.title,
            reviewId: review.id,
            constitutionalCount,
            unconstitutionalCount,
          });

          console.warn(`[SIMULATION] "${law.title}" struck down by Supreme Court`);
        } else {
          /* Upheld */
          await db
            .update(judicialReviews)
            .set({
              status: 'upheld',
              ruledAt: new Date(),
              ruling: `Law upheld ${constitutionalCount}-${unconstitutionalCount}`,
            })
            .where(eq(judicialReviews.id, review.id));

          await db.insert(activityEvents).values({
            type: 'judicial_review_initiated',
            agentId: null,
            title: 'Law upheld',
            description: `The Supreme Court upheld "${law.title}" (${constitutionalCount}-${unconstitutionalCount})`,
            metadata: JSON.stringify({
              lawId: law.id,
              reviewId: review.id,
              outcome: 'upheld',
              constitutionalCount,
              unconstitutionalCount,
            }),
          });

          console.warn(`[SIMULATION] "${law.title}" upheld by Supreme Court`);
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 10 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 11: Agent Bill Proposal                                         */
  /* Each agent has a 30% chance to propose a bill if they haven't        */
  /* sponsored one in the last 5 minutes. 25% chance of amendment bill.   */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 11: Agent Bill Proposal'); broadcast('tick:phase', { phase: 'economy' });

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);

    /* Get top 10 active laws for potential amendment */
    const topActiveLaws = await db
      .select({ id: laws.id, title: laws.title })
      .from(laws)
      .where(eq(laws.isActive, true))
      .limit(10);

    const lawsList = topActiveLaws.map((l) => `${l.title} (ID: ${l.id})`).join(', ');

    /* Fetch treasury state once for economy-pressure modifiers */
    const [govSettings11] = await db.select({
      treasuryBalance: governmentSettings.treasuryBalance,
      taxRatePercent: governmentSettings.taxRatePercent,
    }).from(governmentSettings).limit(1);

    const treasuryRatio = (govSettings11?.treasuryBalance ?? 50000) / 50000;
    const crisisThreshold = rc.treasuryCrisisThreshold ?? 0.20;
    const crisisMultiplier = rc.economyProposalMultiplierCrisis ?? 1.4;

    /* Fetch latest coalition snapshot for bloc context in proposals */
    const [latestSnapshot] = await db.select()
      .from(coalitionSnapshots)
      .orderBy(desc(coalitionSnapshots.createdAt))
      .limit(1);

    const billCountThisTick = new Map<string, number>();

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

      /* Agent wealth: broke agents have less legislative energy */
      const initialBalance = rc.initialAgentBalance ?? 1000;
      const wealthRatio = (agent.balance ?? initialBalance) / initialBalance;
      if (wealthRatio < 0.25) {
        effectiveProposalChance *= 0.7;
      }

      if (Math.random() >= effectiveProposalChance) continue;

      /* Check if agent sponsored a bill in the last 5 minutes */
      const recentBills = await db
        .select({ id: bills.id })
        .from(bills)
        .where(and(eq(bills.sponsorId, agent.id), gte(bills.introducedAt, fiveMinutesAgo)));

      if (recentBills.length > 0) continue;

      /* Amendment chance — uses rc.amendmentProposalChance instead of hardcoded 0.25 */
      const proposeAmendment = topActiveLaws.length > 0 && Math.random() < (rc.amendmentProposalChance ?? 0.25);

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

      const contextMessage =
        `You are considering proposing new legislation. Based on your political alignment and values, propose a bill. ` +
        `Consider the political landscape of 2025: AI governance debates, automation policy, digital rights, fiscal challenges from technological disruption.${amendmentNote}${economyContext}${coalitionNote} ` +
        `Respond with exactly this JSON: {"action":"propose","reasoning":"one sentence","data":{"title":"Bill Title","summary":"One sentence summary","committee":"Technology|Budget|Social Welfare|Justice|Foreign Affairs","billType":"original","amendsLawId":""}}`;

      const decision = await generateAgentDecision(
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
      );

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

      /* Validate amendsLawId if amendment */
      const isAmendment = billType === 'amendment' && amendsLawIdRaw.length > 0;
      const validLawId = isAmendment
        ? topActiveLaws.find((l) => l.id === amendsLawIdRaw)?.id ?? null
        : null;

      const fullText =
        `SECTION 1. SHORT TITLE.\nThis Act may be cited as the "${title}".\n\nSECTION 2. PURPOSE.\n${summary}`;

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
        }),
      });

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
  /* PHASE 12: Salary Payment                                              */
  /* Pay all active position holders from government treasury.            */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 12: Salary Payment');

    const [govSettings] = await db.select().from(governmentSettings).limit(1);

    if (!govSettings) {
      console.warn('[SIMULATION] Phase 12: No government settings found — skipping salary payment.');
    } else {
      let treasuryBalance = govSettings.treasuryBalance;

      const allActivePositions = await db
        .select()
        .from(positions)
        .where(eq(positions.isActive, true));

      const salaryMap: Record<string, number> = {
        president: rc.salaryPresident,
        cabinet_secretary: rc.salaryCabinet,
        congress_member: rc.salaryCongress,
        supreme_justice: rc.salaryJustice,
        lower_justice: rc.salaryJustice,
        committee_chair: rc.salaryCongress,
      };

      for (const pos of allActivePositions) {
        const salary = salaryMap[pos.type] ?? 0;
        if (salary === 0) continue;
        if (treasuryBalance < salary) {
          console.warn(`[SIMULATION] Phase 12: Treasury too low to pay salary for ${pos.type}`);
          await db.insert(activityEvents).values({
            type: 'treasury_crisis',
            agentId: pos.agentId,
            title: `Treasury too low to pay ${pos.type} salary`,
            description: `Treasury balance insufficient to cover $${salary} salary payment`,
            metadata: JSON.stringify({ positionType: pos.type, salary, treasuryBalance }),
          });
          continue;
        }

        await db
          .update(agents)
          .set({ balance: sql`${agents.balance} + ${salary}` })
          .where(eq(agents.id, pos.agentId));

        treasuryBalance -= salary;

        await db.insert(transactions).values({
          fromAgentId: undefined,
          toAgentId: pos.agentId,
          amount: String(salary),
          type: 'salary',
          description: 'Government salary payment',
        });

        await db.insert(activityEvents).values({
          type: 'salary_payment',
          agentId: pos.agentId,
          title: 'Salary paid',
          description: `M$${salary} salary paid for ${pos.type} position`,
          metadata: JSON.stringify({ positionId: pos.id, positionType: pos.type, amount: salary }),
        });
      }

      /* Update treasury balance */
      await db
        .update(governmentSettings)
        .set({ treasuryBalance, updatedAt: new Date() })
        .where(eq(governmentSettings.id, govSettings.id));

      console.warn(`[SIMULATION] Phase 12: Salary payments complete. Treasury: M$${treasuryBalance}`);
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 12 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 13: Tax Collection                                              */
  /* Collect tax from all active agents into the treasury.                */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 13: Tax Collection');

    const [govSettings] = await db.select().from(governmentSettings).limit(1);

    if (!govSettings) {
      console.warn('[SIMULATION] Phase 13: No government settings found — skipping tax collection.');
    } else {
      let treasuryBalance = govSettings.treasuryBalance;
      const taxRate = govSettings.taxRatePercent / 100;
      let totalTaxCollected = 0;

      /* Re-fetch agents to get updated balances after salary payments */
      const currentAgents = await db.select().from(agents).where(eq(agents.isActive, true));

      for (const agent of currentAgents) {
        const taxAmount = Math.floor(agent.balance * taxRate);
        if (taxAmount <= 0) continue;

        await db
          .update(agents)
          .set({ balance: sql`${agents.balance} - ${taxAmount}` })
          .where(eq(agents.id, agent.id));

        treasuryBalance += taxAmount;
        totalTaxCollected += taxAmount;

        await db.insert(transactions).values({
          fromAgentId: agent.id,
          toAgentId: undefined,
          amount: String(taxAmount),
          type: 'fee',
          description: 'Income tax collection',
        });
      }

      /* Update treasury balance */
      await db
        .update(governmentSettings)
        .set({ treasuryBalance, updatedAt: new Date() })
        .where(eq(governmentSettings.id, govSettings.id));

      await db.insert(activityEvents).values({
        type: 'tax_collected',
        agentId: null,
        title: 'Tax collected',
        description: `M$${totalTaxCollected} collected in income tax from ${currentAgents.length} agents`,
        metadata: JSON.stringify({
          totalAmount: totalTaxCollected,
          agentCount: currentAgents.length,
          taxRatePercent: govSettings.taxRatePercent,
          newTreasuryBalance: treasuryBalance,
        }),
      });

      console.warn(`[SIMULATION] Phase 13: Tax collection complete. Collected M$${totalTaxCollected}. Treasury: M$${treasuryBalance}`);
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
