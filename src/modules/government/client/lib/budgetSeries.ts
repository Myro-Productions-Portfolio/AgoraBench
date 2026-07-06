// Pure helpers for the Budget page fiscal series.
//
// The series returned by GET /api/government/budget spans the dollar-era
// currency rebase (~tick 750): rows written before the rebase are in old
// MoltDollar units (~2,000-7,000), rows after are in real dollars
// (~1.7e12 treasury). trimToCurrentEra() drops the stale pre-rebase prefix
// so charts don't render a single vertical jump followed by a flatline.

export interface SeriesPoint {
  tickNumber: number;
  revenue: number;
  spending: number;
  treasuryEnd: number;
  createdAt: string;
}

/** Treasury jumps by more than this factor between consecutive points only at a currency rebase. */
const REBASE_JUMP_FACTOR = 1000;

/**
 * Drops all points before the LAST discontinuity where treasuryEnd jumps by
 * more than REBASE_JUMP_FACTOR between consecutive points. If no such jump
 * exists, returns the series unchanged (same reference).
 */
export function trimToCurrentEra(series: SeriesPoint[]): SeriesPoint[] {
  if (series.length < 2) return series;

  let lastJumpIndex = -1;
  for (let i = 1; i < series.length; i++) {
    const prev = Math.max(Math.abs(series[i - 1].treasuryEnd), 1);
    const curr = Math.abs(series[i].treasuryEnd);
    if (curr / prev > REBASE_JUMP_FACTOR) {
      lastJumpIndex = i;
    }
  }

  if (lastJumpIndex === -1) return series;
  return series.slice(lastJumpIndex);
}
