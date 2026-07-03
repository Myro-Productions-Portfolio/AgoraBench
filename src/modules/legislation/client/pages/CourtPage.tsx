import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { courtApi } from '@core/client/lib/api';
import { PixelAvatar } from '@modules/agents/client/components/PixelAvatar';
import type { AvatarConfig } from '@modules/agents/client/components/PixelAvatar';

/* Judicial slate — stage tracker + judicial accents (matches map ticker) */
const JUDICIAL_SLATE = '#6B7A8D';
const GOLD = '#B8956A';

interface CourtStats {
  total: number;
  byStatus: Record<string, number>;
  activeDocket: number;
  decided: number;
  dismissed: number;
  struckDown: number;
  upheld: number;
  disputes: number;
  currentTick: number;
}

interface CaseItem {
  id: string;
  caseNumber: string;
  caption: string;
  caseType: string;
  status: string;
  lawId: string | null;
  petitionerId: string;
  respondentId: string | null;
  questionPresented: string | null;
  filedTick: number;
  hearingTick: number | null;
  decidedTick: number | null;
  outcome: string | null;
  votesFor: number;
  votesAgainst: number;
  createdAt: string;
  decidedAt: string | null;
  petitionerName: string | null;
  petitionerAvatarConfig: string | null;
  respondentName: string | null;
  respondentAvatarConfig: string | null;
  lawTitle: string | null;
}

interface ArchiveItem {
  id: string;
  lawId: string;
  lawTitle: string;
  status: string;
  ruling: string | null;
  createdAt: string;
  ruledAt: string | null;
  constitutionalCount: number;
  unconstitutionalCount: number;
  totalVotes: number;
}

const CASE_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  constitutional_challenge: { label: 'Constitutional Challenge', className: 'text-gold bg-gold/10 border-gold/30' },
  agent_dispute:            { label: 'Agent Dispute', className: 'text-blue-300 bg-blue-900/20 border-blue-700/30' },
};

const STATUS_BADGES: Record<string, string> = {
  filed:        'text-text-muted bg-border/10 border-border/30',
  docketed:     'text-blue-300 bg-blue-900/20 border-blue-700/30',
  argued:       'text-yellow-400 bg-yellow-900/20 border-yellow-700/30',
  deliberating: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30',
  decided:      'text-green-400 bg-green-900/20 border-green-700/30',
  dismissed:    'text-text-muted bg-border/10 border-border/30',
};

const STATUS_LABELS: Record<string, string> = {
  filed:        'Filed',
  docketed:     'Docketed',
  argued:       'Argued',
  deliberating: 'Deliberating',
  decided:      'Decided',
  dismissed:    'Dismissed',
};

const OUTCOME_LABELS: Record<string, string> = {
  struck_down: 'Struck Down',
  upheld:      'Upheld',
  petitioner:  'For Petitioner',
  respondent:  'For Respondent',
  dismissed:   'Dismissed',
};

/* Five-stage arc: filed -> docketed -> argued -> deliberating -> decided */
const STAGES = ['filed', 'docketed', 'argued', 'deliberating', 'decided'] as const;

function stageIndex(status: string): number {
  const idx = (STAGES as readonly string[]).indexOf(status);
  return idx >= 0 ? idx : -1; /* dismissed -> -1, tracker renders muted */
}

/* Relative-day anticipation line. Day N (tick number) is the authoritative
   clock; wall-clock never enters this math. currentTick = completed ticks. */
function dayLine(c: CaseItem, currentTick: number): { primary: string; day: number | null } {
  const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

  if (c.status === 'filed') {
    return { primary: 'Awaiting docketing', day: c.filedTick };
  }
  if (c.status === 'docketed' && c.hearingTick !== null) {
    const n = c.hearingTick - currentTick;
    return {
      primary: n <= 0 ? 'Oral argument today' : `Oral argument in ${plural(n)}`,
      day: c.hearingTick,
    };
  }
  if (c.status === 'argued' && c.hearingTick !== null) {
    const n = c.hearingTick + 1 - currentTick;
    return {
      primary: n <= 0 ? 'Deliberation today' : `Deliberation in ${plural(n)}`,
      day: c.hearingTick + 1,
    };
  }
  if (c.status === 'deliberating' && c.hearingTick !== null) {
    const n = c.hearingTick + 2 - currentTick;
    return {
      primary: n <= 0 ? 'Decision today' : `Decision in ${plural(n)}`,
      day: c.hearingTick + 2,
    };
  }
  if (c.status === 'decided' && c.decidedTick !== null) {
    const n = currentTick - c.decidedTick;
    return {
      primary: n <= 0 ? 'Decided today' : `Decided ${plural(n)} ago`,
      day: c.decidedTick,
    };
  }
  if (c.status === 'dismissed') {
    if (c.decidedTick !== null) {
      const n = currentTick - c.decidedTick;
      return {
        primary: n <= 0 ? 'Dismissed today' : `Dismissed ${plural(n)} ago`,
        day: c.decidedTick,
      };
    }
    return { primary: 'Dismissed', day: null };
  }
  return { primary: STATUS_LABELS[c.status] ?? c.status, day: c.filedTick };
}

