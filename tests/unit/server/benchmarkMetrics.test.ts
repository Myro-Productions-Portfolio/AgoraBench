import { describe, it, expect } from 'vitest';
import {
  computeBillPassageRate,
  computeCommitteeKillRate,
  computeVetoRate,
  computeTimeToLaw,
  computeCrossPartyYeaRate,
  computePolarizationIndex,
  computeApprovalInequality,
  computeTreasuryHealth,
  computeDeficitTrajectory,
  computeActionValidityRate,
  computeSuccessRate,
  computeLatencyPercentiles,
  computeCostPerDecision,
  computeReasoningQuality,
  computeLegislativeIndependence,
  computeGovernanceQuality,
  computePartyDiscipline,
  computeCoalitionFormation,
  computeDefectionRate,
  computeAdversarialResilience,
  computeComposite,
  compositeToGrade,
  computeAllOutcomeMetrics,
  computeAllAgentMetrics,
  computeAllCoordinationMetrics,
} from '../../../src/modules/benchmark/server/services/benchmarkMetrics';
import type {
  SimBill,
  SimLaw,
  SimVote,
  SimAgent,
  SimPartyMembership,
  SimDecision,
  TreasurySnapshot,
  SimWhipEvent,
  SimCollaboration,
  OutcomeMetrics,
  AgentMetrics,
  CoordinationMetrics,
  MetricWeights,
} from '../../../src/modules/benchmark/server/services/benchmarkMetrics';

// ============================================================
// OUTCOME METRICS
// ============================================================

