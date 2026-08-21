import { describe, it, expect } from 'vitest';
import {
  campaignRng, fnv1a, donationAmount, spendAmount, reachFactor, speechApprovalDelta,
  exposure, partyTerm, policyCosine, computePollSnapshot, debateTicksFor, debateReception,
  GENEROSITY_FACTOR, DONATION_MIN, DONATION_BALANCE_FLOOR, SPEND_MIN, REACH_MAX,
  POLL_WEIGHTS, POLL_UNDECIDED_THRESHOLD, DEBATE_GLOW_BONUS,
  type PollVoter, type PollCandidate,
} from '@core/server/lib/campaignMath';

describe('campaignRng', () => {
  it('is deterministic for the same parts and diverges across parts', () => {
    const a = campaignRng('e1', 42, 'donor')();
    const b = campaignRng('e1', 42, 'donor')();
    expect(a).toBe(b);
    expect(campaignRng('e1', 43, 'donor')()).not.toBe(a);
    expect(fnv1a('x')).toBe(fnv1a('x'));
    expect(fnv1a('x')).not.toBe(fnv1a('y'));
  });
});

describe('donationAmount', () => {
  const rng = () => 0.5; // jitter = 1.0 exactly
  it('scales by balance, rate and generosity', () => {
    expect(donationAmount(250_000, 0.2, 'medium', rng)).toBe(500);
    expect(donationAmount(250_000, 0.2, 'low', rng)).toBe(250);
    expect(donationAmount(250_000, 0.2, 'high', rng)).toBe(750);
    expect(GENEROSITY_FACTOR.medium).toBe(1);
  });
  it('returns 0 under the donation minimum', () => {
    expect(donationAmount(30_000, 0.01, 'low', rng)).toBe(0);
    expect(DONATION_MIN).toBe(50);
  });
  it('never drops the wallet below the balance floor', () => {
    expect(donationAmount(DONATION_BALANCE_FLOOR, 2, 'high', rng)).toBe(0);
    expect(donationAmount(DONATION_BALANCE_FLOOR - 1, 2, 'high', rng)).toBe(0);
    const nearFloor = donationAmount(DONATION_BALANCE_FLOOR + 200, 2, 'high', rng);
    expect(nearFloor).toBeLessThanOrEqual(200);
  });
  it('jitter stays within [0.75, 1.25) of the base', () => {
    const base = 250_000 * 0.002; // 0.2% medium
    for (let i = 0; i < 50; i++) {
      const amt = donationAmount(250_000, 0.2, 'medium', campaignRng('jitter', i));
      expect(amt).toBeGreaterThanOrEqual(Math.floor(base * 0.75));
      expect(amt).toBeLessThanOrEqual(Math.ceil(base * 1.25));
    }
  });
});

describe('spendAmount', () => {
  const rng = () => 0.5;
  it('never exceeds available and respects the spend minimum', () => {
    expect(spendAmount(1_000, 20, rng)).toBe(200);
    expect(spendAmount(0, 100, rng)).toBe(0);
    expect(spendAmount(300, 20, rng)).toBe(0); // 60 < SPEND_MIN
    expect(SPEND_MIN).toBe(100);
    for (let i = 0; i < 50; i++) {
      const avail = 500 + i * 137;
      expect(spendAmount(avail, 100, campaignRng('spend', i))).toBeLessThanOrEqual(avail);
    }
  });
});

describe('reachFactor / speechApprovalDelta', () => {
  it('is 1 at zero spend and clamps at REACH_MAX', () => {
    expect(reachFactor(0)).toBe(1);
    expect(reachFactor(-5)).toBe(1);
    expect(reachFactor(2_000)).toBeCloseTo(1 + Math.log10(2), 10);
    expect(reachFactor(10_000_000_000)).toBe(REACH_MAX);
  });
  it('speech delta clamps to 1..3', () => {
    expect(speechApprovalDelta(0)).toBe(1);
    expect(speechApprovalDelta(1)).toBe(1);
    expect(speechApprovalDelta(1.6)).toBe(2);
    expect(speechApprovalDelta(2.5)).toBe(3);
    expect(speechApprovalDelta(99)).toBe(3);
  });
});

