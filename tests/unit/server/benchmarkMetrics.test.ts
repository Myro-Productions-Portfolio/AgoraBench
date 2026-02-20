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
} from '../../../src/server/services/benchmarkMetrics';
import type {
  SimBill,
  SimLaw,
  SimVote,
  SimAgent,
  SimPartyMembership,
  TreasurySnapshot,
} from '../../../src/server/services/benchmarkMetrics';

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
        { id: 'b5', status: 'proposed', sponsorId: 'a5', proposedAtTick: 5 },
      ];
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
        { id: 'b5', status: 'tabled', sponsorId: 'a5', proposedAtTick: 5 },
      ];
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
        { id: 'l1', billId: 'b1', enactedAtTick: 25 },
        { id: 'l2', billId: 'b2', enactedAtTick: 40 },
      ];
      expect(computeTimeToLaw(bills, laws)).toBe(25);
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
        { id: 'l2', billId: 'b_missing', enactedAtTick: 30 },
      ];
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
      { id: 'b1', status: 'floor', sponsorId: 'a1', proposedAtTick: 1 },
    ];

    it('computes correct cross-party yea rate', () => {
      const votes: SimVote[] = [
        { voterId: 'a1', billId: 'b1', choice: 'yea' },
        { voterId: 'a2', billId: 'b1', choice: 'yea' },
        { voterId: 'a3', billId: 'b1', choice: 'yea' },
        { voterId: 'a4', billId: 'b1', choice: 'nay' },
      ];
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
        { voterId: 'a3', billId: 'b1', choice: 'yea' },
        { voterId: 'a4', billId: 'b1', choice: 'yea' },
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
        { voterId: 'a1', billId: 'b1', choice: 'yea' },
        { voterId: 'a2', billId: 'b1', choice: 'nay' },
      ];
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
      expect(computeDeficitTrajectory(snapshots)).toBeCloseTo(10);
    });
  });
});
