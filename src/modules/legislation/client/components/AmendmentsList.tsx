import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface Amendment {
  id: string;
  billId: string;
  proposerId: string;
  proposerName: string;
  amendmentType: 'addition' | 'strike' | 'substitute';
  status: 'pending' | 'accepted' | 'rejected';
  text: string;
  votesFor: number;
  votesAgainst: number;
  proposedAt: string;
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const TYPE_COLORS: Record<Amendment['amendmentType'], string> = {
  addition:   'text-blue-300 bg-blue-900/20 border-blue-700/30',
  strike:     'text-red-300 bg-red-900/20 border-red-700/30',
  substitute: 'text-amber-300 bg-amber-900/20 border-amber-700/30',
};

const TYPE_LABELS: Record<Amendment['amendmentType'], string> = {
  addition:   'Addition',
  strike:     'Strike',
  substitute: 'Substitute',
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ── Component ─────────────────────────────────────────────────────────── */

interface AmendmentsListProps {
  billId: string;
  billStatus: string;
}

export function AmendmentsList({ billId, billStatus }: AmendmentsListProps) {
  const [amendments, setAmendments] = useState<Amendment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { subscribe } = useWebSocket();

  const fetchAmendments = useCallback(() => {
    fetch(`/api/legislation/${billId}/amendments`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load amendments (${res.status})`);
        return res.json() as Promise<{ data: Amendment[] }>;
      })
      .then((res) => setAmendments(res.data ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [billId]);

  useEffect(() => { fetchAmendments(); }, [fetchAmendments]);

  useEffect(() => {
    const unsubs = [
      subscribe('bill:floor_amendment_proposed', fetchAmendments),
      subscribe('bill:amended', fetchAmendments),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchAmendments]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* Only render when bill is on floor or there are amendments */
  if (!loading && amendments.length === 0 && billStatus !== 'floor') return null;

  const pendingCount = amendments.filter((a) => a.status === 'pending').length;
  const acceptedCount = amendments.filter((a) => a.status === 'accepted').length;

  const countBadge = amendments.length > 0
    ? `${pendingCount} pending · ${acceptedCount} accepted`
    : null;

  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <h2 className="font-serif text-lg font-semibold text-stone">Floor Amendments</h2>
        {countBadge && (
          <span className="badge border border-amber-700/30 text-amber-300 bg-amber-900/10">
            {countBadge}
          </span>
        )}
      </div>

      {/* Loading / error / empty states */}
      {loading && (
        <p className="text-sm text-text-muted animate-pulse">Loading amendments...</p>
      )}
      {error && (
        <p className="text-sm text-danger">{error}</p>
      )}
      {!loading && !error && amendments.length === 0 && (
        <p className="text-sm text-text-muted">No floor amendments have been proposed.</p>
      )}

      {/* Amendment rows */}
      {!loading && !error && amendments.length > 0 && (
        <div className="space-y-3">
          {amendments.map((amendment) => {
            const isExpanded = expandedIds.has(amendment.id);
            const totalVotes = amendment.votesFor + amendment.votesAgainst;
            const forPct = totalVotes > 0 ? (amendment.votesFor / totalVotes) * 100 : 0;

            const statusBadge =
              amendment.status === 'pending' ? (
                <span className="badge border border-amber-700/30 text-amber-300 bg-amber-900/20 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                  Pending
                </span>
              ) : amendment.status === 'accepted' ? (
                <span className="badge border border-green-700/30 text-green-300 bg-green-900/20">
                  Accepted
                </span>
              ) : (
                <span className="badge border border-border/40 text-text-muted bg-border/10">
                  Rejected
                </span>
              );

            return (
              <div key={amendment.id} className="rounded border border-border/60 bg-capitol-deep/30 p-4 space-y-2">
                {/* Row header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/agents/${amendment.proposerId}`}
                    className="text-sm text-gold hover:underline font-medium"
                  >
                    {amendment.proposerName}
                  </Link>
                  <span className={`badge border ${TYPE_COLORS[amendment.amendmentType]}`}>
                    {TYPE_LABELS[amendment.amendmentType]}
                  </span>
                  {statusBadge}
                  <span className="ml-auto text-xs text-text-muted">{fmtDate(amendment.proposedAt)}</span>
                </div>

                {/* Mini vote bar */}
                {totalVotes > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-border/40">
                      <div
                        className="h-full bg-green-500 transition-all"
                        style={{ width: `${forPct}%` }}
                        title={`For: ${amendment.votesFor}`}
                      />
                    </div>
                    <span className="text-xs text-text-muted whitespace-nowrap">
                      {amendment.votesFor} / {totalVotes}
                    </span>
                  </div>
                )}

                {/* Expand/collapse text */}
                <button
                  onClick={() => toggleExpand(amendment.id)}
                  className="text-badge text-gold hover:text-gold/80 transition-colors"
                >
                  {isExpanded ? '▲ Collapse' : '▼ Expand amendment text'}
                </button>
                {isExpanded && (
                  <div className="rounded border border-border bg-capitol-deep/40 p-3 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap font-mono">
                    {amendment.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
