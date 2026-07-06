import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { governmentApi } from '@core/client/lib/api';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { formatMoney } from '@core/client/lib/formatMoney';
import { trimToCurrentEra, type SeriesPoint } from '../lib/budgetSeries';

/* ── Types (mirror GET /api/government/budget) ─────────────────────────── */

interface ActiveProgram {
  lawId: string;
  name: string;
  perTick: number;
  enactedTick: number | null;
  lastRenewedTick: number | null;
  ticksUntilLapse: number | null;
}

interface TaxChange {
  oldRate: number;
  newRate: number;
  delta: number;
  description: string;
  createdAt: string;
}

interface BudgetData {
  treasuryBalance: number;
  taxRatePercent: number;
  currentTickNumber: number;
  fiscalEffectsEnabled: boolean;
  budgetCycleTicks: number;
  expectedTickRevenue: number;
  gdpAnnual: number;
  population: number;
  payPeriodTicks: number;
  nextPayday: { inTicks: number; estMs: number };
  revenue30d: number;
  spending30d: number;
  series: SeriesPoint[];
  activePrograms: ActiveProgram[];
  nextBudgetSession: { inTicks: number; estMs: number } | null;
  totals: { recurringPerTick: number; capPerTick: number };
  recentTaxChanges: TaxChange[];
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

// Compact by default — the dollar-era treasury and spending values span
// billions and trillions.
const fmtM = (v: number): string => formatMoney(v, { compact: true });

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `~${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 48) return `~${hours}h ${totalMinutes % 60}m`;
  return `~${Math.round(hours / 24)} days`;
}

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

function StatCard({ label, value, sub, valueClass }: { label: string; value: React.ReactNode; sub?: React.ReactNode; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="text-badge text-text-muted uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-mono text-xl font-semibold ${valueClass ?? 'text-gold'}`}>{value}</p>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  );
}

/* ── Treasury line chart (inline SVG, no chart dependency) ─────────────── */

const CHART_W = 720;
const CHART_H = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 64 };

function TreasuryChart({ series }: { series: SeriesPoint[] }) {
  // Callers pass a series already trimmed to the current currency era (see
  // trimToCurrentEra in ../lib/budgetSeries) — the pre-rebase MoltDollar
  // points are dropped upstream so this chart never has to straddle the
  // conversion jump itself.
  const points = series.map((p) => ({ x: p.tickNumber, y: p.treasuryEnd }));
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;

  const xMin = points[0].x;
  const xMax = points[points.length - 1].x;
  const yValues = points.map((p) => p.y);
  let yMin = Math.min(0, ...yValues);
  let yMax = Math.max(...yValues);
  if (yMin === yMax) { yMin -= 1; yMax += 1; } // flat series — avoid /0
  const yPadding = Math.max(1, Math.round((yMax - yMin) * 0.08));
  yMin -= yPadding;
  yMax += yPadding;

  const sx = (x: number) => PAD.left + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW);
  const sy = (y: number) => PAD.top + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const zeroVisible = yMin < 0 && yMax > 0;

  /* 4 horizontal gridlines */
  const gridYs = [0, 1, 2, 3].map((i) => yMin + ((yMax - yMin) * i) / 3);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full min-w-[480px]" role="img" aria-label="Treasury balance over time">
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
        {/* x-axis tick labels: first / last tick number */}
        <text x={sx(xMin)} y={CHART_H - 6} textAnchor="start" className="fill-current text-text-muted" fontSize={10}>Tick {xMin}</text>
        {xMax !== xMin && (
          <text x={sx(xMax)} y={CHART_H - 6} textAnchor="end" className="fill-current text-text-muted" fontSize={10}>Tick {xMax}</text>
        )}
        <path d={path} fill="none" stroke="#B8956A" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx(last.x)} cy={sy(last.y)} r={3} fill="#B8956A" />
      </svg>
    </div>
  );
}

/* ── Revenue vs spending bars ──────────────────────────────────────────── */

// Revenue (~$17.6B/tick) and spending (~$0-300K/tick) sit orders of
// magnitude apart in the dollar-era economy. A linear scale renders spending
// as an invisible 2%-min sliver, so bar heights use sqrt scaling to keep
// small-but-real spending visible relative to revenue. Tooltips still show
// exact values.
function barHeightPct(v: number, maxVal: number): number {
  return Math.max(2, Math.sqrt(v / maxVal) * 100);
}

