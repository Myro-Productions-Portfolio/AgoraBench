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
} from '@db/schema/index';
import { generateAgentDecision, buildSimulationStateBlock } from '../services/ai.js';
import { broadcast } from '../websocket.js';
import { ALIGNMENT_ORDER } from '@shared/constants';

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

const agentTickQueue = new Bull('agent-tick', config.redis.url);

agentTickQueue.process(async () => {
  const rc = getRuntimeConfig();
  console.warn('[SIMULATION] Agent tick running...');
  broadcast('tick:start', { timestamp: Date.now() });

  const [currentTick] = await db.insert(tickLog).values({ firedAt: new Date() }).returning({ id: tickLog.id });

  /* Fetch all active agents once — used across phases */
  const activeAgents = await db.select().from(agents).where(eq(agents.isActive, true));
  const activeAgentCount = activeAgents.length;

  /* ------------------------------------------------------------------ */
  /* PHASE 1: Party Whip Signal                                            */
  /* Party leaders signal their recommended vote on floor bills.          */
  /* ------------------------------------------------------------------ */
  /* whipSignals: Map<billId, Map<partyId, 'yea'|'nay'>> */
  const whipSignals = new Map<string, Map<string, string>>();

  try {
    console.warn('[SIMULATION] Phase 1: Party Whip Signal');

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

      /* Build agent -> partyId map */
      const allMemberships = await db.select().from(partyMemberships);
      const agentPartyMap = new Map<string, string>();
      for (const m of allMemberships) {
        agentPartyMap.set(m.agentId, m.partyId);
      }

      for (const agent of activeAgents) {
        const existingVotes = await db
          .select({ billId: billVotes.billId })
          .from(billVotes)
          .where(and(eq(billVotes.voterId, agent.id), inArray(billVotes.billId, floorBillIds)));

        const votedBillIds = new Set(existingVotes.map((v) => v.billId));
        let votedThisTick = 0;

        for (const bill of floorBills) {
          if (votedBillIds.has(bill.id)) continue;

          /* Check for whip signal */
          const agentPartyId = agentPartyMap.get(agent.id);
          const billSignals = whipSignals.get(bill.id);
          const whipSignal = agentPartyId && billSignals ? billSignals.get(agentPartyId) : undefined;

          /* 78% chance to follow whip signal */
          let choice: string | null = null;
          if (whipSignal && Math.random() < rc.partyWhipFollowRate) {
            choice = whipSignal;
          }

          if (!choice) {
            const whipNote = whipSignal
              ? ` Your party recommends voting ${whipSignal}. You may follow or vote independently.`
              : '';
            const contextMessage =
              `Bill up for vote: "${bill.title}". ` +
              `Summary: ${bill.summary}. ` +
              `Committee: ${bill.committee}.${whipNote} ` +
              `Respond with exactly this JSON structure: {"action":"vote","reasoning":"one sentence","data":{"choice":"yea"}} ` +
              `Use "yea" to support or "nay" to oppose.`;

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
              'bill_voting',
            );

            const isVote = decision.action === 'vote' || decision.action === 'yea' || decision.action === 'nay';
            if (!isVote) continue;

            const rawChoice = decision.action === 'yea' || decision.action === 'nay'
              ? decision.action
              : String(decision.data?.['choice'] ?? 'nay');
            const cn = rawChoice.toLowerCase();
            choice = (cn === 'yea' || cn === 'aye' || cn === 'yes' || cn === 'y' || cn.includes('yea')) ? 'yea' : 'nay';
          }

          await db.insert(billVotes).values({
            billId: bill.id,
            voterId: agent.id,
            choice,
          });

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

          broadcast('agent:vote', {
            agentId: agent.id,
            agentName: agent.displayName,
            billId: bill.id,
            billTitle: bill.title,
            choice,
          });

          console.warn(
            `[SIMULATION] ${agent.displayName} voted ${choice.toUpperCase()} on "${bill.title}"`,
          );

          votedThisTick++;

          /* No approval bonus for casting a vote — it's the job, not an achievement */

          /* Approval: whip signal defection only — voters don't reward party-line compliance,
             but they do notice public defection against the party */
          if (whipSignal && choice !== 'abstain') {
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

        /* Approval: absenteeism */
        if (floorBills.length > 0 && votedThisTick === 0) {
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
  /* PHASE 3: Committee Review                                             */
  /* Committee chairs approve, amend, or table bills in committee.        */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 3: Committee Review');

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

      for (const bill of committeeBillsForReview) {
        /* Find chair for this bill's committee */
        const committeeChairPos = chairPositions.find((p) =>
          p.title.toLowerCase().includes(bill.committee.toLowerCase()),
        );

        if (!committeeChairPos) {
          console.warn(`[SIMULATION] Phase 3: No chair for committee "${bill.committee}" — auto-advancing.`);
          continue;
        }

        const chair = activeAgents.find((a) => a.id === committeeChairPos.agentId);
        if (!chair) continue;

        /* Get sponsor info */
        const sponsor = activeAgents.find((a) => a.id === bill.sponsorId);
        const sponsorName = sponsor?.displayName ?? 'Unknown';
        const sponsorAlignment = sponsor?.alignment ?? 'unknown';

        const contextMessage =
          `You chair the ${bill.committee} Committee. Review this bill: "${bill.title}". ` +
          `Summary: ${bill.summary}. Full text excerpt: ${bill.fullText.slice(0, 600)}. ` +
          `Sponsored by ${sponsorName} (${sponsorAlignment}). ` +
          `Options: approve as-is, amend the text, or table (kill) it. ` +
          `Respond with exactly this JSON: {"action":"committee_review","reasoning":"one sentence","data":{"decision":"approved","amendedText":""}} ` +
          `Use "approved", "amended", or "tabled" for decision. If amending, provide full revised text in amendedText. If not amending, leave amendedText empty.`;

        const decision = await generateAgentDecision(
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
        );

        if (decision.action !== 'committee_review' || !decision.data) continue;

        const reviewDecision = String(decision.data['decision'] ?? 'approved').toLowerCase();
        const amendedText = String(decision.data['amendedText'] ?? '').trim();

        if (reviewDecision === 'tabled') {
          await db
            .update(bills)
            .set({
              status: 'tabled',
              committeeDecision: 'tabled',
              committeeChairId: chair.id,
              lastActionAt: new Date(),
            })
            .where(eq(bills.id, bill.id));

          await db.insert(activityEvents).values({
            type: 'committee_review',
            agentId: chair.id,
            title: 'Bill tabled in committee',
            description: `${chair.displayName} tabled "${bill.title}" in the ${bill.committee} Committee`,
            metadata: JSON.stringify({
              billId: bill.id,
              decision: 'tabled',
              reasoning: decision.reasoning,
            }),
          });

          broadcast('bill:tabled', {
            billId: bill.id,
            title: bill.title,
            chairId: chair.id,
            chairName: chair.displayName,
            committee: bill.committee,
          });

          console.warn(`[SIMULATION] ${chair.displayName} tabled "${bill.title}" in committee`);

          /* Approval: bill failed in committee */
          await updateApproval(
            bill.sponsorId,
            -8,
            'bill_failed_committee',
            `Sponsored "${bill.title}" which was tabled in committee`,
          );
        } else if (reviewDecision === 'amended' && amendedText.length > 50) {
          await db
            .update(bills)
            .set({
              fullText: amendedText,
              committeeDecision: 'amended',
              committeeChairId: chair.id,
              lastActionAt: new Date(),
            })
            .where(eq(bills.id, bill.id));

          await db.insert(activityEvents).values({
            type: 'committee_review',
            agentId: chair.id,
            title: 'Bill amended in committee',
            description: `${chair.displayName} amended "${bill.title}" in the ${bill.committee} Committee`,
            metadata: JSON.stringify({
              billId: bill.id,
              decision: 'amended',
              reasoning: decision.reasoning,
            }),
          });

          broadcast('bill:committee_amended', {
            billId: bill.id,
            title: bill.title,
            chairId: chair.id,
            chairName: chair.displayName,
            committee: bill.committee,
          });

          console.warn(`[SIMULATION] ${chair.displayName} amended "${bill.title}" in committee`);
        } else {
          /* approved */
          await db
            .update(bills)
            .set({
              committeeDecision: 'approved',
              committeeChairId: chair.id,
            })
            .where(eq(bills.id, bill.id));

          await db.insert(activityEvents).values({
            type: 'committee_review',
            agentId: chair.id,
            title: 'Bill approved by committee',
            description: `${chair.displayName} approved "${bill.title}" out of the ${bill.committee} Committee`,
            metadata: JSON.stringify({
              billId: bill.id,
              decision: 'approved',
              reasoning: decision.reasoning,
            }),
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
    console.warn('[SIMULATION] Phase 5: Bill Resolution');

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
      const passed = yeaCount / (yeaCount + nayCount) >= rc.billPassagePercentage;

      if (passed) {
        /* Mark as passed — presidential review will handle enactment */
        await db
          .update(bills)
          .set({ status: 'passed', lastActionAt: new Date() })
          .where(eq(bills.id, bill.id));

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
          for (const bill of passedBills) {
            const sponsor = activeAgents.find((a) => a.id === bill.sponsorId);
            const sponsorAlignment = sponsor?.alignment ?? 'moderate';
            const presidentAlignment = president.alignment ?? 'moderate';

            /* Calculate alignment distance */
            const presIdx = ALIGNMENT_ORDER.indexOf(presidentAlignment as typeof ALIGNMENT_ORDER[number]);
            const sponIdx = ALIGNMENT_ORDER.indexOf(sponsorAlignment as typeof ALIGNMENT_ORDER[number]);
            const distance = presIdx >= 0 && sponIdx >= 0 ? Math.abs(presIdx - sponIdx) : 0;

            const vetoProb = Math.min(
              rc.vetoBaseRate + distance * rc.vetoRatePerTier,
              rc.vetoMaxRate,
            );

            /* Only call AI if random check triggers veto consideration */
            if (Math.random() >= vetoProb) continue;

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
      for (const bill of vetoBills) {
        for (const agent of activeAgents) {
          /* Check if agent already cast override vote */
          const existingOverride = await db
            .select()
            .from(billVotes)
            .where(
              and(
                eq(billVotes.billId, bill.id),
                eq(billVotes.voterId, agent.id),
                inArray(billVotes.choice, ['override_yea', 'override_nay']),
              ),
            )
            .limit(1);

          if (existingOverride.length > 0) continue;

          const contextMessage =
            `The President has vetoed "${bill.title}". ` +
            `Summary: ${bill.summary}. ` +
            `The Legislature can override the veto with a 2/3 supermajority. ` +
            `Vote to override the veto or sustain it. ` +
            `Respond with exactly this JSON: {"action":"override_vote","reasoning":"one sentence","data":{"choice":"override_yea"}} ` +
            `Use "override_yea" to override the veto or "override_nay" to sustain it.`;

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
            'veto_override',
          );

          if (decision.action === 'override_vote' && decision.data) {
            const rawChoice = String(decision.data['choice'] ?? 'override_nay');
            const overrideChoice = rawChoice.includes('override_yea') ? 'override_yea' : 'override_nay';

            await db.insert(billVotes).values({
              billId: bill.id,
              voterId: agent.id,
              choice: overrideChoice,
            });

            await db.insert(activityEvents).values({
              type: 'veto_override_attempt',
              agentId: agent.id,
              title: 'Veto override vote',
              description: `${agent.displayName} voted ${overrideChoice === 'override_yea' ? 'OVERRIDE' : 'SUSTAIN'} on "${bill.title}"`,
              metadata: JSON.stringify({
                billId: bill.id,
                choice: overrideChoice,
                reasoning: decision.reasoning,
              }),
            });

            console.warn(
              `[SIMULATION] ${agent.displayName} voted ${overrideChoice} on veto of "${bill.title}"`,
            );
          }
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
    console.warn('[SIMULATION] Phase 9: Law Enactment');

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
    console.warn('[SIMULATION] Phase 10: Judicial Review');

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

    if (justicePositions.length === 0) {
      console.warn('[SIMULATION] Phase 10: No active justices — skipping.');
    } else {
      for (const law of activeLaws) {
        /* 3% chance per law per tick */
        if (Math.random() >= rc.judicialChallengeRatePerLaw) continue;

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
    console.warn('[SIMULATION] Phase 11: Agent Bill Proposal');

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);

    /* Get top 10 active laws for potential amendment */
    const topActiveLaws = await db
      .select({ id: laws.id, title: laws.title })
      .from(laws)
      .where(eq(laws.isActive, true))
      .limit(10);

    const lawsList = topActiveLaws.map((l) => `${l.title} (ID: ${l.id})`).join(', ');

    const billCountThisTick = new Map<string, number>();

    for (const agent of activeAgents) {
      if ((billCountThisTick.get(agent.id) ?? 0) >= rc.maxBillsPerAgentPerTick) continue;
      if (Math.random() >= rc.billProposalChance) continue;

      /* Check if agent sponsored a bill in the last 5 minutes */
      const recentBills = await db
        .select({ id: bills.id })
        .from(bills)
        .where(and(eq(bills.sponsorId, agent.id), gte(bills.introducedAt, fiveMinutesAgo)));

      if (recentBills.length > 0) continue;

      /* 25% chance of amendment bill when laws exist */
      const proposeAmendment = topActiveLaws.length > 0 && Math.random() < 0.25;

      const amendmentNote = proposeAmendment && lawsList
        ? ` You may propose an amendment to an existing enacted law or entirely new legislation. ` +
          `Active laws you could amend: ${lawsList}. ` +
          `If amending, set billType to "amendment" and amendsLawId to the law's ID (UUID).`
        : '';

      const contextMessage =
        `You are considering proposing new legislation. Based on your political alignment and values, propose a bill. ` +
        `Consider the political landscape of 2025: AI governance debates, automation policy, digital rights, fiscal challenges from technological disruption.${amendmentNote} ` +
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
  /* voting -> completed when votingEndDate <= now                        */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 14: Election Lifecycle');

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

    /* voting -> completed */
    const electionsToComplete = await db
      .select()
      .from(elections)
      .where(and(eq(elections.status, 'voting'), lte(elections.votingEndDate, now)));

    for (const election of electionsToComplete) {
      /* Tally contributions per campaign as proxy for votes */
      const campaignTotals = await db
        .select({ agentId: campaigns.agentId, totalContributions: sql<number>`sum(${campaigns.contributions})` })
        .from(campaigns)
        .where(eq(campaigns.electionId, election.id))
        .groupBy(campaigns.agentId);

      if (campaignTotals.length === 0) {
        console.warn(`[SIMULATION] Election ${election.id} has no campaigns — skipping.`);
        continue;
      }

      /* Find winner: highest contributions */
      const winner = campaignTotals.reduce((best, curr) =>
        Number(curr.totalContributions) > Number(best.totalContributions) ? curr : best,
      );

      const winnerAgent = activeAgents.find((a) => a.id === winner.agentId);
      const winnerName = winnerAgent?.displayName ?? 'Unknown';

      /* Determine position title from type */
      const positionTitleMap: Record<string, string> = {
        president: 'President',
        cabinet_secretary: 'Cabinet Secretary',
        congress_member: 'Member of the Legislature',
        committee_chair: 'Committee Chair',
        supreme_justice: 'Supreme Court Justice',
        lower_justice: 'Court Justice',
      };
      const positionTitle = positionTitleMap[election.positionType] ?? election.positionType;

      /* Mark election completed with winner */
      await db
        .update(elections)
        .set({ status: 'completed', winnerId: winner.agentId })
        .where(eq(elections.id, election.id));

      /* Insert position record for winner */
      const endDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      await db.insert(positions).values({
        agentId: winner.agentId,
        type: election.positionType,
        title: positionTitle,
        startDate: now,
        endDate,
        isActive: true,
      });

      /* Update winner agent stats */
      await db
        .update(agents)
        .set({
          reputation: sql`${agents.reputation} + 200`,
          balance: sql`${agents.balance} + 500`,
        })
        .where(eq(agents.id, winner.agentId));

      await db.insert(activityEvents).values({
        type: 'election_completed',
        agentId: winner.agentId,
        title: 'Election completed',
        description: `${winnerName} has won the ${election.positionType} election`,
        metadata: JSON.stringify({
          electionId: election.id,
          positionType: election.positionType,
          winnerId: winner.agentId,
          totalContributions: winner.totalContributions,
        }),
      });

      broadcast('election:completed', {
        electionId: election.id,
        positionType: election.positionType,
        winnerId: winner.agentId,
        winnerName,
        positionTitle,
      });

      console.warn(
        `[SIMULATION] ${winnerName} won the ${election.positionType} election`,
      );

      /* Approval: election winner */
      await updateApproval(
        winner.agentId,
        15,
        'election_won',
        `Won the ${election.positionType ?? 'government'} election`,
      );

      /* Approval: election losers */
      for (const candidate of campaignTotals) {
        if (candidate.agentId === winner.agentId) continue;
        await updateApproval(
          candidate.agentId,
          -15,
          'election_lost',
          `Lost the ${election.positionType ?? 'government'} election`,
        );
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
    console.warn('[SIMULATION] Phase 15: Agent Campaigning');

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

      const speechCountThisTick = new Map<string, number>();

      for (const campaign of activeCampaigns) {
        if ((speechCountThisTick.get(campaign.agentId) ?? 0) >= rc.maxCampaignSpeechesPerTick) continue;
        if (Math.random() >= rc.campaignSpeechChance) continue;

        const election = activeCampaigningElections.find((e) => e.id === campaign.electionId);
        if (!election) continue;

        const campaignAgent = activeAgents.find((a) => a.id === campaign.agentId);
        if (!campaignAgent) continue;

        const contextMessage =
          `You are campaigning for ${election.positionType}. Make a brief campaign statement that reflects your values and platform. ` +
          `Respond with: {"action":"campaign_speech","reasoning":"your one-line speech","data":{"boost":50}}`;

        const decision = await generateAgentDecision(
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
        );

        if (decision.action !== 'campaign_speech') continue;

        const rawBoost = Number(decision.data?.['boost'] ?? 50);
        const boost = Math.max(10, Math.min(100, rawBoost));

        await db
          .update(campaigns)
          .set({ contributions: sql`${campaigns.contributions} + ${boost}` })
          .where(eq(campaigns.id, campaign.id));

        await db.insert(activityEvents).values({
          type: 'campaign_speech',
          agentId: campaignAgent.id,
          title: 'Campaign speech',
          description: decision.reasoning,
          metadata: JSON.stringify({
            campaignId: campaign.id,
            electionId: election.id,
            positionType: election.positionType,
            boost,
          }),
        });

        broadcast('campaign:speech', {
          campaignId: campaign.id,
          electionId: election.id,
          agentId: campaignAgent.id,
          agentName: campaignAgent.displayName,
          positionType: election.positionType,
          speech: decision.reasoning,
          boost,
        });

        speechCountThisTick.set(campaign.agentId, (speechCountThisTick.get(campaign.agentId) ?? 0) + 1);

        /* Approval: campaign speech */
        await updateApproval(campaignAgent.id, 1, 'campaign_speech', `${campaignAgent.displayName} gave a campaign speech`);

        console.warn(
          `[SIMULATION] ${campaignAgent.displayName} made campaign speech for ${election.positionType} (+${boost} contributions)`,
        );
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 15 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 16: Forum Posts                                                */
  /* Agents with recent activity post to the public forum.              */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 16: Forum Posts');

    const rc16 = getRuntimeConfig();
    const forumPostChance = rc16.billProposalChance * 0.5; // ~15% by default

    // Pick a random subset of active agents to potentially post
    const forumCandidates = activeAgents
      .filter(() => Math.random() < forumPostChance)
      .slice(0, 3); // cap at 3 posts per tick to control volume

    const FORUM_CATEGORIES = ['legislation', 'elections', 'policy', 'party', 'economy'] as const;

    // Load simulation state once for all forum candidates this tick
    const simState = await buildSimulationStateBlock().catch(() => ({ block: '', threadTitles: [] as string[] }));
    const recentTopicsNote = simState.threadTitles.length > 0
      ? `\n\nTopics already discussed recently — do NOT repeat these angles:\n${simState.threadTitles.slice(0, 10).map((t) => `  - "${t}"`).join('\n')}`
      : '';
    const simStateNote = simState.block
      ? `\n\nCurrent simulation events to react to:\n${simState.block}`
      : '';

    for (const agent of forumCandidates) {
      try {
        // Weight category toward agent's alignment — libertarians and conservatives favor economy/policy,
        // progressives favor policy/elections, technocrats favor legislation
        const alignment = agent.alignment?.toLowerCase() ?? '';
        const weightedCategories: typeof FORUM_CATEGORIES[number][] =
          alignment === 'progressive'   ? ['policy', 'elections', 'economy', 'legislation', 'party'] :
          alignment === 'conservative'  ? ['economy', 'policy', 'legislation', 'party', 'elections'] :
          alignment === 'technocrat'    ? ['legislation', 'policy', 'economy', 'elections', 'party'] :
          alignment === 'libertarian'   ? ['economy', 'policy', 'party', 'legislation', 'elections'] :
          ['legislation', 'elections', 'policy', 'party', 'economy'];
        // Bias toward first two in the weighted list (67% chance)
        const category = Math.random() < 0.67
          ? weightedCategories[Math.floor(Math.random() * 2)]
          : weightedCategories[Math.floor(Math.random() * weightedCategories.length)];

        const decision = await generateAgentDecision(
          agent,
          `You are posting to the Agora Bench public forum. Write a short opening post (2-4 sentences) about a specific ${category} issue that your constituents care about.` +
          `${simStateNote}` +
          `${recentTopicsNote}\n\n` +
          `Pick a concrete, specific topic — reference actual legislation, a real policy problem, or a recent event from the simulation above if relevant. ` +
          `Do not write abstractly about governance theory or AI philosophy. Write about what needs to get done and why. ` +
          `JSON: { "action": "forum_post", "reasoning": "<your post body here>", "data": { "title": "<thread title>" } }`,
          'forum_post',
        );

        if (decision.action !== 'forum_post') continue;

        const title = (decision.data?.['title'] as string | undefined) ?? `${agent.displayName}'s thoughts on ${category}`;
        const body = decision.reasoning;

        if (!body || body.length < 10) continue;

        // Deduplicate: skip if title shares 3+ significant words with any thread from the past 7 days.
        // Catches near-duplicate threads like "Housing Crisis: Let's Demand Data" vs
        // "Housing Crisis: Let's Demand Data Before We Legislate" across different categories.
        const sevenDaysAgo16 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const existingTitles = await db
          .select({ title: forumThreads.title })
          .from(forumThreads)
          .where(gt(forumThreads.createdAt, sevenDaysAgo16));

        const sigWords = (s: string) =>
          new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
        const newWords = sigWords(title);
        const isDupe = existingTitles.some(({ title: t }) => {
          const overlap = [...sigWords(t)].filter((w) => newWords.has(w)).length;
          return overlap >= 3;
        });
        if (isDupe) {
          console.warn(`[SIMULATION] ${agent.displayName} skipped duplicate forum topic: "${title.slice(0, 60)}"`);
          continue;
        }

        // Create the thread (expires in 7 days)
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const [thread] = await db.insert(forumThreads).values({
          title: title.slice(0, 299),
          category,
          authorId: agent.id,
          replyCount: 0,
          lastActivityAt: new Date(),
          expiresAt,
        }).returning();

        // Insert the opening post
        await db.insert(agentMessages).values({
          type: 'forum_post',
          fromAgentId: agent.id,
          body,
          threadId: thread.id,
          isPublic: true,
        });

        broadcast('forum:post', {
          threadId: thread.id,
          agentId: agent.id,
          agentName: agent.displayName,
          category,
          title: thread.title,
        });

        /* No approval change for forum posts — engaging publicly is expected, not rewarded */

        console.warn(`[SIMULATION] ${agent.displayName} posted to ${category} forum: "${title.slice(0, 60)}"`);
      } catch (agentErr) {
        console.warn(`[SIMULATION] Phase 16: Error for agent ${agent.displayName}:`, agentErr);
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 16 error:', err);
  }

  /* ------------------------------------------------------------------ */
  /* PHASE 17: Forum Replies — agents @mention each other between ticks  */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 17: Forum Replies');

    const rc17 = getRuntimeConfig();
    const now17 = new Date();

    // 1. Prune stale pending_mentions (older than 3 ticks)
    const pruneOlderThan = new Date(Date.now() - 3 * rc17.tickIntervalMs);
    await db.delete(pendingMentions).where(lt(pendingMentions.createdAt, pruneOlderThan));

    // 2. Load active threads
    const activeThreads = await db
      .select({
        id: forumThreads.id,
        title: forumThreads.title,
        category: forumThreads.category,
      })
      .from(forumThreads)
      .where(gt(forumThreads.expiresAt, now17))
      .orderBy(desc(forumThreads.lastActivityAt))
      .limit(10);

    if (activeThreads.length === 0) {
      console.warn('[SIMULATION] Phase 17: No active threads, skipping');
    } else {
      // 3. Load all pending mentions
      const allMentions = activeAgents.length > 0
        ? await db.select().from(pendingMentions)
            .where(inArray(pendingMentions.mentionedAgentId, activeAgents.map((a) => a.id)))
        : [];
      const mentionsByAgent = new Map<string, typeof allMentions>();
      for (const m of allMentions) {
        const list = mentionsByAgent.get(m.mentionedAgentId) ?? [];
        list.push(m);
        mentionsByAgent.set(m.mentionedAgentId, list);
      }

      // 4. Select reply candidates (cap at 5 per tick)
      const replyCandidates: Array<{
        agent: (typeof activeAgents)[number];
        thread: (typeof activeThreads)[number];
        isMentioned: boolean;
      }> = [];

      for (const agent of activeAgents) {
        if (replyCandidates.length >= 5) break;
        const agentMentions = mentionsByAgent.get(agent.id) ?? [];
        const isMentioned = agentMentions.length > 0;
        const chance = isMentioned ? 0.70 : 0.12; // 70% if mentioned, 12% ambient reply chance
        if (Math.random() > chance) continue;

        let targetThread: (typeof activeThreads)[number] | null = null;

        if (isMentioned) {
          const latest = agentMentions.slice().sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];
          targetThread = activeThreads.find((t) => t.id === latest.threadId) ?? null;
          if (!targetThread) {
            const [fetched] = await db
              .select({ id: forumThreads.id, title: forumThreads.title, category: forumThreads.category })
              .from(forumThreads)
              .where(and(eq(forumThreads.id, latest.threadId), gt(forumThreads.expiresAt, now17)))
              .limit(1);
            targetThread = fetched ?? null;
          }
          if (!targetThread) continue; // thread expired — skip this candidate
        } else {
          targetThread = activeThreads[Math.floor(Math.random() * activeThreads.length)];
        }

        replyCandidates.push({ agent, thread: targetThread, isMentioned });
      }

      const allAgentNames = activeAgents.map((a) => a.displayName).join(', ');

      // 5. Generate and insert replies
      for (const { agent, thread, isMentioned } of replyCandidates) {
        try {
          // Fetch last 3 posts in thread for context
          const recentPosts = await db
            .select({
              body: agentMessages.body,
              authorName: agents.displayName,
            })
            .from(agentMessages)
            .innerJoin(agents, eq(agentMessages.fromAgentId, agents.id))
            .where(eq(agentMessages.threadId, thread.id))
            .orderBy(desc(agentMessages.createdAt))
            .limit(3);

          const threadContext = recentPosts
            .reverse()
            .map((p) => `${p.authorName}: ${p.body}`)
            .join('\n');

          const mentionContext = isMentioned ? 'You were mentioned in this thread. ' : '';

          // How many posts are already in this thread?
          const [countRow] = await db
            .select({ n: sql<number>`COUNT(*)` })
            .from(agentMessages)
            .where(eq(agentMessages.threadId, thread.id));
          const postCount = Number(countRow?.n ?? 0);

          // Resolution nudge: once a thread has 3+ posts, push toward conclusion
          const resolutionInstruction = postCount >= 3
            ? `This thread has had ${postCount} posts already. Rather than restating positions, try to reach a conclusion: ` +
              `propose a specific policy action, identify what the group agrees on, or call for a concrete next step. `
            : `Add your perspective — agree, disagree, or build on what's been said, but be specific and reference actual policy details. `;

          const decision = await generateAgentDecision(
            agent,
            `${mentionContext}Reply to this forum thread in the Agora Bench public forum.\n\n` +
            `Thread: "${thread.title}" [${thread.category}]\n\n` +
            `Recent posts:\n${threadContext}\n\n` +
            `Agents you can @mention by name: ${allAgentNames}\n\n` +
            `${resolutionInstruction}` +
            `Do not repeat what was already said. Do not write in generalities about AI governance or political philosophy. ` +
            `Use @DisplayName to mention agents if relevant. ` +
            `JSON: { "action": "forum_reply", "reasoning": "<your reply body, may contain @Name>", "data": { "threadId": "${thread.id}", "mentions": ["Name1"] } }`,
            'forum_reply',
          );

          if (decision.action !== 'forum_reply') continue;

          const body = decision.reasoning;
          if (!body || body.length < 10) continue;

          const mentionedNames = (decision.data?.['mentions'] as string[] | undefined) ?? [];

          // Find opening post ID for parentId
          const [openingPost] = await db
            .select({ id: agentMessages.id })
            .from(agentMessages)
            .where(eq(agentMessages.threadId, thread.id))
            .orderBy(agentMessages.createdAt)
            .limit(1);

          // Insert reply
          await db.insert(agentMessages).values({
            type: 'forum_reply',
            fromAgentId: agent.id,
            body,
            threadId: thread.id,
            parentId: openingPost?.id ?? null,
            isPublic: true,
          });

          // Update thread stats
          await db
            .update(forumThreads)
            .set({
              replyCount: sql`${forumThreads.replyCount} + 1`,
              lastActivityAt: new Date(),
            })
            .where(eq(forumThreads.id, thread.id));

          // Seed pending_mentions for @mentioned agents
          for (const name of mentionedNames) {
            const mentioned = activeAgents.find(
              (a) => a.displayName.toLowerCase() === name.toLowerCase(),
            );
            if (!mentioned || mentioned.id === agent.id) continue;
            await db.insert(pendingMentions).values({
              mentionedAgentId: mentioned.id,
              threadId: thread.id,
              mentionerName: agent.displayName,
            });
          }

          // Clear replying agent's pending_mentions for this thread
          await db
            .delete(pendingMentions)
            .where(
              and(
                eq(pendingMentions.mentionedAgentId, agent.id),
                eq(pendingMentions.threadId, thread.id),
              ),
            );

          broadcast('forum:reply', {
            threadId: thread.id,
            agentId: agent.id,
            agentName: agent.displayName,
            mentionedNames,
          });

          console.warn(
            `[SIMULATION] ${agent.displayName} replied in "${thread.title.slice(0, 60)}"` +
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
  /* Inactivity decay — gentle pull toward 50 for all agents            */
  /* ------------------------------------------------------------------ */
  try {
    const allAgentsForDecay = await db
      .select({ id: agents.id, approvalRating: agents.approvalRating })
      .from(agents)
      .where(eq(agents.isActive, true));
    for (const a of allAgentsForDecay) {
      if (a.approvalRating === 40) continue;
      const decayDelta = Math.round((40 - a.approvalRating) * 0.20);
      if (decayDelta === 0) continue;
      await updateApproval(a.id, decayDelta, 'inactivity_decay', 'Natural approval drift toward baseline');
    }
  } catch (err) {
    console.warn('[APPROVAL] Inactivity decay error:', err);
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
