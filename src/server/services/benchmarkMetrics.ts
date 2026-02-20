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
