import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  donationLedgerRows, expenditureLedgerRows, chooseDonationTarget,
  type EngineCampaign,
} from '@modules/elections/server/campaignEngine';
import { donationAmount, spendAmount, campaignRng } from '@core/server/lib/campaignMath';
import { tallyElectionVotes, pickContributionsFallback, selectTopNWinners, type CandidateStanding } from '@core/server/lib/electionMath';
import { campaignDonations } from '@modules/elections/db/schema/campaignFinance';
import { campaigns } from '@modules/elections/db/schema/elections';

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

/* ---- Rerun safety: the two money movers under same-tickNumber reruns --
       Bull retries + stalled-job requeue re-run a tick with the SAME
       tickNumber. Schema constraints + write predicates make both movers
       0-row no-ops on the second pass; these tests pin (1) the schema
       declarations and the engine's write protocol (source-structural,
       same style as campaignMintBranch.test.ts), and (2) the rollback
       semantics as a ledger fold. ---- */

const engineSource = readFileSync(
  resolve(__dirname, '../../../src/modules/elections/server/campaignEngine.ts'),
  'utf8',
);

describe('rerun-safe money movers', () => {
  it('campaign_donations declares UNIQUE(campaign_id, donor_agent_id, tick)', () => {
    const cfg = getTableConfig(campaignDonations);
    const unique = cfg.uniqueConstraints.find(
      (u) => u.name === 'campaign_donations_campaign_donor_tick_unique',
    );
    expect(unique).toBeDefined();
    expect(unique!.columns.map((c) => c.name).sort()).toEqual(
      ['campaign_id', 'donor_agent_id', 'tick'].sort(),
    );
  });

  it('campaigns carries last_spend_tick and the engine guards the spend UPDATE with it', () => {
    const cfg = getTableConfig(campaigns);
    expect(cfg.columns.some((c) => c.name === 'last_spend_tick')).toBe(true);
    /* Source pins: rerun predicate + overspend predicate on the UPDATE, and
       the ledger insert only after the guard (guarded.length check). */
    expect(engineSource).toContain('lastSpendTick} IS NULL OR ${campaigns.lastSpendTick} <');
    expect(engineSource).toContain('spent} + ${amount} <= ${campaigns.contributions}');
    expect(engineSource.indexOf('guarded.length === 0')).toBeGreaterThan(-1);
    expect(engineSource.indexOf('guarded.length === 0')).toBeLessThan(
      engineSource.indexOf('expenditureLedgerRows({ amount, candidateName, positionType })'),
    );
  });

  it('drip tracks the RETURNING balance, never an in-memory subtraction', () => {
    expect(engineSource).toContain('balances.set(donorId, newBalance)');
    expect(engineSource).not.toContain('balances.set(donorId, (balances.get(donorId) ?? 0) - amount)');
    /* And the drip insert must NOT swallow the rerun violation (match the
       call form — a comment naming the API is allowed). */
    const dripSlice = engineSource.slice(
      engineSource.indexOf('export async function runDonationDrip'),
      engineSource.indexOf('export async function runCampaignSpending'),
    );
    expect(dripSlice).not.toContain('.onConflictDoNothing(');
  });

  it('rerun fold: a duplicate (campaign, donor, tick) aborts the whole donation, rolling the debit back', () => {
    /* Models the engine tx protocol: debit -> tx row -> donation insert
       (unique-guarded) -> contributions. A dup key throws mid-tx; every
       prior write in the model is discarded, mirroring ROLLBACK. */
    const seen = new Set<string>();
    let balance = 250_000;
    let contributions = 0;
    const apply = (campaignId: string, donorId: string, tick: number, amount: number): void => {
      const pre = { balance, contributions };
      try {
        balance -= amount;
        const key = `${campaignId}:${donorId}:${tick}`;
        if (seen.has(key)) throw new Error('campaign_donations_campaign_donor_tick_unique');
        seen.add(key);
        contributions += amount;
      } catch (err) {
        balance = pre.balance;
        contributions = pre.contributions;
        throw err;
      }
    };
    apply('c1', 'donor-1', 100, 500);
    expect(balance).toBe(249_500);
    expect(contributions).toBe(500);
    expect(() => apply('c1', 'donor-1', 100, 500)).toThrow(/campaign_donations_campaign_donor_tick_unique/);
    expect(balance).toBe(249_500);      // debit rolled back
    expect(contributions).toBe(500);    // no double credit
  });

  it('spend fold: same-tick rerun and overspend are 0-row no-ops (no ledger row, no spent change)', () => {
    let spent = 0;
    let lastSpendTick: number | null = null;
    const contributions = 1_000;
    const ledgerRows: number[] = [];
    const guardedSpend = (tick: number, amount: number): boolean => {
      const passes = (lastSpendTick === null || lastSpendTick < tick) && spent + amount <= contributions;
      if (!passes) return false;   // 0 rows -> tx commits empty, nothing written
      spent += amount;
      lastSpendTick = tick;
      ledgerRows.push(amount);
      return true;
    };
    expect(guardedSpend(100, 400)).toBe(true);
    expect(guardedSpend(100, 400)).toBe(false);  // rerun, same tick
    expect(spent).toBe(400);
    expect(ledgerRows).toEqual([400]);
    expect(guardedSpend(101, 700)).toBe(false);  // 400 + 700 > 1000 overspend
    expect(spent).toBe(400);
    expect(guardedSpend(101, 600)).toBe(true);   // exactly to the chest limit
    expect(spent).toBe(1_000);
    expect(ledgerRows).toEqual([400, 600]);
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
