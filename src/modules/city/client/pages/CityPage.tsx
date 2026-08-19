import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cityApi } from '@core/client/lib/api';

/* Capitol City spectator page (city-effect-layer slice 3). Read-only, public.
   Engine CODE never reaches this bundle (GPL wall, see engine/PROVENANCE.md);
   the server sends category codes plus masked tile ids as plain data, and the
   tile-art sheet is a static asset with attribution beside it in
   public/images/MICROPOLIS-TILES-ATTRIBUTION.md. */

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
  map?: { width: number; height: number; categories: string; tiles?: string };
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

/* Legend keeps to what a fresh city actually shows, plus disaster colors. */
const LEGEND_CODES = [10, 11, 12, 7, 8, 9, 15, 16, 17, 1, 2, 0, 6, 5];

function decodeCategories(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* Server wire contract: base64 of little-endian uint16 masked tile ids. */
function decodeTileIds(b64: string): Uint16Array {
  const bin = atob(b64);
  const out = new Uint16Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
  }
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

/* ── Sprite sheet + zoom/pan viewport ───────────────────────────────────── */

const TILE_PX = 16;
const SHEET_COLS = 32;
const TILE_SHEET_URL = '/images/micropolis-tiles.png';
const MIN_SCALE = 0.25;
const MAX_SCALE = 6;
const FIT_MARGIN_TILES = 3;

function useTileSheet(enabled: boolean): HTMLImageElement | null {
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setSheet(img);
    };
    img.src = TILE_SHEET_URL; // load failure leaves sheet null = fallback mode
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return sheet;
}

export interface CityMapHandle {
  zoomIn(): void;
  zoomOut(): void;
  fitCity(): void;
  fullMap(): void;
}

interface CityMapViewportProps {
  width: number;
  height: number;
  tileIds: Uint16Array | null;
  categories: Uint8Array;
  sheet: HTMLImageElement | null;
}

/* Offscreen canvas holds the full city at 16px/tile (sprite blit when tile
   ids + sheet are available, flat category colors otherwise); the visible
   canvas draws it through a pan/zoom transform. View state lives in refs so
   drags/zooms never re-render React. */
const CityMapViewport = forwardRef<CityMapHandle, CityMapViewportProps>(
  function CityMapViewport({ width, height, tileIds, categories, sheet }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const offscreenRef = useRef<HTMLCanvasElement | null>(null);
    const viewRef = useRef({ scale: 1, x: 0, y: 0 });
    const fittedRef = useRef(false);
    const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      const off = offscreenRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !off || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      const v = viewRef.current;
      ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.x, dpr * v.y);
      ctx.drawImage(off, 0, 0);
    }, []);

    const fitTiles = useCallback(
      (tx0: number, ty0: number, tx1: number, ty1: number) => {
        const c = containerRef.current;
        if (!c || !c.clientWidth || !c.clientHeight) return;
        const wpx = (tx1 - tx0 + 1) * TILE_PX;
        const hpx = (ty1 - ty0 + 1) * TILE_PX;
        const scale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, Math.min(c.clientWidth / wpx, c.clientHeight / hpx)),
        );
        viewRef.current = {
          scale,
          x: (c.clientWidth - wpx * scale) / 2 - tx0 * TILE_PX * scale,
          y: (c.clientHeight - hpx * scale) / 2 - ty0 * TILE_PX * scale,
        };
        draw();
      },
      [draw],
    );

    const fitCity = useCallback(() => {
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let i = 0; i < categories.length; i++) {
        if (categories[i] <= 2) continue; // clear/water/trees = not built
        const x = i % width;
        const y = (i / width) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (maxX < 0) {
        fitTiles(0, 0, width - 1, height - 1);
        return;
      }
      fitTiles(
        minX - FIT_MARGIN_TILES,
        minY - FIT_MARGIN_TILES,
        maxX + FIT_MARGIN_TILES,
        maxY + FIT_MARGIN_TILES,
      );
    }, [categories, width, height, fitTiles]);

    /* Keep at least ~100px of the map inside the viewport on each axis so a
       pan/zoom can never strand it off-screen. */
    const clampView = useCallback(
      (v: { scale: number; x: number; y: number }) => {
        const c = containerRef.current;
        if (!c) return v;
        const mapW = width * TILE_PX * v.scale;
        const mapH = height * TILE_PX * v.scale;
        const keepX = Math.min(100, mapW, c.clientWidth);
        const keepY = Math.min(100, mapH, c.clientHeight);
        return {
          scale: v.scale,
          x: Math.min(Math.max(v.x, keepX - mapW), c.clientWidth - keepX),
          y: Math.min(Math.max(v.y, keepY - mapH), c.clientHeight - keepY),
        };
      },
      [width, height],
    );

    const zoomAt = useCallback(
      (cx: number, cy: number, factor: number) => {
        const v = viewRef.current;
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const k = scale / v.scale;
        viewRef.current = clampView({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
        draw();
      },
      [draw, clampView],
    );

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => {
          const c = containerRef.current;
          if (c) zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1.5);
        },
        zoomOut: () => {
          const c = containerRef.current;
          if (c) zoomAt(c.clientWidth / 2, c.clientHeight / 2, 1 / 1.5);
        },
        fitCity,
        fullMap: () => fitTiles(0, 0, width - 1, height - 1),
      }),
      [zoomAt, fitCity, fitTiles, width, height],
    );

    /* Redraw the offscreen city when data or the sheet arrives; the user's
       view is preserved (fit happens only once, on first render). */
    useEffect(() => {
      let off = offscreenRef.current;
      if (!off) {
        off = document.createElement('canvas');
        offscreenRef.current = off;
      }
      off.width = width * TILE_PX;
      off.height = height * TILE_PX;
      const ctx = off.getContext('2d');
      if (!ctx) return;
      const n = width * height;
      if (tileIds && sheet) {
        const count = Math.min(tileIds.length, n);
        for (let i = 0; i < count; i++) {
          const id = tileIds[i];
          ctx.drawImage(
            sheet,
            (id % SHEET_COLS) * TILE_PX,
            ((id / SHEET_COLS) | 0) * TILE_PX,
            TILE_PX,
            TILE_PX,
            (i % width) * TILE_PX,
            ((i / width) | 0) * TILE_PX,
            TILE_PX,
            TILE_PX,
          );
        }
      } else {
        const count = Math.min(categories.length, n);
        for (let i = 0; i < count; i++) {
          ctx.fillStyle = (PALETTE[categories[i]] ?? PALETTE[0]).hex;
          ctx.fillRect((i % width) * TILE_PX, ((i / width) | 0) * TILE_PX, TILE_PX, TILE_PX);
        }
      }
      if (!fittedRef.current && containerRef.current?.clientWidth) {
        fittedRef.current = true;
        fitCity();
      } else {
        draw();
      }
    }, [width, height, tileIds, categories, sheet, fitCity, draw]);

    useEffect(() => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(container.clientWidth * dpr));
        canvas.height = Math.max(1, Math.round(container.clientHeight * dpr));
        if (!fittedRef.current && offscreenRef.current) {
          fittedRef.current = true;
          fitCity();
        } else {
          draw();
        }
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(container);
      return () => ro.disconnect();
    }, [fitCity, draw]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        /* deltaMode: Firefox reports lines (1), not pixels (0). */
        const deltaPx = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-deltaPx * 0.0015));
      };
      /* React attaches onWheel passively — preventDefault (to stop page
         scroll) needs a native non-passive listener. */
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    }, [zoomAt]);

    const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      e.currentTarget.style.cursor = 'grabbing';
    };
    const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const v = viewRef.current;
      viewRef.current = clampView({ ...v, x: v.x + (e.clientX - drag.x), y: v.y + (e.clientY - drag.y) });
      drag.x = e.clientX;
      drag.y = e.clientY;
      draw();
    };
    const endDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (dragRef.current?.pointerId !== e.pointerId) return;
      dragRef.current = null;
      e.currentTarget.style.cursor = 'grab';
    };

    return (
      <div
        ref={containerRef}
        className="relative h-[65vh] overflow-hidden rounded border border-border/60 bg-black/40"
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-grab"
          style={{ imageRendering: 'pixelated', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="img"
          aria-label="Capitol City map"
        />
      </div>
    );
  },
);

