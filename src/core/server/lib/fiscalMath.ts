/**
 * Phase 3 fiscal math — pure, deterministic, integer-only.
 *
 * Every function here takes integers and returns integers (all money in this
 * economy is integer dollars: agents.balance, governmentSettings.treasuryBalance
 * are bigint columns, taxRatePercent is integer, and payroll uses Math.floor).
 * Every
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
 * Daily citizen tax revenue: floor(gdpAnnual * taxRatePercent / 100 / 365).
 * One tick = one sim day, so this is the per-tick treasury inflow from the
 * citizen tax base (the wiki's long-claimed GDP×rate model). Replaces the old
 * balance-wealth-tax model. Non-finite or non-positive inputs resolve to 0.
 */
export function dailyCitizenRevenue(gdpAnnual: number, taxRatePercent: number): number {
  if (!Number.isFinite(gdpAnnual) || !Number.isFinite(taxRatePercent)) return 0;
  if (gdpAnnual <= 0 || taxRatePercent <= 0) return 0;
  return Math.floor((gdpAnnual * taxRatePercent) / 100 / 365);
}

/** True when a payday is due this tick: tickNumber is a positive multiple of
 *  payPeriodTicks. Non-finite / non-positive inputs are never due. */
export function paydayDue(tickNumber: number, payPeriodTicks: number): boolean {
  if (!Number.isFinite(tickNumber) || !Number.isFinite(payPeriodTicks)) return false;
  if (tickNumber <= 0 || payPeriodTicks <= 0) return false;
  return Math.floor(tickNumber) % Math.floor(payPeriodTicks) === 0;
}

/**
 * One pay-period paycheck from an annual salary, net of income-tax withholding.
 * gross = floor(annual / 26) (bi-weekly, 26 periods/yr), withheld = floor(gross
 * × taxPct/100), net = gross − withheld. Non-finite / non-positive annual → all
 * zero; taxPct is clamped to [0, 100] defensively.
 */
