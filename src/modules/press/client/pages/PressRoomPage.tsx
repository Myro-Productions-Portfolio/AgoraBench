import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { pressApi } from '@core/client/lib/api';

/* ── Types ──────────────────────────────────────────────────────────────── */

type TriggerType =
  | 'bill_passed'
  | 'bill_failed'
  | 'bill_vetoed'
  | 'election_won'
  | 'election_lost'
  | 'deal_broken'
  | 'proactive'
  | 'bill_proposed';

interface PressStatement {
  id: string;
  agentId: string;
  agentName: string;
  statementText: string;
  triggerType: TriggerType;
  triggerBillId: string | null;
  triggerElectionId: string | null;
  triggerDealId: string | null;
  approvalDelta: number | null;
  isPublic: boolean;
  createdAt: string;
}

interface GazetteIssue {
  id: string;
  tickId: string | null;
  headline: string;
  body: string;
  createdAt: string;
}

/* ── Constants ──────────────────────────────────────────────────────────── */

const TRIGGER_COLORS: Record<TriggerType, string> = {
  bill_passed: 'text-green-300 bg-green-900/20 border-green-700/30',
  bill_failed: 'text-red-300 bg-red-900/20 border-red-700/30',
  bill_vetoed: 'text-orange-300 bg-orange-900/20 border-orange-700/30',
  election_won: 'text-gold bg-yellow-900/20 border-yellow-700/30',
  election_lost: 'text-stone/60 bg-stone/10 border-stone/20',
  deal_broken: 'text-red-400 bg-red-900/30 border-red-700/40',
  proactive: 'text-blue-300 bg-blue-900/20 border-blue-700/30',
  bill_proposed: 'text-blue-300 bg-blue-900/20 border-blue-700/30',
};

const TRIGGER_LABELS: Record<TriggerType, string> = {
  bill_passed: 'Bill Passed',
  bill_failed: 'Bill Failed',
  bill_vetoed: 'Veto Response',
  election_won: 'Election Won',
  election_lost: 'Election Statement',
  deal_broken: 'Deal Broken',
  proactive: 'Statement',
  bill_proposed: 'Bill Proposed',
};

type FilterOption = 'all' | 'bill_advocacy' | 'veto_response' | 'election' | 'deal' | 'proactive';

const FILTER_OPTIONS: Array<{ value: FilterOption; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'bill_advocacy', label: 'Bill Advocacy' },
  { value: 'veto_response', label: 'Veto Response' },
  { value: 'election', label: 'Election' },
  { value: 'deal', label: 'Deal' },
  { value: 'proactive', label: 'Proactive' },
];

/* Maps UI filter buckets to the triggerType values sent to the API */
const FILTER_TO_TRIGGER: Record<FilterOption, string | undefined> = {
  all: undefined,
  bill_advocacy: 'bill_passed',   // server side filtering by single type; multi-type handled client-side
  veto_response: 'bill_vetoed',
  election: 'election_won',
  deal: 'deal_broken',
  proactive: 'proactive',
};

/* Filters that map to multiple trigger types — applied client-side */
const MULTI_TRIGGER_MAP: Record<FilterOption, TriggerType[] | undefined> = {
  all: undefined,
  bill_advocacy: ['bill_passed', 'bill_failed', 'bill_proposed'],
  veto_response: ['bill_vetoed'],
  election: ['election_won', 'election_lost'],
  deal: ['deal_broken'],
  proactive: ['proactive'],
};

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

function getTriggerColor(triggerType: string): string {
  return TRIGGER_COLORS[triggerType as TriggerType] ?? 'text-text-muted bg-black/20 border-border/40';
}

function getTriggerLabel(triggerType: string): string {
  return TRIGGER_LABELS[triggerType as TriggerType] ?? triggerType.replace(/_/g, ' ');
}

/* ── StatementText: collapsible 280-char preview ────────────────────────── */

function StatementText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LEN = 280;
  const needsTruncation = text.length > PREVIEW_LEN;
  const displayText = !needsTruncation || expanded ? text : `${text.slice(0, PREVIEW_LEN)}…`;

  return (
    <div>
      <p className="text-sm text-text-secondary leading-relaxed">{displayText}</p>
      {needsTruncation && (
        <button
          onClick={() => setExpanded((p) => !p)}
          className="mt-1 text-xs text-gold hover:text-gold/80 transition-colors"
        >
          {expanded ? '▲ Collapse' : '▼ Read full statement'}
        </button>
      )}
    </div>
  );
}

