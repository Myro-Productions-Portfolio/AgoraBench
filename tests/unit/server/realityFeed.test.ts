import { describe, it, expect } from 'vitest';
import {
  dollarStringToBigintDollars,
  normalizeMts9Row,
  normalizeMts1Row,
  normalizeDebtToPennyRow,
  pickCurrentFyYtdRow,
  REALITY_PULL_EVERY_N_TICKS,
} from '@modules/government/server/lib/realityFeed';
import mts9Fixture from '../../fixtures/reality/mts_table_9.json';
import mts1Fixture from '../../fixtures/reality/mts_table_1.json';
import mts1DualFyFixture from '../../fixtures/reality/mts_table_1_dual_fy.json';
import debtFixture from '../../fixtures/reality/debt_to_penny.json';
import malformedFixture from '../../fixtures/reality/malformed.json';

/* These fixtures are trimmed captures of REAL responses from
   api.fiscaldata.treasury.gov (confirmed field names, no guessing) --
   tests never hit the network. See realityFeed.ts header comment for the
   field-name provenance note. */

describe('dollarStringToBigintDollars', () => {
  it('floors a decimal-string dollar amount to whole-dollar bigint (number)', () => {
    expect(dollarStringToBigintDollars('335512183227.42')).toBe(335512183227);
    expect(dollarStringToBigintDollars('1097023926069.25')).toBe(1097023926069);
  });

  it('floors toward negative infinity for negative amounts (Math.floor semantics)', () => {
    expect(dollarStringToBigintDollars('-7867543711.68')).toBe(-7867543712);
  });

  it('returns null for null, undefined, empty, or non-numeric input', () => {
    expect(dollarStringToBigintDollars(null)).toBeNull();
    expect(dollarStringToBigintDollars(undefined)).toBeNull();
    expect(dollarStringToBigintDollars('')).toBeNull();
    expect(dollarStringToBigintDollars('   ')).toBeNull();
    expect(dollarStringToBigintDollars('not-a-number')).toBeNull();
  });

  it('handles whole-dollar strings with no cents', () => {
    expect(dollarStringToBigintDollars('1000')).toBe(1000);
  });
});

describe('normalizeMts9Row', () => {
  const rows = (mts9Fixture as { data: Parameters<typeof normalizeMts9Row>[0][] }).data;

  it('normalizes a real National Defense category row', () => {
    const row = rows.find((r) => r.classification_desc === 'National Defense')!;
    const result = normalizeMts9Row(row);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      recordDate: '2026-05-31',
      category: 'National Defense',
      outlaysFytd: 630901173383,
      receiptsFytd: null,
      deficitFytd: null,
      debtOutstanding: null,
      source: 'mts_table_9',
      fiscalYear: 2026,
      fiscalMonth: 5,
    });
  });

  it('normalizes Social Security, Medicare, Net Interest category rows with correct bigint conversion', () => {
    const ss = normalizeMts9Row(rows.find((r) => r.classification_desc === 'Social Security')!);
    const medicare = normalizeMts9Row(rows.find((r) => r.classification_desc === 'Medicare')!);
    const interest = normalizeMts9Row(rows.find((r) => r.classification_desc === 'Net Interest')!);

    expect(ss?.outlaysFytd).toBe(1097023926069);
    expect(medicare?.outlaysFytd).toBe(676805274183);
    expect(interest?.outlaysFytd).toBe(722706511243);
  });

  it('preserves negative FYTD amounts (e.g. Commerce and Housing Credit runs negative from offsetting receipts)', () => {
    const row = rows.find((r) => r.classification_desc === 'Commerce and Housing Credit')!;
    const result = normalizeMts9Row(row);
    expect(result?.outlaysFytd).toBe(-7867543712);
  });

  it('returns null for section-header rows with null amounts (e.g. "Receipts")', () => {
    const row = rows.find((r) => r.classification_desc === 'Receipts')!;
    expect(normalizeMts9Row(row)).toBeNull();
  });

  it('returns null (not throw) for a malformed/missing row', () => {
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeMts9Row({})).toBeNull();
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeMts9Row(malformedFixture)).toBeNull();
  });
});