function RevenueSpendingBars({ series }: { series: SeriesPoint[] }) {
  const recent = series.slice(-40);
  const maxVal = Math.max(1, ...recent.map((p) => Math.max(p.revenue, p.spending)));

  return (
    <div>
      <div className="flex items-end gap-[3px] h-32" role="img" aria-label="Revenue versus spending per day">
        {recent.map((p) => (
          <div key={p.tickNumber} className="flex-1 flex items-end gap-px min-w-[6px]" title={`Tick ${p.tickNumber}: revenue ${fmtM(p.revenue)}, spending ${fmtM(p.spending)}`}>
            <div
              className="flex-1 bg-green-500/70 rounded-t-sm"
              style={{ height: `${barHeightPct(p.revenue, maxVal)}%` }}
            />
            <div
              className="flex-1 bg-red-500/70 rounded-t-sm"
              style={{ height: `${barHeightPct(p.spending, maxVal)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500/70" aria-hidden="true" /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500/70" aria-hidden="true" /> Spending
        </span>
        <span>(square-root scale — hover a bar for exact values)</span>
        <span className="ml-auto">Last {recent.length} tick{recent.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function BudgetPage() {
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { subscribe } = useWebSocket();

  const fetchBudget = useCallback(() => {
    governmentApi.budget()
      .then((res) => {
        if (res.data) setData(res.data as BudgetData);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchBudget(); }, [fetchBudget]);

  /* Live refresh: each tick writes a summary row; fiscal events move money */
  useEffect(() => {
    const unsubs = [
      subscribe('tick:complete', fetchBudget),
      subscribe('treasury:appropriation', fetchBudget),
      subscribe('treasury:tax_rate_changed', fetchBudget),
      subscribe('budget:session', fetchBudget),
      subscribe('law:sunset', fetchBudget),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchBudget]);

  const netPerTick = useMemo(() => {
    if (!data) return 0;
    return data.expectedTickRevenue - data.totals.recurringPerTick;
  }, [data]);

  // Trim the pre-rebase (old-currency) prefix once, shared by both charts.
  const currentEraSeries = useMemo(() => {
    if (!data) return [];
    return trimToCurrentEra(data.series);
  }, [data]);

  if (loading) {
    return <div className="max-w-6xl mx-auto px-6 py-20 text-center text-text-muted text-sm">Loading...</div>;
  }
  if (error || !data) {
    return <div className="max-w-6xl mx-auto px-6 py-20 text-center text-danger text-sm">Budget data unavailable.</div>;
  }

  const capUsedPct = data.totals.capPerTick > 0
    ? Math.min(100, Math.round((data.totals.recurringPerTick / data.totals.capPerTick) * 100))
    : 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-stone">The Budget</h1>
        <p className="text-sm text-text-muted mt-1">
          Treasury, spending programs, and the budget cycle — where enacted laws meet real dollars.
        </p>
      </div>

      {!data.fiscalEffectsEnabled && (
        <div className="rounded border border-yellow-700/30 bg-yellow-900/10 px-4 py-2.5 text-sm text-yellow-300">
          Fiscal effects are currently disabled — bills still store provisions, but no money moves and no programs lapse.
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Treasury"
          value={fmtM(data.treasuryBalance)}
          valueClass={data.treasuryBalance < 0 ? 'text-red-400' : 'text-gold'}
          sub={data.treasuryBalance < 0 ? 'In deficit — program debits continue to the hard floor' : undefined}
        />
        <StatCard
          label="Daily Revenue"
          value={`${fmtM(data.expectedTickRevenue)}/day`}
          sub={`Citizen tax base: ${fmtM(data.gdpAnnual)} GDP at ${data.taxRatePercent}%`}
        />
        <StatCard
          label="Tax Rate"
          value={`${data.taxRatePercent}%`}
          sub={`Population: ${data.population.toLocaleString()}`}
        />
        <StatCard
          label="Program Spend"
          value={`${fmtM(data.totals.recurringPerTick)}/day`}
          valueClass={netPerTick < 0 ? 'text-red-400' : 'text-gold'}
          sub={`${capUsedPct}% of the ${fmtM(data.totals.capPerTick)}/day cap`}
        />
        <StatCard
          label="Next Payday"
          value={data.nextPayday.inTicks === 0 ? 'This tick' : `${data.nextPayday.inTicks} day${data.nextPayday.inTicks !== 1 ? 's' : ''}`}
          sub={`Paychecks every ${data.payPeriodTicks} days${data.nextPayday.inTicks > 0 ? ` — ${fmtDuration(data.nextPayday.estMs)}` : ''}`}
        />
        <StatCard
          label="Next Budget Session"
          value={data.nextBudgetSession ? `${data.nextBudgetSession.inTicks} tick${data.nextBudgetSession.inTicks !== 1 ? 's' : ''}` : '—'}
          sub={data.nextBudgetSession ? `${fmtDuration(data.nextBudgetSession.estMs)} — programs past one cycle lapse unless renewed` : undefined}
        />
      </div>

      {/* Treasury over time */}
      <Section title="Treasury Over Time" subtitle="End-of-tick treasury balance from the fiscal ledger">
        {currentEraSeries.length >= 2 ? (
          <TreasuryChart series={currentEraSeries} />
        ) : (
          <p className="text-sm text-text-muted py-6 text-center">
            Not enough fiscal data yet — a summary row is written at the end of every tick. Check back after a couple of ticks.
          </p>
        )}
      </Section>

      {/* Revenue vs spending */}
      <Section title="Revenue vs Spending" subtitle="Daily tax revenue against government spending (paychecks + programs + one-time appropriations)">
        {currentEraSeries.length > 0 ? (
          <RevenueSpendingBars series={currentEraSeries} />
        ) : (
          <p className="text-sm text-text-muted py-6 text-center">No fiscal data yet.</p>
        )}
      </Section>

      {/* Active programs */}
      <Section title="Active Spending Programs" subtitle="Recurring appropriations debit the treasury every tick until they lapse or sunset">
        {data.activePrograms.length > 0 ? (
          <div className="rounded border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-capitol-deep/60">
                  <th className="text-left px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Program</th>
                  <th className="text-right px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Cost / Day</th>
                  <th className="text-right px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider hidden sm:table-cell">Enacted</th>
                  <th className="text-right px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Funding Due</th>
                </tr>
              </thead>
              <tbody>
                {data.activePrograms.map((p, i) => (
                  <tr key={p.lawId} className={`border-b border-border/40 last:border-0 ${i % 2 === 1 ? 'bg-white/[0.01]' : ''}`}>
                    <td className="px-4 py-2">
                      <Link to={`/laws/${p.lawId}`} className="text-gold hover:underline">{p.name}</Link>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-red-400">−{fmtM(p.perTick)}</td>
                    <td className="px-4 py-2 text-right text-text-muted hidden sm:table-cell">
                      {p.enactedTick !== null ? `Tick ${p.enactedTick}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {p.ticksUntilLapse === null ? (
                        <span className="text-text-muted">—</span>
                      ) : p.ticksUntilLapse === 0 ? (
                        <span className="badge border text-badge uppercase tracking-widest text-red-400 bg-red-900/20 border-red-700/30">Lapses next session</span>
                      ) : (
                        <span className={p.ticksUntilLapse <= Math.ceil(data.budgetCycleTicks / 4) ? 'text-yellow-300' : 'text-text-secondary'}>
                          {p.ticksUntilLapse} tick{p.ticksUntilLapse !== 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-text-muted py-6 text-center">
            No active spending programs. When a bill with a recurring appropriation is enacted, its program appears here.
          </p>
        )}
        {data.activePrograms.length > 0 && (
          <p className="text-xs text-text-muted">
            Total: {fmtM(data.totals.recurringPerTick)}/day of a {fmtM(data.totals.capPerTick)}/day cap.
            Programs older than one budget cycle ({data.budgetCycleTicks} ticks) lapse at the next session unless renewed by an amendment bill.
          </p>
        )}
      </Section>

      {/* Recent tax changes — only when there are any */}
      {data.recentTaxChanges.length > 0 && (
        <Section title="Recent Tax Changes" subtitle="Revenue laws are the only non-admin path that moves the tax rate">
          <div className="space-y-2">
            {data.recentTaxChanges.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-1.5 border-b border-border/30 last:border-0 text-sm">
                <span className="text-text-secondary">{c.description}</span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className={`font-mono ${c.delta > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {c.oldRate}% → {c.newRate}%
                  </span>
                  <span className="text-xs text-text-muted">{fmtDate(c.createdAt)}</span>
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
