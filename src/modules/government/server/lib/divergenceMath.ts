/**
 * Divergence experiment, slice 4 -- pure math for the /divergence surface
 * (docs/DIVERGENCE_EXPERIMENT.md §2.4). Every function here is
 * deterministic and side-effect free so the route handler (divergence.ts)
 * can stay a thin orchestrator: fetch rows, call these, shape JSON.
 *
 * Two families of helpers:
 *   - per-day / per-tick derivations from raw sim + reality aggregates
 *     (guarded against division by zero and non-finite input throughout,
 *     matching the fiscalMath.ts convention: never invent numbers from
 *     corrupt state, resolve to a safe default instead)
 *   - the category-mix L1 divergence score, built on a small static
 *     mapping from sim `fiscalProgramName` values (the seed table in
 *     DIVERGENCE_EXPERIMENT.md §2.2) to Treasury MTS Table 9 category
 *     names (confirmed live field values -- see
 *     tests/fixtures/reality/mts_table_9.json and realityFeed.ts's header
 *     comment for provenance).
 */

/* ── Category mapping: sim seed program name -> MTS Table 9 category ──── */

/**
 * The T0 seed (§2.2) enacts 13 named programs. This maps each sim program
 * name to the Treasury MTS Table 9 budget-function bucket it corresponds
 * to. Only a subset of the ~19 real MTS categories have a clean 1:1 sim
 * analog today (no Medicaid/veterans/nondefense-discretionary breakdown on
 * the MTS side at this granularity in v1) -- unmapped mass on EITHER side
 * still counts toward the L1 distance (see categoryShares below), so an
 * incomplete mapping does not artificially shrink the divergence score.
 *
 * Confirmed real MTS Table 9 category names (live field values, not
 * guessed): 'National Defense', 'Social Security', 'Medicare',
 * 'Net Interest', 'Commerce and Housing Credit' -- see
 * tests/fixtures/reality/mts_table_9.json.
 *
 * Sim-side interest is not a law (automatic outflow -- fiscalMath.ts
 * tickInterest), so it has no fiscalProgramName; the divergence route
 * adds a synthetic 'Net Interest' bucket from the debt-engine interest
 * figure directly (see divergence.ts) rather than routing it through this
 * law-name map.
 */
export const PROGRAM_TO_MTS_CATEGORY: Readonly<Record<string, string>> = {
  'Social Security': 'Social Security',
  'Medicare': 'Medicare',
  'National Defense': 'National Defense',
};

/** Bucket label for sim (or reality) mass that has no counterpart mapping. */
export const UNMAPPED_CATEGORY_LABEL = 'Other / Unmapped';

export interface CategoryAmount {
  name: string;
  amount: number;
}

/**
 * Normalize a list of (category, amount) pairs into a share-of-total map,
 * folding any name not present in `mapTo` (when provided) into
 * UNMAPPED_CATEGORY_LABEL. Non-finite / negative amounts are treated as 0
 * (a corrupt row should never inflate or deflate the total). Returns an
 * empty map when the total is <= 0 (nothing to share out) -- callers must
 * treat that as "no mix data", not a valid all-zero mix.
 */
export function categoryShares(
  rows: CategoryAmount[],
  mapTo?: (name: string) => string | null,
): Map<string, number> {
  const totals = new Map<string, number>();
  let grandTotal = 0;

  for (const row of rows) {
    const amount = Number.isFinite(row.amount) && row.amount > 0 ? row.amount : 0;
    if (amount === 0) continue;
    const label = mapTo ? (mapTo(row.name) ?? UNMAPPED_CATEGORY_LABEL) : row.name;
    totals.set(label, (totals.get(label) ?? 0) + amount);
    grandTotal += amount;
  }

  if (grandTotal <= 0) return new Map();

  const shares = new Map<string, number>();
  for (const [label, amount] of totals) {
    shares.set(label, amount / grandTotal);
  }
  return shares;
}

/**
 * L1 (Manhattan) distance between two category-share distributions, summed
 * over the union of categories present in either map. Missing categories on
 * one side contribute their full share from the other side (treated as 0).
 * Range: [0, 2] -- 0 when the mixes are identical, 2 when they are fully
 * disjoint (no shared mass at all, since each distribution sums to 1).
 * Returns null when either map is empty (no comparable mix on one side).
 */
export function l1CategoryDistance(a: Map<string, number>, b: Map<string, number>): number | null {
  if (a.size === 0 || b.size === 0) return null;

  const categories = new Set<string>([...a.keys(), ...b.keys()]);
  let distance = 0;
  for (const cat of categories) {
    const av = a.get(cat) ?? 0;
    const bv = b.get(cat) ?? 0;
    distance += Math.abs(av - bv);
  }
  /* Guard tiny float noise from summing many small shares (e.g. 2.0000000000000004). */
  return Math.round(distance * 1e10) / 1e10;
}

/* ── Per-day / per-tick derivations ─────────────────────────────────────── */

/**
 * Convert a fiscal-year-to-date cumulative figure into a daily average,
 * given the number of elapsed days in the fiscal year as of `asOfDate`.
 * The US federal fiscal year runs Oct 1 -> Sep 30. Non-finite / non-positive
 * fytdAmount returns 0; a bad or missing asOfDate returns 0 (never invent a
 * rate from a date we can't parse).
 */
export function fytdToDailyAverage(fytdAmount: number, asOfDate: string): number {
  if (!Number.isFinite(fytdAmount)) return 0;
  const asOf = new Date(asOfDate);
  if (Number.isNaN(asOf.getTime())) return 0;

  const fiscalYearStart = new Date(Date.UTC(
    asOf.getUTCMonth() >= 9 ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1,
    9, // October, 0-indexed
    1,
  ));
  const elapsedMs = asOf.getTime() - fiscalYearStart.getTime();
  const elapsedDays = Math.max(1, Math.round(elapsedMs / 86_400_000));
  return fytdAmount / elapsedDays;
}

/**
 * Debt (or any stock) as a percentage of annual GDP, one decimal place.
 * Non-finite/non-positive gdpAnnual (division-by-zero guard) or non-finite
 * debt returns 0.
 */
export function debtToGdpPct(debtOutstanding: number, gdpAnnual: number): number {
  if (!Number.isFinite(debtOutstanding) || !Number.isFinite(gdpAnnual) || gdpAnnual <= 0) return 0;
  return Math.round((debtOutstanding / gdpAnnual) * 1000) / 10;
}

/**
 * Receipts (or any flow), annualized from a daily average, as a percentage
 * of annual GDP -- used for the "tax burden" comparison (reality has no
 * single stored tax-rate-percent figure, only receipts). One decimal place.
 * Non-finite/non-positive gdpAnnual returns 0.
 */
export function annualizedShareOfGdpPct(dailyAverage: number, gdpAnnual: number): number {
  if (!Number.isFinite(dailyAverage) || !Number.isFinite(gdpAnnual) || gdpAnnual <= 0) return 0;
  const annualized = dailyAverage * 365;
  return Math.round((annualized / gdpAnnual) * 1000) / 10;
}
