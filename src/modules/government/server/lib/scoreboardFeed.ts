// src/modules/government/server/lib/scoreboardFeed.ts
//
// E4 Scoreboard slice 2 -- reality-side metric_snapshots writers
// (docs/specs/observability-and-metrics.md). Same architecture as
// realityFeed.ts: typed raw row -> pure exported normalize* -> private
// pull* with a 15s timeout + one retry -> idempotent upsert; every source
// try/caught in isolation, and pullScoreboardReality() NEVER throws.
//
// Four writers, individually gated by the caller-passed flags:
//   - Tier A bridge -- derives reality metric rows for the four fiscal
//     metrics from the freshest reality_snapshots (already pulled by
//     realityFeed.ts in the same 16-tick block), via divergenceMath.
//   - FRED adapter (UNRATE / CPIAUCSL / GDP) -- Tier C reality series.
//     Response shape per the FRED docs (the docs host blocks non-browser
//     fetches; shape cross-confirmed against pyfredapi + fredr client docs
//     2026-08-19): observations[] of {date, value}, value a decimal STRING,
//     '.' = missing. Needs FRED_API_KEY (warn-and-degrade, congressContext
//     pattern).
//   - Congress.gov stats adapter -- live-confirmed 2026-08-19: /v3/law/119
//     returns all enacted laws in one page (pagination.count=104, limit
//     250), list items carry latestAction.actionDate (the became-law date)
//     but NOT introducedDate -- that needs one bill-detail fetch per law,
//     so the median is over the N most recent laws only. Needs
//     CONGRESS_API_KEY.
//   - Approval scrape -- Ballotpedia's Polling Index page (real MediaWiki
//     table, live-captured 2026-08-19; the spec's first-choice YouGov
//     tracker slug 404s). Tolerant regex parser, staleness warn, never a
//     hard failure.
//
// SECRETS: FRED/Congress URLs carry api_key as a query param, so this file
// does NOT reuse realityFeed's fetchJson -- error messages there embed the
// full URL. The local fetch helpers scrub api_key from anything thrown.

import { db } from '@db/connection';
import { metricSnapshots, realitySnapshots } from '@db/schema/index';
import { and, desc, eq } from 'drizzle-orm';
import {
  fytdToDailyAverage,
  debtToGdpPct,
  annualizedShareOfGdpPct,
} from './divergenceMath.js';
import { METRIC_KEYS, median, backloadNormalizedSessionTotal } from '@core/server/lib/scoreboardMath.js';

const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_DELAY_MS = 250;

/* The 119th Congress: Jan 3 2025 -> Jan 3 2027. One "session-equivalent"
   on the scoreboard = one 2-year Congress (SIM_SESSION_TICKS = 730). */
export const CONGRESS_119_START = '2025-01-03';
export const CONGRESS_119_END = '2027-01-03';

/* Bill-detail fetches are per-law; cap them so a pull is ~a dozen polite
   sequential requests, not one per enacted law. */
const CONGRESS_DETAIL_FETCH_CAP = 12;

const FRED_API_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const CONGRESS_API_BASE = 'https://api.congress.gov/v3';
const BALLOTPEDIA_URL =
  "https://ballotpedia.org/Ballotpedia%27s_Polling_Index:_Congressional_approval_rating";

type MetricSnapshotInsert = typeof metricSnapshots.$inferInsert;

export interface ScoreboardAdapterFlags {
  fredAdapterEnabled: boolean;
  congressStatsAdapterEnabled: boolean;
  approvalScrapeEnabled: boolean;
  gdpAnnual: number;
}

/* ── fetch helpers (api_key never leaks into thrown messages) ─────────── */

