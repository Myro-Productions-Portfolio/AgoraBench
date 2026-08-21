import { describe, it, expect } from 'vitest';
import {
  donationLedgerRows, expenditureLedgerRows, chooseDonationTarget,
  type EngineCampaign,
} from '@modules/elections/server/campaignEngine';
import { donationAmount, spendAmount, campaignRng } from '@core/server/lib/campaignMath';
import { tallyElectionVotes, pickContributionsFallback, selectTopNWinners, type CandidateStanding } from '@core/server/lib/electionMath';

/* ---- Conservation fold — the engine materializes exactly these row
       shapes inside its per-donation / per-expenditure transactions. ---- */

describe('donation ledger conservation', () => {
  it('one donation = one wallet debit + one NULL-destination tx + one ledger row, same amount everywhere', () => {
    const rows = donationLedgerRows({
      donorId: 'donor-1', amount: 500, balanceAfter: 249_500,
      electionId: 'e1', campaignId: 'c1', tick: 100,
      candidateName: 'Ada', positionType: 'president', selfFunded: false,
    });
    expect(rows.txRow.fromAgentId).toBe('donor-1');
    expect(rows.txRow.toAgentId).toBeNull();
    expect(rows.txRow.type).toBe('donation');
    expect(rows.txRow.balanceAfter).toBe(249_500);
    expect(rows.txRow.amount).toBe(500);
    expect(rows.donationRow.amount).toBe(500);
    expect(rows.contributionsDelta).toBe(500);
    expect(rows.donationRow).toEqual({ electionId: 'e1', campaignId: 'c1', donorAgentId: 'donor-1', amount: 500, tick: 100 });
  });

  it('folding a donation sequence: balanceAfter chain reconstructs (RETURNING semantics) and sum(donations) == contributions', () => {
    let balance = 250_000;
    let contributions = 0;
    const txChain: number[] = [];
    const donations: number[] = [];
    for (let tick = 100; tick < 130; tick++) {
      const amount = donationAmount(balance, 0.2, 'medium', campaignRng(tick, 'e1', 'donor-1', 'donation'));
      if (amount <= 0) continue;
      balance -= amount; // what UPDATE ... RETURNING balance reports
      const rows = donationLedgerRows({
        donorId: 'donor-1', amount, balanceAfter: balance,
        electionId: 'e1', campaignId: 'c1', tick,
        candidateName: 'Ada', positionType: 'president', selfFunded: false,
      });
      txChain.push(rows.txRow.balanceAfter);
      donations.push(rows.donationRow.amount);
      contributions += rows.contributionsDelta;
    }
    expect(donations.length).toBeGreaterThan(0);
    /* Chain reconstructs: balanceAfter_n == balanceAfter_{n-1} − amount_n. */
    let replay = 250_000;
    donations.forEach((amt, i) => {
      replay -= amt;
      expect(txChain[i]).toBe(replay);
    });
    expect(donations.reduce((s, v) => s + v, 0)).toBe(contributions);
    expect(balance).toBeGreaterThanOrEqual(0);
  });

  it('expenditures are NULL->NULL with no balanceAfter, and spent never exceeds contributions', () => {
    const one = expenditureLedgerRows({ amount: 400, candidateName: 'Ada', positionType: 'president' });
    expect(one.txRow.fromAgentId).toBeNull();
    expect(one.txRow.toAgentId).toBeNull();
    expect(one.txRow.balanceAfter).toBeNull();
    expect(one.txRow.type).toBe('campaign_expenditure');
    expect(one.spentDelta).toBe(400);

    const contributions = 50_000;
    let spent = 0;
    for (let tick = 0; tick < 60; tick++) {
      const available = contributions - spent;
      const amount = spendAmount(available, 20, campaignRng(tick, 'c1', 'spend'));
      if (amount <= 0) continue;
      spent += expenditureLedgerRows({ amount, candidateName: 'Ada', positionType: 'president' }).spentDelta;
      expect(spent).toBeLessThanOrEqual(contributions);
    }
    expect(spent).toBeGreaterThan(0);
  });
});

/* ---- Donation target choice ------------------------------------------ */

const raceCampaigns: EngineCampaign[] = [
  { id: 'camp-1', electionId: 'e1', agentId: 'agent-1', status: 'active' },
  { id: 'camp-2', electionId: 'e1', agentId: 'agent-2', status: 'active' },
];

describe('chooseDonationTarget', () => {
  it('honors the stance while the preferred campaign is still active', () => {
    expect(chooseDonationTarget('camp-2', raceCampaigns, new Map())?.id).toBe('camp-2');
  });
  it('re-routes to the highest-alignment candidate when the preferred campaign left the race', () => {
    const align = new Map([['agent-1', 0.3], ['agent-2', 0.9]]);
    expect(chooseDonationTarget('camp-gone', raceCampaigns, align)?.id).toBe('camp-2');
  });
  it('falls back to registration order with no stance and no alignment data', () => {
    expect(chooseDonationTarget(null, raceCampaigns, new Map())?.id).toBe('camp-1');
    expect(chooseDonationTarget(null, [], new Map())).toBeNull();
  });
});

/* ---- R8 pin: dollar-scale contributions never override ballots -------- */

const richField: CandidateStanding[] = [
  { agentId: 'poor', totalContributions: 120, startDate: '2026-01-01', campaignId: 'c-poor' },
  { agentId: 'rich', totalContributions: 3_000_000_000_000, startDate: '2026-01-02', campaignId: 'c-rich' },
];

describe('R8: money decides only where ballots do not exist', () => {
  it('a single ballot beats a $3T war chest (usedFallback=false whenever ballots > 0)', () => {
    const order = ['poor', 'rich'];
    const tally = tallyElectionVotes([{ candidateId: 'poor' }], order, pickContributionsFallback(richField));
    expect(tally.winnerId).toBe('poor');
    expect(tally.usedFallback).toBe(false);
    expect(tally.totalVotes).toBe(1);
  });
  it('zero ballots fall back to the contribution leader at bigint magnitudes', () => {
    const tally = tallyElectionVotes([], ['poor', 'rich'], pickContributionsFallback(richField));
    expect(tally.winnerId).toBe('rich');
    expect(tally.usedFallback).toBe(true);
  });
  it('selectTopNWinners: votes dominate; bigint contributions only break exact vote ties, without precision loss', () => {
    const winners = selectTopNWinners(richField, { poor: 2, rich: 1 }, 1);
    expect(winners).toEqual(['poor']);
    const tied = selectTopNWinners(richField, { poor: 1, rich: 1 }, 1);
    expect(tied).toEqual(['rich']); // vote tie -> contributions second key
    const closeMoney: CandidateStanding[] = [
      { agentId: 'a', totalContributions: 3_000_000_000_001, startDate: '2026-01-01', campaignId: 'c-a' },
      { agentId: 'b', totalContributions: 3_000_000_000_000, startDate: '2026-01-01', campaignId: 'c-b' },
    ];
    expect(selectTopNWinners(closeMoney, {}, 1)).toEqual(['a']); // $1 difference resolves at 1e12 scale
  });
});
