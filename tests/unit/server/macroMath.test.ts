import { describe, it, expect } from 'vitest';
import {
  splitmix32, nextSeed, normalDraw, dailyHazard, dailyPhi,
  seedMacroState, stepMacro, LAG_WEIGHTS_NORMAL, LAG_WEIGHTS_RECESSION,
  type MacroParams, type FiscalImpulse,
} from '@core/server/lib/macroMath';

const P: MacroParams = {
  macroRecessionHazardMonthly: 0.0156, macroRecoveryHazardMonthly: 0.0971,
  macroGdpTrendExpansionPct: 2.25, macroGdpTrendRecessionPct: -2.0,
  macroGdpPhiQuarterly: 0.35, macroGdpShockSigmaPct: 0.15,
  macroOkunCoeff: 0.45, macroNaturalUnemploymentPct: 4.4, macroUnemploymentFloorPct: 2.0,
  macroPhillipsSlopeNormal: 0.18, macroPhillipsSlopeTight: 1.1, macroPhillipsTightThresholdPct: 4.0,
  macroInflationPhiQuarterly: 0.6, macroInflationAnchorPct: 2.0,
  macroMultiplierPurchases: 1.5, macroMultiplierTransfers: 0.9, macroMultiplierTax: 0.7,
  macroMultiplierRecessionScale: 1.6, macroSentimentAdjustSpeed: 0.05,
};
const ZERO: FiscalImpulse = { purchases: 0, transfers: 0, tax: 0 };
const GDP = 28_000_000_000_000;
const noNoise: MacroParams = { ...P, macroGdpShockSigmaPct: 0, macroRecessionHazardMonthly: 0 };

describe('prng', () => {
  it('is deterministic and in [0,1)', () => {
    const a = splitmix32(42), b = splitmix32(42);
    const seq = Array.from({ length: 5 }, () => a());
    expect(seq).toEqual(Array.from({ length: 5 }, () => b()));
    seq.forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); });
    expect(nextSeed(42)).not.toBe(42);
    expect(nextSeed(42)).toBe(nextSeed(42));
  });
  it('normalDraw is deterministic under the same rng seed', () => {
    expect(normalDraw(splitmix32(7))).toBeCloseTo(normalDraw(splitmix32(7)), 12);
  });
});

describe('conversions', () => {
  it('dailyHazard compounds back to the monthly hazard', () => {
    expect(1 - Math.pow(1 - dailyHazard(0.0156), 30)).toBeCloseTo(0.0156, 10);
  });
  it('dailyPhi compounds back to the quarterly phi', () => {
    expect(Math.pow(dailyPhi(0.6), 90)).toBeCloseTo(0.6, 10);
  });
});

describe('lag weights', () => {
  it('both vectors have 12 entries summing to 1', () => {
    for (const w of [LAG_WEIGHTS_NORMAL, LAG_WEIGHTS_RECESSION]) {
      expect(w).toHaveLength(12);
      expect(w.reduce((a, x) => a + x, 0)).toBeCloseTo(1.0, 10);
    }
  });
  it('normal peaks earlier than recession (hump vs back-loaded)', () => {
    const peak = (w: readonly number[]) => w.indexOf(Math.max(...w));
    expect(peak(LAG_WEIGHTS_NORMAL)).toBeLessThan(peak(LAG_WEIGHTS_RECESSION));
  });
});

describe('seedMacroState (T0 vector, world-model §4)', () => {
  it('seeds the 2026-07 baseline with a self-calibrated sentiment base (no drift artifact)', () => {
    const s = seedMacroState(GDP, 1337, P);
    expect(s.regime).toBe('expansion');
    expect(s.gdpAnnualized).toBe(GDP);
    expect(s.unemploymentPct).toBeCloseTo(4.2, 5);
    expect(s.inflationPct).toBeCloseTo(4.2, 5);
    expect(s.sentiment).toBeCloseTo(44.8, 5);
    expect(s.policyPipeline).toEqual(new Array(12).fill(0));
    const next = stepMacro(s, ZERO, noNoise);
    expect(Math.abs(next.sentiment - 44.8)).toBeLessThan(0.05);
  });
});

