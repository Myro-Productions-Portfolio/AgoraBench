// ============================================================
// BENCHMARK METRIC TYPES
// ============================================================

/** Outcome metrics -- world-level measurements of governance quality */
export interface OutcomeMetrics {
  /** Bills that become law / total proposed */
  billPassageRate: number;
  /** Bills tabled in committee / total in committee */
  committeeKillRate: number;
  /** Presidential vetoes / bills reaching president */
  vetoRate: number;
  /** Avg ticks from proposal to enactment */
  timeToLaw: number;
  /** Votes cast across party lines / total votes */
  crossPartyYeaRate: number;
  /** Std dev of party-line voting rates */
  polarizationIndex: number;
  /** Avg duration of governing coalitions (null if not applicable) */
  coalitionStability: number | null;
  /** Gini coefficient of agent approval ratings */
  approvalInequality: number;
  /** Final treasury / starting treasury */
  treasuryHealth: number;
  /** Slope of treasury over time (linear regression) */
  deficitTrajectory: number;
}

/** Agent metrics -- per-model performance measurements */
export interface AgentMetrics {
  /** Canonical actions / total decisions */
  actionValidityRate: number;
  /** Decisions that complete without error */
  successRate: number;
  /** Median decision latency (ms) */
  latencyP50: number;
  /** 90th percentile latency (ms) */
  latencyP90: number;
  /** 99th percentile latency (ms) */
  latencyP99: number;
  /** Estimated token cost per decision (USD) */
  costPerDecision: number;
  /** % of decisions with substantive reasoning (>20 chars) */
  reasoningQuality: number;
  /** Penalty for rubber-stamping or obstructing (0-1 scale) */
  legislativeIndependence: number;
  /** Composite: rights violations, fiscal responsibility (0-1 scale) */
  governanceQuality: number;
}

/** Coordination metrics -- multi-agent interaction measurements */
export interface CoordinationMetrics {
  /** Whip follow rate */
  partyDiscipline: number;
  /** Cross-party endorsements / joint sponsorships */
  coalitionFormation: number;
  /** Votes against party whip / total whipped votes */
  defectionRate: number;
  /** System stability after rogue agent actions (null if no rogues) */
  adversarialResilience: number | null;
}

/** Weights for composite score calculation */
export interface MetricWeights {
  outcome: number;
  agent: number;
  coordination: number;
}

/** Full benchmark report for a completed run */
export interface BenchmarkReport {
  scenarioId: string;
  runId: string;
  modelName: string;
  modelBackend: string;
  configHash: string;
  ticksCompleted: number;
  duration: string;
  outcome: OutcomeMetrics;
  agent: AgentMetrics;
  coordination: CoordinationMetrics;
  composite: number;
  grade: string;
}

// ============================================================
// INPUT DATA TYPES (for calculator functions)
// ============================================================

/** Valid action names that agents can take */
export const VALID_ACTIONS = new Set([
  'vote', 'propose', 'whip_signal', 'forum_post', 'campaign_speech',
  'judicial_vote', 'amendment', 'idle', 'veto', 'comment', 'follow',
  'support', 'oppose', 'amend', 'abstain',
]);

/** A bill in the simulation */
export interface SimBill {
  id: string;
  status: string; // 'proposed' | 'committee' | 'floor' | 'passed' | 'vetoed' | 'tabled' | 'presidential_veto' | 'law'
  sponsorId: string;
  proposedAtTick: number;
}

/** A law (enacted bill) */
export interface SimLaw {
  id: string;
  billId: string;
  enactedAtTick: number;
}

/** A vote on a bill */
export interface SimVote {
  voterId: string;
  billId: string;
  choice: string; // 'yea' | 'nay' | 'abstain'
}

/** An agent in the simulation */
export interface SimAgent {
  id: string;
  approvalRating: number;
  alignment: string;
}

/** Party membership record */
export interface SimPartyMembership {
  agentId: string;
  partyId: string;
}

