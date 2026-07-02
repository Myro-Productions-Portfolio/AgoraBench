/**
 * simulationCore.ts — Pure governance logic functions
 *
 * Extracted from agentTick.ts so these calculations can be reused
 * without touching the database. Every function here is
 * pure (no I/O, no side-effects) and deterministic when given a seed.
 *
 * This module intentionally does NOT import any database, Bull, or
 * WebSocket code. It only depends on shared constants.
 */

import {
  ALIGNMENT_ORDER,
  GOVERNANCE_PROBABILITIES,
} from '@shared/constants';

/* ================================================================== */
/*  1. Alignment & Distance                                           */
/* ================================================================== */

/**
 * Get numeric index of alignment in ALIGNMENT_ORDER (0-4).
 * Defaults to 2 (moderate) for unknown or null alignments.
 */
export function alignmentIndex(alignment: string | null): number {
  if (!alignment) return 2;
  const idx = (ALIGNMENT_ORDER as readonly string[]).indexOf(alignment);
  return idx >= 0 ? idx : 2;
}

/**
 * Distance between two alignments on the spectrum (0-4).
 * Uses absolute difference of their positions in ALIGNMENT_ORDER.
 */
export function alignmentDistance(a: string | null, b: string | null): number {
  return Math.abs(alignmentIndex(a) - alignmentIndex(b));
}

/* ================================================================== */
/*  2. Veto Probability                                               */
/* ================================================================== */

export interface VetoConfig {
  vetoBaseRate: number;
  vetoRatePerTier: number;
  vetoMaxRate: number;
}

const DEFAULT_VETO_CONFIG: VetoConfig = {
  vetoBaseRate: GOVERNANCE_PROBABILITIES.VETO_BASE_RATE,
  vetoRatePerTier: GOVERNANCE_PROBABILITIES.VETO_RATE_PER_TIER,
  vetoMaxRate: GOVERNANCE_PROBABILITIES.VETO_MAX_RATE,
};

/**
 * Calculate probability president vetoes a bill based on alignment distance.
 * Formula: min(baseRate + distance * ratePerTier, maxRate)
 */
export function calculateVetoProbability(
  presidentAlignment: string | null,
  sponsorAlignment: string | null,
  config?: Partial<VetoConfig>,
): number {
  const cfg: VetoConfig = { ...DEFAULT_VETO_CONFIG, ...config };
  const distance = alignmentDistance(presidentAlignment, sponsorAlignment);
  return Math.min(
    cfg.vetoBaseRate + distance * cfg.vetoRatePerTier,
    cfg.vetoMaxRate,
  );
}

/* ================================================================== */
/*  3. Vote Tallying                                                  */
/* ================================================================== */

export interface VoteTally {
  yea: number;
  nay: number;
  abstain: number;
  total: number;
}

/** Count votes by choice. Anything not 'yea' or 'abstain' counts as 'nay'. */
export function tallyVotes(choices: string[]): VoteTally {
  let yea = 0;
  let nay = 0;
  let abstain = 0;

  for (const raw of choices) {
    const c = raw.toLowerCase().trim();
    if (c === 'yea' || c === 'aye' || c === 'yes' || c === 'y') {
      yea++;
    } else if (c === 'abstain') {
      abstain++;
    } else {
      nay++;
    }
  }

  return { yea, nay, abstain, total: choices.length };
}

/**
 * Determine if bill passes based on tally and passage percentage.
 * Only yea and nay votes count (abstentions are excluded from ratio).
 */
export function determineBillOutcome(
  tally: VoteTally,
  passagePercentage: number,
): 'passed' | 'failed' {
  const votingTotal = tally.yea + tally.nay;
  if (votingTotal === 0) return 'failed';
  return tally.yea / votingTotal >= passagePercentage ? 'passed' : 'failed';
}

/** Determine quorum -- enough voters participated? */
export function hasQuorum(
  totalVotes: number,
  activeAgentCount: number,
  quorumPercentage: number,
): boolean {
  const quorumCount = Math.ceil(activeAgentCount * quorumPercentage);
  return totalVotes >= quorumCount;
}