describe('stepMacro', () => {
  it('is deterministic: same state + params => identical next state', () => {
    const s = seedMacroState(GDP, 99, P);
    expect(stepMacro(s, ZERO, P)).toEqual(stepMacro(s, ZERO, P));
  });
  it('advances the seed chain every step', () => {
    const s = seedMacroState(GDP, 99, P);
    expect(stepMacro(s, ZERO, P).rngSeed).not.toBe(s.rngSeed);
  });
  it('with zero noise/impulse, growth stays at trend and gdp compounds ~2.25%/yr', () => {
    let s = seedMacroState(GDP, 1, noNoise);
    for (let i = 0; i < 365; i++) s = stepMacro(s, ZERO, noNoise);
    expect(s.gdpGrowthPct).toBeCloseTo(2.25, 1);
    expect(s.gdpAnnualized).toBeGreaterThan(GDP * 1.015);
    expect(s.gdpAnnualized).toBeLessThan(GDP * 1.035);
  });
  it('spending impulse: pipeline fills, and 3-year cumulative level gain ~= multiplier * X / GDP', () => {
    const s = seedMacroState(GDP, 1, noNoise);
    const X = 500_000_000_000;
    const boosted0 = stepMacro(s, { purchases: X, transfers: 0, tax: 0 }, noNoise);
    const flat0 = stepMacro(s, ZERO, noNoise);
    expect(boosted0.policyPipeline.reduce((a, x) => a + x, 0)).toBeGreaterThan(0);
    expect(boosted0.fiscalImpulsePct).toBeGreaterThan(0);
    let sb = boosted0, sf = flat0;
    for (let i = 0; i < 1080; i++) { sb = stepMacro(sb, ZERO, noNoise); sf = stepMacro(sf, ZERO, noNoise); }
    const levelGain = (sb.gdpAnnualized - sf.gdpAnnualized) / sf.gdpAnnualized;
    expect(levelGain).toBeCloseTo(1.5 * X / GDP, 2);
  });
  it('tax increase is contractionary (negative pipeline)', () => {
    const s = seedMacroState(GDP, 1, noNoise);
    const taxed = stepMacro(s, { purchases: 0, transfers: 0, tax: 1_000_000_000_000 }, noNoise);
    expect(taxed.policyPipeline.reduce((a, x) => a + x, 0)).toBeLessThan(0);
  });
  it('okun: below-trend growth raises unemployment; floor holds', () => {
    const s = { ...seedMacroState(GDP, 1, noNoise), coreGrowthPct: -3 };
    const u0 = s.unemploymentPct;
    expect(stepMacro(s, ZERO, noNoise).unemploymentPct).toBeGreaterThan(u0);
    const f = { ...seedMacroState(GDP, 1, noNoise), unemploymentPct: 2.0, coreGrowthPct: 10 };
    expect(stepMacro(f, ZERO, noNoise).unemploymentPct).toBeGreaterThanOrEqual(noNoise.macroUnemploymentFloorPct);
  });
  it('phillips: tight labor market pushes inflation up, slack pulls it down', () => {
    const tight = { ...seedMacroState(GDP, 1, noNoise), unemploymentPct: 3.0, inflationPct: 2.0 };
    const slack = { ...seedMacroState(GDP, 1, noNoise), unemploymentPct: 6.0, inflationPct: 2.0 };
    expect(stepMacro(tight, ZERO, noNoise).inflationPct).toBeGreaterThan(2.0);
    expect(stepMacro(slack, ZERO, noNoise).inflationPct).toBeLessThan(2.0);
  });
  it('sentiment falls when inflation and unemployment worsen', () => {
    const s = seedMacroState(GDP, 1, noNoise);
    const bad = { ...s, inflationPct: 9.0, unemploymentPct: 8.0 };
    expect(stepMacro(bad, ZERO, noNoise).sentiment).toBeLessThan(bad.sentiment);
  });
  it('recession regime boosts spending impulse vs expansion', () => {
    const X: FiscalImpulse = { purchases: 500_000_000_000, transfers: 0, tax: 0 };
    const r = { ...seedMacroState(GDP, 1, noNoise), regime: 'recession' as const };
    const e = seedMacroState(GDP, 1, noNoise);
    expect(stepMacro(r, X, noNoise).policyPipeline.reduce((a, x) => a + x, 0))
      .toBeGreaterThan(stepMacro(e, X, noNoise).policyPipeline.reduce((a, x) => a + x, 0));
  });
  it('pipeline shifts one bucket every 90 steps', () => {
    let s = seedMacroState(GDP, 1, noNoise);
    s = stepMacro(s, { purchases: 500_000_000_000, transfers: 0, tax: 0 }, noNoise);
    const bucket1 = s.policyPipeline[1];
    for (let i = 0; i < 90; i++) s = stepMacro(s, ZERO, noNoise);
    expect(s.policyPipeline[0]).toBeCloseTo(bucket1, 10);
    expect(s.policyPipeline[11]).toBe(0);
  });

  // Regression: E5 fiscal-review bug (task-2, 2026-08-16). macroEngine.ts fed
  // recurringAnnualized inflated 16x (spurious ticksPerDay factor) into the
  // transfers impulse. This isn't a macroMath.ts bug -- the pure step math is
  // unit-correct -- but pins the plausibility contract macroEngine must
  // respect: a live-DB-scale fiscal impulse (each component sized as a
  // realistic fraction of a $28T GDP, per the task-2 brief's law-stack scale)
  // must print single-digit-percent growth/impulse, never the 96-126%
  // gdp_growth_pct / -607%..+365% fiscal_impulse_pct seen in production.
  it('a realistic single-step fiscal impulse (few % of GDP per component) keeps growth plausible', () => {
    const s = seedMacroState(GDP, 1, noNoise);
    // purchases: one big spend_once bill, ~0.3% of GDP (brief: up to $85B active)
    // transfers: one program's daily amount swinging by ~$300M/day annualized,
    //   ~0.06% of GDP (brief: mandatory ~$11.4B/day total across 5 laws)
    // tax: a 2pp tax law (fiscalMaxTaxDeltaPerLaw), ~2% of GDP annualized
    const impulse: FiscalImpulse = {
      purchases: 85_000_000_000,
      transfers: 300_000_000 * 365,
      tax: (2 / 100) * GDP,
    };
    const next = stepMacro(s, impulse, noNoise);
    expect(Math.abs(next.fiscalImpulsePct!)).toBeLessThan(10);
    expect(Math.abs(next.gdpGrowthPct)).toBeLessThan(15);
  });
});
