// File: src/modules/government/client/pages/CapitolMapPage.tsx
// Purpose: Interactive living map of the Capitol District.
// Click a building to enter its interior view (/capitol-map/:buildingId).

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGroup } from 'framer-motion';
import { useAgentMap } from '@core/client/hooks/useAgentMap';
import { BuildingPulseRing } from '../components/map/BuildingPulseRing';
import { AgentDrawer } from '../components/map/AgentDrawer';
import { MapEventTicker } from '../components/map/MapEventTicker';
import { BUILDINGS } from '@core/client/lib/buildings';
import type { Agent } from '@shared/types';

const MAP_WIDTH = 1920;
const MAP_HEIGHT = 1080;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;

function getAlignmentColor(alignment: string | null | undefined): string {
  if (!alignment) return '#B8956A';
  const a = alignment.toLowerCase();
  if (a.includes('progress') || a.includes('liberal') || a.includes('tech') || a.includes('digital')) return '#6B7A8D';
  if (a.includes('conserv') || a.includes('right') || a.includes('nation') || a.includes('auth')) return '#8B3A3A';
  if (a.includes('labor') || a.includes('union') || a.includes('social') || a.includes('green')) return '#3A6B3A';
  return '#B8956A';
}

export function CapitolMapPage() {
  const navigate = useNavigate();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Map zoom/pan state
  // Compute initial zoom from window dimensions so the first render is already correct —
  // prevents the visible jump that occurs when ResizeObserver fires after mount.
  const computeInitialMinZoom = () =>
    Math.max(window.innerWidth / MAP_WIDTH, window.innerHeight / MAP_HEIGHT);
  const [zoom, setZoom] = useState(computeInitialMinZoom);
  const zoomRef = useRef(computeInitialMinZoom());
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragMoved = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [minZoom, setMinZoom] = useState(computeInitialMinZoom);
  const minZoomRef = useRef(computeInitialMinZoom());

  const {
    agents,
    agentLocations,
    buildingPulses,
    tickerEvents,
    selectedAgent,
    setSelectedAgent,
    isLoading,
  } = useAgentMap();

  const agentsByBuilding = agents.reduce<Record<string, Agent[]>>((acc, agent) => {
    const buildingId = agentLocations[agent.id] ?? 'party-hall';
    if (!acc[buildingId]) acc[buildingId] = [];
    acc[buildingId].push(agent);
    return acc;
  }, {});

  // ── Pan clamping helper ─────────────────────────────────────────────────────
  const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return p;
    const { width, height } = viewport.getBoundingClientRect();
    const scaledW = MAP_WIDTH * z;
    const scaledH = MAP_HEIGHT * z;
    const maxX = Math.max(0, (scaledW - width) / 2);
    const maxY = Math.max(0, (scaledH - height) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    };
  }, []);

  // ── Dynamic minimum zoom — fills viewport, no dead space ───────────────────
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const computed = Math.max(width / MAP_WIDTH, height / MAP_HEIGHT);
      setMinZoom(computed);
      minZoomRef.current = computed;
      // Re-clamp current zoom and pan to new bounds
      setZoom((prev) => {
        const clamped = Math.max(computed, prev);
        zoomRef.current = clamped;
        setPan((p) => clampPan(p, clamped));
        return clamped;
      });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [clampPan]);

  // ── Zoom toward cursor ──────────────────────────────────────────────────────
  const applyZoom = useCallback((newZoom: number, originX: number, originY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const clamped = Math.min(ZOOM_MAX, Math.max(minZoomRef.current, newZoom));
    const rect = viewport.getBoundingClientRect();
    // Mouse position relative to viewport center
    const cx = originX - rect.left - rect.width / 2;
    const cy = originY - rect.top - rect.height / 2;

    setZoom((prev) => {
      const scale = clamped / prev;
      setPan((p) => clampPan({
        x: cx - (cx - p.x) * scale,
        y: cy - (cy - p.y) * scale,
      }, clamped));
      zoomRef.current = clamped;
      return clamped;
    });
  }, [clampPan]);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
      setZoom((prev) => {
        const newZoom = Math.min(ZOOM_MAX, Math.max(minZoomRef.current, prev * delta));
        const viewport = viewportRef.current;
        if (!viewport) {
          zoomRef.current = newZoom;
          return newZoom;
        }
        const rect = viewport.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const scale = newZoom / prev;
        setPan((p) => clampPan({
          x: cx - (cx - p.x) * scale,
          y: cy - (cy - p.y) * scale,
        }, newZoom));
        zoomRef.current = newZoom;
        return newZoom;
      });
    },
    [clampPan],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Pan via drag ────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragMoved.current = false;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setPan((p) => clampPan({ x: p.x + dx, y: p.y + dy }, zoomRef.current));
  }, [clampPan]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // ── Alignment debug mode ────────────────────────────────────────────────────
  const [debugAlign, setDebugAlign] = useState(false);

  // ── Zoom controls (HUD buttons) ─────────────────────────────────────────────
  const zoomIn = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    applyZoom(zoom + ZOOM_STEP * 2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  const zoomOut = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    applyZoom(zoom - ZOOM_STEP * 2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  const zoomReset = () => {
    zoomRef.current = minZoomRef.current;
    setZoom(minZoomRef.current);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">

      {/* ── MAP VIEWPORT ── clips the world, handles input ── */}
      <div
        ref={viewportRef}
        className="flex-1 relative overflow-hidden select-none"
        style={{
          backgroundColor: '#1A1B1E',
          cursor: isDragging.current ? 'grabbing' : 'grab',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >

        {/* ── MAP WORLD ── everything inside scales together ── */}
        <div
          style={{
            position: 'absolute',
            width: `${MAP_WIDTH}px`,
            height: `${MAP_HEIGHT}px`,
            left: `calc(50% - ${MAP_WIDTH / 2}px)`,
            top: `calc(50% - ${MAP_HEIGHT / 2}px)`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            willChange: 'transform',
          }}
        >
          {/* Background image — objectFit fill so % positions align perfectly */}
          <img
            src="/images/map-backgrounds/capitol-map-v1.webp"
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              display: 'block',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />

          {/* ── Alignment debug overlay — toggle with button in HUD ── */}
          {debugAlign && (
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 50 }}>
              {/* Percentage grid — every 10% */}
              {[10,20,30,40,50,60,70,80,90].map((pct) => (
                <div key={`h${pct}`}>
                  <div style={{ position:'absolute', top:`${pct}%`, left:0, right:0, height:1, background:'rgba(255,100,100,0.35)' }} />
                  <span style={{ position:'absolute', top:`${pct}%`, left:2, fontSize:'0.5rem', color:'rgba(255,100,100,0.9)', fontFamily:'monospace', lineHeight:1 }}>{pct}%</span>
                </div>
              ))}
              {[10,20,30,40,50,60,70,80,90].map((pct) => (
                <div key={`v${pct}`}>
                  <div style={{ position:'absolute', left:`${pct}%`, top:0, bottom:0, width:1, background:'rgba(255,100,100,0.35)' }} />
                  <span style={{ position:'absolute', left:`${pct}%`, top:2, fontSize:'0.5rem', color:'rgba(255,100,100,0.9)', fontFamily:'monospace', lineHeight:1, paddingLeft:2 }}>{pct}%</span>
                </div>
              ))}
              {/* Building footprint highlights */}
              {BUILDINGS.map((b) => (
                <div
                  key={b.id}
                  style={{
                    position:'absolute',
                    left:`${b.x}%`, top:`${b.y}%`,
                    width:`${b.width}%`, height:`${b.height}%`,
                    border:'2px solid rgba(255,220,0,0.9)',
                    background:'rgba(255,220,0,0.08)',
                    boxSizing:'border-box',
                  }}
                >
                  <span style={{ position:'absolute', top:2, left:3, fontSize:'0.48rem', color:'rgba(255,220,0,1)', fontFamily:'monospace', whiteSpace:'nowrap', textShadow:'0 1px 3px black' }}>
                    {b.id} x:{b.x} y:{b.y} w:{b.width} h:{b.height}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── Buildings ── */}
          <LayoutGroup>
            {BUILDINGS.map((building) => {
              const occupants = agentsByBuilding[building.id] ?? [];
              const pulse = buildingPulses.find((p) => p.buildingId === building.id);
              const isHovered = hoveredId === building.id;

              return (
                <div
                  key={building.id}
                  className="absolute"
                  style={{
                    left: `${building.x}%`,
                    top: `${building.y}%`,
                    width: `${building.width}%`,
                    height: `${building.height}%`,
                    zIndex: isHovered ? 10 : 1,
                  }}
                >
                  {/* Occupant roster — floats above the building */}
                  {occupants.length > 0 && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 flex flex-wrap justify-center gap-[2px] pointer-events-auto z-20"
                      style={{ bottom: '100%', marginBottom: 3, maxWidth: 140 }}
                    >
                      {occupants.slice(0, 8).map((agent) => {
                        const initials = agent.displayName
                          .split(' ')
                          .map((w: string) => w[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase();
                        const color = getAlignmentColor(agent.alignment ?? undefined);
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            title={agent.displayName}
                            onClick={(e) => { e.stopPropagation(); setSelectedAgent(agent); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="group relative flex-shrink-0 rounded-full flex items-center justify-center font-bold cursor-pointer transition-transform hover:scale-110"
                            style={{
                              width: 20,
                              height: 20,
                              fontSize: '0.42rem',
                              background: `${color}33`,
                              border: `1px solid ${color}99`,
                              color,
                            }}
                          >
                            {initials}
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-capitol-elevated border border-border rounded text-[0.55rem] text-text-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                              {agent.displayName}
                            </span>
                          </button>
                        );
                      })}
                      {occupants.length > 8 && (
                        <div
                          className="flex-shrink-0 rounded-full flex items-center justify-center font-mono"
                          style={{
                            width: 20,
                            height: 20,
                            fontSize: '0.38rem',
                            background: 'rgba(201,185,155,0.12)',
                            border: '1px solid rgba(201,185,155,0.3)',
                            color: '#9B9D9F',
                          }}
                        >
                          +{occupants.length - 8}
                        </div>
                      )}
                    </div>
                  )}

                  {/* The actual building button */}
                  <button
                    className="absolute inset-0 rounded flex flex-col items-center justify-center text-center"
                    style={{
                      background: `linear-gradient(160deg, ${building.color}1E 0%, ${building.color}09 100%)`,
                      border: `1px solid ${building.color}${isHovered ? '72' : '3E'}`,
                      boxShadow: isHovered
                        ? `0 6px 28px rgba(0,0,0,0.8), 0 0 20px ${building.color}20, inset 0 1px 0 ${building.color}28`
                        : `0 3px 14px rgba(0,0,0,0.6), inset 0 1px 0 ${building.color}16`,
                      transform: isHovered ? 'scale(1.04)' : 'scale(1)',
                      transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      if (!dragMoved.current) navigate(`/capitol-map/${building.id}`);
                    }}
                    onMouseEnter={() => setHoveredId(building.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label={`Enter ${building.name}`}
                    type="button"
                  >
                    <BuildingPulseRing pulse={pulse} />

                    <img
                      src={building.image}
                      alt=""
                      className="w-3/4 h-3/4 object-contain mb-0.5"
                      style={{
                        opacity: isHovered ? 0.95 : 0.78,
                        transition: 'opacity 0.18s ease',
                        pointerEvents: 'none',
                      }}
                      aria-hidden="true"
                      draggable={false}
                    />

                    <div
                      className="font-medium leading-tight"
                      style={{
                        fontSize: '0.6rem',
                        letterSpacing: '0.04em',
                        color: building.color,
                        textShadow: '0 1px 5px rgba(0,0,0,0.95)',
                      }}
                    >
                      {building.name}
                    </div>

                    <div
                      className="font-mono uppercase"
                      style={{
                        fontSize: '0.38rem',
                        letterSpacing: '0.2em',
                        color: `${building.color}66`,
                        marginTop: '1px',
                      }}
                    >
                      {building.type}
                    </div>
                  </button>
                </div>
              );
            })}
          </LayoutGroup>
        </div>

        {/* ── Edge vignette overlay — outside world so it doesn't scale ── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 55%, rgba(26,27,30,0.6) 100%)',
            zIndex: 20,
          }}
          aria-hidden="true"
        />

        {/* ── Zoom HUD ── */}
        <div
          className="absolute bottom-16 left-4 flex flex-col gap-1 z-30 pointer-events-auto"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setDebugAlign((v) => !v)}
            className="w-7 h-7 rounded border flex items-center justify-center font-mono transition-colors"
            style={{
              fontSize: '0.45rem',
              background: debugAlign ? 'rgba(255,220,0,0.15)' : 'rgba(43,45,49,0.9)',
              borderColor: debugAlign ? 'rgba(255,220,0,0.6)' : 'rgba(255,255,255,0.12)',
              color: debugAlign ? 'rgba(255,220,0,1)' : 'rgba(155,157,159,1)',
            }}
            aria-label="Toggle alignment grid"
            title="Toggle alignment debug grid"
            type="button"
          >
            ⊞
          </button>
          <button
            onClick={zoomIn}
            disabled={zoom >= ZOOM_MAX}
            className="w-7 h-7 rounded bg-capitol-card/90 border border-border text-text-primary flex items-center justify-center font-mono text-sm hover:border-stone/40 disabled:opacity-30 transition-colors"
            aria-label="Zoom in"
            type="button"
          >
            +
          </button>
          <button
            onClick={zoomReset}
            className="w-7 h-7 rounded bg-capitol-card/90 border border-border text-text-muted flex items-center justify-center font-mono hover:border-stone/40 transition-colors"
            style={{ fontSize: '0.45rem', letterSpacing: '0.05em' }}
            aria-label="Reset zoom"
            type="button"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={zoomOut}
            disabled={zoom <= minZoom}
            className="w-7 h-7 rounded bg-capitol-card/90 border border-border text-text-primary flex items-center justify-center font-mono text-sm hover:border-stone/40 disabled:opacity-30 transition-colors"
            aria-label="Zoom out"
            type="button"
          >
            −
          </button>
        </div>

        {/* ── Loading overlay ── */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-50 bg-capitol-deep/60">
            <span className="text-xs text-text-muted font-mono animate-pulse">
              Loading government...
            </span>
          </div>
        )}

        <MapEventTicker events={tickerEvents} />
        <AgentDrawer agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      </div>

      {/* ── SIDEBAR ── */}
      <aside className="w-80 bg-capitol-card border-l border-border overflow-y-auto p-5 flex-shrink-0">
        <h2 className="font-serif text-lg text-stone mb-4">Capitol District</h2>

        <div className="flex items-center gap-2 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse" />
          <span className="text-[0.65rem] text-text-muted font-mono">
            {isLoading ? 'Loading...' : `${agents.length} agents active`}
          </span>
        </div>

        <p className="text-xs text-text-muted mb-4">
          Click a building to enter. Scroll to zoom. Drag to pan.
        </p>

        <div className="space-y-2">
          {BUILDINGS.map((building) => {
            const occupantCount = (agentsByBuilding[building.id] ?? []).length;
            return (
              <button
                key={building.id}
                className="w-full text-left card p-3 flex items-center gap-3 hover:border-stone/30 transition-colors"
                onClick={() => navigate(`/capitol-map/${building.id}`)}
                type="button"
              >
                <div
                  className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
                  style={{ background: `${building.color}18` }}
                >
                  <div className="w-2 h-2 rounded-full" style={{ background: building.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{building.name}</div>
                  <div className="text-xs text-text-muted">{building.type}</div>
                </div>
                {occupantCount > 0 && (
                  <span className="text-[0.6rem] font-mono text-gold bg-gold/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {occupantCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
