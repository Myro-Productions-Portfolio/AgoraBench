import { describe, it, expect } from 'vitest';
import {
  simTierAValues,
  median,
  medianPassageTicks,
  throughputPerSession,
  backloadNormalizedSessionTotal,
  averageApproval,
  simDateForTick,
  METRIC_KEYS,
  SIM_SESSION_TICKS,
} from '@core/server/lib/scoreboardMath';

const GDP = 28_000_000_000_000;

describe('simTierAValues', () => {
  it('computes all four Tier A metrics from a settled fiscal summary', () => {
    const values = simTierAValues({
      revenue: 14_580_000_000,
      spending: 19_460_000_000,
      debtOutstanding: 39_000_000_000_000,
      gdpAnnual: GDP,
    });
    const byKey = new Map(values.map((v) => [v.metricKey, v.value]));

    expect(byKey.get(METRIC_KEYS.deficitPerDay)).toBe(4_880_000_000);
    // debtToGdpPct: 39T / 28T = 139.3%
    expect(byKey.get(METRIC_KEYS.debtToGdp)).toBe(139.3);
    // annualized: 19.46B * 365 / 28T = 25.4%
    expect(byKey.get(METRIC_KEYS.spendingPctGdp)).toBe(25.4);
    // annualized: 14.58B * 365 / 28T = 19.0%
    expect(byKey.get(METRIC_KEYS.taxBurdenPctGdp)).toBe(19);
    expect(values).toHaveLength(4);
  });

  it('reports a surplus as a negative deficit', () => {
    const values = simTierAValues({ revenue: 100, spending: 40, debtOutstanding: 0, gdpAnnual: GDP });
    const byKey = new Map(values.map((v) => [v.metricKey, v.value]));
    expect(byKey.get(METRIC_KEYS.deficitPerDay)).toBe(-60);
    expect(byKey.get(METRIC_KEYS.debtToGdp)).toBe(0);
  });

  it('skips flow metrics on non-finite revenue/spending rather than inventing zeros', () => {
    const values = simTierAValues({ revenue: NaN, spending: 40, debtOutstanding: 100, gdpAnnual: GDP });
    expect(values.map((v) => v.metricKey)).toEqual([METRIC_KEYS.debtToGdp]);
  });
});

describe('median', () => {
  it('returns the middle value for odd length and the mid-average for even', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('ignores non-finite entries and returns null on empty', () => {
    expect(median([NaN, Infinity, 5])).toBe(5);
    expect(median([])).toBeNull();
    expect(median([NaN])).toBeNull();
  });
});

describe('medianPassageTicks', () => {
  const TICK_MS = 30 * 60_000; // 30-min ticks

  it('converts wall-clock durations to ticks (sim days) and takes the median', () => {
    // 2, 4, 6 ticks of wall time
    const durations = [2, 4, 6].map((t) => t * TICK_MS);
    expect(medianPassageTicks(durations, TICK_MS)).toBe(4);
  });

  it('drops negative/non-finite durations and nulls out on no data or bad interval', () => {
    expect(medianPassageTicks([-5, NaN, 3 * TICK_MS], TICK_MS)).toBe(3);
    expect(medianPassageTicks([], TICK_MS)).toBeNull();
    expect(medianPassageTicks([TICK_MS], 0)).toBeNull();
  });
});

describe('throughputPerSession', () => {
  it('linearly projects enactments onto a 730-tick session-equivalent', () => {
    // 10 laws in 365 ticks -> 20 per session
    expect(throughputPerSession(10, 365)).toBe(20);
    expect(throughputPerSession(0, 100)).toBe(0);
  });

  it('nulls out before any tick has elapsed or on invalid inputs', () => {
    expect(throughputPerSession(5, 0)).toBeNull();
    expect(throughputPerSession(-1, 100)).toBeNull();
    expect(throughputPerSession(NaN, 100)).toBeNull();
  });

  it('session constant is the 2-year Congress in ticks', () => {
    expect(SIM_SESSION_TICKS).toBe(730);
  });
});

describe('backloadNormalizedSessionTotal', () => {
  it('divides by the expected back-loaded share, not the elapsed fraction', () => {
    // At the GovTrack anchor (48% elapsed, 33% of laws expected): 100 laws
    // observed projects the full-session total 100/0.33, NOT 100/0.48.
    expect(backloadNormalizedSessionTotal(100, 0.48)).toBeCloseTo(100 / 0.33, 1);
  });

  it('is the identity at session end and clamps beyond it', () => {
    expect(backloadNormalizedSessionTotal(300, 1)).toBe(300);
    expect(backloadNormalizedSessionTotal(300, 1.2)).toBe(300);
  });

  it('nulls out at or before session start and on invalid counts', () => {
    expect(backloadNormalizedSessionTotal(10, 0)).toBeNull();
    expect(backloadNormalizedSessionTotal(-1, 0.5)).toBeNull();
  });
});

describe('averageApproval', () => {
  it('averages to one decimal', () => {
    expect(averageApproval([40, 45, 50])).toBe(45);
    expect(averageApproval([33, 34])).toBe(33.5);
  });

  it('ignores non-finite ratings and returns null on empty', () => {
    expect(averageApproval([NaN, 60])).toBe(60);
    expect(averageApproval([])).toBeNull();
  });
});

describe('simDateForTick', () => {
  it('anchors the sim date to T0: tick N = T0 date + (N - t0Tick) days', () => {
    expect(simDateForTick(770, 770, '2026-07-05', '2099-01-01')).toBe('2026-07-05');
    expect(simDateForTick(800, 770, '2026-07-05', '2099-01-01')).toBe('2026-08-04');
    // 1 tick = 1 sim day, so 365 ticks later is one sim year later
    expect(simDateForTick(1135, 770, '2026-07-05', '2099-01-01')).toBe('2027-07-05');
  });

  it('falls back to the provided wall date when T0 is unset or unparseable', () => {
    expect(simDateForTick(100, 0, '', '2026-08-19')).toBe('2026-08-19');
    expect(simDateForTick(100, 50, 'not-a-date', '2026-08-19')).toBe('2026-08-19');
  });
});
