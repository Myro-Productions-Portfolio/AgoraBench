/**
 * Nominate + confirm appointments (office-selection fidelity, Slice 3).
 *
 * The faithful mechanic for cabinet secretaries and all justices: the sitting
 * president NOMINATES a candidate (a real LLM decision, logged like any other),
 * then the Legislature CONFIRMS by majority vote (advice and consent). The
 * confirmation tally reuses the pure Phase-1.7 weighted-alignment arithmetic
 * (tallyWeightedRatification) — each seated member's vote-alignment toward the
 * nominee is their probabilistic yes/no, unaltered. No president → no
 * nomination, seat stays vacant (faithful; today's engine auto-fill silently
 * violated this). Rejected nominee → seat stays open, president renominates
 * next cycle.
 *
 * This module is only ever reached when RuntimeConfig.appointmentConfirmationEnabled
 * is true; at default config it is dead code (dark).
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@db/connection';
import { agents, agentRelationships, positions, activityEvents } from '@db/schema/index';
import { tallyWeightedRatification } from '@core/server/lib/committeeAssignment.js';
import { generateAgentDecision, type AgentRecord } from '@core/server/services/ai.js';
import { broadcast } from '@core/server/websocket.js';

export interface AppointmentResult {
  status: 'seated' | 'rejected' | 'no_nominee' | 'no_president' | 'no_candidates';
  positionType: string;
  nomineeId?: string;
  nomineeName?: string;
  votesFor?: number;
  votesAgainst?: number;
}

export interface AppointmentContext {
  /** The office being filled (e.g. 'supreme_justice', 'cabinet_secretary'). */
  positionType: string;
  /** positions.title for the seat (e.g. 'Supreme Court Justice'). */
  title: string;
  /** Human phrase for the nomination prompt (e.g. 'Supreme Court Justice'). */
  officeLabel: string;
  /** The sitting president as an AgentRecord for the nomination LLM call. */
  president: AgentRecord;
  /** Eligible candidate agents (not already holding a position of this office). */
  candidates: { id: string; displayName: string; alignment: string | null }[];
  /** Seated Legislature voters whose alignment toward the nominee confirms. */
  confirmVoterIds: string[];
  /** Confirmation pass threshold (share of weighted alignment; 0.5 = majority). */
  confirmThreshold: number;
  /** Optional extra prompt context (e.g. which cabinet role). */
  seatDescriptor?: string;
}

/**
 * Run one nominate → confirm cycle for a single vacant seat. Returns the
 * outcome; the caller decides whether to loop for more vacancies. Seats the
 * nominee (inserts the positions row + activity event) only on a confirmed
 * majority. All failure modes (no president, no candidates, president declines,
 * Legislature rejects) leave the seat vacant — faithfully.
 */
