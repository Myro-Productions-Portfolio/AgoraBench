/**
 * Fiscal payload parsing from Phase 11 bill-proposal output — Rule 4 applies
 * in full: LLM output is UNTRUSTED. This module is the ONLY point where
 * model output can create fiscal state. Discipline copied from
 * dealParsing.ts (the Phase-2-proven template in this exact call path):
 * isPlainObject guard, Object.prototype.hasOwnProperty checks, strict
 * typeof on every value (no String()/Number() coercion — arrays and objects
 * must never stringify their way through), whitelist of exactly
 * kind/amount/taxDelta/programName/sunsetTicks, and null (= all-NULL fiscal
 * columns on the bill, a total no-op) on ANY deviation. Never throws.
 *
 * Clamp scheme (all integer M$, proportional to the real economy — treasury
 * is ~M$8.4k live, so bounds are % of treasury / % of expected revenue,
 * never absolute magic numbers):
 *   spend_once      amount ∈ [1, floor(T × fiscalMaxOneTimePctOfTreasury/100)];
 *                   dropped when T <= 0 or amount < 1 after floor.
 *   spend_recurring amount ∈ [1, floor(R × fiscalMaxProgramPctOfRevenue/100)];
 *                   dropped when R <= 0 or amount < 1 after floor; ALSO
 *                   dropped when S + amount would exceed
 *                   floor(R × fiscalRecurringCapPctOfRevenue/100) — the
 *                   aggregate cap: total recurring drain can never exceed
 *                   that share of expected revenue at approval time.
 *   tax_change      taxDelta ∈ ±fiscalMaxTaxDeltaPerLaw whole points
 *                   (taxRatePercent is an integer column); 0 is a no-op → null.
 *   sunsetTicks     optional on any kind; > 0 → clamp [8, maxSunsetTicks];
 *                   absent/invalid/<= 0 → null (no sunset — the legacy default).
 *
 * Zero/negative/NaN/Infinity amounts are REJECTED (null), never rounded up
 * to 1: a clamp must bound a requested spend, not invent one.
 */

import { clampInt, type FiscalKind } from './fiscalMath.js';

export interface FiscalClampConfig {
  fiscalMaxOneTimePctOfTreasury: number;
  fiscalMaxProgramPctOfRevenue: number;
  fiscalRecurringCapPctOfRevenue: number;
  fiscalMaxTaxDeltaPerLaw: number;
  maxSunsetTicks: number;
}

export interface FiscalClampContext {
  /** Current treasuryBalance (integer M$; may be negative). */
  treasury: number;
  /** floor(taxRatePercent/100 × Σ active-agent balances) — see expectedTickRevenue(). */
  expectedTickRevenue: number;
  /** Σ fiscal_amount over laws WHERE is_active AND program_active — PLUS any
      recurring amounts already approved earlier in the same tick's loop. */
  activeRecurringSpend: number;
  rc: FiscalClampConfig;
  /** Server-side fallback for a missing/empty programName (the bill title). */
  fallbackProgramName?: string;
}

export interface ParsedFiscalProvision {
  kind: FiscalKind;
  /** Per-tick M$ for spend_recurring, total M$ for spend_once; null for tax_change. */
  amount: number | null;
  /** Signed whole percentage points; null except for tax_change. */
  taxDelta: number | null;
  /** Sanitized program name; null except for spend_recurring. */
  programName: string | null;
  /** Ticks until auto-deactivation; null = never sunsets (the legacy default). */
  sunsetTicks: number | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict finite-number read of an own property. Returns null on any deviation. */
function readFiniteNumber(obj: Record<string, unknown>, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const v = obj[key];
  /* Strict: must already be a number — Number() coercion would let "5",
     [5], or booleans through. NaN/±Infinity are rejected by isFinite. */
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

const PROGRAM_NAME_MAX_CHARS = 120;

/** Trim, strip control chars, cap at the column width. Empty → null. */
function sanitizeProgramName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PROGRAM_NAME_MAX_CHARS);
  return cleaned.length > 0 ? cleaned : null;
}

function ctxIsSane(ctx: FiscalClampContext): boolean {
  const { rc } = ctx;
  return (
    Number.isFinite(ctx.treasury) &&
    Number.isFinite(ctx.expectedTickRevenue) &&
    Number.isFinite(ctx.activeRecurringSpend) &&
    ctx.activeRecurringSpend >= 0 &&
    Number.isFinite(rc.fiscalMaxOneTimePctOfTreasury) && rc.fiscalMaxOneTimePctOfTreasury > 0 &&
    Number.isFinite(rc.fiscalMaxProgramPctOfRevenue) && rc.fiscalMaxProgramPctOfRevenue > 0 &&
    Number.isFinite(rc.fiscalRecurringCapPctOfRevenue) && rc.fiscalRecurringCapPctOfRevenue > 0 &&
    Number.isFinite(rc.fiscalMaxTaxDeltaPerLaw) && rc.fiscalMaxTaxDeltaPerLaw > 0 &&
    Number.isFinite(rc.maxSunsetTicks) && rc.maxSunsetTicks > 0
  );
}