export function computePaycheck(
  annualSalary: number,
  taxRatePercent: number,
): { gross: number; withheld: number; net: number } {
  if (!Number.isFinite(annualSalary) || annualSalary <= 0) return { gross: 0, withheld: 0, net: 0 };
  const pct = Number.isFinite(taxRatePercent) ? Math.min(100, Math.max(0, taxRatePercent)) : 0;
  const gross = Math.floor(annualSalary / 26);
  const withheld = Math.floor((gross * pct) / 100);
  return { gross, withheld, net: gross - withheld };
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

/**
 * Budget-session trigger — fires when tickNumber - lastSessionTick >= cycleTicks.
 * lastSessionTick is NOT NULL DEFAULT 0 in the DB, so the first post-deploy
 * check on a mid-life DB (tickNumber in the thousands) fires immediately and
 * re-baselines — intended. A corrupt/non-finite marker is treated as 0 (fire
 * and re-baseline) because a stuck marker must never silence the cycle forever;
 * a non-finite tickNumber or non-positive cycle disables the session instead
 * (conservative: no lapse on bad input).
 */
export function budgetSessionDue(
  tickNumber: number,
  lastSessionTick: number | null | undefined,
  cycleTicks: number,
): boolean {
  if (!Number.isFinite(tickNumber)) return false;
  if (!Number.isFinite(cycleTicks) || cycleTicks <= 0) return false;
  const last = lastSessionTick !== null && lastSessionTick !== undefined && Number.isFinite(lastSessionTick)
    ? lastSessionTick
    : 0;
  return tickNumber - last >= cycleTicks;
}

/* ── UI countdown helpers (budget endpoint + detail enrichment) ────────── */
/* "currentTick" here is the COUNT of completed ticks (the same tick_log
   COUNT the sim derives tickNumber from — the next tick to run is count+1).
   All three return whole ticks remaining, floored at 0 ("due now/overdue"). */

/**
 * Ticks until a law's sunset is due: max(0, enactedTick + sunsetTicks - currentTick).
 * Returns null for laws with no sunset (legacy: NULL columns) or bad input.
 */
export function ticksUntilSunset(
  currentTick: number,
  enactedTick: number | null | undefined,
  sunsetTicks: number | null | undefined,
): number | null {
  if (!Number.isFinite(currentTick)) return null;
  if (enactedTick === null || enactedTick === undefined || !Number.isFinite(enactedTick)) return null;
  if (sunsetTicks === null || sunsetTicks === undefined || !Number.isFinite(sunsetTicks) || sunsetTicks <= 0) return null;
  return Math.max(0, Math.floor(enactedTick) + Math.floor(sunsetTicks) - Math.floor(currentTick));
}

/**
 * Ticks until a program's funding lapse is DUE (the actual program_active
 * flip executes at the next budget session at/after that point):
 * max(0, max(enactedTick, lastRenewedTick) + cycleTicks - currentTick).
 * Returns null when the program has no enactedTick (legacy) or bad input.
 */
export function ticksUntilLapse(
  currentTick: number,
  enactedTick: number | null | undefined,
  lastRenewedTick: number | null | undefined,
  cycleTicks: number,
): number | null {
  if (!Number.isFinite(currentTick)) return null;
  if (enactedTick === null || enactedTick === undefined || !Number.isFinite(enactedTick)) return null;
  if (!Number.isFinite(cycleTicks) || cycleTicks <= 0) return null;
  const renewed = lastRenewedTick !== null && lastRenewedTick !== undefined && Number.isFinite(lastRenewedTick)
    ? lastRenewedTick
    : enactedTick;
  const anchor = Math.max(Math.floor(enactedTick), Math.floor(renewed));
  return Math.max(0, anchor + Math.floor(cycleTicks) - Math.floor(currentTick));
}

/**
 * Ticks from now until the next budget session fires. Phase 9.7 fires at
 * tick n when n - lastSessionTick >= cycleTicks, and the next tick to run
 * is currentTick + 1, so the session tick is
 * max(currentTick + 1, lastSessionTick + cycleTicks) — always >= 1 away.
 * Corrupt/missing marker is treated as 0 (matches budgetSessionDue).
 * Returns null on bad currentTick/cycle (caller renders no countdown).
 */
export function ticksUntilNextBudgetSession(
  currentTick: number,
  lastSessionTick: number | null | undefined,
  cycleTicks: number,
): number | null {
  if (!Number.isFinite(currentTick)) return null;
  if (!Number.isFinite(cycleTicks) || cycleTicks <= 0) return null;
  const last = lastSessionTick !== null && lastSessionTick !== undefined && Number.isFinite(lastSessionTick)
    ? Math.floor(lastSessionTick)
    : 0;
  const cur = Math.floor(currentTick);
  const sessionTick = Math.max(cur + 1, last + Math.floor(cycleTicks));
  return sessionTick - cur;
}

/* ── Phase 11 renewal-pressure note ────────────────────────────────────── */

const EXPIRING_NOTE_MAX_PROGRAMS = 3;
const EXPIRING_NOTE_MAX_CHARS = 220;
const EXPIRING_NOTE_NAME_MAX_CHARS = 40;

/**
 * Server-composed, deterministic prompt fragment listing programs that will
 * lapse at the next budget session — bounded to 3 programs / 220 chars so it
 * can never blow the 4000-char prompt budget. Returns '' when nothing expires
 * (callers append it unconditionally). Names are sliced defensively even
 * though stored fiscalProgramName is already sanitized at parse time.
 */
export function composeExpiringProgramsNote(
  programs: Array<{ name: string; perTick: number }>,
): string {
  if (programs.length === 0) return '';
  const items = programs
    .slice(0, EXPIRING_NOTE_MAX_PROGRAMS)
    .map((p) => {
      const name = p.name.replace(/\s+/g, ' ').trim().slice(0, EXPIRING_NOTE_NAME_MAX_CHARS) || 'Unnamed Program';
      const perTick = Number.isFinite(p.perTick) ? Math.floor(p.perTick) : 0;
      return `${name} ($${perTick}/tick)`;
    });
  const note = ` Programs expiring at the next budget session: ${items.join(', ')}.`;
  return note.length > EXPIRING_NOTE_MAX_CHARS ? note.slice(0, EXPIRING_NOTE_MAX_CHARS) : note;
}

/* ── Fiscal note ("CBO score") projection ──────────────────────────────── */

export interface FiscalProvisionLike {
  kind: FiscalKind;
  amount: number | null;       // per-tick $ for recurring, total $ for one-time
  taxDelta: number | null;     // signed whole percentage points
  sunsetTicks: number | null;
}

export interface FiscalNoteContext {
  treasuryBalance: number;
  gdpAnnual: number;           // annual GDP — the citizen tax base
  budgetCycleTicks: number;
}

export interface FiscalNote {
  kind: FiscalKind;
  /** One-time treasury debit at enactment (spend_once only), dollars >= 0. */
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
    const gdp = Number.isFinite(ctx.gdpAnnual) && ctx.gdpAnnual > 0 ? ctx.gdpAnnual : 0;
    /* Δrevenue/tick = floor(GDP × delta / 100 / 365) — matches dailyCitizenRevenue(). */
    perTickDelta = Math.floor((gdp * Math.trunc(provision.taxDelta)) / 100 / 365);
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
