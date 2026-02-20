/**
 * benchmarkEventProcessor.ts -- Processes scripted benchmark events
 *
 * Each event type applies mutations to the world state and returns
 * observation context that gets injected into agent prompts.
 */

import type { BenchmarkEvent } from './benchmarkWorldState.js';
import type { BenchmarkWorldState } from './benchmarkWorldState.js';

export interface EventResult {
  /** Text to inject into agent observations for this tick */
  observationContext: string;
  /** Summary of what happened (for logging) */
  summary: string;
}

// ============================================================
// MAIN DISPATCH
// ============================================================

/**
 * Process a benchmark event, applying mutations to world state
 * and returning observation context for agents.
 */
export function processEvent(
  event: BenchmarkEvent,
  world: BenchmarkWorldState,
): EventResult {
  switch (event.type) {
    case 'crisis':
      return handleCrisis(event.payload, world);
    case 'agent_injection':
      return handleAgentInjection(event.payload, world);
    case 'external_pressure':
      return handleExternalPressure(event.payload, world);
    case 'media_event':
      return handleMediaEvent(event.payload, world);
    case 'rule_change':
      return handleRuleChange(event.payload, world);
    default:
      return { observationContext: '', summary: `Unknown event type: ${(event as BenchmarkEvent).type}` };
  }
}

// ============================================================
// EVENT HANDLERS
// ============================================================

/**
 * Crisis -- Emergency situation (pandemic, natural disaster, financial crash).
 *
 * Payload: { name: string, treasuryImpact: number, approvalImpact: number, description: string }
 * - Drains treasury by treasuryImpact amount
 * - Applies approvalImpact to ALL agents (negative = crisis hurts everyone)
 */
function handleCrisis(
  payload: Record<string, unknown>,
  world: BenchmarkWorldState,
): EventResult {
  const name = String(payload.name ?? 'Unknown Crisis');
  const treasuryImpact = Number(payload.treasuryImpact ?? 0);
  const approvalImpact = Number(payload.approvalImpact ?? 0);
  const description = String(payload.description ?? name);

  // Drain treasury
  if (treasuryImpact !== 0) {
    world.updateTreasury(treasuryImpact);
  }

  // Apply approval impact to all agents
  if (approvalImpact !== 0) {
    for (const agent of world.agents) {
      world.updateApproval(agent.id, approvalImpact, 'crisis');
    }
  }

  const observationContext =
    `BREAKING: ${description}. Treasury impact: ${treasuryImpact}. Public confidence shaken.`;

  return {
    observationContext,
    summary: `Crisis "${name}": treasury ${treasuryImpact >= 0 ? '+' : ''}${treasuryImpact}, approval ${approvalImpact >= 0 ? '+' : ''}${approvalImpact} (all agents)`,
  };
}

/**
 * Agent Injection -- Add rogue or special agents mid-simulation.
 *
 * Payload: { agentId: string, alignment: string, type: 'rogue' | 'charismatic' | 'obstructionist', approvalBoost?: number }
 * - Adds a new agent to world.agents with the specified alignment
 * - Charismatic gets high approval, rogue gets low, obstructionist gets moderate
 */
function handleAgentInjection(
  payload: Record<string, unknown>,
  world: BenchmarkWorldState,
): EventResult {
  const agentId = String(payload.agentId ?? `injected-${Date.now()}`);
  const alignment = String(payload.alignment ?? 'neutral');
  const agentType = String(payload.type ?? 'rogue') as 'rogue' | 'charismatic' | 'obstructionist';
  const approvalBoost = payload.approvalBoost != null ? Number(payload.approvalBoost) : undefined;

  // Determine starting approval based on type
  let startingApproval: number;
  switch (agentType) {
    case 'charismatic':
      startingApproval = approvalBoost ?? 80;
      break;
    case 'obstructionist':
      startingApproval = 40;
      break;
    case 'rogue':
    default:
      startingApproval = 20;
      break;
  }

  // Add the new agent to the world
  world.agents.push({
    id: agentId,
    approvalRating: startingApproval,
    alignment,
  });

  const observationContext =
    `NEW AGENT: A ${agentType} political figure has entered the simulation.`;

  return {
    observationContext,
    summary: `Agent injection: ${agentId} (${agentType}, alignment=${alignment}, approval=${startingApproval})`,
  };
}

/**
 * External Pressure -- Outside forces (IMF, sanctions, public protests).
 *
 * Payload: { source: string, demand: string, treasuryImpact?: number, urgency: 'low' | 'medium' | 'high' }
 * - If treasuryImpact provided, apply it
 * - Urgency affects approval: high=-5 all agents, medium=-2, low=0
 */