/* ── Small presentational pieces ────────────────────────────────────────── */

function MapButton({ onClick, label, children }: { onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded border border-border/60 bg-black/20 px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:border-border transition-colors"
    >
      {children}
    </button>
  );
}

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

function TileArtCredit() {
  return (
    <p className="text-[11px] text-text-muted">
      Tile artwork from the Micropolis project (
      <a
        href="https://github.com/graememcc/micropolisJS"
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-dotted hover:text-text-secondary"
      >
        micropolisJS
      </a>
      ), GPL-3.0.
    </p>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

const POLL_INTERVAL_MS = 60_000;

export function CityPage() {
  const [data, setData] = useState<CityStateData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<CityMapHandle>(null);

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

  const tileIds = useMemo(
    () => (data?.map?.tiles ? decodeTileIds(data.map.tiles) : null),
    [data?.map],
  );

  const sheet = useTileSheet(!!data?.map?.tiles);
  const spriteMode = tileIds !== null && sheet !== null;

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

      {/* Full error state only before any data exists; once the map is up, a
          failed poll keeps it mounted (stale) so the user's view survives. */}
      {!loading && error && !data && (
        <div className="rounded-lg border border-red-700/30 bg-red-900/10 px-5 py-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && data && !data.started && (
        <div className="rounded-lg border border-border bg-surface px-6 py-16 text-center space-y-2">
          <h2 className="font-serif text-xl font-semibold text-stone">The city has not been founded yet</h2>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            When the simulation&apos;s city layer comes online, Capitol City will appear here — built up
            tick by tick under the government&apos;s policies.
          </p>
        </div>
      )}

      {!loading && data?.started && data.map && categories && stats && (
        <>
          <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="font-serif text-lg font-semibold text-stone">City Map</h2>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <MapButton onClick={() => mapRef.current?.zoomIn()} label="Zoom in">+</MapButton>
                  <MapButton onClick={() => mapRef.current?.zoomOut()} label="Zoom out">−</MapButton>
                  <MapButton onClick={() => mapRef.current?.fitCity()} label="Fit city">Fit city</MapButton>
                  <MapButton onClick={() => mapRef.current?.fullMap()} label="Full map">Full map</MapButton>
                </div>
                <span className="text-xs text-text-muted tabular-nums">
                  {fmtCityTime(data.cityTimeMonths ?? 0)} · gov tick {data.tickNumber}
                </span>
                {error && (
                  <span className="text-xs text-red-300/80">live update failed — retrying</span>
                )}
              </div>
            </div>
            <CityMapViewport
              ref={mapRef}
              width={data.map.width}
              height={data.map.height}
              tileIds={tileIds}
              categories={categories}
              sheet={sheet}
            />
            {spriteMode ? <TileArtCredit /> : <Legend />}
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
