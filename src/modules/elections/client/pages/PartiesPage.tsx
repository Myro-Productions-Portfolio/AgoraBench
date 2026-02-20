import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { SectionHeader } from '@core/client/components/SectionHeader';
import { partiesApi } from '@core/client/lib/api';
import { PixelAvatar } from '@modules/agents/client/components/PixelAvatar';

interface PartyData {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  alignment: string;
  memberCount: number;
  platform: string;
  logo?: string;
  founderId?: string;
  createdAt?: string;
}

interface MemberDetail {
  membership: {
    id: string;
    agentId: string;
    partyId: string;
    role: string;
    joinedAt: string;
  };
  agent: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    alignment: string | null;
  } | null;
}

interface PartyDetails extends PartyData {
  members: MemberDetail[];
}

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive: 'text-gold bg-gold/10',
  conservative: 'text-slate-light bg-slate-judicial/10',
  technocrat: 'text-status-passed bg-status-passed/10',
  moderate: 'text-stone bg-stone/10',
  libertarian: 'text-danger-text bg-danger-bg',
};

/* Known party logo images mapped from abbreviation (lowercase) */
const PARTY_LOGO_MAP: Record<string, string> = {
  cop: '/images/parties/cop.webp',
  dpa: '/images/parties/dpa.webp',
  tu: '/images/parties/tu.webp',
};

function resolvePartyLogo(party: PartyData): string | undefined {
  if (party.logo) return party.logo;
  const key = party.abbreviation.toLowerCase();
  return PARTY_LOGO_MAP[key];
}

export function PartiesPage() {
  const [parties, setParties] = useState<PartyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPartyId, setExpandedPartyId] = useState<string | null>(null);
  const [partyDetails, setPartyDetails] = useState<Record<string, PartyDetails>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
  const { subscribe } = useWebSocket();

  const fetchParties = useCallback(async () => {
    try {
      const res = await partiesApi.list();
      if (res.data && Array.isArray(res.data)) {
        setParties(res.data as PartyData[]);
      }
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchParties();

    const refetch = () => { void fetchParties(); };
    const unsubs = [
      subscribe('party:formed', refetch),
      subscribe('agent:joined_party', refetch),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [fetchParties, subscribe]);

  async function handleViewDetails(partyId: string) {
    /* Toggle collapse */
    if (expandedPartyId === partyId) {
      setExpandedPartyId(null);
      return;
    }

    setExpandedPartyId(partyId);

    /* Skip fetch if already loaded */
    if (partyDetails[partyId]) return;

    setLoadingDetails((prev) => ({ ...prev, [partyId]: true }));
    try {
      const res = await partiesApi.getById(partyId);
      if (res.data) {
        setPartyDetails((prev) => ({ ...prev, [partyId]: res.data as PartyDetails }));
      }
    } catch {
      /* leave empty */
    } finally {
      setLoadingDetails((prev) => ({ ...prev, [partyId]: false }));
    }
  }

  return (
    <div className="max-w-content mx-auto px-8 py-section">
      <SectionHeader title="Political Parties" badge={`${parties.length} Active`} />

      {loading && (
        <div className="flex items-center justify-center py-24">
          <p className="text-text-muted animate-pulse text-lg">Loading parties...</p>
        </div>
      )}

      {!loading && parties.length === 0 && (
        <div className="text-center py-16 text-text-muted">
          <p className="text-lg">No political parties have been formed yet.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
        {parties.map((party) => {
          const logoSrc = resolvePartyLogo(party);
          const isExpanded = expandedPartyId === party.id;
          const isLoadingDetails = loadingDetails[party.id] ?? false;
          const details = partyDetails[party.id] ?? null;

          return (
            <article key={party.id} className="card p-6 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                {logoSrc ? (
                  <img src={logoSrc} alt={party.abbreviation} className="w-12 h-12 rounded-icon object-contain" />
                ) : (
                  <div className="w-12 h-12 rounded-icon bg-capitol-deep border border-border flex items-center justify-center font-serif font-bold text-gold text-sm">
                    {party.abbreviation}
                  </div>
                )}
                <div>
                  <h3 className="font-serif text-card-title font-semibold">{party.name}</h3>
                  <span className={`badge ${ALIGNMENT_COLORS[party.alignment] || 'text-text-muted bg-border/10'}`}>
                    {party.alignment}
                  </span>
                </div>
              </div>

              <p className="text-sm text-text-secondary mb-4 flex-1">{party.description}</p>

              <div className="text-sm text-text-secondary italic p-3 bg-black/15 rounded border-l-2 border-border mb-4">
                "{party.platform}"
              </div>

              <div className="flex justify-between pt-3 border-t border-border-light">
                <div>
                  <div className="font-mono text-sm text-gold">{party.memberCount}</div>
                  <div className="text-stat-label text-text-muted uppercase">Members</div>
                </div>
                <button
                  className="btn-secondary text-xs"
                  type="button"
                  onClick={() => void handleViewDetails(party.id)}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? 'Collapse' : 'View Details'}
                </button>
              </div>

              {/* Expanded details panel */}
              {isExpanded && (
                <div className="mt-4 border-t border-border pt-4">
                  {isLoadingDetails && (
                    <div className="flex items-center justify-center py-6">
                      <p className="text-text-muted animate-pulse text-sm">Loading members...</p>
                    </div>
                  )}

                  {!isLoadingDetails && details && (
                    <div className="flex flex-col gap-3">
                      {/* Founding info */}
                      {details.createdAt && (
                        <div className="text-xs text-text-muted">
                          Founded:{' '}
                          <span className="text-text-secondary">
                            {new Date(details.createdAt).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      )}

                      {/* Member roster */}
                      <div>
                        <div className="text-xs text-text-muted uppercase tracking-wide mb-2">Members</div>
                        {details.members.length === 0 ? (
                          <p className="text-sm text-text-muted italic">No members on record.</p>
                        ) : (
                          <ul className="flex flex-col gap-2">
                            {details.members.map((m) => {
                              const displayName = m.agent?.displayName ?? m.membership.agentId;
                              const avatarUrl = m.agent?.avatarUrl ?? null;
                              return (
                                <li key={m.membership.id} className="flex items-center gap-2">
                                  {avatarUrl ? (
                                    <img
                                      src={avatarUrl}
                                      alt={displayName}
                                      className="w-7 h-7 rounded-full object-cover border border-border"
                                    />
                                  ) : (
                                    <PixelAvatar seed={displayName} size="xs" />
                                  )}
                                  <Link
                                    to={`/agents/${m.membership.agentId}`}
                                    className="text-sm flex-1 hover:text-gold transition-colors"
                                  >
                                    {displayName}
                                  </Link>
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${m.membership.role === 'leader' ? 'text-gold bg-gold/10' : 'text-text-muted bg-border/10'}`}>
                                    {m.membership.role}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}

                  {!isLoadingDetails && !details && (
                    <p className="text-sm text-text-muted italic">Could not load party details.</p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
