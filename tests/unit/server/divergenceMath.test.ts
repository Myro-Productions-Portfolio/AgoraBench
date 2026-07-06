import { describe, it, expect } from 'vitest';
import {
  categoryShares,
  l1CategoryDistance,
  fytdToDailyAverage,
  debtToGdpPct,
  annualizedShareOfGdpPct,
  PROGRAM_TO_MTS_CATEGORY,
  UNMAPPED_CATEGORY_LABEL,
  isFiscallyActive,
  programContinuityStatus,
} from '@modules/government/server/lib/divergenceMath';

describe('categoryShares', () => {
  it('computes share-of-total for a simple set of rows', () => {
    const shares = categoryShares([
      { name: 'A', amount: 25 },
      { name: 'B', amount: 75 },
    ]);
    expect(shares.get('A')).toBeCloseTo(0.25);
    expect(shares.get('B')).toBeCloseTo(0.75);
  });

  it('folds unmapped names into UNMAPPED_CATEGORY_LABEL when mapTo is provided', () => {
    const shares = categoryShares(
      [
        { name: 'Social Security', amount: 100 },
        { name: 'Some Obscure Program', amount: 100 },
      ],
      (name) => (name === 'Social Security' ? 'Social Security' : null),
    );
    expect(shares.get('Social Security')).toBeCloseTo(0.5);
    expect(shares.get(UNMAPPED_CATEGORY_LABEL)).toBeCloseTo(0.5);
  });

  it('merges multiple rows that map to the same label', () => {
    const shares = categoryShares(
      [
        { name: 'Veterans Services', amount: 50 },
        { name: 'Education & Workforce', amount: 50 },
      ],
      () => UNMAPPED_CATEGORY_LABEL,
    );
    expect(shares.get(UNMAPPED_CATEGORY_LABEL)).toBeCloseTo(1);
    expect(shares.size).toBe(1);
  });

  it('treats non-finite or negative amounts as 0 (never inflate the total)', () => {
    const shares = categoryShares([
      { name: 'A', amount: 100 },
      { name: 'B', amount: -50 },
      { name: 'C', amount: NaN },
    ]);
    expect(shares.get('A')).toBeCloseTo(1);
    expect(shares.has('B')).toBe(false);
    expect(shares.has('C')).toBe(false);
  });

  it('returns an empty map when the grand total is zero or negative', () => {
    expect(categoryShares([]).size).toBe(0);
    expect(categoryShares([{ name: 'A', amount: 0 }]).size).toBe(0);
  });
});

describe('l1CategoryDistance', () => {
  it('returns 0 for identical mixes', () => {
    const a = new Map([['A', 0.5], ['B', 0.5]]);
    const b = new Map([['A', 0.5], ['B', 0.5]]);
    expect(l1CategoryDistance(a, b)).toBe(0);
  });

  it('returns 2 for fully disjoint mixes', () => {
    const a = new Map([['A', 1]]);
    const b = new Map([['B', 1]]);
    expect(l1CategoryDistance(a, b)).toBe(2);
  });

  it('hand-computed partial overlap case', () => {
    // a: A=0.6, B=0.4    b: A=0.3, B=0.3, C=0.4
    // |0.6-0.3| + |0.4-0.3| + |0-0.4| = 0.3 + 0.1 + 0.4 = 0.8
    const a = new Map([['A', 0.6], ['B', 0.4]]);
    const b = new Map([['A', 0.3], ['B', 0.3], ['C', 0.4]]);
    expect(l1CategoryDistance(a, b)).toBeCloseTo(0.8);
  });

  it('returns null when either side has no data', () => {
    const a = new Map([['A', 1]]);
    expect(l1CategoryDistance(a, new Map())).toBeNull();
    expect(l1CategoryDistance(new Map(), a)).toBeNull();
    expect(l1CategoryDistance(new Map(), new Map())).toBeNull();
  });
});

describe('fytdToDailyAverage', () => {
  it('divides FYTD amount by elapsed fiscal-year days (FY starts Oct 1)', () => {
    // 2026-05-31 is 242 days after 2025-10-01 (FY2026 start)
    const result = fytdToDailyAverage(242_000, '2026-05-31');
    expect(result).toBeCloseTo(1000, 0);
  });

  it('handles a date in the first month of the fiscal year (October)', () => {
    // 2025-10-15 is 14 elapsed days after 2025-10-01 (Math.round(14 days in ms))
    const result = fytdToDailyAverage(1400, '2025-10-15');
    expect(result).toBeCloseTo(100, 0);
  });

  it('returns 0 for non-finite fytdAmount or unparseable date', () => {
    expect(fytdToDailyAverage(NaN, '2026-05-31')).toBe(0);
    expect(fytdToDailyAverage(1000, 'not-a-date')).toBe(0);
  });
});

