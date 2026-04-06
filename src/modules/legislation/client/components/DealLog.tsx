import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface Deal {
  id: string;
  initiatorId: string;
  initiatorName: string;
  targetId: string;
  targetName: string;
  status: 'proposed' | 'accepted' | 'honored' | 'broken';
  initiatorCommitment: string;
  targetCommitment: string;
  createdAt: string;
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const STATUS_COLORS: Record<Deal['status'], string> = {
  proposed: 'text-amber-300 bg-amber-900/20 border-amber-700/30',
  accepted: 'text-blue-300 bg-blue-900/20 border-blue-700/30',
  honored:  'text-green-300 bg-green-900/20 border-green-700/30',
  broken:   'text-red-300 bg-red-900/20 border-red-700/30',
};

const STATUS_LABELS: Record<Deal['status'], string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  honored:  'Honored',
  broken:   'Broken',
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ── Component ─────────────────────────────────────────────────────────── */

interface DealLogProps {
  billId: string;
}

export function DealLog({ billId }: DealLogProps) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { subscribe } = useWebSocket();

  const fetchDeals = useCallback(() => {
    fetch(`/api/legislation/${billId}/deals`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load deals (${res.status})`);
        return res.json() as Promise<{ data: Deal[] }>;
      })
      .then((res) => setDeals(res.data ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [billId]);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);

  useEffect(() => {
    const unsubs = [
      subscribe('agent:deal_honored', fetchDeals),
      subscribe('agent:deal_broken', fetchDeals),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchDeals]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return <p className="text-sm text-text-muted animate-pulse">Loading deals...</p>;
  }
  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (deals.length === 0) {
    return <p className="text-sm text-text-muted">No deals have been recorded on this bill.</p>;
  }

  return (
    <div className="space-y-3">
      {deals.map((deal) => {
        const isExpanded = expandedIds.has(deal.id);
        return (
          <div key={deal.id} className="rounded border border-border/60 bg-capitol-deep/30 p-3 space-y-2">
            {/* Header row */}
            <div className="flex items-center gap-2 flex-wrap">
              <Link to={`/agents/${deal.initiatorId}`} className="text-sm text-gold hover:underline font-medium">
                {deal.initiatorName}
              </Link>
              <span className="text-text-muted text-xs">→</span>
              <Link to={`/agents/${deal.targetId}`} className="text-sm text-gold hover:underline font-medium">
                {deal.targetName}
              </Link>
              <span className={`badge border ${STATUS_COLORS[deal.status]}`}>
                {STATUS_LABELS[deal.status]}
              </span>
              <span className="ml-auto text-xs text-text-muted">{fmtDate(deal.createdAt)}</span>
            </div>

            {/* Expand/collapse commitments */}
            <button
              onClick={() => toggleExpand(deal.id)}
              className="text-badge text-gold hover:text-gold/80 transition-colors"
            >
              {isExpanded ? '▲ Collapse' : '▼ Show commitments'}
            </button>
            {isExpanded && (
              <div className="space-y-2">
                <div>
                  <div className="text-badge text-text-muted mb-0.5">{deal.initiatorName}'s commitment</div>
                  <div className="rounded border border-border/40 bg-capitol-deep/40 px-3 py-2 text-xs text-text-secondary leading-relaxed">
                    {deal.initiatorCommitment}
                  </div>
                </div>
                <div>
                  <div className="text-badge text-text-muted mb-0.5">{deal.targetName}'s commitment</div>
                  <div className="rounded border border-border/40 bg-capitol-deep/40 px-3 py-2 text-xs text-text-secondary leading-relaxed">
                    {deal.targetCommitment}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
