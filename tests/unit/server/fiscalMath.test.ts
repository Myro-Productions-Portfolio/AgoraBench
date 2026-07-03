import { describe, it, expect } from 'vitest';
import {
  clampInt,
  expectedTickRevenue,
  applyTaxDelta,
  sunsetDue,
  lapseDue,
  projectFiscalNote,
} from '@core/server/lib/fiscalMath';

describe('clampInt', () => {
  it('floors and clamps', () => {
    expect(clampInt(5.9, 1, 10)).toBe(5);
    expect(clampInt(-3.2, -10, 10)).toBe(-4);
    expect(clampInt(50, 1, 10)).toBe(10);
    expect(clampInt(-50, 1, 10)).toBe(1);
  });

  it('returns min for ALL non-finite input (conservative floor, never NaN)', () => {
    expect(clampInt(NaN, 1, 10)).toBe(1);
    /* Even +Infinity resolves to min, NOT max: a corrupt value must never
       saturate a money clamp upward. */
    expect(clampInt(Infinity, 1, 10)).toBe(1);
    expect(clampInt(-Infinity, 1, 10)).toBe(1);
  });
});

describe('expectedTickRevenue', () => {
  it('matches Phase 13 flooring: floor(sum * rate / 100)', () => {
    expect(expectedTickRevenue(2, 20_000)).toBe(400);
    expect(expectedTickRevenue(3, 999)).toBe(29); // 29.97 → 29
  });

  it('returns 0 for zero/negative/non-finite inputs', () => {
    expect(expectedTickRevenue(0, 20_000)).toBe(0);
    expect(expectedTickRevenue(2, 0)).toBe(0);
    expect(expectedTickRevenue(-2, 20_000)).toBe(0);
    expect(expectedTickRevenue(2, -100)).toBe(0);
    expect(expectedTickRevenue(NaN, 20_000)).toBe(0);
    expect(expectedTickRevenue(2, Infinity)).toBe(0);
  });
});

describe('applyTaxDelta', () => {
  it('applies and clamps to [min, max]', () => {
    expect(applyTaxDelta(2, 1, 1, 25)).toBe(3);
    expect(applyTaxDelta(2, -1, 1, 25)).toBe(1);
    expect(applyTaxDelta(2, -2, 1, 25)).toBe(1);  // floor saturation
    expect(applyTaxDelta(24, 2, 1, 25)).toBe(25); // ceiling saturation
  });

  it('the live 2% rate is NOT jumped by the min bound (min=1 < 2)', () => {
    expect(applyTaxDelta(2, 0, 1, 25)).toBe(2);
  });

  it('handles non-finite inputs without NaN', () => {
    expect(applyTaxDelta(NaN, 1, 1, 25)).toBe(1);
    expect(applyTaxDelta(2, NaN, 1, 25)).toBe(2);
  });
});

describe('sunsetDue — age measured from enactedTick, due when age >= sunsetTicks', () => {
  it('fires exactly at the expiry tick, not before', () => {
    expect(sunsetDue(109, 100, 10)).toBe(false); // age 9
    expect(sunsetDue(110, 100, 10)).toBe(true);  // age 10 — due
    expect(sunsetDue(111, 100, 10)).toBe(true);  // past due (restart gap)
  });

  it('legacy laws (NULL enactedTick or NULL sunsetTicks) are never due', () => {
    expect(sunsetDue(10_000, null, 10)).toBe(false);
    expect(sunsetDue(10_000, undefined, 10)).toBe(false);
    expect(sunsetDue(10_000, 100, null)).toBe(false);
    expect(sunsetDue(10_000, 100, undefined)).toBe(false);
  });

  it('rejects non-positive and non-finite sunset values', () => {
    expect(sunsetDue(200, 100, 0)).toBe(false);
    expect(sunsetDue(200, 100, -5)).toBe(false);
    expect(sunsetDue(200, 100, NaN)).toBe(false);
    expect(sunsetDue(NaN, 100, 10)).toBe(false);
  });
});

