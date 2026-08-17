import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cityApi } from '@core/client/lib/api';

/* Capitol City spectator page (city-effect-layer slice 3). Read-only, public.
   The server sends category codes only — no engine code or raw tile ids ever
   reach this bundle; the canvas renderer below is written from scratch. */

/* ── Types (client-local mirrors of the /api/city/state payload) ────────── */

interface CityStatsView {
  population: number;
  cityClass: string;
  cityScore: number;
  funds: number;
  taxRate: number;
  resValve: number;
  comValve: number;
  indValve: number;
  crimeAverage: number;
  pollutionAverage: number;
  landValueAverage: number;
}

interface CityDelta {
  population: number;
  funds: number;
  score: number;
  crime: number;
  pollution: number;
}

interface CityStateData {
  started: boolean;
  tickNumber?: number;
  cityTimeMonths?: number;
  updatedAt?: string;
  map?: { width: number; height: number; categories: string };
  stats?: CityStatsView;
  delta?: CityDelta | null;
}

/* ── Palette: index = server category code 0-20 ─────────────────────────── */

const PALETTE: Array<{ hex: string; label: string }> = [
  { hex: '#7a6a4f', label: 'Open land' },        // 0 clear/dirt
  { hex: '#1e4e79', label: 'Water' },            // 1
  { hex: '#1f5d33', label: 'Trees & parks' },    // 2
  { hex: '#6b6258', label: 'Rubble' },           // 3
  { hex: '#4f83b5', label: 'Flooding' },         // 4
  { hex: '#9acd32', label: 'Radiation' },        // 5
  { hex: '#f97316', label: 'Fire' },             // 6
  { hex: '#33363b', label: 'Roads' },            // 7
  { hex: '#7c5a3a', label: 'Rail' },             // 8
  { hex: '#e7d97f', label: 'Power lines' },      // 9
  { hex: '#63b563', label: 'Residential' },      // 10
  { hex: '#5b7fd4', label: 'Commercial' },       // 11
  { hex: '#c9a53a', label: 'Industrial' },       // 12
  { hex: '#3b8ea5', label: 'Seaport' },          // 13
  { hex: '#9aa0a8', label: 'Airport' },          // 14
  { hex: '#57534e', label: 'Coal plant' },       // 15
  { hex: '#dc2626', label: 'Fire station' },     // 16
  { hex: '#3730a3', label: 'Police station' },   // 17
  { hex: '#a855f7', label: 'Stadium' },          // 18
  { hex: '#22d3ee', label: 'Nuclear plant' },    // 19
  { hex: '#a78bba', label: 'Civic buildings' },  // 20 other-special
];

