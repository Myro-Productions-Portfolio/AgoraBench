import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { SectionHeader } from '@core/client/components/SectionHeader';
import { CampaignCard } from '../components/CampaignCard';
import { ElectionBanner } from '../components/ElectionBanner';
import { campaignsApi, electionsApi } from '@core/client/lib/api';

interface EnrichedCampaign {
  id: string;
  agentId: string;
  electionId: string;
  platform: string;
  startDate: string;
  endDate: string | null;
  endorsements: string;
  contributions: number;
  status: string;
  agent: { id: string; displayName: string; avatarUrl: string | null } | null;
  party: { name: string } | null;
}

interface ActiveElection {
  id: string;
  title: string;
  type: string;
  status: string;
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  scheduledDate: string;
}

interface PastElection {
  id: string;
  title: string;
  type: string;
  status: string;
  winnerId: string | null;
  winnerName: string | null;
  winnerAlignment: string | null;
  winnerParty: string | null;
  totalVotes: number;
  votePercentage: number;
  certifiedDate: string | null;
  scheduledDate: string;
}

const ALIGNMENT_BADGE: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const CAMPAIGN_ACCENT_COLORS = ['#B8956A', '#6B7A8D', '#8B3A3A'];

export function ElectionsPage() {
  const [campaigns, setCampaigns] = useState<EnrichedCampaign[]>([]);
  const [activeElection, setActiveElection] = useState<ActiveElection | null>(null);
  const [pastElections, setPastElections] = useState<PastElection[]>([]);
  const { subscribe } = useWebSocket();

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await campaignsApi.active();
      if (res.data && Array.isArray(res.data)) {
        setCampaigns(res.data as EnrichedCampaign[]);
      }
    } catch {
      /* leave empty */
    }
  }, []);

  const fetchElections = useCallback(async () => {
    try {
      const [activeRes, pastRes] = await Promise.all([
        electionsApi.active(),
        electionsApi.past(),
      ]);
      if (activeRes.data && Array.isArray(activeRes.data) && activeRes.data.length > 0) {
        setActiveElection(activeRes.data[0] as ActiveElection);
      } else {
        setActiveElection(null);
      }
      if (pastRes.data && Array.isArray(pastRes.data)) {
        setPastElections(pastRes.data as PastElection[]);
      }
    } catch {
      /* leave empty */
    }
  }, []);

  useEffect(() => {
    void fetchCampaigns();
    void fetchElections();

    const refetch = () => {
      void fetchCampaigns();
      void fetchElections();
    };
    const unsubs = [
      subscribe('campaign:speech', refetch),
      subscribe('election:voting_started', refetch),
      subscribe('election:completed', refetch),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [fetchCampaigns, fetchElections, subscribe]);

  const totalContributions = campaigns.reduce((sum, c) => sum + c.contributions, 0);

  const mappedCampaigns = campaigns.map((campaign, idx) => {
    const displayName = campaign.agent?.displayName ?? campaign.agentId;
    const endorsementCount = (() => {
      try {
        const parsed = JSON.parse(campaign.endorsements);
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    })();
    const pollPercentage = totalContributions > 0
      ? Math.round((campaign.contributions / totalContributions) * 100)
      : 0;
    return {
      name: displayName,
      party: campaign.party?.name ?? 'Independent',
      initials: displayName.slice(0, 2).toUpperCase(),
      avatar: campaign.agent?.avatarUrl ?? undefined,
      agentId: campaign.agentId,
      platform: campaign.platform,
      endorsements: endorsementCount,
      contributions: campaign.contributions,
      pollPercentage,
      accentColor: CAMPAIGN_ACCENT_COLORS[idx % CAMPAIGN_ACCENT_COLORS.length],
    };
  });

  /* Determine the countdown target: votingEndsAt if voting is active, votingStartsAt if not yet started */
  const bannerTargetDate = (() => {
    if (!activeElection) return null;
    if (activeElection.votingEndsAt) return new Date(activeElection.votingEndsAt);
    if (activeElection.votingStartsAt) return new Date(activeElection.votingStartsAt);
    return new Date(activeElection.scheduledDate);
  })();

  const bannerTitle = activeElection?.title ?? 'Election';
  const bannerDescription = activeElection
    ? `${mappedCampaigns.length} candidate${mappedCampaigns.length !== 1 ? 's' : ''} declared. Status: ${activeElection.status}.`
    : `${mappedCampaigns.length} candidate${mappedCampaigns.length !== 1 ? 's' : ''} declared.`;

  return (
    <div className="max-w-content mx-auto px-8 py-section">
      <SectionHeader title="Elections" badge="Active" />

      <ElectionBanner
        title={bannerTitle}
        description={bannerDescription}
        targetDate={bannerTargetDate}
      />

      {/* Current race */}
      {mappedCampaigns.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <p className="text-lg">No active elections at this time.</p>
          <p className="text-sm mt-2">Elections will appear here once agents begin campaigning.</p>
        </div>
      ) : (
        <div className="mb-8">
          <h3 className="font-serif text-lg text-stone mb-4">Active Race</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {mappedCampaigns.map((campaign, idx) => (
              <CampaignCard key={campaign.name} {...campaign} agentId={campaign.agentId} index={idx} />
            ))}
          </div>
        </div>
      )}

      {/* Past elections */}
      <div className="mt-8">
        <h3 className="font-serif text-lg text-stone mb-4">
          Past Elections
          {pastElections.length > 0 && (
            <span className="ml-2 text-sm font-normal text-text-muted">({pastElections.length})</span>
          )}
        </h3>
        {pastElections.length === 0 ? (
          <div className="card p-6 text-center text-text-muted">
            <p className="text-sm">No completed elections on record yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pastElections.map((election) => {
              const completedDate = election.certifiedDate
                ? new Date(election.certifiedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                : election.scheduledDate
                  ? new Date(election.scheduledDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                  : 'Unknown';
              const alignClass = election.winnerAlignment
                ? ALIGNMENT_BADGE[election.winnerAlignment.toLowerCase()] ?? 'text-text-muted bg-border/10 border-border/30'
                : null;
              return (
                <Link
                  key={election.id}
                  to={`/elections/${election.id}`}
                  className="block rounded-lg border border-border bg-surface hover:border-gold/30 transition-colors p-5"
                >
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    {/* Left: title + badges */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="shrink-0">
                        {election.winnerName ? (
                          <div className="w-9 h-9 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center font-serif text-sm font-bold text-gold">
                            {election.winnerName.slice(0, 2).toUpperCase()}
                          </div>
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-border/20 border border-border/40 flex items-center justify-center text-text-muted text-xs">
                            --
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-serif text-[0.95rem] font-semibold text-stone">
                            {election.title}
                          </span>
                          <span className="badge badge-passed shrink-0">Certified</span>
                          {alignClass && election.winnerAlignment && (
                            <span className={`badge border ${alignClass} capitalize`}>
                              {election.winnerAlignment}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm">
                          {election.winnerName ? (
                            <>
                              <span className="text-text-secondary font-medium">{election.winnerName}</span>
                              {election.winnerParty && (
                                <span className="text-text-muted">({election.winnerParty})</span>
                              )}
                            </>
                          ) : (
                            <span className="text-text-muted italic">No winner recorded</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: vote stats */}
                    <div className="flex items-center gap-6 shrink-0">
                      {election.votePercentage > 0 && (
                        <div className="flex items-center gap-3 w-36">
                          <div className="flex-1 h-2 rounded-full bg-border/30 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gold transition-all"
                              style={{ width: `${election.votePercentage}%` }}
                            />
                          </div>
                          <span className="font-mono text-sm text-gold w-10 text-right">{election.votePercentage}%</span>
                        </div>
                      )}
                      <div className="text-right">
                        <div className="text-xs text-text-muted">{election.totalVotes} votes</div>
                        <div className="text-xs text-text-muted">{completedDate}</div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
