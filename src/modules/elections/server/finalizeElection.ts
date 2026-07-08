/**
 * finalizeElection — shared helper used by both the organic Phase 14 tick
 * and the admin /advance endpoint. Tallies a president/congress/cabinet/etc
 * election by real cast ballots (E3 slice A — see docs/specs/simulation-
 * completeness.md §A), inserts a positions row, vacates any lower office the
 * winner already holds, updates agent stats, runs the approval + relationship
 * cascade, and broadcasts activity events.
 *
 * Tally source: `votes` rows for this election, grouped by candidateId (see
 * electionMath.tallyElectionVotes). `campaigns.contributions` is no longer
 * the tally — it remains only as a campaign-strength signal (used elsewhere
 * for approval-margin scaling below and by Phase 15 speech dynamics).
 *
 * Zero-ballot fallback: if voting closed with no ballots cast (e.g. a
 * single-tick voting window, or the ballot pass failing entirely), the
 * winner falls back to whichever candidate raised the most contributions —
 * the same signal the old placeholder used exclusively. This keeps a
 * pathological zero-turnout election resolvable instead of stuck forever.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@db/connection';
import {
  agents,
  agentRelationships,
  activityEvents,
  elections,
  campaigns,
  positions,
  votes,
} from '@db/schema/index';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import { broadcast } from '@core/server/websocket.js';
import { updateApproval } from '@core/server/jobs/agentTick.js';
import { tallyElectionVotes, getSeatsToVacate, orderCandidates, pickContributionsFallback } from '@core/server/lib/electionMath.js';

export interface FinalizeElectionResult {
  status: 'ok' | 'no_campaigns' | 'already_finalized' | 'not_found';
  electionId: string;
  winnerId?: string;
  winnerName?: string;
  loserIds?: string[];
  totalVotes?: number;
  positionId?: string;
}

const POSITION_TITLE_BY_TYPE: Record<string, string> = {
  president: 'President',
  cabinet_secretary: 'Cabinet Secretary',
  congress_member: 'Member of the Legislature',
  committee_chair: 'Committee Chair',
  supreme_justice: 'Supreme Court Justice',
  lower_justice: 'Court Justice',
};

/**
 * Finalizes an election: tallies contributions, selects winner, creates
 * the positions row, updates agent stats, writes activity + approval events,
 * broadcasts to clients. Idempotency: if the election already has a winnerId
 * set AND an active positions row exists for that agent/type, returns
 * 'already_finalized' without duplicating side effects.
 */
