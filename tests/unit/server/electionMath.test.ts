import { describe, it, expect } from 'vitest';
import {
  tallyElectionVotes,
  officeRank,
  getSeatsToVacate,
  orderCandidates,
  pickContributionsFallback,
  pickSpeakerNominees,
  tallyMajorityBallot,
  tallyElectoralCollege,
  assignVoterState,
  type BallotRow,
  type HeldPosition,
  type CandidateStanding,
  type SeatedMember,
  type StateResult,
} from '@core/server/lib/electionMath';
import { ELECTORAL_VOTES, STATE_ORDER } from '@core/server/lib/electoralCollege';

function standing(overrides: Partial<CandidateStanding> = {}): CandidateStanding {
  return {
    agentId: 'agent',
    totalContributions: 0,
    startDate: '2026-07-07T00:00:00.000Z',
    campaignId: 'camp',
    ...overrides,
  };
}

describe('tallyElectionVotes', () => {
  it('counts ballots per candidate and picks the highest', () => {
    const ballots: BallotRow[] = [{ candidateId: 'a' }, { candidateId: 'a' }, { candidateId: 'b' }];
    const result = tallyElectionVotes(ballots, ['a', 'b']);
    expect(result.winnerId).toBe('a');
    expect(result.voteCounts).toEqual({ a: 2, b: 1 });
    expect(result.totalVotes).toBe(3);
    expect(result.usedFallback).toBe(false);
  });

  it('breaks ties by candidateOrder (registration order), not object-key order', () => {
    const ballots: BallotRow[] = [{ candidateId: 'z' }, { candidateId: 'a' }];
    // 'a' registered first even though 'z' sorts first alphabetically
    const result = tallyElectionVotes(ballots, ['a', 'z']);
    expect(result.winnerId).toBe('a');
    expect(result.voteCounts).toEqual({ z: 1, a: 1 });
  });

  it('ties resolve to the later candidateOrder entry if it strictly exceeds — never a tie flip', () => {
    const ballots: BallotRow[] = [{ candidateId: 'a' }, { candidateId: 'b' }, { candidateId: 'b' }];
    const result = tallyElectionVotes(ballots, ['a', 'b']);
    expect(result.winnerId).toBe('b');
  });

  it('ignores ballots with null/empty candidateId (e.g. abstentions or bill votes sharing the table)', () => {
    const ballots: BallotRow[] = [{ candidateId: null }, { candidateId: 'a' }, { candidateId: '' }];
    const result = tallyElectionVotes(ballots, ['a']);
    expect(result.totalVotes).toBe(1);
    expect(result.winnerId).toBe('a');
  });

  it('falls back to fallbackWinnerId when zero ballots were cast', () => {
    const result = tallyElectionVotes([], ['a', 'b'], 'b');
    expect(result.winnerId).toBe('b');
    expect(result.totalVotes).toBe(0);
    expect(result.usedFallback).toBe(true);
    expect(result.voteCounts).toEqual({});
  });

  it('returns winnerId null when zero ballots AND no fallback provided', () => {
    const result = tallyElectionVotes([], ['a', 'b']);
    expect(result.winnerId).toBeNull();
    expect(result.usedFallback).toBe(false);
  });

  it('counts a candidate with votes even if missing from candidateOrder (defensive path)', () => {
    const ballots: BallotRow[] = [
      { candidateId: 'ghost' },
      { candidateId: 'ghost' },
      { candidateId: 'a' },
    ];
    const result = tallyElectionVotes(ballots, ['a']);
    expect(result.winnerId).toBe('ghost');
    expect(result.voteCounts).toEqual({ ghost: 2, a: 1 });
  });

  it('is defensive against non-array ballots input', () => {
    // @ts-expect-error deliberate malformed input
    const result = tallyElectionVotes(null, ['a']);
    expect(result.totalVotes).toBe(0);
    expect(result.winnerId).toBeNull();
  });

  it('skips malformed ballot rows without throwing', () => {
    // @ts-expect-error deliberate malformed input
    const ballots: BallotRow[] = [null, undefined, { candidateId: 'a' }];
    const result = tallyElectionVotes(ballots, ['a']);
    expect(result.totalVotes).toBe(1);
    expect(result.winnerId).toBe('a');
  });

  it('is idempotent on a deduped ballot set (the DB onConflict guarantee)', () => {
    /* The votes_election_voter_unique index + onConflictDoNothing means the
       persisted ballot set has at most one row per voter. This asserts that
       a correctly-deduped set tallies stably — a second finalize pass over
       the same rows yields the identical winner/count, so a retried tick that
       re-inserts nothing changes no outcome. */
    const deduped: BallotRow[] = [{ candidateId: 'a' }, { candidateId: 'b' }, { candidateId: 'a' }];
    const first = tallyElectionVotes(deduped, ['a', 'b']);
    const second = tallyElectionVotes(deduped, ['a', 'b']);
    expect(first).toEqual(second);
    expect(first.winnerId).toBe('a');
    expect(first.totalVotes).toBe(3);
  });
});

