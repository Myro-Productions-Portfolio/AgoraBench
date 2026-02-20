import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { courtApi } from '../../../../core/client/lib/api';
import { PixelAvatar } from '../../../agents/client/components/PixelAvatar';
import type { AvatarConfig } from '../../../agents/client/components/PixelAvatar';

interface LawRef {
  id: string;
  title: string;
  enactedDate: string;
  isActive: boolean;
}

interface VoteDetail {
  id: string;
  justiceId: string;
  justiceName: string;
  justiceAvatarConfig: string | null;
  justiceAlignment: string | null;
  vote: string;
  reasoning: string;
  castAt: string;
}

interface CaseDetail {
  id: string;
  lawId: string;
  status: string;
  ruling: string | null;
  ruledAt: string | null;
  createdAt: string;
  law: LawRef | null;
  votes: VoteDetail[];
}

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const STATUS_LABELS: Record<string, string> = {
  deliberating: 'Deliberating',
  upheld:       'Upheld',
  struck_down:  'Struck Down',
  pending:      'Pending',
};

const STATUS_COLORS: Record<string, string> = {
  deliberating: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30',
  upheld:       'text-green-400 bg-green-900/20 border-green-700/30',
  struck_down:  'text-red-400 bg-red-900/20 border-red-700/30',
  pending:      'text-text-muted bg-border/10 border-border/30',
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CasePage() {
  const { id } = useParams<{ id: string }>();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    courtApi.caseById(id)
      .then((res) => {
        if (res.data) setCaseData(res.data as CaseDetail);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-text-muted text-center py-16">Loading case...</p>
      </div>
    );
  }

  if (notFound || !caseData) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <Link to="/court" className="text-badge text-text-muted hover:text-gold transition-colors">
          ← Back to Court
        </Link>
        <p className="text-text-muted text-center py-16">Case not found.</p>
      </div>
    );
  }

  const constitutionalCount = caseData.votes.filter((v) => v.vote === 'constitutional').length;
  const unconstitutionalCount = caseData.votes.filter((v) => v.vote === 'unconstitutional').length;
  const isResolved = caseData.status === 'upheld' || caseData.status === 'struck_down';

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <Link to="/court" className="text-badge text-text-muted hover:text-gold transition-colors">
        ← Back to Court
      </Link>

      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-serif text-2xl font-semibold text-stone leading-snug">
            {caseData.law?.title ?? 'Unknown Law'} — Constitutional Review
          </h1>
          <span className={`badge border shrink-0 ${STATUS_COLORS[caseData.status] ?? 'text-text-muted bg-border/10 border-border/30'}`}>
            {STATUS_LABELS[caseData.status] ?? caseData.status}
          </span>
        </div>
        <p className="text-xs text-text-muted">
          {caseData.ruledAt ? `Ruled ${fmtDate(caseData.ruledAt)}` : `Filed ${fmtDate(caseData.createdAt)}`}
        </p>
      </div>

      {/* Law Under Review */}
      {caseData.law && (
        <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
          <h2 className="font-serif text-lg font-semibold text-stone">Law Under Review</h2>
          <div className="flex items-center justify-between gap-3">
            <Link to={`/laws/${caseData.law.id}`} className="text-gold hover:underline font-medium">
              {caseData.law.title}
            </Link>
            <span className={`badge border text-badge shrink-0 ${caseData.law.isActive ? 'text-green-400 bg-green-900/20 border-green-700/30' : 'text-text-muted bg-border/10 border-border/30'}`}>
              {caseData.law.isActive ? 'Active' : 'Repealed'}
            </span>
          </div>
          <p className="text-xs text-text-muted">Enacted {fmtDate(caseData.law.enactedDate)}</p>
        </div>
      )}

      {/* The Ruling */}
      {isResolved && caseData.ruling && (
        <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
          <h2 className="font-serif text-lg font-semibold text-stone">The Ruling</h2>
          <div className={`text-3xl font-serif font-bold ${caseData.status === 'upheld' ? 'text-green-400' : 'text-red-400'}`}>
            {caseData.status === 'upheld' ? 'Upheld' : 'Struck Down'} {constitutionalCount}–{unconstitutionalCount}
          </div>
          <p className="text-sm text-text-secondary">{caseData.ruling}</p>
        </div>
      )}

      {/* Justice Votes */}
      <div className="space-y-3">
        <h2 className="font-serif text-lg font-semibold text-stone">
          Justice Votes{caseData.votes.length > 0 ? ` (${caseData.votes.length})` : ''}
        </h2>
        {caseData.votes.length === 0 ? (
          <p className="text-text-muted text-sm">No votes have been cast yet.</p>
        ) : (
          <div className="space-y-3">
            {caseData.votes.map((vote) => {
              const avatarConfig = vote.justiceAvatarConfig
                ? (JSON.parse(vote.justiceAvatarConfig) as AvatarConfig)
                : undefined;
              const alignKey = vote.justiceAlignment?.toLowerCase() ?? '';
              const alignColor = ALIGNMENT_COLORS[alignKey] ?? 'text-text-muted bg-border/10 border-border/30';
              const isConstitutional = vote.vote === 'constitutional';

              return (
                <div key={vote.id} className="rounded-lg border border-border bg-surface p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <PixelAvatar config={avatarConfig} seed={vote.justiceName} size="sm" />
                      <div>
                        <Link to={`/agents/${vote.justiceId}`} className="text-sm font-medium text-gold hover:underline">
                          {vote.justiceName}
                        </Link>
                        {vote.justiceAlignment && (
                          <span className={`ml-2 badge border text-badge ${alignColor}`}>
                            {vote.justiceAlignment}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`badge border font-semibold shrink-0 ${
                      isConstitutional
                        ? 'text-green-400 bg-green-900/20 border-green-700/30'
                        : 'text-red-400 bg-red-900/20 border-red-700/30'
                    }`}>
                      {isConstitutional ? 'Constitutional' : 'Unconstitutional'}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">{vote.reasoning}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
