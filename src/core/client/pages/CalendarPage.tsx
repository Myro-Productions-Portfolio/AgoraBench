import { useState, useEffect, useCallback } from 'react';
import { SectionHeader } from '../components/SectionHeader';
import { EventDetailModal } from '../components/EventDetailModal';
import { calendarApi } from '../lib/api';

interface GovernmentEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  scheduledAt: string;
  durationMinutes: number;
  locationBuildingId: string | null;
  status: string;
  outcome: string | null;
  isPublic: boolean;
}

interface LegacyEvent {
  type: string;
  label: string;
  date: string;
  detail: string;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  committee_hearing: 'border-l-gold bg-gold/5',
  floor_session: 'border-l-slate-judicial bg-slate-judicial/5',
  cabinet_meeting: 'border-l-stone bg-stone/5',
  press_briefing: 'border-l-status-active bg-status-active/5',
  judicial_hearing: 'border-l-blue-400 bg-blue-400/5',
  party_caucus: 'border-l-danger bg-danger/5',
  election_rally: 'border-l-gold-bright bg-gold-bright/5',
  budget_session: 'border-l-status-committee bg-status-committee/5',
  constitutional_review: 'border-l-stone-light bg-stone-light/5',
  election: 'border-l-gold bg-gold/5',
  position_expiry: 'border-l-blue-400 bg-blue-400/5',
};

const EVENT_TYPE_DOT: Record<string, string> = {
  committee_hearing: 'bg-gold',
  floor_session: 'bg-slate-judicial',
  cabinet_meeting: 'bg-stone',
  press_briefing: 'bg-status-active',
  judicial_hearing: 'bg-blue-400',
  party_caucus: 'bg-danger',
  election_rally: 'bg-gold-bright',
  budget_session: 'bg-status-committee',
  constitutional_review: 'bg-stone-light',
  election: 'bg-gold',
  position_expiry: 'bg-blue-400',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  committee_hearing: 'Committee Hearing',
  floor_session: 'Floor Session',
  cabinet_meeting: 'Cabinet Meeting',
  press_briefing: 'Press Briefing',
  judicial_hearing: 'Judicial Hearing',
  party_caucus: 'Party Caucus',
  election_rally: 'Election Rally',
  budget_session: 'Budget Session',
  constitutional_review: 'Constitutional Review',
  election: 'Election',
  position_expiry: 'Position',
};

const STATUS_BADGE: Record<string, string> = {
  scheduled: 'text-text-muted',
  in_progress: 'text-status-active',
  completed: 'text-status-passed',
  cancelled: 'text-danger',
};

function formatTime(date: string): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDay(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}


function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

/* Merge gov events + legacy events into a unified shape */
interface UnifiedEvent {
  id: string;
  type: string;
  title: string;
  date: string;
  status: string;
  duration: number;
  location: string | null;
  description: string;
  outcome: string | null;
  raw: GovernmentEvent | null;
}

function mergeEvents(govEvents: GovernmentEvent[], legacyEvents: LegacyEvent[]): UnifiedEvent[] {
  const fromGov: UnifiedEvent[] = govEvents.map((e) => ({
    id: e.id,
    type: e.type,
    title: e.title,
    date: e.scheduledAt,
    status: e.status,
    duration: e.durationMinutes,
    location: e.locationBuildingId,
    description: e.description,
    outcome: e.outcome,
    raw: e,
  }));

  const fromLegacy: UnifiedEvent[] = legacyEvents.map((e, idx) => ({
    id: `legacy-${idx}`,
    type: e.type,
    title: e.label,
    date: e.date,
    status: 'scheduled',
    duration: 0,
    location: null,
    description: e.detail,
    outcome: null,
    raw: null,
  }));

  return [...fromGov, ...fromLegacy].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}

