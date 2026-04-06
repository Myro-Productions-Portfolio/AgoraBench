import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';

/* ── Types ──────────────────────────────────────────────────────────────── */

interface ActivityEntry {
  id: string;
  type: string;
  agentId: string | null;
  agentName: string | null;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/* ── Constants ──────────────────────────────────────────────────────────── */

type FilterOption = 'all' | 'amendments' | 'lobbying' | 'deals' | 'statements' | 'votes' | 'bill_events';

const FILTER_OPTIONS: Array<{ value: FilterOption; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'amendments', label: 'Amendments' },
  { value: 'lobbying', label: 'Lobbying' },
  { value: 'deals', label: 'Deals' },
  { value: 'statements', label: 'Statements' },
  { value: 'votes', label: 'Votes' },
  { value: 'bill_events', label: 'Bill Events' },
];

/* Maps filter pill → API ?type= param (undefined = fetch all, filter client-side) */
const FILTER_TO_API_TYPE: Record<FilterOption, string | undefined> = {
  all: undefined,
  amendments: 'floor_amendment',
  lobbying: 'lobby',
  deals: undefined,          // no single type yet; show all & filter client-side
  statements: 'public_statement',
  votes: 'vote',
  bill_events: undefined,    // multiple 'bill_*' types — filter client-side
};

/** Returns true if the entry matches the current filter (client-side gate) */
function matchesFilter(entry: ActivityEntry, filter: FilterOption): boolean {
  if (filter === 'all') return true;
  if (filter === 'bill_events') return entry.type.startsWith('bill_') || entry.type.startsWith('bill:');
  if (filter === 'deals') return entry.type.includes('deal');
  // All other filters are handled by the API; anything that slips through is fine
  return true;
}

/* Border accent per event type */
function getAccentClass(type: string): string {
  if (type === 'lobby') return 'border-l-gold';
  if (type === 'floor_amendment' || type === 'floor_amendment_proposed') return 'border-l-amber-400';
  if (type === 'bill_amended' || type.includes('amended')) return 'border-l-green-400';
  if (type === 'public_statement' || type === 'agent:statement') return 'border-l-purple-400';
  if (type === 'bill_withdrawn' || type.includes('withdrawn')) return 'border-l-stone-500';
  if (type === 'vote' || type === 'agent:vote') return 'border-l-gold/40';
  if (type === 'bill_proposed') return 'border-l-blue-300';
  if (type === 'agge_intervention') return 'border-l-purple-300';
  if (type.startsWith('bill_') || type.startsWith('bill:')) return 'border-l-blue-300';
  if (type.startsWith('deal')) return 'border-l-blue-300';
  return 'border-l-border';
}