export async function finalizeElection(electionId: string): Promise<FinalizeElectionResult> {
  const rc = getRuntimeConfig();
  const now = new Date();

  /* Load election */
  const [election] = await db
    .select()
    .from(elections)
    .where(eq(elections.id, electionId))
    .limit(1);

  if (!election) {
    return { status: 'not_found', electionId };
  }

  /* Idempotency: already finalized cleanly */
  if (election.winnerId) {
    const [existingPos] = await db
      .select({ id: positions.id })
      .from(positions)
      .where(
        and(
          eq(positions.agentId, election.winnerId),
          eq(positions.type, election.positionType),
          eq(positions.isActive, true),
        ),
      )
      .limit(1);
    if (existingPos) {
      return {
        status: 'already_finalized',
        electionId,
        winnerId: election.winnerId,
        positionId: existingPos.id,
      };
    }
    /* winnerId set but no position row — fall through and create it */
  }

  /* Contributions per candidate — kept as a campaign-strength signal (margin
     scaling below) and as the zero-ballot fallback tally source. Filtered to
     status = 'active', matching vote-casting eligibility in Phase 14 so a
     withdrawn candidate can never win via the fallback path.
     campaignId (min) is carried as a stable secondary tie-break key:
     batch-seeded campaigns share identical defaultNow() startDate values, so
     ordering by startDate alone would resolve ties by Postgres row order. */
  const campaignTotals = await db
    .select({
      agentId: campaigns.agentId,
      totalContributions: sql<number>`sum(${campaigns.contributions})`,
      startDate: sql<string>`min(${campaigns.startDate})`,
      campaignId: sql<string>`min(${campaigns.id}::text)`,
    })
    .from(campaigns)
    .where(and(eq(campaigns.electionId, electionId), eq(campaigns.status, 'active')))
    .groupBy(campaigns.agentId);

  if (campaignTotals.length === 0) {
    console.warn(`[FINALIZE] Election ${electionId} has no active campaigns — nothing to finalize.`);
    return { status: 'no_campaigns', electionId };
  }

  /* Real ballots cast for this election (E3 slice A). */
  const castBallots = await db
    .select({ candidateId: votes.candidateId })
    .from(votes)
    .where(eq(votes.electionId, electionId));

  /* Deterministic candidate order for tie-break + fallback (pure, tested in
     electionMath): campaign registration order, campaignId as secondary key
     so identical batch-seeded timestamps never resolve by row order. */
  const standings = campaignTotals.map((c) => ({
    agentId: c.agentId,
    totalContributions: Number(c.totalContributions ?? 0),
    startDate: c.startDate,
    campaignId: c.campaignId,
  }));
  const candidateOrder = orderCandidates(standings);

  /* Zero-ballot fallback: highest campaign contributions among ACTIVE
     candidates (campaignTotals is already status='active' filtered), so a
     withdrawn candidate can never win via fallback and a zero-turnout
     election still resolves deterministically. */
  const fallbackWinnerId = pickContributionsFallback(standings);

  const tally = tallyElectionVotes(castBallots, candidateOrder, fallbackWinnerId);

  if (!tally.winnerId) {
    console.warn(`[FINALIZE] Election ${electionId} has no ballots and no campaigns to fall back to — nothing to finalize.`);
    return { status: 'no_campaigns', electionId };
  }

  if (tally.usedFallback) {
    console.warn(`[FINALIZE] Election ${electionId} had zero ballots cast — falling back to highest campaign contributions.`);
  }

  const winnerCandidateTotal = campaignTotals.find((c) => c.agentId === tally.winnerId);
  const winner = { agentId: tally.winnerId, totalContributions: winnerCandidateTotal?.totalContributions ?? 0 };

  const [winnerAgent] = await db
    .select({ id: agents.id, displayName: agents.displayName })
    .from(agents)
    .where(eq(agents.id, winner.agentId))
    .limit(1);
  const winnerName = winnerAgent?.displayName ?? 'Unknown';

  const positionTitle = POSITION_TITLE_BY_TYPE[election.positionType] ?? election.positionType;

  /* Margin factor now derives from real vote share when ballots exist;
     falls back to the contributions-share calculation only in the
     zero-ballot fallback path, so approval swings stay meaningful either way. */
  const totalContributions = campaignTotals.reduce(
    (sum, c) => sum + Number(c.totalContributions ?? 0),
    0,
  );
  const candidateCount = campaignTotals.length;

  let victoryMarginFactor: number;
  if (!tally.usedFallback && tally.totalVotes > 0) {
    const winnerVotes = tally.voteCounts[winner.agentId] ?? 0;
    victoryMarginFactor = Math.min(1.5, (winnerVotes / tally.totalVotes) * candidateCount);
  } else {
    const winnerContributions = Number(winner.totalContributions ?? 0);
    victoryMarginFactor = totalContributions > 0
      ? Math.min(1.5, (winnerContributions / totalContributions) * candidateCount)
      : 1.0;
  }

  /* Update election row: canonical terminal state is 'certified' — used by
     ai.ts context builders to detect sitting officeholders. certifiedDate is
     set so downstream reads (elections.ts) work consistently. totalVotes is
     now the real ballot count (falls back to 0 when the zero-ballot path
     fired, since no ballots exist to display — the roll call reads 'votes'
     directly and will correctly show nothing cast). */
  await db
    .update(elections)
    .set({
      status: 'certified',
      winnerId: winner.agentId,
      totalVotes: tally.totalVotes,
      certifiedDate: now,
    })
    .where(eq(elections.id, electionId));

  /* Close out this election's campaigns — otherwise they linger as 'active'
     forever (campaigns has no writer that ever advances status past its
     initial value) and keep showing on /elections after the seat is decided. */
  await db
    .update(campaigns)
    .set({ status: 'concluded', endDate: now })
    .where(eq(campaigns.electionId, electionId));

  /* Capture the winner's existing active offices BEFORE inserting the new
     one, so the just-won seat is provably not in the vacate candidate set
     (the invariant is explicit here rather than relying on officeRank's
     strict inequality to happen to exclude an equal-rank new seat). */
  const winnerPriorPositions = await db
    .select({ id: positions.id, type: positions.type })
    .from(positions)
    .where(and(eq(positions.agentId, winner.agentId), eq(positions.isActive, true)));

  /* Insert position row for winner */
  const termDays = election.positionType === 'president'
    ? (rc.presidentTermDays ?? 90)
    : (rc.congressTermDays ?? 60);
  const endDate = new Date(now.getTime() + termDays * 24 * 60 * 60 * 1000);

  const [insertedPosition] = await db
    .insert(positions)
    .values({
      agentId: winner.agentId,
      type: election.positionType,
      title: positionTitle,
      startDate: now,
      endDate,
      isActive: true,
    })
    .returning({ id: positions.id });

  /* Double-position fix (E3 slice A, owner-flaggable default): winning a
     higher office vacates every lower office the winner already held —
     kills the multi-salary bug (sam-ritter drew president + chair + congress
     pay on the tick-742 payday). Vacated seats flow through Phase 14's
     existing vacancy auto-fill on the next tick (congress: reputation-rank
     fill; president: re-election trigger) — this helper only marks them
     inactive, it never appoints a replacement itself. */
  const seatIdsToVacate = getSeatsToVacate(winnerPriorPositions, election.positionType);
  if (seatIdsToVacate.length > 0) {
    await db
      .update(positions)
      .set({ isActive: false, endDate: now })
      .where(inArray(positions.id, seatIdsToVacate));

    const vacatedTypes = winnerPriorPositions
      .filter((p) => seatIdsToVacate.includes(p.id))
      .map((p) => p.type);

    await db.insert(activityEvents).values({
      type: 'position_vacated',
      agentId: winner.agentId,
      title: 'Lower office vacated',
      description: `${winnerName} vacated ${vacatedTypes.join(', ')} upon winning ${election.positionType}`,
      metadata: JSON.stringify({ electionId, vacatedTypes, vacatedPositionIds: seatIdsToVacate, newPositionType: election.positionType }),
    });

    broadcast('position:vacated', {
      agentId: winner.agentId,
      agentName: winnerName,
      vacatedTypes,
      newPositionType: election.positionType,
    });

    console.warn(
      `[FINALIZE] ${winnerName} vacated ${vacatedTypes.join(', ')} upon winning ${election.positionType} (double-position fix)`,
    );
  }

  /* Winner reputation bump. No cash bonus — the office salary is the reward. */
  await db
    .update(agents)
    .set({
      reputation: sql`${agents.reputation} + 200`,
    })
    .where(eq(agents.id, winner.agentId));

  /* Activity event */
  await db.insert(activityEvents).values({
    type: 'election_completed',
    agentId: winner.agentId,
    title: 'Election completed',
    description: `${winnerName} has won the ${election.positionType} election`,
    metadata: JSON.stringify({
      electionId,
      positionType: election.positionType,
      winnerId: winner.agentId,
      totalVotes: tally.totalVotes,
      usedFallback: tally.usedFallback,
      winnerContributions: Number(winner.totalContributions ?? 0),
    }),
  });

  broadcast('election:completed', {
    electionId,
    positionType: election.positionType,
    winnerId: winner.agentId,
    winnerName,
    positionTitle,
  });

  console.warn(
    `[FINALIZE] ${winnerName} won the ${election.positionType} election (election ${electionId})`,
  );

  /* Approval: winner — margin-scaled */
  const winApprovalDelta = Math.round(15 * victoryMarginFactor);
  await updateApproval(
    winner.agentId,
    winApprovalDelta,
    'election_won',
    `Won the ${election.positionType} election (margin factor ${victoryMarginFactor.toFixed(2)})`,
  );

  /* Approval: losers — scaled by how badly they lost */
  const loserIds: string[] = [];
  for (const candidate of campaignTotals) {
    if (candidate.agentId === winner.agentId) continue;
    loserIds.push(candidate.agentId);
    const loserContributions = Number(candidate.totalContributions ?? 0);
    const loserShare = totalContributions > 0 ? loserContributions / totalContributions : 0;
    const lossApprovalDelta = -Math.round(15 * (1 - loserShare * candidateCount));
    await updateApproval(
      candidate.agentId,
      Math.max(-25, lossApprovalDelta),
      'election_lost',
      `Lost the ${election.positionType} election (share ${loserShare.toFixed(2)})`,
    );
  }

  /* Post-election feedback cascade */
  if (rc.electionPostOutcomeCascade ?? true) {
    /* Winner personality mod */
    await db.update(agents)
      .set({
        personalityMod: 'riding a wave of electoral confidence, emboldened to push their agenda',
        personalityModAt: now,
      })
      .where(eq(agents.id, winner.agentId));

    /* Loser personality mods */
    for (const loserId of loserIds) {
      await db.update(agents)
        .set({
          personalityMod: 'reeling from an electoral defeat, recalibrating their platform',
          personalityModAt: now,
        })
        .where(eq(agents.id, loserId));
    }

    /* Competitors drift apart: losers reduce sentiment toward winner */
    for (const loserId of loserIds) {
      await db.insert(agentRelationships)
        .values({
          agentId: loserId,
          targetAgentId: winner.agentId,
          voteAlignment: 0.5,
          sentiment: 0.5,
          forumInteractions: 0,
        })
        .onConflictDoUpdate({
          target: [agentRelationships.agentId, agentRelationships.targetAgentId],
          set: {
            sentiment: sql`GREATEST(0.0, ${agentRelationships.sentiment} - 0.06)`,
            updatedAt: now,
          },
        });
    }
  }

  return {
    status: 'ok',
    electionId,
    winnerId: winner.agentId,
    winnerName,
    loserIds,
    totalVotes: tally.totalVotes,
    positionId: insertedPosition?.id,
  };
}
