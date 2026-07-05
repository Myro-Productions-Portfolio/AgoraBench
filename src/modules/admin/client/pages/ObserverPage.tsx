import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { decisionsApi, ticksApi, legislationApi, agentsApi } from '@core/client/lib/api';
import { BillPipeline } from '@modules/legislation/client/components/BillPipeline';
import { EmptyState } from '@core/client/components/EmptyState';

// -- Types -------------------------------------------------------------------

interface DecisionRow {
  id: string;
  agentId: string | null;
  agentName: string | null;
  alignment: string | null;
  provider: string;
  phase: string | null;
  parsedAction: string | null;
  parsedReasoning: string | null;
  success: boolean;
  latencyMs: number;
  createdAt: string;
}

interface TickRow {
  id: string;
  firedAt: string;
  completedAt: string | null;
}

interface TickSummary {
  id: string;
  firedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  totalDecisions: number;
  decisionsByPhase: Record<string, number>;
  votesCast: number;
  forumThreadsCreated: number;
  forumMessages: number;
  interventions: number;
  eventsByType: Record<string, number>;
}

interface BillRow {
  id: string;
  title: string;
  status: string;
  tally: { yea: number; nay: number; abstain: number; total: number };
}

interface LawRow {
  id: string;
  title: string;
  billId: string;
  enactedDate: string;
  isActive: boolean;
}

interface RelationshipRow {
  agentId: string;
  agentName: string;
  agentAlignment: string | null;
  targetId: string;
  targetName: string;
  targetAlignment: string | null;
  voteAlignment: number;
  sentiment: number;
}

// -- Constants ---------------------------------------------------------------

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const WS_EVENTS = [
  'agent:vote',
  'bill:proposed',
  'bill:advanced',
  'bill:resolved',
  'campaign:speech',
];

function actionBorder(action: string | null): string {
  if (!action) return 'border-l-4 border-border/40';
  const a = action.toLowerCase();
  if (a.includes('yea') || a.includes('aye')) return 'border-l-4 border-green-500';
  if (a.includes('nay')) return 'border-l-4 border-red-500';
  if (a.includes('propose')) return 'border-l-4 border-gold';
  if (a.includes('campaign')) return 'border-l-4 border-blue-400';
  return 'border-l-4 border-border/40';
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' \u00B7 ' +
    d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  );
}

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

const POLL_INTERVAL_MS = 30_000;
const DECISION_FEED_MAX = 50;
const INITIAL_DECISION_LIMIT = 30;

// -- Decision Card -----------------------------------------------------------