function scrubKey(text: string): string {
  return text.replace(/api_key=[^&\s"']+/gi, 'api_key=REDACTED');
}

async function fetchWithRetry(url: string, accept: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { accept } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${scrubKey(url)}`);
      return res;
    } catch (err) {
      lastErr = err instanceof Error ? new Error(scrubKey(err.message)) : err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(scrubKey(String(lastErr)));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetchWithRetry(url, 'application/json');
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetchWithRetry(url, 'text/html');
  return res.text();
}

/* ── upsert ───────────────────────────────────────────────────────────── */

/* Reality rows: at_tick NULL. The metric_snapshots unique key is NULLS NOT
   DISTINCT (migration 0033), so re-pulls of the same (metric, date) update
   in place instead of duplicating. */
async function upsertRealityRows(rows: MetricSnapshotInsert[]): Promise<number> {
  let written = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.value)) continue;
    await db
      .insert(metricSnapshots)
      .values(row)
      .onConflictDoUpdate({
        target: [metricSnapshots.metricKey, metricSnapshots.side, metricSnapshots.atDate, metricSnapshots.atTick],
        set: { value: row.value },
      });
    written++;
  }
  return written;
}

function realityRow(metricKey: string, value: number, atDate: string): MetricSnapshotInsert {
  return { metricKey, side: 'reality', value, atDate, atTick: null };
}

/* ── Tier A bridge: reality_snapshots -> metric_snapshots ─────────────── */

export interface TierABridgeInputs {
  topLine: { recordDate: string; outlaysFytd: number | null; receiptsFytd: number | null; deficitFytd: number | null } | null;
  debt: { recordDate: string; debtOutstanding: number | null } | null;
  gdpAnnual: number;
}

/** Pure derivation of the four Tier A reality metric rows. */
export function bridgeTierARows(inputs: TierABridgeInputs): MetricSnapshotInsert[] {
  const rows: MetricSnapshotInsert[] = [];
  const { topLine, debt, gdpAnnual } = inputs;

  if (topLine) {
    const asOf = topLine.recordDate;
    if (topLine.deficitFytd !== null) {
      rows.push(realityRow(METRIC_KEYS.deficitPerDay, Math.round(fytdToDailyAverage(topLine.deficitFytd, asOf)), asOf));
    }
    if (topLine.outlaysFytd !== null) {
      rows.push(realityRow(METRIC_KEYS.spendingPctGdp, annualizedShareOfGdpPct(fytdToDailyAverage(topLine.outlaysFytd, asOf), gdpAnnual), asOf));
    }
    if (topLine.receiptsFytd !== null) {
      rows.push(realityRow(METRIC_KEYS.taxBurdenPctGdp, annualizedShareOfGdpPct(fytdToDailyAverage(topLine.receiptsFytd, asOf), gdpAnnual), asOf));
    }
  }
  if (debt && debt.debtOutstanding !== null) {
    rows.push(realityRow(METRIC_KEYS.debtToGdp, debtToGdpPct(debt.debtOutstanding, gdpAnnual), debt.recordDate));
  }
  return rows;
}

async function bridgeTierA(gdpAnnual: number): Promise<number> {
  const [topLine] = await db
    .select({
      recordDate: realitySnapshots.recordDate,
      outlaysFytd: realitySnapshots.outlaysFytd,
      receiptsFytd: realitySnapshots.receiptsFytd,
      deficitFytd: realitySnapshots.deficitFytd,
    })
    .from(realitySnapshots)
    .where(and(eq(realitySnapshots.source, 'mts_table_1'), eq(realitySnapshots.category, '')))
    .orderBy(desc(realitySnapshots.recordDate))
    .limit(1);

  const [debt] = await db
    .select({ recordDate: realitySnapshots.recordDate, debtOutstanding: realitySnapshots.debtOutstanding })
    .from(realitySnapshots)
    .where(eq(realitySnapshots.source, 'debt_to_penny'))
    .orderBy(desc(realitySnapshots.recordDate))
    .limit(1);

  return upsertRealityRows(bridgeTierARows({ topLine: topLine ?? null, debt: debt ?? null, gdpAnnual }));
}

/* ── FRED adapter (Tier C) ────────────────────────────────────────────── */

export interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations?: FredObservation[];
}

/** '.'-aware FRED value parse: null for missing/non-numeric. */
export function parseFredValue(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '' || value.trim() === '.') return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** UNRATE: each valid monthly observation is one reality row, as-is. */
export function normalizeUnrateObservations(obs: FredObservation[]): MetricSnapshotInsert[] {
  const rows: MetricSnapshotInsert[] = [];
  for (const o of obs) {
    const v = parseFredValue(o.value);
    if (v === null || !o.date) continue;
    rows.push(realityRow(METRIC_KEYS.unemploymentRate, v, o.date));
  }
  return rows;
}

/**
 * CPIAUCSL is a price INDEX -- the scoreboard metric is the inflation rate,
 * i.e. the 12-month % change. Observations arrive sorted desc; each month
 * pairs with the observation exactly 12 months earlier (matched by date
 * arithmetic, not array position, so a missing '.' month drops only itself).
 */
export function normalizeCpiYoY(obs: FredObservation[]): MetricSnapshotInsert[] {
  const byDate = new Map<string, number>();
  for (const o of obs) {
    const v = parseFredValue(o.value);
    if (v !== null && o.date) byDate.set(o.date, v);
  }
  const rows: MetricSnapshotInsert[] = [];
  for (const [date, v] of byDate) {
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    const prior = byDate.get(d.toISOString().slice(0, 10));
    if (prior === undefined || prior <= 0) continue;
    const yoy = Math.round((v / prior - 1) * 100 * 100) / 100;
    rows.push(realityRow(METRIC_KEYS.inflationRate, yoy, date));
  }
  return rows;
}

/**
 * GDP (nominal level, quarterly, billions) -> headline-style annualized
 * quarter-over-quarter growth: ((q1/q0)^4 - 1) * 100. Consecutive-quarter
 * pairs matched by date arithmetic (3 months apart).
 */
export function normalizeGdpGrowth(obs: FredObservation[]): MetricSnapshotInsert[] {
  const byDate = new Map<string, number>();
  for (const o of obs) {
    const v = parseFredValue(o.value);
    if (v !== null && o.date) byDate.set(o.date, v);
  }
  const rows: MetricSnapshotInsert[] = [];
  for (const [date, v] of byDate) {
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    d.setUTCMonth(d.getUTCMonth() - 3);
    const prior = byDate.get(d.toISOString().slice(0, 10));
    if (prior === undefined || prior <= 0 || v <= 0) continue;
    const annualized = Math.round((Math.pow(v / prior, 4) - 1) * 100 * 100) / 100;
    rows.push(realityRow(METRIC_KEYS.gdpGrowth, annualized, date));
  }
  return rows;
}

async function pullFred(): Promise<number> {
  const apiKey = process.env['FRED_API_KEY'];
  if (!apiKey) {
    console.warn('[scoreboardFeed] FRED_API_KEY not set — skipping FRED adapter');
    return 0;
  }

  const series = [
    { id: 'UNRATE', limit: 24, normalize: normalizeUnrateObservations },
    { id: 'CPIAUCSL', limit: 37, normalize: normalizeCpiYoY },
    { id: 'GDP', limit: 13, normalize: normalizeGdpGrowth },
  ] as const;

  let written = 0;
  for (const s of series) {
    const url =
      `${FRED_API_BASE}?series_id=${s.id}&file_type=json&sort_order=desc` +
      `&limit=${s.limit}&api_key=${apiKey}`;
    const body = await fetchJson<FredResponse>(url);
    written += await upsertRealityRows(s.normalize(body.observations ?? []));
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }
  return written;
}

/* ── Congress.gov stats adapter (Tier B reality) ──────────────────────── */

export interface CongressLawListItem {
  latestAction?: { actionDate?: string; text?: string };
  number?: string;
  type?: string;
}

interface CongressLawListResponse {
  bills?: CongressLawListItem[];
  pagination?: { count?: number };
}

interface CongressBillDetailResponse {
  bill?: { introducedDate?: string; latestAction?: { actionDate?: string } };
}

/** Fraction of the 119th Congress elapsed as of `asOfDate` (clamped 0..1). */
export function congressElapsedFraction(asOfDate: string): number {
  const start = new Date(`${CONGRESS_119_START}T00:00:00Z`).getTime();
  const end = new Date(`${CONGRESS_119_END}T00:00:00Z`).getTime();
  const asOf = new Date(`${asOfDate}T00:00:00Z`).getTime();
  if (Number.isNaN(asOf)) return 0;
  return Math.max(0, Math.min(1, (asOf - start) / (end - start)));
}

/**
 * Reality throughput: projected full-session enactment total from the
 * count-so-far, divided by the EXPECTED share at this point of the session
 * (real enactment is back-loaded -- see backloadNormalizedSessionTotal).
 * Same unit as the sim side: laws per session (projected).
 */
export function congressThroughputValue(enactedCount: number, asOfDate: string): number | null {
  return backloadNormalizedSessionTotal(enactedCount, congressElapsedFraction(asOfDate));
}

/** Median introduction -> became-law days over the fetched law sample. */
export function congressMedianPassageDays(
  pairs: { introducedDate: string; becameLawDate: string }[],
): number | null {
  const durations: number[] = [];
  for (const p of pairs) {
    const intro = new Date(`${p.introducedDate}T00:00:00Z`).getTime();
    const enacted = new Date(`${p.becameLawDate}T00:00:00Z`).getTime();
    if (Number.isNaN(intro) || Number.isNaN(enacted) || enacted < intro) continue;
    durations.push((enacted - intro) / 86_400_000);
  }
  const m = median(durations);
  return m === null ? null : Math.round(m * 10) / 10;
}

async function pullCongressStats(): Promise<number> {
  const apiKey = process.env['CONGRESS_API_KEY'];
  if (!apiKey) {
    console.warn('[scoreboardFeed] CONGRESS_API_KEY not set — skipping Congress stats adapter');
    return 0;
  }

  const today = new Date().toISOString().slice(0, 10);
  const listUrl = `${CONGRESS_API_BASE}/law/119?format=json&limit=250&api_key=${apiKey}`;
  const list = await fetchJson<CongressLawListResponse>(listUrl);
  const items = list.bills ?? [];
  const enactedCount = list.pagination?.count ?? items.length;

  const rows: MetricSnapshotInsert[] = [];
  const throughput = congressThroughputValue(enactedCount, today);
  if (throughput !== null) rows.push(realityRow(METRIC_KEYS.legislativeThroughput, throughput, today));

  /* Median time-to-passage over the most recently enacted laws only --
     introducedDate lives on the bill DETAIL (confirmed live), so this is
     one polite sequential fetch per sampled law, capped. */
  const recent = items
    .filter((b) => b.latestAction?.actionDate && b.number && b.type)
    .sort((a, b) => (b.latestAction!.actionDate! < a.latestAction!.actionDate! ? -1 : 1))
    .slice(0, CONGRESS_DETAIL_FETCH_CAP);

  const pairs: { introducedDate: string; becameLawDate: string }[] = [];
  for (const law of recent) {
    try {
      const detailUrl =
        `${CONGRESS_API_BASE}/bill/119/${law.type!.toLowerCase()}/${law.number}` +
        `?format=json&api_key=${apiKey}`;
      const detail = await fetchJson<CongressBillDetailResponse>(detailUrl);
      const introducedDate = detail.bill?.introducedDate;
      if (introducedDate) {
        pairs.push({ introducedDate, becameLawDate: law.latestAction!.actionDate! });
      }
    } catch (err) {
      console.warn('[scoreboardFeed] congress bill detail failed:', err instanceof Error ? err.message : String(err));
    }
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }

  const medianDays = congressMedianPassageDays(pairs);
  if (medianDays !== null) rows.push(realityRow(METRIC_KEYS.timeToPassage, medianDays, today));

  return upsertRealityRows(rows);
}

/* ── Approval scrape (Ballotpedia Polling Index) ──────────────────────── */

export interface ApprovalParse {
  approvePct: number;
  disapprovePct: number | null;
  /* End date of the newest congressional poll on the page, when its
     "M/D-M/D" range (no year printed) could be anchored -- staleness only. */
  latestPollEndDate: string | null;
}

/**
 * Ballotpedia date ranges print no year ("7/25-7/27"). Anchor the END date
 * to the fetch year, rolling back one year if that lands more than a few
 * days in the future (a December poll read in January). Null when the range
 * doesn't look like M/D-M/D.
 */
export function inferPollEndDate(rangeText: string, fetchDate: string): string | null {
  const m = /(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})/.exec(rangeText);
  if (!m) return null;
  const [, , , endMonth, endDay] = m;
  const fetch = new Date(`${fetchDate}T00:00:00Z`);
  if (Number.isNaN(fetch.getTime())) return null;
  const candidate = new Date(Date.UTC(fetch.getUTCFullYear(), Number(endMonth) - 1, Number(endDay)));
  if (candidate.getTime() - fetch.getTime() > 3 * 86_400_000) {
    candidate.setUTCFullYear(candidate.getUTCFullYear() - 1);
  }
  return candidate.toISOString().slice(0, 10);
}

/**
 * Tolerant parse of the Polling Index page (live-captured structure,
 * 2026-08-19): a labeled "Congressional approval (average):" row holds the
 * 30-day approve/disapprove pair; individual polls are rows whose first
 * cell is "Cong. Approval" with a Date Range cell. Prefers the labeled
 * average; falls back to the newest individual poll row; null when neither
 * is recognizable (caller warns -- never throws).
 */
export function parseBallotpediaCongressionalApproval(html: string, fetchDate: string): ApprovalParse | null {
  const pct = '(\\d{1,3})\\s*%';
  const cellGap = '[\\s\\S]{0,200}?';

  let approvePct: number | null = null;
  let disapprovePct: number | null = null;
  const avg = new RegExp(`Congressional approval \\(average\\):${cellGap}${pct}${cellGap}${pct}`).exec(html);
  if (avg) {
    approvePct = Number(avg[1]);
    disapprovePct = Number(avg[2]);
  }

  const pollRow = new RegExp(`<td>Cong\\. Approval</td>${cellGap}<td>([^<]{3,40})</td>${cellGap}${pct}${cellGap}${pct}`).exec(html);
  let latestPollEndDate: string | null = null;
  if (pollRow) {
    latestPollEndDate = inferPollEndDate(pollRow[1], fetchDate);
    if (approvePct === null) {
      approvePct = Number(pollRow[2]);
      disapprovePct = Number(pollRow[3]);
    }
  }

  if (approvePct === null || approvePct < 0 || approvePct > 100) return null;
  return { approvePct, disapprovePct, latestPollEndDate };
}

const APPROVAL_STALE_AFTER_DAYS = 45;

async function pullApprovalScrape(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const html = await fetchText(BALLOTPEDIA_URL);
  const parsed = parseBallotpediaCongressionalApproval(html, today);
  if (!parsed) {
    console.warn('[scoreboardFeed] approval scrape: page structure not recognized — no row written (parser may need reshaping)');
    return 0;
  }

  if (parsed.latestPollEndDate) {
    const ageDays = (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${parsed.latestPollEndDate}T00:00:00Z`).getTime()) / 86_400_000;
    if (ageDays > APPROVAL_STALE_AFTER_DAYS) {
      console.warn(`[scoreboardFeed] approval scrape STALE: newest congressional poll ended ${parsed.latestPollEndDate} (${Math.round(ageDays)}d ago)`);
    }
  } else {
    console.warn('[scoreboardFeed] approval scrape: no poll date recognized — staleness unknown');
  }

  /* A rolling 30-day average is a property of the fetch day, so the series
     is keyed on the fetch date (re-pulls same day update in place). */
  return upsertRealityRows([realityRow(METRIC_KEYS.approvalTrend, parsed.approvePct, today)]);
}

