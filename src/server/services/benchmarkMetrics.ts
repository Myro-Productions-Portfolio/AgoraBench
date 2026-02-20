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