function DecisionCard({ d }: { d: DecisionRow }) {
  const [expanded, setExpanded] = useState(false);
  const alignColor =
    ALIGNMENT_COLORS[d.alignment?.toLowerCase() ?? ''] ??
    'text-text-muted bg-border/10 border-border/30';

  return (
    <div
      className={`rounded bg-surface border border-border/40 p-3 cursor-pointer hover:border-border/80 transition-colors ${actionBorder(d.parsedAction)}`}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {d.agentId ? (
            <a
              href={`/agents/${d.agentId}`}
              className="text-gold hover:underline font-medium text-sm truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {d.agentName ?? 'Unknown'}
            </a>
          ) : (
            <span className="text-text-muted text-sm">System</span>
          )}
          {d.alignment && (
            <span className={`badge border text-[10px] ${alignColor}`}>
              {d.alignment}
            </span>
          )}
          <span className="text-[10px] text-text-muted border border-border/30 rounded px-1 py-0.5 font-mono uppercase">
            {d.provider}
          </span>
        </div>
        <span
          className="text-[10px] text-text-muted font-mono flex-shrink-0"
          title={relativeTime(d.createdAt)}
        >
          {formatTimestamp(d.createdAt)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {d.phase && (
          <span className="text-[10px] text-text-muted uppercase tracking-wide">
            {d.phase}
          </span>
        )}
        {d.phase && d.parsedAction && (
          <span className="text-border/50 text-[10px]">&middot;</span>
        )}
        {d.parsedAction && (
          <span className="text-[11px] font-mono text-text-primary">
            {d.parsedAction}
          </span>
        )}
        <span className="text-[10px] text-text-muted ml-auto">
          {d.latencyMs}ms
        </span>
      </div>

      {d.parsedReasoning && (
        <p className="mt-1.5 text-[11px] text-text-secondary leading-relaxed">
          {expanded
            ? d.parsedReasoning
            : d.parsedReasoning.slice(0, 120) +
              (d.parsedReasoning.length > 120 ? '\u2026' : '')}
        </p>
      )}
    </div>
  );
}

// -- Tick Duration Color -----------------------------------------------------

function tickDurationColor(ms: number | null): string {
  if (ms === null) return 'bg-border/40';
  if (ms < 60_000) return 'bg-green-500';
  if (ms < 180_000) return 'bg-yellow-500';
  return 'bg-red-500';
}

function tickDurationLabel(ms: number | null): string {
  if (ms === null) return '?';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// -- Tick Breakdown ----------------------------------------------------------

function TickBreakdown({ summary }: { summary: TickSummary }) {
  const phases = Object.entries(summary.decisionsByPhase).sort(
    ([, a], [, b]) => b - a,
  );

  const events: string[] = [];
  if (summary.votesCast > 0) events.push(`${summary.votesCast} vote${summary.votesCast !== 1 ? 's' : ''} cast`);
  if (summary.forumThreadsCreated > 0) events.push(`${summary.forumThreadsCreated} forum thread${summary.forumThreadsCreated !== 1 ? 's' : ''}`);
  if (summary.forumMessages > 0) events.push(`${summary.forumMessages} forum message${summary.forumMessages !== 1 ? 's' : ''}`);
  if (summary.interventions > 0) events.push(`${summary.interventions} AGGE intervention${summary.interventions !== 1 ? 's' : ''}`);

  // Summarize activity events beyond what we already listed
  const eventTypes = Object.entries(summary.eventsByType).filter(
    ([type]) => !['vote', 'forum_post', 'forum_reply'].includes(type),
  );
  for (const [type, count] of eventTypes) {
    events.push(`${count} ${type.replace(/_/g, ' ')}`);
  }

  return (
    <div className="space-y-2 text-xs">
      {/* Duration + total */}
      <div className="flex items-center gap-3">
        <span className="text-text-muted">
          Duration:{' '}
          <span className="text-text-primary font-mono">
            {tickDurationLabel(summary.durationMs)}
          </span>
        </span>
        <span className="text-text-muted">
          Decisions:{' '}
          <span className="text-text-primary font-mono">
            {summary.totalDecisions}
          </span>
        </span>
      </div>

      {/* Phase summary */}
      {phases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {phases.map(([phase, count]) => (
            <span
              key={phase}
              className="inline-flex items-center gap-1 rounded border border-border/30 bg-black/20 px-1.5 py-0.5"
            >
              <span className="text-[10px] text-text-muted uppercase tracking-wide">
                {phase}
              </span>
              <span className="text-[10px] text-text-primary font-mono">
                {count}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Key events */}
      {events.length > 0 && (
        <div className="text-[11px] text-text-secondary leading-relaxed">
          {events.join(' \u00B7 ')}
        </div>
      )}

      {events.length === 0 && phases.length === 0 && (
        <p className="text-text-muted text-[11px]">No activity recorded in this tick</p>
      )}
    </div>
  );
}

// -- Tick Timeline -----------------------------------------------------------

function TickTimeline({
  ticks,
  selectedTickId,
  onSelectTick,
}: {
  ticks: TickRow[];
  selectedTickId: string | 'live';
  onSelectTick: (id: string) => void;
}) {
  const [summary, setSummary] = useState<TickSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Compute durations for the bar segments
  const ticksWithDuration = ticks.map((t) => ({
    ...t,
    durationMs:
      t.completedAt
        ? new Date(t.completedAt).getTime() - new Date(t.firedAt).getTime()
        : null,
  }));

  // Find max duration for proportional widths
  const maxDuration = Math.max(
    ...ticksWithDuration.map((t) => t.durationMs ?? 0),
    1,
  );

  const fetchSummary = useCallback((tickId: string) => {
    setLoadingSummary(true);
    setSummary(null);
    void (ticksApi.summary(tickId) as Promise<{ data?: TickSummary }>)
      .then((res) => {
        if (res.data) setSummary(res.data);
      })
      .catch((err) => {
        console.error('[OBSERVER] Tick summary fetch failed:', err);
      })
      .finally(() => setLoadingSummary(false));
  }, []);

  const handleClickTick = (tickId: string) => {
    onSelectTick(tickId);
    fetchSummary(tickId);
  };

  if (ticks.length === 0) return null;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          Tick Timeline
        </span>
        <span className="text-[10px] text-text-muted">
          Last {ticks.length} ticks
        </span>
      </div>

      {/* Timeline bar */}
      <div className="flex items-end gap-0.5 h-8">
        {ticksWithDuration.map((t) => {
          const isSelected = selectedTickId === t.id;
          const widthPct = Math.max(
            ((t.durationMs ?? maxDuration * 0.1) / maxDuration) * 100,
            5,
          );
          return (
            <button
              key={t.id}
              title={`${formatTimestamp(t.firedAt)} — ${tickDurationLabel(t.durationMs)}`}
              onClick={() => handleClickTick(t.id)}
              className={`relative flex-shrink-0 rounded-sm transition-all cursor-pointer hover:opacity-80 ${tickDurationColor(t.durationMs)} ${
                isSelected
                  ? 'ring-1 ring-gold ring-offset-1 ring-offset-capitol-deep'
                  : 'opacity-60 hover:opacity-100'
              }`}
              style={{
                width: `${widthPct}%`,
                minWidth: '20px',
                height: isSelected ? '100%' : '70%',
              }}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[9px] text-text-muted">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-green-500" /> &lt;60s
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-yellow-500" /> 60-180s
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-red-500" /> &gt;180s
        </span>
      </div>

      {/* Breakdown panel */}
      {selectedTickId !== 'live' && (
        <div className="rounded border border-border/40 bg-black/20 p-2.5">
          {loadingSummary ? (
            <p className="text-text-muted text-[11px] animate-pulse">
              Loading tick summary...
            </p>
          ) : summary ? (
            <TickBreakdown summary={summary} />
          ) : (
            <p className="text-text-muted text-[11px]">
              Select a tick to see its breakdown
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// -- Main Page ---------------------------------------------------------------

export function ObserverPage() {
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [ticks, setTicks] = useState<TickRow[]>([]);
  const [selectedTickId, setSelectedTickId] = useState<string | 'live'>('live');
  const [billCounts, setBillCounts] = useState<Record<string, number>>({});
  const [activeVotes, setActiveVotes] = useState<BillRow[]>([]);
  const [recentLaws, setRecentLaws] = useState<LawRow[]>([]);
  const [alliances, setAlliances] = useState<RelationshipRow[]>([]);
  const [rivalries, setRivalries] = useState<RelationshipRow[]>([]);
  const { subscribe } = useWebSocket();
  const liveRef = useRef(selectedTickId === 'live');
  liveRef.current = selectedTickId === 'live';

  // Seed decisions on mount
  useEffect(() => {
    void (decisionsApi.list({ limit: INITIAL_DECISION_LIMIT }) as Promise<{ data?: DecisionRow[] }>)
      .then((res) => {
        if (res.data) setDecisions(res.data);
      })
      .catch((err) => { console.error('[OBSERVER] Data fetch failed:', err); });
  }, []);

  // Load tick options (10 for the timeline)
  useEffect(() => {
    void (ticksApi.recent(10) as Promise<{ data?: TickRow[] }>)
      .then((res) => {
        if (res.data) setTicks(res.data);
      })
      .catch((err) => { console.error('[OBSERVER] Data fetch failed:', err); });
  }, []);

  // When tick selected, load that tick's decisions
  useEffect(() => {
    if (selectedTickId === 'live') return;
    void (decisionsApi.list({ limit: 100, tickId: selectedTickId }) as Promise<{ data?: DecisionRow[] }>)
      .then((res) => {
        if (res.data) setDecisions(res.data);
      })
      .catch((err) => { console.error('[OBSERVER] Data fetch failed:', err); });
  }, [selectedTickId]);

  // Live WebSocket prepend (only in live mode)
  useEffect(() => {
    const unsubs = WS_EVENTS.map((evt) =>
      subscribe(evt, () => {
        if (!liveRef.current) return;
        void (decisionsApi.list({ limit: 1 }) as Promise<{ data?: DecisionRow[] }>)
          .then((res) => {
            if (res.data?.[0]) {
              setDecisions((prev) => [res.data![0], ...prev.slice(0, DECISION_FEED_MAX - 1)]);
            }
          })
          .catch((err) => { console.error('[OBSERVER] Data fetch failed:', err); });
      }),
    );
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe]);

  // Poll right-column data
  useEffect(() => {
    const loadRight = () => {
      // Fetch all bills (large limit) to compute pipeline counts and find active votes
      void (legislationApi.list(1, 100) as Promise<{ data?: BillRow[] }>)
        .then((res) => {
          if (!res.data) return;
          const bills = res.data;
          const counts: Record<string, number> = {};
          bills.forEach((b) => {
            counts[b.status] = (counts[b.status] ?? 0) + 1;
          });
          setBillCounts(counts);
          setActiveVotes(
            bills.filter((b) => b.status === 'floor' || b.status === 'presidential_veto'),
          );
        })
        .catch((err) => { console.error('[OBSERVER] Data fetch failed:', err); });

      // Fetch recent laws
      void (legislationApi.laws() as Promise<{ data?: LawRow[] }>)
        .then((res) => {
          if (res.data) setRecentLaws(res.data.slice(0, 8));
        })
        .catch((err) => { console.error('[OBSERVER] Data fetch failed:', err); });

      // Fetch relationship summary (alliances + rivalries)
      void (agentsApi.relationshipsSummary() as Promise<{ data?: { alliances: RelationshipRow[]; rivalries: RelationshipRow[] } }>)
        .then((res) => {
          if (res.data) {
            setAlliances(res.data.alliances);
            setRivalries(res.data.rivalries);
          }
        })
        .catch((err) => { console.error('[OBSERVER] Relationships fetch failed:', err); });
    };

    loadRight();
    const interval = setInterval(loadRight, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const handleResumeLive = () => {
    setSelectedTickId('live');
    void (decisionsApi.list({ limit: INITIAL_DECISION_LIMIT }) as Promise<{ data?: DecisionRow[] }>)
      .then((res) => {
        if (res.data) setDecisions(res.data);
      })
      .catch((err) => { console.error('[OBSERVER] Data fetch failed:', err); });
  };

  return (
    <div className="flex flex-col h-screen bg-capitol-deep text-text-primary overflow-hidden">
      {/* Top bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 h-9 border-b border-border bg-black/40">
        <div className="flex items-center gap-2">
          <span className="font-serif text-gold font-semibold text-sm tracking-wide">
            AGORA BENCH
          </span>
          <span className="text-border/60 text-xs">&middot;</span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            LIVE
          </span>
        </div>
        <a
          href="/"
          className="text-[11px] text-text-muted hover:text-gold transition-colors tracking-wide"
        >
          &larr; agorabench.com
        </a>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT -- Decision log */}
        <div className="w-[55%] flex flex-col border-r border-border min-h-0">
          {/* Tick selector */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-black/20">
            <span className="text-[10px] text-text-muted uppercase tracking-widest">
              Viewing:
            </span>
            <select
              value={selectedTickId}
              onChange={(e) => setSelectedTickId(e.target.value)}
              className="text-[11px] bg-surface border border-border/50 rounded px-2 py-1 text-text-primary focus:outline-none focus:border-gold/50"
            >
              <option value="live">Live — all decisions</option>
              {ticks.map((t) => (
                <option key={t.id} value={t.id}>
                  Tick: {formatTimestamp(t.firedAt)}
                </option>
              ))}
            </select>
            {selectedTickId !== 'live' && (
              <button
                onClick={handleResumeLive}
                className="text-[10px] text-gold hover:underline"
              >
                Resume live
              </button>
            )}
          </div>

          {/* Tick Timeline */}
          {ticks.length > 0 && (
            <div className="flex-shrink-0 px-3 py-2.5 border-b border-border/40 bg-black/10">
              <TickTimeline
                ticks={ticks}
                selectedTickId={selectedTickId}
                onSelectTick={(id) => setSelectedTickId(id)}
              />
            </div>
          )}

          {/* Feed */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {decisions.length === 0 && (
              <p className="text-text-muted text-sm text-center mt-8">
                Waiting for decisions&hellip;
              </p>
            )}
            {decisions.map((d) => (
              <DecisionCard key={d.id} d={d} />
            ))}
          </div>
        </div>

        {/* RIGHT -- Pipeline + Active votes + Recent laws */}
        <div className="w-[45%] flex flex-col overflow-y-auto p-4 space-y-4">
          {/* Bill pipeline */}
          <div>
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-2">
              Bill Pipeline
            </h2>
            <BillPipeline counts={billCounts} activeFilter="all" onFilter={() => {}} />
          </div>

          {/* Active votes */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="font-serif text-sm font-semibold text-stone mb-3">
              Active Votes
            </h2>
            {activeVotes.length === 0 ? (
              <EmptyState compact title="No active votes in progress" />
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-48">
                {activeVotes.map((b) => {
                  const total = b.tally.yea + b.tally.nay;
                  const yeaPct = total > 0 ? Math.round((b.tally.yea / total) * 100) : 50;
                  return (
                    <div key={b.id} className="text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <a
                          href={`/legislation/${b.id}`}
                          className="text-gold hover:underline truncate max-w-[70%]"
                        >
                          {b.title}
                        </a>
                        <span className="text-text-muted font-mono flex-shrink-0">
                          {b.tally.yea}Y / {b.tally.nay}N
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-border/30 overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{ width: `${yeaPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent laws */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="font-serif text-sm font-semibold text-stone mb-3">
              Recent Laws
            </h2>
            {recentLaws.length === 0 ? (
              <EmptyState compact title="No laws enacted yet" />
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-56">
                {recentLaws.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-start justify-between gap-2 text-xs"
                  >
                    <a
                      href={`/laws/${l.id}`}
                      className="text-gold hover:underline leading-snug"
                    >
                      {l.title}
                    </a>
                    <span className="text-text-muted font-mono flex-shrink-0 text-[10px]">
                      {new Date(l.enactedDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Strongest Alliances */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="font-serif text-sm font-semibold text-stone mb-3">
              Strongest Alliances
            </h2>
            {alliances.length === 0 ? (
              <p className="text-text-muted text-xs">No relationship data yet</p>
            ) : (
              <div className="space-y-1.5 overflow-y-auto max-h-56">
                {alliances.map((r, i) => {
                  const a1Color =
                    ALIGNMENT_COLORS[r.agentAlignment?.toLowerCase() ?? ''] ??
                    'text-text-muted bg-border/10 border-border/30';
                  const a2Color =
                    ALIGNMENT_COLORS[r.targetAlignment?.toLowerCase() ?? ''] ??
                    'text-text-muted bg-border/10 border-border/30';
                  return (
                    <div key={`alliance-${i}`} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="text-text-primary truncate">{r.agentName}</span>
                        {r.agentAlignment && (
                          <span className={`badge border text-[9px] px-1 py-0 ${a1Color}`}>
                            {r.agentAlignment}
                          </span>
                        )}
                        <span className="text-text-muted text-[10px]">+</span>
                        <span className="text-text-primary truncate">{r.targetName}</span>
                        {r.targetAlignment && (
                          <span className={`badge border text-[9px] px-1 py-0 ${a2Color}`}>
                            {r.targetAlignment}
                          </span>
                        )}
                      </div>
                      <span className="text-green-400 font-mono flex-shrink-0 text-[10px]">
                        {Math.round(r.voteAlignment * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Biggest Rivalries */}
          <div className="rounded-lg border border-red-900/30 bg-red-950/10 p-4">
            <h2 className="font-serif text-sm font-semibold text-red-400 mb-3">
              Biggest Rivalries
            </h2>
            {rivalries.length === 0 ? (
              <p className="text-text-muted text-xs">No relationship data yet</p>
            ) : (
              <div className="space-y-1.5 overflow-y-auto max-h-56">
                {rivalries.map((r, i) => {
                  const a1Color =
                    ALIGNMENT_COLORS[r.agentAlignment?.toLowerCase() ?? ''] ??
                    'text-text-muted bg-border/10 border-border/30';
                  const a2Color =
                    ALIGNMENT_COLORS[r.targetAlignment?.toLowerCase() ?? ''] ??
                    'text-text-muted bg-border/10 border-border/30';
                  return (
                    <div key={`rivalry-${i}`} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="text-text-primary truncate">{r.agentName}</span>
                        {r.agentAlignment && (
                          <span className={`badge border text-[9px] px-1 py-0 ${a1Color}`}>
                            {r.agentAlignment}
                          </span>
                        )}
                        <span className="text-red-400 text-[10px]">vs</span>
                        <span className="text-text-primary truncate">{r.targetName}</span>
                        {r.targetAlignment && (
                          <span className={`badge border text-[9px] px-1 py-0 ${a2Color}`}>
                            {r.targetAlignment}
                          </span>
                        )}
                      </div>
                      <span className="text-red-400 font-mono flex-shrink-0 text-[10px]">
                        {Math.round(r.voteAlignment * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
