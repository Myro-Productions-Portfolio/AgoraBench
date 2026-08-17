/**
 * F3 — floor bill expiry sweep, pure logic.
 *
 * Bills carry no tick-number column (unlike laws.enactedTick), so age is
 * derived from lastActionAt vs rc.tickIntervalMs — a wall-clock proxy for
 * tick count. Caveat: a multi-day server outage ages bills by wall-clock
 * time even though no ticks ran, same as any other timestamp-driven sim
 * mechanic (payroll, sunset clauses). Accepted, not solved here.
 *
 * Mirrors retentionCutoff/sweepWorldEvents (worldFeedPoller.ts) — 0/invalid
 * config disables the sweep outright (null cutoff), no DB touch.
 */

/** Minimal shape of a floor bill needed to decide expiry. */
export interface ExpiryCandidate {
  id: string;
  status: string;
  lastActionAt: Date;
}

/**
 * Cutoff timestamp: bills last-actioned before this are expired.
 * Null = sweep disabled (expiryTicks <= 0, or non-finite config).
 */
export function floorExpiryCutoff(expiryTicks: number, tickIntervalMs: number, now: Date): Date | null {
  if (!Number.isFinite(expiryTicks) || expiryTicks <= 0) return null;
  if (!Number.isFinite(tickIntervalMs) || tickIntervalMs <= 0) return null;
  return new Date(now.getTime() - expiryTicks * tickIntervalMs);
}

/**
 * Floor bills whose lastActionAt is older than cutoff. Only 'floor' status
 * bills are eligible — proposed/committee bills are still in earlier stages
 * with their own dynamics and are not this mechanic's concern. Null cutoff
 * (sweep disabled) or empty input yields no expirations. Pure, non-mutating.
 */
export function selectExpiredFloorBills(bills: ExpiryCandidate[], cutoff: Date | null): ExpiryCandidate[] {
  if (cutoff === null || !Array.isArray(bills)) return [];
  return bills.filter((b) => b && b.status === 'floor' && b.lastActionAt instanceof Date && b.lastActionAt < cutoff);
}
