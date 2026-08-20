import { describe, it, expect } from 'vitest';
import {
  buildScoreboardDigest,
  movedSinceTick,
  fmtMetricValue,
  type ScoreboardDigestMetric,
} from '@core/server/lib/scoreboardDigest';

const PERIOD = 'sim date 2026-09-01, tick 1380 — covering ticks 1291-1380';

function metric(over: Partial<ScoreboardDigestMetric> = {}): ScoreboardDigestMetric {
  return {
    key: 'deficit_per_day',
    name: 'Deficit per day',
    unit: '$/day',
    tier: 'A',
    sim: { value: 6_200_000_000, atTick: 1380 },
    reality: { value: 5_100_000_000, atDate: '2026-08-01' },
    gap: 1_100_000_000,
    status: 'comparable',
    series: {
      sim: [
        { atTick: 1200, value: 5_000_000_000 },
        { atTick: 1290, value: 5_800_000_000 },
        { atTick: 1380, value: 6_200_000_000 },
      ],
    },
    ...over,
  };
}

function pendingMetric(key: string, name: string): ScoreboardDigestMetric {
  return metric({
    key,
    name,
    unit: '%',
    tier: 'C',
    sim: null,
    reality: { value: 4.2, atDate: '2026-07-01' },
    gap: null,
    status: 'pending',
    series: { sim: [] },
  });
}

describe('fmtMetricValue', () => {
  it('renders magnitude suffixes deterministically', () => {
    expect(fmtMetricValue(6_200_000_000)).toBe('6.2B');
    expect(fmtMetricValue(-1_100_000_000)).toBe('-1.1B');
    expect(fmtMetricValue(28_000_000_000_000)).toBe('28T');
    expect(fmtMetricValue(1_500_000)).toBe('1.5M');
    expect(fmtMetricValue(15_000)).toBe('15K');
    expect(fmtMetricValue(34.271)).toBe('34.27');
    expect(fmtMetricValue(0)).toBe('0');
  });
});

describe('movedSinceTick', () => {
  it('diffs latest sim value against the last series point at or before the previous report tick', () => {
    expect(movedSinceTick(metric(), 1290)).toBe(6_200_000_000 - 5_800_000_000);
    expect(movedSinceTick(metric(), 1250)).toBe(6_200_000_000 - 5_000_000_000);
    expect(movedSinceTick(metric(), 1380)).toBe(0);
  });

  it('is null with no previous report, no sim value, or no baseline in window', () => {
    expect(movedSinceTick(metric(), null)).toBeNull();
    expect(movedSinceTick(metric({ sim: null }), 1290)).toBeNull();
    expect(movedSinceTick(metric(), 1100)).toBeNull(); // all points after the tick
  });
});

describe('buildScoreboardDigest', () => {
  it('returns null when nothing comparable and no sim data', () => {
    expect(buildScoreboardDigest([], null, PERIOD)).toBeNull();
    expect(buildScoreboardDigest([pendingMetric('unemployment_rate', 'Unemployment rate')], null, PERIOD)).toBeNull();
  });

  it('renders the period header and a comparable line with sim/reality/gap/moved', () => {
    const digest = buildScoreboardDigest([metric()], 1290, PERIOD);
    expect(digest).toBe(
      [
        `PERIOD: ${PERIOD}`,
        'COMPARABLE (sim vs reality):',
        '- Deficit per day: sim 6.2B vs reality 5.1B $/day; gap +1.1B; moved +400M since last report',
      ].join('\n'),
    );
  });

  it('marks the inaugural report instead of inventing a delta', () => {
    const digest = buildScoreboardDigest([metric()], null, PERIOD);
    expect(digest).toContain('first report');
    expect(digest).not.toContain('moved');
  });

  it('reports sim-only and pending metrics honestly in their own sections', () => {
    const digest = buildScoreboardDigest(
      [
        metric(),
        metric({ key: 'approval_trend', name: 'Approval trend', unit: '% approve', tier: 'B', reality: null, gap: null, status: 'pending', sim: { value: 46.1, atTick: 1380 }, series: { sim: [{ atTick: 1380, value: 46.1 }] } }),
        pendingMetric('unemployment_rate', 'Unemployment rate'),
      ],
      1290,
      PERIOD,
    );
    expect(digest).toContain('SIM ONLY (reality side not yet available):');
    expect(digest).toContain('- Approval trend: sim 46.1 % approve; no reality series yet — not comparable');
    expect(digest).toContain('PENDING (no sim measurement exists — do not invent):');
    expect(digest).toContain('- Unemployment rate: pending — no sim-side data yet (reality: 4.2 %)');
  });

  it('is deterministic for the same input', () => {
    const input = [metric(), pendingMetric('inflation_rate', 'Inflation rate')];
    expect(buildScoreboardDigest(input, 1290, PERIOD)).toBe(buildScoreboardDigest(input, 1290, PERIOD));
  });

  it('stays under 3000 chars, trimming pending lines before comparable ones', () => {
    const many: ScoreboardDigestMetric[] = [];
    for (let i = 0; i < 30; i++) {
      many.push(metric({ key: `m${i}`, name: `Metric ${i} ${'x'.repeat(120)}` }));
    }
    for (let i = 0; i < 30; i++) {
      many.push(pendingMetric(`p${i}`, `Pending ${i} ${'y'.repeat(120)}`));
    }
    const digest = buildScoreboardDigest(many, 1290, PERIOD);
    expect(digest).not.toBeNull();
    expect(digest!.length).toBeLessThanOrEqual(3000);
    /* Comparable section survives; the pending tail went first. */
    expect(digest).toContain('- Metric 0');
    expect(digest).not.toContain('- Pending 29');
  });

  it('keeps at least one metric line even when a single line is near the cap', () => {
    const digest = buildScoreboardDigest([metric({ name: 'N'.repeat(500) })], 1290, PERIOD);
    expect(digest).not.toBeNull();
    expect(digest!.length).toBeLessThanOrEqual(3000);
    expect(digest).toContain('COMPARABLE');
  });
});
