import { describe, it, expect } from 'vitest';
import {
  assembleMetricRow,
  compareMetricDefinitions,
  type ScoreboardMetricDefinition,
  type ScoreboardSeriesPoint,
} from '@modules/government/server/lib/scoreboardReport';

/* Pins the GET /api/divergence/scoreboard row contract through the extraction
   (Workstream A2): the route moved to buildScoreboardMetrics() and the
   response must stay byte-identical — field set, insertion order, gap math,
   comparableSince rule, and status derivation are all asserted here. */

const def: ScoreboardMetricDefinition = {
  key: 'deficit_per_day',
  name: 'Deficit per day',
  unit: '$/day',
  direction: 'lower',
  tier: 'A',
  cadence: 'sim per tick; reality monthly',
  simSource: 'fiscal_tick_summaries',
  realitySource: 'MTS Table 1',
};

const simSeries: ScoreboardSeriesPoint[] = [
  { value: 5.0e9, atDate: '2026-08-01', atTick: 1200 },
  { value: 6.2e9, atDate: '2026-08-10', atTick: 1290 },
];
const realitySeries: ScoreboardSeriesPoint[] = [
  { value: 5.1e9, atDate: '2026-07-01', atTick: null },
];

describe('compareMetricDefinitions', () => {
  it('sorts by spec order, unknown keys after known ones alphabetically', () => {
    const rows = [
      { key: 'zz_future_metric' },
      { key: 'approval_trend' },
      { key: 'aa_future_metric' },
      { key: 'deficit_per_day' },
    ];
    rows.sort(compareMetricDefinitions);
    expect(rows.map((r) => r.key)).toEqual([
      'deficit_per_day',
      'approval_trend',
      'aa_future_metric',
      'zz_future_metric',
    ]);
  });
});

describe('assembleMetricRow', () => {
  it('produces the exact route row shape with latest values, gap, and mapped series', () => {
    const row = assembleMetricRow(def, simSeries, realitySeries, '2026-08-01', '2026-07-01');
    /* toEqual on the full object pins the field SET; the key-order check
       below pins JSON insertion order (byte-identical serialization). */
    expect(row).toEqual({
      key: 'deficit_per_day',
      name: 'Deficit per day',
      unit: '$/day',
      direction: 'lower',
      tier: 'A',
      cadence: 'sim per tick; reality monthly',
      simSource: 'fiscal_tick_summaries',
      realitySource: 'MTS Table 1',
      sim: { value: 6.2e9, atDate: '2026-08-10', atTick: 1290 },
      reality: { value: 5.1e9, atDate: '2026-07-01' },
      gap: 6.2e9 - 5.1e9,
      comparableSince: '2026-08-01',
      status: 'comparable',
      series: {
        sim: [
          { atDate: '2026-08-01', atTick: 1200, value: 5.0e9 },
          { atDate: '2026-08-10', atTick: 1290, value: 6.2e9 },
        ],
        reality: [{ atDate: '2026-07-01', value: 5.1e9 }],
      },
    });
    expect(Object.keys(row)).toEqual([
      'key', 'name', 'unit', 'direction', 'tier', 'cadence', 'simSource', 'realitySource',
      'sim', 'reality', 'gap', 'comparableSince', 'status', 'series',
    ]);
    expect(Object.keys(row.sim!)).toEqual(['value', 'atDate', 'atTick']);
    expect(Object.keys(row.reality!)).toEqual(['value', 'atDate']);
    expect(Object.keys(row.series.sim[0])).toEqual(['atDate', 'atTick', 'value']);
    expect(Object.keys(row.series.reality[0])).toEqual(['atDate', 'value']);
  });

  it('comparableSince is the LATER of the two first-snapshot dates', () => {
    expect(assembleMetricRow(def, simSeries, realitySeries, '2026-06-01', '2026-07-15').comparableSince).toBe('2026-07-15');
  });

  it('one-sided metrics report pending with null sim/reality/gap/comparableSince', () => {
    const row = assembleMetricRow(def, [], realitySeries, null, '2026-07-01');
    expect(row.sim).toBeNull();
    expect(row.gap).toBeNull();
    expect(row.comparableSince).toBeNull();
    expect(row.status).toBe('pending');
    expect(row.reality).toEqual({ value: 5.1e9, atDate: '2026-07-01' });

    const simOnlyRow = assembleMetricRow(def, simSeries, [], '2026-08-01', null);
    expect(simOnlyRow.reality).toBeNull();
    expect(simOnlyRow.status).toBe('pending');
    expect(simOnlyRow.sim).toEqual({ value: 6.2e9, atDate: '2026-08-10', atTick: 1290 });
  });
});
