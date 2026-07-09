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

/** Minimal per-candidate shape for deterministic ordering / fallback. */
export interface CandidateStanding {
  agentId: string;
  /** Contributions raised — the campaign-strength signal + fallback tally. */
  totalContributions: number;
  /** Earliest campaign registration timestamp (ms or ISO string). */
  startDate: string | number | Date;
  /** Stable secondary key — min campaign id — breaks identical-startDate ties. */
  campaignId: string;
}

/**
 * Deterministic candidate order for tie-breaks and the zero-ballot fallback:
 * campaign registration order (earliest startDate first), with campaignId as
 * a stable secondary key. Batch-seeded campaigns share identical
 * defaultNow() startDate values, so startDate alone would resolve ties by
 * Postgres row order (non-deterministic); the campaignId secondary key pins
 * it. Returns agentIds in order. Pure and non-mutating (copies the input).
 */
export function orderCandidates(candidates: CandidateStanding[]): string[] {
  if (!Array.isArray(candidates)) return [];
  return [...candidates]
    .sort((a, b) => {
      const t = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      if (t !== 0) return t;
      return a.campaignId.localeCompare(b.campaignId);
    })
    .map((c) => c.agentId);
}

/**
 * The zero-ballot fallback winner: the candidate with the most contributions,
 * ties broken by orderCandidates (registration order) so the fallback is
 * fully deterministic rather than depending on array/row order. Callers must
 * pass ONLY eligible (active) candidates — filtering withdrawn campaigns is a
 * DB concern done in the query, so a withdrawn candidate can never win here.
 * Returns null for an empty set.
 */
export function pickContributionsFallback(candidates: CandidateStanding[]): string | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const order = orderCandidates(candidates);
  const rank = new Map(order.map((id, i) => [id, i]));
  let best: CandidateStanding | null = null;
  for (const c of candidates) {
    if (best === null) { best = c; continue; }
    const cContrib = Number(c.totalContributions ?? 0);
    const bContrib = Number(best.totalContributions ?? 0);
    if (cContrib > bContrib) { best = c; continue; }
    /* Tie on contributions → earlier in registration order wins. */
    if (cContrib === bContrib && (rank.get(c.agentId) ?? Infinity) < (rank.get(best.agentId) ?? Infinity)) {
      best = c;
    }
  }
  return best?.agentId ?? null;
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
  /* Speaker is a sitting congress member elevated by an internal vote — same
     legislative-branch rank as congress_member (50). Deliberate: a Speaker who
     wins the Speakership keeps their congress seat (equal rank never vacates),
     and winning a HIGHER office (president) vacates the speaker seat too. */
  speaker: 50,
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

/* ────────────────────────────────────────────────────────────────────────
 * Speaker election (office-selection fidelity, Slice 2)
 *
 * The Legislature elects its own presiding officer by roll-call vote of its
 * sitting members — a real cast-ballot election over a CLOSED electorate
 * (seated congress members), not a citizen vote and not an appointment. The
 * ballot count reuses tallyElectionVotes; the only addition is the
 * "majority of votes cast" win condition (abstentions lower the bar,
 * faithfully — the real Speaker vote resolves on votes "for a person by
 * name," so present/absent members reduce the threshold rather than block).
 * Nothing here scores or biases a winner; nominees come from tenure only as
 * a presentation order, and the vote decides.
 * ──────────────────────────────────────────────────────────────────────── */

/** A seated legislator eligible to be nominated for / vote in a Speaker race. */
export interface SeatedMember {
  agentId: string;
  /** Party bloc — agents.alignment; null groups together as an unaligned bloc. */
  alignment: string | null;
  /** Seat tenure key — positions.startDate (earliest = most senior). */
  startDate: string | number | Date;
}

/**
 * The Speaker nominees: one nominee per party bloc, the most-senior seated
 * member of that bloc (earliest startDate; agentId as a stable secondary
 * key so identical timestamps never resolve by array order). Seniority is
 * the real-world presentation default; it is NOT a winner-decider — the vote
 * below decides. Returns nominee agentIds in a deterministic order (by bloc's
 * nominee tenure, then agentId) suitable as the tallyElectionVotes tie-break
 * order. Pure and non-mutating.
 */
export function pickSpeakerNominees(members: SeatedMember[]): string[] {
  if (!Array.isArray(members) || members.length === 0) return [];
  const byBloc = new Map<string, SeatedMember>();
  for (const m of members) {
    if (!m || typeof m.agentId !== 'string' || m.agentId.length === 0) continue;
    const bloc = m.alignment ?? '__unaligned__';
    const current = byBloc.get(bloc);
    if (!current || isMoreSenior(m, current)) byBloc.set(bloc, m);
  }
  return [...byBloc.values()]
    .sort((a, b) => (isMoreSenior(a, b) ? -1 : isMoreSenior(b, a) ? 1 : 0))
    .map((m) => m.agentId);
}

/** True if a is strictly more senior than b (earlier startDate, agentId tiebreak). */
function isMoreSenior(a: SeatedMember, b: SeatedMember): boolean {
  const ta = new Date(a.startDate).getTime();
  const tb = new Date(b.startDate).getTime();
  if (ta !== tb) return ta < tb;
  return a.agentId.localeCompare(b.agentId) < 0;
}

export interface MajorityBallotResult extends TallyResult {
  /** True when the winner cleared a strict majority (> 50%) of votes cast. */
  hasMajority: boolean;
}

