// src/modules/government/server/lib/realityFeed.ts
//
// Divergence experiment, slice 3 -- reality reference pool puller.
//
// Pulls periodic snapshots from the Treasury Fiscal Data API
// (api.fiscaldata.treasury.gov, no auth, plain GET, self-describing JSON)
// and stores them in `reality_snapshots` purely for later comparison
// against sim state. NOTHING in the simulation reads this table.
//
// Three independent sources, each try/caught in isolation -- one failing
// source must never block the others or throw to the caller:
//   - mts_table_9  -- spending-by-function category breakdown (FYTD)
//   - mts_table_1  -- top-line receipts/outlays/deficit (FYTD)
//   - debt_to_penny -- latest total public debt outstanding
//
// Field names below were confirmed by live inspection of the actual API
// responses on 2026-07-06 (self-describing JSON:API-style payloads), not
// guessed from documentation:
//   MTS Table 9 row: record_date, classification_desc, data_type_cd,
//     record_type_cd, sequence_level_nbr, current_fytd_rcpt_outly_amt,
//     current_month_rcpt_outly_amt, record_fiscal_year, record_calendar_month.
//     Category rows are data_type_cd='D', record_type_cd='F' (spending-by-
//     function detail, sequence_level_nbr=2) -- this filter combo returns
//     exactly the ~19 non-overlapping budget-function categories (National
//     Defense, Medicare, Social Security, Net Interest, ...) with no
//     Total/section-header/receipts rows mixed in.
//   MTS Table 1 row: same field family, but the FYTD top-line total lives on
//     the row where classification_desc='Year-to-Date' and data_type_cd='T'
//     -- there is no separately-named FYTD column on this table, the
//     "current_month_*_amt" columns are cumulative on that specific row.
//     Table 1 duplicates that YTD row once per fiscal-year comparison
//     section (current FY + prior FY, same record_date/record_calendar_month,
//     both data_type_cd='T'); the current-FY row is always the one with the
//     higher src_line_nbr among same-date YTD rows (prior-FY's section is
//     always printed first / lower line#) -- confirmed live: FY2025 section
//     YTD at src_line_nbr 14, FY2026 section YTD at src_line_nbr 24.
//   Debt to the Penny row: record_date, tot_pub_debt_out_amt.
//
// All amounts arrive as decimal-string dollars-and-cents (e.g.
// "335512183227.42"); we floor() to whole dollars and store as bigint.
//
// `category` is '' (NOT SQL NULL) for mts_table_1/debt_to_penny top-line
// rows -- see the NO_CATEGORY comment below for why.

import { db } from '@db/connection';
import { realitySnapshots } from '@db/schema/index';
import { sql } from 'drizzle-orm';

const API_BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1';
const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_DELAY_MS = 250;

/** Tick wiring lands in slice 4 -- this constant is not yet consumed anywhere. */
export const REALITY_PULL_EVERY_N_TICKS = 16;

type RealitySnapshotInsert = typeof realitySnapshots.$inferInsert;

interface FiscalDataResponse<T> {
  data: T[];
  meta?: { count?: number; total_pages?: number; 'total-count'?: number; 'total-pages'?: number };
}

interface Mts9Row {
  record_date: string;
  classification_desc: string;
  data_type_cd: string;
  record_type_cd: string;
  sequence_level_nbr: string;
  current_fytd_rcpt_outly_amt: string | null;
  record_fiscal_year: string;
  record_calendar_month: string;
}

interface Mts1Row {
  record_date: string;
  classification_desc: string;
  data_type_cd: string;
  current_month_gross_rcpt_amt: string | null;
  current_month_gross_outly_amt: string | null;
  current_month_dfct_sur_amt: string | null;
  record_fiscal_year: string;
  record_calendar_month: string;
  src_line_nbr: string;
}

interface DebtToPennyRow {
  record_date: string;
  tot_pub_debt_out_amt: string;
}