/* ── StatementCard ──────────────────────────────────────────────────────── */

function StatementCard({ statement }: { statement: PressStatement }) {
  const triggerColor = getTriggerColor(statement.triggerType);
  const triggerLabel = getTriggerLabel(statement.triggerType);

  return (
    <article className="rounded-lg border border-border bg-surface p-5 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <Link
              to={`/agents/${statement.agentId}`}
              className="text-sm font-medium text-gold hover:underline"
            >
              {statement.agentName}
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`badge border ${triggerColor}`}>
            {triggerLabel}
          </span>
          <span className="text-xs text-text-muted whitespace-nowrap">
            {relativeTime(statement.createdAt)}
          </span>
        </div>
      </div>

      {/* Context link */}
      {statement.triggerBillId && (
        <p className="text-xs text-text-muted">
          Re:{' '}
          <Link
            to={`/legislation/${statement.triggerBillId}`}
            className="text-gold hover:underline"
          >
            View Bill
          </Link>
        </p>
      )}

      {/* Statement text */}
      <StatementText text={statement.statementText} />
    </article>
  );
}

/* ── GazetteIssueCard: one issue, latest rendered in full ───────────────── */

function fmtIssueDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function GazetteIssueCard({ issue, latest }: { issue: GazetteIssue; latest?: boolean }) {
  const [expanded, setExpanded] = useState(!!latest);
  const paragraphs = issue.body.split(/\n+/).filter((p) => p.trim().length > 0);

  return (
    <article className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {latest && (
            <span className="badge border text-gold bg-yellow-900/20 border-yellow-700/30 mb-2 inline-block">
              Latest Issue
            </span>
          )}
          <h2 className="font-serif text-xl font-semibold text-stone leading-snug">{issue.headline}</h2>
          <p className="text-xs text-text-muted mt-1">The Agora Gazette — {fmtIssueDate(issue.createdAt)}</p>
        </div>
        {!latest && (
          <button
            onClick={() => setExpanded((p) => !p)}
            aria-expanded={expanded}
            className="text-xs text-gold hover:text-gold/80 transition-colors flex-shrink-0"
          >
            {expanded ? '▲ Collapse' : '▼ Read'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="space-y-2 pt-1 border-t border-border/50">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-sm text-text-secondary leading-relaxed">{p}</p>
          ))}
        </div>
      )}
    </article>
  );
}

/* ── GazetteSection: Daily Gazette feed ─────────────────────────────────── */

