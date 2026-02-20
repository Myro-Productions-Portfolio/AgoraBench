// File: src/client/pages/BuildingInteriorPage.tsx
// Purpose: Full-screen top-down interior view of a Capitol District building.
// Room images go in /public/images/interiors/{buildingId}.webp — a placeholder
// gradient is shown until then.
//
// DEBUG MODE: add ?debug=1 to URL to enable coordinate overlay.
// Hover the room to see live x%/y% — click to copy to clipboard.

import { useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAgentMap } from '../../../../client/hooks/useAgentMap';
import { SpeechBubble } from '../components/map/SpeechBubble';
import { AgentDrawer } from '../components/map/AgentDrawer';
import { MapEventTicker } from '../components/map/MapEventTicker';
import { getBuildingById } from '../../../../client/lib/buildings';
import type { SpeechBubble as SpeechBubbleType } from '../../../../client/hooks/useAgentMap';
import type { Agent } from '@shared/types';
import type { SeatPosition } from '../../../../client/lib/buildings';

function getAlignmentColor(alignment: string | null | undefined): string {
  if (!alignment) return '#B8956A';
  const a = alignment.toLowerCase();
  if (a.includes('progress') || a.includes('liberal') || a.includes('tech') || a.includes('digital')) return '#6B7A8D';
  if (a.includes('conserv') || a.includes('right') || a.includes('nation') || a.includes('auth')) return '#8B3A3A';
  if (a.includes('labor') || a.includes('union') || a.includes('social') || a.includes('green')) return '#3A6B3A';
  return '#B8956A';
}

interface AgentSeatProps {
  agent: Agent;
  seat: SeatPosition;
  bubble: SpeechBubbleType | undefined;
  onClick: () => void;
}

