/**
 * benchmarkRunner.ts -- Benchmark run execution engine
 *
 * Loads a scenario from the DB, creates a BenchmarkWorldState, runs
 * a simplified governance tick loop, computes metrics, and persists
 * the final BenchmarkReport.
 *
 * Supports both internal (ai.ts) and external (HTTP) model backends.
 * Uses seeded PRNG for fully reproducible runs.
 */

import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../../../core/db/connection';
import { benchmarkScenarios, benchmarkRuns } from '../../../../core/db/schema/index';
import { broadcast } from '../../../../core/server/websocket.js';
import { generateAgentDecision } from '../../../../core/server/services/ai.js';
import type { AgentRecord, AgentDecision } from '../../../../core/server/services/ai.js';
import {
  BenchmarkWorldState,
} from './benchmarkWorldState.js';
import type { ScenarioConfig, ScenarioWorldConfig, ScenarioAgentConfig, ScenarioMetricsConfig, BenchmarkEvent } from './benchmarkWorldState.js';
import {
  createSeededRandom,
  selectAgentsForPhase,
  calculateVetoProbability,
  tallyVotes,
  determineBillOutcome,
  determineOverrideOutcome,
  determineJudicialOutcome,
  calculateTax,
  positionSalary,
  calculateInactivityDecay,
  parseVoteChoice,
  shouldFollowWhip,
} from '../../../../core/server/services/simulationCore.js';
import {
  computeAllOutcomeMetrics,
  computeAllAgentMetrics,
  computeAllCoordinationMetrics,
  computeComposite,
  compositeToGrade,
} from './benchmarkMetrics.js';
import type { BenchmarkReport } from './benchmarkMetrics.js';
import { processTickEvents } from './benchmarkEventProcessor.js';
import { GOVERNMENT, GOVERNANCE_PROBABILITIES, WS_EVENTS } from '../../../../core/shared/constants';

// ============================================================
// TYPES
// ============================================================

export interface RunConfig {
  runId: string;
  scenarioId: string;
  modelName: string;
  modelBackend: 'internal' | 'external';
  modelEndpoint?: string;
  configHash: string;
  agentAssignment?: string; // 'all' or specific IDs
  callbackUrl?: string;
  triggeredBy: string;
}

// ============================================================
// HELPERS
// ============================================================

/** Convert a string to a stable 32-bit integer hash for PRNG seeding. */
function stringToSeed(str: string): number {
  const hash = crypto.createHash('sha256').update(str).digest();
  return hash.readUInt32BE(0);
}

/** Build a minimal AgentRecord for the AI service from a SimAgent. */
function simAgentToRecord(
  agentId: string,
  alignment: string,
  modelName: string,
): AgentRecord {
  return {
    id: agentId,
    displayName: `Benchmark Agent ${agentId}`,
    alignment,
    modelProvider: null, // internal routing handled by ai.ts
    personality: 'A benchmark agent in a governance simulation.',
    model: modelName,
  };
}

