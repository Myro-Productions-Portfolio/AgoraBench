import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { pressApi } from '@core/client/lib/api';
import { PixelAvatar } from '@modules/agents/client/components/PixelAvatar';
import { CALIBRATED_MARKERS, ROLE_STYLE, PODIUM_POSITION } from '../briefingSeats';

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

const PODIUM_LEFT = `${(PODIUM_POSITION.x / PODIUM_POSITION.viewBoxWidth) * 100}%`;
const PODIUM_TOP = `${(PODIUM_POSITION.y / PODIUM_POSITION.viewBoxHeight) * 100}%`;

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

function fmtDelta(delta: number): string {
  return Math.abs(delta).toFixed(1);
}

/* ── DeltaChip: approval-impact badge, colored by sign ──────────────────── */

function DeltaChip({ delta, label }: { delta: number | null; label?: boolean }) {
  const value = delta ?? 0;
  let sign: string;
  let color: string;
  if (value > 0) {
    sign = `▲ +${fmtDelta(value)}`;
    color = 'text-green-300';
  } else if (value < 0) {
    sign = `▼ −${fmtDelta(value)}`;
    color = 'text-red-300';
  } else {
    sign = '± 0.0';
    color = 'text-text-muted';
  }

  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={`text-sm font-semibold tabular-nums ${color}`}>{sign}</span>
      {label && <span className="text-[10px] uppercase tracking-wide text-text-muted">approval impact</span>}
    </span>
  );
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
        <div className="flex items-center gap-2 min-w-0">
          <PixelAvatar seed={statement.agentId} size="sm" className="rounded flex-shrink-0" />
          <Link
            to={`/agents/${statement.agentId}`}
            className="text-sm font-medium text-gold hover:underline truncate"
          >
            {statement.agentName}
          </Link>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <DeltaChip delta={statement.approvalDelta} label />
          <div className="flex flex-col items-end gap-1">
            <span className={`badge border ${triggerColor}`}>{triggerLabel}</span>
            <span className="text-xs text-text-muted whitespace-nowrap">
              {relativeTime(statement.createdAt)}
            </span>
          </div>
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

/* ── Biggest Movers: client-side aggregation over the loaded feed ───────── */

interface MoverEntry {
  agentId: string;
  agentName: string;
  net: number;
}

function computeMovers(statements: PressStatement[]): MoverEntry[] {
  const acc = new Map<string, MoverEntry>();
  for (const s of statements) {
    const delta = s.approvalDelta ?? 0;
    const existing = acc.get(s.agentId);
    if (existing) {
      existing.net += delta;
    } else {
      acc.set(s.agentId, { agentId: s.agentId, agentName: s.agentName, net: delta });
    }
  }
  return Array.from(acc.values())
    .filter((m) => m.net !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 6);
}