describe('lapseDue — age measured from max(enactedTick, lastRenewedTick)', () => {
  it('fires exactly at the cycle edge', () => {
    expect(lapseDue(123, 100, null, 24)).toBe(false); // age 23
    expect(lapseDue(124, 100, null, 24)).toBe(true);  // age 24 — due
  });

  it('renewal resets the lapse clock', () => {
    expect(lapseDue(124, 100, 110, 24)).toBe(false); // renewed at 110, age 14
    expect(lapseDue(134, 100, 110, 24)).toBe(true);  // age 24 from renewal
  });

  it('survives a tick-number gap (restart robustness)', () => {
    expect(lapseDue(500, 100, 110, 24)).toBe(true);
  });

  it('uses the LATER of enacted/lastRenewed as the anchor', () => {
    /* Corrupt ordering (renewed before enacted) must not make lapse earlier. */
    expect(lapseDue(120, 100, 90, 24)).toBe(false); // anchor 100, age 20
  });

  it('legacy laws (NULL enactedTick) never lapse', () => {
    expect(lapseDue(10_000, null, null, 24)).toBe(false);
    expect(lapseDue(10_000, undefined, undefined, 24)).toBe(false);
  });

  it('rejects non-positive cycles and non-finite ticks', () => {
    expect(lapseDue(200, 100, null, 0)).toBe(false);
    expect(lapseDue(NaN, 100, null, 24)).toBe(false);
  });
});

describe('projectFiscalNote', () => {
  const noteCtx = { treasuryBalance: 8391, sumActiveBalances: 20_000, budgetCycleTicks: 24 };

  it('spend_once: one-time cost, no per-tick delta', () => {
    const n = projectFiscalNote({ kind: 'spend_once', amount: 400, taxDelta: null, sunsetTicks: null }, noteCtx);
    expect(n).not.toBeNull();
    expect(n?.oneTimeCost).toBe(400);
    expect(n?.perTickDelta).toBe(0);
    expect(n?.perCycleDelta).toBe(0);
    expect(n?.horizonTicks).toBe(0);
    expect(n?.projected10TickDelta).toBe(-400);
    expect(n?.pctOfCurrentTreasury).toBeCloseTo(4.8, 1);
  });

  it('spend_recurring: per-tick and per-cycle costs over one cycle horizon', () => {
    const n = projectFiscalNote({ kind: 'spend_recurring', amount: 40, taxDelta: null, sunsetTicks: null }, noteCtx);
    expect(n?.perTickDelta).toBe(-40);
    expect(n?.perCycleDelta).toBe(-960);
    expect(n?.horizonTicks).toBe(24);
    expect(n?.projected10TickDelta).toBe(-400);
  });

  it('spend_recurring with a sunset shorter than the cycle bounds the horizon', () => {
    const n = projectFiscalNote({ kind: 'spend_recurring', amount: 40, taxDelta: null, sunsetTicks: 8 }, noteCtx);
    expect(n?.horizonTicks).toBe(8);
    expect(n?.projected10TickDelta).toBe(-320); // 8 ticks, not 10
  });

  it('tax_change: revenue delta per tick = floor(sum * delta / 100)', () => {
    const up = projectFiscalNote({ kind: 'tax_change', amount: null, taxDelta: 1, sunsetTicks: null }, noteCtx);
    expect(up?.perTickDelta).toBe(200);
    expect(up?.projected10TickDelta).toBe(2000);
    const down = projectFiscalNote({ kind: 'tax_change', amount: null, taxDelta: -2, sunsetTicks: null }, noteCtx);
    expect(down?.perTickDelta).toBe(-400);
  });

  it('returns null for unusable provisions', () => {
    expect(projectFiscalNote({ kind: 'spend_once', amount: null, taxDelta: null, sunsetTicks: null }, noteCtx)).toBeNull();
    expect(projectFiscalNote({ kind: 'spend_once', amount: 0, taxDelta: null, sunsetTicks: null }, noteCtx)).toBeNull();
    expect(projectFiscalNote({ kind: 'spend_recurring', amount: NaN, taxDelta: null, sunsetTicks: null }, noteCtx)).toBeNull();
    expect(projectFiscalNote({ kind: 'tax_change', amount: null, taxDelta: 0, sunsetTicks: null }, noteCtx)).toBeNull();
  });

  it('negative treasury never yields NaN/Infinity percentages', () => {
    const n = projectFiscalNote(
      { kind: 'spend_once', amount: 100, taxDelta: null, sunsetTicks: null },
      { ...noteCtx, treasuryBalance: -5000 },
    );
    expect(n?.pctOfCurrentTreasury).toBe(0);
    expect(Number.isFinite(n?.projected10TickDelta ?? NaN)).toBe(true);
  });
});