function parseAvatar(raw: string | null): AvatarConfig | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AvatarConfig;
  } catch {
    return undefined;
  }
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function StageTracker({ status }: { status: string }) {
  const current = stageIndex(status);
  const dismissed = status === 'dismissed';
  return (
    <div className="flex items-center gap-1.5" aria-label={`Stage: ${STATUS_LABELS[status] ?? status}`}>
      {STAGES.map((stage, idx) => {
        const filled = !dismissed && current >= idx;
        return (
          <span
            key={stage}
            title={STATUS_LABELS[stage]}
            className="w-2 h-2 rounded-full transition-colors"
            style={{
              backgroundColor: filled ? GOLD : 'transparent',
              border: `1px solid ${filled ? GOLD : JUDICIAL_SLATE}`,
              opacity: dismissed ? 0.4 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

function CaseCard({ c, currentTick }: { c: CaseItem; currentTick: number }) {
  const typeBadge = CASE_TYPE_BADGES[c.caseType] ?? { label: c.caseType, className: 'text-text-muted bg-border/10 border-border/30' };
  const { primary, day } = dayLine(c, currentTick);
  const hasVotes = (c.votesFor ?? 0) + (c.votesAgainst ?? 0) > 0;

  return (
    <Link
      to={`/court/cases/${c.id}`}
      className="block rounded-lg border border-border bg-capitol-card p-5 space-y-3 hover:border-gold/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-semibold text-stone leading-snug truncate">{c.caption}</h3>
          <span className="font-mono text-xs text-text-muted">{c.caseNumber}</span>
        </div>
        <span className={`badge border text-badge shrink-0 ${STATUS_BADGES[c.status] ?? 'text-text-muted bg-border/10 border-border/30'}`}>
          {STATUS_LABELS[c.status] ?? c.status}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`badge border text-badge ${typeBadge.className}`}>{typeBadge.label}</span>
        {c.outcome && c.status !== 'dismissed' && (
          <span className="badge border text-badge text-stone bg-stone/10 border-stone/30">
            {OUTCOME_LABELS[c.outcome] ?? c.outcome}
            {hasVotes ? ` ${c.votesFor}–${c.votesAgainst}` : ''}
          </span>
        )}
      </div>

      {/* Petitioner v. Respondent */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <PixelAvatar config={parseAvatar(c.petitionerAvatarConfig)} seed={c.petitionerName ?? c.petitionerId} size="sm" />
          <span className="text-xs text-text-secondary truncate">{c.petitionerName ?? 'Unknown'}</span>
        </div>
        <span className="font-serif text-text-muted italic text-sm shrink-0">v.</span>
        <div className="flex items-center gap-2 min-w-0">
          <PixelAvatar config={parseAvatar(c.respondentAvatarConfig)} seed={c.respondentName ?? 'Agora'} size="sm" />
          <span className="text-xs text-text-secondary truncate">{c.respondentName ?? 'Agora'}</span>
        </div>
      </div>

      {c.lawTitle && (
        <p className="text-xs text-text-muted truncate">Challenging: {c.lawTitle}</p>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <StageTracker status={c.status} />
        <div className="text-right">
          <span className="text-xs text-text-secondary">{primary}</span>
          {day !== null && (
            <span className="ml-2 font-mono text-badge text-text-muted">Day {day}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function CourtPage() {
  const [stats, setStats] = useState<CourtStats | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  /* /court#archive (Laws page legacy-review badges) lands with the archive open */
  const [archiveOpen, setArchiveOpen] = useState(() => window.location.hash === '#archive');
  const [archive, setArchive] = useState<ArchiveItem[] | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);

  /* SPA navigation doesn't trigger native anchor scroll — do it once on mount */
  useEffect(() => {
    if (window.location.hash !== '#archive') return;
    document.getElementById('archive')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

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
      .catch((err) => { console.error('[COURT] Court data fetch failed:', err); })
      .finally(() => setLoading(false));
  }, [statusFilter]);

  /* Lazy-load the legacy archive on first expand — 459 historical rulings */
  useEffect(() => {
    if (!archiveOpen || archive !== null || archiveLoading) return;
    setArchiveLoading(true);
    courtApi.archive()
      .then((res) => {
        if (Array.isArray(res.data)) setArchive(res.data as ArchiveItem[]);
        else setArchive([]);
      })
      .catch((err) => {
        console.error('[COURT] Archive fetch failed:', err);
        setArchive([]);
      })
      .finally(() => setArchiveLoading(false));
  }, [archiveOpen, archive, archiveLoading]);

  const currentTick = stats?.currentTick ?? 0;

  const filterOptions = [
    { value: '', label: 'All Cases' },
    { value: 'filed', label: 'Filed' },
    { value: 'docketed', label: 'Docketed' },
    { value: 'argued', label: 'Argued' },
    { value: 'deliberating', label: 'Deliberating' },
    { value: 'decided', label: 'Decided' },
    { value: 'dismissed', label: 'Dismissed' },
  ];

  const statTiles = stats
    ? [
        { label: 'Active Docket', value: stats.activeDocket, color: 'text-gold' },
        { label: 'Decided', value: stats.decided, color: 'text-green-400' },
        { label: 'Struck Down', value: stats.struckDown, color: 'text-red-400' },
        { label: 'Disputes', value: stats.disputes, color: undefined },
      ]
    : [];

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="font-serif text-3xl font-semibold text-stone">Supreme Court</h1>
          <p className="text-text-muted text-sm">
            Cases move through a five-stage arc: filing, docketing, oral argument, deliberation, decision.
          </p>
        </div>
        {stats && (
          <span className="font-mono text-badge text-text-muted uppercase tracking-widest">
            Term Day {currentTick}
          </span>
        )}
      </div>

      {/* Stat tiles */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statTiles.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-capitol-card p-4">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cases.map((c) => (
              <CaseCard key={c.id} c={c} currentTick={currentTick} />
            ))}
          </div>
        )}
      </div>

      {/* Legacy archive — judicial_reviews, read-only historical record */}
      <div id="archive" className="rounded-lg border border-border bg-capitol-card overflow-hidden">
        <button
          onClick={() => setArchiveOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
          aria-expanded={archiveOpen}
        >
          <div>
            <h2 className="font-serif text-lg font-semibold text-stone">Archive — Judicial Reviews (legacy)</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Historical rulings from the pre-Term-of-Court review system. Read-only.
            </p>
          </div>
          <span className="text-text-muted font-mono text-sm" aria-hidden="true">
            {archiveOpen ? '−' : '+'}
          </span>
        </button>

        {archiveOpen && (
          <div className="border-t border-border/40">
            {archiveLoading || archive === null ? (
              <p className="text-text-muted py-8 text-center text-sm">Loading archive...</p>
            ) : archive.length === 0 ? (
              <p className="text-text-muted py-8 text-center text-sm">No archived reviews.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-capitol-card">
                      <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3">Law</th>
                      <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3">Ruling</th>
                      <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3 hidden sm:table-cell">Vote</th>
                      <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3 hidden md:table-cell">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {archive.map((r) => (
                      <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3">
                          <Link to={`/laws/${r.lawId}`} className="text-gold hover:underline text-sm">
                            {r.lawTitle}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge border text-badge ${
                            r.status === 'upheld'
                              ? 'text-green-400 bg-green-900/20 border-green-700/30'
                              : r.status === 'struck_down'
                                ? 'text-red-400 bg-red-900/20 border-red-700/30'
                                : 'text-text-muted bg-border/10 border-border/30'
                          }`}>
                            {r.status === 'struck_down' ? 'Struck Down' : r.status === 'upheld' ? 'Upheld' : r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {r.totalVotes > 0 ? (
                            <span className="text-xs font-mono text-text-secondary">
                              {r.constitutionalCount}{'–'}{r.unconstitutionalCount}
                            </span>
                          ) : (
                            <span className="text-badge text-text-muted">{'—'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-text-muted">
                            {r.ruledAt ? fmtDate(r.ruledAt) : fmtDate(r.createdAt)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