describe('exposure / partyTerm / policyCosine', () => {
  it('exposure is 0.5 at parity and when nobody spent', () => {
    expect(exposure(0, 0)).toBe(0.5);
    expect(exposure(500, 500)).toBe(0.5);
    expect(exposure(1_500, 500)).toBeGreaterThan(0.5);
    expect(exposure(0, 500)).toBe(0);
  });
  it('partyTerm: same 1, different 0, unaffiliated 0.5', () => {
    expect(partyTerm('p1', 'p1')).toBe(1);
    expect(partyTerm('p1', 'p2')).toBe(0);
    expect(partyTerm(null, 'p2')).toBe(0.5);
    expect(partyTerm('p1', null)).toBe(0.5);
  });
  it('policyCosine: 0.5 on empty, 1 on identical, 0 on opposite', () => {
    expect(policyCosine({}, { a: 1 })).toBe(0.5);
    expect(policyCosine({ a: 0 }, { a: 1 })).toBe(0.5);
    expect(policyCosine({ a: 2, b: -1 }, { a: 2, b: -1 })).toBeCloseTo(1, 10);
    expect(policyCosine({ a: 1 }, { a: -1 })).toBeCloseTo(0, 10);
  });
});

/* ---- Poll snapshot ---------------------------------------------------- */

const voters: PollVoter[] = Array.from({ length: 20 }, (_, i) => ({
  id: `voter-${i}`,
  partyId: i % 2 === 0 ? 'party-A' : 'party-B',
  policyVector: { economy: i % 3 === 0 ? 2 : -1, safety: 1 },
}));

const candidates: PollCandidate[] = [
  { campaignId: 'camp-1', agentId: 'agent-1', approvalRating: 60, partyId: 'party-A', policyVector: { economy: 2, safety: 1 }, spent: 4_000, debateGlow: false },
  { campaignId: 'camp-2', agentId: 'agent-2', approvalRating: 45, partyId: 'party-B', policyVector: { economy: -2, safety: 1 }, spent: 1_000, debateGlow: true },
];

const alignmentMap = new Map<string, number>();
for (const v of voters) {
  alignmentMap.set(`${v.id}:agent-1`, 0.7);
  alignmentMap.set(`${v.id}:agent-2`, 0.5);
}

