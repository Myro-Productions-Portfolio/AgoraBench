import { describe, it, expect } from 'vitest';
import {
  stableHash,
  rankCommittees,
  pickTopCommittees,
  selectChair,
  tallyWeightedRatification,
  type CanonicalCommittee,
  type ChairCandidate,
} from '@core/server/lib/committeeAssignment';
import { COMMITTEE_TYPES } from '@shared/constants';

const AGENT_A = '0a3f2c34-1111-4a5b-8c6d-000000000001';
const AGENT_B = '1b4e3d45-2222-4b6c-9d7e-000000000002';

function engagementFrom(map: Partial<Record<CanonicalCommittee, number>>) {
  return (committee: CanonicalCommittee): number => map[committee] ?? 0;
}

describe('stableHash', () => {
  it('is deterministic for the same input', () => {
    expect(stableHash(`${AGENT_A}:Budget`)).toBe(stableHash(`${AGENT_A}:Budget`));
  });

  it('differs across inputs (FNV-1a dispersion on realistic keys)', () => {
    const hashes = new Set(COMMITTEE_TYPES.map((c) => stableHash(`${AGENT_A}:${c}`)));
    expect(hashes.size).toBe(COMMITTEE_TYPES.length);
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = stableHash('anything at all');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('rankCommittees', () => {
  it('orders by engagement descending', () => {
    const ranked = rankCommittees(
      AGENT_A,
      engagementFrom({ Budget: 1, Technology: 9, 'Foreign Affairs': 4, Judiciary: 0 }),
    );
    expect(ranked).toEqual(['Technology', 'Foreign Affairs', 'Budget', 'Judiciary']);
  });

  it('always returns all four canonical committees exactly once', () => {
    const ranked = rankCommittees(AGENT_A, engagementFrom({}));
    expect([...ranked].sort()).toEqual([...COMMITTEE_TYPES].sort());
  });

  it('is deterministic for zero-history agents (hash tiebreak, no Math.random)', () => {
    const first = rankCommittees(AGENT_A, engagementFrom({}));
    for (let i = 0; i < 25; i++) {
      expect(rankCommittees(AGENT_A, engagementFrom({}))).toEqual(first);
    }
  });

  it('spreads zero-history agents across committees via the agent-scoped hash', () => {
    /* The hash is keyed on agentId:committee, so ordering is a pure function
       of the agent. Across a population, top picks must not all collapse
       onto one committee — that is what balances brand-new agents. */
    const topPicks = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const ranked = rankCommittees(`agent-${i}-${AGENT_A}`, engagementFrom({}));
      topPicks.add(ranked[0]);
    }
    expect(topPicks.size).toBeGreaterThan(1);
  });

  it('breaks engagement ties with the hash, not list position', () => {
    /* All committees tied at 5 — order must equal the zero-history hash order. */
    const tied = rankCommittees(
      AGENT_A,
      engagementFrom({ Budget: 5, Technology: 5, 'Foreign Affairs': 5, Judiciary: 5 }),
    );
    expect(tied).toEqual(rankCommittees(AGENT_A, engagementFrom({})));
  });
});

describe('pickTopCommittees', () => {
  it('returns the top-2 by default', () => {
    const top = pickTopCommittees(
      AGENT_A,
      engagementFrom({ Budget: 3, Technology: 9, 'Foreign Affairs': 4, Judiciary: 0 }),
    );
    expect(top).toEqual(['Technology', 'Foreign Affairs']);
  });

  it('respects a custom count and clamps negative counts to empty', () => {
    expect(pickTopCommittees(AGENT_A, engagementFrom({ Budget: 1 }), 1)).toEqual(['Budget']);
    expect(pickTopCommittees(AGENT_A, engagementFrom({}), -1)).toEqual([]);
  });

  it('is stable across calls for the same agent (sticky assignment input)', () => {
    const first = pickTopCommittees(AGENT_B, engagementFrom({}));
    expect(pickTopCommittees(AGENT_B, engagementFrom({}))).toEqual(first);
  });
});

describe('selectChair', () => {
  const candidates: ChairCandidate[] = [
    { agentId: 'agent-low', engagement: 2, approvalRating: 90 },
    { agentId: 'agent-high', engagement: 8, approvalRating: 30 },
    { agentId: 'agent-mid', engagement: 5, approvalRating: 60 },
  ];

  it('picks the highest engagement + approvalRating/100 score', () => {
    /* Scores: low = 2.9, high = 8.3, mid = 5.6 */
    expect(selectChair(candidates, new Set())?.agentId).toBe('agent-high');
  });

  it('approval only breaks near-ties (it is divided by 100)', () => {
    const pick = selectChair(
      [
        { agentId: 'a', engagement: 3, approvalRating: 0 },
        { agentId: 'b', engagement: 2, approvalRating: 100 },
      ],
      new Set(),
    );
    /* 3.0 beats 2 + 100/100 = 3.0? Equal — falls to agentId tiebreak: 'a' < 'b'. */
    expect(pick?.agentId).toBe('a');
  });

  it('breaks exact score ties by agentId ascending', () => {
    const pick = selectChair(
      [
        { agentId: 'zzz', engagement: 4, approvalRating: 50 },
        { agentId: 'aaa', engagement: 4, approvalRating: 50 },
      ],
      new Set(),
    );
    expect(pick?.agentId).toBe('aaa');
  });

  it('skips excluded agents (sitting chairs of other committees)', () => {
    expect(selectChair(candidates, new Set(['agent-high']))?.agentId).toBe('agent-mid');
  });

  it('returns null when every candidate is excluded or the roster is empty', () => {
    expect(selectChair([], new Set())).toBeNull();
    expect(selectChair(candidates, new Set(['agent-low', 'agent-mid', 'agent-high']))).toBeNull();
  });
});

describe('tallyWeightedRatification', () => {
  it('matches the Phase 1.7 arithmetic: each alignment a adds a for / (1-a) against', () => {
    const { votesFor, votesAgainst } = tallyWeightedRatification([0.9, 0.6, 0.2], 0.5);
    expect(votesFor).toBeCloseTo(1.7, 10);
    expect(votesAgainst).toBeCloseTo(1.3, 10);
  });

  it('passes iff votesFor/total >= threshold (>= boundary, like Phase 1.7)', () => {
    /* All neutral 0.5 → exactly at a 0.5 threshold → passes */
    expect(tallyWeightedRatification([0.5, 0.5, 0.5], 0.5).passed).toBe(true);
    /* Just below a higher threshold → fails */
    expect(tallyWeightedRatification([0.5, 0.5, 0.5], 0.51).passed).toBe(false);
  });

  it('fails on hostile committees and passes on aligned ones', () => {
    expect(tallyWeightedRatification([0.1, 0.2, 0.3], 0.5).passed).toBe(false);
    expect(tallyWeightedRatification([0.8, 0.9, 0.7], 0.5).passed).toBe(true);
  });

  it('never passes with an empty roster (mid-migration safety default)', () => {
    const result = tallyWeightedRatification([], 0.5);
    expect(result.passed).toBe(false);
    expect(result.votesFor).toBe(0);
    expect(result.votesAgainst).toBe(0);
  });
});