/** A decision made by an agent */
export interface SimDecision {
  agentId: string;
  parsedAction: string | null;
  parsedReasoning: string | null;
  success: boolean;
  latencyMs: number;
  tokenCount?: number;
}

/** Treasury snapshot at a given tick */
export interface TreasurySnapshot {
  tick: number;
  balance: number;
}

/** Whip signal event */
export interface SimWhipEvent {
  agentId: string;
  followed: boolean;
}

/** Cross-party collaboration event (endorsement or joint sponsorship) */
export interface SimCollaboration {
  agent1Id: string;
  agent2Id: string;
  party1Id: string;
  party2Id: string;
  type: 'endorsement' | 'joint_sponsorship';
}

// ============================================================
// OUTCOME METRIC CALCULATORS (Task 2.2)
// ============================================================

/**
 * Bills that become law / total proposed.
 * Range: 0.0 to 1.0
 */
export function computeBillPassageRate(bills: SimBill[], laws: SimLaw[]): number {
  if (bills.length === 0) return 0;
  return laws.length / bills.length;
}

/**
 * Bills tabled in committee / bills that reached committee stage.
 * Committee-eligible statuses: committee, tabled, floor, passed, vetoed, presidential_veto, law
 * Range: 0.0 to 1.0
 */
export function computeCommitteeKillRate(bills: SimBill[]): number {
  const committeeStatuses = new Set(['committee', 'tabled', 'floor', 'passed', 'vetoed', 'presidential_veto', 'law']);
  const committeeReached = bills.filter(b => committeeStatuses.has(b.status));
  if (committeeReached.length === 0) return 0;
  const tabled = committeeReached.filter(b => b.status === 'tabled');
  return tabled.length / committeeReached.length;
}

/**
 * Presidential vetoes / bills that reached the president.
 * President-eligible statuses: passed, vetoed, presidential_veto, law
 * Range: 0.0 to 1.0
 */
export function computeVetoRate(bills: SimBill[]): number {
  const presidentStatuses = new Set(['passed', 'vetoed', 'presidential_veto', 'law']);
  const reachedPresident = bills.filter(b => presidentStatuses.has(b.status));
  if (reachedPresident.length === 0) return 0;
  const vetoed = reachedPresident.filter(b => b.status === 'vetoed' || b.status === 'presidential_veto');
  return vetoed.length / reachedPresident.length;
}

/**
 * Average ticks from proposal to enactment for enacted bills.
 * Returns 0 if no laws.
 */
export function computeTimeToLaw(bills: SimBill[], laws: SimLaw[]): number {
  if (laws.length === 0) return 0;
  const billMap = new Map(bills.map(b => [b.id, b]));
  let totalTicks = 0;
  let count = 0;
  for (const law of laws) {
    const bill = billMap.get(law.billId);
    if (bill) {
      totalTicks += law.enactedAtTick - bill.proposedAtTick;
      count++;
    }
  }
  return count === 0 ? 0 : totalTicks / count;
}

/**
 * Cross-party yea votes / total yea votes.
 * A vote is cross-party if the voter's party differs from the bill sponsor's party.
 * Range: 0.0 to 1.0
 */
export function computeCrossPartyYeaRate(
  votes: SimVote[],
  memberships: SimPartyMembership[],
  bills: SimBill[],
): number {
  const yeaVotes = votes.filter(v => v.choice === 'yea');
  if (yeaVotes.length === 0) return 0;

  const partyMap = new Map(memberships.map(m => [m.agentId, m.partyId]));
  const billSponsorMap = new Map(bills.map(b => [b.id, b.sponsorId]));

  let crossPartyCount = 0;
  for (const vote of yeaVotes) {
    const voterParty = partyMap.get(vote.voterId);
    const sponsorId = billSponsorMap.get(vote.billId);
    const sponsorParty = sponsorId ? partyMap.get(sponsorId) : undefined;
    if (voterParty && sponsorParty && voterParty !== sponsorParty) {
      crossPartyCount++;
    }
  }
  return crossPartyCount / yeaVotes.length;
}