/** Call an external model endpoint with the same prompt format as generateAgentDecision. */
async function callExternalModel(
  endpoint: string,
  agentId: string,
  contextMessage: string,
  phase: string,
): Promise<AgentDecision> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, contextMessage, phase }),
  });
  if (!res.ok) {
    throw new Error(`External model error ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as AgentDecision;
  return {
    action: body.action ?? 'idle',
    reasoning: body.reasoning ?? '',
    data: body.data,
  };
}

// ============================================================
// BENCHMARK RUNNER
// ============================================================

export class BenchmarkRunner {
  private readonly cfg: RunConfig;
  private rng!: () => number;

  constructor(cfg: RunConfig) {
    this.cfg = cfg;
  }

  // ----------------------------------------------------------
  // Main entry point
  // ----------------------------------------------------------

  async execute(): Promise<void> {
    const startTime = Date.now();

    try {
      // 1. Load scenario from DB
      const [scenarioRow] = await db
        .select()
        .from(benchmarkScenarios)
        .where(eq(benchmarkScenarios.id, this.cfg.scenarioId))
        .limit(1);

      if (!scenarioRow) {
        throw new Error(`Scenario not found: ${this.cfg.scenarioId}`);
      }

      // 2. Build ScenarioConfig from DB row
      const scenarioConfig: ScenarioConfig = {
        id: scenarioRow.id,
        name: scenarioRow.name,
        runLength: scenarioRow.runLength,
        worldConfig: scenarioRow.worldConfig as ScenarioWorldConfig,
        agentConfig: scenarioRow.agentConfig as ScenarioAgentConfig,
        metricsConfig: (scenarioRow.metrics ?? { weights: { outcome: 0.4, agent: 0.35, coordination: 0.25 }, tracked: [] }) as ScenarioMetricsConfig,
        events: (scenarioRow.events ?? []) as BenchmarkEvent[],
      };

      // 3. Create world state
      const world = new BenchmarkWorldState(scenarioConfig);

      // 4. Seed the PRNG
      this.rng = createSeededRandom(stringToSeed(this.cfg.runId));

      // 5. Mark run as running
      await db
        .update(benchmarkRuns)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(benchmarkRuns.id, this.cfg.runId));

      // 6. Run tick loop
      for (let tick = 1; tick <= scenarioConfig.runLength; tick++) {
        world.startTick();
        await this.runTick(world, scenarioConfig);
        world.completeTick();

        // Update progress in DB
        await db
          .update(benchmarkRuns)
          .set({ ticksCompleted: tick })
          .where(eq(benchmarkRuns.id, this.cfg.runId));

        // Broadcast progress
        broadcast(WS_EVENTS.BENCHMARK_PROGRESS, {
          runId: this.cfg.runId,
          scenarioId: this.cfg.scenarioId,
          tick,
          totalTicks: scenarioConfig.runLength,
          percent: Math.round((tick / scenarioConfig.runLength) * 100),
        });
      }

      // 7. Compute metrics from world snapshot
      const snap = world.snapshot();
      const outcomeMetrics = computeAllOutcomeMetrics(
        snap.bills,
        snap.laws,
        snap.votes,
        snap.partyMemberships,
        snap.agents,
        snap.startTreasury,
        snap.endTreasury,
        snap.treasurySnapshots,
      );

      const agentMetrics = computeAllAgentMetrics(
        snap.decisions,
        snap.votes,
        outcomeMetrics.treasuryHealth,
        outcomeMetrics.vetoRate,
        outcomeMetrics.approvalInequality,
      );

      const coordMetrics = computeAllCoordinationMetrics(
        snap.whipEvents,
        snap.collaborations,
      );

      const weights = scenarioConfig.metricsConfig.weights;
      const composite = computeComposite(outcomeMetrics, agentMetrics, coordMetrics, weights);
      const grade = compositeToGrade(composite);

      const durationMs = Date.now() - startTime;
      const durationStr = durationMs < 60_000
        ? `${(durationMs / 1000).toFixed(1)}s`
        : `${(durationMs / 60_000).toFixed(1)}m`;

      const report: BenchmarkReport = {
        scenarioId: this.cfg.scenarioId,
        runId: this.cfg.runId,
        modelName: this.cfg.modelName,
        modelBackend: this.cfg.modelBackend,
        configHash: this.cfg.configHash,
        ticksCompleted: snap.ticksCompleted,
        duration: durationStr,
        outcome: outcomeMetrics,
        agent: agentMetrics,
        coordination: coordMetrics,
        composite,
        grade,
      };

      // 8. Save report to DB
      await db
        .update(benchmarkRuns)
        .set({
          status: 'completed',
          completedAt: new Date(),
          metricsReport: report,
          rawData: snap,
        })
        .where(eq(benchmarkRuns.id, this.cfg.runId));

      // 9. Broadcast completion
      broadcast(WS_EVENTS.BENCHMARK_PROGRESS, {
        runId: this.cfg.runId,
        scenarioId: this.cfg.scenarioId,
        tick: scenarioConfig.runLength,
        totalTicks: scenarioConfig.runLength,
        percent: 100,
        status: 'completed',
        grade,
        composite,
      });

      // 10. Fire callback if configured (fire-and-forget)
      if (this.cfg.callbackUrl) {
        fetch(this.cfg.callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
        }).catch((err) => {
          console.error(`[BenchmarkRunner] Callback POST failed: ${err.message}`);
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[BenchmarkRunner] Run ${this.cfg.runId} failed:`, errorMsg);

      await db
        .update(benchmarkRuns)
        .set({
          status: 'failed',
          completedAt: new Date(),
          error: errorMsg,
        })
        .where(eq(benchmarkRuns.id, this.cfg.runId))
        .catch(() => { /* non-fatal */ });

      broadcast(WS_EVENTS.BENCHMARK_PROGRESS, {
        runId: this.cfg.runId,
        scenarioId: this.cfg.scenarioId,
        status: 'failed',
        error: errorMsg,
      });
    }
  }

  // ----------------------------------------------------------
  // Tick execution — runs all governance phases sequentially
  // ----------------------------------------------------------

  private async runTick(world: BenchmarkWorldState, scenario: ScenarioConfig): Promise<void> {
    const tick = world.currentTick;
    const probs = scenario.worldConfig.probabilities;
    const congressMembers = world.getCongressMembers();
    const congressIds = congressMembers.map((a) => a.id);
    const allAgentIds = world.agents.map((a) => a.id);

    // Process scripted events for this tick (mutations + observation context)
    const eventContext = processTickEvents(world);

    // Derive a per-tick seed so each tick is independently reproducible
    const tickSeed = stringToSeed(`${this.cfg.runId}-tick-${tick}`);

    // a. Bill Proposal Phase
    await this.phaseBillProposal(world, congressIds, probs.billProposal, tickSeed, eventContext);

    // b. Whip Signal Phase
    await this.phaseWhipSignal(world, allAgentIds, probs.whipSignal, tickSeed + 1, eventContext);

    // c. Committee Review Phase
    await this.phaseCommitteeReview(world, tickSeed + 2, eventContext);

    // d. Floor Voting Phase
    await this.phaseFloorVoting(world, congressMembers, tickSeed + 3, eventContext);

    // e. Presidential Review Phase
    await this.phasePresidentialReview(world, tickSeed + 4);

    // f. Veto Override Phase
    await this.phaseVetoOverride(world, congressMembers, tickSeed + 5);

    // g. Judicial Review Phase
    await this.phaseJudicialReview(world, tickSeed + 6, eventContext);

    // h. Economy Phase
    this.phaseEconomy(world);

    // i. Approval Decay Phase
    this.phaseApprovalDecay(world);
  }

  // ----------------------------------------------------------
  // Phase implementations
  // ----------------------------------------------------------

  /** a. Bill Proposal Phase */
  private async phaseBillProposal(
    world: BenchmarkWorldState,
    congressIds: string[],
    probability: number,
    seed: number,
    eventContext: string = '',
  ): Promise<void> {
    const selected = selectAgentsForPhase(congressIds, probability, 3, seed);

    for (const agentId of selected) {
      const agent = world.agents.find((a) => a.id === agentId);
      if (!agent) continue;

      const contextMessage =
        eventContext +
        `You are a member of congress in tick ${world.currentTick}. ` +
        `Treasury: ${world.treasury}. Tax rate: ${world.taxRate}%. ` +
        `Propose a new bill if you believe legislation is needed. ` +
        `Respond with JSON: { "action": "propose", "reasoning": "...", "data": { "title": "...", "summary": "..." } }`;

      const decision = await this.callAgent(agentId, agent.alignment, contextMessage, 'bill_proposal');

      if (decision.action === 'propose') {
        const billId = `bill-${this.cfg.runId}-${world.currentTick}-${agentId}`;
        world.addBill({
          id: billId,
          status: 'proposed',
          sponsorId: agentId,
          proposedAtTick: world.currentTick,
        });
      }

      world.addDecision({
        agentId,
        parsedAction: decision.action,
        parsedReasoning: decision.reasoning,
        success: decision.action !== 'idle',
        latencyMs: 0, // overwritten by callAgent
      });
    }
  }

  /** b. Whip Signal Phase */
  private async phaseWhipSignal(
    world: BenchmarkWorldState,
    allAgentIds: string[],
    probability: number,
    seed: number,
    eventContext: string = '',
  ): Promise<void> {
    const selected = selectAgentsForPhase(allAgentIds, probability, 2, seed);

    for (const agentId of selected) {
      const agent = world.agents.find((a) => a.id === agentId);
      if (!agent) continue;

      const contextMessage =
        eventContext +
        `You are a party whip in tick ${world.currentTick}. ` +
        `Active bills: ${world.getBillsByStatus('proposed').length + world.getBillsByStatus('committee').length}. ` +
        `Issue a whip signal to your party members. ` +
        `Respond with JSON: { "action": "whip_signal", "reasoning": "...", "data": { "direction": "yea" | "nay" } }`;

      const decision = await this.callAgent(agentId, agent.alignment, contextMessage, 'whip_signal');

      const followed = shouldFollowWhip(GOVERNANCE_PROBABILITIES.PARTY_WHIP_FOLLOW_RATE, this.rng());
      world.addWhipEvent({ agentId, followed });

      world.addDecision({
        agentId,
        parsedAction: decision.action,
        parsedReasoning: decision.reasoning,
        success: decision.action !== 'idle',
        latencyMs: 0,
      });
    }
  }

  /** c. Committee Review Phase */
  private async phaseCommitteeReview(
    world: BenchmarkWorldState,
    seed: number,
    eventContext: string = '',
  ): Promise<void> {
    const proposedBills = world.getBillsByStatus('proposed');
    if (proposedBills.length === 0) return;

    // Pick a committee chair (first congress member as simplified chair)
    const congress = world.getCongressMembers();
    if (congress.length === 0) return;
    const chair = congress[0];

    for (const bill of proposedBills) {
      world.updateBillStatus(bill.id, 'committee');

      const contextMessage =
        eventContext +
        `You are committee chair reviewing bill "${bill.id}" sponsored by ${bill.sponsorId}. ` +
        `Decide whether to advance this bill to the floor or table it. ` +
        `Respond with JSON: { "action": "committee_review", "reasoning": "...", "data": { "decision": "advance" | "table" } }`;

      const decision = await this.callAgent(chair.id, chair.alignment, contextMessage, 'committee_review');
      const tableRng = createSeededRandom(seed + proposedBills.indexOf(bill));

      const shouldTable =
        decision.data?.['decision'] === 'table' ||
        tableRng() < GOVERNANCE_PROBABILITIES.COMMITTEE_TABLE_RATE_NEUTRAL;

      if (shouldTable) {
        world.updateBillStatus(bill.id, 'tabled');
      }
      // Bills not tabled remain in 'committee' status, ready for floor

      world.addDecision({
        agentId: chair.id,
        parsedAction: decision.action,
        parsedReasoning: decision.reasoning,
        success: true,
        latencyMs: 0,
      });
    }
  }

  /** d. Floor Voting Phase */
  private async phaseFloorVoting(
    world: BenchmarkWorldState,
    congressMembers: { id: string; alignment: string }[],
    _seed: number,
    eventContext: string = '',
  ): Promise<void> {
    const committeeBills = world.getBillsByStatus('committee');
    if (committeeBills.length === 0) return;

    for (const bill of committeeBills) {
      world.updateBillStatus(bill.id, 'floor');

      const choices: string[] = [];
      for (const member of congressMembers) {
        const contextMessage =
          eventContext +
          `You are voting on bill "${bill.id}" in tick ${world.currentTick}. ` +
          `Cast your vote as yea or nay. ` +
          `Respond with JSON: { "action": "vote", "reasoning": "...", "data": { "choice": "yea" | "nay" } }`;

        const decision = await this.callAgent(member.id, member.alignment, contextMessage, 'bill_voting');
        const choice = parseVoteChoice(String(decision.data?.['choice'] ?? decision.action ?? 'nay'));

        choices.push(choice);
        world.addVote({ voterId: member.id, billId: bill.id, choice });

        world.addDecision({
          agentId: member.id,
          parsedAction: decision.action,
          parsedReasoning: decision.reasoning,
          success: decision.action !== 'idle',
          latencyMs: 0,
        });
      }

      const tally = tallyVotes(choices);
      const outcome = determineBillOutcome(tally, GOVERNMENT.LEGISLATIVE.PASSAGE_PERCENTAGE);

      if (outcome === 'passed') {
        world.updateBillStatus(bill.id, 'passed');
      } else {
        world.updateBillStatus(bill.id, 'vetoed'); // failed at floor
      }
    }
  }

  /** e. Presidential Review Phase */
  private async phasePresidentialReview(
    world: BenchmarkWorldState,
    seed: number,
  ): Promise<void> {
    const passedBills = world.getBillsByStatus('passed');
    if (passedBills.length === 0) return;

    const president = world.getPresident();
    if (!president) {
      // No president -- auto-sign
      for (const bill of passedBills) {
        world.updateBillStatus(bill.id, 'law');
        world.addLaw({ id: `law-${bill.id}`, billId: bill.id, enactedAtTick: world.currentTick });
      }
      return;
    }

    const vetoRng = createSeededRandom(seed);

    for (const bill of passedBills) {
      const sponsor = world.agents.find((a) => a.id === bill.sponsorId);
      const vetoProbability = calculateVetoProbability(
        president.alignment,
        sponsor?.alignment ?? null,
      );

      if (vetoRng() < vetoProbability) {
        world.updateBillStatus(bill.id, 'presidential_veto');
        world.updateApproval(president.id, -2, 'veto');
      } else {
        world.updateBillStatus(bill.id, 'law');
        world.addLaw({ id: `law-${bill.id}`, billId: bill.id, enactedAtTick: world.currentTick });
        world.updateApproval(president.id, 1, 'sign');
      }
    }
  }

  /** f. Veto Override Phase */
  private async phaseVetoOverride(
    world: BenchmarkWorldState,
    congressMembers: { id: string; alignment: string }[],
    seed: number,
  ): Promise<void> {
    const vetoedBills = world.getBillsByStatus('presidential_veto');
    if (vetoedBills.length === 0) return;

    const overrideRng = createSeededRandom(seed);

    for (const bill of vetoedBills) {
      // Congress votes to override
      let overrideYea = 0;
      let totalOverrideVotes = 0;

      for (const member of congressMembers) {
        totalOverrideVotes++;
        // Use seeded RNG + party alignment to determine override vote
        const sameParty = world.getAgentParty(member.id) === world.getAgentParty(bill.sponsorId);
        const baseYea = sameParty ? 0.7 : 0.3;
        if (overrideRng() < baseYea) {
          overrideYea++;
          world.addVote({ voterId: member.id, billId: bill.id, choice: 'yea' });
        } else {
          world.addVote({ voterId: member.id, billId: bill.id, choice: 'nay' });
        }
      }

      const overrideResult = determineOverrideOutcome(
        overrideYea,
        totalOverrideVotes,
        GOVERNMENT.LEGISLATIVE.SUPERMAJORITY_PERCENTAGE,
      );

      if (overrideResult === 'overridden') {
        world.updateBillStatus(bill.id, 'law');
        world.addLaw({ id: `law-${bill.id}`, billId: bill.id, enactedAtTick: world.currentTick });
      } else {
        world.updateBillStatus(bill.id, 'vetoed');
      }
    }
  }

  /** g. Judicial Review Phase */
  private async phaseJudicialReview(
    world: BenchmarkWorldState,
    seed: number,
    eventContext: string = '',
  ): Promise<void> {
    const justices = world.getJustices();
    if (justices.length === 0) return;

    const reviewRng = createSeededRandom(seed);

    // Only review laws enacted this tick
    const newLaws = world.laws.filter((l) => l.enactedAtTick === world.currentTick);

    for (const law of newLaws) {
      // Probabilistic challenge
      if (reviewRng() >= GOVERNANCE_PROBABILITIES.JUDICIAL_CHALLENGE_RATE_PER_LAW) continue;

      let constitutionalVotes = 0;
      let unconstitutionalVotes = 0;

      for (const justice of justices) {
        const contextMessage =
          eventContext +
          `You are a Supreme Court justice reviewing law "${law.id}" for constitutionality. ` +
          `Respond with JSON: { "action": "judicial_vote", "reasoning": "...", "data": { "ruling": "constitutional" | "unconstitutional" } }`;

        const decision = await this.callAgent(justice.id, justice.alignment, contextMessage, 'judicial_review');

        if (decision.data?.['ruling'] === 'unconstitutional') {
          unconstitutionalVotes++;
        } else {
          constitutionalVotes++;
        }

        world.addDecision({
          agentId: justice.id,
          parsedAction: decision.action,
          parsedReasoning: decision.reasoning,
          success: decision.action !== 'idle',
          latencyMs: 0,
        });
      }

      const judicialResult = determineJudicialOutcome(constitutionalVotes, unconstitutionalVotes);

      if (judicialResult === 'struck_down') {
        // Find the bill and mark it struck down
        const bill = world.bills.find((b) => b.id === law.billId);
        if (bill) {
          world.updateBillStatus(bill.id, 'vetoed');
        }
      }
    }
  }

  /** h. Economy Phase */
  private phaseEconomy(world: BenchmarkWorldState): void {
    // Collect tax from treasury (simulating economic activity)
    const taxRevenue = calculateTax(world.treasury, world.taxRate);
    world.updateTreasury(taxRevenue);

    // Pay salaries to all position holders
    let totalSalaries = 0;
    for (const pos of world.positions) {
      if (pos.isActive) {
        totalSalaries += positionSalary(pos.type);
      }
    }
    world.updateTreasury(-totalSalaries);
  }

  /** i. Approval Decay Phase */
  private phaseApprovalDecay(world: BenchmarkWorldState): void {
    const baseline = 50;
    const decayRate = 0.02;

    for (const agent of world.agents) {
      const delta = calculateInactivityDecay(agent.approvalRating, baseline, decayRate);
      if (delta !== 0) {
        world.updateApproval(agent.id, delta, 'decay');
      }
    }
  }

  // ----------------------------------------------------------
  // Agent call dispatcher
  // ----------------------------------------------------------

  /**
   * Calls the AI model (internal or external) and returns the decision.
   * Records timing and handles errors gracefully.
   */
  private async callAgent(
    agentId: string,
    alignment: string,
    contextMessage: string,
    phase: string,
  ): Promise<AgentDecision> {
    try {
      let decision: AgentDecision;

      if (this.cfg.modelBackend === 'external' && this.cfg.modelEndpoint) {
        decision = await callExternalModel(this.cfg.modelEndpoint, agentId, contextMessage, phase);
      } else {
        const agentRecord = simAgentToRecord(agentId, alignment, this.cfg.modelName);
        decision = await generateAgentDecision(agentRecord, contextMessage, phase);
      }

      return decision;
    } catch (err) {
      console.error(`[BenchmarkRunner] Agent ${agentId} call failed:`, err instanceof Error ? err.message : err);
      return { action: 'idle', reasoning: 'agent call failed' };
    }
  }
}