/**
 * Tally a closed-electorate ballot (Speaker race) and report whether the
 * leader cleared a strict majority of the votes actually cast. Reuses
 * tallyElectionVotes for the honest count; adds only the majority test.
 * No majority → hasMajority false, and the caller re-ballots (or carries the
 * deadlock to the next tick), mirroring a Legislature that cannot organize.
 * No fallback winner: a Speaker race with zero ballots has no winner (unlike
 * a public election, there is no contributions signal to fall back on).
 */
export function tallyMajorityBallot(
  ballots: BallotRow[],
  candidateOrder: string[],
): MajorityBallotResult {
  const tally = tallyElectionVotes(ballots, candidateOrder, null);
  const leaderVotes = tally.winnerId ? (tally.voteCounts[tally.winnerId] ?? 0) : 0;
  const hasMajority = tally.totalVotes > 0 && leaderVotes * 2 > tally.totalVotes;
  return { ...tally, hasMajority };
}

/* ────────────────────────────────────────────────────────────────────────
 * Electoral College (office-selection fidelity, Slice 4)
 *
 * The president is chosen by popular vote WITHIN each state → each state casts
 * its electoral votes winner-take-all to its plurality winner → 270 of 538
 * wins. The national popular-vote total does not decide the winner. This is
 * the faithful mechanic replicated flaws and all (the owner's explicit call);
 * the engine still only counts honestly and never biases who wins. Per-state
 * plurality reuses tallyElectionVotes (one call per state); this function only
 * sums the electoral votes each state awards.
 * ──────────────────────────────────────────────────────────────────────── */

/** One state's decided plurality winner (from a per-state tallyElectionVotes). */
export interface StateResult {
  /** Two-letter state code (must key into evByState). */
  state: string;
  /** The state's plurality winner, or null if no ballots were cast there. */
  winnerId: string | null;
}

export interface ElectoralCollegeResult {
  /** agentId → electoral votes won. Only candidates with ≥ 1 EV appear. */
  evByCandidate: Record<string, number>;
  /** The candidate with ≥ threshold EVs, or null if nobody reached it. */
  winnerId: string | null;
  /** Total EVs allocated across states that had a winner. */
  totalEvAllocated: number;
  /** EVs needed to win (270 for the standard 538-EV map). */
  threshold: number;
}

/**
 * Sum each state's winner-take-all electoral votes and decide the presidency.
 * winnerId is the candidate reaching `threshold` (default 270) EVs; a
 * candidate order breaks the pathological exact-EV-tie deterministically (same
 * registration-order convention as tallyElectionVotes). Nobody reaching the
 * threshold → winnerId null (a contingent-election / deadlock state the caller
 * documents; it does not invent a winner). Pure and defensive.
 */
export function tallyElectoralCollege(
  stateResults: StateResult[],
  evByState: Record<string, number>,
  candidateOrder: string[] = [],
  threshold = 270,
): ElectoralCollegeResult {
  const evByCandidate: Record<string, number> = {};
  let totalEvAllocated = 0;

  if (Array.isArray(stateResults)) {
    for (const s of stateResults) {
      if (!s || typeof s.winnerId !== 'string' || s.winnerId.length === 0) continue;
      const ev = evByState[s.state];
      if (typeof ev !== 'number' || ev <= 0) continue;
      evByCandidate[s.winnerId] = (evByCandidate[s.winnerId] ?? 0) + ev;
      totalEvAllocated += ev;
    }
  }

  /* Winner = first candidate (in registration order, then by EV desc as a
     fallback for candidates missing from the order) to reach the threshold. */
  const order = Array.isArray(candidateOrder) ? candidateOrder : [];
  const ranked = [
    ...order.filter((id) => id in evByCandidate),
    ...Object.keys(evByCandidate).filter((id) => !order.includes(id)),
  ];
  let winnerId: string | null = null;
  let bestEv = -1;
  for (const id of ranked) {
    const ev = evByCandidate[id] ?? 0;
    if (ev > bestEv) {
      bestEv = ev;
      winnerId = id;
    }
  }
  if (winnerId === null || (evByCandidate[winnerId] ?? 0) < threshold) winnerId = null;

  return { evByCandidate, winnerId, totalEvAllocated, threshold };
}

/**
 * Deterministically assign a voter agent to a state via FNV-1a hash of its id,
 * distributing proportionally to each state's electoral-vote weight (a state
 * with more EVs — i.e. more people — gets proportionally more voters). This is
 * the minimal geography seed for the EC layer: no state column is required on
 * agents; assignment is a pure, stable function of agentId, so re-running a
 * tally is idempotent and no migration/backfill is needed. Returns a state
 * code from evByState. `stateOrder` fixes iteration order (Object.keys order is
 * insertion order in practice, but pass an explicit sorted order for safety).
 */
export function assignVoterState(
  agentId: string,
  evByState: Record<string, number>,
  stateOrder: string[],
): string | null {
  if (!stateOrder || stateOrder.length === 0) return null;
  let totalWeight = 0;
  for (const st of stateOrder) totalWeight += Math.max(0, evByState[st] ?? 0);
  if (totalWeight <= 0) return stateOrder[0] ?? null;

  /* FNV-1a 32-bit over the agentId → a stable [0,1) fraction of totalWeight. */
  let hash = 0x811c9dc5;
  for (let i = 0; i < agentId.length; i++) {
    hash ^= agentId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const point = ((hash >>> 0) / 0x100000000) * totalWeight;

  let acc = 0;
  for (const st of stateOrder) {
    acc += Math.max(0, evByState[st] ?? 0);
    if (point < acc) return st;
  }
  return stateOrder[stateOrder.length - 1] ?? null;
}