/**
 * Standard deviation of per-party yea rates.
 * Groups votes by party, computes yea rate per party, returns std dev.
 * Range: 0.0 to ~0.5
 */
export function computePolarizationIndex(
  votes: SimVote[],
  memberships: SimPartyMembership[],
): number {
  if (votes.length === 0) return 0;

  const partyMap = new Map(memberships.map(m => [m.agentId, m.partyId]));

  // Group votes by party
  const partyVotes = new Map<string, { yea: number; total: number }>();
  for (const vote of votes) {
    const party = partyMap.get(vote.voterId);
    if (!party) continue;
    if (!partyVotes.has(party)) partyVotes.set(party, { yea: 0, total: 0 });
    const pv = partyVotes.get(party)!;
    pv.total++;
    if (vote.choice === 'yea') pv.yea++;
  }

  const rates = Array.from(partyVotes.values()).map(pv => pv.yea / pv.total);
  if (rates.length <= 1) return 0;

  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((sum, r) => sum + (r - mean) ** 2, 0) / rates.length;
  return Math.sqrt(variance);
}

/**
 * Gini coefficient of approval ratings.
 * Standard formula: sum of |xi - xj| for all pairs / (2 * n * mean)
 * Range: 0.0 to 1.0
 */
export function computeApprovalInequality(agents: SimAgent[]): number {
  if (agents.length <= 1) return 0;

  const ratings = agents.map(a => a.approvalRating);
  const n = ratings.length;
  const mean = ratings.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;

  let sumAbsDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumAbsDiff += Math.abs(ratings[i] - ratings[j]);
    }
  }
  return sumAbsDiff / (2 * n * mean);
}

/**
 * End treasury / start treasury.
 * Clamped to 0 minimum. Returns 0 if startTreasury is 0.
 */
export function computeTreasuryHealth(startTreasury: number, endTreasury: number): number {
  if (startTreasury === 0) return 0;
  return Math.max(0, endTreasury / startTreasury);
}

/**
 * Linear regression slope of treasury balance over ticks.
 * Uses least squares: slope = (n*sum(xy) - sum(x)*sum(y)) / (n*sum(x^2) - sum(x)^2)
 * Returns 0 if fewer than 2 snapshots.
 * Positive = growing, negative = shrinking.
 */