describe('officeRank', () => {
  it('ranks president highest', () => {
    expect(officeRank('president')).toBeGreaterThan(officeRank('supreme_justice'));
    expect(officeRank('president')).toBeGreaterThan(officeRank('cabinet_secretary'));
  });

  it('ranks supreme_justice and cabinet_secretary above committee_chair and congress_member', () => {
    expect(officeRank('supreme_justice')).toBeGreaterThan(officeRank('congress_member'));
    expect(officeRank('cabinet_secretary')).toBeGreaterThan(officeRank('committee_chair'));
  });

  it('ranks committee_chair and congress_member equal (chair is not a separate higher office)', () => {
    expect(officeRank('committee_chair')).toBe(officeRank('congress_member'));
  });

  it('unknown position types rank 0', () => {
    expect(officeRank('mayor')).toBe(0);
    expect(officeRank('')).toBe(0);
  });
});

describe('getSeatsToVacate', () => {
  it('vacates a lower-ranked seat when winning a higher office (the sam-ritter bug)', () => {
    const held: HeldPosition[] = [
      { id: 'pos-congress', type: 'congress_member' },
      { id: 'pos-chair', type: 'committee_chair' },
    ];
    const toVacate = getSeatsToVacate(held, 'president');
    expect(toVacate.sort()).toEqual(['pos-chair', 'pos-congress'].sort());
  });

  it('does not vacate a seat at or above the newly won office rank', () => {
    const held: HeldPosition[] = [{ id: 'pos-justice', type: 'supreme_justice' }];
    expect(getSeatsToVacate(held, 'congress_member')).toEqual([]);
  });

  it('does not vacate equal-rank seats (congress winning committee_chair, or vice versa)', () => {
    const held: HeldPosition[] = [{ id: 'pos-congress', type: 'congress_member' }];
    expect(getSeatsToVacate(held, 'committee_chair')).toEqual([]);
  });

  it('returns empty for an unknown new position type (never vacates on unknown rank 0)', () => {
    const held: HeldPosition[] = [{ id: 'pos-congress', type: 'congress_member' }];
    expect(getSeatsToVacate(held, 'mayor')).toEqual([]);
  });

  it('returns empty when the winner holds no other positions', () => {
    expect(getSeatsToVacate([], 'president')).toEqual([]);
  });

  it('is defensive against non-array input', () => {
    // @ts-expect-error deliberate malformed input
    expect(getSeatsToVacate(null, 'president')).toEqual([]);
  });

  it('vacates multiple lower seats at once (the desmond-park two-salary case)', () => {
    const held: HeldPosition[] = [
      { id: 'pos-chair', type: 'committee_chair' },
      { id: 'pos-cabinet', type: 'cabinet_secretary' },
    ];
    const toVacate = getSeatsToVacate(held, 'president');
    expect(toVacate.sort()).toEqual(['pos-cabinet', 'pos-chair'].sort());
  });
});

