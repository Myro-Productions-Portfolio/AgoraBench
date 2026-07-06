import { describe, it, expect } from 'vitest';
import {
  SEED_LAWS,
  SEED_TAX_RATE_PERCENT,
  SEED_POPULATION,
  sumSeedAmountByKind,
  computeExpectedDeficit,
} from '@core/server/lib/divergenceSeed';

describe('SEED_LAWS', () => {
  it('has exactly 12 rows (5 mandatory + 7 spend_recurring: Defense + 6 named nondefense)', () => {
    // Spec table (DIVERGENCE_EXPERIMENT.md §2.2): 5 mandatory programs + National
    // Defense + 6 named nondefense discretionary programs = 12 law rows. "Net
    // Interest" is the table's 13th line but is explicitly "— (automatic via
    // debt engine)", not a law — it is never inserted as a row here.
    expect(SEED_LAWS.length).toBe(12);
    expect(SEED_LAWS.filter((l) => l.kind === 'mandatory').length).toBe(5);
    expect(SEED_LAWS.filter((l) => l.kind === 'spend_recurring').length).toBe(7);
  });

  it('every row has a non-empty title, summary, fullText, and programName', () => {
    for (const law of SEED_LAWS) {
      expect(law.title.length).toBeGreaterThan(0);
      expect(law.summary.length).toBeGreaterThan(0);
      expect(law.fullText.length).toBeGreaterThan(0);
      expect(law.programName.length).toBeGreaterThan(0);
      expect(law.amountPerDay).toBeGreaterThan(0);
    }
  });

  it('titles are unique', () => {
    const titles = SEED_LAWS.map((l) => l.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('sumSeedAmountByKind', () => {
  it('mandatory total is exactly $11.419B/day (spec §2.2 sum)', () => {
    // 4.315B + 2.707B + 1.830B + 2.118B + 0.449B
    expect(sumSeedAmountByKind('mandatory')).toBe(11_419_000_000);
  });

  it('spend_recurring total is exactly $5.132B/day (defense 2.447B + nondefense 2.685B)', () => {
    // 2.447B defense + (450+450+450+445+445+445)M nondefense = 2.447B + 2.685B
    expect(sumSeedAmountByKind('spend_recurring')).toBe(5_132_000_000);
  });

  it('the six nondefense discretionary programs sum to exactly $2.685B/day', () => {
    const nondefense = SEED_LAWS.filter(
      (l) => l.kind === 'spend_recurring' && l.programName !== 'National Defense',
    );
    expect(nondefense.length).toBe(6);
    const total = nondefense.reduce((acc, l) => acc + l.amountPerDay, 0);
    expect(total).toBe(2_685_000_000);
  });

  it('mandatory + recurring totals ~$16.551B/day, matching ~$19.2B/day total minus ~$2.66B net interest', () => {
    const total = sumSeedAmountByKind('mandatory') + sumSeedAmountByKind('spend_recurring');
    expect(total).toBe(16_551_000_000);
    // Spec: total ≈$19.2B/day = 16.551B seeded + ~2.66B net interest (automatic, not a law).
    const impliedInterest = 19_200_000_000 - total;
    expect(impliedInterest).toBeCloseTo(2_649_000_000, -6);
  });
});

describe('SEED_TAX_RATE_PERCENT / SEED_POPULATION', () => {
  it('tax rate resets to 19', () => {
    expect(SEED_TAX_RATE_PERCENT).toBe(19);
  });

  it('population is the real 2025 figure, not the old 330M placeholder', () => {
    expect(SEED_POPULATION).toBe(341_800_000);
  });
});

describe('computeExpectedDeficit', () => {
  it('matches the spec sanity check: ~$14.6B revenue vs ~$19.2B spending -> ~-$4.6B/day deficit', () => {
    const gdpAnnual = 28_000_000_000_000;
    const debtOutstanding = 30_000_000_000_000; // ~$30T scale per spec
    const debtInterestRatePct = 2.7;
    const result = computeExpectedDeficit(gdpAnnual, SEED_TAX_RATE_PERCENT, debtOutstanding, debtInterestRatePct);

    // floor(28e12 * 19 / 100 / 365)
    expect(result.dailyRevenue).toBe(Math.floor((gdpAnnual * 19) / 100 / 365));
    expect(result.dailyRevenue).toBeGreaterThan(14_000_000_000);
    expect(result.dailyRevenue).toBeLessThan(15_500_000_000);

    expect(result.totalMandatoryPerDay).toBe(11_419_000_000);
    expect(result.totalRecurringPerDay).toBe(5_132_000_000);

    // floor(30e12 * 2.7 / 100 / 365)
    expect(result.dailyInterest).toBe(Math.floor((debtOutstanding * debtInterestRatePct) / 100 / 365));

    expect(result.totalSpendingPerDay).toBe(
      result.totalMandatoryPerDay + result.totalRecurringPerDay + result.dailyInterest,
    );
    expect(result.netPerDay).toBe(result.dailyRevenue - result.totalSpendingPerDay);

    // Deficit (negative net), roughly in the -$4.6B to -$4.9B/day range the spec predicts.
    expect(result.netPerDay).toBeLessThan(0);
    expect(result.netPerDay).toBeGreaterThan(-6_000_000_000);
    expect(result.netPerDay).toBeLessThan(-3_500_000_000);
  });

  it('zero debt means zero interest and a smaller deficit', () => {
    const result = computeExpectedDeficit(28_000_000_000_000, 19, 0, 2.7);
    expect(result.dailyInterest).toBe(0);
    expect(result.totalSpendingPerDay).toBe(result.totalMandatoryPerDay + result.totalRecurringPerDay);
  });

  it('non-finite / non-positive inputs degrade to 0 revenue and 0 interest, never NaN', () => {
    const result = computeExpectedDeficit(NaN, -5, Infinity, NaN);
    expect(result.dailyRevenue).toBe(0);
    expect(result.dailyInterest).toBe(0);
    expect(Number.isFinite(result.netPerDay)).toBe(true);
  });
});
