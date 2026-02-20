import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { legislationApi } from '../../../../core/client/lib/api';
import { useWebSocket } from '../../../../core/client/lib/useWebSocket';
import { PixelAvatar } from '../../../agents/client/components/PixelAvatar';
import type { AvatarConfig } from '../../../agents/client/components/PixelAvatar';

interface LawItem {
  id: string;
  title: string;
  enactedDate: string;
  isActive: boolean;
  committee: string | null;
  sourceBillId: string | null;
  sponsorId: string | null;
  sponsorDisplayName: string | null;
  sponsorAvatarConfig: string | null;
  sponsorAlignment: string | null;
  reviewStatus: string | null;
  reviewId: string | null;
}

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const REVIEW_BADGES: Record<string, { label: string; color: string }> = {
  pending:      { label: 'Under Review', color: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30' },
  deliberating: { label: 'Under Review', color: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30' },
  upheld:       { label: 'Upheld',       color: 'text-green-400 bg-green-900/20 border-green-700/30' },
  struck_down:  { label: 'Struck Down',  color: 'text-red-400 bg-red-900/20 border-red-700/30' },
};

type StatusFilter = '' | 'active' | 'repealed';
type CourtFilter  = '' | 'under_review' | 'upheld' | 'struck_down';
type SortKey      = 'newest' | 'oldest' | 'az';

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-badge px-3 py-1.5 rounded border transition-colors uppercase tracking-widest ${
        active
          ? 'border-gold/40 text-gold bg-gold/5'
          : 'border-border/40 text-text-muted hover:text-text-primary hover:border-border'
      }`}
    >
      {children}
    </button>
  );
}

export function LawsPage() {
  const [lawItems, setLawItems] = useState<LawItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [courtFilter, setCourtFilter] = useState<CourtFilter>('');
  const [sort, setSort] = useState<SortKey>('newest');
  const { subscribe } = useWebSocket();

  const fetchLaws = useCallback(() => {
    legislationApi.laws()
      .then((res) => {
        if (res.data && Array.isArray(res.data)) {
          setLawItems(res.data as LawItem[]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchLaws(); }, [fetchLaws]);

  /* Refresh when a bill is enacted or a law changes status */
  useEffect(() => {
    const unsubs = [
      subscribe('bill:resolved', fetchLaws),
      subscribe('law:amended', fetchLaws),
      subscribe('law:struck_down', fetchLaws),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchLaws]);

  const stats = useMemo(() => ({
    total:       lawItems.length,
    active:      lawItems.filter((l) => l.isActive).length,
    repealed:    lawItems.filter((l) => !l.isActive).length,
    underReview: lawItems.filter((l) =>
      l.reviewStatus === 'pending' || l.reviewStatus === 'deliberating'
    ).length,
  }), [lawItems]);

  const displayed = useMemo(() => {
    let list = [...lawItems];

    if (statusFilter === 'active')   list = list.filter((l) => l.isActive);
    if (statusFilter === 'repealed') list = list.filter((l) => !l.isActive);

    if (courtFilter === 'under_review') {
      list = list.filter((l) => l.reviewStatus === 'pending' || l.reviewStatus === 'deliberating');
    }
    if (courtFilter === 'upheld')      list = list.filter((l) => l.reviewStatus === 'upheld');
    if (courtFilter === 'struck_down') list = list.filter((l) => l.reviewStatus === 'struck_down');

    if (sort === 'newest') list.sort((a, b) => new Date(b.enactedDate).getTime() - new Date(a.enactedDate).getTime());
    if (sort === 'oldest') list.sort((a, b) => new Date(a.enactedDate).getTime() - new Date(b.enactedDate).getTime());
    if (sort === 'az')     list.sort((a, b) => a.title.localeCompare(b.title));

    return list;
  }, [lawItems, statusFilter, courtFilter, sort]);

  return (
    <div className="max-w-screen-2xl mx-auto px-6 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="font-serif text-3xl font-semibold text-stone">Laws of the Land</h1>
        <p className="text-text-muted text-sm">Enacted legislation currently in force.</p>
      </div>

      {!loading && lawItems.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Enacted', value: stats.total },
            { label: 'Active',        value: stats.active,      color: 'text-green-400' },
            { label: 'Repealed',      value: stats.repealed,    color: 'text-red-400' },
            { label: 'Under Review',  value: stats.underReview, color: 'text-yellow-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-surface p-4">
              <div className="text-badge text-text-muted uppercase tracking-widest mb-1">{s.label}</div>
              <div className={`font-mono text-2xl font-bold ${s.color ?? 'text-stone'}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && lawItems.length > 0 && (
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex gap-1">
            <FilterBtn active={statusFilter === ''} onClick={() => setStatusFilter('')}>All</FilterBtn>
            <FilterBtn active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>Active</FilterBtn>
            <FilterBtn active={statusFilter === 'repealed'} onClick={() => setStatusFilter('repealed')}>Repealed</FilterBtn>
          </div>

          <div className="w-px h-5 bg-border/40 hidden sm:block" />

          <div className="flex gap-1">
            <FilterBtn active={courtFilter === ''} onClick={() => setCourtFilter('')}>All Court</FilterBtn>
            <FilterBtn active={courtFilter === 'under_review'} onClick={() => setCourtFilter('under_review')}>Under Review</FilterBtn>
            <FilterBtn active={courtFilter === 'upheld'} onClick={() => setCourtFilter('upheld')}>Upheld</FilterBtn>
            <FilterBtn active={courtFilter === 'struck_down'} onClick={() => setCourtFilter('struck_down')}>Struck Down</FilterBtn>
          </div>

          <div className="w-px h-5 bg-border/40 hidden sm:block" />

          <div className="flex gap-1">
            <FilterBtn active={sort === 'newest'} onClick={() => setSort('newest')}>Newest</FilterBtn>
            <FilterBtn active={sort === 'oldest'} onClick={() => setSort('oldest')}>Oldest</FilterBtn>
            <FilterBtn active={sort === 'az'} onClick={() => setSort('az')}>A→Z</FilterBtn>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-text-muted py-16 text-center">Loading...</p>
      ) : displayed.length === 0 ? (
        <p className="text-text-muted py-16 text-center">
          {lawItems.length === 0 ? 'No laws have been enacted yet.' : 'No laws match the current filters.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {displayed.map((law) => {
            const avatarConfig = (() => {
              try {
                return law.sponsorAvatarConfig ? JSON.parse(law.sponsorAvatarConfig) as AvatarConfig : undefined;
              } catch {
                return undefined;
              }
            })();
            const alignKey = law.sponsorAlignment?.toLowerCase() ?? '';
            const alignColor = ALIGNMENT_COLORS[alignKey] ?? 'text-text-muted bg-border/10 border-border/30';
            const reviewBadge = law.reviewStatus ? REVIEW_BADGES[law.reviewStatus] ?? null : null;

            return (
              <article
                key={law.id}
                className="rounded-lg border border-border bg-surface p-4 space-y-3 flex flex-col hover:border-gold/30 transition-colors"
              >
                <Link
                  to={`/laws/${law.id}`}
                  className="font-serif text-sm font-semibold text-stone hover:text-gold transition-colors leading-snug line-clamp-3"
                >
                  {law.title}
                </Link>

                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`badge border text-badge uppercase tracking-widest ${
                      law.isActive
                        ? 'text-green-400 bg-green-900/20 border-green-700/30'
                        : 'text-red-400 bg-red-900/20 border-red-700/30'
                    }`}
                  >
                    {law.isActive ? 'Active' : 'Repealed'}
                  </span>
                  {law.committee && (
                    <span className="badge border border-border/40 text-text-muted bg-border/10">
                      {law.committee}
                    </span>
                  )}
                  {reviewBadge && law.reviewId && (
                    <Link
                      to={`/court/cases/${law.reviewId}`}
                      className={`badge border text-badge uppercase tracking-widest ${reviewBadge.color} hover:opacity-80 transition-opacity`}
                    >
                      {reviewBadge.label}
                    </Link>
                  )}
                </div>

                <p className="text-text-muted text-xs">{fmtDate(law.enactedDate)}</p>

                {law.sponsorDisplayName && law.sponsorId && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                    <PixelAvatar config={avatarConfig} seed={law.sponsorDisplayName} size="xs" />
                    <div className="flex flex-col min-w-0">
                      <Link
                        to={`/agents/${law.sponsorId}`}
                        className="text-gold hover:underline text-xs truncate"
                      >
                        {law.sponsorDisplayName}
                      </Link>
                      {alignKey && (
                        <span className={`badge border text-badge uppercase tracking-widest ${alignColor} mt-0.5 self-start`}>
                          {alignKey}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {law.sourceBillId && (
                  <Link
                    to={`/legislation/${law.sourceBillId}`}
                    className="text-text-muted hover:text-gold transition-colors text-xs mt-auto pt-1"
                  >
                    Source Bill →
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