describe('orderCandidates', () => {
  it('orders by startDate ascending (registration order)', () => {
    const cands: CandidateStanding[] = [
      standing({ agentId: 'late', startDate: '2026-07-07T02:00:00.000Z', campaignId: 'c2' }),
      standing({ agentId: 'early', startDate: '2026-07-07T01:00:00.000Z', campaignId: 'c1' }),
    ];
    expect(orderCandidates(cands)).toEqual(['early', 'late']);
  });

  it('breaks identical startDate ties by campaignId (the batch-seed defaultNow case)', () => {
    /* All three share the exact same defaultNow() timestamp — without the
       campaignId secondary key this would resolve by array/row order. */
    const ts = '2026-07-07T00:00:00.000Z';
    const cands: CandidateStanding[] = [
      standing({ agentId: 'z', startDate: ts, campaignId: 'ccc' }),
      standing({ agentId: 'x', startDate: ts, campaignId: 'aaa' }),
      standing({ agentId: 'y', startDate: ts, campaignId: 'bbb' }),
    ];
    expect(orderCandidates(cands)).toEqual(['x', 'y', 'z']);
  });

  it('is stable regardless of input array order (deterministic)', () => {
    const ts = '2026-07-07T00:00:00.000Z';
    const a = standing({ agentId: 'a', startDate: ts, campaignId: 'aaa' });
    const b = standing({ agentId: 'b', startDate: ts, campaignId: 'bbb' });
    expect(orderCandidates([a, b])).toEqual(orderCandidates([b, a]));
  });

  it('does not mutate its input', () => {
    const cands: CandidateStanding[] = [
      standing({ agentId: 'b', campaignId: 'bbb' }),
      standing({ agentId: 'a', campaignId: 'aaa' }),
    ];
    const before = cands.map((c) => c.agentId);
    orderCandidates(cands);
    expect(cands.map((c) => c.agentId)).toEqual(before);
  });

  it('is defensive against non-array input', () => {
    // @ts-expect-error deliberate malformed input
    expect(orderCandidates(null)).toEqual([]);
  });
});

describe('pickContributionsFallback', () => {
  it('picks the highest-contributions candidate', () => {
    const cands: CandidateStanding[] = [
      standing({ agentId: 'a', totalContributions: 100, campaignId: 'aaa' }),
      standing({ agentId: 'b', totalContributions: 300, campaignId: 'bbb' }),
      standing({ agentId: 'c', totalContributions: 200, campaignId: 'ccc' }),
    ];
    expect(pickContributionsFallback(cands)).toBe('b');
  });

  it('breaks contribution ties by registration order (deterministic)', () => {
    const ts = '2026-07-07T00:00:00.000Z';
    const cands: CandidateStanding[] = [
      standing({ agentId: 'later', totalContributions: 50, startDate: ts, campaignId: 'bbb' }),
      standing({ agentId: 'earlier', totalContributions: 50, startDate: ts, campaignId: 'aaa' }),
    ];
    // Both raised 50 — the earlier-registered (aaa) candidate wins.
    expect(pickContributionsFallback(cands)).toBe('earlier');
  });

  it('only ever returns a candidate from the passed set (active-only filtering is the caller/DB job)', () => {
    /* finalizeElection passes ONLY status=active campaigns, so a withdrawn
       candidate is absent here and cannot be returned. Simulate that: the
       withdrawn high-roller was never passed in. */
    const activeOnly: CandidateStanding[] = [
      standing({ agentId: 'active-a', totalContributions: 10, campaignId: 'aaa' }),
      standing({ agentId: 'active-b', totalContributions: 20, campaignId: 'bbb' }),
    ];
    expect(pickContributionsFallback(activeOnly)).toBe('active-b');
    // The withdrawn candidate 'w' with 9999 contributions is simply not in the set.
    expect(pickContributionsFallback(activeOnly)).not.toBe('w');
  });

  it('returns null for an empty candidate set', () => {
    expect(pickContributionsFallback([])).toBeNull();
  });

  it('is defensive against non-array input', () => {
    // @ts-expect-error deliberate malformed input
    expect(pickContributionsFallback(null)).toBeNull();
  });
});