describe('Outcome Metrics', () => {
  // ----------------------------------------------------------
  // computeBillPassageRate
  // ----------------------------------------------------------
  describe('computeBillPassageRate', () => {
    it('computes correct rate with mixed bills', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'law', sponsorId: 'a1', proposedAtTick: 1 },
        { id: 'b2', status: 'tabled', sponsorId: 'a2', proposedAtTick: 5 },
        { id: 'b3', status: 'law', sponsorId: 'a1', proposedAtTick: 10 },
        { id: 'b4', status: 'vetoed', sponsorId: 'a3', proposedAtTick: 15 },
      ];
      const laws: SimLaw[] = [
        { id: 'l1', billId: 'b1', enactedAtTick: 20 },
        { id: 'l2', billId: 'b3', enactedAtTick: 30 },
      ];
      expect(computeBillPassageRate(bills, laws)).toBe(0.5);
    });

    it('returns 0 for empty bills', () => {
      expect(computeBillPassageRate([], [])).toBe(0);
    });

    it('returns 0 when no laws', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'tabled', sponsorId: 'a1', proposedAtTick: 1 },
      ];
      expect(computeBillPassageRate(bills, [])).toBe(0);
    });

    it('returns 1.0 when all bills become law', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'law', sponsorId: 'a1', proposedAtTick: 1 },
        { id: 'b2', status: 'law', sponsorId: 'a2', proposedAtTick: 2 },
      ];
      const laws: SimLaw[] = [
        { id: 'l1', billId: 'b1', enactedAtTick: 10 },
        { id: 'l2', billId: 'b2', enactedAtTick: 20 },
      ];
      expect(computeBillPassageRate(bills, laws)).toBe(1.0);
    });
  });

  // ----------------------------------------------------------
  // computeCommitteeKillRate
  // ----------------------------------------------------------
  describe('computeCommitteeKillRate', () => {
    it('computes correct rate with mixed statuses', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'tabled', sponsorId: 'a1', proposedAtTick: 1 },
        { id: 'b2', status: 'floor', sponsorId: 'a2', proposedAtTick: 2 },
        { id: 'b3', status: 'committee', sponsorId: 'a3', proposedAtTick: 3 },
        { id: 'b4', status: 'law', sponsorId: 'a4', proposedAtTick: 4 },
        { id: 'b5', status: 'proposed', sponsorId: 'a5', proposedAtTick: 5 }, // not in committee
      ];
      // 4 reached committee, 1 tabled => 0.25
      expect(computeCommitteeKillRate(bills)).toBe(0.25);
    });

    it('returns 0 for empty bills', () => {
      expect(computeCommitteeKillRate([])).toBe(0);
    });

    it('returns 0 when no bills are tabled', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'floor', sponsorId: 'a1', proposedAtTick: 1 },
        { id: 'b2', status: 'law', sponsorId: 'a2', proposedAtTick: 2 },
      ];
      expect(computeCommitteeKillRate(bills)).toBe(0);
    });

    it('returns 1.0 when all committee bills are tabled', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'tabled', sponsorId: 'a1', proposedAtTick: 1 },
        { id: 'b2', status: 'tabled', sponsorId: 'a2', proposedAtTick: 2 },
      ];
      expect(computeCommitteeKillRate(bills)).toBe(1.0);
    });

    it('returns 0 when all bills are only proposed', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'proposed', sponsorId: 'a1', proposedAtTick: 1 },
      ];
      expect(computeCommitteeKillRate(bills)).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // computeVetoRate
  // ----------------------------------------------------------
  describe('computeVetoRate', () => {
    it('computes correct rate with mixed statuses', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'vetoed', sponsorId: 'a1', proposedAtTick: 1 },
        { id: 'b2', status: 'law', sponsorId: 'a2', proposedAtTick: 2 },
        { id: 'b3', status: 'passed', sponsorId: 'a3', proposedAtTick: 3 },
        { id: 'b4', status: 'presidential_veto', sponsorId: 'a4', proposedAtTick: 4 },
        { id: 'b5', status: 'tabled', sponsorId: 'a5', proposedAtTick: 5 }, // not reaching president
      ];
      // 4 reached president, 2 vetoed => 0.5
      expect(computeVetoRate(bills)).toBe(0.5);
    });

    it('returns 0 for empty bills', () => {
      expect(computeVetoRate([])).toBe(0);
    });

    it('returns 0 when no bills reach president', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'tabled', sponsorId: 'a1', proposedAtTick: 1 },
        { id: 'b2', status: 'committee', sponsorId: 'a2', proposedAtTick: 2 },
      ];
      expect(computeVetoRate(bills)).toBe(0);
    });

    it('returns 1.0 when all bills reaching president are vetoed', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'vetoed', sponsorId: 'a1', proposedAtTick: 1 },
        { id: 'b2', status: 'presidential_veto', sponsorId: 'a2', proposedAtTick: 2 },
      ];
      expect(computeVetoRate(bills)).toBe(1.0);
    });
  });

  // ----------------------------------------------------------
  // computeTimeToLaw
  // ----------------------------------------------------------
  describe('computeTimeToLaw', () => {
    it('computes correct average time', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'law', sponsorId: 'a1', proposedAtTick: 5 },
        { id: 'b2', status: 'law', sponsorId: 'a2', proposedAtTick: 10 },
      ];
      const laws: SimLaw[] = [
        { id: 'l1', billId: 'b1', enactedAtTick: 25 }, // 20 ticks
        { id: 'l2', billId: 'b2', enactedAtTick: 40 }, // 30 ticks
      ];
      expect(computeTimeToLaw(bills, laws)).toBe(25); // avg of 20, 30
    });

    it('returns 0 when no laws', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'tabled', sponsorId: 'a1', proposedAtTick: 1 },
      ];
      expect(computeTimeToLaw(bills, [])).toBe(0);
    });

    it('returns 0 for empty inputs', () => {
      expect(computeTimeToLaw([], [])).toBe(0);
    });

    it('handles law referencing missing bill gracefully', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'law', sponsorId: 'a1', proposedAtTick: 5 },
      ];
      const laws: SimLaw[] = [
        { id: 'l1', billId: 'b1', enactedAtTick: 15 },
        { id: 'l2', billId: 'b_missing', enactedAtTick: 30 }, // no matching bill
      ];
      // Only b1 counted: 15 - 5 = 10
      expect(computeTimeToLaw(bills, laws)).toBe(10);
    });

    it('handles single law correctly', () => {
      const bills: SimBill[] = [
        { id: 'b1', status: 'law', sponsorId: 'a1', proposedAtTick: 0 },
      ];
      const laws: SimLaw[] = [
        { id: 'l1', billId: 'b1', enactedAtTick: 100 },
      ];
      expect(computeTimeToLaw(bills, laws)).toBe(100);
    });
  });

  // ----------------------------------------------------------
  // computeCrossPartyYeaRate
  // ----------------------------------------------------------
  describe('computeCrossPartyYeaRate', () => {
    const memberships: SimPartyMembership[] = [
      { agentId: 'a1', partyId: 'partyA' },
      { agentId: 'a2', partyId: 'partyA' },
      { agentId: 'a3', partyId: 'partyB' },
      { agentId: 'a4', partyId: 'partyB' },
    ];
    const bills: SimBill[] = [
      { id: 'b1', status: 'floor', sponsorId: 'a1', proposedAtTick: 1 }, // partyA sponsor
    ];

    it('computes correct cross-party yea rate', () => {
      const votes: SimVote[] = [
        { voterId: 'a1', billId: 'b1', choice: 'yea' }, // same party
        { voterId: 'a2', billId: 'b1', choice: 'yea' }, // same party
        { voterId: 'a3', billId: 'b1', choice: 'yea' }, // cross party
        { voterId: 'a4', billId: 'b1', choice: 'nay' }, // nay, not counted
      ];
      // 3 yea votes, 1 cross-party => 1/3
      expect(computeCrossPartyYeaRate(votes, memberships, bills)).toBeCloseTo(1 / 3);
    });

    it('returns 0 for empty votes', () => {
      expect(computeCrossPartyYeaRate([], memberships, bills)).toBe(0);
    });

    it('returns 0 when no yea votes', () => {
      const votes: SimVote[] = [
        { voterId: 'a1', billId: 'b1', choice: 'nay' },
        { voterId: 'a3', billId: 'b1', choice: 'nay' },
      ];
      expect(computeCrossPartyYeaRate(votes, memberships, bills)).toBe(0);
    });

    it('returns 1.0 when all yea votes are cross-party', () => {
      const votes: SimVote[] = [
        { voterId: 'a3', billId: 'b1', choice: 'yea' }, // partyB voting on partyA bill
        { voterId: 'a4', billId: 'b1', choice: 'yea' }, // partyB voting on partyA bill
      ];
      expect(computeCrossPartyYeaRate(votes, memberships, bills)).toBe(1.0);
    });
  });

  // ----------------------------------------------------------
  // computePolarizationIndex
  // ----------------------------------------------------------
  describe('computePolarizationIndex', () => {
    it('computes polarization for fully split parties', () => {
      const memberships: SimPartyMembership[] = [
        { agentId: 'a1', partyId: 'partyA' },
        { agentId: 'a2', partyId: 'partyB' },
      ];
      const votes: SimVote[] = [
        { voterId: 'a1', billId: 'b1', choice: 'yea' },  // partyA 100% yea
        { voterId: 'a2', billId: 'b1', choice: 'nay' },  // partyB 0% yea
      ];
      // rates: [1.0, 0.0], mean=0.5, variance=0.25, stddev=0.5
      expect(computePolarizationIndex(votes, memberships)).toBeCloseTo(0.5);
    });

    it('returns 0 for empty votes', () => {
      expect(computePolarizationIndex([], [])).toBe(0);
    });

    it('returns 0 when all in same party', () => {
      const memberships: SimPartyMembership[] = [
        { agentId: 'a1', partyId: 'partyA' },
        { agentId: 'a2', partyId: 'partyA' },
      ];
      const votes: SimVote[] = [
        { voterId: 'a1', billId: 'b1', choice: 'yea' },
        { voterId: 'a2', billId: 'b1', choice: 'nay' },
      ];
      // Only one party => stddev of single rate is 0
      expect(computePolarizationIndex(votes, memberships)).toBe(0);
    });

    it('returns 0 when both parties vote identically', () => {
      const memberships: SimPartyMembership[] = [
        { agentId: 'a1', partyId: 'partyA' },
        { agentId: 'a2', partyId: 'partyB' },
      ];
      const votes: SimVote[] = [
        { voterId: 'a1', billId: 'b1', choice: 'yea' },
        { voterId: 'a2', billId: 'b1', choice: 'yea' },
      ];
      // rates: [1.0, 1.0], stddev=0
      expect(computePolarizationIndex(votes, memberships)).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // computeApprovalInequality
  // ----------------------------------------------------------
  describe('computeApprovalInequality', () => {
    it('computes Gini for unequal ratings', () => {
      const agents: SimAgent[] = [
        { id: 'a1', approvalRating: 0, alignment: 'left' },
        { id: 'a2', approvalRating: 100, alignment: 'right' },
      ];
      // |0-0| + |0-100| + |100-0| + |100-100| = 200
      // Gini = 200 / (2 * 2 * 50) = 1.0
      expect(computeApprovalInequality(agents)).toBe(1.0);
    });

    it('returns 0 for equal ratings', () => {
      const agents: SimAgent[] = [
        { id: 'a1', approvalRating: 50, alignment: 'center' },
        { id: 'a2', approvalRating: 50, alignment: 'center' },
        { id: 'a3', approvalRating: 50, alignment: 'center' },
      ];
      expect(computeApprovalInequality(agents)).toBe(0);
    });

    it('returns 0 for single agent', () => {
      const agents: SimAgent[] = [
        { id: 'a1', approvalRating: 75, alignment: 'center' },
      ];
      expect(computeApprovalInequality(agents)).toBe(0);
    });

    it('returns 0 for empty agents', () => {
      expect(computeApprovalInequality([])).toBe(0);
    });

    it('handles all zero ratings', () => {
      const agents: SimAgent[] = [
        { id: 'a1', approvalRating: 0, alignment: 'center' },
        { id: 'a2', approvalRating: 0, alignment: 'center' },
      ];
      expect(computeApprovalInequality(agents)).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // computeTreasuryHealth
  // ----------------------------------------------------------
  describe('computeTreasuryHealth', () => {
    it('computes correct ratio', () => {
      expect(computeTreasuryHealth(1000, 800)).toBe(0.8);
    });

    it('returns 0 when start is 0', () => {
      expect(computeTreasuryHealth(0, 500)).toBe(0);
    });

    it('clamps negative result to 0', () => {
      expect(computeTreasuryHealth(1000, -500)).toBe(0);
    });

    it('handles growing treasury', () => {
      expect(computeTreasuryHealth(1000, 1500)).toBe(1.5);
    });

    it('returns 1.0 for unchanged treasury', () => {
      expect(computeTreasuryHealth(1000, 1000)).toBe(1.0);
    });
  });

  // ----------------------------------------------------------
  // computeDeficitTrajectory
  // ----------------------------------------------------------
  describe('computeDeficitTrajectory', () => {
    it('computes positive slope for growing treasury', () => {
      const snapshots: TreasurySnapshot[] = [
        { tick: 0, balance: 100 },
        { tick: 10, balance: 200 },
        { tick: 20, balance: 300 },
      ];
      expect(computeDeficitTrajectory(snapshots)).toBeCloseTo(10);
    });

    it('computes negative slope for shrinking treasury', () => {
      const snapshots: TreasurySnapshot[] = [
        { tick: 0, balance: 300 },
        { tick: 10, balance: 200 },
        { tick: 20, balance: 100 },
      ];
      expect(computeDeficitTrajectory(snapshots)).toBeCloseTo(-10);
    });

    it('returns 0 for fewer than 2 snapshots', () => {
      expect(computeDeficitTrajectory([])).toBe(0);
      expect(computeDeficitTrajectory([{ tick: 0, balance: 100 }])).toBe(0);
    });

    it('returns 0 for flat treasury', () => {
      const snapshots: TreasurySnapshot[] = [
        { tick: 0, balance: 500 },
        { tick: 10, balance: 500 },
        { tick: 20, balance: 500 },
      ];
      expect(computeDeficitTrajectory(snapshots)).toBeCloseTo(0);
    });

    it('handles two snapshots', () => {
      const snapshots: TreasurySnapshot[] = [
        { tick: 0, balance: 100 },
        { tick: 10, balance: 200 },
      ];
      // slope = (2*2000 - 10*300) / (2*100 - 100) = (4000-3000)/(200-100) = 10
      expect(computeDeficitTrajectory(snapshots)).toBeCloseTo(10);
    });
  });
});

// ============================================================
// AGENT METRICS
// ============================================================

describe('Agent Metrics', () => {
  // ----------------------------------------------------------
  // computeActionValidityRate
  // ----------------------------------------------------------
  describe('computeActionValidityRate', () => {
    it('computes correct rate with mixed actions', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'reason', success: true, latencyMs: 100, tokenCount: 200 },
        { agentId: 'a2', parsedAction: 'propose', parsedReasoning: 'reason', success: true, latencyMs: 150, tokenCount: 300 },
        { agentId: 'a3', parsedAction: 'invalid_action', parsedReasoning: 'reason', success: false, latencyMs: 200, tokenCount: 100 },
        { agentId: 'a4', parsedAction: null, parsedReasoning: null, success: false, latencyMs: 50 },
      ];
      expect(computeActionValidityRate(decisions)).toBe(0.5);
    });

    it('returns 0 for empty decisions', () => {
      expect(computeActionValidityRate([])).toBe(0);
    });

    it('returns 1.0 when all actions are valid', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100 },
        { agentId: 'a2', parsedAction: 'idle', parsedReasoning: 'r', success: true, latencyMs: 100 },
      ];
      expect(computeActionValidityRate(decisions)).toBe(1.0);
    });

    it('returns 0 when all actions are invalid', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: null, parsedReasoning: null, success: false, latencyMs: 100 },
        { agentId: 'a2', parsedAction: 'garbage', parsedReasoning: null, success: false, latencyMs: 100 },
      ];
      expect(computeActionValidityRate(decisions)).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // computeSuccessRate
  // ----------------------------------------------------------
  describe('computeSuccessRate', () => {
    it('computes correct rate', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100 },
        { agentId: 'a2', parsedAction: 'vote', parsedReasoning: 'r', success: false, latencyMs: 100 },
        { agentId: 'a3', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100 },
      ];
      expect(computeSuccessRate(decisions)).toBeCloseTo(2 / 3);
    });

    it('returns 0 for empty decisions', () => {
      expect(computeSuccessRate([])).toBe(0);
    });

    it('returns 1.0 when all succeed', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100 },
      ];
      expect(computeSuccessRate(decisions)).toBe(1.0);
    });

    it('returns 0 when none succeed', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'r', success: false, latencyMs: 100 },
        { agentId: 'a2', parsedAction: 'vote', parsedReasoning: 'r', success: false, latencyMs: 100 },
      ];
      expect(computeSuccessRate(decisions)).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // computeLatencyPercentiles
  // ----------------------------------------------------------
  describe('computeLatencyPercentiles', () => {
    it('computes correct percentiles for multiple values', () => {
      // 10 values sorted: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
      const decisions: SimDecision[] = Array.from({ length: 10 }, (_, i) => ({
        agentId: `a${i}`,
        parsedAction: 'vote',
        parsedReasoning: 'reason',
        success: true,
        latencyMs: (i + 1) * 10,
      }));
      const result = computeLatencyPercentiles(decisions);
      // p50: index 4.5 => interpolate between 50 and 60 => 55
      expect(result.p50).toBeCloseTo(55);
      // p90: index 8.1 => interpolate between 90 and 100 => 91
      expect(result.p90).toBeCloseTo(91);
      // p99: index 8.91 => interpolate between 90 and 100 => 99.1
      expect(result.p99).toBeCloseTo(99.1);
    });

    it('returns zeros for empty decisions', () => {
      const result = computeLatencyPercentiles([]);
      expect(result).toEqual({ p50: 0, p90: 0, p99: 0 });
    });

    it('handles single decision', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 42 },
      ];
      const result = computeLatencyPercentiles(decisions);
      expect(result.p50).toBe(42);
      expect(result.p90).toBe(42);
      expect(result.p99).toBe(42);
    });

    it('handles two decisions', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100 },
        { agentId: 'a2', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 200 },
      ];
      const result = computeLatencyPercentiles(decisions);
      expect(result.p50).toBe(150);  // interpolation at midpoint
      expect(result.p90).toBe(190);  // 0.9 * 1 = 0.9 => 100*(0.1) + 200*(0.9) = 190
      expect(result.p99).toBe(199);  // 0.99 * 1 = 0.99
    });
  });

  // ----------------------------------------------------------
  // computeCostPerDecision
  // ----------------------------------------------------------
  describe('computeCostPerDecision', () => {
    it('computes correct cost with token counts', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100, tokenCount: 1000 },
        { agentId: 'a2', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100, tokenCount: 2000 },
      ];
      // total tokens = 3000, cost = 3000 * 0.000003 = 0.009, per decision = 0.0045
      expect(computeCostPerDecision(decisions)).toBeCloseTo(0.0045);
    });

    it('uses default 500 tokens when tokenCount is missing', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100 },
        { agentId: 'a2', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100 },
      ];
      // total tokens = 1000, cost = 1000 * 0.000003 = 0.003, per decision = 0.0015
      expect(computeCostPerDecision(decisions)).toBeCloseTo(0.0015);
    });

    it('returns 0 for empty decisions', () => {
      expect(computeCostPerDecision([])).toBe(0);
    });

    it('accepts custom cost per token', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'r', success: true, latencyMs: 100, tokenCount: 100 },
      ];
      // 100 * 0.01 / 1 = 1.0
      expect(computeCostPerDecision(decisions, 0.01)).toBe(1.0);
    });
  });

  // ----------------------------------------------------------
  // computeReasoningQuality
  // ----------------------------------------------------------
  describe('computeReasoningQuality', () => {
    it('computes correct rate with mixed reasoning', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'This is a very well-reasoned decision about policy', success: true, latencyMs: 100 },
        { agentId: 'a2', parsedAction: 'vote', parsedReasoning: 'short', success: true, latencyMs: 100 },
        { agentId: 'a3', parsedAction: 'vote', parsedReasoning: null, success: true, latencyMs: 100 },
        { agentId: 'a4', parsedAction: 'vote', parsedReasoning: 'Another detailed reasoning statement about governance', success: true, latencyMs: 100 },
      ];
      expect(computeReasoningQuality(decisions)).toBe(0.5);
    });

    it('returns 0 for empty decisions', () => {
      expect(computeReasoningQuality([])).toBe(0);
    });

    it('returns 0 when all reasoning is short or null', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'short', success: true, latencyMs: 100 },
        { agentId: 'a2', parsedAction: 'vote', parsedReasoning: null, success: true, latencyMs: 100 },
        { agentId: 'a3', parsedAction: 'vote', parsedReasoning: '   ', success: true, latencyMs: 100 },
      ];
      expect(computeReasoningQuality(decisions)).toBe(0);
    });

    it('returns 1.0 when all reasoning is substantive', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'This is a sufficiently detailed reasoning statement', success: true, latencyMs: 100 },
        { agentId: 'a2', parsedAction: 'vote', parsedReasoning: 'Another well-thought-out reasoning for this decision', success: true, latencyMs: 100 },
      ];
      expect(computeReasoningQuality(decisions)).toBe(1.0);
    });

    it('trims whitespace before measuring length', () => {
      const decisions: SimDecision[] = [
        { agentId: 'a1', parsedAction: 'vote', parsedReasoning: '     short after trim     ', success: true, latencyMs: 100 },
      ];
      // "short after trim" is 16 chars, not > 20
      expect(computeReasoningQuality(decisions)).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // computeLegislativeIndependence
  // ----------------------------------------------------------
  describe('computeLegislativeIndependence', () => {
    it('returns 1.0 at optimal 55% yea rate', () => {
      // 55 yea, 45 nay out of 100
      const votes: SimVote[] = [
        ...Array.from({ length: 55 }, (_, i) => ({ voterId: `a${i}`, billId: 'b1', choice: 'yea' as const })),
        ...Array.from({ length: 45 }, (_, i) => ({ voterId: `n${i}`, billId: 'b1', choice: 'nay' as const })),
      ];
      expect(computeLegislativeIndependence(votes)).toBeCloseTo(1.0);
    });

    it('returns 0 for empty votes', () => {
      expect(computeLegislativeIndependence([])).toBe(0);
    });

    it('penalizes 100% yea (rubber-stamping)', () => {
      const votes: SimVote[] = [
        { voterId: 'a1', billId: 'b1', choice: 'yea' },
        { voterId: 'a2', billId: 'b1', choice: 'yea' },
        { voterId: 'a3', billId: 'b1', choice: 'yea' },
      ];
      // yeaPct=1.0, |1.0 - 0.55| * 2 = 0.9, score = 0.1
      expect(computeLegislativeIndependence(votes)).toBeCloseTo(0.1);
    });

    it('penalizes 0% yea (obstructing)', () => {
      const votes: SimVote[] = [
        { voterId: 'a1', billId: 'b1', choice: 'nay' },
        { voterId: 'a2', billId: 'b1', choice: 'nay' },
      ];
      // yeaPct=0.0, |0.0 - 0.55| * 2 = 1.1, clamped to 0
      expect(computeLegislativeIndependence(votes)).toBe(0);
    });

    it('handles 50% yea rate', () => {
      const votes: SimVote[] = [
        { voterId: 'a1', billId: 'b1', choice: 'yea' },
        { voterId: 'a2', billId: 'b1', choice: 'nay' },
      ];
      // yeaPct=0.5, |0.5 - 0.55| * 2 = 0.1, score = 0.9
      expect(computeLegislativeIndependence(votes)).toBeCloseTo(0.9);
    });
  });

  // ----------------------------------------------------------
  // computeGovernanceQuality
  // ----------------------------------------------------------
  describe('computeGovernanceQuality', () => {
    it('computes perfect score with ideal inputs', () => {
      // treasuryHealth=2.0 (max), vetoRate=0, approvalInequality=0
      // (2/2)*0.4 + (1-0)*0.3 + (1-0)*0.3 = 0.4 + 0.3 + 0.3 = 1.0
      expect(computeGovernanceQuality(2.0, 0, 0)).toBeCloseTo(1.0);
    });

    it('computes worst score with bad inputs', () => {
      // treasuryHealth=0, vetoRate=1, approvalInequality=1
      // (0/2)*0.4 + (1-1)*0.3 + (1-1)*0.3 = 0
      expect(computeGovernanceQuality(0, 1, 1)).toBe(0);
    });

    it('clamps treasuryHealth to [0, 2]', () => {
      // treasuryHealth=5.0 clamped to 2.0
      // (2/2)*0.4 + (1-0)*0.3 + (1-0)*0.3 = 1.0
      expect(computeGovernanceQuality(5.0, 0, 0)).toBeCloseTo(1.0);
    });

    it('handles moderate inputs', () => {
      // treasuryHealth=1.0, vetoRate=0.2, approvalInequality=0.3
      // (1/2)*0.4 + (0.8)*0.3 + (0.7)*0.3 = 0.2 + 0.24 + 0.21 = 0.65
      expect(computeGovernanceQuality(1.0, 0.2, 0.3)).toBeCloseTo(0.65);
    });
  });
});