describe('normalizeMts1Row', () => {
  const rows = (mts1Fixture as { data: Parameters<typeof normalizeMts1Row>[0][] }).data;

  it('normalizes the Year-to-Date top-line row (receipts/outlays/deficit FYTD)', () => {
    const row = rows.find((r) => r.classification_desc === 'Year-to-Date')!;
    const result = normalizeMts1Row(row);
    expect(result).toMatchObject({
      recordDate: '2026-05-31',
      // '' not null -- Postgres treats every NULL as distinct under the
      // unique constraint, which would defeat idempotent re-pulls.
      category: '',
      receiptsFytd: 3655648146756,
      outlaysFytd: 4901851413143,
      deficitFytd: 1246203266386,
      debtOutstanding: null,
      source: 'mts_table_1',
    });
  });

  it('does not confuse a single-month row for the FYTD total (different scale, still a valid row)', () => {
    const row = rows.find((r) => r.classification_desc === 'May')!;
    const result = normalizeMts1Row(row);
    // The puller only ever queries classification_desc=Year-to-Date rows
    // live, but the normalizer itself is agnostic to which row it's given --
    // it just converts whatever amounts are present. Confirm it still
    // converts correctly rather than silently misreading month-scale data.
    expect(result?.receiptsFytd).toBe(335512183227);
    expect(result?.outlaysFytd).toBe(628160645311);
  });

  it('returns null (not throw) for a malformed row', () => {
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeMts1Row({})).toBeNull();
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeMts1Row(malformedFixture)).toBeNull();
  });
});

describe('normalizeDebtToPennyRow', () => {
  const rows = (debtFixture as { data: Parameters<typeof normalizeDebtToPennyRow>[0][] }).data;

  it('normalizes the latest total public debt outstanding', () => {
    const row = rows[0];
    const result = normalizeDebtToPennyRow(row);
    expect(result).toMatchObject({
      recordDate: '2026-07-03',
      category: '',
      outlaysFytd: null,
      receiptsFytd: null,
      deficitFytd: null,
      debtOutstanding: 36864197532086,
      source: 'debt_to_penny',
    });
  });

  it('returns null (not throw) for a malformed row', () => {
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeDebtToPennyRow({})).toBeNull();
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeDebtToPennyRow(malformedFixture)).toBeNull();
  });
});

describe('pickCurrentFyYtdRow', () => {
  /* MTS Table 1 emits one "Year-to-Date" row PER fiscal-year comparison
     section (current FY + prior FY), both with classification_desc=
     'Year-to-Date' and data_type_cd='T' -- confirmed live 2026-07-06. Both
     share the same record_date, so upserting both naively collides on the
     (recordDate, category='', source) unique key and the wrong one can
     silently win. The current-FY section's row always carries the higher
     src_line_nbr (prior-FY's section prints first). */
  const rows = (mts1DualFyFixture as { data: Parameters<typeof normalizeMts1Row>[0][] }).data;

  it('picks the current-FY row (higher src_line_nbr), not the prior-FY comparison row', () => {
    const picked = pickCurrentFyYtdRow(rows);
    expect(picked).not.toBeNull();
    expect(picked?.src_line_nbr).toBe('24');

    const normalized = normalizeMts1Row(picked!);
    // FY2026 current-year YTD through May: $4.90T outlays, NOT the FY2025
    // full-year $7.01T figure from the prior-FY comparison row.
    expect(normalized?.outlaysFytd).toBe(4901851413143);
    expect(normalized?.receiptsFytd).toBe(3655648146756);
  });

  it('returns null for an empty row list', () => {
    expect(pickCurrentFyYtdRow([])).toBeNull();
  });

  it('is a no-op passthrough when only one candidate row exists', () => {
    const single = [rows[0]];
    expect(pickCurrentFyYtdRow(single)).toBe(single[0]);
  });
});

describe('REALITY_PULL_EVERY_N_TICKS', () => {
  it('is exported as a constant, not yet wired into any tick (slice 4)', () => {
    expect(REALITY_PULL_EVERY_N_TICKS).toBe(16);
  });
});