/** Fetch with a hard timeout and a single retry (no retry storms). */
async function fetchJson<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Decimal-string dollars-and-cents -> floored whole-dollar bigint (as JS number). */
export function dollarStringToBigintDollars(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

/** Normalize one MTS Table 9 category row into a reality_snapshots insert row. */
export function normalizeMts9Row(row: Mts9Row): RealitySnapshotInsert | null {
  if (!row.record_date || !row.classification_desc) return null;
  const outlays = dollarStringToBigintDollars(row.current_fytd_rcpt_outly_amt);
  if (outlays === null) return null;
  return {
    recordDate: row.record_date,
    fiscalYear: Number.parseInt(row.record_fiscal_year, 10) || null,
    fiscalMonth: Number.parseInt(row.record_calendar_month, 10) || null,
    category: row.classification_desc.slice(0, 120),
    outlaysFytd: outlays,
    receiptsFytd: null,
    deficitFytd: null,
    debtOutstanding: null,
    source: 'mts_table_9',
  };
}

/**
 * Sentinel for "no category" on top-line rows (mts_table_1, debt_to_penny).
 * Deliberately NOT the SQL NULL: Postgres treats every NULL as distinct
 * under a UNIQUE constraint, so two top-line rows for the same (recordDate,
 * source) would never conflict and re-pulling the same date would insert a
 * duplicate row instead of upserting. An empty string is a normal, non-null
 * value the (recordDate, category, source) constraint can dedupe on.
 */
const NO_CATEGORY = '';

/** Normalize the MTS Table 1 top-line "Year-to-Date" row. */
export function normalizeMts1Row(row: Mts1Row): RealitySnapshotInsert | null {
  if (!row.record_date) return null;
  const receipts = dollarStringToBigintDollars(row.current_month_gross_rcpt_amt);
  const outlays = dollarStringToBigintDollars(row.current_month_gross_outly_amt);
  const deficit = dollarStringToBigintDollars(row.current_month_dfct_sur_amt);
  if (receipts === null && outlays === null && deficit === null) return null;
  return {
    recordDate: row.record_date,
    fiscalYear: Number.parseInt(row.record_fiscal_year, 10) || null,
    fiscalMonth: Number.parseInt(row.record_calendar_month, 10) || null,
    category: NO_CATEGORY,
    outlaysFytd: outlays,
    receiptsFytd: receipts,
    deficitFytd: deficit,
    debtOutstanding: null,
    source: 'mts_table_1',
  };
}

/** Normalize the latest Debt to the Penny row. */
export function normalizeDebtToPennyRow(row: DebtToPennyRow): RealitySnapshotInsert | null {
  if (!row.record_date) return null;
  const debt = dollarStringToBigintDollars(row.tot_pub_debt_out_amt);
  if (debt === null) return null;
  return {
    recordDate: row.record_date,
    fiscalYear: null,
    fiscalMonth: null,
    category: NO_CATEGORY,
    outlaysFytd: null,
    receiptsFytd: null,
    deficitFytd: null,
    debtOutstanding: debt,
    source: 'debt_to_penny',
  };
}

async function upsertSnapshots(rows: RealitySnapshotInsert[]): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (const row of rows) {
    const result = await db
      .insert(realitySnapshots)
      .values(row)
      .onConflictDoUpdate({
        target: [realitySnapshots.recordDate, realitySnapshots.category, realitySnapshots.source],
        set: { fetchedAt: sql`now()` },
      })
      .returning({ id: realitySnapshots.id });
    if (result.length > 0) inserted++;
  }
  return inserted;
}

/** Pull the latest month's MTS Table 9 category breakdown. */
async function pullMts9Latest(): Promise<number> {
  const url =
    `${API_BASE}/accounting/mts/mts_table_9` +
    `?filter=data_type_cd:eq:D,record_type_cd:eq:F` +
    `&sort=-record_date&page[size]=25`;
  const body = await fetchJson<FiscalDataResponse<Mts9Row>>(url);
  const rows = (body.data ?? [])
    .map(normalizeMts9Row)
    .filter((r): r is RealitySnapshotInsert => r !== null);
  return upsertSnapshots(rows);
}