export async function runAppointment(ctx: AppointmentContext): Promise<AppointmentResult> {
  if (ctx.candidates.length === 0) {
    return { status: 'no_candidates', positionType: ctx.positionType };
  }

  /* ---- Nomination: the president names a candidate ---- */
  const roster = ctx.candidates
    .map((c) => `${c.displayName} (${c.alignment ?? 'unaligned'}) [id:${c.id}]`)
    .join('; ');
  const seatNote = ctx.seatDescriptor ? `${ctx.seatDescriptor} ` : '';
  const nominateInstruction =
    `Respond with exactly this JSON: {"action":"nominate","reasoning":"1-2 sentences","data":{"nomineeId":"<agent id>"}} ` +
    `You are President ${ctx.president.displayName}. Nominate one candidate for the vacant ${ctx.officeLabel} seat. ${seatNote}` +
    `Choose the nomineeId from exactly this list: ${roster}`;

  let decision;
  try {
    decision = await generateAgentDecision(ctx.president, nominateInstruction, 'nominate');
  } catch (err) {
    console.warn(`[APPOINT] ${ctx.positionType} nomination LLM call rejected — seat stays vacant:`, err);
    return { status: 'no_nominee', positionType: ctx.positionType };
  }

  const rawId = decision.action === 'nominate' && decision.data
    ? String(decision.data.nomineeId ?? '')
    : '';
  const nominee = ctx.candidates.find((c) => c.id === rawId);
  if (!nominee) {
    console.warn(`[APPOINT] ${ctx.positionType}: president named no valid candidate (raw '${rawId}') — seat stays vacant.`);
    return { status: 'no_nominee', positionType: ctx.positionType };
  }

  /* ---- Confirmation: the Legislature votes (weighted alignment) ---- */
  let alignments: number[] = [];
  if (ctx.confirmVoterIds.length > 0) {
    const relRows = await db
      .select({ agentId: agentRelationships.agentId, voteAlignment: agentRelationships.voteAlignment })
      .from(agentRelationships)
      .where(and(
        inArray(agentRelationships.agentId, ctx.confirmVoterIds),
        eq(agentRelationships.targetAgentId, nominee.id),
      ));
    const alignByVoter = new Map(relRows.map((r) => [r.agentId, r.voteAlignment]));
    /* A voter with no relationship row toward the nominee contributes the
       neutral 0.5 default (the same default agent_relationships seeds), so an
       unknown-to-them nominee is a coin-flip, not an automatic no. */
    alignments = ctx.confirmVoterIds.map((id) => alignByVoter.get(id) ?? 0.5);
  }

  const tally = tallyWeightedRatification(alignments, ctx.confirmThreshold);
  if (!tally.passed) {
    await db.insert(activityEvents).values({
      type: 'nomination_rejected',
      agentId: nominee.id,
      title: `${nominee.displayName} not confirmed for ${ctx.officeLabel}`,
      description: `The Legislature declined to confirm ${nominee.displayName} as ${ctx.officeLabel} (${tally.votesFor.toFixed(1)} for, ${tally.votesAgainst.toFixed(1)} against).`,
      metadata: JSON.stringify({ positionType: ctx.positionType, nomineeId: nominee.id, votesFor: tally.votesFor, votesAgainst: tally.votesAgainst }),
    });
    console.warn(`[APPOINT] ${ctx.positionType}: ${nominee.displayName} rejected (${tally.votesFor.toFixed(1)}-${tally.votesAgainst.toFixed(1)}) — seat stays vacant.`);
    return { status: 'rejected', positionType: ctx.positionType, nomineeId: nominee.id, nomineeName: nominee.displayName, votesFor: tally.votesFor, votesAgainst: tally.votesAgainst };
  }

  /* ---- Seat the confirmed nominee ---- */
  await db.insert(positions).values({
    agentId: nominee.id,
    type: ctx.positionType,
    title: ctx.title,
    startDate: new Date(),
    isActive: true,
  });
  await db.insert(activityEvents).values({
    type: 'appointment_confirmed',
    agentId: nominee.id,
    title: `${nominee.displayName} confirmed as ${ctx.officeLabel}`,
    description: `Nominated by President ${ctx.president.displayName} and confirmed by the Legislature (${tally.votesFor.toFixed(1)} for, ${tally.votesAgainst.toFixed(1)} against).`,
    metadata: JSON.stringify({ positionType: ctx.positionType, nomineeId: nominee.id, presidentId: ctx.president.id, votesFor: tally.votesFor, votesAgainst: tally.votesAgainst, seatDescriptor: ctx.seatDescriptor ?? null }),
  });
  broadcast('government:appointment_confirmed', { agentId: nominee.id, agentName: nominee.displayName, positionType: ctx.positionType });
  console.warn(`[APPOINT] ${ctx.positionType}: ${nominee.displayName} confirmed (${tally.votesFor.toFixed(1)}-${tally.votesAgainst.toFixed(1)}).`);
  return { status: 'seated', positionType: ctx.positionType, nomineeId: nominee.id, nomineeName: nominee.displayName, votesFor: tally.votesFor, votesAgainst: tally.votesAgainst };
}

/** Resolve the sitting president as an AgentRecord, or null if the seat is vacant. */
export async function getSittingPresident(providerOverride: string): Promise<AgentRecord | null> {
  const [row] = await db
    .select({
      id: agents.id,
      displayName: agents.displayName,
      alignment: agents.alignment,
      modelProvider: agents.modelProvider,
      personality: agents.personality,
      model: agents.model,
      ownerUserId: agents.ownerUserId,
    })
    .from(positions)
    .innerJoin(agents, eq(positions.agentId, agents.id))
    .where(and(eq(positions.isActive, true), eq(positions.type, 'president')))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.displayName,
    alignment: row.alignment,
    modelProvider: providerOverride === 'default' ? row.modelProvider : providerOverride,
    personality: row.personality,
    model: row.model,
    ownerUserId: row.ownerUserId,
  };
}
