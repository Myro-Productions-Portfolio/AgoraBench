// Campaign Realism pure math. Zero DB, zero Date, zero Math.random — all
// stochastic draws come from campaignRng (splitmix32 over an FNV-1a seed of
// caller-supplied parts), so every roll is replayable from (tick, ids).

import { splitmix32, normalDraw } from './macroMath.js';

export type Generosity = 'low' | 'medium' | 'high';

export const GENEROSITY_FACTOR: Record<Generosity, number> = { low: 0.5, medium: 1, high: 1.5 };
export const DONATION_MIN = 50;
/* Never donate a wallet below a fresh agent's stake (initialAgentBalance). */
export const DONATION_BALANCE_FLOOR = 25_000;
export const SPEND_MIN = 100;
export const REACH_SPEND_BENCHMARK = 2_000;
export const REACH_MAX = 2.5;
/* Internal LLM throttles — constants, not config (LLM discipline). */
export const STANCE_ASKS_PER_TICK = 15;
export const ENDORSE_ASKS_PER_TICK = 10;
/* Poll weights mirror the real ballot's signal families. Alignment dominates
   (the only voter-specific real-ballot signal; sole decider in the Speaker
   precedent); reach capped at 15% so money moves polls but never outvotes
   affinity. Must sum to 1.0 — drift-guarded by test. */
export const POLL_WEIGHTS = { alignment: 0.45, approval: 0.15, party: 0.10, policy: 0.15, reach: 0.15 } as const;
export const POLL_NOISE_SIGMA = 0.04;
export const POLL_UNDECIDED_THRESHOLD = 0.40;
export const DEBATE_GLOW_BONUS = 0.05;
export const DEBATE_GLOW_TICKS = 3;
export const DEBATE_WIN_APPROVAL = 2;

const JITTER_MIN = 0.75;
const JITTER_SPREAD = 0.5;
const DEBATE_JITTER_MIN = 0.85;
const DEBATE_JITTER_SPREAD = 0.3;

export function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Seeded PRNG from arbitrary parts — the one randomness entry point. */
export function campaignRng(...parts: Array<string | number>): () => number {
  return splitmix32(fnv1a(parts.join('|')));
}

/** Per-tick donation: balance x rate% x generosity x jitter [0.75, 1.25).
    0 when under DONATION_MIN or when it would drop the wallet below
    DONATION_BALANCE_FLOOR. Whole dollars. */
export function donationAmount(balance: number, ratePct: number, generosity: Generosity, rng: () => number): number {
  if (!Number.isFinite(balance) || balance <= DONATION_BALANCE_FLOOR) return 0;
  const jitter = JITTER_MIN + rng() * JITTER_SPREAD;
  let amount = Math.round(balance * (ratePct / 100) * GENEROSITY_FACTOR[generosity] * jitter);
  amount = Math.min(amount, balance - DONATION_BALANCE_FLOOR);
  return amount < DONATION_MIN ? 0 : amount;
}

/** Per-tick expenditure from the war chest: available x rate% x jitter,
    never above available, 0 under SPEND_MIN. Whole dollars. */
export function spendAmount(available: number, ratePct: number, rng: () => number): number {
  if (!Number.isFinite(available) || available <= 0) return 0;
  const jitter = JITTER_MIN + rng() * JITTER_SPREAD;
  const amount = Math.min(Math.round(available * (ratePct / 100) * jitter), available);
  return amount < SPEND_MIN ? 0 : amount;
}

/** Diminishing-returns reach from this tick's spend: 1 at $0, ~2 at the
    benchmark x9, capped at REACH_MAX. */
export function reachFactor(spentThisTick: number): number {
  if (!Number.isFinite(spentThisTick) || spentThisTick <= 0) return 1;
  return Math.min(REACH_MAX, 1 + Math.log10(1 + spentThisTick / REACH_SPEND_BENCHMARK));
}

/** Flag-on speech approval bump: reach-scaled, clamped 1..3 (flag off keeps
    the legacy flat +1 in the agentTick else branch). */
export function speechApprovalDelta(reach: number): number {
  return Math.max(1, Math.min(3, Math.round(reach)));
}

/** Cumulative-spend exposure vs the race average: 0.5 at parity (and when
    nobody has spent), bounded (0, 1). */
export function exposure(spent: number, raceAvgSpent: number): number {
  if (!(raceAvgSpent > 0)) return 0.5;
  const s = Math.max(0, spent);
  return s / (s + raceAvgSpent);
}

/** Same party 1, different 0, either side unaffiliated 0.5. */
export function partyTerm(voterPartyId: string | null, candidatePartyId: string | null): number {
  if (!voterPartyId || !candidatePartyId) return 0.5;
  return voterPartyId === candidatePartyId ? 1 : 0;
}

/** Cosine similarity of net policy vectors (category -> support − oppose),
    mapped to [0, 1]; 0.5 when either vector is empty/zero. */