/**
 * Pick the current-FY "Year-to-Date" row among same-record_date candidates.
 *
 * Table 1 emits one YTD row per fiscal-year comparison section: a STATIC
 * prior-completed-FY total (confirmed live across Oct 2025 through May
 * 2026 pulls: always src_line_nbr==14, value frozen at the FY2025 final
 * $7,009,985,661,849.26 outlays regardless of which calendar month is
 * queried) and a GROWING current-FY-in-progress total (src_line_nbr varies
 * by month -- 17 in Oct, 18 in Nov, 21 in Feb, 23 in Apr, 24 in May --
 * always a different line than 14, so "highest src_line_nbr wins" holds in
 * every sampled month, but excluding the known-static line 14 explicitly is
 * the more robust invariant and doesn't depend on 14 always sorting lowest).
 * No-op (returns the single row) when only one candidate.
 */
const MTS_TABLE_1_PRIOR_FY_STATIC_LINE = '14';

export function pickCurrentFyYtdRow(rows: Mts1Row[]): Mts1Row | null {
  if (rows.length === 0) return null;
  const latestDate = rows.reduce((max, r) => (r.record_date > max ? r.record_date : max), rows[0].record_date);
  const candidates = rows.filter((r) => r.record_date === latestDate);
  const nonStatic = candidates.filter((r) => r.src_line_nbr !== MTS_TABLE_1_PRIOR_FY_STATIC_LINE);
  const pool = nonStatic.length > 0 ? nonStatic : candidates;
  return pool.reduce((best, r) =>
    Number.parseInt(r.src_line_nbr, 10) > Number.parseInt(best.src_line_nbr, 10) ? r : best
  );
}

/** Pull the latest month's MTS Table 1 top-line row (current-FY section only). */
async function pullMts1Latest(): Promise<number> {
  const url =
    `${API_BASE}/accounting/mts/mts_table_1` +
    `?filter=classification_desc:eq:Year-to-Date,data_type_cd:eq:T` +
    `&sort=-record_date&page[size]=5`;
  const body = await fetchJson<FiscalDataResponse<Mts1Row>>(url);
  const current = pickCurrentFyYtdRow(body.data ?? []);
  const normalized = current ? normalizeMts1Row(current) : null;
  return upsertSnapshots(normalized ? [normalized] : []);
}

/** Pull the latest Debt to the Penny total. */
async function pullDebtToPennyLatest(): Promise<number> {
  const url = `${API_BASE}/accounting/od/debt_to_penny?sort=-record_date&page[size]=1`;
  const body = await fetchJson<FiscalDataResponse<DebtToPennyRow>>(url);
  const rows = (body.data ?? [])
    .map(normalizeDebtToPennyRow)
    .filter((r): r is RealitySnapshotInsert => r !== null);
  return upsertSnapshots(rows);
}

/**
 * Pull all three sources and upsert into reality_snapshots. Each source is
 * independently try/caught -- one failing source never blocks the others,
 * and this function NEVER throws to the caller (wrap + log only, per the
 * divergence spec's reality-puller failure-isolation rule).
 */
export async function pullRealitySnapshots(): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;

  try {
    inserted += await pullMts9Latest();
  } catch (err) {
    const msg = `mts_table_9: ${err instanceof Error ? err.message : String(err)}`;
    console.warn('[realityFeed]', msg);
    errors.push(msg);
  }

  try {
    inserted += await pullMts1Latest();
  } catch (err) {
    const msg = `mts_table_1: ${err instanceof Error ? err.message : String(err)}`;
    console.warn('[realityFeed]', msg);
    errors.push(msg);
  }

  try {
    inserted += await pullDebtToPennyLatest();
  } catch (err) {
    const msg = `debt_to_penny: ${err instanceof Error ? err.message : String(err)}`;
    console.warn('[realityFeed]', msg);
    errors.push(msg);
  }

  return { inserted, errors };
}

/**
 * One-time paginated backfill of MTS Table 9 + Table 1 monthly history from
 * FY2025-10 (record_fiscal_year 2025, the start of the fiscal year the
 * research + spec anchor on) through present. Guarded to run only when the
 * table has no MTS rows yet, so re-running the app never re-walks history.
 * Client-side politeness: sequential requests, small delay between pages,
 * single retry per request (via fetchJson), no parallel fan-out.
 */
