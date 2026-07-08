import { useState, useEffect, useCallback, useRef } from 'react';
import { worldApi } from '@core/client/lib/api';
import { EmptyState } from '@core/client/components/EmptyState';
import { severityTier, SEVERITY_COLORS, SEVERITY_LABELS, type SeverityTier } from '@modules/world/client/lib/severityClient';
import { US_STATE_PATHS, US_STATE_CENTROIDS, US_MAP_VIEWBOX, FIPS_TO_STATE } from '@modules/world/client/lib/usStatePaths';

/* ── Types (mirror GET /api/world/events and GET /api/world/state-summary) ── */

type WorldEventCategory = 'earthquake' | 'weather' | 'disaster' | 'news' | 'market';
type CategoryFilter = 'all' | 'weather' | 'disaster' | 'earthquake';

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

interface StateAgg {
  fips: string;
  count: number;
  maxSeverity: number;
  topCategory: string;
}

interface StateSummaryResponse {
  states: StateAgg[];
  coastal: StateAgg[];
  nationwide: { totalAlerts: number; statesWithAlerts: number };
}

/* ── Constants ────────────────────────────────────────────────────────────── */

const POLL_INTERVAL_MS = 30_000;
const STATE_EVENTS_LIMIT = 25;
const HOTSPOT_COUNT = 6;

const CATEGORY_CHIPS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'weather', label: 'Weather' },
  { value: 'disaster', label: 'Disaster' },
  { value: 'earthquake', label: 'Quakes' },
];

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

/* ── Small presentational pieces ─────────────────────────────────────────── */

function CategoryBadge({ category }: { category: WorldEventCategory }) {
  return (
    <span className={`badge border text-badge uppercase tracking-widest ${CATEGORY_STYLES[category]}`}>
      {category}
    </span>
  );
}

function SeverityDot({ tier }: { tier: SeverityTier }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
      style={{ backgroundColor: SEVERITY_COLORS[tier] }}
    />
  );
}

function formatOccurredAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function EventRow({ event }: { event: WorldEvent }) {
  const provenance = SOURCE_LINKS[event.source];
  const tier = severityTier(event.severity);
  return (
    <li className="relative rounded-lg border border-border bg-surface pl-4 pr-4 py-3 overflow-hidden">
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: SEVERITY_COLORS[tier] }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-serif text-sm font-semibold text-stone truncate">{event.title}</h4>
          <p className="text-xs text-text-muted mt-0.5">{formatOccurredAt(event.occurredAt)}</p>
        </div>
        <CategoryBadge category={event.category} />
      </div>
      <p className="text-xs text-text-secondary mt-2">{event.summary}</p>
      <div className="flex items-center justify-between gap-3 mt-2 pt-2 border-t border-border/30">
        <span className="text-[11px] font-mono text-text-muted">{SEVERITY_LABELS[tier]} &middot; {event.severity.toFixed(2)}</span>
        {provenance && (
          <a
            href={provenance.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-gold hover:underline shrink-0"
          >
            Source ↗
          </a>
        )}
      </div>
    </li>
  );
}

/* ── Map ──────────────────────────────────────────────────────────────────── */

interface ChoroplethMapProps {
  states: Record<string, StateAgg>;
  selectedFips: string | null;
  onSelect: (fips: string) => void;
}

