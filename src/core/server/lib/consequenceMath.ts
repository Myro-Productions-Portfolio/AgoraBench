/**
 * Consequence math — pure, deterministic. The fiscal→approval scoring seam
 * (Fiscal Consequence Loop §3.1). `fiscalApprovalDelta` is a sum of four
 * independently-weighted signed contributions, each a bounded function of one
 * fiscal signal in a normalized [-1, +1] score (negative = distress,
 * positive = health), multiplied by its own weight. Weight 0 → that signal
 * contributes exactly 0. Every input is finite-guarded so corrupt state can
 * never produce NaN/Infinity that would poison an approval rating.
 *
 * `FiscalConsequenceState` is the extensible struct future consequence
 * subsystems (economy, unemployment, sentiment) add fields to — later signals
 * attach here without changing the call seam.
 */

export interface FiscalConsequenceState {
  treasuryBalance: number;
  debtOutstanding: number;
  gdpAnnual: number;
  taxRatePercent: number;
  deficitPerTick: number;
  treasuryBufferDollars: number;
}

export interface FiscalApprovalConfig {
  debtWeight: number;
  treasuryWeight: number;
  deficitWeight: number;
  taxWeight: number;
  partyWeight: number;
  maxDeltaPerTick: number;
  /** debt/GDP ratio (0..1) at which the debt signal is neutral; drag begins above it. */
  debtHealthBand: number;
  /** debt/GDP ratio treated as full crisis (signal saturates to -1). */
  debtCrisisBand: number;
  /** tax rate (%) at which the tax signal is neutral; penalty above, reward below. */
  taxNeutralRatePercent: number;
  /** deficit as a share of revenue (0..1) at which the deficit signal saturates to -1. */
  deficitCrisisRatio: number;
}

const num = (v: number): number => (Number.isFinite(v) ? v : 0);
const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** debt/GDP: +1 at zero debt, 0 at the health band, ramps to -1 at the crisis band. */
function debtScore(state: FiscalConsequenceState, cfg: FiscalApprovalConfig): number {
  const gdp = num(state.gdpAnnual);
  if (gdp <= 0) return 0;
  const ratio = num(state.debtOutstanding) / gdp;
  const band = num(cfg.debtHealthBand);
  const crisis = num(cfg.debtCrisisBand);
  if (ratio <= band) return band > 0 ? clamp1(1 - ratio / band) : 1;
  if (crisis <= band) return -1;
  return clamp1(-(ratio - band) / (crisis - band));
}

/** treasury vs buffer: +1 at/above buffer, ramps to -1 as treasury falls through zero to -buffer. */
function treasuryScore(state: FiscalConsequenceState): number {
  const buffer = num(state.treasuryBufferDollars);
  const treasury = num(state.treasuryBalance);
  if (buffer <= 0) return treasury >= 0 ? 1 : -1;
  if (treasury >= buffer) return 1;
  return clamp1(treasury / buffer);
}

/** deficit/revenue: +1 at a surplus of a full revenue-share, ramps to -1 at the crisis ratio. */
function deficitScore(state: FiscalConsequenceState, cfg: FiscalApprovalConfig): number {
  const revenue = (num(state.gdpAnnual) * num(state.taxRatePercent)) / 100 / 365;
  if (revenue <= 0) return num(state.deficitPerTick) > 0 ? -1 : 0;
  const share = num(state.deficitPerTick) / revenue;
  if (share <= 0) return clamp1(-share);
  const crisis = num(cfg.deficitCrisisRatio);
  return crisis > 0 ? clamp1(-share / crisis) : -1;
}

/** tax burden: 0 at neutral, +1 at zero rate, ramps to -1 as rate climbs a neutral-width above neutral. */
function taxScore(state: FiscalConsequenceState, cfg: FiscalApprovalConfig): number {
  const neutral = num(cfg.taxNeutralRatePercent);
  const rate = num(state.taxRatePercent);
  if (neutral <= 0) return rate > 0 ? -1 : 0;
  return clamp1((neutral - rate) / neutral);
}

/**
 * Signed per-tick approval delta from fiscal state for an officeholder.
 * `partyLean` (-1 spending-oriented .. +1 hawk-oriented) modulates the tax and
 * debt penalties up and the treasury-depletion penalty down for a hawk (and the
 * reverse for a spender), scaled by cfg.partyWeight (0 = party-blind). Result is
 * clamped to ±cfg.maxDeltaPerTick. All-zero weights return exactly 0 (dark-safe).
 */
export function fiscalApprovalDelta(
  state: FiscalConsequenceState,
  cfg: FiscalApprovalConfig,
  partyLean = 0,
): number {
  const pw = clamp1(num(cfg.partyWeight));
  const lean = clamp1(num(partyLean));
  const hawk = 1 + pw * lean;
  const spender = 1 - pw * lean;

  const debt = num(cfg.debtWeight) * debtScore(state, cfg) * hawk;
  const treasury = num(cfg.treasuryWeight) * treasuryScore(state) * spender;
  const deficit = num(cfg.deficitWeight) * deficitScore(state, cfg);
  const tax = num(cfg.taxWeight) * taxScore(state, cfg) * hawk;

  const total = debt + treasury + deficit + tax;
  if (!Number.isFinite(total) || total === 0) return 0; // collapse -0 → 0 (dark-safe)
  const max = num(cfg.maxDeltaPerTick);
  const bound = max > 0 ? max : 0;
  return total < -bound ? -bound : total > bound ? bound : total;
}

/* ── Slice 2: tick-phase pure helpers (state-build + officeholder filter) ── */

const ALIGNMENT_LEAN: Record<string, number> = {
  progressive: -1,   // spending-oriented
  technocrat: -0.5,
  moderate: 0,
  libertarian: 0.5,
  conservative: 1,   // hawk-oriented
};

/** alignment → partyLean in [-1 spender .. +1 hawk]; unknown/null → 0 (party-blind). */
export function partyLeanFromAlignment(alignment: string | null | undefined): number {
  if (!alignment) return 0;
  const lean = ALIGNMENT_LEAN[alignment];
  return Number.isFinite(lean) ? lean : 0;
}

export interface Officeholder {
  agentId: string;
  alignment: string | null;
}

/**
 * Per-officeholder integer approval moves from settled fiscal state. Returns []
 * when disabled (dark-safe short-circuit) or when no move rounds nonzero, so the
 * tick applies nothing. Round-to-0 deltas are dropped (matches the decay loop's
 * integer approvalRating semantics).
 */
export function computeFiscalApprovalMoves(
  enabled: boolean,
  state: FiscalConsequenceState,
  cfg: FiscalApprovalConfig,
  officeholders: Officeholder[],
): Array<{ agentId: string; delta: number }> {
  if (!enabled) return [];
  const moves: Array<{ agentId: string; delta: number }> = [];
  for (const o of officeholders) {
    const lean = partyLeanFromAlignment(o.alignment);
    const delta = Math.round(fiscalApprovalDelta(state, cfg, lean));
    if (delta === 0) continue;
    moves.push({ agentId: o.agentId, delta });
  }
  return moves;
}
