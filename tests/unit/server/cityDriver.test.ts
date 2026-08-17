import { describe, expect, it } from 'vitest';
import {
  computeCityKnobs,
  ENGINE_TAX_MAX,
  K_GROWTH_VALVE,
  K_UNEMP_VALVE,
  NEUTRAL_GDP_GROWTH_PCT,
  NEUTRAL_UNEMPLOYMENT_PCT,
  PUBLIC_SAFETY_BASELINE_DAILY,
  TRANSPORT_BASELINE_DAILY,
  type CityDriverInputs,
} from '@modules/city/server/lib/cityDriver';

/* Neutral inputs: T0 spend at baseline, macro at its anchors, sim tax at the
   default [10..40] range midpoint-ish real value. */
function inputs(overrides: Partial<CityDriverInputs> = {}): CityDriverInputs {
  return {
    taxRatePercent: 34,
    taxRateMinPercent: 10,
    taxRateMaxPercent: 40,
    publicSafetyDailySpend: PUBLIC_SAFETY_BASELINE_DAILY,
    transportDailySpend: TRANSPORT_BASELINE_DAILY,
    gdpGrowthPct: NEUTRAL_GDP_GROWTH_PCT,
    unemploymentPct: NEUTRAL_UNEMPLOYMENT_PCT,
    ...overrides,
  };
}

describe('computeCityKnobs — tax mapping', () => {
  it('maps the sim range endpoints onto the engine endpoints', () => {
    expect(computeCityKnobs(inputs({ taxRatePercent: 10 })).knobs.taxRate).toBe(0);
    expect(computeCityKnobs(inputs({ taxRatePercent: 40 })).knobs.taxRate).toBe(ENGINE_TAX_MAX);
  });

  it('keeps the signal alive mid-range (current sim tax 34 does not saturate)', () => {
    expect(computeCityKnobs(inputs({ taxRatePercent: 34 })).knobs.taxRate).toBe(16);
    expect(computeCityKnobs(inputs({ taxRatePercent: 25 })).knobs.taxRate).toBe(10);
  });

  it('clamps outside the configured sim range', () => {
    expect(computeCityKnobs(inputs({ taxRatePercent: 5 })).knobs.taxRate).toBe(0);
    expect(computeCityKnobs(inputs({ taxRatePercent: 60 })).knobs.taxRate).toBe(ENGINE_TAX_MAX);
  });

  it('degrades to a direct clamp on a degenerate (zero-span) range', () => {
    const degenerate = inputs({ taxRateMinPercent: 15, taxRateMaxPercent: 15 });
    expect(computeCityKnobs({ ...degenerate, taxRatePercent: 7 }).knobs.taxRate).toBe(7);
    expect(computeCityKnobs({ ...degenerate, taxRatePercent: 34 }).knobs.taxRate).toBe(ENGINE_TAX_MAX);
  });
});

describe('computeCityKnobs — funding ratios', () => {
  it('baseline spend = full funding, half spend = half funding', () => {
    const atBaseline = computeCityKnobs(inputs()).knobs;
    expect(atBaseline.fireFunding).toBe(1);
    expect(atBaseline.policeFunding).toBe(1);
    expect(atBaseline.roadFunding).toBe(1);

    const half = computeCityKnobs(inputs({
      publicSafetyDailySpend: PUBLIC_SAFETY_BASELINE_DAILY / 2,
      transportDailySpend: TRANSPORT_BASELINE_DAILY / 2,
    })).knobs;
    expect(half.fireFunding).toBeCloseTo(0.5);
    expect(half.policeFunding).toBeCloseTo(0.5);
    expect(half.roadFunding).toBeCloseTo(0.5);
  });

  it('clamps at 0 (lapsed programs) and 1 (over-baseline spend)', () => {
    const lapsed = computeCityKnobs(inputs({ publicSafetyDailySpend: 0, transportDailySpend: 0 })).knobs;
    expect(lapsed.fireFunding).toBe(0);
    expect(lapsed.policeFunding).toBe(0);
    expect(lapsed.roadFunding).toBe(0);

    const lavish = computeCityKnobs(inputs({
      publicSafetyDailySpend: PUBLIC_SAFETY_BASELINE_DAILY * 3,
      transportDailySpend: TRANSPORT_BASELINE_DAILY * 3,
    })).knobs;
    expect(lavish.fireFunding).toBe(1);
    expect(lavish.policeFunding).toBe(1);
    expect(lavish.roadFunding).toBe(1);
  });

  it('police and fire share the public-safety ratio', () => {
    const k = computeCityKnobs(inputs({ publicSafetyDailySpend: PUBLIC_SAFETY_BASELINE_DAILY * 0.8 })).knobs;
    expect(k.policeFunding).toBe(k.fireFunding);
    expect(k.policeFunding).toBeCloseTo(0.8);
  });
});

describe('computeCityKnobs — external demand offsets', () => {
  it('neutral fallback inputs produce zero offsets', () => {
    expect(computeCityKnobs(inputs()).externalDemand).toEqual({ r: 0, c: 0, i: 0 });
  });

  it('expansion (+3pp growth, tight labor) lifts all valves ~+600', () => {
    const d = computeCityKnobs(inputs({
      gdpGrowthPct: NEUTRAL_GDP_GROWTH_PCT + 3,
      unemploymentPct: NEUTRAL_UNEMPLOYMENT_PCT - 3,
    })).externalDemand;
    expect(d.c).toBe(3 * K_GROWTH_VALVE);
    expect(d.i).toBe(3 * K_GROWTH_VALVE);
    expect(d.r).toBe(3 * K_UNEMP_VALVE);
  });

  it('recession (-3pp growth, slack labor) suppresses all valves ~-600', () => {
    const d = computeCityKnobs(inputs({
      gdpGrowthPct: NEUTRAL_GDP_GROWTH_PCT - 3,
      unemploymentPct: NEUTRAL_UNEMPLOYMENT_PCT + 3,
    })).externalDemand;
    expect(d.c).toBe(-3 * K_GROWTH_VALVE);
    expect(d.i).toBe(-3 * K_GROWTH_VALVE);
    expect(d.r).toBe(-3 * K_UNEMP_VALVE);
  });
});

describe('computeCityKnobs — invariants', () => {
  it('disasters are always off in this slice', () => {
    expect(computeCityKnobs(inputs({ gdpGrowthPct: -8 })).knobs.disastersEnabled).toBe(false);
  });

  it('baselines match the T0 seed manifest', () => {
    expect(PUBLIC_SAFETY_BASELINE_DAILY).toBe(445_000_000);
    expect(TRANSPORT_BASELINE_DAILY).toBe(450_000_000);
  });
});