/** Optional sunset shared by every kind: absent/invalid/<= 0 → null (no sunset). */
function readSunsetTicks(fiscal: Record<string, unknown>, maxSunsetTicks: number): number | null {
  const raw = readFiniteNumber(fiscal, 'sunsetTicks');
  if (raw === null || raw <= 0) return null;
  return clampInt(raw, 8, Math.floor(maxSunsetTicks));
}

/**
 * Extract and validate an optional fiscal provision from an LLM decision's
 * `data` payload. Returns non-null ONLY when `data.fiscal` is a plain object
 * whose whitelisted fields survive strict typing AND the full clamp scheme.
 * `kind: "none"` (the prompt's explicit opt-out) and every malformed shape
 * return null. Never throws.
 */
export function parseFiscalField(data: unknown, ctx: FiscalClampContext): ParsedFiscalProvision | null {
  if (!ctxIsSane(ctx)) return null;
  if (!isPlainObject(data)) return null;
  if (!Object.prototype.hasOwnProperty.call(data, 'fiscal')) return null;

  const fiscal = data['fiscal'];
  if (!isPlainObject(fiscal)) return null;
  if (!Object.prototype.hasOwnProperty.call(fiscal, 'kind')) return null;

  const rawKind = fiscal['kind'];
  if (typeof rawKind !== 'string') return null;
  const kind = rawKind.toLowerCase().trim();

  if (kind === 'spend_once') {
    const rawAmount = readFiniteNumber(fiscal, 'amount');
    if (rawAmount === null) return null;
    const amount = Math.floor(rawAmount);
    if (amount < 1) return null;
    /* One-time spends are bounded by the treasury itself: drop when broke. */
    if (ctx.treasury <= 0) return null;
    const maxOnce = Math.max(1, Math.floor((ctx.treasury * ctx.rc.fiscalMaxOneTimePctOfTreasury) / 100));
    return {
      kind: 'spend_once',
      amount: clampInt(amount, 1, maxOnce),
      taxDelta: null,
      programName: null,
      sunsetTicks: readSunsetTicks(fiscal, ctx.rc.maxSunsetTicks),
    };
  }

  if (kind === 'spend_recurring') {
    const rawAmount = readFiniteNumber(fiscal, 'amount');
    if (rawAmount === null) return null;
    const requested = Math.floor(rawAmount);
    if (requested < 1) return null;
    /* Recurring spends are bounded by expected revenue: no revenue, no programs. */
    const revenue = ctx.expectedTickRevenue;
    if (revenue <= 0) return null;
    const maxPerTick = Math.max(1, Math.floor((revenue * ctx.rc.fiscalMaxProgramPctOfRevenue) / 100));
    const amount = clampInt(requested, 1, maxPerTick);
    /* AGGREGATE CAP: total per-tick recurring drain (existing programs plus
       provisions approved earlier this same tick) may never exceed the
       configured share of expected revenue. Bust → drop entirely. */
    const aggregateCap = Math.floor((revenue * ctx.rc.fiscalRecurringCapPctOfRevenue) / 100);
    if (ctx.activeRecurringSpend + amount > aggregateCap) return null;

    const programName =
      sanitizeProgramName(Object.prototype.hasOwnProperty.call(fiscal, 'programName') ? fiscal['programName'] : null) ??
      sanitizeProgramName(ctx.fallbackProgramName) ??
      'Unnamed Program';

    return {
      kind: 'spend_recurring',
      amount,
      taxDelta: null,
      programName,
      sunsetTicks: readSunsetTicks(fiscal, ctx.rc.maxSunsetTicks),
    };
  }

  if (kind === 'tax_change') {
    const rawDelta = readFiniteNumber(fiscal, 'taxDelta');
    if (rawDelta === null) return null;
    const maxDelta = Math.floor(ctx.rc.fiscalMaxTaxDeltaPerLaw);
    const taxDelta = clampInt(Math.trunc(rawDelta), -maxDelta, maxDelta);
    /* A zero delta (requested or truncated from ±0.x) is a no-op → null. */
    if (taxDelta === 0) return null;
    return {
      kind: 'tax_change',
      amount: null,
      taxDelta,
      programName: null,
      sunsetTicks: readSunsetTicks(fiscal, ctx.rc.maxSunsetTicks),
    };
  }

  /* 'none' (explicit opt-out) and every unknown kind → no provision. */
  return null;
}