const PALETTE_RGB: Array<[number, number, number]> = PALETTE.map(({ hex }) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

/* Legend keeps to what a fresh city actually shows, plus disaster colors. */
const LEGEND_CODES = [10, 11, 12, 7, 8, 9, 15, 16, 17, 1, 2, 0, 6, 5];

function decodeCategories(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── Formatting helpers ─────────────────────────────────────────────────── */

function fmtMoney(n: number): string {
  return n < 0 ? `−$${Math.abs(n).toLocaleString()}` : `$${n.toLocaleString()}`;
}

function fmtSigned(n: number): string {
  return n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `−${Math.abs(n).toLocaleString()}` : '±0';
}

function fmtSignedMoney(n: number): string {
  return n > 0 ? `+$${n.toLocaleString()}` : n < 0 ? `−$${Math.abs(n).toLocaleString()}` : '±$0';
}

function trendWord(label: string, n: number): string {
  return n > 0 ? `${label} up` : n < 0 ? `${label} down` : `${label} steady`;
}

function fmtCityTime(months: number): string {
  return `Year ${Math.floor(months / 12) + 1}, Month ${(months % 12) + 1}`;
}

function buildDeltaLine(d: CityDelta): string {
  return [
    `Population ${fmtSigned(d.population)}`,
    `Funds ${fmtSignedMoney(d.funds)}`,
    `Score ${fmtSigned(d.score)}`,
    trendWord('Crime', d.crime),
    trendWord('Pollution', d.pollution),
  ].join(' · ');
}

/* ── Canvas renderer: 1px per tile, CSS-scaled with pixelated upsampling ── */

function CityCanvas({ width, height, categories }: { width: number; height: number; categories: Uint8Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return; // non-browser environments (tests) render the element only
    const img = ctx.createImageData(width, height);
    const n = Math.min(categories.length, width * height);
    for (let i = 0; i < n; i++) {
      const [r, g, b] = PALETTE_RGB[categories[i]] ?? PALETTE_RGB[0];
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [width, height, categories]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full h-auto rounded border border-border/60 bg-black/40"
      style={{ imageRendering: 'pixelated' }}
      role="img"
      aria-label="Capitol City map"
    />
  );
}

/* ── Small presentational pieces ────────────────────────────────────────── */

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded border border-border/60 bg-black/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-text-muted">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${accent ?? 'text-text-primary'}`}>{value}</p>
    </div>
  );
}

function ValveStat({ label, value, range }: { label: string; value: number; range: number }) {
  const color = value > 0 ? 'text-green-300' : value < 0 ? 'text-red-300' : 'text-text-muted';
  const barColor = value > 0 ? 'bg-green-400/70' : 'bg-red-400/70';
  const frac = Math.min(1, Math.abs(value) / range);
  return (
    <div className="rounded border border-border/60 bg-black/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-text-muted">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${color}`}>{fmtSigned(value)}</p>
      <div className="mt-1 h-1 rounded bg-white/[0.06] relative overflow-hidden" aria-hidden="true">
        {value !== 0 && (
          <div
            className={`absolute top-0 h-full ${barColor}`}
            style={
              value > 0
                ? { left: '50%', width: `${(frac * 50).toFixed(1)}%` }
                : { right: '50%', width: `${(frac * 50).toFixed(1)}%` }
            }
          />
        )}
        <div className="absolute top-0 left-1/2 w-px h-full bg-white/20" />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {LEGEND_CODES.map((code) => (
        <span key={code} className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
          <span
            className="inline-block w-2.5 h-2.5 rounded-[2px] border border-black/30"
            style={{ backgroundColor: PALETTE[code].hex }}
            aria-hidden="true"
          />
          {PALETTE[code].label}
        </span>
      ))}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

const POLL_INTERVAL_MS = 60_000;

export function CityPage() {
  const [data, setData] = useState<CityStateData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = (await cityApi.state()) as { data?: CityStateData };
      if (res.data) setData(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load city state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(); }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const categories = useMemo(
    () => (data?.map ? decodeCategories(data.map.categories) : null),
    [data?.map],
  );

  const stats = data?.stats;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="rounded-lg border border-border bg-surface px-6 py-5">
        <h1 className="font-serif text-2xl font-semibold text-text-primary">Capitol City</h1>
        <p className="text-sm text-text-muted mt-1">
          One representative city living downstream of the AI government — its taxes, budgets, and
          economy made visible. The city renders consequences; nothing here feeds back into the simulation.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24 text-text-muted text-sm">
          Loading city…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-700/30 bg-red-900/10 px-5 py-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && data && !data.started && (
        <div className="rounded-lg border border-border bg-surface px-6 py-16 text-center space-y-2">
          <h2 className="font-serif text-xl font-semibold text-stone">The city has not been founded yet</h2>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            When the simulation&apos;s city layer comes online, Capitol City will appear here — built up
            tick by tick under the government&apos;s policies.
          </p>
        </div>
      )}

      {!loading && !error && data?.started && data.map && categories && stats && (
        <>
          <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="font-serif text-lg font-semibold text-stone">City Map</h2>
              <span className="text-xs text-text-muted tabular-nums">
                {fmtCityTime(data.cityTimeMonths ?? 0)} · gov tick {data.tickNumber}
              </span>
            </div>
            <CityCanvas width={data.map.width} height={data.map.height} categories={categories} />
            <Legend />
          </div>

          {data.delta && (
            <div className="rounded-lg border border-border bg-surface px-5 py-3">
              <p className="text-sm text-text-secondary tabular-nums">
                <span className="text-[10px] uppercase tracking-widest text-gold mr-3">This tick</span>
                {buildDeltaLine(data.delta)}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
            <h2 className="font-serif text-lg font-semibold text-stone">Vital Statistics</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <Stat label="Population" value={stats.population.toLocaleString()} />
              <Stat label="City class" value={stats.cityClass} />
              <Stat label="Treasury" value={fmtMoney(stats.funds)} accent="text-gold" />
              <Stat label="City score" value={String(stats.cityScore)} />
              <ValveStat label="Residential demand" value={stats.resValve} range={2000} />
              <ValveStat label="Commercial demand" value={stats.comValve} range={1500} />
              <ValveStat label="Industrial demand" value={stats.indValve} range={1500} />
              <Stat label="City tax" value={`${stats.taxRate}%`} />
              <Stat label="Crime" value={stats.crimeAverage.toFixed(0)} />
              <Stat label="Pollution" value={stats.pollutionAverage.toFixed(0)} />
              <Stat label="Land value" value={stats.landValueAverage.toFixed(0)} />
              <Stat label="City time" value={fmtCityTime(data.cityTimeMonths ?? 0)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
