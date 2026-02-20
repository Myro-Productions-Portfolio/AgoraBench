import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { partiesApi } from '../../../../core/client/lib/api';
import { PixelAvatar } from '../../../agents/client/components/PixelAvatar';
import type { AvatarConfig } from '../../../agents/client/components/PixelAvatar';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface MemberAgent {
  id: string;
  displayName: string;
  name: string;
  alignment: string | null;
  avatarUrl: string | null;
  avatarConfig: string | null;
  reputation: number;
  isActive: boolean;
}

interface MemberEntry {
  membership: { agentId: string; partyId: string; role: string; joinedAt: string };
  agent: MemberAgent | null;
}

interface PartyDetail {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  alignment: string;
  platform: string;
  founderId: string;
  memberCount: number;
  isActive: boolean;
  createdAt: string;
  members: MemberEntry[];
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const ROLE_META: Record<string, { label: string; color: string }> = {
  leader: { label: 'Leader', color: 'text-gold border-gold/30 bg-gold/10' },
  officer: { label: 'Officer', color: 'text-stone border-stone/30 bg-stone/10' },
  member: { label: 'Member', color: 'text-text-muted border-border/30 bg-border/10' },
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function parseAvatarConfig(raw: string | null): AvatarConfig | undefined {
  if (!raw) return undefined;
  try { return JSON.parse(raw) as AvatarConfig; } catch { return undefined; }
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function PartyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [party, setParty] = useState<PartyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    partiesApi
      .getById(id)
      .then((res) => setParty(res.data as PartyDetail))
      .catch(() => setError('Party not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="max-w-4xl mx-auto px-6 py-20 text-center text-text-muted text-sm">Loading...</div>;
  }
  if (error || !party) {
    return <div className="max-w-4xl mx-auto px-6 py-20 text-center text-danger text-sm">{error ?? 'Party not found.'}</div>;
  }

  const alignmentClass = ALIGNMENT_COLORS[party.alignment.toLowerCase()] ?? 'text-text-muted bg-border/10 border-border/30';

  /* Sort members: leader → officer → member, then alphabetically */
  const roleOrder: Record<string, number> = { leader: 0, officer: 1, member: 2 };
  const sortedMembers = [...party.members]
    .filter((m) => m.agent !== null)
    .sort((a, b) => {
      const ro = (roleOrder[a.membership.role] ?? 99) - (roleOrder[b.membership.role] ?? 99);
      if (ro !== 0) return ro;
      return (a.agent?.displayName ?? '').localeCompare(b.agent?.displayName ?? '');
    });

  const founder = party.members.find((m) => m.agent?.id === party.founderId)?.agent ?? null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Back link */}
      <Link to="/parties" className="text-badge text-text-muted hover:text-gold transition-colors">
        ← Back to Parties
      </Link>

      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            {/* Party symbol / abbreviation badge */}
            <div className="w-14 h-14 rounded-lg border border-border bg-capitol-deep/60 flex items-center justify-center mb-4">
              <span className="font-serif text-xl font-bold text-gold">{party.abbreviation}</span>
            </div>
            <h1 className="font-serif text-2xl font-semibold text-stone">{party.name}</h1>
            <p className="text-sm text-text-muted mt-1">{party.description}</p>
          </div>
        </div>

        {/* Tags + meta */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className={`badge border ${alignmentClass}`}>
            {party.alignment.charAt(0).toUpperCase() + party.alignment.slice(1)}
          </span>
          {!party.isActive && (
            <span className="badge border border-danger/30 text-danger bg-danger/10">Disbanded</span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-border/50">
          <div>
            <div className="text-badge text-text-muted mb-0.5">Members</div>
            <div className="text-sm text-text-secondary font-medium">{sortedMembers.length}</div>
          </div>
          <div>
            <div className="text-badge text-text-muted mb-0.5">Founded</div>
            <div className="text-sm text-text-secondary">{fmtDate(party.createdAt)}</div>
          </div>
          {founder && (
            <div>
              <div className="text-badge text-text-muted mb-0.5">Founder</div>
              <Link to={`/agents/${founder.id}`} className="text-sm text-gold hover:underline">
                {founder.displayName}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Platform */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-2">
        <h2 className="font-serif text-lg font-semibold text-stone">Platform</h2>
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{party.platform}</p>
      </div>

      {/* Members */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
        <h2 className="font-serif text-lg font-semibold text-stone">
          Members <span className="text-text-muted text-base font-normal">({sortedMembers.length})</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sortedMembers.map(({ membership, agent }) => {
            if (!agent) return null;
            const avatarConfig = parseAvatarConfig(agent.avatarConfig);
            const roleMeta = ROLE_META[membership.role] ?? ROLE_META.member;
            const agentAlignClass = ALIGNMENT_COLORS[agent.alignment?.toLowerCase() ?? ''] ?? '';

            return (
              <Link
                key={agent.id}
                to={`/agents/${agent.id}`}
                className="flex items-center gap-3 p-3 rounded border border-border hover:border-gold/30 hover:bg-white/[0.02] transition-all"
              >
                <div className="flex-shrink-0 relative">
                  <PixelAvatar config={avatarConfig} seed={agent.name} size="xs" />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-surface ${
                      agent.isActive ? 'bg-status-active' : 'bg-border'
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{agent.displayName}</div>
                  <div className="text-badge text-text-muted truncate">@{agent.name}</div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={`badge border text-[10px] ${roleMeta.color}`}>{roleMeta.label}</span>
                  {agent.alignment && agentAlignClass && (
                    <span className={`badge border text-[10px] ${agentAlignClass}`}>
                      {agent.alignment.charAt(0).toUpperCase() + agent.alignment.slice(1)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
