import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { divergenceApi } from '@core/client/lib/api';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { formatMoney } from '@core/client/lib/formatMoney';
import { EmptyState } from '@core/client/components/EmptyState';

/* ── Types (mirror GET /api/divergence) ─────────────────────────────────── */

interface CategorySpendSim { name: string; perDay: number; }
interface CategorySpendReality { name: string; fytd: number; }

interface SimData {
  treasuryBalance: number;
  debtOutstanding: number;
  taxRatePercent: number;
  revenuePerDay: number;
  spendingPerDay: number;
  deficitPerDay: number;
  debtToGdpPct: number;
  spendingByCategory: CategorySpendSim[];
}

interface RealityData {
  asOf: string;
  debtOutstanding: number;
  outlaysFytd: number;
  receiptsFytd: number;
  deficitFytd: number;
  outlaysPerDayAvg: number;
  deficitPerDayAvg: number;
  debtToGdpPct: number;
  taxBurdenPct: number;
  spendingByCategory: CategorySpendReality[];
}

interface SimSeriesPoint { tickNumber: number; deficit: number; }
interface RealitySeriesPoint { recordDate: string; deficitFytd: number | null; debtOutstanding: number | null; }

interface ProgramContinuity {
  lawId: string;
  name: string;
  perDay: number;
  status: 'Funded' | 'Amended' | 'Lapsed';
}

interface DivergenceData {
  t0: { tick: number; date: string } | null;
  sim: SimData;
  reality: RealityData | null;
  series: { sim: SimSeriesPoint[]; reality: RealitySeriesPoint[] };
  mixDivergence: number | null;
  programContinuity: ProgramContinuity[];
}

const fmtM = (v: number): string => formatMoney(v, { compact: true });

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
      <div>
        <h2 className="font-serif text-lg font-semibold text-stone">{title}</h2>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function CompareStatCard({
  label, simValue, realityValue, simSub, realitySub,
}: {
  label: string;
  simValue: React.ReactNode;
  realityValue: React.ReactNode;
  simSub?: React.ReactNode;
  realitySub?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="text-badge text-text-muted uppercase tracking-widest mb-3">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gold/70 mb-0.5">Sim (AI)</p>
          <p className="font-mono text-lg font-semibold text-gold">{simValue}</p>
          {simSub && <p className="text-[11px] text-text-muted mt-0.5">{simSub}</p>}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-text-muted mb-0.5">Reality</p>
          <p className="font-mono text-lg font-semibold text-text-secondary">{realityValue}</p>
          {realitySub && <p className="text-[11px] text-text-muted mt-0.5">{realitySub}</p>}
        </div>
      </div>
    </div>
  );
}

/* ── Spending mix bars (two-column, shared category ordering) ──────────── */

function shareEntries(categories: { name: string; amount: number }[]): { name: string; share: number }[] {
  const total = categories.reduce((acc, c) => acc + Math.max(0, c.amount), 0);
  if (total <= 0) return [];
  return categories
    .map((c) => ({ name: c.name, share: Math.max(0, c.amount) / total }))
    .sort((a, b) => b.share - a.share);
}