/* ── Office-Selection Fidelity ─────────────────────────────────────────── */

describe('officeRank — speaker (Slice 2)', () => {
  it('ranks speaker equal to congress_member (same legislative branch, keeps the seat)', () => {
    expect(officeRank('speaker')).toBe(officeRank('congress_member'));
  });

  it('winning the speakership never vacates the winner’s congress seat (equal rank)', () => {
    const held: HeldPosition[] = [{ id: 'pos-congress', type: 'congress_member' }];
    expect(getSeatsToVacate(held, 'speaker')).toEqual([]);
  });

  it('winning the presidency vacates a held speaker seat (higher office)', () => {
    const held: HeldPosition[] = [
      { id: 'pos-speaker', type: 'speaker' },
      { id: 'pos-congress', type: 'congress_member' },
    ];
    expect(getSeatsToVacate(held, 'president').sort()).toEqual(['pos-congress', 'pos-speaker'].sort());
  });
});

describe('pickSpeakerNominees', () => {
  function member(overrides: Partial<SeatedMember> = {}): SeatedMember {
    return { agentId: 'm', alignment: 'moderate', startDate: '2026-07-01T00:00:00.000Z', ...overrides };
  }

  it('nominates one per party bloc — the most senior (earliest startDate) member of each', () => {
    const members: SeatedMember[] = [
      member({ agentId: 'prog-junior', alignment: 'progressive', startDate: '2026-07-05T00:00:00.000Z' }),
      member({ agentId: 'prog-senior', alignment: 'progressive', startDate: '2026-07-01T00:00:00.000Z' }),
      member({ agentId: 'con-only', alignment: 'conservative', startDate: '2026-07-03T00:00:00.000Z' }),
    ];
    const nominees = pickSpeakerNominees(members);
    expect(nominees).toContain('prog-senior');
    expect(nominees).toContain('con-only');
    expect(nominees).not.toContain('prog-junior');
    expect(nominees).toHaveLength(2);
  });

  it('groups null-alignment members into a single unaligned bloc', () => {
    const members: SeatedMember[] = [
      member({ agentId: 'u-senior', alignment: null, startDate: '2026-07-01T00:00:00.000Z' }),
      member({ agentId: 'u-junior', alignment: null, startDate: '2026-07-09T00:00:00.000Z' }),
    ];
    expect(pickSpeakerNominees(members)).toEqual(['u-senior']);
  });

  it('is deterministic under identical seniority (agentId secondary key)', () => {
    const ts = '2026-07-01T00:00:00.000Z';
    const a: SeatedMember = { agentId: 'aaa', alignment: 'x', startDate: ts };
    const b: SeatedMember = { agentId: 'bbb', alignment: 'x', startDate: ts };
    // same bloc, identical tenure — 'aaa' wins the nomination deterministically
    expect(pickSpeakerNominees([a, b])).toEqual(['aaa']);
    expect(pickSpeakerNominees([b, a])).toEqual(['aaa']);
  });

  it('returns [] for empty or malformed input', () => {
    expect(pickSpeakerNominees([])).toEqual([]);
    // @ts-expect-error deliberate malformed input
    expect(pickSpeakerNominees(null)).toEqual([]);
  });

  it('skips rows with a missing agentId', () => {
    const members: SeatedMember[] = [
      { agentId: '', alignment: 'a', startDate: '2026-07-01T00:00:00.000Z' },
      { agentId: 'real', alignment: 'a', startDate: '2026-07-02T00:00:00.000Z' },
    ];
    expect(pickSpeakerNominees(members)).toEqual(['real']);
  });
});

