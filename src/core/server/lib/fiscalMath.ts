/**
 * Phase 3 fiscal math — pure, deterministic, integer-only.
 *
 * Every function here takes integers and returns integers (all money in this
 * economy is integer M$: agents.balance, governmentSettings.treasuryBalance,
 * taxRatePercent are integer columns and Phase 13 uses Math.floor). Every
 * input is guarded with Number.isFinite so hostile or corrupt values can
 * never produce NaN/Infinity that would poison the treasury.
 *
 * Boundary semantics (pinned by tests — the classic off-by-one hazard):
 *   - sunsetDue:  due when (tickNumber - enactedTick) >= sunsetTicks
 *   - lapseDue:   due when (tickNumber - max(enactedTick, lastRenewedTick)) >= cycleTicks
 *   - NULL/undefined enactedTick (legacy laws) is NEVER due — legacy safety.
 */

export type FiscalKind = 'spend_once' | 'spend_recurring' | 'tax_change';

/** Floor + clamp to [min, max]. Non-finite input returns min (safe floor). */
export function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const i = Math.floor(v);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

/**
 * Expected per-tick tax revenue: floor(sumBalances * taxRatePercent / 100).
 * Mirrors Phase 13's Math.floor(balance * rate) semantics in aggregate.
 * Non-finite or negative inputs resolve to 0 (clamp-context anomaly = no-op).
 */
export function expectedTickRevenue(taxRatePercent: number, sumBalances: number): number {
  if (!Number.isFinite(taxRatePercent) || !Number.isFinite(sumBalances)) return 0;
  if (taxRatePercent <= 0 || sumBalances <= 0) return 0;
  return Math.floor((sumBalances * taxRatePercent) / 100);
}

/**
 * Apply a revenue law's tax delta at enactment:
 * newRate = clamp(current + delta, min, max). Integer in, integer out.
 * Non-finite current/delta returns the current rate unchanged (no-op).
 */
export function applyTaxDelta(current: number, delta: number, min: number, max: number): number {
  if (!Number.isFinite(current)) return min;
  if (!Number.isFinite(delta)) return clampInt(current, min, max);
  return clampInt(Math.floor(current) + Math.trunc(delta), min, max);
}

/**
 * Sunset check — due when the law's age since enactment reaches sunsetTicks.
 * Age is measured from enactedTick only (renewal does NOT extend a sunset;
 * lapse is the renewable mechanism). Legacy laws (NULL enactedTick or NULL
 * sunsetTicks) are never due.
 */
export function sunsetDue(
  tickNumber: number,
  enactedTick: number | null | undefined,
  sunsetTicks: number | null | undefined,
): boolean {
  if (enactedTick === null || enactedTick === undefined || !Number.isFinite(enactedTick)) return false;
  if (sunsetTicks === null || sunsetTicks === undefined || !Number.isFinite(sunsetTicks)) return false;
  if (!Number.isFinite(tickNumber)) return false;
  if (sunsetTicks <= 0) return false;
  return tickNumber - enactedTick >= sunsetTicks;
}

/**
 * Budget-cycle lapse check — due when the program's age since its last
 * renewal (or enactment, whichever is later) reaches cycleTicks.
 * NULL lastRenewedTick falls back to enactedTick; NULL enactedTick (legacy)
 * is never due.
 */
export function lapseDue(
  tickNumber: number,
  enactedTick: number | null | undefined,
  lastRenewedTick: number | null | undefined,
  cycleTicks: number,
): boolean {
  if (enactedTick === null || enactedTick === undefined || !Number.isFinite(enactedTick)) return false;
  if (!Number.isFinite(tickNumber) || !Number.isFinite(cycleTicks) || cycleTicks <= 0) return false;
  const renewed = lastRenewedTick !== null && lastRenewedTick !== undefined && Number.isFinite(lastRenewedTick)
    ? lastRenewedTick
    : enactedTick;
  const anchor = Math.max(enactedTick, renewed);
  return tickNumber - anchor >= cycleTicks;
}

/* ── Fiscal note ("CBO score") projection ──────────────────────────────── */