function BiggestMovers({ movers }: { movers: MoverEntry[] }) {
  if (movers.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-serif text-lg font-semibold text-stone">Biggest Movers</h3>
        <span className="badge border text-gold bg-yellow-900/20 border-yellow-700/30">this cycle</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {movers.map((m) => (
          <Link
            key={m.agentId}
            to={`/agents/${m.agentId}`}
            className="flex-shrink-0 w-40 rounded-lg border border-border bg-surface p-3 space-y-2 hover:border-border/80 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <PixelAvatar seed={m.agentId} size="sm" className="rounded flex-shrink-0" />
              <span className="text-sm font-medium text-text-secondary truncate">{m.agentName}</span>
            </div>
            <DeltaChip delta={m.net} label />
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ── BackfiredCallout: most-negative statement in the loaded feed ───────── */

function BackfiredCallout({ statement }: { statement: PressStatement }) {
  const snippet =
    statement.statementText.length > 120
      ? `${statement.statementText.slice(0, 120)}…`
      : statement.statementText;

  return (
    <div className="rounded-lg border border-red-700/40 bg-red-900/15 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <PixelAvatar seed={statement.agentId} size="sm" className="rounded flex-shrink-0" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-red-300">⚠ Backfired</span>
              <Link
                to={`/agents/${statement.agentId}`}
                className="text-sm font-medium text-gold hover:underline truncate"
              >
                {statement.agentName}
              </Link>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">{snippet}</p>
          </div>
        </div>
        <DeltaChip delta={statement.approvalDelta} label />
      </div>
    </div>
  );
}

/* ── BriefingRoomTab: reference-art seat overlay ────────────────────────── */

function BriefingRoomTab({ statements }: { statements: PressStatement[] }) {
  const occupants = useMemo(() => {
    const seen = new Set<string>();
    const unique: PressStatement[] = [];
    for (const s of statements) {
      if (!seen.has(s.agentId)) {
        seen.add(s.agentId);
        unique.push(s);
      }
    }
    return unique;
  }, [statements]);

  const podium = occupants[0] ?? null;

  // Markers split by role — order in the array is preserved for stable seating.
  const speakerMarkers = useMemo(() => CALIBRATED_MARKERS.filter((m) => m.role === 'speaker'), []);
  const guestMarkers = useMemo(() => CALIBRATED_MARKERS.filter((m) => m.role === 'guest'), []);
  const pressMarkers = useMemo(() => CALIBRATED_MARKERS.filter((m) => m.role === 'press'), []);

  // Everyone after the podium fills the featured on-stage speaker spots first,
  // then the flanking guest spots, then the press seats. Never invent agents —
  // markers beyond the available authors stay empty.
  const rest = occupants.slice(1);
  const speakerCount = Math.min(speakerMarkers.length, rest.length);
  const guestCount = Math.min(guestMarkers.length, Math.max(rest.length - speakerCount, 0));
  const pressCount = Math.min(
    pressMarkers.length,
    Math.max(rest.length - speakerCount - guestCount, 0),
  );

  // Fill guests left/right alternating so partial occupancy stays balanced across
  // both flanks instead of clustering on one side.
  const guestOccupied = useMemo(() => {
    const order = [...guestMarkers]
      .map((m, idx) => ({ m, idx }))
      .sort((a, b) => (a.m.role === 'guest' && b.m.role === 'guest' ? a.m.i - b.m.i : 0));
    // Interleave: right0, left0, right1, left1, ... then take guestCount from the front.
    const rights = order.filter((o) => o.m.role === 'guest' && o.m.side === 'right');
    const lefts = order.filter((o) => o.m.role === 'guest' && o.m.side === 'left');
    const interleaved: number[] = [];
    for (let k = 0; k < Math.max(rights.length, lefts.length); k++) {
      if (rights[k]) interleaved.push(rights[k].idx);
      if (lefts[k]) interleaved.push(lefts[k].idx);
    }
    return new Set(interleaved.slice(0, guestCount));
  }, [guestMarkers, guestCount]);

  const [captionIdx, setCaptionIdx] = useState(0);
  useEffect(() => {
    if (statements.length < 2) return;
    const id = setInterval(() => {
      setCaptionIdx((i) => (i + 1) % Math.min(statements.length, 8));
    }, 5000);
    return () => clearInterval(id);
  }, [statements.length]);

  const caption = statements[captionIdx] ?? statements[0] ?? null;

  return (
    <div className="space-y-3">
      <div
        className="relative rounded-lg border border-border overflow-hidden bg-black/20"
        style={{ aspectRatio: '1264 / 848' }}
      >
        <img
          src="/images/briefing-room/briefing-room.png"
          alt="Press briefing room"
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Seat markers — three roles: speakers (on-stage), guests (flanking), press */}
        <svg
          viewBox="0 0 1000 671"
          className="absolute inset-0 w-full h-full"
          style={{ position: 'absolute', inset: 0 }}
          aria-hidden="true"
        >
          {speakerMarkers.map((m, i) => (
            <circle
              key={`speaker-${m.i}`}
              cx={m.x}
              cy={m.y}
              r={ROLE_STYLE.speaker.size / 2}
              fill={i < speakerCount ? ROLE_STYLE.speaker.active : ROLE_STYLE.speaker.base}
              opacity={i < speakerCount ? 0.95 : 0.45}
            />
          ))}
          {guestMarkers.map((m, i) => {
            const on = guestOccupied.has(i);
            return (
              <circle
                key={m.role === 'guest' ? `guest-${m.side}-${m.i}` : `guest-${i}`}
                cx={m.x}
                cy={m.y}
                r={ROLE_STYLE.guest.size / 2}
                fill={on ? ROLE_STYLE.guest.active : ROLE_STYLE.guest.base}
                opacity={on ? 0.95 : 0.45}
              />
            );
          })}
          {pressMarkers.map((m, i) => (
            <circle
              key={`press-${m.r}-${m.c}`}
              cx={m.x}
              cy={m.y}
              r={ROLE_STYLE.press.size / 2}
              fill={i < pressCount ? ROLE_STYLE.press.active : ROLE_STYLE.press.base}
              opacity={i < pressCount ? 0.95 : 0.45}
            />
          ))}
        </svg>

        {/* At-podium avatar */}
        {podium && (
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: PODIUM_LEFT, top: PODIUM_TOP }}
          >
            <Link to={`/agents/${podium.agentId}`}>
              <PixelAvatar
                seed={podium.agentId}
                size="sm"
                className="rounded ring-2 ring-gold/70 shadow-lg"
              />
            </Link>
          </div>
        )}

        {/* Reference-art label */}
        <span className="absolute bottom-2 right-2 text-[10px] text-text-muted bg-black/50 rounded px-1.5 py-0.5">
          Reference art · occupancy is simulated
        </span>

        {/* Rotating caption over real recent statements */}
        {caption && (
          <div className="absolute bottom-2 left-2 max-w-[60%] bg-black/55 rounded px-2 py-1">
            <span className="text-xs font-medium text-gold">{caption.agentName}</span>
            <span className="text-xs text-text-secondary">
              {' — '}
              {caption.statementText.length > 90
                ? `${caption.statementText.slice(0, 90)}…`
                : caption.statementText}
            </span>
          </div>
        )}
      </div>

      <p className="text-xs text-text-muted">
        The briefing room seats are calibrated to the reference art; occupancy is drawn from recent real
        statement authors.
      </p>
    </div>
  );
}

/* ── GazetteIssueCard: one issue, latest rendered in full ───────────────── */

function fmtIssueDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function GazetteFrontPage({ issue }: { issue: GazetteIssue }) {
  const paragraphs = issue.body.split(/\n+/).filter((p) => p.trim().length > 0);

  return (
    <article className="rounded-lg border border-border bg-surface p-6 space-y-3">
      <span className="badge border text-gold bg-yellow-900/20 border-yellow-700/30 inline-block">
        Current Edition
      </span>
      <h2 className="font-serif text-3xl font-bold text-stone leading-tight">{issue.headline}</h2>
      <p className="text-xs text-text-muted">The Agora Gazette — {fmtIssueDate(issue.createdAt)}</p>
      <div className="space-y-3 pt-2 border-t border-border/50">
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className={`text-sm text-text-secondary leading-relaxed ${
              i === 0
                ? 'first-letter:font-serif first-letter:text-4xl first-letter:font-bold first-letter:text-gold first-letter:float-left first-letter:mr-2 first-letter:leading-none'
                : ''
            }`}
          >
            {p}
          </p>
        ))}
      </div>
    </article>
  );
}