function AgentSeat({ agent, seat, bubble, onClick }: AgentSeatProps) {
  const ringColor = getAlignmentColor(agent.alignment ?? undefined);
  const initials = agent.displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="absolute cursor-pointer group"
      style={{
        left: `${seat.x}%`,
        top: `${seat.y}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: bubble ? 20 : 10,
      }}
    >
      {bubble && <SpeechBubble bubble={bubble} />}

      <motion.div
        whileHover={{ scale: 1.2 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden"
        style={{
          border: `2px solid ${ringColor}`,
          boxShadow: `0 0 10px ${ringColor}66, 0 2px 8px rgba(0,0,0,0.5)`,
        }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClick(); }
        }}
        title={agent.displayName}
      >
        {agent.avatarUrl ? (
          <img
            src={agent.avatarUrl}
            alt={agent.displayName}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-xs font-bold"
            style={{ background: `${ringColor}22`, color: ringColor }}
          >
            {initials}
          </div>
        )}
      </motion.div>

      {/* Name label on hover */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-1.5 py-0.5 bg-capitol-elevated border border-border rounded text-[0.55rem] text-text-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
        {agent.displayName}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Debug coordinate overlay — enabled by ?debug=1
// ---------------------------------------------------------------------------

interface DebugOverlayProps {
  seats: SeatPosition[];
  buildingColor: string;
}

function DebugOverlay({ seats, buildingColor }: DebugOverlayProps) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    setCursor({ x, y });
  }, []);

  const handleMouseLeave = useCallback(() => setCursor(null), []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
    const text = `{ x: ${x}, y: ${y} }`;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const gridLines = [10, 20, 30, 40, 50, 60, 70, 80, 90];

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-50"
      style={{ cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* Grid lines — vertical */}
      {gridLines.map((pct) => (
        <div
          key={`v${pct}`}
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            left: `${pct}%`,
            width: '1px',
            background: 'rgba(201,185,155,0.25)',
          }}
        >
          <span
            className="absolute top-1 text-[0.45rem] font-mono select-none"
            style={{
              color: 'rgba(201,185,155,0.7)',
              transform: 'translateX(-50%)',
            }}
          >
            {pct}
          </span>
        </div>
      ))}

      {/* Grid lines — horizontal */}
      {gridLines.map((pct) => (
        <div
          key={`h${pct}`}
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            top: `${pct}%`,
            height: '1px',
            background: 'rgba(201,185,155,0.25)',
          }}
        >
          <span
            className="absolute left-1 text-[0.45rem] font-mono select-none"
            style={{
              color: 'rgba(201,185,155,0.7)',
              transform: 'translateY(-50%)',
            }}
          >
            {pct}
          </span>
        </div>
      ))}

      {/* Current seat markers with index labels */}
      {seats.map((seat, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            left: `${seat.x}%`,
            top: `${seat.y}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{
              background: `${buildingColor}33`,
              border: `1.5px solid ${buildingColor}`,
              boxShadow: `0 0 6px ${buildingColor}88`,
            }}
          >
            <span
              className="text-[0.5rem] font-bold font-mono select-none"
              style={{ color: buildingColor }}
            >
              {i}
            </span>
          </div>
          <div
            className="absolute top-full left-1/2 mt-0.5 text-[0.42rem] font-mono whitespace-nowrap select-none"
            style={{
              color: 'rgba(201,185,155,0.8)',
              transform: 'translateX(-50%)',
            }}
          >
            {seat.x},{seat.y}
          </div>
        </div>
      ))}

      {/* Live cursor readout */}
      {cursor && (
        <div
          className="fixed pointer-events-none z-[100] px-2 py-1 rounded font-mono text-xs"
          style={{
            background: 'rgba(26,27,30,0.92)',
            border: '1px solid rgba(201,185,155,0.4)',
            color: '#C9B99B',
            // offset so it doesn't cover what you're looking at
            left: cursor.x > 70 ? 'auto' : `calc(${cursor.x}% + 14px)`,
            right: cursor.x > 70 ? `calc(${100 - cursor.x}% + 14px)` : 'auto',
            top: cursor.y > 80 ? 'auto' : `calc(${cursor.y}% + 14px)`,
            bottom: cursor.y > 80 ? `calc(${100 - cursor.y}% + 14px)` : 'auto',
          }}
        >
          x: {cursor.x}% &nbsp; y: {cursor.y}%
          <div className="text-[0.55rem] opacity-60 mt-0.5">click to copy</div>
        </div>
      )}

      {/* Copied confirmation */}
      {copied && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded font-mono text-xs z-[101]"
          style={{
            background: 'rgba(26,27,30,0.95)',
            border: '1px solid rgba(201,185,155,0.6)',
            color: '#D4A96A',
          }}
        >
          Copied: {copied}
        </div>
      )}

      {/* Debug mode badge */}
      <div
        className="absolute bottom-4 right-4 px-2 py-1 rounded font-mono text-[0.55rem] pointer-events-none"
        style={{
          background: 'rgba(139,58,58,0.85)',
          border: '1px solid rgba(139,58,58,0.6)',
          color: '#E8E6E3',
        }}
      >
        DEBUG — ?debug=1 active — hover to read coords, click to copy
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function BuildingInteriorPage() {
  const { buildingId } = useParams<{ buildingId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const building = getBuildingById(buildingId ?? '');

  const [isDebug, setIsDebug] = useState(
    new URLSearchParams(location.search).get('debug') === '1',
  );

  const {
    agents,
    agentLocations,
    speechBubbles,
    tickerEvents,
    selectedAgent,
    setSelectedAgent,
    isLoading,
  } = useAgentMap();

  const [imgError, setImgError] = useState(false);

  if (!building) {
    return (
      <div className="flex h-[calc(100vh-64px)] items-center justify-center">
        <div className="text-center">
          <p className="text-text-muted mb-4 text-sm">Building not found.</p>
          <button
            className="btn-secondary"
            onClick={() => navigate('/capitol-map')}
            type="button"
          >
            Back to Map
          </button>
        </div>
      </div>
    );
  }

  const occupants = agents.filter(
    (a) => (agentLocations[a.id] ?? 'party-hall') === building.id,
  );

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-capitol-deep overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-capitol-card border-b border-border z-30 flex-shrink-0">
        <button
          className="btn-secondary text-xs flex items-center gap-1.5"
          onClick={() => navigate('/capitol-map')}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Map
        </button>

        <div className="h-4 w-px bg-border flex-shrink-0" />

        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: building.color }} />
        <span className="font-serif text-sm text-stone">{building.name}</span>
        <span className="badge-committee">{building.type}</span>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            title="Toggle seat debug overlay"
            onClick={() => setIsDebug((d) => !d)}
            className="w-7 h-7 rounded flex items-center justify-center text-sm transition-colors"
            style={{
              background: isDebug ? 'rgba(139,58,58,0.5)' : 'rgba(201,185,155,0.08)',
              border: `1px solid ${isDebug ? 'rgba(139,58,58,0.7)' : 'rgba(201,185,155,0.2)'}`,
              color: isDebug ? '#E8E6E3' : '#9B9D9F',
            }}
          >
            ⊞
          </button>
          {occupants.length > 0 && (
            <span className="text-[0.65rem] font-mono text-text-muted">
              {occupants.length} agent{occupants.length !== 1 ? 's' : ''} present
            </span>
          )}
          {isLoading && (
            <span className="text-[0.65rem] font-mono text-text-muted animate-pulse">
              loading...
            </span>
          )}
        </div>
      </div>

      {/* Room — outer: flex centering + container-type for cq units */}
      <div
        className="flex-1 flex items-center justify-center bg-capitol-deep overflow-hidden"
        style={{ containerType: 'size' } as React.CSSProperties}
      >
        {/* Inner: locked 16:9 room — uses container query units so it never exceeds
            the available space in either dimension, letterboxed as needed */}
        <div
          className="relative overflow-hidden"
          style={{
            width: 'min(100cqw, calc(100cqh * 16 / 9))',
            height: 'min(100cqh, calc(100cqw * 9 / 16))',
          }}
        >
          {/* Background: room image or placeholder */}
          {!imgError ? (
            <img
              src={`/images/interiors/${building.id}.webp`}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full"
              style={{ objectFit: 'fill' }}
              onError={() => setImgError(true)}
              draggable={false}
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(ellipse at 50% 30%, ${building.color}14 0%, transparent 65%),
                             linear-gradient(180deg, #1A1B1E 0%, #1C1F23 100%)`,
              }}
            >
              {/* Floor grid placeholder */}
              <div
                className="absolute inset-0 opacity-[0.12]"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(201,185,155,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(201,185,155,0.4) 1px, transparent 1px)',
                  backgroundSize: '80px 80px',
                }}
                aria-hidden="true"
              />
              {/* Placeholder hint */}
              <div className="absolute bottom-16 inset-x-0 flex flex-col items-center gap-1 pointer-events-none">
                <p className="text-[0.65rem] text-text-muted font-mono opacity-40 uppercase tracking-widest">
                  {building.name} — interior image pending
                </p>
                <p className="text-[0.5rem] text-text-muted font-mono opacity-25">
                  place /images/interiors/{building.id}.webp to activate
                </p>
              </div>
            </div>
          )}

          {/* Vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.5) 100%)',
            }}
            aria-hidden="true"
          />

          {/* Faint seat markers — show all designated positions */}
          {!isDebug && building.seats.map((seat, i) => (
            <div
              key={i}
              className="absolute w-10 h-10 rounded-full pointer-events-none"
              style={{
                left: `${seat.x}%`,
                top: `${seat.y}%`,
                transform: 'translate(-50%, -50%)',
                border: `1px dashed rgba(201,185,155,0.3)`,
              }}
              aria-hidden="true"
            />
          ))}

          {/* Seated agents */}
          <AnimatePresence>
            {occupants.map((agent, idx) => {
              const seat = building.seats[idx % building.seats.length];
              const bubble = speechBubbles.find((b) => b.agentId === agent.id);
              return (
                <AgentSeat
                  key={agent.id}
                  agent={agent}
                  seat={seat}
                  bubble={bubble}
                  onClick={() => setSelectedAgent(agent)}
                />
              );
            })}
          </AnimatePresence>

          {/* Debug coordinate overlay */}
          {isDebug && (
            <DebugOverlay seats={building.seats} buildingColor={building.color} />
          )}

          {/* Ticker */}
          <MapEventTicker events={tickerEvents} />
        </div>
        {/* Agent detail drawer — outside fixed-ratio box so it can cover full area */}
        <AgentDrawer agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      </div>
    </div>
  );
}
