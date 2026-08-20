/**
 * 10-K digest builder — pure and deterministic, mirroring gazetteDigest.ts.
 * Turns the scoreboard metrics array into the bounded, sectioned plain text
 * fed to the 10-K LLM call: per-metric sim/reality/gap lines plus movement
 * since the previous report, with one-sided metrics reported honestly as
 * pending instead of invented. Never contains model output; every line is
 * hard-capped so the prompt budget (rc.maxPromptLengthChars 4000) stays safe.
 */

export interface ScoreboardDigestMetric {
  key: string;
  name: string;
  unit: string;
  tier: string;
  sim: { value: number; atTick: number | null } | null;
  reality: { value: number; atDate: string } | null;
  gap: number | null;
  status: 'comparable' | 'pending';
  series: { sim: { atTick: number | null; value: number }[] };
}

const MAX_DIGEST_CHARS = 3000;
const LINE_MAX_CHARS = 200;

/** Compact deterministic number rendering: 2 decimals, T/B/M/K magnitude suffixes. */
export function fmtMetricValue(v: number): string {
  const abs = Math.abs(v);
  const scaled = (div: number, suffix: string) => `${trimZeros((v / div).toFixed(2))}${suffix}`;
  if (abs >= 1e12) return scaled(1e12, 'T');
  if (abs >= 1e9) return scaled(1e9, 'B');
  if (abs >= 1e6) return scaled(1e6, 'M');
  if (abs >= 1e4) return scaled(1e3, 'K');
  return trimZeros(v.toFixed(2));
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

function signed(v: number): string {
  return v >= 0 ? `+${fmtMetricValue(v)}` : fmtMetricValue(v);
}

/**
 * Movement of the sim value since the previous report: latest sim value minus
 * the last sim series point at or before previousReportTick. Null when there
 * is no prior report, no baseline point in the window, or no sim value.
 */
export function movedSinceTick(
  metric: Pick<ScoreboardDigestMetric, 'sim' | 'series'>,
  previousReportTick: number | null,
): number | null {
  if (!metric.sim || previousReportTick === null) return null;
  let baseline: number | null = null;
  for (const p of metric.series.sim) {
    if (p.atTick !== null && p.atTick <= previousReportTick) baseline = p.value;
    else if (p.atTick !== null && p.atTick > previousReportTick) break;
  }
  if (baseline === null) return null;
  return metric.sim.value - baseline;
}

/**
 * Build the deterministic 10-K digest. Returns null when the scoreboard has
 * nothing to report — no comparable metric AND no sim-side data at all (the
 * caller then skips the LLM call entirely). Sections are fixed-order:
 * period header, comparable metrics, sim-only, then pending. Trimming under
 * the char cap drops pending lines first, then sim-only, then comparable
 * tail — always keeping at least one metric line. Output ≤ 3000 chars.
 */
export function buildScoreboardDigest(
  metrics: ScoreboardDigestMetric[],
  previousReportTick: number | null,
  periodLabel: string,
): string | null {
  const comparable: string[] = [];
  const simOnly: string[] = [];
  const pending: string[] = [];

  for (const m of metrics) {
    const unit = m.unit ? ` ${m.unit}` : '';
    if (m.sim && m.reality && m.gap !== null) {
      const moved = movedSinceTick(m, previousReportTick);
      const movedText = previousReportTick === null
        ? 'first report'
        : moved === null
          ? 'no prior value'
          : `moved ${signed(moved)} since last report`;
      comparable.push(cap(
        `- ${m.name}: sim ${fmtMetricValue(m.sim.value)} vs reality ${fmtMetricValue(m.reality.value)}${unit}; ` +
        `gap ${signed(m.gap)}; ${movedText}`,
      ));
    } else if (m.sim) {
      simOnly.push(cap(`- ${m.name}: sim ${fmtMetricValue(m.sim.value)}${unit}; no reality series yet — not comparable`));
    } else {
      pending.push(cap(`- ${m.name}: pending — no sim-side data yet${m.reality ? ` (reality: ${fmtMetricValue(m.reality.value)}${unit})` : ''}`));
    }
  }

  if (comparable.length === 0 && simOnly.length === 0) return null;

  const render = () => {
    const sections: string[] = [`PERIOD: ${periodLabel}`.slice(0, LINE_MAX_CHARS)];
    if (comparable.length > 0) sections.push('COMPARABLE (sim vs reality):', ...comparable);
    if (simOnly.length > 0) sections.push('SIM ONLY (reality side not yet available):', ...simOnly);
    if (pending.length > 0) sections.push('PENDING (no sim measurement exists — do not invent):', ...pending);
    return sections.join('\n');
  };

  /* Trim to the cap — deterministic: pending tail first, then sim-only,
     then comparable, never below one metric line. */
  while (render().length > MAX_DIGEST_CHARS && comparable.length + simOnly.length + pending.length > 1) {
    if (pending.length > 0) pending.pop();
    else if (simOnly.length > 0) simOnly.pop();
    else comparable.pop();
  }

  const digest = render();
  return digest.length > MAX_DIGEST_CHARS ? digest.slice(0, MAX_DIGEST_CHARS) : digest;
}

function cap(line: string): string {
  return line.length > LINE_MAX_CHARS ? line.slice(0, LINE_MAX_CHARS) : line;
}
