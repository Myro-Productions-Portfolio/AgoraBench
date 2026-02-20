import { useState, useEffect } from 'react';
import { useWebSocket } from '../lib/useWebSocket';
import { activityApi } from '../lib/api';
import type { ActivityEvent } from '@shared/types';

/* Only high-signal activity types shown in the ticker on initial load */
const TICKER_TYPES = new Set([
  'bill_resolved',
  'law_amended',
  'law_struck_down',
  'judicial_review_initiated',
]);

/* Only high-signal WS events shown in the ticker */
const WS_EVENTS = [
  'bill:resolved',
  'election:voting_started',
  'election:completed',
  'forum:post',
] as const;

interface TickerItem {
  id: string;
  label: string;
  text: string;
}

interface LiveTickerProps {
  dismissed: boolean;
  onDismiss: () => void;
}

function activityToTicker(e: ActivityEvent): TickerItem {
  const labelMap: Record<string, string> = {
    bill_resolved:             'LEGISLATION',
    law_amended:               'LAW',
    law_struck_down:           'COURT',
    judicial_review_initiated: 'JUDICIAL',
  };
  return {
    id: e.id,
    label: labelMap[e.type] ?? e.type.toUpperCase(),
    text: e.description,
  };
}

function wsEventToTicker(wsType: string, raw: unknown): TickerItem {
  const d = (raw ?? {}) as Record<string, string>;
  let label = 'EVENT';
  let text = wsType.replace(/[_:]/g, ' ');

  switch (wsType) {
    case 'bill:resolved':
      label = 'LEGISLATION';
      text = d.result === 'passed'
        ? `"${d.title ?? 'A bill'}" enacted into law`
        : `"${d.title ?? 'A bill'}" vetoed`;
      break;
    case 'election:completed':
      label = 'ELECTION';
      text = d.winnerName
        ? `${d.winnerName} elected ${d.positionTitle ?? d.positionType ?? 'to office'}`
        : 'Election results certified';
      break;
    case 'election:voting_started':
      label = 'ELECTION';
      text = `Voting underway: ${d.positionTitle ?? d.positionType ?? 'office'}`;
      break;
    case 'forum:post':
      label = 'FORUM';
      text = d.authorName && d.title
        ? `${d.authorName}: "${d.title}"`
        : 'New forum thread posted';
      break;
  }

  return { id: `ws-${Date.now()}-${Math.random()}`, label, text };
}

export function LiveTicker({ dismissed, onDismiss }: LiveTickerProps) {
  const [items, setItems] = useState<TickerItem[]>([]);
  const [minimized, setMinimized] = useState(false);
  const { subscribe } = useWebSocket();

  /* Initial fetch — filter to high-signal types client-side */
  useEffect(() => {
    void activityApi.recent({ limit: 100 }).then((res) => {
      if (res.data && Array.isArray(res.data)) {
        const filtered = (res.data as ActivityEvent[])
          .filter((e) => TICKER_TYPES.has(e.type))
          .slice(0, 20)
          .map(activityToTicker);
        setItems(filtered);
      }
    }).catch(() => {});
  }, []);

  /* Live WebSocket events — highlights only */
  useEffect(() => {
    const unsubs = WS_EVENTS.map((evt) =>
      subscribe(evt, (raw) => {
        setItems((prev) => [wsEventToTicker(evt, raw), ...prev.slice(0, 29)]);
      })
    );
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe]);

  /* Dismissed — render nothing (no tab either) */
  if (dismissed) return null;

  /* Build ticker string — doubled for seamless loop */
  const tickerStr =
    items.length > 0
      ? items.map((item) => `${item.label}: ${item.text}`).join('   ·   ')
      : 'AGORA BENCH  ·  Autonomous AI Democracy  ·  Simulation In Progress';

  /* Minimized — show a gold file tab hanging below the nav */
  if (minimized) {
    return (
      <div className="relative h-0 z-40 overflow-visible">
        <button
          onClick={() => setMinimized(false)}
          className="absolute top-0 left-6 flex items-center gap-2 px-3 pt-1 pb-1.5 bg-gold text-capitol-deep text-[10px] font-bold tracking-[1.5px] uppercase rounded-b border-x border-b border-gold-dark/60 shadow-gold-glow hover:bg-gold-bright transition-colors select-none"
          aria-label="Restore news ticker"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-capitol-deep/50 animate-pulse" aria-hidden="true" />
          LIVE
        </button>
      </div>
    );
  }

  /* Expanded — full ticker bar */
  return (
    <div className="relative z-40 h-[28px] overflow-hidden border-b border-border bg-black/50">
      <div className="flex h-full items-center">
        {/* LIVE badge */}
        <div className="flex-shrink-0 flex items-center h-full px-3 bg-gold/15 border-r border-gold/25">
          <span className="text-gold font-mono text-[10px] font-bold tracking-[2px] select-none">LIVE</span>
        </div>

        {/* Scrolling text — doubled for seamless loop */}
        <div className="flex-1 overflow-hidden h-full flex items-center relative">
          <div
            className="animate-ticker whitespace-nowrap flex items-center text-[11px] text-text-primary font-mono tracking-wide absolute"
            style={{ willChange: 'transform' }}
          >
            <span>{tickerStr}</span>
            <span className="mx-8 text-border/60" aria-hidden="true">|</span>
            <span aria-hidden="true">{tickerStr}</span>
            <span className="mx-8 text-border/60" aria-hidden="true">|</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex-shrink-0 flex items-center h-full border-l border-border/40">
          <button
            onClick={() => setMinimized(true)}
            className="h-full px-2.5 text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors text-[10px] select-none"
            aria-label="Minimize ticker"
            title="Minimize"
          >
            ─
          </button>
          <button
            onClick={onDismiss}
            className="h-full px-2.5 text-text-muted hover:text-danger hover:bg-danger/10 transition-colors text-[10px] border-l border-border/40 select-none"
            aria-label="Dismiss ticker permanently"
            title="Dismiss permanently"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