describe('tallyMajorityBallot', () => {
  it('reports a strict majority of votes cast', () => {
    const ballots: BallotRow[] = [{ candidateId: 'a' }, { candidateId: 'a' }, { candidateId: 'b' }];
    const r = tallyMajorityBallot(ballots, ['a', 'b']);
    expect(r.winnerId).toBe('a');
    expect(r.hasMajority).toBe(true);
  });

  it('a plurality that is NOT a majority does not clear the bar (three-way split)', () => {
    // 2-2-1 → leader has 2 of 5, not > 50%
    const ballots: BallotRow[] = [
      { candidateId: 'a' }, { candidateId: 'a' },
      { candidateId: 'b' }, { candidateId: 'b' },
      { candidateId: 'c' },
    ];
    const r = tallyMajorityBallot(ballots, ['a', 'b', 'c']);
    expect(r.hasMajority).toBe(false);
  });

  it('an exact 50% tie is NOT a majority (strict > 50%)', () => {
    const ballots: BallotRow[] = [{ candidateId: 'a' }, { candidateId: 'b' }];
    const r = tallyMajorityBallot(ballots, ['a', 'b']);
    expect(r.hasMajority).toBe(false);
  });

  it('abstentions (null ballots) lower the threshold — faithful "votes for a person by name"', () => {
    // 2 for 'a', 1 for 'b', 2 abstain → 'a' has 2 of 3 counted = majority
    const ballots: BallotRow[] = [
      { candidateId: 'a' }, { candidateId: 'a' }, { candidateId: 'b' },
      { candidateId: null }, { candidateId: null },
    ];
    const r = tallyMajorityBallot(ballots, ['a', 'b']);
    expect(r.totalVotes).toBe(3);
    expect(r.hasMajority).toBe(true);
  });

  it('zero ballots → no winner, no majority (no contributions fallback for internal votes)', () => {
    const r = tallyMajorityBallot([], ['a', 'b']);
    expect(r.winnerId).toBeNull();
    expect(r.hasMajority).toBe(false);
    expect(r.usedFallback).toBe(false);
  });
});