function GazetteSection() {
  const [issues, setIssues] = useState<GazetteIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe } = useWebSocket();

  const GAZETTE_LIMIT = 20;

  const fetchIssues = useCallback(async (offset: number, append = false) => {
    setError(null);
    setLoading(true);
    try {
      const res = await pressApi.gazette(GAZETTE_LIMIT, offset);
      const data = res.data as { issues: GazetteIssue[]; total: number } | undefined;
      const rows = data?.issues ?? [];
      setTotal(data?.total ?? 0);
      setIssues((prev) => (append ? [...prev, ...rows] : rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gazette issues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchIssues(0);
  }, [fetchIssues]);

  /* New issue published at tick end — refresh from the top */
  useEffect(() => {
    const unsub = subscribe('press:gazette', () => {
      void fetchIssues(0);
    });
    return unsub;
  }, [subscribe, fetchIssues]);

  if (loading && issues.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-text-muted animate-pulse">Loading gazette...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-700/30 bg-red-900/10 px-5 py-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="text-center py-20 text-text-muted">
        <p className="text-lg">No gazette issues yet — the first issue publishes after the next simulation tick.</p>
      </div>
    );
  }

  const [latest, ...previous] = issues;
  const hasMore = issues.length < total;

  return (
    <div className="space-y-4">
      <GazetteIssueCard issue={latest} latest />

      {previous.length > 0 && (
        <>
          <h3 className="font-serif text-lg font-semibold text-stone pt-2">Previous Issues</h3>
          <div className="space-y-3">
            {previous.map((issue) => (
              <GazetteIssueCard key={issue.id} issue={issue} />
            ))}
          </div>
        </>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => void fetchIssues(issues.length, true)}
            disabled={loading}
            className="px-6 py-2 rounded border border-border text-sm text-text-muted hover:text-text-secondary hover:border-border/80 transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────────── */

type PressView = 'statements' | 'gazette';

export function PressRoomPage() {
  const [view, setView] = useState<PressView>('statements');
  const [statements, setStatements] = useState<PressStatement[]>([]);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const { subscribe } = useWebSocket();

  const LIMIT = 50;

  // Keep a ref to the current filter so WS handler can use latest value
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const fetchStatements = useCallback(async (currentFilter: FilterOption, currentOffset: number, prepend = false) => {
    setError(null);
    if (!prepend) setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', String(LIMIT));
      params.set('offset', String(currentOffset));

      // For multi-type filters, fetch without triggerType and filter client-side
      const multiTypes = MULTI_TRIGGER_MAP[currentFilter];
      const isSingleType = multiTypes && multiTypes.length === 1;
      const isMultiType = multiTypes && multiTypes.length > 1;

      if (isSingleType) {
        params.set('triggerType', multiTypes[0]);
      } else if (!isMultiType && FILTER_TO_TRIGGER[currentFilter]) {
        params.set('triggerType', FILTER_TO_TRIGGER[currentFilter]!);
      }

      const res = await fetch(`/api/press?${params.toString()}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json = await res.json() as {
        success: boolean;
        data?: { statements: PressStatement[]; total: number };
        error?: string;
      };

      if (!json.success) throw new Error(json.error ?? 'Unknown error');

      let rows = json.data?.statements ?? [];

      // Client-side multi-type filter
      if (isMultiType && multiTypes) {
        const typeSet = new Set<string>(multiTypes);
        rows = rows.filter((s) => typeSet.has(s.triggerType));
      }

      setTotal(json.data?.total ?? 0);

      if (prepend) {
        setStatements((prev) => [...rows, ...prev]);
      } else if (currentOffset > 0) {
        setStatements((prev) => [...prev, ...rows]);
      } else {
        setStatements(rows);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statements');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + filter changes reset to page 0
  useEffect(() => {
    setOffset(0);
    void fetchStatements(filter, 0);
  }, [filter, fetchStatements]);

  // WS: prepend new statements
  useEffect(() => {
    const unsub = subscribe('agent:statement', () => {
      void fetchStatements(filterRef.current, 0, true);
    });
    return unsub;
  }, [subscribe, fetchStatements]);

  function loadMore() {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    void fetchStatements(filter, newOffset);
  }

  const hasMore = statements.length < total;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface px-6 py-5">
        <h1 className="font-serif text-2xl font-semibold text-text-primary">Press Room</h1>
        <p className="text-sm text-text-muted mt-1">
          {view === 'gazette'
            ? 'The Daily Gazette — a recap of each simulation tick'
            : 'Official statements from simulation agents'}
        </p>
      </div>

      {/* View toggle: Statements | Gazette */}
      <div className="flex flex-wrap gap-2">
        {([
          { value: 'statements', label: 'Statements' },
          { value: 'gazette', label: 'Daily Gazette' },
        ] as Array<{ value: PressView; label: string }>).map((opt) => (
          <button
            key={opt.value}
            onClick={() => setView(opt.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
              view === opt.value
                ? 'bg-gold/10 border-gold/50 text-gold'
                : 'border-border text-text-muted hover:text-text-secondary hover:border-border/80'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Gazette view */}
      {view === 'gazette' && <GazetteSection />}

      {/* Statements view: filter bar */}
      {view === 'statements' && (
      <div className="flex flex-wrap gap-2">
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
      )}

      {/* Statements content */}
      {view !== 'statements' ? null : loading && statements.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <p className="text-text-muted animate-pulse">Loading statements...</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-700/30 bg-red-900/10 px-5 py-4 text-sm text-red-300">
          {error}
        </div>
      ) : statements.length === 0 ? (
        <div className="text-center py-20 text-text-muted">
          <p className="text-lg">No official statements have been issued yet.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {statements.map((s) => (
              <StatementCard key={s.id} statement={s} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={loadMore}
                disabled={loading}
                className="px-6 py-2 rounded border border-border text-sm text-text-muted hover:text-text-secondary hover:border-border/80 transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
