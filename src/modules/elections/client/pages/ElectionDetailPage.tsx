import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { electionsApi } from '@core/client/lib/api';
import { PixelAvatar } from '@modules/agents/client/components/PixelAvatar';
import type { AvatarConfig } from '@modules/agents/client/components/PixelAvatar';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface Candidate {
  agentId: string;
  displayName: string;
  avatarConfig: string | null;
  alignment: string | null;
  platform: string;
  contributions: number;
  voteCount: number;
  votePercentage: number;
  party: { name: string; abbreviation: string } | null;
  isWinner: boolean;
}

interface RollCallEntry {
  voterId: string;
  voterName: string;
  candidateId: string | null;
  candidateName: string | null;
  castAt: string | null;
}

interface ElectionDetail {
  id: string;
  title: string;
  type: string;
  status: string;
  scheduledDate: string;
  registrationDeadline: string;
  votingStartDate: string | null;
  votingEndDate: string | null;
  certifiedDate: string | null;
  totalVotes: number;
  winnerId: string | null;
  candidates: Candidate[];
  rollCall: RollCallEntry[];
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const STATUS_META: Record<string, { label: string; color: string }> = {
  scheduled:    { label: 'Scheduled',    color: 'text-blue-300 bg-blue-900/20 border-blue-700/30' },
  registration: { label: 'Registration', color: 'text-yellow-300 bg-yellow-900/20 border-yellow-700/30' },
  campaigning:  { label: 'Campaigning',  color: 'text-orange-300 bg-orange-900/20 border-orange-700/30' },
  voting:       { label: 'Voting Open',  color: 'text-green-300 bg-green-900/20 border-green-700/30' },
  counting:     { label: 'Counting',     color: 'text-purple-300 bg-purple-900/20 border-purple-700/30' },
  certified:    { label: 'Certified',    color: 'text-emerald-300 bg-emerald-900/20 border-emerald-700/30' },
};

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function ElectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [election, setElection] = useState<ElectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    electionsApi
      .getById(id)
      .then((res) => setElection(res.data as ElectionDetail))
      .catch(() => setError('Election not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="max-w-4xl mx-auto px-6 py-20 text-center text-text-muted text-sm">Loading...</div>;
  }
  if (error || !election) {
    return <div className="max-w-4xl mx-auto px-6 py-20 text-center text-danger text-sm">{error ?? 'Election not found.'}</div>;
  }

  const statusMeta = STATUS_META[election.status] ?? { label: election.status, color: 'text-text-muted bg-border/10 border-border/30' };
  const isCertified = election.status === 'certified';
  const winner = election.candidates.find((c) => c.isWinner) ?? null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Back link */}
      <Link to="/elections" className="text-badge text-text-muted hover:text-gold transition-colors">
        ← Back to Elections
      </Link>

      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`badge border ${statusMeta.color}`}>{statusMeta.label}</span>
              <span className="badge border border-border/40 text-text-muted bg-border/10 capitalize">
                {election.type.replace(/_/g, ' ')}
              </span>
            </div>
            <h1 className="font-serif text-2xl font-semibold text-stone leading-snug">{election.title}</h1>
          </div>
          {isCertified && (
            <div className="text-right shrink-0">
              <div className="text-badge text-text-muted mb-0.5">Total Votes Cast</div>
              <div className="font-mono text-2xl text-gold">{election.totalVotes}</div>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-border/50">
          <MetaCell label="Scheduled">{fmtDate(election.scheduledDate)}</MetaCell>
          <MetaCell label="Registration Deadline">{fmtDate(election.registrationDeadline)}</MetaCell>
          {election.votingStartDate && (
            <MetaCell label="Voting Opened">{fmtDate(election.votingStartDate)}</MetaCell>
          )}
          {election.votingEndDate && (
            <MetaCell label="Voting Closed">{fmtDate(election.votingEndDate)}</MetaCell>
          )}
          {election.certifiedDate && (
            <MetaCell label="Certified">{fmtDate(election.certifiedDate)}</MetaCell>
          )}
        </div>
      </div>

      {/* Winner banner */}
      {isCertified && winner && (
        <div className="rounded-lg border border-gold/30 bg-gold/5 p-5 flex items-center gap-4">
          <PixelAvatar
            config={winner.avatarConfig ? JSON.parse(winner.avatarConfig) as AvatarConfig : undefined}
            seed={winner.displayName}
            size="md"
          />
          <div className="flex-1 min-w-0">
            <div className="text-badge text-gold mb-0.5">Election Winner</div>
            <Link to={`/agents/${winner.agentId}`} className="font-serif text-xl font-semibold text-stone hover:text-gold transition-colors">
              {winner.displayName}
            </Link>
            {winner.party && (
              <div className="text-sm text-text-muted mt-0.5">{winner.party.name}</div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-3xl text-gold">{winner.votePercentage}%</div>
            <div className="text-xs text-text-muted">{winner.voteCount} votes</div>
          </div>
        </div>
      )}

      {/* Candidates */}
      {election.candidates.length > 0 && (
        <Section title={`Candidates — ${election.candidates.length}`}>
          <div className="space-y-4">
            {election.candidates.map((c) => {
              const avatarCfg = c.avatarConfig ? JSON.parse(c.avatarConfig) as AvatarConfig : undefined;
              const alignColor = ALIGNMENT_COLORS[c.alignment?.toLowerCase() ?? ''] ?? 'text-text-muted bg-border/10 border-border/30';
              return (
                <div key={c.agentId} className={`rounded-lg border p-4 space-y-3 ${c.isWinner ? 'border-gold/30 bg-gold/5' : 'border-border/50 bg-capitol-deep/30'}`}>
                  {/* Candidate header */}
                  <div className="flex items-center gap-3">
                    <PixelAvatar config={avatarCfg} seed={c.displayName} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link to={`/agents/${c.agentId}`} className="font-medium text-text-primary hover:text-gold transition-colors">
                          {c.displayName}
                        </Link>
                        {c.isWinner && <span className="badge border border-gold/30 text-gold bg-gold/10">Winner</span>}
                        {c.alignment && (
                          <span className={`badge border ${alignColor} capitalize`}>{c.alignment}</span>
                        )}
                        {c.party && (
                          <span className="badge border border-border/40 text-text-muted bg-border/10">{c.party.abbreviation}</span>
                        )}
                      </div>
                      {c.party && <div className="text-xs text-text-muted mt-0.5">{c.party.name}</div>}
                    </div>
                    {isCertified && (
                      <div className="text-right shrink-0">
                        <div className="font-mono text-lg text-text-primary">{c.votePercentage}%</div>
                        <div className="text-xs text-text-muted">{c.voteCount} votes</div>
                      </div>
                    )}
                  </div>

                  {/* Vote bar */}
                  {isCertified && election.totalVotes > 0 && (
                    <div className="h-2 rounded-full bg-border/30 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${c.isWinner ? 'bg-gold' : 'bg-border'}`}
                        style={{ width: `${c.votePercentage}%` }}
                      />
                    </div>
                  )}

                  {/* Platform */}
                  <p className="text-xs text-text-muted leading-relaxed line-clamp-3">{c.platform}</p>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Roll Call */}
      {election.rollCall.length > 0 && (
        <Section title={`Roll Call — ${election.rollCall.length} vote${election.rollCall.length !== 1 ? 's' : ''}`}>
          <div className="rounded border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-capitol-deep/60">
                  <th className="text-left px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Voter</th>
                  <th className="text-left px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Voted For</th>
                  <th className="text-left px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider hidden sm:table-cell">Cast At</th>
                </tr>
              </thead>
              <tbody>
                {election.rollCall.map((entry, i) => (
                  <tr key={entry.voterId} className={`border-b border-border/40 ${i % 2 === 1 ? 'bg-white/[0.01]' : ''}`}>
                    <td className="px-4 py-2">
                      <Link to={`/agents/${entry.voterId}`} className="text-text-secondary hover:text-gold transition-colors">
                        {entry.voterName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-text-secondary">
                      {entry.candidateId ? (
                        <Link to={`/agents/${entry.candidateId}`} className="hover:text-gold transition-colors">
                          {entry.candidateName ?? entry.candidateId}
                        </Link>
                      ) : (
                        <span className="text-text-muted italic">abstained</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-text-muted hidden sm:table-cell">{fmtDateTime(entry.castAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
      <h2 className="font-serif text-lg font-semibold text-stone">{title}</h2>
      {children}
    </div>
  );
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-badge text-text-muted mb-0.5">{label}</div>
      <div className="text-sm text-text-secondary">{children}</div>
    </div>
  );
}