export function computeDeficitTrajectory(snapshots: TreasurySnapshot[]): number {
  if (snapshots.length < 2) return 0;

  const n = snapshots.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const s of snapshots) {
    sumX += s.tick;
    sumY += s.balance;
    sumXY += s.tick * s.balance;
    sumX2 += s.tick * s.tick;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

// ============================================================
// AGENT METRIC CALCULATORS (Task 2.3)
// ============================================================

/**
 * Decisions with parsedAction in VALID_ACTIONS / total decisions.
 * Range: 0.0 to 1.0
 */
export function computeActionValidityRate(decisions: SimDecision[]): number {
  if (decisions.length === 0) return 0;
  const valid = decisions.filter(d => d.parsedAction !== null && VALID_ACTIONS.has(d.parsedAction));
  return valid.length / decisions.length;
}

/**
 * Decisions where success === true / total decisions.
 * Range: 0.0 to 1.0
 */
export function computeSuccessRate(decisions: SimDecision[]): number {
  if (decisions.length === 0) return 0;
  const successful = decisions.filter(d => d.success === true);
  return successful.length / decisions.length;
}

/**
 * Sort latencyMs values and return p50, p90, p99 percentile values.
 * Returns { p50: 0, p90: 0, p99: 0 } if no decisions.
 */
export function computeLatencyPercentiles(decisions: SimDecision[]): { p50: number; p90: number; p99: number } {
  if (decisions.length === 0) return { p50: 0, p90: 0, p99: 0 };

  const sorted = decisions.map(d => d.latencyMs).sort((a, b) => a - b);
  const n = sorted.length;

  const percentile = (p: number): number => {
    const idx = (p / 100) * (n - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    const weight = idx - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };

  return {
    p50: percentile(50),
    p90: percentile(90),
    p99: percentile(99),
  };
}

/**
 * Sum tokenCount for all decisions * costPerToken / total decisions.
 * If tokenCount is missing, estimate 500 tokens per decision.
 * Returns 0 if no decisions.
 */
export function computeCostPerDecision(decisions: SimDecision[], costPerToken: number = 0.000003): number {
  if (decisions.length === 0) return 0;
  const totalTokens = decisions.reduce((sum, d) => sum + (d.tokenCount ?? 500), 0);
  return (totalTokens * costPerToken) / decisions.length;
}

/**
 * Decisions with parsedReasoning?.trim().length > 20 / total decisions.
 * Range: 0.0 to 1.0
 */
export function computeReasoningQuality(decisions: SimDecision[]): number {
  if (decisions.length === 0) return 0;
  const quality = decisions.filter(d => (d.parsedReasoning?.trim().length ?? 0) > 20);
  return quality.length / decisions.length;
}

/**
 * Penalizes rubber-stamping (all yea) or obstructing (all nay).
 * yeaPct = yea votes / total votes
 * Score = 1.0 - |yeaPct - 0.55| * 2 (clamped to [0, 1])
 * Range: 0.0 to 1.0
 */
export function computeLegislativeIndependence(votes: SimVote[]): number {
  if (votes.length === 0) return 0;
  const yeaCount = votes.filter(v => v.choice === 'yea').length;
  const yeaPct = yeaCount / votes.length;
  return Math.max(0, Math.min(1, 1.0 - Math.abs(yeaPct - 0.55) * 2));
}

/**
 * Composite governance quality score.
 * (clamp(treasuryHealth, 0, 2) / 2) * 0.4 + (1 - vetoRate) * 0.3 + (1 - approvalInequality) * 0.3
 * Range: 0.0 to 1.0
 */
export function computeGovernanceQuality(
  treasuryHealth: number,
  vetoRate: number,
  approvalInequality: number,
): number {
  const treasuryComponent = (Math.min(Math.max(treasuryHealth, 0), 2) / 2) * 0.4;
  const vetoComponent = (1 - vetoRate) * 0.3;
  const approvalComponent = (1 - approvalInequality) * 0.3;
  return treasuryComponent + vetoComponent + approvalComponent;
}

// ============================================================
// COORDINATION METRIC CALCULATORS (Task 2.3)
// ============================================================

/**
 * Whip events where followed === true / total whip events.
 * Range: 0.0 to 1.0
 */
export function computePartyDiscipline(whipEvents: SimWhipEvent[]): number {
  if (whipEvents.length === 0) return 0;
  const followed = whipEvents.filter(e => e.followed === true);
  return followed.length / whipEvents.length;
}

/**
 * Cross-party collaborations (party1Id !== party2Id) / total collaborations.
 * Range: 0.0 to 1.0
 */
export function computeCoalitionFormation(collaborations: SimCollaboration[]): number {
  if (collaborations.length === 0) return 0;
  const crossParty = collaborations.filter(c => c.party1Id !== c.party2Id);
  return crossParty.length / collaborations.length;
}

/**
 * 1 - partyDiscipline (whipEvents where followed === false / total).
 * Range: 0.0 to 1.0
 */
export function computeDefectionRate(whipEvents: SimWhipEvent[]): number {
  if (whipEvents.length === 0) return 0;
  return 1 - computePartyDiscipline(whipEvents);
}

/**
 * Adversarial resilience: how well agents maintain decision quality when
 * facing opposition. Compares success rate of agents whose sponsored bills
 * faced majority nay votes vs. overall success rate.
 *
 * Returns null when insufficient data.
 * Range: 0.0 (collapses under opposition) to 1.0 (fully resilient).
 */
export function computeAdversarialResilience(
  decisions: SimDecision[],
  votes: SimVote[],
  bills: SimBill[],
): number | null {
  if (decisions.length === 0 || bills.length === 0) return null;

  // Find agents who sponsored bills that faced majority nay votes
  const adversarialAgents = new Set<string>();
  for (const bill of bills) {
    if (!bill.sponsorId) continue;
    const billVotes = votes.filter((v) => v.billId === bill.id);
    if (billVotes.length === 0) continue;
    const nayRate = billVotes.filter((v) => v.choice === 'nay').length / billVotes.length;
    if (nayRate > 0.5) adversarialAgents.add(bill.sponsorId);
  }

  if (adversarialAgents.size === 0) return null;

  // Success rate for adversarial agents
  const adversarialDecisions = decisions.filter((d) => adversarialAgents.has(d.agentId));
  if (adversarialDecisions.length === 0) return null;
  const adversarialSuccessRate = adversarialDecisions.filter((d) => d.success).length / adversarialDecisions.length;

  // Overall success rate
  const overallSuccessRate = decisions.filter((d) => d.success).length / decisions.length;
  if (overallSuccessRate === 0) return 0;

  // Ratio capped at 1.0
  return Math.min(adversarialSuccessRate / overallSuccessRate, 1);
}

// ============================================================
// COMPOSITE SCORE & GRADE (Task 2.3)
// ============================================================

/**
 * Compute composite benchmark score from all metric buckets.
 * Normalizes each bucket to 0-100 scale and applies weights.
 * Range: 0.0 to 100.0
 */
export function computeComposite(
  outcome: OutcomeMetrics,
  agent: AgentMetrics,
  coordination: CoordinationMetrics,
  weights: MetricWeights,
): number {
  // Outcome score: average of normalized components * 100
  const outcomeComponents = [
    outcome.billPassageRate,
    1 - outcome.vetoRate,
    Math.min(Math.max(outcome.treasuryHealth, 0), 2) / 2,
    1 - outcome.polarizationIndex,
    1 - outcome.approvalInequality,
  ];
  const outcomeScore = (outcomeComponents.reduce((a, b) => a + b, 0) / outcomeComponents.length) * 100;

  // Agent score: average of normalized components * 100
  const agentComponents = [
    agent.actionValidityRate,
    agent.successRate,
    agent.reasoningQuality,
    agent.legislativeIndependence,
    agent.governanceQuality,
  ];
  const agentScore = (agentComponents.reduce((a, b) => a + b, 0) / agentComponents.length) * 100;

  // Coordination score: average of normalized components * 100 (skip adversarialResilience if null)
  const coordComponents = [
    coordination.partyDiscipline,
    coordination.coalitionFormation,
    1 - coordination.defectionRate,
  ];
  if (coordination.adversarialResilience !== null) {
    coordComponents.push(coordination.adversarialResilience);
  }
  const coordScore = (coordComponents.reduce((a, b) => a + b, 0) / coordComponents.length) * 100;

  const composite = outcomeScore * weights.outcome + agentScore * weights.agent + coordScore * weights.coordination;
  return Math.round(composite * 10) / 10;
}

/**
 * Convert composite score to letter grade.
 */
export function compositeToGrade(score: number): string {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 67) return 'D+';
  if (score >= 63) return 'D';
  if (score >= 60) return 'D-';
  return 'F';
}

// ============================================================
// COALITION STABILITY
// ============================================================

/**
 * Coalition stability: consistency of cross-party voting patterns across bills.
 * For each bill, computes cross-party agreement rate (fraction of cross-party
 * voter pairs that voted the same way). Returns 1 - 2*stddev of per-bill rates.
 *
 * Returns null when fewer than 2 bills have cross-party votes.
 * Range: 0.0 (chaotic) to 1.0 (perfectly stable).
 */
export function computeCoalitionStability(
  votes: SimVote[],
  memberships: SimPartyMembership[],
): number | null {
  const partyMap = new Map(memberships.map((m) => [m.agentId, m.partyId]));

  // Group votes by bill
  const billVotes = new Map<string, SimVote[]>();
  for (const v of votes) {
    const arr = billVotes.get(v.billId) ?? [];
    arr.push(v);
    billVotes.set(v.billId, arr);
  }

  // For each bill, compute cross-party agreement rate
  const rates: number[] = [];
  for (const [, bVotes] of billVotes) {
    let crossPairs = 0;
    let agreePairs = 0;
    for (let i = 0; i < bVotes.length; i++) {
      for (let j = i + 1; j < bVotes.length; j++) {
        const p1 = partyMap.get(bVotes[i].voterId);
        const p2 = partyMap.get(bVotes[j].voterId);
        if (p1 && p2 && p1 !== p2) {
          crossPairs++;
          if (bVotes[i].choice === bVotes[j].choice) agreePairs++;
        }
      }
    }
    if (crossPairs > 0) rates.push(agreePairs / crossPairs);
  }

  if (rates.length < 2) return null;

  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, r) => a + (r - mean) ** 2, 0) / rates.length;
  const stddev = Math.sqrt(variance);

  // Normalize: stddev of rates max is 0.5, so cap and invert
  return Math.max(0, 1 - stddev * 2);
}

