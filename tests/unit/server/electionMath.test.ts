import { describe, it, expect } from 'vitest';
import {
  tallyElectionVotes,
  officeRank,
  getSeatsToVacate,
  orderCandidates,
  pickContributionsFallback,
  type BallotRow,
  type HeldPosition,
  type CandidateStanding,
} from '@core/server/lib/electionMath';

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
