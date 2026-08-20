/**
 * E4 Scoreboard v1 -- pure math for the sim-side metric exporter and the
 * scoreboard surface (docs/specs/observability-and-metrics.md). Every
 * function is deterministic and side-effect free, mirroring fiscalMath /
 * consequenceMath / divergenceMath: the tick block stays a thin
 * orchestrator (fetch rows, call these, upsert metric_snapshots), and the
 * guard convention holds -- never invent a number from corrupt or missing
 * input, return null / a safe default instead.
 */

import { debtToGdpPct, annualizedShareOfGdpPct } from '@modules/government/server/lib/divergenceMath.js';

/* One session-equivalent = one 2-year Congress = 730 sim days = 730 ticks.
   The spec's throughput metric is "laws enacted per session-equivalent";
   GovTrack's back-loading stat is per-Congress, so the session unit is the
   two-year Congress, not the one-year calendar session. */
export const SIM_SESSION_TICKS = 730;

/* Registry keys (migration 0033 seed) the sim exporter writes each tick. */
export const METRIC_KEYS = {
  deficitPerDay: 'deficit_per_day',
  debtToGdp: 'debt_to_gdp',
  spendingPctGdp: 'spending_pct_gdp',
  taxBurdenPctGdp: 'tax_burden_pct_gdp',
  legislativeThroughput: 'legislative_throughput',
  timeToPassage: 'time_to_passage',
  approvalTrend: 'approval_trend',
} as const;

export interface MetricValue {
  metricKey: string;
  value: number;
}

export interface SimFiscalInputs {
  revenue: number;
  spending: number;
  debtOutstanding: number;
  gdpAnnual: number;
}

/**
 * Tier A sim values from one tick's settled fiscal summary. 1 tick = 1 sim
 * day, so per-tick flows ARE daily flows; %-of-GDP forms annualize the
 * daily figure (same normalization the reality side applies to FYTD
 * averages). Non-finite inputs contribute nothing rather than a fake 0 --
 * a corrupt summary row should produce a gap in the series, not a lie.
 */
export function simTierAValues(f: SimFiscalInputs): MetricValue[] {
  const out: MetricValue[] = [];
  if (Number.isFinite(f.revenue) && Number.isFinite(f.spending)) {
    out.push({ metricKey: METRIC_KEYS.deficitPerDay, value: f.spending - f.revenue });
    out.push({ metricKey: METRIC_KEYS.taxBurdenPctGdp, value: annualizedShareOfGdpPct(f.revenue, f.gdpAnnual) });
    out.push({ metricKey: METRIC_KEYS.spendingPctGdp, value: annualizedShareOfGdpPct(f.spending, f.gdpAnnual) });
  }
  if (Number.isFinite(f.debtOutstanding)) {
    out.push({ metricKey: METRIC_KEYS.debtToGdp, value: debtToGdpPct(f.debtOutstanding, f.gdpAnnual) });
  }
  return out;
}

/** Median of a numeric list (average of middle two on even length). Null on empty. */
export function median(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 1 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
}

/**
 * Median introduction->enactment duration in SIM DAYS. Bill/law timestamps
 * are wall-clock, so durations convert via the tick interval (1 tick = 1
 * sim day). The conversion uses the CURRENT interval -- historical interval
 * changes (90min -> 30min, 2026-08-17) skew older durations; acceptable for
 * a trend metric, and introduction ticks simply aren't stored to do better.
 * Null when no durations or a non-positive interval.
 */
export function medianPassageTicks(durationsMs: number[], tickIntervalMs: number): number | null {
  if (!Number.isFinite(tickIntervalMs) || tickIntervalMs <= 0) return null;
  const ticks = durationsMs
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .map((ms) => ms / tickIntervalMs);
  const m = median(ticks);
  return m === null ? null : Math.round(m * 100) / 100;
}

/**
 * Laws per session-equivalent, linear projection: count * session / elapsed.
 * The sim enacts continuously (no known back-loading), so linear is the
 * honest projection here; the reality side gets the session-relative
 * back-load normalization instead (backloadNormalizedSessionTotal). Null
 * until at least one full tick has elapsed since T0.
 */
export function throughputPerSession(
  enactedCount: number,
  elapsedTicks: number,
  sessionTicks: number = SIM_SESSION_TICKS,
): number | null {
  if (!Number.isFinite(enactedCount) || enactedCount < 0) return null;
  if (!Number.isFinite(elapsedTicks) || elapsedTicks <= 0) return null;
  if (!Number.isFinite(sessionTicks) || sessionTicks <= 0) return null;
  return Math.round(((enactedCount * sessionTicks) / elapsedTicks) * 100) / 100;
}

/**
 * Real-Congress enactment is back-loaded: GovTrack shows ~33% of a
 * Congress's eventual laws exist by December of year 1 (~48% elapsed).
 * Projecting a full-session total from a mid-session count therefore
 * divides by the EXPECTED share at this point, not the elapsed fraction --
 * piecewise linear through (0,0) -> (0.48, 0.33) -> (1,1). Null when the
 * session hasn't started or the count is invalid.
 */
export function backloadNormalizedSessionTotal(count: number, elapsedFraction: number): number | null {
  if (!Number.isFinite(count) || count < 0) return null;
  if (!Number.isFinite(elapsedFraction) || elapsedFraction <= 0) return null;
  const t = Math.min(1, elapsedFraction);
  const share = t <= 0.48 ? (0.33 / 0.48) * t : 0.33 + ((t - 0.48) / 0.52) * 0.67;
  if (share <= 0) return null;
  return Math.round((count / share) * 100) / 100;
}

/** Mean approval over the officeholder set, one decimal. Null on empty. */
export function averageApproval(ratings: number[]): number | null {
  const finite = ratings.filter((r) => Number.isFinite(r));
  if (finite.length === 0) return null;
  const avg = finite.reduce((sum, r) => sum + r, 0) / finite.length;
  return Math.round(avg * 10) / 10;
}

/**
 * The sim date for a tick: T0's date plus (tick - t0Tick) days, since
 * 1 tick = 1 sim day. Falls back to `fallbackDate` (the caller passes the
 * current wall date) when T0 is unset or unparseable -- sim snapshots are
 * still written pre-T0, they just aren't anchored to the divergence clock.
 * Returns 'YYYY-MM-DD'.
 */
export function simDateForTick(tickNumber: number, t0Tick: number, t0Date: string, fallbackDate: string): string {
  if (t0Tick > 0 && t0Date) {
    const t0 = new Date(`${t0Date.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(t0.getTime()) && Number.isFinite(tickNumber)) {
      const d = new Date(t0.getTime() + (tickNumber - t0Tick) * 86_400_000);
      return d.toISOString().slice(0, 10);
    }
  }
  return fallbackDate;
}