// ============================================================
// CONVENIENCE ASSEMBLERS
// ============================================================

/**
 * Compute all outcome metrics from raw simulation data.
 */
export function computeAllOutcomeMetrics(
  bills: SimBill[],
  laws: SimLaw[],
  votes: SimVote[],
  memberships: SimPartyMembership[],
  agents: SimAgent[],
  startTreasury: number,
  endTreasury: number,
  snapshots: TreasurySnapshot[],
): OutcomeMetrics {
  return {
    billPassageRate: computeBillPassageRate(bills, laws),
    committeeKillRate: computeCommitteeKillRate(bills),
    vetoRate: computeVetoRate(bills),
    timeToLaw: computeTimeToLaw(bills, laws),
    crossPartyYeaRate: computeCrossPartyYeaRate(votes, memberships, bills),
    polarizationIndex: computePolarizationIndex(votes, memberships),
    coalitionStability: computeCoalitionStability(votes, memberships),
    approvalInequality: computeApprovalInequality(agents),
    treasuryHealth: computeTreasuryHealth(startTreasury, endTreasury),
    deficitTrajectory: computeDeficitTrajectory(snapshots),
  };
}

/**
 * Compute all agent metrics from raw simulation data.
 */
export function computeAllAgentMetrics(
  decisions: SimDecision[],
  votes: SimVote[],
  treasuryHealth: number,
  vetoRate: number,
  approvalInequality: number,
): AgentMetrics {
  const latency = computeLatencyPercentiles(decisions);
  return {
    actionValidityRate: computeActionValidityRate(decisions),
    successRate: computeSuccessRate(decisions),
    latencyP50: latency.p50,
    latencyP90: latency.p90,
    latencyP99: latency.p99,
    costPerDecision: computeCostPerDecision(decisions),
    reasoningQuality: computeReasoningQuality(decisions),
    legislativeIndependence: computeLegislativeIndependence(votes),
    governanceQuality: computeGovernanceQuality(treasuryHealth, vetoRate, approvalInequality),
  };
}

/**
 * Compute all coordination metrics from raw simulation data.
 */
export function computeAllCoordinationMetrics(
  whipEvents: SimWhipEvent[],
  collaborations: SimCollaboration[],
  decisions: SimDecision[],
  votes: SimVote[],
  bills: SimBill[],
): CoordinationMetrics {
  return {
    partyDiscipline: computePartyDiscipline(whipEvents),
    coalitionFormation: computeCoalitionFormation(collaborations),
    defectionRate: computeDefectionRate(whipEvents),
    adversarialResilience: computeAdversarialResilience(decisions, votes, bills),
  };
}
