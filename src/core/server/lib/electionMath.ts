/**
 * E3 slice A — real election voting + double-position vacancy, pure logic.
 *
 * Two independent concerns live here:
 *   1. Tally: turn a set of cast `votes` rows into a winner, replacing the
 *      old `campaigns.contributions` placeholder tally in finalizeElection.ts.
 *   2. Office rank: which positions a newly-elected winner must vacate when
 *      they already hold one or more lower offices (the sam-ritter
 *      multi-salary bug — verified in prod at tick 742).
 *
 * Kept pure and DB-free so both can be unit tested without mocking Drizzle,
 * mirroring courtMath.ts / fiscalMath.ts.
 */

/** Minimal shape of a cast ballot needed to tally — subset of a `votes` row. */
export interface BallotRow {
  candidateId: string | null;
}

export interface TallyResult {
  /** Winning candidate id, or null when there is nothing to tally. */
  winnerId: string | null;
  /** candidateId -> vote count, only candidates with >= 1 vote appear. */
  voteCounts: Record<string, number>;
  /** Total ballots counted (rows with a non-null candidateId). */
  totalVotes: number;
  /** True when the winner was chosen by the zero-ballot fallback, not votes. */
  usedFallback: boolean;
}

/**
 * Tally cast ballots into vote counts and a winner. Ties resolve to
 * whichever candidate appears first in `candidateOrder` (stable, deterministic
 * — candidateOrder should be the campaign registration order, e.g. by
 * campaigns.startDate ascending, so re-tallying the same data is idempotent).
 *
 * Zero-ballot edge (no agent voted, e.g. an unattended election in a fresh
 * DB or a single-tick voting window that closed before Phase 14 ran the
 * ballot pass): falls back to `fallbackWinnerId` when provided — the
 * documented deterministic fallback is "highest campaign contributions",
 * computed by the caller and passed in, so this module never needs the
 * campaigns table. Returns winnerId: null only when there are truly no
 * candidates to fall back to (no campaigns either).
 */
export function tallyElectionVotes(
  ballots: BallotRow[],
  candidateOrder: string[],
  fallbackWinnerId: string | null = null,
): TallyResult {
  const voteCounts: Record<string, number> = {};
  let totalVotes = 0;

  if (Array.isArray(ballots)) {
    for (const b of ballots) {
      if (!b || typeof b.candidateId !== 'string' || b.candidateId.length === 0) continue;
      voteCounts[b.candidateId] = (voteCounts[b.candidateId] ?? 0) + 1;
      totalVotes += 1;
    }
  }

  if (totalVotes === 0) {
    return {
      winnerId: fallbackWinnerId,
      voteCounts,
      totalVotes: 0,
      usedFallback: fallbackWinnerId !== null,
    };
  }

  let winnerId: string | null = null;
  let bestCount = -1;
  const order = Array.isArray(candidateOrder) ? candidateOrder : [];
  /* Walk candidateOrder first so ties break deterministically by
     registration order rather than by object-key iteration order. */
  const seen = new Set<string>();
  for (const id of order) {
    seen.add(id);
    const c = voteCounts[id] ?? 0;
    if (c > bestCount) {
      bestCount = c;
      winnerId = id;
    }
  }
  /* Any candidate with votes but missing from candidateOrder (defensive —
     should not happen if the caller passes every campaign) still counts. */
  for (const id of Object.keys(voteCounts)) {
    if (seen.has(id)) continue;
    const c = voteCounts[id]!;
    if (c > bestCount) {
      bestCount = c;
      winnerId = id;
    }
  }

  return { winnerId, voteCounts, totalVotes, usedFallback: false };
}

/**
 * Office rank for the double-position fix. Higher number = higher office.
 * Ordering follows the existing SALARY_TABLE in simulationCore.ts (the only
 * prior "which office outranks which" signal in the codebase): president is
 * the sole apex office; supreme_justice and cabinet_secretary are the next
 * tier (appointed/independent-branch offices, salaried above Congress);
 * committee_chair and congress_member are both legislative-branch seats at
 * the same base rank (chair is a congress_member plus a bonus, not a
 * separate higher office); lower_justice sits with the cabinet tier.
 * Unknown position types rank 0 (never triggers a vacancy).
 */
const OFFICE_RANK: Record<string, number> = {
  president: 100,
  supreme_justice: 70,
  cabinet_secretary: 70,
  lower_justice: 60,
  committee_chair: 50,
  congress_member: 50,
};

/** Numeric rank of a position type. Unknown types rank 0 (lowest, never vacates anything). */
export function officeRank(positionType: string): number {
  return OFFICE_RANK[positionType] ?? 0;
}

/** Minimal shape of a held position needed to decide what to vacate. */
export interface HeldPosition {
  id: string;
  type: string;
}

/**
 * Given the positions an election winner already holds and the position type
 * they just won, returns the ids of currently-held positions that must be
 * vacated — every held position strictly lower-ranked than the newly won
 * office. (Equal-rank seats, e.g. winning a second congress_member seat
 * some other way, are left alone; that is not this bug's shape and the spec
 * only calls for a HIGHER office vacating LOWER ones.)
 *
 * This is the owner-flaggable default from simulation-completeness.md §A:
 * winning a higher office vacates lower seats. Pure and defensive — a
 * non-array input yields no vacancies rather than throwing.
 */
export function getSeatsToVacate(heldPositions: HeldPosition[], newPositionType: string): string[] {
  if (!Array.isArray(heldPositions) || heldPositions.length === 0) return [];
  const newRank = officeRank(newPositionType);
  if (newRank <= 0) return [];
  return heldPositions
    .filter((p) => p && typeof p.id === 'string' && officeRank(p.type) < newRank)
    .map((p) => p.id);
}