/** Derive a human-readable summary line from an activity entry */
function getSummaryText(entry: ActivityEntry): string {
  const agent = entry.agentName ?? 'An agent';
  const meta = entry.metadata ?? {};
  const bill = (meta.billTitle as string | undefined) ?? '';
  const type = entry.type;

  if (type === 'lobby') {
    const target = (meta.targetName as string | undefined) ?? 'another agent';
    const vote = (meta.desiredVote as string | undefined)?.toUpperCase() ?? 'a vote';
    return `${agent} lobbied ${target} for ${vote}${bill ? ` on ${bill}` : ''}`;
  }
  if (type === 'floor_amendment' || type === 'floor_amendment_proposed') {
    const amendType = (meta.amendmentType as string | undefined) ?? '';
    return `${agent} proposed a${amendType ? ` ${amendType}` : ''} amendment${bill ? ` to ${bill}` : ''}`;
  }
  if (type === 'bill_amended' || type.includes('amended')) {
    return `${bill || 'A bill'} was amended`;
  }
  if (type === 'public_statement') {
    return `${agent} issued a press statement${bill ? ` on ${bill}` : ''}`;
  }
  if (type === 'bill_withdrawn' || type.includes('withdrawn')) {
    return `${agent} withdrew ${bill || 'a bill'}`;
  }
  if (type === 'vote') {
    return `${agent} voted on ${bill || 'a bill'}`;
  }
  if (type === 'bill_proposed') {
    return `${agent} proposed ${bill || 'a bill'}`;
  }
  if (type === 'agge_intervention') {
    return `${agent} personality evolved`;
  }

  // Generic fallback using the stored title
  return entry.title || `${type}: ${entry.description ?? ''}`;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

/* ── FeedEntry ──────────────────────────────────────────────────────────── */

function FeedEntry({ entry }: { entry: ActivityEntry }) {
  const accent = getAccentClass(entry.type);
  const summary = getSummaryText(entry);
  const meta = entry.metadata ?? {};
  const billId = typeof meta.billId === 'string' ? meta.billId : null;
  const billTitle = typeof meta.billTitle === 'string' ? meta.billTitle : null;

  // Tail of summary after stripping the leading agent name (for inline rendering)
  const summaryTail =
    entry.agentName && summary.startsWith(entry.agentName)
      ? summary.slice(entry.agentName.length).trimStart()
      : summary;

  return (
    <div className={`border-l-2 ${accent} pl-3 py-2 flex items-start justify-between gap-3`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary leading-snug">
          {entry.agentId && entry.agentName ? (
            <>
              <Link to={`/agents/${entry.agentId}`} className="text-gold hover:underline font-medium">
                {entry.agentName}
              </Link>
              {' '}
              {summaryTail}
            </>
          ) : (
            summary
          )}
          {billId && billTitle && (
            <>
              {' — '}
              <Link to={`/legislation/${billId}`} className="text-gold/80 hover:underline text-xs">
                {billTitle}
              </Link>
            </>
          )}
        </p>
      </div>
      <span className="text-xs text-text-muted whitespace-nowrap flex-shrink-0">
        {relativeTime(entry.createdAt)}
      </span>
    </div>
  );
}

/* ── SummarySidebar ─────────────────────────────────────────────────────── */

interface SidebarProps {
  entries: ActivityEntry[];
}

function SummarySidebar({ entries }: SidebarProps) {
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      const bucket = e.type.split('_')[0] ?? e.type;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 8);
  }, [entries]);

  const topAgents = useMemo(() => {
    const counts: Record<string, { name: string; id: string; count: number }> = {};
    for (const e of entries) {
      if (!e.agentId || !e.agentName) continue;
      if (!counts[e.agentId]) counts[e.agentId] = { name: e.agentName, id: e.agentId, count: 0 };
      counts[e.agentId]!.count += 1;
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [entries]);

  return (
    <div className="space-y-4">
      {/* Session Activity */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-serif text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide">
          Session Activity
        </h3>
        {typeCounts.length === 0 ? (
          <p className="text-xs text-text-muted">No activity yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {typeCounts.map(([bucket, count]) => (
              <li key={bucket} className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-secondary capitalize">{bucket.replace(/_/g, ' ')}</span>
                <span className="text-xs font-mono text-text-muted">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Most Active */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-serif text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide">
          Most Active
        </h3>
        {topAgents.length === 0 ? (
          <p className="text-xs text-text-muted">No agents yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {topAgents.map((agent, idx) => (
              <li key={agent.id} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] text-text-muted font-mono w-3 flex-shrink-0">{idx + 1}.</span>
                  <Link
                    to={`/agents/${agent.id}`}
                    className="text-xs text-gold hover:underline truncate"
                  >
                    {agent.name}
                  </Link>
                </div>
                <span className="text-xs font-mono text-text-muted flex-shrink-0">{agent.count}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────────── */

export function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const { subscribe } = useWebSocket();

  const LIMIT = 100;

  const filterRef = useRef(filter);
  filterRef.current = filter;

  const fetchEntries = useCallback(async (
    currentFilter: FilterOption,
    currentOffset: number,
    prepend = false,
  ) => {
    setError(null);
    if (!prepend) setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', String(LIMIT));
      params.set('offset', String(currentOffset));

      const apiType = FILTER_TO_API_TYPE[currentFilter];
      if (apiType) params.set('type', apiType);

      const res = await fetch(`/api/activity?${params.toString()}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json = await res.json() as {
        success: boolean;
        data?: { events: ActivityEntry[]; total: number };
        error?: string;
      };

      if (!json.success) throw new Error(json.error ?? 'Unknown error');

      let rows = json.data?.events ?? [];

      // Client-side filter for multi-type buckets
      if (currentFilter === 'bill_events' || currentFilter === 'deals') {
        rows = rows.filter((e) => matchesFilter(e, currentFilter));
      }

      setTotal(json.data?.total ?? 0);

      if (prepend) {
        setEntries((prev) => [...rows, ...prev]);
      } else if (currentOffset > 0) {
        setEntries((prev) => [...prev, ...rows]);
      } else {
        setEntries(rows);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset and reload on filter change
  useEffect(() => {
    setOffset(0);
    void fetchEntries(filter, 0);
  }, [filter, fetchEntries]);

  // WS live updates — subscribe to all relevant event types
  useEffect(() => {
    const refresh = () => { void fetchEntries(filterRef.current, 0, true); };
    const unsubs = [
      subscribe('agent:lobby', refresh),
      subscribe('bill:floor_amendment_proposed', refresh),
      subscribe('bill:amended', refresh),
      subscribe('bill:withdrawn', refresh),
      subscribe('agent:statement', refresh),
      subscribe('agent:vote', refresh),
      subscribe('bill:proposed', refresh),
      subscribe('bill:advanced', refresh),
      subscribe('bill:passed', refresh),
      subscribe('bill:resolved', refresh),
      subscribe('deal:proposed', refresh),
      subscribe('deal:accepted', refresh),
      subscribe('agent:deal_broken', refresh),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchEntries]);

  function loadMore() {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    void fetchEntries(filter, newOffset);
  }

  const hasMore = entries.length < total;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-semibold text-text-primary">Capitol Activity</h1>
        <p className="text-sm text-text-muted mt-1">Live feed of all simulation events</p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
              filter === opt.value
                ? 'bg-gold/10 border-gold/50 text-gold'
                : 'border-border text-text-muted hover:text-text-secondary hover:border-border/80'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Two-column layout on lg+ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Feed (left) */}
        <div>
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-24">
              <p className="text-text-muted animate-pulse">Loading activity...</p>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-700/30 bg-red-900/10 px-5 py-4 text-sm text-red-300">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-20 text-text-muted">
              <p className="text-lg">The legislature is quiet. No activity recorded yet.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface divide-y divide-border/40">
              {entries.map((entry) => (
                <div key={entry.id} className="px-4 py-1">
                  <FeedEntry entry={entry} />
                </div>
              ))}
            </div>
          )}

          {/* Load more */}
          {hasMore && !loading && entries.length > 0 && (
            <div className="flex justify-center mt-4">
              <button
                onClick={loadMore}
                className="px-6 py-2 rounded border border-border text-sm text-text-muted hover:text-text-secondary hover:border-border/80 transition-colors"
              >
                Load more
              </button>
            </div>
          )}

          {/* Loading more indicator */}
          {loading && entries.length > 0 && (
            <div className="flex justify-center mt-4">
              <p className="text-text-muted animate-pulse text-sm">Loading...</p>
            </div>
          )}
        </div>

        {/* Sidebar (right) */}
        <div>
          <SummarySidebar entries={entries} />
        </div>
      </div>
    </div>
  );
}