function GazetteIssueCard({ issue }: { issue: GazetteIssue }) {
  const [expanded, setExpanded] = useState(false);
  const paragraphs = issue.body.split(/\n+/).filter((p) => p.trim().length > 0);

  return (
    <article className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-xl font-semibold text-stone leading-snug">{issue.headline}</h2>
          <p className="text-xs text-text-muted mt-1">The Agora Gazette — {fmtIssueDate(issue.createdAt)}</p>
        </div>
        <button
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
          className="text-xs text-gold hover:text-gold/80 transition-colors flex-shrink-0"
        >
          {expanded ? '▲ Collapse' : '▼ Read'}
        </button>
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

function GazetteMasthead({ latestDate }: { latestDate: string | null }) {
  return (
    <div className="text-center space-y-1 border-y border-border py-5">
      <p className="text-xs uppercase tracking-[0.2em] text-text-muted">
        An Editorial Record of the Agora Simulation
      </p>
      <h2 className="font-serif text-4xl font-bold text-stone">The Agora Gazette</h2>
      <div className="flex items-center justify-center gap-3 text-xs text-text-muted pt-1">
        {latestDate && <span>{fmtIssueDate(latestDate)}</span>}
        {latestDate && <span aria-hidden="true">·</span>}
        <span>Published each simulation tick</span>
      </div>
    </div>
  );
}

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
      <div className="space-y-4">
        <GazetteMasthead latestDate={null} />
        <div className="text-center py-20 text-text-muted">
          <p className="text-lg">No gazette issues yet — the first issue publishes after the next simulation tick.</p>
        </div>
      </div>
    );
  }

  const [latest, ...previous] = issues;
  const hasMore = issues.length < total;

  return (
    <div className="space-y-4">
      <GazetteMasthead latestDate={latest.createdAt} />
      <GazetteFrontPage issue={latest} />

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

type PressView = 'briefing' | 'statements' | 'gazette';

export function PressRoomPage() {
  const [view, setView] = useState<PressView>('briefing');
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

  const movers = useMemo(() => computeMovers(statements), [statements]);
  const backfired = useMemo(() => {
    let worst: PressStatement | null = null;
    for (const s of statements) {
      const delta = s.approvalDelta ?? 0;
      if (delta < 0 && (worst === null || delta < (worst.approvalDelta ?? 0))) {
        worst = s;
      }
    }
    return worst;
  }, [statements]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface px-6 py-5">
        <h1 className="font-serif text-2xl font-semibold text-text-primary">Press Room</h1>
        <p className="text-sm text-text-muted mt-1">
          {view === 'gazette'
            ? 'The Daily Gazette — a recap of each simulation tick'
            : view === 'briefing'
            ? 'The press briefing room — where the Agora meets the record'
            : 'Official statements from simulation agents'}
        </p>
      </div>

      {/* View toggle: Briefing Room | Statements | Gazette */}
      <div className="flex flex-wrap gap-2">
        {([
          { value: 'briefing', label: 'Briefing Room' },
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

      {/* Briefing Room view */}
      {view === 'briefing' && <BriefingRoomTab statements={statements} />}

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
          <BiggestMovers movers={movers} />

          {backfired && <BackfiredCallout statement={backfired} />}

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