function ChoroplethMap({ states, selectedFips, onSelect }: ChoroplethMapProps) {
  return (
    <svg
      viewBox={US_MAP_VIEWBOX}
      role="group"
      aria-label="US severity map of active world events"
      className="w-full h-auto motion-reduce:transition-none"
    >
      {Object.entries(US_STATE_PATHS).map(([fips, d]) => {
        const agg = states[fips];
        const tier = severityTier(agg?.maxSeverity ?? null);
        const meta = FIPS_TO_STATE[fips];
        const isSelected = selectedFips === fips;
        return (
          <path
            key={fips}
            d={d}
            role="button"
            tabIndex={0}
            aria-label={meta ? `${meta.name}: ${SEVERITY_LABELS[tier]}${agg ? `, ${agg.count} alert${agg.count === 1 ? '' : 's'}` : ''}` : fips}
            aria-pressed={isSelected}
            fill={SEVERITY_COLORS[tier]}
            stroke={isSelected ? '#D4AF6A' : '#15161A'}
            strokeWidth={isSelected ? 2 : 0.6}
            className="cursor-pointer transition-colors duration-150 motion-reduce:transition-none hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-1"
            onClick={() => onSelect(fips)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(fips);
              }
            }}
          />
        );
      })}
      {Object.entries(US_STATE_CENTROIDS).map(([fips, [x, y]]) => {
        const agg = states[fips];
        if (!agg) return null;
        const meta = FIPS_TO_STATE[fips];
        return (
          <text
            key={fips}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="pointer-events-none select-none fill-white text-[8px] font-mono font-semibold"
            style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 2 }}
          >
            {meta?.abbr ?? fips} {agg.count}
          </text>
        );
      })}
    </svg>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function WorldPage() {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [summary, setSummary] = useState<StateSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const [stateEvents, setStateEvents] = useState<WorldEventsResponse | null>(null);
  const [stateEventsLoading, setStateEventsLoading] = useState(false);
  const [stateEventsError, setStateEventsError] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSummary = useCallback((cat: CategoryFilter) => {
    setSummaryLoading(true);
    worldApi.stateSummary(cat)
      .then((res) => {
        if (res.data) {
          setSummary(res.data as StateSummaryResponse);
          setSummaryError(false);
        } else {
          setSummaryError(true);
        }
      })
      .catch(() => setSummaryError(true))
      .finally(() => setSummaryLoading(false));
  }, []);

  useEffect(() => {
    fetchSummary(category);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchSummary(category), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [category, fetchSummary]);

  const selectState = useCallback((fips: string) => {
    setSelectedFips((prev) => (prev === fips ? null : fips));
  }, []);

  useEffect(() => {
    if (!selectedFips) {
      setStateEvents(null);
      return;
    }
    setStateEventsLoading(true);
    setStateEventsError(false);
    worldApi.events(1, STATE_EVENTS_LIMIT, selectedFips)
      .then((res) => {
        if (res.data) setStateEvents(res.data as WorldEventsResponse);
        else setStateEventsError(true);
      })
      .catch(() => setStateEventsError(true))
      .finally(() => setStateEventsLoading(false));
  }, [selectedFips]);

  const statesByFips: Record<string, StateAgg> = {};
  summary?.states.forEach((s) => { statesByFips[s.fips] = s; });

  const hotspots = summary
    ? [...summary.states].sort((a, b) => b.maxSeverity - a.maxSeverity || b.count - a.count).slice(0, HOTSPOT_COUNT)
    : [];

  const selectedMeta = selectedFips ? FIPS_TO_STATE[selectedFips] : null;
  const selectedAgg = selectedFips ? statesByFips[selectedFips] : null;
  const selectedTier = severityTier(selectedAgg?.maxSeverity ?? null);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-stone">World Events</h1>
        <p className="text-sm text-text-muted mt-1">
          Real-world events pulled from USGS, the National Weather Service, and FEMA — the same
          world the AI government will eventually respond to. This feed is currently read-only and
          observational: nothing here is injected into the simulation yet.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {CATEGORY_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => setCategory(chip.value)}
            aria-pressed={category === chip.value}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${
              category === chip.value
                ? 'border-gold text-gold bg-gold/10'
                : 'border-border text-text-secondary hover:bg-white/[0.03]'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {summaryError && (
        <div className="rounded border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          World events data unavailable.
        </div>
      )}

      {summaryLoading && !summary && (
        <div className="text-center text-text-muted text-sm py-16">Loading...</div>
      )}

      {summary && summary.states.length === 0 && summary.coastal.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <EmptyState
            title="No world events recorded yet."
            hint="This feed is dark by default — an operator enables it, then USGS, NWS, and FEMA events accumulate here over time."
          />
        </div>
      )}

      {summary && (summary.states.length > 0 || summary.coastal.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start gap-6">
          <div className="space-y-4 min-w-0">
            <div className="rounded-lg border border-border bg-surface p-4">
              <ChoroplethMap states={statesByFips} selectedFips={selectedFips} onSelect={selectState} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
              {(['severe', 'warning', 'advisory', 'calm', 'none'] as SeverityTier[]).map((tier) => (
                <span key={tier} className="flex items-center gap-1.5">
                  <SeverityDot tier={tier} />
                  {SEVERITY_LABELS[tier]}
                </span>
              ))}
            </div>

            {summary.coastal.length > 0 && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h3 className="font-serif text-sm font-semibold text-stone mb-2">Coastal & territories</h3>
                <ul className="flex flex-wrap gap-2">
                  {summary.coastal.map((c) => {
                    const tier = severityTier(c.maxSeverity);
                    return (
                      <li
                        key={c.fips}
                        className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-text-secondary"
                      >
                        <SeverityDot tier={tier} />
                        Zone {c.fips} &middot; {c.count}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-4 min-w-0">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs text-text-muted uppercase tracking-widest">Nationwide now</p>
              <p className="font-serif text-4xl font-semibold text-stone mt-1">{summary.nationwide.totalAlerts}</p>
              <p className="text-xs text-text-muted mt-1">
                active alert{summary.nationwide.totalAlerts === 1 ? '' : 's'} across {summary.nationwide.statesWithAlerts} state{summary.nationwide.statesWithAlerts === 1 ? '' : 's'}
              </p>
            </div>

            {hotspots.length > 0 && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <h3 className="font-serif text-sm font-semibold text-stone mb-3">Top hotspots</h3>
                <ul className="space-y-1.5">
                  {hotspots.map((h) => {
                    const tier = severityTier(h.maxSeverity);
                    const meta = FIPS_TO_STATE[h.fips];
                    return (
                      <li key={h.fips}>
                        <button
                          type="button"
                          onClick={() => selectState(h.fips)}
                          aria-pressed={selectedFips === h.fips}
                          className="w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <SeverityDot tier={tier} />
                            <span className="text-text-secondary truncate">{meta?.name ?? h.fips}</span>
                          </span>
                          <span className="text-xs font-mono text-text-muted shrink-0">{h.count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="rounded-lg border border-border bg-surface p-4">
              {!selectedFips && (
                <p className="text-sm text-text-muted">Select a state on the map or a hotspot to see its active alerts.</p>
              )}

              {selectedFips && (
                <>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <SeverityDot tier={selectedTier} />
                      <h3 className="font-serif text-base font-semibold text-stone truncate">
                        {selectedMeta?.name ?? selectedFips}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFips(null)}
                      className="text-xs text-text-muted hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold shrink-0"
                      aria-label="Clear selected state"
                    >
                      Clear
                    </button>
                  </div>

                  {stateEventsLoading && !stateEvents && (
                    <p className="text-sm text-text-muted py-4 text-center">Loading...</p>
                  )}

                  {stateEventsError && (
                    <p className="text-sm text-danger">Could not load alerts for this state.</p>
                  )}

                  {stateEvents && stateEvents.events.length === 0 && (
                    <EmptyState compact title="No active alerts for this state." />
                  )}

                  {stateEvents && stateEvents.events.length > 0 && (
                    <ul className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                      {stateEvents.events.map((event) => (
                        <EventRow key={event.id} event={event} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