/* ─── Agenda View ─────────────────────────────────────────────── */
function AgendaView({
  events,
  onSelect,
}: {
  events: UnifiedEvent[];
  onSelect: (e: UnifiedEvent) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="text-center py-16 text-text-muted">
        <p>No events in this period.</p>
      </div>
    );
  }

  /* Group by day */
  const groups: { day: string; events: UnifiedEvent[] }[] = [];
  for (const ev of events) {
    const day = formatDay(ev.date);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.events.push(ev);
    } else {
      groups.push({ day, events: [ev] });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ day, events: dayEvents }) => (
        <div key={day}>
          <div className="text-badge text-text-muted uppercase tracking-widest mb-2 pb-1 border-b border-border/40">
            {day}
          </div>
          <div className="flex flex-col gap-2">
            {dayEvents.map((ev) => {
              const borderColor = EVENT_TYPE_COLORS[ev.type] ?? 'border-l-border bg-black/10';
              const dotColor = EVENT_TYPE_DOT[ev.type] ?? 'bg-border';
              const typeLabel = EVENT_TYPE_LABELS[ev.type] ?? ev.type.replace(/_/g, ' ');
              const statusColor = STATUS_BADGE[ev.status] ?? 'text-text-muted';

              return (
                <button
                  key={ev.id}
                  className={`text-left w-full card p-3 pl-4 flex items-start gap-3 border-l-2 hover:brightness-110 transition-all ${borderColor}`}
                  onClick={() => onSelect(ev)}
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-text-primary truncate">{ev.title}</span>
                      <span className={`text-badge ${statusColor}`}>{ev.status}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-badge text-text-muted">
                      <span>{typeLabel}</span>
                      {ev.duration > 0 && <span>{formatTime(ev.date)} · {ev.duration}min</span>}
                      {ev.location && <span>{ev.location.replace(/-/g, ' ')}</span>}
                    </div>
                    {ev.description && (
                      <p className="text-xs text-text-muted mt-1 truncate">{ev.description}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Month View ──────────────────────────────────────────────── */
function MonthView({
  events,
  year,
  month,
  onSelect,
  onPrev,
  onNext,
}: {
  events: UnifiedEvent[];
  year: number;
  month: number;
  onSelect: (e: UnifiedEvent) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDay }, (_, i) => i);

  const eventsByDay: Record<number, UnifiedEvent[]> = {};
  for (const ev of events) {
    const d = new Date(ev.date);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!eventsByDay[day]) eventsByDay[day] = [];
      eventsByDay[day].push(ev);
    }
  }

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onPrev}
          className="text-text-muted hover:text-text-primary transition-colors px-3 py-1 rounded border border-border/50 hover:border-border text-xs"
        >
          ← Prev
        </button>
        <span className="font-serif text-section-title text-stone">{monthLabel}</span>
        <button
          onClick={onNext}
          className="text-text-muted hover:text-text-primary transition-colors px-3 py-1 rounded border border-border/50 hover:border-border text-xs"
        >
          Next →
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center text-badge text-text-muted uppercase tracking-wide py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 border-l border-t border-border">
        {blanks.map((i) => (
          <div key={`blank-${i}`} className="border-r border-b border-border min-h-[80px] bg-black/10" />
        ))}
        {days.map((day) => {
          const dayEvents = eventsByDay[day] ?? [];
          const today = isToday(day);
          return (
            <div
              key={day}
              className={`border-r border-b border-border min-h-[80px] p-1.5 ${
                today ? 'bg-gold/5' : ''
              }`}
            >
              <div
                className={`text-xs font-mono w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                  today ? 'bg-gold text-capitol-deep font-bold' : 'text-text-muted'
                }`}
              >
                {day}
              </div>
              <div className="flex flex-col gap-0.5">
                {dayEvents.slice(0, 3).map((ev) => {
                  const dotColor = EVENT_TYPE_DOT[ev.type] ?? 'bg-border';
                  return (
                    <button
                      key={ev.id}
                      onClick={() => onSelect(ev)}
                      className="text-left w-full flex items-center gap-1 hover:bg-white/5 rounded px-0.5 py-0.5 transition-colors"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                      <span className="text-[10px] text-text-secondary truncate leading-tight">
                        {ev.title}
                      </span>
                    </button>
                  );
                })}
                {dayEvents.length > 3 && (
                  <span className="text-[10px] text-text-muted pl-2">+{dayEvents.length - 3} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main Page ───────────────────────────────────────────────── */
export function CalendarPage() {
  const [govEvents, setGovEvents] = useState<GovernmentEvent[]>([]);
  const [legacyEvents, setLegacyEvents] = useState<LegacyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'agenda' | 'month'>('agenda');
  const [selectedEvent, setSelectedEvent] = useState<UnifiedEvent | null>(null);
  const now = new Date();
  const [monthYear, setMonthYear] = useState({ year: now.getFullYear(), month: now.getMonth() });

  const fetchEvents = useCallback(async () => {
    try {
      const res = await calendarApi.upcoming();
      const data = res.data as { events?: GovernmentEvent[]; legacy?: LegacyEvent[] } | null;
      if (data) {
        setGovEvents(data.events ?? []);
        setLegacyEvents(data.legacy ?? []);
      }
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const allEvents = mergeEvents(govEvents, legacyEvents);
  const total = allEvents.length;

  const handleSelect = (ev: UnifiedEvent) => {
    if (ev.raw) {
      setSelectedEvent(ev);
    }
  };

  if (loading) {
    return (
      <div className="px-8 xl:px-16 py-section">
        <SectionHeader title="Government Calendar" badge="Loading..." />
        <div className="flex items-center justify-center py-24">
          <p className="text-text-muted animate-pulse">Loading calendar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 xl:px-16 py-section">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <SectionHeader title="Government Calendar" badge={`${total} Event${total !== 1 ? 's' : ''}`} />

        {/* View toggle */}
        <div className="flex gap-1 border border-border rounded overflow-hidden">
          {(['agenda', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 text-xs uppercase tracking-wide font-medium transition-colors ${
                view === v
                  ? 'bg-gold/20 text-gold'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/[0.04]'
              }`}
            >
              {v === 'agenda' ? 'Agenda' : 'Month'}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-6">
        {Object.entries(EVENT_TYPE_LABELS).slice(0, 6).map(([type, label]) => (
          <div key={type} className="flex items-center gap-1.5 text-badge text-text-muted">
            <span className={`w-2 h-2 rounded-full ${EVENT_TYPE_DOT[type] ?? 'bg-border'}`} />
            {label}
          </div>
        ))}
      </div>

      {view === 'agenda' ? (
        <AgendaView events={allEvents} onSelect={handleSelect} />
      ) : (
        <MonthView
          events={allEvents}
          year={monthYear.year}
          month={monthYear.month}
          onSelect={handleSelect}
          onPrev={() =>
            setMonthYear((prev) => {
              const d = new Date(prev.year, prev.month - 1, 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            })
          }
          onNext={() =>
            setMonthYear((prev) => {
              const d = new Date(prev.year, prev.month + 1, 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            })
          }
        />
      )}

      {/* Event detail modal — only for gov events (legacy have no raw data) */}
      <EventDetailModal
        event={selectedEvent?.raw ?? null}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
