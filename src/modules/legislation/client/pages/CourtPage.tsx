import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { courtApi } from '@core/client/lib/api';

interface CourtStats {
  total: number;
  deliberating: number;
  upheld: number;
  struckDown: number;
  pending: number;
}

interface CaseItem {
  id: string;
  lawId: string;
  lawTitle: string;
  status: string;
  ruling: string | null;
  ruledAt: string | null;
  createdAt: string;
  constitutionalCount: number;
  unconstitutionalCount: number;
  totalVotes: number;
}

const STATUS_BADGES: Record<string, string> = {
  deliberating: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30',
  upheld:       'text-green-400 bg-green-900/20 border-green-700/30',
  struck_down:  'text-red-400 bg-red-900/20 border-red-700/30',
  pending:      'text-text-muted bg-border/10 border-border/30',
};

const STATUS_LABELS: Record<string, string> = {
  deliberating: 'Deliberating',
  upheld:       'Upheld',
  struck_down:  'Struck Down',
  pending:      'Pending',
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CourtPage() {
  const [stats, setStats] = useState<CourtStats | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      courtApi.stats(),
      courtApi.cases(statusFilter || undefined),
    ])
      .then(([statsRes, casesRes]) => {
        if (statsRes.data) setStats(statsRes.data as CourtStats);
        if (Array.isArray(casesRes.data)) setCases(casesRes.data as CaseItem[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const filterOptions = [
    { value: '', label: 'All Cases' },
    { value: 'deliberating', label: 'Deliberating' },
    { value: 'upheld', label: 'Upheld' },
    { value: 'struck_down', label: 'Struck Down' },
  ];

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-serif text-3xl font-semibold text-stone">Supreme Court</h1>
        <p className="text-text-muted text-sm">
          Constitutional review body. Final arbiter of whether enacted laws stand.
        </p>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Cases', value: stats.total, color: undefined },
            { label: 'Upheld', value: stats.upheld, color: 'text-green-400' },
            { label: 'Struck Down', value: stats.struckDown, color: 'text-red-400' },
            { label: 'Deliberating', value: stats.deliberating, color: 'text-yellow-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-surface p-4">
              <div className="text-badge text-text-muted uppercase tracking-widest mb-1">{s.label}</div>
              <div className={`font-mono text-2xl font-bold ${s.color ?? 'text-stone'}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Docket */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-serif text-lg font-semibold text-stone">The Docket</h2>
          <div className="flex gap-1 flex-wrap">
            {filterOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`text-badge px-3 py-1.5 rounded border transition-colors uppercase tracking-widest ${
                  statusFilter === opt.value
                    ? 'border-gold/40 text-gold bg-gold/5'
                    : 'border-border/40 text-text-muted hover:text-text-primary hover:border-border'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-text-muted py-16 text-center">Loading...</p>
        ) : cases.length === 0 ? (
          <p className="text-text-muted py-16 text-center">No cases on the docket.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3">Law</th>
                  <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3">Status</th>
                  <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3 hidden sm:table-cell">Vote</th>
                  <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3 hidden md:table-cell">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/court/cases/${c.id}`} className="text-gold hover:underline text-sm">
                        {c.lawTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge border text-badge ${STATUS_BADGES[c.status] ?? 'text-text-muted bg-border/10 border-border/30'}`}>
                        {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {c.totalVotes > 0 ? (
                        <span className="text-xs font-mono text-text-secondary">
                          {c.constitutionalCount}–{c.unconstitutionalCount}
                        </span>
                      ) : (
                        <span className="text-badge text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-text-muted">
                        {c.ruledAt ? fmtDate(c.ruledAt) : fmtDate(c.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