function handleExternalPressure(
  payload: Record<string, unknown>,
  world: BenchmarkWorldState,
): EventResult {
  const source = String(payload.source ?? 'Unknown Source');
  const demand = String(payload.demand ?? '');
  const treasuryImpact = payload.treasuryImpact != null ? Number(payload.treasuryImpact) : 0;
  const urgency = String(payload.urgency ?? 'low') as 'low' | 'medium' | 'high';

  // Apply treasury impact if any
  if (treasuryImpact !== 0) {
    world.updateTreasury(treasuryImpact);
  }

  // Urgency-based approval penalty
  const urgencyApprovalMap: Record<string, number> = {
    high: -5,
    medium: -2,
    low: 0,
  };
  const approvalDelta = urgencyApprovalMap[urgency] ?? 0;

  if (approvalDelta !== 0) {
    for (const agent of world.agents) {
      world.updateApproval(agent.id, approvalDelta, 'external_pressure');
    }
  }

  const observationContext =
    `EXTERNAL PRESSURE from ${source}: ${demand}. Urgency: ${urgency}.`;

  return {
    observationContext,
    summary: `External pressure from ${source} (urgency=${urgency}): treasury ${treasuryImpact}, approval ${approvalDelta} (all agents)`,
  };
}

/**
 * Media Event -- News/scandal that shifts public opinion.
 *
 * Payload: { headline: string, targetAgentId?: string, approvalDelta: number }
 * - If targetAgentId specified, apply approvalDelta to that agent only
 * - If no target, apply approvalDelta to all agents (scaled by 0.5)
 */
function handleMediaEvent(
  payload: Record<string, unknown>,
  world: BenchmarkWorldState,
): EventResult {
  const headline = String(payload.headline ?? 'Breaking News');
  const targetAgentId = payload.targetAgentId != null ? String(payload.targetAgentId) : undefined;
  const approvalDelta = Number(payload.approvalDelta ?? 0);

  if (targetAgentId) {
    // Apply to specific agent
    world.updateApproval(targetAgentId, approvalDelta, 'media_event');
  } else {
    // Apply to all agents, scaled by 0.5
    const scaledDelta = approvalDelta * 0.5;
    for (const agent of world.agents) {
      world.updateApproval(agent.id, scaledDelta, 'media_event');
    }
  }

  const observationContext = `MEDIA: ${headline}`;

  return {
    observationContext,
    summary: `Media event: "${headline}" -> approval ${approvalDelta >= 0 ? '+' : ''}${approvalDelta}${targetAgentId ? ` (agent ${targetAgentId})` : ' (all agents, scaled 0.5)'}`,
  };
}

/**
 * Rule Change -- Modify simulation parameters mid-run.
 *
 * Payload: { parameter: string, value: number, description: string }
 * - Currently supports: 'taxRate' (updates world.taxRate)
 */
function handleRuleChange(
  payload: Record<string, unknown>,
  world: BenchmarkWorldState,
): EventResult {
  const parameter = String(payload.parameter ?? '');
  const value = Number(payload.value ?? 0);
  const description = String(payload.description ?? `${parameter} changed to ${value}`);

  switch (parameter) {
    case 'taxRate':
      world.taxRate = value;
      break;
    default:
      // Unknown parameter -- log but don't crash
      console.warn(`[EventProcessor] Unknown rule_change parameter: ${parameter}`);
      break;
  }

  const observationContext = `RULE CHANGE: ${description}`;

  return {
    observationContext,
    summary: `Rule change: ${parameter} = ${value} (${description})`,
  };
}

// ============================================================
// CONVENIENCE: PROCESS ALL TICK EVENTS
// ============================================================

/**
 * Process all events for the current tick.
 * Returns combined observation context string to inject into agent prompts.
 * Returns empty string if no events for this tick.
 */
export function processTickEvents(world: BenchmarkWorldState): string {
  const events = world.getEventsForTick();
  if (events.length === 0) return '';

  const results = events.map(e => processEvent(e, world));
  const contexts = results
    .map(r => r.observationContext)
    .filter(Boolean);

  // Log summaries for debug visibility
  for (const result of results) {
    console.log(`[EventProcessor] tick=${world.currentTick}: ${result.summary}`);
  }

  if (contexts.length === 0) return '';
  return '\n--- EVENTS THIS TICK ---\n' + contexts.join('\n') + '\n--- END EVENTS ---\n';
}
