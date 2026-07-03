import { describe, it, expect } from 'vitest';
import {
  parseFiscalField,
  type FiscalClampContext,
} from '@core/server/lib/fiscalParsing';

/**
 * Baseline clamp context sized like the live economy:
 * treasury M$8,391, expected tick revenue M$400, no active programs.
 * Defaults: one-time max = 5% of treasury = 419; program max = 10% of
 * revenue = 40/tick; aggregate recurring cap = 50% of revenue = 200/tick;
 * tax delta = ±2; sunset clamp [8, 200].
 */
function ctx(overrides: Partial<FiscalClampContext> = {}): FiscalClampContext {
  return {
    treasury: 8391,
    expectedTickRevenue: 400,
    activeRecurringSpend: 0,
    rc: {
      fiscalMaxOneTimePctOfTreasury: 5,
      fiscalMaxProgramPctOfRevenue: 10,
      fiscalRecurringCapPctOfRevenue: 50,
      fiscalMaxTaxDeltaPerLaw: 2,
      maxSunsetTicks: 200,
    },
    fallbackProgramName: 'Fallback Act',
    ...overrides,
  };
}

const wrap = (fiscal: unknown): unknown => ({ fiscal });

describe('parseFiscalField — envelope discipline (Rule 4)', () => {
  it('rejects non-object data payloads', () => {
    expect(parseFiscalField(undefined, ctx())).toBeNull();
    expect(parseFiscalField(null, ctx())).toBeNull();
    expect(parseFiscalField('fiscal', ctx())).toBeNull();
    expect(parseFiscalField(42, ctx())).toBeNull();
    expect(parseFiscalField(true, ctx())).toBeNull();
    expect(parseFiscalField([{ fiscal: { kind: 'spend_once', amount: 10 } }], ctx())).toBeNull();
  });

  it('rejects data without a fiscal key', () => {
    expect(parseFiscalField({}, ctx())).toBeNull();
    expect(parseFiscalField({ title: 'A Bill', amount: 100 }, ctx())).toBeNull();
  });

  it('rejects non-object fiscal values', () => {
    expect(parseFiscalField(wrap('spend_once'), ctx())).toBeNull();
    expect(parseFiscalField(wrap(['spend_once']), ctx())).toBeNull();
    expect(parseFiscalField(wrap(7), ctx())).toBeNull();
    expect(parseFiscalField(wrap(null), ctx())).toBeNull();
  });

  it('rejects fiscal without kind, non-string kind, and unknown kinds', () => {
    expect(parseFiscalField(wrap({}), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ amount: 100 }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 1, amount: 100 }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: ['spend_once'], amount: 100 }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'print_money', amount: 100 }), ctx())).toBeNull();
  });

  it('treats kind "none" (the prompt opt-out) as no provision', () => {
    expect(parseFiscalField(wrap({ kind: 'none', amount: 0, taxDelta: 0, programName: '', sunsetTicks: 0 }), ctx())).toBeNull();
  });

  it('normalizes kind case and whitespace', () => {
    const r = parseFiscalField(wrap({ kind: ' SPEND_ONCE ', amount: 100 }), ctx());
    expect(r?.kind).toBe('spend_once');
  });

  it('handles JSON.parse-produced __proto__ keys without prototype pollution', () => {
    const data = JSON.parse('{"fiscal":{"kind":"spend_once","amount":100,"__proto__":{"polluted":true}}}') as unknown;
    const r = parseFiscalField(data, ctx());
    expect(r?.kind).toBe('spend_once');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a __proto__-only fiscal payload', () => {
    const data = JSON.parse('{"fiscal":{"__proto__":{"kind":"spend_once","amount":100}}}') as unknown;
    expect(parseFiscalField(data, ctx())).toBeNull();
  });

  it('never throws on hostile shapes', () => {
    expect(() => parseFiscalField(Object.create(null), ctx())).not.toThrow();
    expect(() => parseFiscalField(wrap({ kind: 'spend_once', amount: { valueOf: () => 100 } }), ctx())).not.toThrow();
  });
});

