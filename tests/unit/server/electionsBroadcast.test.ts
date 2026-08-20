import { describe, it, expect } from 'vitest';
import { buildElectoralCollegeBlock } from '@modules/elections/server/routes/elections';
import { EC_MAJORITY, ELECTORAL_VOTES, STATE_ORDER } from '@core/server/lib/electoralCollege';
import { computeElectoralSnapshot, assignVoterState } from '@core/server/lib/electionMath';

describe('buildElectoralCollegeBlock (GET /elections/:id response block)', () => {
  it('returns null when the EC columns are null (non-presidential or flag-off certification) — the route omits the key', () => {
    expect(buildElectoralCollegeBlock(null, null)).toBeNull();
    /* A stray stateResults without the summary never fabricates a block. */
    expect(buildElectoralCollegeBlock({ CA: 'agent-a' }, null)).toBeNull();
  });

  it('whitelists exactly the spec §3.1 fields — no row spread, no extras', () => {
    const block = buildElectoralCollegeBlock(
      { CA: 'agent-a', TX: 'agent-b' },
      { winnerId: 'agent-a', totalEvAllocated: 94, evByCandidate: { 'agent-a': 54, 'agent-b': 40 }, reachedMajority: false },
    );
    expect(block).not.toBeNull();
    expect(Object.keys(block!).sort()).toEqual([
      'enabled',
      'evByCandidate',
      'reachedMajority',
      'stateResults',
      'threshold',
      'totalEvAllocated',
      'winnerId',
    ]);
    expect(block!.enabled).toBe(true);
    expect(block!.threshold).toBe(EC_MAJORITY);
    expect(block!.stateResults).toEqual({ CA: 'agent-a', TX: 'agent-b' });
    expect(block!.evByCandidate).toEqual({ 'agent-a': 54, 'agent-b': 40 });
    expect(block!.totalEvAllocated).toBe(94);
    expect(block!.winnerId).toBe('agent-a');
    expect(block!.reachedMajority).toBe(false);
  });

  it('defends against partially-populated rows (null stateResults alongside a summary)', () => {
    const block = buildElectoralCollegeBlock(null, {
      winnerId: null,
      totalEvAllocated: 12,
      evByCandidate: { 'agent-a': 12 },
      reachedMajority: false,
    });
    expect(block!.stateResults).toEqual({});
    expect(block!.winnerId).toBeNull();
  });
});

describe('computeElectoralSnapshot (GET /elections/:id/electoral provisional tally)', () => {
  const A = 'agent-a';
  const B = 'agent-b';
  const order = [A, B];

  it('empty ballots -> empty snapshot, nothing fabricated', () => {
    const snap = computeElectoralSnapshot([], ELECTORAL_VOTES, [...STATE_ORDER], order, EC_MAJORITY);
    expect(snap).toEqual({
      stateWinners: {},
      evByCandidate: {},
      totalEvAllocated: 0,
      winnerId: null,
      reachedMajority: false,
      ballotsCounted: 0,
    });
  });

  it('buckets by hashed state, per-state plurality with registration-order tie-break, abstain-only states stay uncalled', () => {
    /* Deterministic FNV assignments (pinned as preconditions so a hash change
       fails loudly here, not mysteriously below):
       voter-alpha -> FL(30), voter-beta -> CA(54), voter-gamma -> PA(19),
       voter-zeta -> CA (shares beta's state), voter-delta -> NC (abstains). */
    const st = (v: string) => assignVoterState(v, ELECTORAL_VOTES, [...STATE_ORDER]);
    expect(st('voter-alpha')).toBe('FL');
    expect(st('voter-beta')).toBe('CA');
    expect(st('voter-gamma')).toBe('PA');
    expect(st('voter-zeta')).toBe('CA');
    expect(st('voter-delta')).toBe('NC');

    const snap = computeElectoralSnapshot(
      [
        { candidateId: A, voterId: 'voter-alpha' },
        { candidateId: A, voterId: 'voter-beta' },
        { candidateId: B, voterId: 'voter-gamma' },
        { candidateId: B, voterId: 'voter-zeta' },   // CA now ties 1-1 -> A by registration order
        { candidateId: null, voterId: 'voter-delta' }, // abstention: NC stays uncalled
      ],
      ELECTORAL_VOTES,
      [...STATE_ORDER],
      order,
      EC_MAJORITY,
    );

    expect(snap.stateWinners).toEqual({ FL: A, CA: A, PA: B });
    expect(snap.evByCandidate).toEqual({ [A]: 84, [B]: 19 }); // FL 30 + CA 54; PA 19
    expect(snap.totalEvAllocated).toBe(103);
    expect(snap.winnerId).toBeNull(); // far short of 270 — normal mid-count
    expect(snap.reachedMajority).toBe(false);
    expect(snap.ballotsCounted).toBe(4); // abstention excluded
  });

  it('declares a provisional winner once the threshold is reached (synthetic 5-EV map, threshold 3)', () => {
    const tinyEv = { AA: 3, BB: 2 };
    const tinyOrder = ['AA', 'BB'];
    /* Pinned assignments under the tiny map. */
    expect(assignVoterState('tv-0', tinyEv, tinyOrder)).toBe('AA');
    expect(assignVoterState('tv-20', tinyEv, tinyOrder)).toBe('BB');

    const snap = computeElectoralSnapshot(
      [
        { candidateId: A, voterId: 'tv-0' },
        { candidateId: B, voterId: 'tv-20' },
      ],
      tinyEv,
      tinyOrder,
      order,
      3,
    );

    expect(snap.stateWinners).toEqual({ AA: A, BB: B });
    expect(snap.evByCandidate).toEqual({ [A]: 3, [B]: 2 });
    expect(snap.totalEvAllocated).toBe(5);
    expect(snap.winnerId).toBe(A);
    expect(snap.reachedMajority).toBe(true);
  });
});