export async function backfillHistory(): Promise<number> {
  const [existing] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(realitySnapshots)
    .where(sql`${realitySnapshots.source} IN ('mts_table_9', 'mts_table_1')`);

  if (Number(existing?.count ?? 0) > 0) {
    console.warn('[realityFeed] backfillHistory: MTS rows already present, skipping');
    return 0;
  }

  let totalInserted = 0;

  // MTS Table 9 -- category rows, FY2025 onward.
  try {
    const url =
      `${API_BASE}/accounting/mts/mts_table_9` +
      `?filter=data_type_cd:eq:D,record_type_cd:eq:F,record_fiscal_year:gte:2025` +
      `&sort=record_date&page[size]=100`;
    totalInserted += await backfillPaginated<Mts9Row>(url, normalizeMts9Row);
  } catch (err) {
    console.warn('[realityFeed] backfillHistory mts_table_9 failed:', err instanceof Error ? err.message : err);
  }

  // MTS Table 1 -- top-line row, FY2025 onward. Each record_date carries a
  // current-FY and prior-FY "Year-to-Date" row (see pickCurrentFyYtdRow) --
  // fetch all, group by record_date, keep only the current-FY row per date,
  // rather than upserting both and letting the second silently clobber the
  // first under the same unique key.
  try {
    const url =
      `${API_BASE}/accounting/mts/mts_table_1` +
      `?filter=classification_desc:eq:Year-to-Date,data_type_cd:eq:T,record_fiscal_year:gte:2025` +
      `&sort=record_date&page[size]=100`;
    totalInserted += await backfillMts1Paginated(url);
  } catch (err) {
    console.warn('[realityFeed] backfillHistory mts_table_1 failed:', err instanceof Error ? err.message : err);
  }

  return totalInserted;
}

/**
 * Same paginated sweep as backfillPaginated, but groups MTS Table 1 rows by
 * record_date and keeps only the current-FY "Year-to-Date" row per date
 * (see pickCurrentFyYtdRow) before upserting -- avoids writing the prior-FY
 * comparison row under the same (recordDate, null, 'mts_table_1') key.
 */
async function backfillMts1Paginated(baseUrl: string): Promise<number> {
  const byDate = new Map<string, Mts1Row[]>();
  let page = 1;
  const MAX_PAGES = 50;

  while (page <= MAX_PAGES) {
    const url = `${baseUrl}&page[number]=${page}`;
    const body = await fetchJson<FiscalDataResponse<Mts1Row>>(url);
    const rows = body.data ?? [];
    for (const row of rows) {
      const bucket = byDate.get(row.record_date) ?? [];
      bucket.push(row);
      byDate.set(row.record_date, bucket);
    }

    const totalPages = body.meta?.['total-pages'] ?? body.meta?.total_pages ?? 1;
    if (page >= totalPages || rows.length === 0) break;

    page++;
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }

  let inserted = 0;
  for (const candidates of byDate.values()) {
    const current = pickCurrentFyYtdRow(candidates);
    const normalized = current ? normalizeMts1Row(current) : null;
    if (normalized) inserted += await upsertSnapshots([normalized]);
  }
  return inserted;
}

async function backfillPaginated<T>(
  baseUrl: string,
  normalize: (row: T) => RealitySnapshotInsert | null
): Promise<number> {
  let inserted = 0;
  let page = 1;

  // Bounded loop -- Treasury data doesn't paginate indefinitely; cap as a
  // defensive guard against an unexpected total-pages value.
  const MAX_PAGES = 50;

  while (page <= MAX_PAGES) {
    const url = `${baseUrl}&page[number]=${page}`;
    const body = await fetchJson<FiscalDataResponse<T>>(url);
    const rows = (body.data ?? []).map(normalize).filter((r): r is RealitySnapshotInsert => r !== null);
    inserted += await upsertSnapshots(rows);

    const totalPages = body.meta?.['total-pages'] ?? body.meta?.total_pages ?? 1;
    if (page >= totalPages || rows.length === 0) break;

    page++;
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }

  return inserted;
}