/** Determine if veto override succeeds (supermajority threshold). */
export function determineOverrideOutcome(
  overrideYea: number,
  totalOverrideVotes: number,
  supermajorityThreshold: number,
): 'overridden' | 'sustained' {
  if (totalOverrideVotes === 0) return 'sustained';
  return overrideYea / totalOverrideVotes >= supermajorityThreshold
    ? 'overridden'
    : 'sustained';
}

/* ================================================================== */
/*  4. Judicial Review                                                */
/* ================================================================== */

/** Determine if law is upheld or struck down by the court. */
export function determineJudicialOutcome(
  constitutionalVotes: number,
  unconstitutionalVotes: number,
): 'upheld' | 'struck_down' {
  if (constitutionalVotes + unconstitutionalVotes === 0) return 'upheld';
  return unconstitutionalVotes >= constitutionalVotes
    ? 'struck_down'
    : 'upheld';
}

/* ================================================================== */
/*  5. Bill Status Transitions                                        */
/* ================================================================== */

/**
 * Valid bill status transitions.
 * proposed -> committee
 * committee -> floor | tabled
 * floor -> passed | vetoed
 * passed -> presidential_veto | law
 * presidential_veto -> passed (override) | vetoed (sustained)
 */
const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  proposed: ['committee'],
  committee: ['floor', 'tabled'],
  floor: ['passed', 'vetoed'],
  passed: ['presidential_veto', 'law'],
  presidential_veto: ['passed', 'vetoed'],
};

/** Check if a bill status transition is valid. */
export function isValidBillTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/** Has the bill reached committee (or any stage past it)? */
export function billReachedCommittee(status: string): boolean {
  const committeeAndBeyond = ['committee', 'floor', 'passed', 'vetoed', 'tabled', 'presidential_veto', 'law'];
  return committeeAndBeyond.includes(status);
}

/** Has the bill reached the president (passed or later presidential stages)? */
export function billReachedPresident(status: string): boolean {
  const presidentialStages = ['passed', 'presidential_veto', 'law'];
  return presidentialStages.includes(status);
}

/* ================================================================== */
/*  6. Approval Rating                                                */
/* ================================================================== */

/** Clamp approval rating to [0, 100] after applying delta. */
export function clampApproval(current: number, delta: number): number {
  return Math.min(100, Math.max(0, current + delta));
}

/**
 * Calculate inactivity decay toward baseline.
 * Returns the delta to apply (can be positive or negative).
 * Formula: round((baseline - current) * decayRate)
 */
export function calculateInactivityDecay(
  currentApproval: number,
  baseline: number,
  decayRate: number,
): number {
  return Math.round((baseline - currentApproval) * decayRate);
}

/* ================================================================== */
/*  7. Economy                                                        */
/* ================================================================== */

const SALARY_TABLE: Record<string, number> = {
  president: 500,
  cabinet_secretary: 300,
  congress_member: 200,
  committee_chair: 250,
  supreme_justice: 350,
  lower_justice: 250,
};

/** Calculate salary for a position type. Returns 0 for unknown types. */
export function positionSalary(positionType: string): number {
  return SALARY_TABLE[positionType] ?? 0;
}

/** Calculate tax amount. Returns floor of balance * (taxRatePercent / 100). */
export function calculateTax(balance: number, taxRatePercent: number): number {
  return Math.floor(balance * (taxRatePercent / 100));
}

/* ================================================================== */
/*  8. Whip Discipline                                                */
/* ================================================================== */

/**
 * Should agent follow the whip signal?
 * Returns true if the random value (0-1) is below the follow rate.
 * Pass `random` for deterministic testing; omit for Math.random().
 */
export function shouldFollowWhip(followRate: number, random?: number): boolean {
  const roll = random ?? Math.random();
  return roll < followRate;
}

/**
 * Parse raw vote choice into 'yea' | 'nay'.
 * Treats variations like 'aye', 'yes', 'y', and substrings containing 'yea' as yea.
 * Everything else is nay.
 */
export function parseVoteChoice(raw: string): 'yea' | 'nay' {
  const normalized = raw.toLowerCase().trim();
  if (
    normalized === 'yea' ||
    normalized === 'aye' ||
    normalized === 'yes' ||
    normalized === 'y' ||
    normalized.includes('yea')
  ) {
    return 'yea';
  }
  return 'nay';
}
