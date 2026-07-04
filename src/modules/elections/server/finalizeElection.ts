/**
 * finalizeElection — shared helper used by both the organic Phase 14 tick
 * and the admin /advance endpoint. Tallies a president/congress/cabinet/etc
 * election, picks the winner by campaign contributions (current proxy for
 * votes — see docs/TODO.md election overhaul), inserts a positions row,
 * updates agent stats, runs the approval + relationship cascade, and
 * broadcasts activity events.
 *
 * NOTE on current "voting" model: there is no vote-casting phase today.
 * Winners are selected by `campaigns.contributions` as a placeholder.
 * When real vote casting lands, this helper is the single call site to
 * update — swap the tally source without touching the advance endpoint
 * or phase 14.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@db/connection';
import {
  agents,
  agentRelationships,
  activityEvents,
  elections,
  campaigns,
  positions,
} from '@db/schema/index';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import { broadcast } from '@core/server/websocket.js';
import { updateApproval } from '@core/server/jobs/agentTick.js';

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

  /* Tally campaign contributions per agent */
  const campaignTotals = await db
    .select({
      agentId: campaigns.agentId,
      totalContributions: sql<number>`sum(${campaigns.contributions})`,
    })
    .from(campaigns)
    .where(eq(campaigns.electionId, electionId))
    .groupBy(campaigns.agentId);

  if (campaignTotals.length === 0) {
    console.warn(`[FINALIZE] Election ${electionId} has no campaigns — nothing to finalize.`);
    return { status: 'no_campaigns', electionId };
  }

  /* Winner: highest contributions */
  const winner = campaignTotals.reduce((best, curr) =>
    Number(curr.totalContributions ?? 0) > Number(best.totalContributions ?? 0) ? curr : best,
  );

  const [winnerAgent] = await db
    .select({ id: agents.id, displayName: agents.displayName })
    .from(agents)
    .where(eq(agents.id, winner.agentId))
    .limit(1);
  const winnerName = winnerAgent?.displayName ?? 'Unknown';

  const positionTitle = POSITION_TITLE_BY_TYPE[election.positionType] ?? election.positionType;

  const totalContributions = campaignTotals.reduce(
    (sum, c) => sum + Number(c.totalContributions ?? 0),
    0,
  );
  const winnerContributions = Number(winner.totalContributions ?? 0);
  const candidateCount = campaignTotals.length;

  /* Victory margin factor: scales from ~0.5 (squeaker) to 1.5 (landslide) */
  const victoryMarginFactor = totalContributions > 0
    ? Math.min(1.5, (winnerContributions / totalContributions) * candidateCount)
    : 1.0;

  /* Update election row: canonical terminal state is 'certified' — used by
     ai.ts context builders to detect sitting officeholders. certifiedDate is
     set so downstream reads (elections.ts) work consistently. */
  await db
    .update(elections)
    .set({
      status: 'certified',
      winnerId: winner.agentId,
      totalVotes: totalContributions,
      certifiedDate: now,
    })
    .where(eq(elections.id, electionId));

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
      totalContributions: winnerContributions,
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
    totalVotes: totalContributions,
    positionId: insertedPosition?.id,
  };
}
