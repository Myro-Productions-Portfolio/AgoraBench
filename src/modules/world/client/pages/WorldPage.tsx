import { useState, useEffect, useCallback } from 'react';
import { worldApi } from '@core/client/lib/api';
import { EmptyState } from '@core/client/components/EmptyState';

/* ── Types (mirror GET /api/world/events) ───────────────────────────────── */

type WorldEventCategory = 'earthquake' | 'weather' | 'disaster' | 'news' | 'market';

interface WorldEvent {
  id: string;
  source: string;
  externalId: string;
  occurredAt: string;
  category: WorldEventCategory;
  severity: number;
  title: string;
  summary: string;
  location: string | null;
  status: string;
  exogeneityNote: string;
  fetchedAt: string;
}

interface WorldEventsResponse {
  events: WorldEvent[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/* ── Source provenance links ─────────────────────────────────────────────
   Each source's canonical public listing -- not per-event deep links, since
   the raw payload's own URL fields vary by source and this slice keeps the
   spectator surface simple (provenance by source, not by exact record). */
const SOURCE_LINKS: Record<string, { label: string; url: string }> = {
  usgs: { label: 'USGS Earthquake Hazards Program', url: 'https://earthquake.usgs.gov/earthquakes/map/' },
  nws: { label: 'National Weather Service Alerts', url: 'https://www.weather.gov/alerts' },
  openfema: { label: 'OpenFEMA Disaster Declarations', url: 'https://www.fema.gov/disaster/declarations' },
};

const CATEGORY_STYLES: Record<WorldEventCategory, string> = {
  earthquake: 'text-orange-300 bg-orange-900/20 border-orange-700/30',
  weather: 'text-sky-300 bg-sky-900/20 border-sky-700/30',
  disaster: 'text-red-400 bg-red-900/20 border-red-700/30',
  news: 'text-violet-300 bg-violet-900/20 border-violet-700/30',
  market: 'text-emerald-300 bg-emerald-900/20 border-emerald-700/30',
};

function CategoryBadge({ category }: { category: WorldEventCategory }) {
  return (
    <span
      className={`badge border text-badge uppercase tracking-widest ${CATEGORY_STYLES[category]}`}
    >
      {category}
    </span>
  );
}

function SeverityBar({ severity }: { severity: number }) {
  const pct = Math.max(0, Math.min(1, severity)) * 100;
  const colorClass = severity >= 0.75 ? 'bg-red-400' : severity >= 0.5 ? 'bg-yellow-400' : 'bg-gold/70';
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="h-1.5 flex-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <span className="text-[11px] font-mono text-text-muted shrink-0">{severity.toFixed(2)}</span>
    </div>
  );
}

function formatOccurredAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function EventCard({ event }: { event: WorldEvent }) {
  const provenance = SOURCE_LINKS[event.source];
  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-serif text-base font-semibold text-stone truncate">{event.title}</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {formatOccurredAt(event.occurredAt)}
            {event.location && <span> &middot; State FIPS {event.location}</span>}
          </p>
        </div>
        <CategoryBadge category={event.category} />
      </div>

      <p className="text-sm text-text-secondary">{event.summary}</p>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/30">
        <SeverityBar severity={event.severity} />
        {provenance && (
          <a
            href={provenance.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gold hover:underline shrink-0"
          >
            Source: {provenance.label} ↗
          </a>
        )}
      </div>
    </div>
  );
}

export function WorldPage() {
  const [data, setData] = useState<WorldEventsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchEvents = useCallback((p: number) => {
    setLoading(true);
    worldApi.events(p, 25)
      .then((res) => {
        if (res.data) setData(res.data as WorldEventsResponse);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchEvents(page); }, [page, fetchEvents]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-stone">World Events</h1>
        <p className="text-sm text-text-muted mt-1">
          Real-world events pulled from USGS, the National Weather Service, and FEMA — the same
          world the AI government will eventually respond to. This feed is currently read-only and
          observational: nothing here is injected into the simulation yet.
        </p>
      </div>

      {loading && !data && (
        <div className="text-center text-text-muted text-sm py-16">Loading...</div>
      )}

      {error && (
        <div className="rounded border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          World events data unavailable.
        </div>
      )}

      {data && data.events.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <EmptyState
            title="No world events recorded yet."
            hint="This feed is dark by default — an operator enables it, then USGS, NWS, and FEMA events accumulate here over time."
          />
        </div>
      )}

      {data && data.events.length > 0 && (
        <>
          <div className="space-y-4">
            {data.events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 text-sm rounded border border-border text-text-secondary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              Previous
            </button>
            <span className="text-xs text-text-muted">
              Page {data.pagination.page} of {data.pagination.totalPages} &middot; {data.pagination.total} event{data.pagination.total === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
              disabled={page >= data.pagination.totalPages || loading}
              className="px-3 py-1.5 text-sm rounded border border-border text-text-secondary disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