describe('parseFiscalField — spend_once', () => {
  it('accepts a valid one-time spend and ignores non-whitelisted fields', () => {
    const r = parseFiscalField(
      wrap({ kind: 'spend_once', amount: 100, targetId: 'attacker', treasurySet: 999999 }),
      ctx(),
    );
    expect(r).toEqual({ kind: 'spend_once', amount: 100, taxDelta: null, programName: null, sunsetTicks: null });
  });

  it('floors fractional amounts', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 100.9 }), ctx())?.amount).toBe(100);
  });

  it('clamps to the % of treasury cap (5% of 8391 = 419)', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 1_000_000 }), ctx())?.amount).toBe(419);
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 419 }), ctx())?.amount).toBe(419);
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 420 }), ctx())?.amount).toBe(419);
  });

  it('rejects zero, negative, NaN, Infinity, string, array, and missing amounts', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 0 }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 0.5 }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: -100 }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: NaN }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: Infinity }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: -Infinity }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: '100' }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: [100] }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once' }), ctx())).toBeNull();
  });

  it('drops one-time spends when the treasury is empty or negative', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 10 }), ctx({ treasury: 0 }))).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 10 }), ctx({ treasury: -500 }))).toBeNull();
  });
});

describe('parseFiscalField — spend_recurring', () => {
  it('accepts a valid program with a sanitized name', () => {
    const r = parseFiscalField(
      wrap({ kind: 'spend_recurring', amount: 25, programName: '  Rural\x07 Broadband\n Fund  ' }),
      ctx(),
    );
    expect(r).toEqual({
      kind: 'spend_recurring',
      amount: 25,
      taxDelta: null,
      programName: 'Rural Broadband Fund',
      sunsetTicks: null,
    });
  });

  it('clamps per-tick amount to % of expected revenue (10% of 400 = 40)', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: 5_000, programName: 'P' }), ctx())?.amount).toBe(40);
  });

  it('rejects when expected revenue is zero or negative (R=0 rejection)', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: 10, programName: 'P' }), ctx({ expectedTickRevenue: 0 }))).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: 10, programName: 'P' }), ctx({ expectedTickRevenue: -5 }))).toBeNull();
  });

  it('enforces the aggregate recurring cap (50% of 400 = 200)', () => {
    /* Existing programs at 180/tick; a 40/tick program would total 220 > 200 → dropped entirely. */
    expect(
      parseFiscalField(wrap({ kind: 'spend_recurring', amount: 40, programName: 'P' }), ctx({ activeRecurringSpend: 180 })),
    ).toBeNull();
    /* 160 existing + 40 = 200 = cap exactly → allowed (cap is inclusive). */
    expect(
      parseFiscalField(wrap({ kind: 'spend_recurring', amount: 40, programName: 'P' }), ctx({ activeRecurringSpend: 160 }))?.amount,
    ).toBe(40);
    /* 161 existing + 40 = 201 > 200 → dropped. */
    expect(
      parseFiscalField(wrap({ kind: 'spend_recurring', amount: 40, programName: 'P' }), ctx({ activeRecurringSpend: 161 })),
    ).toBeNull();
  });

  it('rejects zero/negative/non-numeric per-tick amounts', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: 0, programName: 'P' }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: -10, programName: 'P' }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: '25', programName: 'P' }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', programName: 'P' }), ctx())).toBeNull();
  });

  it('falls back to the bill title when programName is missing, empty, or junk', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: 10 }), ctx())?.programName).toBe('Fallback Act');
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: 10, programName: '' }), ctx())?.programName).toBe('Fallback Act');
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: 10, programName: '   ' }), ctx())?.programName).toBe('Fallback Act');
    expect(parseFiscalField(wrap({ kind: 'spend_recurring', amount: 10, programName: ['X'] }), ctx())?.programName).toBe('Fallback Act');
    expect(
      parseFiscalField(wrap({ kind: 'spend_recurring', amount: 10 }), ctx({ fallbackProgramName: undefined }))?.programName,
    ).toBe('Unnamed Program');
  });

  it('caps program names at 120 chars', () => {
    const name = 'X'.repeat(500);
    const r = parseFiscalField(wrap({ kind: 'spend_recurring', amount: 10, programName: name }), ctx());
    expect(r?.programName?.length).toBe(120);
  });
});

