import { describe, it, expect } from 'vitest';
import { trimToCurrentEra, type SeriesPoint } from '../../../src/modules/government/client/lib/budgetSeries';

function point(overrides: Partial<SeriesPoint> = {}): SeriesPoint {
  return {
    tickNumber: 1,
    revenue: 0,
    spending: 0,
    treasuryEnd: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('trimToCurrentEra', () => {
  it('drops old-currency points before the last >1000x treasuryEnd jump', () => {
    const series: SeriesPoint[] = [
      point({ tickNumber: 748, treasuryEnd: 5_200 }),
      point({ tickNumber: 749, treasuryEnd: 5_310 }),
      point({ tickNumber: 750, treasuryEnd: 1_770_000_000_000 }), // rebase
      point({ tickNumber: 751, treasuryEnd: 1_771_000_000_000 }),
    ];
    const trimmed = trimToCurrentEra(series);
    expect(trimmed).toEqual([
      point({ tickNumber: 750, treasuryEnd: 1_770_000_000_000 }),
      point({ tickNumber: 751, treasuryEnd: 1_771_000_000_000 }),
    ]);
  });

  it('returns the series unchanged (same reference) when there is no discontinuity', () => {
    const series: SeriesPoint[] = [
      point({ tickNumber: 1, treasuryEnd: 1_000_000_000 }),
      point({ tickNumber: 2, treasuryEnd: 1_010_000_000 }),
      point({ tickNumber: 3, treasuryEnd: 1_005_000_000 }),
    ];
    expect(trimToCurrentEra(series)).toBe(series);
  });

  it('returns an empty array unchanged', () => {
    const series: SeriesPoint[] = [];
    expect(trimToCurrentEra(series)).toBe(series);
  });

  it('returns a single-point series unchanged', () => {
    const series: SeriesPoint[] = [point({ tickNumber: 1, treasuryEnd: 5_000 })];
    expect(trimToCurrentEra(series)).toBe(series);
  });

  it('trims correctly when the jump occurs at the last position (keeps only the final point)', () => {
    const series: SeriesPoint[] = [
      point({ tickNumber: 1, treasuryEnd: 4_000 }),
      point({ tickNumber: 2, treasuryEnd: 4_100 }),
      point({ tickNumber: 3, treasuryEnd: 4_050 }),
      point({ tickNumber: 4, treasuryEnd: 2_000_000_000_000 }), // rebase on final point
    ];
    const trimmed = trimToCurrentEra(series);
    expect(trimmed).toEqual([point({ tickNumber: 4, treasuryEnd: 2_000_000_000_000 })]);
  });

  it('guards against divide-by-zero when the previous treasuryEnd is 0', () => {
    const series: SeriesPoint[] = [
      point({ tickNumber: 1, treasuryEnd: 0 }),
      point({ tickNumber: 2, treasuryEnd: 5_000_000 }),
    ];
    expect(() => trimToCurrentEra(series)).not.toThrow();
    // max(prev, 1) = 1, so 5,000,000 / 1 > 1000 counts as a jump.
    expect(trimToCurrentEra(series)).toEqual([point({ tickNumber: 2, treasuryEnd: 5_000_000 })]);
  });

  it('picks the LAST discontinuity when multiple large jumps exist', () => {
    const series: SeriesPoint[] = [
      point({ tickNumber: 1, treasuryEnd: 2 }),
      point({ tickNumber: 2, treasuryEnd: 5_000 }), // first jump (2500x)
      point({ tickNumber: 3, treasuryEnd: 5_100 }),
      point({ tickNumber: 4, treasuryEnd: 1_800_000_000_000 }), // second, later jump
      point({ tickNumber: 5, treasuryEnd: 1_800_500_000_000 }),
    ];
    const trimmed = trimToCurrentEra(series);
    expect(trimmed.map((p) => p.tickNumber)).toEqual([4, 5]);
  });
});