/* ── top level ────────────────────────────────────────────────────────── */

/**
 * Run the Tier A bridge + every enabled adapter. Each is independently
 * try/caught; this function never throws (realityFeed failure-isolation
 * rule). Caller gates the whole thing on rc.scoreboardEnabled.
 */
export async function pullScoreboardReality(flags: ScoreboardAdapterFlags): Promise<{ written: number; errors: string[] }> {
  const errors: string[] = [];
  let written = 0;

  try {
    written += await bridgeTierA(flags.gdpAnnual);
  } catch (err) {
    const msg = `tier_a_bridge: ${err instanceof Error ? err.message : String(err)}`;
    console.warn('[scoreboardFeed]', msg);
    errors.push(msg);
  }

  if (flags.fredAdapterEnabled) {
    try {
      written += await pullFred();
    } catch (err) {
      const msg = `fred: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('[scoreboardFeed]', msg);
      errors.push(msg);
    }
  }

  if (flags.congressStatsAdapterEnabled) {
    try {
      written += await pullCongressStats();
    } catch (err) {
      const msg = `congress_stats: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('[scoreboardFeed]', msg);
      errors.push(msg);
    }
  }

  if (flags.approvalScrapeEnabled) {
    try {
      written += await pullApprovalScrape();
    } catch (err) {
      const msg = `approval_scrape: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('[scoreboardFeed]', msg);
      errors.push(msg);
    }
  }

  return { written, errors };
}
