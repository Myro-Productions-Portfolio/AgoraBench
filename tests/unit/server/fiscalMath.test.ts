import { describe, it, expect } from 'vitest';
import {
  clampInt,
  dailyCitizenRevenue,
  paydayDue,
  computePaycheck,
  applyTaxDelta,
  sunsetDue,
  lapseDue,
  budgetSessionDue,
  composeExpiringProgramsNote,
  projectFiscalNote,
  ticksUntilSunset,
  ticksUntilLapse,
  ticksUntilNextBudgetSession,
  mandatoryEffectiveAmount,
  tickInterest,
  settleTreasury,
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

describe('dailyCitizenRevenue', () => {
  it('is floor(gdp * rate / 100 / 365)', () => {
    // $28T * 18% / 365 = $13.808...B per day
    expect(dailyCitizenRevenue(28_000_000_000_000, 18)).toBe(13_808_219_178);
    expect(dailyCitizenRevenue(36_500, 10)).toBe(10); // 3650/365 = 10 exactly
  });

  it('returns 0 for zero/negative/non-finite inputs', () => {
    expect(dailyCitizenRevenue(0, 18)).toBe(0);
    expect(dailyCitizenRevenue(28_000_000_000_000, 0)).toBe(0);
    expect(dailyCitizenRevenue(-1, 18)).toBe(0);
    expect(dailyCitizenRevenue(28_000_000_000_000, -2)).toBe(0);
    expect(dailyCitizenRevenue(NaN, 18)).toBe(0);
    expect(dailyCitizenRevenue(Infinity, 18)).toBe(0);
  });
});

describe('paydayDue', () => {
  it('fires only on positive multiples of the pay period', () => {
    expect(paydayDue(14, 14)).toBe(true);
    expect(paydayDue(28, 14)).toBe(true);
    expect(paydayDue(13, 14)).toBe(false);
    expect(paydayDue(15, 14)).toBe(false);
  });

  it('tick 0 and non-finite/non-positive inputs are never due', () => {
    expect(paydayDue(0, 14)).toBe(false);
    expect(paydayDue(14, 0)).toBe(false);
    expect(paydayDue(NaN, 14)).toBe(false);
    expect(paydayDue(14, NaN)).toBe(false);
    expect(paydayDue(-14, 14)).toBe(false);
  });
});

describe('computePaycheck', () => {
  it('splits annual/26 into gross, withholding, net', () => {
    // President $400k/yr, 18% withholding: gross 15384, withheld 2769, net 12615
    expect(computePaycheck(400_000, 18)).toEqual({ gross: 15_384, withheld: 2_769, net: 12_615 });
  });

  it('zero tax yields net == gross', () => {
    const p = computePaycheck(174_000, 0);
    expect(p.gross).toBe(6_692);
    expect(p.withheld).toBe(0);
    expect(p.net).toBe(6_692);
  });

  it('non-finite/non-positive annual is all zero; tax is clamped to [0,100]', () => {
    expect(computePaycheck(0, 18)).toEqual({ gross: 0, withheld: 0, net: 0 });
    expect(computePaycheck(NaN, 18)).toEqual({ gross: 0, withheld: 0, net: 0 });
    const over = computePaycheck(26_000, 500); // clamped to 100% → net 0
    expect(over.withheld).toBe(over.gross);
    expect(over.net).toBe(0);
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

describe('budgetSessionDue — fires when tickNumber - lastSessionTick >= cycleTicks', () => {
  it('fires exactly at the cycle edge, not before', () => {
    expect(budgetSessionDue(123, 100, 24)).toBe(false); // 23 ticks since session
    expect(budgetSessionDue(124, 100, 24)).toBe(true);  // 24 — due
  });

  it('first run on a mid-life DB: marker defaults 0, session fires and re-baselines', () => {
    expect(budgetSessionDue(5_000, 0, 24)).toBe(true);
  });

  it('survives a tick-number gap past the edge (restart robustness)', () => {
    /* Sim down for several cycles: the next completed tick still fires
       exactly one session, which then re-baselines the marker. */
    expect(budgetSessionDue(500, 100, 24)).toBe(true);
  });

  it('a session that just fired this tick is not due again', () => {
    expect(budgetSessionDue(124, 124, 24)).toBe(false);
  });

  it('corrupt marker is treated as 0 (fire and re-baseline, never silence the cycle)', () => {
    expect(budgetSessionDue(5_000, NaN, 24)).toBe(true);
    expect(budgetSessionDue(5_000, null, 24)).toBe(true);
    expect(budgetSessionDue(5_000, undefined, 24)).toBe(true);
  });

  it('bad tickNumber or non-positive cycle disables the session (conservative)', () => {
    expect(budgetSessionDue(NaN, 100, 24)).toBe(false);
    expect(budgetSessionDue(500, 100, 0)).toBe(false);
    expect(budgetSessionDue(500, 100, -5)).toBe(false);
    expect(budgetSessionDue(500, 100, NaN)).toBe(false);
  });
});

describe('composeExpiringProgramsNote — bounded renewal-pressure prompt fragment', () => {
  it('returns empty string when nothing expires', () => {
    expect(composeExpiringProgramsNote([])).toBe('');
  });

  it('lists name and per-tick cost', () => {
    expect(composeExpiringProgramsNote([{ name: 'Rural Broadband Fund', perTick: 40 }])).toBe(
      ' Programs expiring at the next budget session: Rural Broadband Fund ($40/tick).',
    );
  });

  it('caps at 3 programs', () => {
    const note = composeExpiringProgramsNote([
      { name: 'A', perTick: 1 },
      { name: 'B', perTick: 2 },
      { name: 'C', perTick: 3 },
      { name: 'D', perTick: 4 },
    ]);
    expect(note).toContain('A ($1/tick)');
    expect(note).toContain('C ($3/tick)');
    expect(note).not.toContain('D ($4/tick)');
  });

  it('never exceeds 220 chars (prompt budget safety)', () => {
    const note = composeExpiringProgramsNote(
      Array.from({ length: 3 }, (_, i) => ({ name: `${'Very Long Program Name '.repeat(10)}${i}`, perTick: 1_000_000 })),
    );
    expect(note.length).toBeLessThanOrEqual(220);
  });

  it('slices long names, squashes whitespace, floors amounts, and guards non-finite', () => {
    const note = composeExpiringProgramsNote([
      { name: `  Spaced\n\nOut   Name  `, perTick: 40.9 },
      { name: '', perTick: NaN },
    ]);
    expect(note).toContain('Spaced Out Name ($40/tick)');
    expect(note).toContain('Unnamed Program ($0/tick)');
    expect(note).not.toContain('\n');
  });
});

describe('projectFiscalNote', () => {
  const noteCtx = { treasuryBalance: 8391, gdpAnnual: 3_650_000, budgetCycleTicks: 24 };

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

  it('tax_change: revenue delta per tick = floor(gdp * delta / 100 / 365)', () => {
    // gdp 3_650_000, delta 1 → floor(3650000/100/365) = 100
    const up = projectFiscalNote({ kind: 'tax_change', amount: null, taxDelta: 1, sunsetTicks: null }, noteCtx);
    expect(up?.perTickDelta).toBe(100);
    expect(up?.projected10TickDelta).toBe(1000);
    const down = projectFiscalNote({ kind: 'tax_change', amount: null, taxDelta: -2, sunsetTicks: null }, noteCtx);
    expect(down?.perTickDelta).toBe(-200);
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

/* ── UI countdown helpers ─────────────────────────────────────────────── */

describe('ticksUntilSunset — remaining = max(0, enacted + sunset - current)', () => {
  it('counts down and floors at 0 when due/overdue', () => {
    expect(ticksUntilSunset(100, 90, 20)).toBe(10);
    expect(ticksUntilSunset(109, 90, 20)).toBe(1);
    expect(ticksUntilSunset(110, 90, 20)).toBe(0); // due exactly now
    expect(ticksUntilSunset(200, 90, 20)).toBe(0); // overdue never negative
  });

  it('agrees with sunsetDue at the boundary: due exactly when remaining hits 0', () => {
    /* Phase 9.7 evaluates at tickNumber = current + 1, so remaining 1 → due next tick */
    expect(ticksUntilSunset(109, 90, 20)).toBe(1);
    expect(sunsetDue(110, 90, 20)).toBe(true);
    expect(sunsetDue(109, 90, 20)).toBe(false);
  });

  it('legacy laws (NULL columns) and bad input return null', () => {
    expect(ticksUntilSunset(100, null, 20)).toBeNull();
    expect(ticksUntilSunset(100, undefined, 20)).toBeNull();
    expect(ticksUntilSunset(100, 90, null)).toBeNull();
    expect(ticksUntilSunset(100, 90, 0)).toBeNull();
    expect(ticksUntilSunset(NaN, 90, 20)).toBeNull();
    expect(ticksUntilSunset(100, Infinity, 20)).toBeNull();
  });
});

describe('ticksUntilLapse — anchor = max(enacted, lastRenewed)', () => {
  it('counts down from the later of enacted/renewed and floors at 0', () => {
    expect(ticksUntilLapse(100, 80, null, 24)).toBe(4);
    expect(ticksUntilLapse(100, 80, 90, 24)).toBe(14); // renewal reset the clock
    expect(ticksUntilLapse(104, 80, null, 24)).toBe(0); // due exactly now
    expect(ticksUntilLapse(500, 80, null, 24)).toBe(0); // overdue never negative
  });

  it('uses the LATER of enacted/lastRenewed even if renewed is stale', () => {
    expect(ticksUntilLapse(100, 95, 90, 24)).toBe(19); // enacted after renewal marker
  });

  it('legacy programs (NULL enactedTick) and bad cycles return null', () => {
    expect(ticksUntilLapse(100, null, null, 24)).toBeNull();
    expect(ticksUntilLapse(100, 80, null, 0)).toBeNull();
    expect(ticksUntilLapse(100, 80, null, NaN)).toBeNull();
    expect(ticksUntilLapse(NaN, 80, null, 24)).toBeNull();
  });
});

describe('ticksUntilNextBudgetSession — session tick = max(current+1, last+cycle)', () => {
  it('counts down inside a cycle', () => {
    expect(ticksUntilNextBudgetSession(100, 90, 24)).toBe(14); // fires at tick 114
    expect(ticksUntilNextBudgetSession(113, 90, 24)).toBe(1);
  });

  it('is never less than 1 — an overdue session fires on the NEXT tick', () => {
    expect(ticksUntilNextBudgetSession(114, 90, 24)).toBe(1);
    expect(ticksUntilNextBudgetSession(500, 90, 24)).toBe(1);
  });

  it('mid-life DB first run: marker 0 → next tick fires the session', () => {
    /* live DB: thousands of completed ticks, lastBudgetSessionTick defaults 0 */
    expect(ticksUntilNextBudgetSession(4000, 0, 24)).toBe(1);
  });

  it('corrupt marker treated as 0 (matches budgetSessionDue), bad input null', () => {
    expect(ticksUntilNextBudgetSession(10, NaN, 24)).toBe(14); // last=0 → fires at 24
    expect(ticksUntilNextBudgetSession(10, null, 24)).toBe(14);
    expect(ticksUntilNextBudgetSession(NaN, 0, 24)).toBeNull();
    expect(ticksUntilNextBudgetSession(10, 0, 0)).toBeNull();
  });
});

/* ── Divergence E1 slice 1: mandatory spending + debt/interest ─────────── */

describe('mandatoryEffectiveAmount — daily-compounding annual growth, computed not stored', () => {
  it('compounds over multiple years (5%/yr on $1,000,000)', () => {
    expect(mandatoryEffectiveAmount(1_000_000, 0, 365, 5)).toBe(1_050_000);   // 1 year
    expect(mandatoryEffectiveAmount(1_000_000, 0, 730, 5)).toBe(1_102_500);   // 2 years
  });

  it('partial-year (daily) compounding, not a step function', () => {
    expect(mandatoryEffectiveAmount(1_000_000, 0, 182, 5)).toBe(1_024_626); // ~half year
  });

  it('zero elapsed time returns the base amount unchanged', () => {
    expect(mandatoryEffectiveAmount(1_000_000, 100, 100, 5)).toBe(1_000_000);
  });

  it('zero growth rate never compounds (flat mandatory program)', () => {
    expect(mandatoryEffectiveAmount(1_000_000, 0, 365, 0)).toBe(1_000_000);
    expect(mandatoryEffectiveAmount(1_000_000, 0, 3650, 0)).toBe(1_000_000);
  });

  it('a currentTick before enactedTick (clock skew) clamps age at 0 — never negative growth', () => {
    expect(mandatoryEffectiveAmount(1_000_000, 200, 100, 5)).toBe(1_000_000);
  });

  it('never mutates the stored base — same base + same ticks is deterministic and repeatable', () => {
    const a = mandatoryEffectiveAmount(4_315_000_000, 0, 400, 5);
    const b = mandatoryEffectiveAmount(4_315_000_000, 0, 400, 5);
    expect(a).toBe(b);
  });

  it('non-finite/non-positive base, non-finite ticks, or negative growth guard to 0/flat', () => {
    expect(mandatoryEffectiveAmount(0, 0, 365, 5)).toBe(0);
    expect(mandatoryEffectiveAmount(-100, 0, 365, 5)).toBe(0);
    expect(mandatoryEffectiveAmount(NaN, 0, 365, 5)).toBe(0);
    expect(mandatoryEffectiveAmount(1_000_000, NaN, 365, 5)).toBe(0);
    expect(mandatoryEffectiveAmount(1_000_000, 0, NaN, 5)).toBe(0);
    /* Negative/non-finite growth treated as 0% — a legitimate flat program,
       not corrupt input, so the base survives rather than zeroing out. */
    expect(mandatoryEffectiveAmount(1_000_000, 0, 365, -5)).toBe(1_000_000);
    expect(mandatoryEffectiveAmount(1_000_000, 0, 365, NaN)).toBe(1_000_000);
  });
});

describe('tickInterest — floor(debt * rate / 100 / 365)', () => {
  it('accrues daily interest on a real-scale debt stock', () => {
    // $36.5T at 2.7% → floor(36.5e12 * 2.7 / 100 / 365) = $2.7B/day
    expect(tickInterest(36_500_000_000_000, 2.7)).toBe(2_700_000_000);
  });

  it('floors small amounts to 0 rather than fractional cents', () => {
    expect(tickInterest(1_000, 10)).toBe(0);
  });

  it('zero for non-positive or non-finite debt', () => {
    expect(tickInterest(0, 2.7)).toBe(0);
    expect(tickInterest(-1_000, 2.7)).toBe(0);
    expect(tickInterest(NaN, 2.7)).toBe(0);
  });

  it('zero for non-positive or non-finite rate (never invents interest)', () => {
    expect(tickInterest(1_000_000, 0)).toBe(0);
    expect(tickInterest(1_000_000, -1)).toBe(0);
    expect(tickInterest(1_000_000, NaN)).toBe(0);
  });
});

describe('settleTreasury — end-of-tick shortfall→debt / surplus→retirement', () => {
  it('shortfall: cash goes negative → treasury floors at 0, debt issued for the full gap', () => {
    expect(settleTreasury(-500, 1_000, 0)).toEqual({ treasury: 0, debtDelta: 500 });
  });

  it('shortfall with existing debt: issuance is still the full shortfall (existing debt untouched by this branch)', () => {
    expect(settleTreasury(-500, 1_000, 2_000)).toEqual({ treasury: 0, debtDelta: 500 });
  });

  it('surplus above buffer with no existing debt: excess stays in treasury, no retirement', () => {
    expect(settleTreasury(1_500, 1_000, 0)).toEqual({ treasury: 1_500, debtDelta: 0 });
  });

  it('surplus above buffer retires debt with the excess (excess < debt)', () => {
    expect(settleTreasury(1_500, 1_000, 2_000)).toEqual({ treasury: 1_000, debtDelta: -500 });
  });

  it('retirement is capped at currentDebt — surplus never drives debt negative', () => {
    // excess = 4000, debt = 800 → only 800 retired, remaining 3200 stays in treasury
    expect(settleTreasury(5_000, 1_000, 800)).toEqual({ treasury: 4_200, debtDelta: -800 });
  });

  it('cash exactly at the buffer is a no-op (boundary — not a surplus)', () => {
    expect(settleTreasury(1_000, 1_000, 500)).toEqual({ treasury: 1_000, debtDelta: 0 });
  });

  it('zero cash with a positive buffer is a no-op', () => {
    expect(settleTreasury(0, 1_000, 500)).toEqual({ treasury: 0, debtDelta: 0 });
  });

  it('zero buffer: any positive cash is a surplus subject to retirement', () => {
    expect(settleTreasury(100, 0, 500)).toEqual({ treasury: 0, debtDelta: -100 });
  });

  it('non-finite inputs guard to 0 rather than propagating NaN/Infinity', () => {
    expect(settleTreasury(NaN, 1_000, 500)).toEqual({ treasury: 0, debtDelta: 0 });
    /* Non-finite buffer → treated as 0, so any positive cash is a surplus;
       debt=500 caps retirement at the full $100 excess. */
    expect(settleTreasury(100, NaN, 500)).toEqual({ treasury: 0, debtDelta: -100 });
    expect(settleTreasury(100, 1_000, NaN)).toEqual({ treasury: 100, debtDelta: 0 });
  });

  it('a corrupt negative currentDebt is clamped to 0 before capping retirement', () => {
    expect(settleTreasury(1_500, 1_000, -999)).toEqual({ treasury: 1_500, debtDelta: 0 });
  });
});