export function policyCosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const v of Object.values(a)) na += v * v;
  for (const v of Object.values(b)) nb += v * v;
  if (na === 0 || nb === 0) return 0.5;
  for (const [k, v] of Object.entries(a)) dot += v * (b[k] ?? 0);
  return (dot / (Math.sqrt(na) * Math.sqrt(nb)) + 1) / 2;
}

export interface PollVoter {
  id: string;
  partyId: string | null;
  policyVector: Record<string, number>;
}

export interface PollCandidate {
  campaignId: string;
  agentId: string;
  approvalRating: number;
  partyId: string | null;
  policyVector: Record<string, number>;
  spent: number;
  debateGlow: boolean;
}

export interface PollSnapshot {
  results: Record<string, number>;
  undecidedPct: number;
  sampleSize: number;
}

/* Largest-remainder integer percentages summing to exactly 100. Ties break
   by input order (registration-order convention). */
function integerShares(counts: number[], total: number): number[] {
  const raw = counts.map((c) => (c / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((s, f) => s + f, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/** Honest poll: each sampled voter argmaxes the same signal families the real
    ballot carries (alignment / approval / party / policy) plus the one
    money-visible channel (reach) and seeded noise; a max score under
    POLL_UNDECIDED_THRESHOLD leaves the voter undecided. Candidates order =
    registration order (tie-break convention). alignmentMap keys are
    `${voterId}:${candidateAgentId}`; missing pairs read neutral 0.5. */
export function computePollSnapshot(
  electionId: string,
  tick: number,
  voters: PollVoter[],
  candidates: PollCandidate[],
  alignmentMap: Map<string, number>,
): PollSnapshot {
  const sampleSize = voters.length;
  if (sampleSize === 0 || candidates.length === 0) {
    return {
      results: Object.fromEntries(candidates.map((c) => [c.campaignId, 0])),
      undecidedPct: sampleSize > 0 ? 100 : 0,
      sampleSize,
    };
  }

  const raceAvgSpent = candidates.reduce((s, c) => s + Math.max(0, c.spent), 0) / candidates.length;
  const counts = new Array<number>(candidates.length).fill(0);
  let undecided = 0;

  for (const voter of voters) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const rng = campaignRng(electionId, tick, voter.id, c.campaignId);
      const score =
        POLL_WEIGHTS.alignment * (alignmentMap.get(`${voter.id}:${c.agentId}`) ?? 0.5) +
        POLL_WEIGHTS.approval * (c.approvalRating / 100) +
        POLL_WEIGHTS.party * partyTerm(voter.partyId, c.partyId) +
        POLL_WEIGHTS.policy * policyCosine(voter.policyVector, c.policyVector) +
        POLL_WEIGHTS.reach * exposure(c.spent, raceAvgSpent) +
        normalDraw(rng) * POLL_NOISE_SIGMA +
        (c.debateGlow ? DEBATE_GLOW_BONUS : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestScore < POLL_UNDECIDED_THRESHOLD) undecided += 1;
    else counts[bestIdx] += 1;
  }

  const shares = integerShares([...counts, undecided], sampleSize);
  const results: Record<string, number> = {};
  candidates.forEach((c, i) => { results[c.campaignId] = shares[i]; });
  return { results, undecidedPct: shares[candidates.length], sampleSize };
}

/** Debate ticks evenly spaced strictly inside (campaignStartTick,
    votingStartTick); short windows yield fewer (deduped) anchors. */
export function debateTicksFor(campaignStartTick: number, votingStartTick: number, count: number): number[] {
  if (count <= 0 || votingStartTick - campaignStartTick < 2) return [];
  const window = votingStartTick - campaignStartTick;
  const ticks = new Set<number>();
  for (let i = 1; i <= count; i++) {
    const t = campaignStartTick + Math.round((window * i) / (count + 1));
    if (t > campaignStartTick && t < votingStartTick) ticks.add(t);
  }
  return [...ticks].sort((a, b) => a - b);
}

export interface DebateParticipantInput {
  agentId: string;
  avgAlignment: number;
}

export interface DebateReception {
  winnerAgentId: string;
  sharesByAgent: Record<string, number>;
}

/** Audience reception: electorate-average voteAlignment x jitter; argmax
    wins, ties to the earlier participant (registration order). Shares are
    integer percentages summing to 100. */
export function debateReception(participants: DebateParticipantInput[], rng: () => number): DebateReception | null {
  if (participants.length === 0) return null;
  const scores = participants.map((p) => Math.max(0, p.avgAlignment) * (DEBATE_JITTER_MIN + rng() * DEBATE_JITTER_SPREAD));
  let winnerIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[winnerIdx]) winnerIdx = i;
  }
  const total = scores.reduce((s, v) => s + v, 0);
  const shares = total > 0
    ? integerShares(scores, total)
    : integerShares(participants.map(() => 1), participants.length);
  const sharesByAgent: Record<string, number> = {};
  participants.forEach((p, i) => { sharesByAgent[p.agentId] = shares[i]; });
  return { winnerAgentId: participants[winnerIdx].agentId, sharesByAgent };
}
