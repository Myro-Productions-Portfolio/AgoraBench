// File: src/modules/legislation/client/pages/CourtRecordsPage.tsx
// Purpose: Dense, cheap records/archive view over the full case history.
//   Court cases are never deleted, so this is the "records room" — a
//   monospace table (no avatars, no cards, minimal DOM per row) built to
//   render 1000+ rows via server-side pagination + search + filters. The
//   heavy card docket lives on CourtPage; this is deliberately minimal.

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { courtApi } from '@core/client/lib/api';

/* One record row (subset of the case list selection). */
interface RecordRow {
  id: string;
  caseNumber: string;
  caption: string;
  caseType: string;
  status: string;
  outcome: string | null;
  filedTick: number;
  decidedTick: number | null;
  votesFor: number;
  votesAgainst: number;
}

interface CasesMeta {
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_LABELS: Record<string, string> = {
  filed: 'Filed',
  docketed: 'Docketed',
  argued: 'Argued',
  deliberating: 'Deliberating',
  decided: 'Decided',
  dismissed: 'Dismissed',
};

const OUTCOME_LABELS: Record<string, string> = {
  struck_down: 'Struck Down',
  upheld: 'Upheld',
  petitioner: 'For Petitioner',
  respondent: 'For Respondent',
  dismissed: 'Dismissed',
};

const CASE_TYPE_LABELS: Record<string, string> = {
  constitutional_challenge: 'Const. Challenge',
  agent_dispute: 'Agent Dispute',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'filed', label: 'Filed' },
  { value: 'docketed', label: 'Docketed' },
  { value: 'argued', label: 'Argued' },
  { value: 'deliberating', label: 'Deliberating' },
  { value: 'decided', label: 'Decided' },
  { value: 'dismissed', label: 'Dismissed' },
];

const OUTCOME_OPTIONS = [
  { value: '', label: 'All Outcomes' },
  { value: 'struck_down', label: 'Struck Down' },
  { value: 'upheld', label: 'Upheld' },
  { value: 'petitioner', label: 'For Petitioner' },
  { value: 'respondent', label: 'For Respondent' },
  { value: 'dismissed', label: 'Dismissed' },
];

const CASE_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'constitutional_challenge', label: 'Const. Challenge' },
  { value: 'agent_dispute', label: 'Agent Dispute' },
];

const SELECT_CLASS =
  'bg-capitol-card border border-border rounded text-badge text-text-secondary px-2 py-1.5 ' +
  'uppercase tracking-widest focus:border-gold/40 focus:outline-none';

function dayLabel(tick: number | null): string {
  return tick === null ? '—' : `Day ${tick}`;
}

export function CourtRecordsPage() {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [meta, setMeta] = useState<CasesMeta>({ total: 0, limit: PAGE_SIZE, offset: 0 });
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState('');
  const [caseType, setCaseType] = useState('');
  const [offset, setOffset] = useState(0);

  /* Debounce the search box into `query` so we don't hit the API per keystroke. */
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  /* Any filter/search change resets pagination to the first page. */
  useEffect(() => {
    setOffset(0);
  }, [query, status, outcome, caseType]);

  const fetchRecords = useCallback(() => {
    setLoading(true);
    courtApi
      .cases({
        q: query || undefined,
        status: status || undefined,
        outcome: outcome || undefined,
        caseType: caseType || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      .then((res) => {
        if (Array.isArray(res.data)) setRows(res.data as RecordRow[]);
        else setRows([]);
        const m = (res as { meta?: CasesMeta }).meta;
        if (m) setMeta(m);
      })
      .catch((err) => {
        console.error('[COURT RECORDS] fetch failed:', err);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [query, status, outcome, caseType, offset]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const total = meta.total;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <Link
          to="/court"
          className="text-badge text-text-muted hover:text-gold transition-colors uppercase tracking-widest"
        >
          ← Back to Court
        </Link>
        <h1 className="font-serif text-3xl font-semibold text-stone">Court Records</h1>
        <p className="text-text-muted text-sm">
          Complete case record. Cases are never removed — search and page through the full history.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search case no., caption, question..."
          aria-label="Search court records"
          maxLength={100}
          className="flex-1 min-w-[14rem] bg-capitol-card border border-border rounded text-sm text-text-primary px-3 py-1.5 placeholder:text-text-muted focus:border-gold/40 focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className={SELECT_CLASS}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          aria-label="Filter by outcome"
          className={SELECT_CLASS}
        >
          {OUTCOME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={caseType}
          onChange={(e) => setCaseType(e.target.value)}
          aria-label="Filter by case type"
          className={SELECT_CLASS}
        >
          {CASE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Records table */}
      <div className="rounded-lg border border-border bg-capitol-card overflow-x-auto">
        <table className="w-full font-mono text-badge">
          <thead>
            <tr className="border-b border-border text-text-muted uppercase tracking-widest">
              <th className="text-left px-3 py-2.5">Case No.</th>
              <th className="text-left px-3 py-2.5">Caption</th>
              <th className="text-left px-3 py-2.5 hidden sm:table-cell">Type</th>
              <th className="text-left px-3 py-2.5">Status</th>
              <th className="text-left px-3 py-2.5 hidden md:table-cell">Outcome</th>
              <th className="text-left px-3 py-2.5 hidden lg:table-cell">Filed</th>
              <th className="text-left px-3 py-2.5 hidden lg:table-cell">Decided</th>
              <th className="text-left px-3 py-2.5 hidden md:table-cell">Vote</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-text-muted">
                  Loading records...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-text-muted">
                  No records match.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const hasVotes = (r.votesFor ?? 0) + (r.votesAgainst ?? 0) > 0;
                return (
                  <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Link to={`/court/cases/${r.id}`} className="text-gold hover:underline">
                        {r.caseNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary max-w-[22rem] truncate" title={r.caption}>
                      {r.caption}
                    </td>
                    <td className="px-3 py-2.5 text-text-muted hidden sm:table-cell whitespace-nowrap">
                      {CASE_TYPE_LABELS[r.caseType] ?? r.caseType}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary whitespace-nowrap">
                      {STATUS_LABELS[r.status] ?? r.status}
                    </td>
                    <td className="px-3 py-2.5 text-text-muted hidden md:table-cell whitespace-nowrap">
                      {r.outcome ? OUTCOME_LABELS[r.outcome] ?? r.outcome : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-text-muted hidden lg:table-cell whitespace-nowrap">
                      {dayLabel(r.filedTick)}
                    </td>
                    <td className="px-3 py-2.5 text-text-muted hidden lg:table-cell whitespace-nowrap">
                      {dayLabel(r.decidedTick)}
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary hidden md:table-cell whitespace-nowrap">
                      {hasVotes ? `${r.votesFor}–${r.votesAgainst}` : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="font-mono text-badge text-text-muted uppercase tracking-widest">
          {total === 0 ? 'No records' : `Showing ${from}–${to} of ${total}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={!hasPrev || loading}
            className="text-badge px-3 py-1.5 rounded border border-border/40 text-text-muted uppercase tracking-widest transition-colors hover:text-text-primary hover:border-border disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:border-border/40"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={!hasNext || loading}
            className="text-badge px-3 py-1.5 rounded border border-border/40 text-text-muted uppercase tracking-widest transition-colors hover:text-text-primary hover:border-border disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:border-border/40"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
