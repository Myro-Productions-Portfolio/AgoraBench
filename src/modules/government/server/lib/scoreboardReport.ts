import { db } from '@db/connection';
import { metricDefinitions, metricSnapshots } from '@db/schema/index';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';

/**
 * Shared scoreboard metrics assembly, extracted verbatim from
 * GET /api/divergence/scoreboard so the 10-K tick block and the route read
 * the SAME rows. The route stays the shape contract: keep field names and
 * insertion order stable — the response must remain byte-identical.
 */

/* Spec order of the registry rows (observability-and-metrics.md §launch
   metrics). The registry drives everything else about the response; this
   array only pins presentation order (insert order isn't a SQL concept).
   Keys not listed (future metrics) append after, alphabetically. */
const METRIC_SPEC_ORDER = [
  'deficit_per_day',
  'debt_to_gdp',
  'spending_pct_gdp',
  'tax_burden_pct_gdp',
  'legislative_throughput',
  'time_to_passage',
  'approval_trend',
  'shutdown_days',
  'unemployment_rate',
  'inflation_rate',
  'gdp_growth',
  'poverty_uninsured_rate',
];

const SCOREBOARD_SERIES_CAP = 500;

export interface ScoreboardSeriesPoint {
  value: number;
  atDate: string;
  atTick: number | null;
}

export interface ScoreboardMetricDefinition {
  key: string;
  name: string;
  unit: string;
  direction: string;
  tier: string;
  cadence: string;
  simSource: string;
  realitySource: string;
}

export interface ScoreboardMetric extends ScoreboardMetricDefinition {
  sim: { value: number; atDate: string; atTick: number | null } | null;
  reality: { value: number; atDate: string } | null;
  gap: number | null;
  comparableSince: string | null;
  status: 'comparable' | 'pending';
  series: {
    sim: { atDate: string; atTick: number | null; value: number }[];
    reality: { atDate: string; value: number }[];
  };
}

/** Pure: spec-order comparator (unknown keys append after, alphabetically). */
export function compareMetricDefinitions(a: { key: string }, b: { key: string }): number {
  const ai = METRIC_SPEC_ORDER.indexOf(a.key);
  const bi = METRIC_SPEC_ORDER.indexOf(b.key);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return a.key.localeCompare(b.key);
}

/** Pure: one response row from a definition + its (ascending) series + first-snapshot dates. */
export function assembleMetricRow(
  def: ScoreboardMetricDefinition,
  simSeries: ScoreboardSeriesPoint[],
  realitySeries: ScoreboardSeriesPoint[],
  firstSim: string | null,
  firstReality: string | null,
): ScoreboardMetric {
  const latestSim = simSeries.length > 0 ? simSeries[simSeries.length - 1] : null;
  const latestReality = realitySeries.length > 0 ? realitySeries[realitySeries.length - 1] : null;

  const comparableSince = firstSim && firstReality
    ? (firstSim > firstReality ? firstSim : firstReality)
    : null;

  return {
    key: def.key,
    name: def.name,
    unit: def.unit,
    direction: def.direction,
    tier: def.tier,
    cadence: def.cadence,
    simSource: def.simSource,
    realitySource: def.realitySource,
    sim: latestSim ? { value: latestSim.value, atDate: latestSim.atDate, atTick: latestSim.atTick } : null,
    reality: latestReality ? { value: latestReality.value, atDate: latestReality.atDate } : null,
    gap: latestSim && latestReality ? latestSim.value - latestReality.value : null,
    comparableSince,
    status: comparableSince ? 'comparable' as const : 'pending' as const,
    series: {
      sim: simSeries.map((p) => ({ atDate: p.atDate, atTick: p.atTick, value: p.value })),
      reality: realitySeries.map((p) => ({ atDate: p.atDate, value: p.value })),
    },
  };
}

/** Full scoreboard payload: registry rows + latest/series/gap per side + T0. */
export async function buildScoreboardMetrics(): Promise<{
  t0: { tick: number; date: string } | null;
  metrics: ScoreboardMetric[];
}> {
  const rc = getRuntimeConfig();
  const t0 = rc.divergenceT0Tick > 0
    ? { tick: rc.divergenceT0Tick, date: rc.divergenceT0Date }
    : null;

  const definitions = await db.select().from(metricDefinitions);
  definitions.sort(compareMetricDefinitions);

  /* First-snapshot date per (metric, side) in one grouped query --
     series below are tail-capped, so earliest dates need their own scan. */
  const bounds = await db
    .select({
      metricKey: metricSnapshots.metricKey,
      side: metricSnapshots.side,
      firstDate: sql<string | null>`MIN(${metricSnapshots.atDate})`,
    })
    .from(metricSnapshots)
    .groupBy(metricSnapshots.metricKey, metricSnapshots.side);
  const firstDateBySide = new Map(bounds.map((b) => [`${b.metricKey}|${b.side}`, b.firstDate]));

  const metrics: ScoreboardMetric[] = [];
  for (const def of definitions) {
    const fetchSeries = async (side: 'sim' | 'reality') => {
      const rows = await db
        .select({ value: metricSnapshots.value, atDate: metricSnapshots.atDate, atTick: metricSnapshots.atTick })
        .from(metricSnapshots)
        .where(and(eq(metricSnapshots.metricKey, def.key), eq(metricSnapshots.side, side)))
        .orderBy(desc(metricSnapshots.atDate), desc(metricSnapshots.atTick))
        .limit(SCOREBOARD_SERIES_CAP);
      return rows.reverse();
    };
    const [simSeries, realitySeries] = await Promise.all([fetchSeries('sim'), fetchSeries('reality')]);

    metrics.push(assembleMetricRow(
      def,
      simSeries,
      realitySeries,
      firstDateBySide.get(`${def.key}|sim`) ?? null,
      firstDateBySide.get(`${def.key}|reality`) ?? null,
    ));
  }

  return { t0, metrics };
}