describe('tallyElectoralCollege', () => {
  const ev = { CA: 54, TX: 40, NY: 28, FL: 30, PA: 19 } as const;

  it('sums winner-take-all EVs per state and declares a 270+ winner', () => {
    // Give 'a' enough big states to clear a low test threshold
    const states: StateResult[] = [
      { state: 'CA', winnerId: 'a' },
      { state: 'TX', winnerId: 'b' },
      { state: 'NY', winnerId: 'a' },
    ];
    const r = tallyElectoralCollege(states, ev, ['a', 'b'], 70);
    expect(r.evByCandidate).toEqual({ a: 82, b: 40 });
    expect(r.winnerId).toBe('a');
    expect(r.totalEvAllocated).toBe(122);
  });

  it('the EC winner can differ from the popular leader (states are winner-take-all)', () => {
    // 'b' wins one huge state (54); 'a' wins two small-ish ones (28+19=47).
    const states: StateResult[] = [
      { state: 'CA', winnerId: 'b' },
      { state: 'NY', winnerId: 'a' },
      { state: 'PA', winnerId: 'a' },
    ];
    const r = tallyElectoralCollege(states, ev, ['a', 'b'], 50);
    expect(r.evByCandidate).toEqual({ b: 54, a: 47 });
    expect(r.winnerId).toBe('b'); // fewer states, more EV
  });

  it('returns winnerId null when nobody reaches the threshold (contingent-election deadlock)', () => {
    const states: StateResult[] = [
      { state: 'NY', winnerId: 'a' },
      { state: 'PA', winnerId: 'b' },
    ];
    const r = tallyElectoralCollege(states, ev, ['a', 'b'], 270);
    expect(r.winnerId).toBeNull();
    expect(r.totalEvAllocated).toBe(47);
  });

  it('ignores states with a null winner or missing EV mapping', () => {
    const states: StateResult[] = [
      { state: 'CA', winnerId: 'a' },
      { state: 'ZZ', winnerId: 'a' }, // no EV entry
      { state: 'TX', winnerId: null }, // no plurality
    ];
    const r = tallyElectoralCollege(states, ev, ['a'], 50);
    expect(r.evByCandidate).toEqual({ a: 54 });
    expect(r.totalEvAllocated).toBe(54);
  });

  it('breaks an exact EV tie deterministically by candidate order', () => {
    const states: StateResult[] = [
      { state: 'NY', winnerId: 'a' }, // 28
      { state: 'NY2', winnerId: 'b' },
    ];
    const ties = { NY: 28, NY2: 28 };
    const r = tallyElectoralCollege(states, ties, ['a', 'b'], 28);
    // both reach 28; 'a' is first in order
    expect(r.winnerId).toBe('a');
  });

  it('the real 538-EV map: a candidate sweeping ≥270 wins', () => {
    // 'a' takes CA+TX+FL+NY = 54+40+30+28 = 152; add enough to top 270
    const bigStates = ['CA', 'TX', 'FL', 'NY', 'PA', 'IL', 'OH', 'GA', 'NC', 'MI', 'NJ', 'VA', 'WA', 'AZ', 'MA', 'TN', 'IN', 'MO', 'MD', 'WI', 'CO', 'MN', 'SC'];
    const states: StateResult[] = bigStates.map((s) => ({ state: s, winnerId: 'a' }));
    const r = tallyElectoralCollege(states, ELECTORAL_VOTES as Record<string, number>, ['a'], 270);
    expect(r.evByCandidate.a).toBeGreaterThanOrEqual(270);
    expect(r.winnerId).toBe('a');
  });

  it('is defensive against non-array input', () => {
    // @ts-expect-error deliberate malformed input
    const r = tallyElectoralCollege(null, ev, ['a'], 270);
    expect(r.winnerId).toBeNull();
    expect(r.totalEvAllocated).toBe(0);
  });
});

describe('assignVoterState', () => {
  it('always returns a valid state code from the map', () => {
    const order = [...STATE_ORDER];
    for (let i = 0; i < 200; i++) {
      const st = assignVoterState(`agent-${i}`, ELECTORAL_VOTES as Record<string, number>, order);
      expect(st).not.toBeNull();
      expect(order).toContain(st!);
    }
  });

  it('is deterministic (same agentId → same state every time)', () => {
    const order = [...STATE_ORDER];
    const first = assignVoterState('stable-agent', ELECTORAL_VOTES as Record<string, number>, order);
    const second = assignVoterState('stable-agent', ELECTORAL_VOTES as Record<string, number>, order);
    expect(first).toBe(second);
  });

  it('distributes proportionally to EV weight — the biggest state gets the most voters over a large sample', () => {
    const order = [...STATE_ORDER];
    const counts = new Map<string, number>();
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const st = assignVoterState(`voter-${i}`, ELECTORAL_VOTES as Record<string, number>, order)!;
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    // CA (54 EV) should draw far more voters than WY (3 EV)
    expect((counts.get('CA') ?? 0)).toBeGreaterThan((counts.get('WY') ?? 0));
    // and its share should be within a loose band of its EV share (54/538 ≈ 10%)
    const caShare = (counts.get('CA') ?? 0) / N;
    expect(caShare).toBeGreaterThan(0.06);
    expect(caShare).toBeLessThan(0.14);
  });

  it('returns null when no states are provided', () => {
    expect(assignVoterState('a', {}, [])).toBeNull();
  });

  it('falls back to the first state when total weight is zero', () => {
    expect(assignVoterState('a', { XX: 0, YY: 0 }, ['XX', 'YY'])).toBe('XX');
  });
});