describe('parseFiscalField — tax_change', () => {
  it('accepts positive and negative whole-point deltas', () => {
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: 1 }), ctx())?.taxDelta).toBe(1);
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: -2 }), ctx())?.taxDelta).toBe(-2);
  });

  it('clamps deltas to ±fiscalMaxTaxDeltaPerLaw (±2)', () => {
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: 50 }), ctx())?.taxDelta).toBe(2);
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: -50 }), ctx())?.taxDelta).toBe(-2);
  });

  it('truncates fractional deltas toward zero (integer column)', () => {
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: 1.9 }), ctx())?.taxDelta).toBe(1);
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: -1.9 }), ctx())?.taxDelta).toBe(-1);
  });

  it('rejects zero and sub-1-point deltas (no-op) and junk', () => {
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: 0 }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: 0.4 }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: NaN }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'tax_change', taxDelta: '2' }), ctx())).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'tax_change' }), ctx())).toBeNull();
  });

  it('never returns amount or programName for tax changes', () => {
    const r = parseFiscalField(wrap({ kind: 'tax_change', taxDelta: 1, amount: 99999, programName: 'Sneaky' }), ctx());
    expect(r?.amount).toBeNull();
    expect(r?.programName).toBeNull();
  });
});

describe('parseFiscalField — sunsetTicks', () => {
  it('accepts and clamps sunset to [8, maxSunsetTicks]', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 10, sunsetTicks: 50 }), ctx())?.sunsetTicks).toBe(50);
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 10, sunsetTicks: 1 }), ctx())?.sunsetTicks).toBe(8);
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 10, sunsetTicks: 10_000 }), ctx())?.sunsetTicks).toBe(200);
  });

  it('treats 0, negatives, and junk as no sunset (null) without dropping the provision', () => {
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 10, sunsetTicks: 0 }), ctx())?.sunsetTicks).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 10, sunsetTicks: -5 }), ctx())?.sunsetTicks).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 10, sunsetTicks: 'forever' }), ctx())?.sunsetTicks).toBeNull();
    expect(parseFiscalField(wrap({ kind: 'spend_once', amount: 10, sunsetTicks: NaN }), ctx())?.sunsetTicks).toBeNull();
  });
});

describe('parseFiscalField — clamp-context anomalies resolve to no-op', () => {
  const valid = wrap({ kind: 'spend_once', amount: 10 });

  it('rejects non-finite treasury / revenue / active spend', () => {
    expect(parseFiscalField(valid, ctx({ treasury: NaN }))).toBeNull();
    expect(parseFiscalField(valid, ctx({ expectedTickRevenue: Infinity }))).toBeNull();
    expect(parseFiscalField(valid, ctx({ activeRecurringSpend: NaN }))).toBeNull();
    expect(parseFiscalField(valid, ctx({ activeRecurringSpend: -1 }))).toBeNull();
  });

  it('rejects corrupt rc clamp config', () => {
    const bad = ctx();
    expect(parseFiscalField(valid, { ...bad, rc: { ...bad.rc, fiscalMaxOneTimePctOfTreasury: NaN } })).toBeNull();
    expect(parseFiscalField(valid, { ...bad, rc: { ...bad.rc, fiscalMaxTaxDeltaPerLaw: 0 } })).toBeNull();
    expect(parseFiscalField(valid, { ...bad, rc: { ...bad.rc, maxSunsetTicks: -1 } })).toBeNull();
  });
});
