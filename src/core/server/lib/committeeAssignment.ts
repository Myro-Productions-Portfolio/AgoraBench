/**
 * Deterministic committee assignment, chair selection, and markup
 * ratification arithmetic — zero LLM, zero I/O, zero Math.random.
 *
 * Assignment: each active agent sits on the top-N (default 2) of the four
 * canonical committees, scored by policy engagement (supportCount +
 * opposeCount from agent_policy_positions, whose categories ARE committee
 * names — Phase 2b writes them from bill.committee). Ties and zero-history
 * agents fall back to a stable hash of (agentId + committee) so assignment
 * is deterministic per agent and roughly balanced across the population.
 *
 * Chair selection: highest engagement + approvalRating/100, tie-broken by
 * agentId, excluding agents already chairing another committee.
 *
 * Ratification: the exact Phase 1.7 weighted-alignment arithmetic — each
 * voter contributes `alignment` to votesFor and `1 - alignment` to
 * votesAgainst; the measure passes iff votesFor/total >= threshold.
 */

import { COMMITTEE_TYPES } from '@shared/constants';

export type CanonicalCommittee = (typeof COMMITTEE_TYPES)[number];

/** FNV-1a 32-bit — stable across processes/restarts (no Math.random). */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Rank all canonical committees for an agent: engagement desc, then
 * stableHash(agentId:committee) asc, then committee name asc (total order).
 */
export function rankCommittees(
  agentId: string,
  engagementFor: (committee: CanonicalCommittee) => number,
): CanonicalCommittee[] {
  return [...COMMITTEE_TYPES].sort((a, b) => {
    const engagementDiff = engagementFor(b) - engagementFor(a);
    if (engagementDiff !== 0) return engagementDiff;
    const hashDiff = stableHash(`${agentId}:${a}`) - stableHash(`${agentId}:${b}`);
    if (hashDiff !== 0) return hashDiff;
    return a.localeCompare(b);
  });
}

/** Top-N committees for an agent (default 2). */
export function pickTopCommittees(
  agentId: string,
  engagementFor: (committee: CanonicalCommittee) => number,
  n = 2,
): CanonicalCommittee[] {
  return rankCommittees(agentId, engagementFor).slice(0, Math.max(0, n));
}

export interface ChairCandidate {
  agentId: string;
  /** Policy engagement with this committee's category (support + oppose). */
  engagement: number;
  approvalRating: number;
}

/**
 * Pick the committee chair: highest engagement + approvalRating/100,
 * tie-broken by agentId asc. Candidates in excludeIds (already chairing
 * another committee) are skipped. Returns null when nobody is eligible.
 */
export function selectChair(
  candidates: readonly ChairCandidate[],
  excludeIds: ReadonlySet<string>,
): ChairCandidate | null {
  let best: ChairCandidate | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (excludeIds.has(candidate.agentId)) continue;
    const score = candidate.engagement + candidate.approvalRating / 100;
    if (score > bestScore || (score === bestScore && best !== null && candidate.agentId < best.agentId)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export interface RatificationResult {
  votesFor: number;
  votesAgainst: number;
  passed: boolean;
}

/**
 * Phase 1.7's weighted-alignment vote, verbatim: each alignment a in [0,1]
 * adds a to votesFor and (1-a) to votesAgainst; passes iff total > 0 and
 * votesFor/total >= passThreshold. An empty roster never passes (safe
 * default for a mid-life DB whose memberships haven't populated yet).
 */
export function tallyWeightedRatification(
  alignments: readonly number[],
  passThreshold: number,
): RatificationResult {
  let votesFor = 0;
  let votesAgainst = 0;
  for (const alignment of alignments) {
    votesFor += alignment;
    votesAgainst += 1 - alignment;
  }
  const total = votesFor + votesAgainst;
  return { votesFor, votesAgainst, passed: total > 0 && votesFor / total >= passThreshold };
}