export interface FiscalProvisionLike {
  kind: FiscalKind;
  amount: number | null;       // per-tick M$ for recurring, total M$ for one-time
  taxDelta: number | null;     // signed whole percentage points
  sunsetTicks: number | null;
}

export interface FiscalNoteContext {
  treasuryBalance: number;
  sumActiveBalances: number;   // Σ balance over active agents
  budgetCycleTicks: number;
}

export interface FiscalNote {
  kind: FiscalKind;
  /** One-time treasury debit at enactment (spend_once only), M$ >= 0. */
  oneTimeCost: number;
  /** Signed treasury delta per tick: negative for recurring spend, positive for a tax raise. */
  perTickDelta: number;
  /** perTickDelta over one full budget cycle. */
  perCycleDelta: number;
  /** Ticks the recurring effect is projected over: min(sunsetTicks, budgetCycleTicks), or one cycle. 0 for one-time. */
  horizonTicks: number;
  /** Signed projected treasury delta over the next 10 ticks (bounded by sunset). */
  projected10TickDelta: number;
  /** |total impact over the horizon| as % of current treasury, 1 decimal. 0 when treasury <= 0. */
  pctOfCurrentTreasury: number;
}

/**
 * Deterministic projection from an ALREADY-CLAMPED stored provision.
 * Pure integer arithmetic (except the presentation-only percentage).
 * Returns null when the provision carries no usable numbers — the caller
 * then renders no fiscal note at all.
 */
export function projectFiscalNote(
  provision: FiscalProvisionLike,
  ctx: FiscalNoteContext,
): FiscalNote | null {
  const cycle = Number.isFinite(ctx.budgetCycleTicks) && ctx.budgetCycleTicks > 0
    ? Math.floor(ctx.budgetCycleTicks)
    : 24;

  let oneTimeCost = 0;
  let perTickDelta = 0;
  let horizonTicks = 0;

  if (provision.kind === 'spend_once') {
    if (provision.amount === null || !Number.isFinite(provision.amount) || provision.amount <= 0) return null;
    oneTimeCost = Math.floor(provision.amount);
  } else if (provision.kind === 'spend_recurring') {
    if (provision.amount === null || !Number.isFinite(provision.amount) || provision.amount <= 0) return null;
    perTickDelta = -Math.floor(provision.amount);
    horizonTicks = provision.sunsetTicks !== null && Number.isFinite(provision.sunsetTicks) && provision.sunsetTicks > 0
      ? Math.min(Math.floor(provision.sunsetTicks), cycle)
      : cycle;
  } else if (provision.kind === 'tax_change') {
    if (provision.taxDelta === null || !Number.isFinite(provision.taxDelta) || provision.taxDelta === 0) return null;
    const sum = Number.isFinite(ctx.sumActiveBalances) && ctx.sumActiveBalances > 0 ? ctx.sumActiveBalances : 0;
    /* Δrevenue/tick = floor(Σ balances × delta / 100) — matches Phase 13 flooring. */
    perTickDelta = Math.floor((sum * Math.trunc(provision.taxDelta)) / 100);
    horizonTicks = cycle;
  } else {
    return null;
  }

  const perCycleDelta = perTickDelta * cycle;
  const recurring10 = provision.kind === 'spend_recurring'
    ? perTickDelta * Math.min(10, horizonTicks)
    : perTickDelta * 10;
  const projected10TickDelta = provision.kind === 'spend_once' ? -oneTimeCost : recurring10;

  const horizonImpact = provision.kind === 'spend_once' ? oneTimeCost : Math.abs(perTickDelta * horizonTicks);
  const treasury = Number.isFinite(ctx.treasuryBalance) ? ctx.treasuryBalance : 0;
  const pctOfCurrentTreasury = treasury > 0
    ? Math.round((horizonImpact / treasury) * 1000) / 10
    : 0;

  return {
    kind: provision.kind,
    oneTimeCost,
    perTickDelta,
    perCycleDelta,
    horizonTicks,
    projected10TickDelta,
    pctOfCurrentTreasury,
  };
}