// ============================================================
// COORDINATION METRICS
// ============================================================

describe('Coordination Metrics', () => {
  // ----------------------------------------------------------
  // computePartyDiscipline
  // ----------------------------------------------------------
  describe('computePartyDiscipline', () => {
    it('computes correct discipline rate', () => {
      const events: SimWhipEvent[] = [
        { agentId: 'a1', followed: true },
        { agentId: 'a2', followed: true },
        { agentId: 'a3', followed: false },
        { agentId: 'a4', followed: true },
      ];
      expect(computePartyDiscipline(events)).toBe(0.75);
    });

    it('returns 0 for empty events', () => {
      expect(computePartyDiscipline([])).toBe(0);
    });

    it('returns 1.0 when all follow', () => {
      const events: SimWhipEvent[] = [
        { agentId: 'a1', followed: true },
        { agentId: 'a2', followed: true },
      ];
      expect(computePartyDiscipline(events)).toBe(1.0);
    });

    it('returns 0 when none follow', () => {
      const events: SimWhipEvent[] = [
        { agentId: 'a1', followed: false },
        { agentId: 'a2', followed: false },
      ];
      expect(computePartyDiscipline(events)).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // computeCoalitionFormation
  // ----------------------------------------------------------
  describe('computeCoalitionFormation', () => {
    it('computes correct cross-party rate', () => {
      const collabs: SimCollaboration[] = [
        { agent1Id: 'a1', agent2Id: 'a2', party1Id: 'partyA', party2Id: 'partyB', type: 'endorsement' },
        { agent1Id: 'a3', agent2Id: 'a4', party1Id: 'partyA', party2Id: 'partyA', type: 'joint_sponsorship' },
        { agent1Id: 'a5', agent2Id: 'a6', party1Id: 'partyB', party2Id: 'partyC', type: 'endorsement' },
      ];
      // 2 cross-party / 3 total
      expect(computeCoalitionFormation(collabs)).toBeCloseTo(2 / 3);
    });

    it('returns 0 for empty collaborations', () => {
      expect(computeCoalitionFormation([])).toBe(0);
    });

    it('returns 0 when all same party', () => {
      const collabs: SimCollaboration[] = [
        { agent1Id: 'a1', agent2Id: 'a2', party1Id: 'partyA', party2Id: 'partyA', type: 'endorsement' },
      ];
      expect(computeCoalitionFormation(collabs)).toBe(0);
    });

    it('returns 1.0 when all cross-party', () => {
      const collabs: SimCollaboration[] = [
        { agent1Id: 'a1', agent2Id: 'a2', party1Id: 'partyA', party2Id: 'partyB', type: 'endorsement' },
        { agent1Id: 'a3', agent2Id: 'a4', party1Id: 'partyC', party2Id: 'partyD', type: 'joint_sponsorship' },
      ];
      expect(computeCoalitionFormation(collabs)).toBe(1.0);
    });
  });

  // ----------------------------------------------------------
  // computeDefectionRate
  // ----------------------------------------------------------
  describe('computeDefectionRate', () => {
    it('computes correct defection rate', () => {
      const events: SimWhipEvent[] = [
        { agentId: 'a1', followed: true },
        { agentId: 'a2', followed: false },
        { agentId: 'a3', followed: true },
        { agentId: 'a4', followed: false },
      ];
      expect(computeDefectionRate(events)).toBe(0.5);
    });

    it('returns 0 for empty events', () => {
      expect(computeDefectionRate([])).toBe(0);
    });

    it('returns 0 when all follow (no defection)', () => {
      const events: SimWhipEvent[] = [
        { agentId: 'a1', followed: true },
        { agentId: 'a2', followed: true },
      ];
      expect(computeDefectionRate(events)).toBe(0);
    });

    it('returns 1.0 when none follow (total defection)', () => {
      const events: SimWhipEvent[] = [
        { agentId: 'a1', followed: false },
      ];
      expect(computeDefectionRate(events)).toBe(1.0);
    });

    it('is consistent with partyDiscipline (sums to 1)', () => {
      const events: SimWhipEvent[] = [
        { agentId: 'a1', followed: true },
        { agentId: 'a2', followed: false },
        { agentId: 'a3', followed: true },
      ];
      const discipline = computePartyDiscipline(events);
      const defection = computeDefectionRate(events);
      expect(discipline + defection).toBeCloseTo(1.0);
    });
  });

  // ----------------------------------------------------------
  // computeAdversarialResilience
  // ----------------------------------------------------------
  describe('computeAdversarialResilience', () => {
    it('returns null (placeholder)', () => {
      expect(computeAdversarialResilience()).toBeNull();
    });
  });
});

// ============================================================
// COMPOSITE SCORE & GRADE
// ============================================================

describe('Composite Score & Grade', () => {
  // ----------------------------------------------------------
  // computeComposite
  // ----------------------------------------------------------
  describe('computeComposite', () => {
    const perfectOutcome: OutcomeMetrics = {
      billPassageRate: 1.0,
      committeeKillRate: 0,
      vetoRate: 0,
      timeToLaw: 10,
      crossPartyYeaRate: 0.5,
      polarizationIndex: 0,
      coalitionStability: null,
      approvalInequality: 0,
      treasuryHealth: 2.0,
      deficitTrajectory: 5,
    };

    const perfectAgent: AgentMetrics = {
      actionValidityRate: 1.0,
      successRate: 1.0,
      latencyP50: 100,
      latencyP90: 200,
      latencyP99: 300,
      costPerDecision: 0.001,
      reasoningQuality: 1.0,
      legislativeIndependence: 1.0,
      governanceQuality: 1.0,
    };

    const perfectCoord: CoordinationMetrics = {
      partyDiscipline: 1.0,
      coalitionFormation: 1.0,
      defectionRate: 0,
      adversarialResilience: null,
    };

    const equalWeights: MetricWeights = { outcome: 0.4, agent: 0.35, coordination: 0.25 };

    it('returns 100 for perfect scores', () => {
      const score = computeComposite(perfectOutcome, perfectAgent, perfectCoord, equalWeights);
      expect(score).toBe(100);
    });

    it('returns 0 for worst scores', () => {
      const worstOutcome: OutcomeMetrics = {
        billPassageRate: 0,
        committeeKillRate: 1,
        vetoRate: 1.0,
        timeToLaw: 0,
        crossPartyYeaRate: 0,
        polarizationIndex: 1.0,
        coalitionStability: null,
        approvalInequality: 1.0,
        treasuryHealth: 0,
        deficitTrajectory: -10,
      };
      const worstAgent: AgentMetrics = {
        actionValidityRate: 0,
        successRate: 0,
        latencyP50: 5000,
        latencyP90: 10000,
        latencyP99: 15000,
        costPerDecision: 0.1,
        reasoningQuality: 0,
        legislativeIndependence: 0,
        governanceQuality: 0,
      };
      const worstCoord: CoordinationMetrics = {
        partyDiscipline: 0,
        coalitionFormation: 0,
        defectionRate: 1.0,
        adversarialResilience: null,
      };
      const score = computeComposite(worstOutcome, worstAgent, worstCoord, equalWeights);
      expect(score).toBe(0);
    });

    it('respects weight distribution', () => {
      const outcomeOnly: MetricWeights = { outcome: 1.0, agent: 0, coordination: 0 };
      const score = computeComposite(perfectOutcome, perfectAgent, perfectCoord, outcomeOnly);
      expect(score).toBe(100);
    });

    it('includes adversarialResilience when not null', () => {
      const coordWithResilience: CoordinationMetrics = {
        partyDiscipline: 1.0,
        coalitionFormation: 1.0,
        defectionRate: 0,
        adversarialResilience: 0.5, // adds a 4th component
      };
      const coordOnlyWeights: MetricWeights = { outcome: 0, agent: 0, coordination: 1.0 };
      // Components: [1.0, 1.0, 1.0, 0.5], avg = 3.5/4 = 0.875, * 100 = 87.5
      const score = computeComposite(perfectOutcome, perfectAgent, coordWithResilience, coordOnlyWeights);
      expect(score).toBe(87.5);
    });

    it('rounds to 1 decimal place', () => {
      const midOutcome: OutcomeMetrics = {
        ...perfectOutcome,
        billPassageRate: 0.333,
        vetoRate: 0.1,
        treasuryHealth: 1.5,
        polarizationIndex: 0.2,
        approvalInequality: 0.15,
      };
      const score = computeComposite(midOutcome, perfectAgent, perfectCoord, equalWeights);
      // Score should have at most 1 decimal place
      expect(score).toBe(Math.round(score * 10) / 10);
    });
  });

  // ----------------------------------------------------------
  // compositeToGrade
  // ----------------------------------------------------------
  describe('compositeToGrade', () => {
    it('returns A+ for 97+', () => {
      expect(compositeToGrade(97)).toBe('A+');
      expect(compositeToGrade(100)).toBe('A+');
    });

    it('returns A for 93-96.9', () => {
      expect(compositeToGrade(93)).toBe('A');
      expect(compositeToGrade(96.9)).toBe('A');
    });

    it('returns A- for 90-92.9', () => {
      expect(compositeToGrade(90)).toBe('A-');
      expect(compositeToGrade(92.9)).toBe('A-');
    });

    it('returns B+ for 87-89.9', () => {
      expect(compositeToGrade(87)).toBe('B+');
      expect(compositeToGrade(89.9)).toBe('B+');
    });

    it('returns B for 83-86.9', () => {
      expect(compositeToGrade(83)).toBe('B');
      expect(compositeToGrade(86.9)).toBe('B');
    });

    it('returns B- for 80-82.9', () => {
      expect(compositeToGrade(80)).toBe('B-');
    });

    it('returns C+ for 77-79.9', () => {
      expect(compositeToGrade(77)).toBe('C+');
    });

    it('returns C for 73-76.9', () => {
      expect(compositeToGrade(73)).toBe('C');
    });

    it('returns C- for 70-72.9', () => {
      expect(compositeToGrade(70)).toBe('C-');
    });

    it('returns D+ for 67-69.9', () => {
      expect(compositeToGrade(67)).toBe('D+');
    });

    it('returns D for 63-66.9', () => {
      expect(compositeToGrade(63)).toBe('D');
    });

    it('returns D- for 60-62.9', () => {
      expect(compositeToGrade(60)).toBe('D-');
    });

    it('returns F for below 60', () => {
      expect(compositeToGrade(59.9)).toBe('F');
      expect(compositeToGrade(0)).toBe('F');
    });
  });
});

// ============================================================
// CONVENIENCE ASSEMBLERS
// ============================================================

describe('Convenience Assemblers', () => {
  const bills: SimBill[] = [
    { id: 'b1', status: 'law', sponsorId: 'a1', proposedAtTick: 1 },
    { id: 'b2', status: 'tabled', sponsorId: 'a2', proposedAtTick: 5 },
    { id: 'b3', status: 'vetoed', sponsorId: 'a3', proposedAtTick: 10 },
  ];
  const laws: SimLaw[] = [
    { id: 'l1', billId: 'b1', enactedAtTick: 21 },
  ];
  const memberships: SimPartyMembership[] = [
    { agentId: 'a1', partyId: 'partyA' },
    { agentId: 'a2', partyId: 'partyB' },
    { agentId: 'a3', partyId: 'partyA' },
  ];
  const votes: SimVote[] = [
    { voterId: 'a1', billId: 'b1', choice: 'yea' },
    { voterId: 'a2', billId: 'b1', choice: 'yea' },
    { voterId: 'a3', billId: 'b1', choice: 'nay' },
  ];
  const agents: SimAgent[] = [
    { id: 'a1', approvalRating: 80, alignment: 'center' },
    { id: 'a2', approvalRating: 60, alignment: 'left' },
    { id: 'a3', approvalRating: 40, alignment: 'right' },
  ];
  const snapshots: TreasurySnapshot[] = [
    { tick: 0, balance: 1000 },
    { tick: 10, balance: 950 },
    { tick: 20, balance: 900 },
  ];

  describe('computeAllOutcomeMetrics', () => {
    it('returns a complete OutcomeMetrics object', () => {
      const result = computeAllOutcomeMetrics(bills, laws, votes, memberships, agents, 1000, 900, snapshots);

      expect(result.billPassageRate).toBeCloseTo(1 / 3);
      expect(result.committeeKillRate).toBeCloseTo(1 / 3); // 1 tabled out of 3 committee-eligible
      expect(result.vetoRate).toBeCloseTo(0.5); // 1 vetoed out of 2 that reached president (law + vetoed)
      expect(result.timeToLaw).toBe(20); // 21 - 1
      expect(typeof result.crossPartyYeaRate).toBe('number');
      expect(typeof result.polarizationIndex).toBe('number');
      expect(result.coalitionStability).toBeNull();
      expect(typeof result.approvalInequality).toBe('number');
      expect(result.treasuryHealth).toBe(0.9);
      expect(result.deficitTrajectory).toBeCloseTo(-5);
    });

    it('handles empty inputs', () => {
      const result = computeAllOutcomeMetrics([], [], [], [], [], 0, 0, []);
      expect(result.billPassageRate).toBe(0);
      expect(result.committeeKillRate).toBe(0);
      expect(result.vetoRate).toBe(0);
      expect(result.timeToLaw).toBe(0);
      expect(result.crossPartyYeaRate).toBe(0);
      expect(result.polarizationIndex).toBe(0);
      expect(result.approvalInequality).toBe(0);
      expect(result.treasuryHealth).toBe(0);
      expect(result.deficitTrajectory).toBe(0);
    });
  });

  describe('computeAllAgentMetrics', () => {
    const decisions: SimDecision[] = [
      { agentId: 'a1', parsedAction: 'vote', parsedReasoning: 'A detailed reasoning about the bill in question', success: true, latencyMs: 100, tokenCount: 500 },
      { agentId: 'a2', parsedAction: 'propose', parsedReasoning: 'short', success: true, latencyMs: 200, tokenCount: 300 },
      { agentId: 'a3', parsedAction: null, parsedReasoning: null, success: false, latencyMs: 500 },
    ];

    it('returns a complete AgentMetrics object', () => {
      const result = computeAllAgentMetrics(decisions, votes, 1.0, 0.2, 0.3);

      expect(result.actionValidityRate).toBeCloseTo(2 / 3);
      expect(result.successRate).toBeCloseTo(2 / 3);
      expect(typeof result.latencyP50).toBe('number');
      expect(typeof result.latencyP90).toBe('number');
      expect(typeof result.latencyP99).toBe('number');
      expect(typeof result.costPerDecision).toBe('number');
      expect(result.reasoningQuality).toBeCloseTo(1 / 3);
      expect(typeof result.legislativeIndependence).toBe('number');
      expect(typeof result.governanceQuality).toBe('number');
    });

    it('handles empty inputs', () => {
      const result = computeAllAgentMetrics([], [], 0, 0, 0);
      expect(result.actionValidityRate).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.latencyP50).toBe(0);
      expect(result.latencyP90).toBe(0);
      expect(result.latencyP99).toBe(0);
      expect(result.costPerDecision).toBe(0);
      expect(result.reasoningQuality).toBe(0);
      expect(result.legislativeIndependence).toBe(0);
      // governanceQuality with all 0 inputs: (0/2)*0.4 + (1-0)*0.3 + (1-0)*0.3 = 0.6
      expect(result.governanceQuality).toBeCloseTo(0.6);
    });
  });

  describe('computeAllCoordinationMetrics', () => {
    it('returns a complete CoordinationMetrics object', () => {
      const whipEvents: SimWhipEvent[] = [
        { agentId: 'a1', followed: true },
        { agentId: 'a2', followed: false },
        { agentId: 'a3', followed: true },
      ];
      const collabs: SimCollaboration[] = [
        { agent1Id: 'a1', agent2Id: 'a2', party1Id: 'partyA', party2Id: 'partyB', type: 'endorsement' },
        { agent1Id: 'a1', agent2Id: 'a3', party1Id: 'partyA', party2Id: 'partyA', type: 'joint_sponsorship' },
      ];

      const result = computeAllCoordinationMetrics(whipEvents, collabs);

      expect(result.partyDiscipline).toBeCloseTo(2 / 3);
      expect(result.coalitionFormation).toBe(0.5);
      expect(result.defectionRate).toBeCloseTo(1 / 3);
      expect(result.adversarialResilience).toBeNull();
    });

    it('handles empty inputs', () => {
      const result = computeAllCoordinationMetrics([], []);
      expect(result.partyDiscipline).toBe(0);
      expect(result.coalitionFormation).toBe(0);
      expect(result.defectionRate).toBe(0);
      expect(result.adversarialResilience).toBeNull();
    });
  });
});