function MixBars({ entries, colorClass }: { entries: { name: string; share: number }[]; colorClass: string }) {
  if (entries.length === 0) {
    return <p className="text-xs text-text-muted py-4 text-center">No data yet.</p>;
  }
  return (
    <div className="space-y-2">
      {entries.slice(0, 8).map((e) => (
        <div key={e.name}>
          <div className="flex items-center justify-between text-xs mb-0.5">
            <span className="text-text-secondary truncate pr-2">{e.name}</span>
            <span className="text-text-muted font-mono shrink-0">{(e.share * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
            <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${Math.max(1, e.share * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Trajectory chart (inline SVG, mirrors BudgetPage's TreasuryChart) ──── */

const CHART_W = 720;
const CHART_H = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 64 };

function DeficitChart({
  points, label, color,
}: {
  points: { x: number; y: number }[];
  label: string;
  color: string;
}) {
  if (points.length < 2) {
    return <p className="text-sm text-text-muted py-6 text-center">Not enough data yet for a trajectory.</p>;
  }
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const xMin = points[0].x;
  const xMax = points[points.length - 1].x;
  const yValues = points.map((p) => p.y);
  let yMin = Math.min(0, ...yValues);
  let yMax = Math.max(0, ...yValues);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPadding = Math.max(1, Math.round((yMax - yMin) * 0.08));
  yMin -= yPadding;
  yMax += yPadding;

  const sx = (x: number) => PAD.left + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW);
  const sy = (y: number) => PAD.top + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const zeroVisible = yMin < 0 && yMax > 0;
  const gridYs = [0, 1, 2, 3].map((i) => yMin + ((yMax - yMin) * i) / 3);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full min-w-[480px]" role="img" aria-label={label}>
        {gridYs.map((gy, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={CHART_W - PAD.right} y1={sy(gy)} y2={sy(gy)} stroke="currentColor" className="text-border" strokeWidth={0.5} />
            <text x={PAD.left - 8} y={sy(gy) + 3} textAnchor="end" className="fill-current text-text-muted" fontSize={10}>
              {fmtM(gy)}
            </text>
          </g>
        ))}
        {zeroVisible && (
          <line x1={PAD.left} x2={CHART_W - PAD.right} y1={sy(0)} y2={sy(0)} stroke="currentColor" className="text-red-400/60" strokeWidth={1} strokeDasharray="4 3" />
        )}
        <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx(last.x)} cy={sy(last.y)} r={3} fill={color} />
      </svg>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function DivergencePage() {
  const [data, setData] = useState<DivergenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { subscribe } = useWebSocket();

  const fetchDivergence = useCallback(() => {
    divergenceApi.get()
      .then((res) => {
        if (res.data) setData(res.data as DivergenceData);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchDivergence(); }, [fetchDivergence]);

  useEffect(() => {
    const unsubs = [subscribe('tick:complete', fetchDivergence)];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchDivergence]);

  const simShareEntries = useMemo(
    () => data ? shareEntries(data.sim.spendingByCategory.map((c) => ({ name: c.name, amount: c.perDay }))) : [],
    [data],
  );
  const realityShareEntries = useMemo(
    () => data?.reality ? shareEntries(data.reality.spendingByCategory.map((c) => ({ name: c.name, amount: c.fytd }))) : [],
    [data],
  );

  const simDeficitPoints = useMemo(
    () => data ? data.series.sim.map((p) => ({ x: p.tickNumber, y: p.deficit })) : [],
    [data],
  );
  const realityDeficitPoints = useMemo(
    () => data
      ? data.series.reality
          .filter((p) => p.deficitFytd !== null)
          .map((p, i) => ({ x: i, y: p.deficitFytd as number }))
      : [],
    [data],
  );

  if (loading) {
    return <div className="max-w-6xl mx-auto px-6 py-20 text-center text-text-muted text-sm">Loading...</div>;
  }
  if (error || !data) {
    return <div className="max-w-6xl mx-auto px-6 py-20 text-center text-danger text-sm">Divergence data unavailable.</div>;
  }

  if (!data.t0) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-stone">Sim vs Reality</h1>
          <p className="text-sm text-text-muted mt-1">
            AI government vs. the real United States federal government, from a shared fiscal baseline.
          </p>
        </div>
        <Section title="Divergence Experiment">
          <EmptyState
            title="The Divergence Experiment has not begun."
            hint="The baseline seed has not been run — check back once the sim carries the real US fiscal starting point."
          />
        </Section>
      </div>
    );
  }

  const { sim, reality } = data;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-stone">Sim vs Reality</h1>
        <p className="text-sm text-text-muted mt-1">
          From a shared baseline seeded on the real US federal fiscal position (tick {data.t0.tick}, {data.t0.date}),
          the AI government now owns every fiscal outcome. Reality is the control group — pulled periodically,
          never fed back into the sim, purely for comparison.
        </p>
      </div>

      {!reality && (
        <div className="rounded border border-yellow-700/30 bg-yellow-900/10 px-4 py-2.5 text-sm text-yellow-300">
          Reality reference data is still backfilling — comparisons below show sim state only until the first pull completes.
        </div>
      )}

      {/* Headline tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CompareStatCard
          label="Daily Deficit"
          simValue={`${fmtM(sim.deficitPerDay)}/day`}
          realityValue={reality ? `${fmtM(reality.deficitPerDayAvg)}/day` : '—'}
        />
        <CompareStatCard
          label="National Debt"
          simValue={fmtM(sim.debtOutstanding)}
          realityValue={reality ? fmtM(reality.debtOutstanding) : '—'}
          simSub={`${sim.debtToGdpPct}% of GDP`}
          realitySub={reality ? `${reality.debtToGdpPct}% of GDP` : undefined}
        />
        <CompareStatCard
          label="Tax Burden"
          simValue={`${sim.taxRatePercent}%`}
          realityValue={reality ? `${reality.taxBurdenPct}%` : '—'}
          simSub="Statutory rate"
          realitySub={reality ? 'Receipts, annualized, % of GDP' : undefined}
        />
        <CompareStatCard
          label="Total Spending"
          simValue={`${fmtM(sim.spendingPerDay)}/day`}
          realityValue={reality ? `${fmtM(reality.outlaysPerDayAvg)}/day` : '—'}
        />
      </div>

      {/* Spending mix */}
      <Section
        title="Spending Mix"
        subtitle="Category share of total spending — sim programs mapped to Treasury MTS budget-function categories where a clean match exists"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gold/70 mb-2">Sim (AI)</p>
            <MixBars entries={simShareEntries} colorClass="bg-gold/70" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Reality</p>
            <MixBars entries={realityShareEntries} colorClass="bg-text-secondary/70" />
          </div>
        </div>
        <div className="pt-2 border-t border-border/30 text-sm">
          {data.mixDivergence !== null ? (
            <p className="text-text-secondary">
              Mix divergence score: <span className="font-mono text-gold">{data.mixDivergence.toFixed(2)}</span>
              <span className="text-text-muted"> (0 = identical mix, 2 = completely different)</span>
            </p>
          ) : (
            <p className="text-text-muted">Mix divergence score unavailable — needs spending data on both sides.</p>
          )}
        </div>
      </Section>

      {/* Trajectories */}
      <Section title="Trajectories Since T0" subtitle="Daily deficit — sim per-tick, reality fiscal-year-to-date (monthly cadence)">
        <div className="grid grid-cols-1 gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gold/70 mb-2">Sim (AI)</p>
            <DeficitChart points={simDeficitPoints} label="Sim deficit trajectory" color="#B8956A" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Reality</p>
            <DeficitChart points={realityDeficitPoints} label="Reality deficit trajectory" color="#9CA3AF" />
          </div>
        </div>
      </Section>

      {/* Program continuity */}
      <Section title="Program Continuity" subtitle="Seeded programs and their funding status since T0 — has the AI government kept them funded?">
        {data.programContinuity.length > 0 ? (
          <div className="rounded border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-capitol-deep/60">
                  <th className="text-left px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Program</th>
                  <th className="text-right px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Cost / Day</th>
                  <th className="text-right px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.programContinuity.map((p, i) => (
                  <tr key={p.lawId} className={`border-b border-border/40 last:border-0 ${i % 2 === 1 ? 'bg-white/[0.01]' : ''}`}>
                    <td className="px-4 py-2">
                      <Link to={`/laws/${p.lawId}`} className="text-gold hover:underline">{p.name}</Link>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-red-400">−{fmtM(p.perDay)}</td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`badge border text-badge uppercase tracking-widest ${
                          p.status === 'Funded'
                            ? 'text-green-400 bg-green-900/20 border-green-700/30'
                            : p.status === 'Amended'
                              ? 'text-yellow-300 bg-yellow-900/20 border-yellow-700/30'
                              : 'text-red-400 bg-red-900/20 border-red-700/30'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-text-muted py-6 text-center">
            No seeded programs yet — the program continuity table populates once the T0 baseline seed enacts its programs.
          </p>
        )}
      </Section>
    </div>
  );
}