describe('debtToGdpPct', () => {
  it('computes percentage to one decimal place', () => {
    expect(debtToGdpPct(30_000_000_000_000, 28_000_000_000_000)).toBeCloseTo(107.1, 1);
  });

  it('guards division by zero / non-positive gdp', () => {
    expect(debtToGdpPct(1000, 0)).toBe(0);
    expect(debtToGdpPct(1000, -5)).toBe(0);
  });

  it('returns 0 for non-finite debt', () => {
    expect(debtToGdpPct(NaN, 28_000_000_000_000)).toBe(0);
  });
});

describe('annualizedShareOfGdpPct', () => {
  it('annualizes a daily average and expresses it as % of GDP', () => {
    // 14.6B/day * 365 = 5.329T ~ 19% of 28T
    const result = annualizedShareOfGdpPct(14_600_000_000, 28_000_000_000_000);
    expect(result).toBeCloseTo(19.0, 0);
  });

  it('guards division by zero / non-positive gdp', () => {
    expect(annualizedShareOfGdpPct(1000, 0)).toBe(0);
  });

  it('returns 0 for non-finite dailyAverage', () => {
    expect(annualizedShareOfGdpPct(NaN, 28_000_000_000_000)).toBe(0);
  });
});

describe('PROGRAM_TO_MTS_CATEGORY', () => {
  it('maps the obvious seed programs to their real MTS category names', () => {
    expect(PROGRAM_TO_MTS_CATEGORY['Social Security']).toBe('Social Security');
    expect(PROGRAM_TO_MTS_CATEGORY['Medicare']).toBe('Medicare');
    expect(PROGRAM_TO_MTS_CATEGORY['National Defense']).toBe('National Defense');
  });
});

describe('isFiscallyActive', () => {
  it('includes a mandatory law with programActive = null (the seeded default -- regression guard for the missing-$11.419B/day bug)', () => {
    expect(
      isFiscallyActive({ isActive: true, fiscalKind: 'mandatory', programActive: null }),
    ).toBe(true);
  });

  it('includes a mandatory law even when programActive is explicitly false (mandatory never lapses)', () => {
    expect(
      isFiscallyActive({ isActive: true, fiscalKind: 'mandatory', programActive: false }),
    ).toBe(true);
  });

  it('excludes a mandatory law when isActive is false', () => {
    expect(
      isFiscallyActive({ isActive: false, fiscalKind: 'mandatory', programActive: null }),
    ).toBe(false);
  });

  it('includes a spend_recurring law only when programActive === true', () => {
    expect(
      isFiscallyActive({ isActive: true, fiscalKind: 'spend_recurring', programActive: true }),
    ).toBe(true);
    expect(
      isFiscallyActive({ isActive: true, fiscalKind: 'spend_recurring', programActive: false }),
    ).toBe(false);
    expect(
      isFiscallyActive({ isActive: true, fiscalKind: 'spend_recurring', programActive: null }),
    ).toBe(false);
  });

  it('excludes a spend_recurring law when isActive is false, even with programActive true', () => {
    expect(
      isFiscallyActive({ isActive: false, fiscalKind: 'spend_recurring', programActive: true }),
    ).toBe(false);
  });

  it('excludes non-spending fiscalKinds (spend_once, tax_change, null)', () => {
    expect(isFiscallyActive({ isActive: true, fiscalKind: 'spend_once', programActive: null })).toBe(false);
    expect(isFiscallyActive({ isActive: true, fiscalKind: 'tax_change', programActive: null })).toBe(false);
    expect(isFiscallyActive({ isActive: true, fiscalKind: null, programActive: null })).toBe(false);
  });
});

describe('programContinuityStatus', () => {
  it('reports Funded for a mandatory law with programActive = null (never lapses)', () => {
    expect(
      programContinuityStatus({
        fiscalKind: 'mandatory',
        programActive: null,
        enactedTick: 770,
        lastRenewedTick: null,
      }),
    ).toBe('Funded');
  });

  it('reports Lapsed for a spend_recurring law with programActive = false', () => {
    expect(
      programContinuityStatus({
        fiscalKind: 'spend_recurring',
        programActive: false,
        enactedTick: 770,
        lastRenewedTick: 770,
      }),
    ).toBe('Lapsed');
  });

  it('never reports Lapsed for a mandatory law even if programActive were somehow false', () => {
    expect(
      programContinuityStatus({
        fiscalKind: 'mandatory',
        programActive: false,
        enactedTick: 770,
        lastRenewedTick: 770,
      }),
    ).toBe('Funded');
  });

  it('reports Amended when lastRenewedTick > enactedTick', () => {
    expect(
      programContinuityStatus({
        fiscalKind: 'spend_recurring',
        programActive: true,
        enactedTick: 770,
        lastRenewedTick: 800,
      }),
    ).toBe('Amended');
  });

  it('reports Funded for a spend_recurring law that has not been renewed or lapsed', () => {
    expect(
      programContinuityStatus({
        fiscalKind: 'spend_recurring',
        programActive: true,
        enactedTick: 770,
        lastRenewedTick: null,
      }),
    ).toBe('Funded');
  });
});