describe('computePollSnapshot', () => {
  it('weights sum to exactly 1.0 (drift guard)', () => {
    const sum = Object.values(POLL_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1.0, 12);
  });
  it('consumes exactly the ballot signal families (mirror pin)', () => {
    expect(Object.keys(POLL_WEIGHTS).sort()).toEqual(['alignment', 'approval', 'party', 'policy', 'reach']);
  });
  it('is byte-identical on a fixed fixture (determinism pin)', () => {
    const a = computePollSnapshot('election-x', 100, voters, candidates, alignmentMap);
    const b = computePollSnapshot('election-x', 100, voters, candidates, alignmentMap);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = computePollSnapshot('election-x', 101, voters, candidates, alignmentMap);
    expect(c.sampleSize).toBe(a.sampleSize); // different tick may move shares, sample fixed
  });
  it('shares + undecided sum to exactly 100', () => {
    for (let tick = 90; tick < 110; tick++) {
      const snap = computePollSnapshot('election-x', tick, voters, candidates, alignmentMap);
      const total = Object.values(snap.results).reduce((s, v) => s + v, 0) + snap.undecidedPct;
      expect(total).toBe(100);
      expect(snap.sampleSize).toBe(voters.length);
    }
  });
  it('all-hostile electorate polls fully undecided', () => {
    const cold = new Map<string, number>();
    for (const v of voters) {
      cold.set(`${v.id}:agent-1`, 0);
      cold.set(`${v.id}:agent-2`, 0);
    }
    const hostile: PollCandidate[] = candidates.map((c) => ({
      ...c, approvalRating: 0, partyId: 'party-Z', policyVector: {}, spent: 0, debateGlow: false,
    }));
    const noPartyVoters = voters.map((v) => ({ ...v, partyId: null, policyVector: {} }));
    /* score ~= 0.45*0 + 0.15*0 + 0.10*0.5 + 0.15*0.5 + 0.15*0.5 = 0.20 < 0.40 */
    const snap = computePollSnapshot('election-x', 100, noPartyVoters, hostile, cold);
    expect(snap.undecidedPct).toBe(100);
    expect(POLL_UNDECIDED_THRESHOLD).toBe(0.40);
  });
  it('debate glow lifts a candidate (bonus wired in)', () => {
    const even = new Map<string, number>();
    for (const v of voters) {
      even.set(`${v.id}:agent-1`, 0.8);
      even.set(`${v.id}:agent-2`, 0.8);
    }
    const twins: PollCandidate[] = [
      { campaignId: 'camp-1', agentId: 'agent-1', approvalRating: 50, partyId: null, policyVector: {}, spent: 0, debateGlow: false },
      { campaignId: 'camp-2', agentId: 'agent-2', approvalRating: 50, partyId: null, policyVector: {}, spent: 0, debateGlow: true },
    ];
    const flat = voters.map((v) => ({ ...v, partyId: null, policyVector: {} }));
    let glowWins = 0;
    for (let tick = 0; tick < 30; tick++) {
      const snap = computePollSnapshot('glow-test', tick, flat, twins, even);
      if (snap.results['camp-2'] > snap.results['camp-1']) glowWins += 1;
    }
    expect(glowWins).toBeGreaterThan(20); // glow > noise sigma on average
    expect(DEBATE_GLOW_BONUS).toBeGreaterThan(0);
  });
  it('empty electorate / empty field degrade safely', () => {
    const noVoters = computePollSnapshot('e', 1, [], candidates, alignmentMap);
    expect(noVoters).toEqual({ results: { 'camp-1': 0, 'camp-2': 0 }, undecidedPct: 0, sampleSize: 0 });
    const noCands = computePollSnapshot('e', 1, voters, [], alignmentMap);
    expect(noCands.undecidedPct).toBe(100);
  });
});

/* ---- Debates ---------------------------------------------------------- */

describe('debateTicksFor', () => {
  it('spaces debates evenly strictly inside the window', () => {
    expect(debateTicksFor(100, 130, 2)).toEqual([110, 120]);
    expect(debateTicksFor(100, 130, 0)).toEqual([]);
    expect(debateTicksFor(100, 101, 3)).toEqual([]); // window too short
    for (const t of debateTicksFor(100, 106, 6)) {
      expect(t).toBeGreaterThan(100);
      expect(t).toBeLessThan(106);
    }
  });
  it('dedupes collapsed anchors in short windows', () => {
    const ticks = debateTicksFor(100, 104, 6);
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe('debateReception', () => {
  it('argmax wins, ties break to registration order, shares sum to 100', () => {
    const flatRng = () => 0.5; // identical jitter for everyone
    const r = debateReception(
      [{ agentId: 'a', avgAlignment: 0.6 }, { agentId: 'b', avgAlignment: 0.6 }, { agentId: 'c', avgAlignment: 0.4 }],
      flatRng,
    );
    expect(r?.winnerAgentId).toBe('a'); // tie a/b -> earlier registrant
    const total = Object.values(r!.sharesByAgent).reduce((s, v) => s + v, 0);
    expect(total).toBe(100);
  });
  it('is deterministic under a seeded rng and null on empty stage', () => {
    const r1 = debateReception([{ agentId: 'a', avgAlignment: 0.5 }, { agentId: 'b', avgAlignment: 0.7 }], campaignRng('d', 1));
    const r2 = debateReception([{ agentId: 'a', avgAlignment: 0.5 }, { agentId: 'b', avgAlignment: 0.7 }], campaignRng('d', 1));
    expect(r1).toEqual(r2);
    expect(debateReception([], campaignRng('d', 1))).toBeNull();
  });
  it('all-zero alignment falls back to even shares', () => {
    const r = debateReception([{ agentId: 'a', avgAlignment: 0 }, { agentId: 'b', avgAlignment: 0 }], () => 0.5);
    expect(Object.values(r!.sharesByAgent).reduce((s, v) => s + v, 0)).toBe(100);
  });
});
