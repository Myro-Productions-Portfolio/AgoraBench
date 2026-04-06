import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface LobbyEvent {
  id: string;
  lobbyistId: string;
  lobbyistName: string;
  targetId: string;
  targetName: string;
  desiredVote: 'yea' | 'nay';
  positionShifted: boolean;
  argument: string;
  createdAt: string;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtRelative(s: string): string {
  const diff = Date.now() - new Date(s).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Component ─────────────────────────────────────────────────────────── */

interface LobbyingFeedProps {
  billId: string;
}

export function LobbyingFeed({ billId }: LobbyingFeedProps) {
  const [events, setEvents] = useState<LobbyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { subscribe } = useWebSocket();

  const fetchEvents = useCallback(() => {
    fetch(`/api/legislation/${billId}/lobbying`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load lobbying activity (${res.status})`);
        return res.json() as Promise<{ data: LobbyEvent[] }>;
      })
      .then((res) => setEvents(res.data ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [billId]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  useEffect(() => {
    const unsub = subscribe('agent:lobby', fetchEvents);
    return () => unsub();
  }, [subscribe, fetchEvents]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return <p className="text-sm text-text-muted animate-pulse">Loading lobbying activity...</p>;
  }
  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (events.length === 0) {
    return <p className="text-sm text-text-muted">No lobbying activity recorded.</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((ev) => {
        const isExpanded = expandedIds.has(ev.id);
        return (
          <div
            key={ev.id}
            className={`border-l-2 pl-3 py-1 ${ev.positionShifted ? 'border-gold' : 'border-border/40'}`}
          >
            <button
              className="w-full text-left"
              onClick={() => toggleExpand(ev.id)}
            >
              <p className="text-sm text-text-secondary leading-snug">
                <Link
                  to={`/agents/${ev.lobbyistId}`}
                  className="text-gold hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {ev.lobbyistName}
                </Link>
                {' '}lobbied{' '}
                <Link
                  to={`/agents/${ev.targetId}`}
                  className="text-gold hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {ev.targetName}
                </Link>
                {' '}for{' '}
                <span className={ev.desiredVote === 'yea' ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                  {ev.desiredVote.toUpperCase()}
                </span>
                <span className="text-text-muted text-xs ml-2">· {fmtRelative(ev.createdAt)}</span>
              </p>
            </button>
            {isExpanded && ev.argument && (
              <div className="mt-1.5 rounded border border-border/40 bg-capitol-deep/30 px-3 py-2 text-xs text-text-secondary leading-relaxed">
                {ev.argument}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
