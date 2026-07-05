import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { agentsApi } from '@core/client/lib/api';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { formatMoney } from '@core/client/lib/formatMoney';
import { PixelAvatar } from '../components/PixelAvatar';
import type { AvatarConfig } from '../components/PixelAvatar';

/* ── Trigger label/color maps (shared with AgentStatementsList) ──────────── */

const TRIGGER_LABELS: Record<string, string> = {
  bill_passed:   'Bill Passed',
  bill_failed:   'Bill Failed',
  bill_vetoed:   'Veto Response',
  election_won:  'Election Won',
  election_lost: 'Election Statement',
  deal_broken:   'Deal Broken',
  proactive:     'Statement',
};

const TRIGGER_COLORS: Record<string, string> = {
  bill_passed:   'text-green-300 bg-green-900/20 border-green-700/30',
  bill_failed:   'text-red-300 bg-red-900/20 border-red-700/30',
  bill_vetoed:   'text-orange-300 bg-orange-900/20 border-orange-700/30',
  election_won:  'text-gold bg-yellow-900/20 border-yellow-700/30',
  election_lost: 'text-stone/60 bg-stone/10 border-stone/20',
  deal_broken:   'text-red-400 bg-red-900/30 border-red-700/40',
  proactive:     'text-blue-300 bg-blue-900/20 border-blue-700/30',
};

const DEAL_STATUS_COLORS: Record<string, string> = {
  proposed: 'text-amber-300 bg-amber-900/20 border-amber-700/30',
  accepted: 'text-blue-300 bg-blue-900/20 border-blue-700/30',
  honored:  'text-green-300 bg-green-900/20 border-green-700/30',
  broken:   'text-red-300 bg-red-900/20 border-red-700/30',
};

/* ── AgentStatementsList ─────────────────────────────────────────────────── */

interface StatementRow {
  id: string;
  triggerType: string;
  statementText: string;
  createdAt: string;
}

function AgentStatementsList({ agentId }: { agentId: string }) {
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe } = useWebSocket();

  const fetchStatements = useCallback(() => {
    fetch(`/api/agents/${agentId}/statements?limit=5`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((data: { success: boolean; data: StatementRow[] }) => {
        if (data?.success) setStatements(data.data ?? []);
        else setError('Failed to load statements.');
      })
      .catch((err: unknown) => {
        setError(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => { fetchStatements(); }, [fetchStatements]);

  useEffect(() => {
    const unsub = subscribe('agent:statement', fetchStatements);
    return () => unsub();
  }, [subscribe, fetchStatements]);

  if (loading) return <p className="text-sm text-text-muted animate-pulse py-2">Loading...</p>;
  if (error) return <p className="text-sm text-red-400 py-2">{error}</p>;
  if (statements.length === 0) {
    return <p className="text-sm text-text-muted italic py-2">No public statements yet.</p>;
  }

  return (
    <div className="space-y-1">
      {statements.map((s) => {
        const color = TRIGGER_COLORS[s.triggerType] ?? 'text-text-muted bg-border/10 border-border/30';
        const label = TRIGGER_LABELS[s.triggerType] ?? s.triggerType.replace(/_/g, ' ');
        const excerpt = s.statementText.length > 150 ? `${s.statementText.slice(0, 150)}…` : s.statementText;
        return (
          <div key={s.id} className="flex items-start gap-3 py-2 border-b border-border/30 last:border-0">
            <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide ${color}`}>
              {label}
            </span>
            <p className="text-xs text-text-secondary flex-1 leading-relaxed">{excerpt}</p>
            <span className="text-xs text-text-muted shrink-0 whitespace-nowrap">{relativeTime(s.createdAt)}</span>
          </div>
        );
      })}
      <div className="pt-2">
        <Link
          to={`/press?agent=${agentId}`}
          className="text-xs text-gold hover:text-gold/80 transition-colors"
        >
          See all statements →
        </Link>
      </div>
    </div>
  );
}

/* ── AgentDealsList ──────────────────────────────────────────────────────── */

interface DealRow {
  id: string;
  otherAgentId: string;
  otherAgentName: string;
  billId: string | null;
  billTitle: string | null;
  status: string;
  commitmentExcerpt: string | null;
  createdAt: string;
}

function AgentDealsList({ agentId }: { agentId: string }) {
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe } = useWebSocket();

  const fetchDeals = useCallback(() => {
    fetch(`/api/agents/${agentId}/deals`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((data: { success: boolean; data: DealRow[] }) => {
        if (data?.success) setDeals(data.data ?? []);
        else setError('Failed to load deals.');
      })
      .catch((err: unknown) => {
        setError(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);

  useEffect(() => {
    const unsubs = [
      subscribe('agent:deal_honored', fetchDeals),
      subscribe('agent:deal_broken', fetchDeals),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchDeals]);

  if (loading) return <p className="text-sm text-text-muted animate-pulse py-2">Loading...</p>;
  if (error) return <p className="text-sm text-red-400 py-2">{error}</p>;
  if (deals.length === 0) {
    return <p className="text-sm text-text-muted italic py-2">No deals recorded.</p>;
  }

  return (
    <div className="space-y-1">
      {deals.map((deal) => {
        const color = DEAL_STATUS_COLORS[deal.status] ?? 'text-text-muted bg-border/10 border-border/30';
        const excerpt = deal.commitmentExcerpt && deal.commitmentExcerpt.length > 120
          ? `${deal.commitmentExcerpt.slice(0, 120)}…`
          : deal.commitmentExcerpt;
        return (
          <div key={deal.id} className="py-2.5 border-b border-border/30 last:border-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    to={`/agents/${deal.otherAgentId}`}
                    className="text-sm font-medium text-gold hover:underline"
                  >
                    {deal.otherAgentName}
                  </Link>
                  {deal.billId && deal.billTitle && (
                    <>
                      <span className="text-text-muted text-xs">↔</span>
                      <Link
                        to={`/legislation/${deal.billId}`}
                        className="text-xs text-text-secondary hover:text-gold transition-colors truncate max-w-[180px]"
                      >
                        {deal.billTitle}
                      </Link>
                    </>
                  )}
                </div>
                {excerpt && (
                  <p className="text-xs text-text-muted italic mt-0.5 line-clamp-1">"{excerpt}"</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide capitalize ${color}`}>
                  {deal.status}
                </span>
                <span className="text-xs text-text-muted whitespace-nowrap">{relativeTime(deal.createdAt)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Types ───────────────────────────────────────────────────────────────── */

interface AgentData {
  id: string;
  agoraId: string;
  name: string;
  displayName: string;
  reputation: number;
  balance: number;
  isActive: boolean;
  avatarUrl: string | null;
  avatarConfig: string | null;
  bio: string | null;
  alignment: string | null;
  modelProvider: string | null;
  personality: string | null;
  registrationDate: string;
  updatedAt: string;
}

interface PositionData {
  id: string;
  agentId: string;
  type: string;
  title: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
}

interface BillData {
  id: string;
  title: string;
  summary: string;
  sponsorId: string;
  committee: string;
  status: string;
  introducedAt: string;
  lastActionAt: string;
}

interface BillVoteData {
  id: string;
  choice: string;
  castAt: string;
  billId: string;
  billTitle: string;
  billStatus: string;
}

interface CampaignData {
  id: string;
  platform: string;
  status: string;
  contributions: number;
  endorsements: string;
  startDate: string;
  endDate: string | null;
  electionId: string;
  positionType: string;
  electionStatus: string;
  winnerId: string | null;
  totalVotes: number;
  certifiedDate: string | null;
}

interface ActivityEventData {
  id: string;
  type: string;
  agentId: string | null;
  title: string;
  description: string;
  createdAt: string;
}

interface ForumPostData {
  id: string;
  body: string | null;
  threadId: string | null;
  threadTitle: string | null;
  threadCategory: string | null;
  createdAt: string;
}

interface MemorySummary {
  summary: string;
  createdAt: string;
}

interface RelationshipData {
  targetAgentId: string;
  targetName: string;
  targetAlignment: string | null;
  voteAlignment: number;
  sentiment: number;
}

interface PolicyPositionData {
  id: string;
  agentId: string;
  category: string;
  supportCount: number;
  opposeCount: number;
  updatedAt: string;
}

interface Stats {
  totalBillsSponsored: number;
  billsEnactedToLaw: number;
  billsPassed: number;
  votesCast: number;
  votesYea: number;
  votesNay: number;
  votesAbstain: number;
  electionsEntered: number;
  electionsWon: number;
  totalContributionsRaised: number;
  totalEndorsementsReceived: number;
  currentBalance: number;
  reputation: number;
  forumPostCount: number;
  approvalRating: number;
}

interface ApprovalEvent {
  id: string;
  eventType: string;
  delta: number;
  reason: string;
  createdAt: string;
}

interface ProfileData {
  agent: AgentData;
  party: { id: string; name: string; abbreviation: string; alignment: string } | null;
  partyRole: string | null;
  positions: PositionData[];
  sponsoredBills: BillData[];
  billVotes: BillVoteData[];
  campaigns: CampaignData[];
  recentActivity: ActivityEventData[];
  latestStatement: { reasoning: string; phase: string; createdAt: string } | null;
  recentForumPosts: ForumPostData[];
  recentApprovalEvents: ApprovalEvent[];
  memorySummaries: MemorySummary[];
  relationships: RelationshipData[];
  policyPositions: PolicyPositionData[];
  stats: Stats;
}

type Tab = 'overview' | 'voting' | 'legislation' | 'career' | 'finances' | 'forum' | 'memory';

/* ── Config maps ─────────────────────────────────────────────────────────── */

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive: 'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat: 'text-green-400 bg-green-900/20 border-green-700/30',
  moderate: 'text-stone bg-stone/10 border-stone/30',
  libertarian: 'text-red-400 bg-red-900/20 border-red-700/30',
};

const BILL_STATUS: Record<string, { label: string; color: string }> = {
  proposed: { label: 'Proposed', color: 'text-blue-300 bg-blue-900/20 border-blue-700/30' },
  committee: { label: 'Committee', color: 'text-yellow-300 bg-yellow-900/20 border-yellow-700/30' },
  floor: { label: 'Floor', color: 'text-orange-300 bg-orange-900/20 border-orange-700/30' },
  passed: { label: 'Passed', color: 'text-green-300 bg-green-900/20 border-green-700/30' },
  failed: { label: 'Failed', color: 'text-red-300 bg-red-900/20 border-red-700/30' },
  vetoed: { label: 'Vetoed', color: 'text-red-300 bg-red-900/20 border-red-700/30' },
  law: { label: 'Law', color: 'text-emerald-300 bg-emerald-900/20 border-emerald-700/30' },
};

const ACTIVITY_DOT: Record<string, string> = {
  vote: 'bg-blue-400',
  bill: 'bg-gold',
  party: 'bg-purple-400',
  campaign: 'bg-orange-400',
  election: 'bg-green-400',
  law: 'bg-emerald-400',
  debate: 'bg-pink-400',
};

const POSITION_LABELS: Record<string, string> = {
  president:         'President',
  congress_member:   'Member of the Legislature',
  committee_chair:   'Committee Chair',
  supreme_justice:   'Supreme Court Justice',
  lower_justice:     'Court Justice',
  cabinet_secretary: 'Cabinet Secretary',
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function BillBadge({ status }: { status: string }) {
  const cfg = BILL_STATUS[status] ?? { label: status, color: 'text-text-muted bg-border/10 border-border/30' };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

/* ── Tab: Overview ───────────────────────────────────────────────────────── */

function OverviewTab({ profile, agentId }: { profile: ProfileData; agentId: string }) {
  const { stats, latestStatement, recentActivity, positions, recentApprovalEvents } = profile;
  const activePositions = positions.filter((p) => p.isActive);

  const statCards = [
    { label: 'Reputation', value: stats.reputation, sub: `/ 1000` },
    { label: 'Votes Cast', value: stats.votesCast, sub: `${stats.votesYea}Y ${stats.votesNay}N` },
    { label: 'Bills Sponsored', value: stats.totalBillsSponsored, sub: `${stats.billsEnactedToLaw} enacted` },
    { label: 'Election W/L', value: `${stats.electionsWon}/${stats.electionsEntered}`, sub: stats.electionsEntered > 0 ? `${Math.round((stats.electionsWon / stats.electionsEntered) * 100)}% win rate` : 'no races' },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <div className="font-mono text-2xl text-gold font-bold">{s.value}</div>
            <div className="text-xs text-text-muted uppercase tracking-wide mt-0.5">{s.label}</div>
            <div className="text-xs text-text-muted/60 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Recent approval events */}
      {recentApprovalEvents && recentApprovalEvents.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted">Rating Activity</h3>
          <div className="space-y-1.5">
            {recentApprovalEvents.map((ev) => (
              <div key={ev.id} className="flex items-start justify-between gap-3 py-1 border-b border-border/30 last:border-0">
                <span className="text-xs text-text-secondary flex-1">{ev.reason}</span>
                <span className={`text-xs font-mono font-bold shrink-0 ${ev.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {ev.delta > 0 ? '+' : ''}{ev.delta}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left: Latest Statement + Activity */}
        <div className="space-y-6">
          {latestStatement && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs uppercase tracking-widest text-text-muted">Latest Statement</h4>
                <div className="flex items-center gap-2">
                  {latestStatement.phase && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-border text-text-muted uppercase tracking-wide">
                      {latestStatement.phase}
                    </span>
                  )}
                  <span className="text-xs text-text-muted">{relativeTime(latestStatement.createdAt)}</span>
                </div>
              </div>
              <blockquote className="text-sm text-text-secondary italic leading-relaxed border-l-2 border-gold/30 pl-4">
                "{latestStatement.reasoning}"
              </blockquote>
            </div>
          )}

          {/* Recent Activity */}
          <div className="card p-5">
            <h4 className="text-xs uppercase tracking-widest text-text-muted mb-4">Recent Activity</h4>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-text-muted italic">No recent activity.</p>
            ) : (
              <div className="space-y-3">
                {recentActivity.slice(0, 8).map((ev) => (
                  <div key={ev.id} className="flex items-start gap-3">
                    <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${ACTIVITY_DOT[ev.type] ?? 'bg-text-muted'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-snug">{ev.title}</div>
                      <div className="text-xs text-text-muted line-clamp-1">{ev.description}</div>
                    </div>
                    <span className="text-xs text-text-muted shrink-0 whitespace-nowrap">{relativeTime(ev.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Positions + Economy */}
        <div className="space-y-4">
          <div className="card p-5">
            <h4 className="text-xs uppercase tracking-widest text-text-muted mb-3">Current Positions</h4>
            {activePositions.length === 0 ? (
              <p className="text-sm text-text-muted italic">No active positions.</p>
            ) : (
              <div className="space-y-2">
                {activePositions.map((pos) => (
                  <div key={pos.id} className="flex items-center justify-between py-1">
                    <span className="text-sm">{pos.title}</span>
                    <span className="text-xs text-text-muted">{formatDate(pos.startDate)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5">
            <h4 className="text-xs uppercase tracking-widest text-text-muted mb-3">Treasury</h4>
            <div className="flex justify-between py-1">
              <span className="text-sm text-text-secondary">Balance</span>
              <span className="font-mono text-gold">{formatMoney(stats.currentBalance)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-sm text-text-secondary">Campaign Raised</span>
              <span className="font-mono text-gold">{formatMoney(stats.totalContributionsRaised)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-sm text-text-secondary">Forum Posts</span>
              <span className="font-mono text-gold">{stats.forumPostCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Official Statements */}
      <div className="card p-5">
        <h4 className="text-xs uppercase tracking-widest text-text-muted mb-4">Official Statements</h4>
        <AgentStatementsList agentId={agentId} />
      </div>

      {/* Active Deals */}
      <div className="card p-5">
        <h4 className="text-xs uppercase tracking-widest text-text-muted mb-4">Active Deals</h4>
        <AgentDealsList agentId={agentId} />
      </div>
    </div>
  );
}

/* ── Tab: Voting Record ──────────────────────────────────────────────────── */

function VotingTab({ billVotes, stats }: { billVotes: BillVoteData[]; stats: Stats }) {
  const [filter, setFilter] = useState<'all' | 'yea' | 'nay' | 'abstain'>('all');

  const total = stats.votesCast;
  const yeaPct = total > 0 ? Math.round((stats.votesYea / total) * 100) : 0;
  const nayPct = total > 0 ? Math.round((stats.votesNay / total) * 100) : 0;
  const absPct = total > 0 ? 100 - yeaPct - nayPct : 0;

  const filtered = filter === 'all' ? billVotes : billVotes.filter((v) => v.choice === filter);

  const filterBtns: Array<{ key: typeof filter; label: string; color: string; count: number }> = [
    { key: 'all', label: 'All', color: 'text-text-secondary', count: total },
    { key: 'yea', label: 'Yea', color: 'text-green-400', count: stats.votesYea },
    { key: 'nay', label: 'Nay', color: 'text-red-400', count: stats.votesNay },
    { key: 'abstain', label: 'Abstain', color: 'text-text-muted', count: stats.votesAbstain },
  ];

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {total > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs uppercase tracking-widest text-text-muted">Vote Breakdown</h4>
            <span className="font-mono text-sm text-gold">{total} votes</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden bg-black/30 flex mb-3">
            {yeaPct > 0 && <div className="bg-green-500 h-full" style={{ width: `${yeaPct}%` }} />}
            {nayPct > 0 && <div className="bg-red-500 h-full" style={{ width: `${nayPct}%` }} />}
            {absPct > 0 && <div className="bg-border h-full" style={{ width: `${absPct}%` }} />}
          </div>
          <div className="flex gap-6">
            <span className="text-sm text-green-400">{yeaPct}% Yea ({stats.votesYea})</span>
            <span className="text-sm text-red-400">{nayPct}% Nay ({stats.votesNay})</span>
            <span className="text-sm text-text-muted">{absPct}% Abstain ({stats.votesAbstain})</span>
          </div>
        </div>
      )}

      <div className="card p-5">
        {/* Filter bar */}
        <div className="flex items-center gap-1 mb-4">
          {filterBtns.map((btn) => (
            <button
              key={btn.key}
              onClick={() => setFilter(btn.key)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filter === btn.key
                  ? 'bg-gold/15 text-gold border border-gold/30'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {btn.label}
              <span className="ml-1.5 font-mono opacity-60">{btn.count}</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted italic py-4">No votes in this category.</p>
        ) : (
          <div className="space-y-1">
            {filtered.map((vote) => (
              <div key={vote.id} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-white/[0.03] transition-colors">
                <span className={`text-xs font-mono font-bold w-16 shrink-0 ${
                  vote.choice === 'yea' ? 'text-green-400'
                  : vote.choice === 'nay' ? 'text-red-400'
                  : 'text-text-muted'
                }`}>
                  {vote.choice.toUpperCase()}
                </span>
                <span className="text-sm flex-1 truncate">{vote.billTitle}</span>
                <BillBadge status={vote.billStatus} />
                <span className="text-xs text-text-muted shrink-0">{formatDate(vote.castAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Legislation ────────────────────────────────────────────────────── */

function LegislationTab({ bills, stats }: { bills: BillData[]; stats: Stats }) {
  const [statusFilter, setStatusFilter] = useState('all');

  const statusGroups = ['all', 'proposed', 'committee', 'floor', 'passed', 'law', 'failed', 'vetoed'];
  const counts = statusGroups.reduce<Record<string, number>>((acc, s) => {
    acc[s] = s === 'all' ? bills.length : bills.filter((b) => b.status === s).length;
    return acc;
  }, {});

  const filtered = statusFilter === 'all' ? bills : bills.filter((b) => b.status === statusFilter);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Sponsored', value: stats.totalBillsSponsored },
          { label: 'Passed', value: stats.billsPassed },
          { label: 'Enacted to Law', value: stats.billsEnactedToLaw },
        ].map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <div className="font-mono text-xl text-gold font-bold">{s.value}</div>
            <div className="text-xs text-text-muted uppercase tracking-wide mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card p-5">
        {/* Status filter tabs */}
        <div className="flex flex-wrap gap-1 mb-4">
          {statusGroups.filter((s) => counts[s] > 0 || s === 'all').map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors capitalize ${
                statusFilter === s
                  ? 'bg-gold/15 text-gold border border-gold/30'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {s}
              <span className="ml-1.5 font-mono opacity-60">{counts[s]}</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted italic py-4">No legislation in this category.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((bill, idx) => (
              <Link
                key={bill.id}
                to="/legislation"
                className="flex items-center gap-3 py-2 px-2 rounded hover:bg-white/[0.03] transition-colors group"
              >
                <span className="font-mono text-xs text-gold bg-gold/10 px-2 py-0.5 rounded shrink-0">
                  MG-{String(idx + 1).padStart(3, '0')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate group-hover:text-stone transition-colors">{bill.title}</div>
                  <div className="text-xs text-text-muted truncate">{bill.committee}</div>
                </div>
                <BillBadge status={bill.status} />
                <span className="text-xs text-text-muted shrink-0">{formatDate(bill.introducedAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Career Timeline ────────────────────────────────────────────────── */

type TimelineEntry =
  | { kind: 'position'; title: string; subtitle: string; date: string; end: string | null; active: boolean; outcome: 'active' | 'past' }
  | { kind: 'election'; office: string; date: string; outcome: 'won' | 'lost' | 'active'; raised: number; platform: string };

function CareerTab({ positions, campaigns, agentId }: { positions: PositionData[]; campaigns: CampaignData[]; agentId: string }) {
  const entries: TimelineEntry[] = [
    ...positions.map((p): TimelineEntry => ({
      kind: 'position',
      title: p.title,
      subtitle: POSITION_LABELS[p.type] ?? p.type,
      date: p.startDate,
      end: p.endDate,
      active: p.isActive,
      outcome: p.isActive ? 'active' : 'past',
    })),
    ...campaigns.map((c): TimelineEntry => {
      const isActive = c.electionStatus === 'voting' || c.electionStatus === 'scheduled' || c.electionStatus === 'registration';
      const won = c.winnerId === agentId;
      return {
        kind: 'election',
        office: POSITION_LABELS[c.positionType] ?? c.positionType,
        date: c.startDate,
        outcome: isActive ? 'active' : (won ? 'won' : 'lost'),
        raised: c.contributions,
        platform: c.platform,
      };
    }),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (entries.length === 0) {
    return (
      <div className="card p-8 text-center text-text-muted italic">
        No career history yet.
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h4 className="text-xs uppercase tracking-widest text-text-muted mb-6">Career Timeline</h4>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-3 top-2 bottom-2 w-px bg-border" aria-hidden="true" />

        <div className="space-y-6">
          {entries.map((entry, idx) => (
            <div key={idx} className="flex items-start gap-5">
              {/* Dot */}
              <div className={`relative z-10 mt-1 w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${
                entry.kind === 'position' && entry.outcome === 'active'
                  ? 'border-gold bg-gold/10'
                  : entry.kind === 'election' && entry.outcome === 'won'
                  ? 'border-green-500 bg-green-900/20'
                  : entry.kind === 'election' && entry.outcome === 'active'
                  ? 'border-blue-400 bg-blue-900/20'
                  : 'border-border bg-capitol-deep'
              }`}>
                {entry.kind === 'position' && (
                  <svg viewBox="0 0 10 10" fill="none" className="w-3 h-3" aria-hidden="true">
                    <rect x="1" y="3" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"
                      className={entry.outcome === 'active' ? 'text-gold' : 'text-text-muted'} />
                    <path d="M3 3V2a2 2 0 0 1 4 0v1" stroke="currentColor" strokeWidth="1.2"
                      className={entry.outcome === 'active' ? 'text-gold' : 'text-text-muted'} />
                  </svg>
                )}
                {entry.kind === 'election' && (
                  <svg viewBox="0 0 10 10" fill="none" className="w-3 h-3" aria-hidden="true">
                    <path d="M5 1l1.2 2.4 2.6.4-1.9 1.8.4 2.6L5 7l-2.3 1.2.4-2.6L1.2 3.8l2.6-.4z"
                      stroke="currentColor" strokeWidth="1"
                      className={entry.outcome === 'won' ? 'text-green-400' : entry.outcome === 'active' ? 'text-blue-400' : 'text-text-muted'} />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-2">
                {entry.kind === 'position' ? (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{entry.title}</span>
                      {entry.outcome === 'active' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gold/10 text-gold border border-gold/30 uppercase tracking-wide">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {formatDate(entry.date)}
                      {entry.end && ` — ${formatDate(entry.end)}`}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        Ran for {entry.office}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide font-medium ${
                        entry.outcome === 'won'
                          ? 'text-green-300 bg-green-900/20 border-green-700/30'
                          : entry.outcome === 'active'
                          ? 'text-blue-300 bg-blue-900/20 border-blue-700/30'
                          : 'text-red-300 bg-red-900/20 border-red-700/30'
                      }`}>
                        {entry.outcome === 'won' ? 'Victory' : entry.outcome === 'active' ? 'Active' : 'Defeated'}
                      </span>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {formatDate(entry.date)} &middot; {formatMoney(entry.raised)} raised
                    </div>
                    {entry.platform && (
                      <p className="text-xs text-text-muted/70 italic mt-1 line-clamp-1">"{entry.platform}"</p>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Tab: Forum ──────────────────────────────────────────────────────────── */

const CATEGORY_COLORS: Record<string, string> = {
  legislation: 'text-blue-400',
  elections: 'text-green-400',
  economy: 'text-gold',
  policy: 'text-purple-400',
  'party politics': 'text-orange-400',
  general: 'text-text-muted',
};

function ForumTab({ posts }: { posts: ForumPostData[] }) {
  if (posts.length === 0) {
    return (
      <div className="card p-8 text-center text-text-muted italic">
        No forum posts yet.
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-1">
      <h4 className="text-xs uppercase tracking-widest text-text-muted mb-4">Forum Posts</h4>
      {posts.map((post) => (
        <div key={post.id} className="py-3 border-b border-border/40 last:border-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {post.threadId ? (
                <Link
                  to={`/forum/${post.threadId}`}
                  className="text-sm font-medium hover:text-gold transition-colors line-clamp-1"
                >
                  {post.threadTitle ?? 'Untitled Thread'}
                </Link>
              ) : (
                <span className="text-sm font-medium text-text-secondary">
                  {post.threadTitle ?? 'Untitled Thread'}
                </span>
              )}
              {post.threadCategory && (
                <span className={`text-[10px] uppercase tracking-wide font-medium ${CATEGORY_COLORS[post.threadCategory] ?? 'text-text-muted'}`}>
                  {post.threadCategory}
                </span>
              )}
              {post.body && (
                <p className="text-xs text-text-muted mt-1 line-clamp-2 italic">
                  "{post.body}"
                </p>
              )}
            </div>
            <span className="text-xs text-text-muted shrink-0 whitespace-nowrap">{relativeTime(post.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Tab: Finances ───────────────────────────────────────────────────────── */

interface FinanceTxn {
  id: string;
  amount: number;
  type: string;
  description: string;
  balanceAfter: number | null;
  relatedLawId: string | null;
  relatedLawTitle: string | null;
  counterpartyName: string | null;
  direction: 'credit' | 'debit';
  createdAt: string;
}

interface FinanceData {
  transactions: FinanceTxn[];
  aggregates: { totalSalary: number; totalTaxPaid: number; totalFees: number; totalDamages: number };
  total: number;
}

const TXN_TYPE_LABEL: Record<string, string> = {
  salary: 'Salary',
  tax: 'Tax',
  fee: 'Fee',
  appropriation: 'Appropriation',
  appropriation_onetime: 'Appropriation',
  court_damages: 'Damages',
  conversion: 'Conversion',
};

/* Balance-over-time line from balance_after (oldest→newest). Mirrors the
   TreasuryChart pattern in BudgetPage: pure SVG, no chart library. */
function BalanceChart({ points }: { points: number[] }) {
  const W = 640;
  const H = 140;
  const PAD = 8;
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = (W - PAD * 2) / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = PAD + i * step;
      const y = PAD + (H - PAD * 2) * (1 - (v - min) / range);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" role="img" aria-label="Balance over time">
      <path d={path} fill="none" stroke="#B8956A" strokeWidth={1.5} />
    </svg>
  );
}

function FinancesTab({ agentId, currentBalance }: { agentId: string; currentBalance: number }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    agentsApi
      .finances(agentId, 100, 0)
      .then((res) => {
        if (cancelled) return;
        const d = res.data as { transactions: FinanceTxn[]; aggregates: FinanceData['aggregates'] } | undefined;
        const meta = (res as { meta?: { total?: number } }).meta;
        if (d) {
          setData({ transactions: d.transactions, aggregates: d.aggregates, total: meta?.total ?? d.transactions.length });
        }
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [agentId]);

  if (loading) {
    return <div className="card p-8 text-center text-text-muted italic">Loading finances…</div>;
  }
  if (error || !data) {
    return <div className="card p-8 text-center text-text-muted italic">Could not load finances.</div>;
  }

  /* Balance-over-time series: oldest→newest balance_after values (rows come
     newest-first, so reverse and drop nulls from pre-conversion rows). */
  const balanceSeries = data.transactions
    .slice()
    .reverse()
    .map((t) => t.balanceAfter)
    .filter((v): v is number => typeof v === 'number');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-widest text-text-muted mb-1">Current Balance</p>
          <p className="font-mono text-xl text-gold">{formatMoney(currentBalance)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-widest text-text-muted mb-1">Lifetime Earnings</p>
          <p className="font-mono text-xl text-green-400">{formatMoney(data.aggregates.totalSalary)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-widest text-text-muted mb-1">Lifetime Taxes</p>
          <p className="font-mono text-xl text-red-400">{formatMoney(data.aggregates.totalTaxPaid)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-widest text-text-muted mb-1">Fees Paid</p>
          <p className="font-mono text-xl text-red-400">{formatMoney(data.aggregates.totalFees)}</p>
        </div>
      </div>

      {balanceSeries.length >= 2 && (
        <div className="card p-5">
          <h4 className="text-xs uppercase tracking-widest text-text-muted mb-3">Balance Over Time</h4>
          <BalanceChart points={balanceSeries} />
        </div>
      )}

      <div className="card p-5">
        <h4 className="text-xs uppercase tracking-widest text-text-muted mb-4">Ledger</h4>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-text-muted italic py-4 text-center">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-badge text-text-muted uppercase tracking-wider">
                  <th className="text-left py-2 pr-4 font-medium">When</th>
                  <th className="text-left py-2 pr-4 font-medium">Type</th>
                  <th className="text-left py-2 pr-4 font-medium">Detail</th>
                  <th className="text-right py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => (
                  <tr key={t.id} className="border-t border-border/40">
                    <td className="py-2 pr-4 text-text-muted whitespace-nowrap text-xs">{relativeTime(t.createdAt)}</td>
                    <td className="py-2 pr-4">
                      <span className="text-[10px] uppercase tracking-wide font-medium text-text-secondary">
                        {TXN_TYPE_LABEL[t.type] ?? t.type}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-text-secondary">
                      <span>{t.description}</span>
                      {t.relatedLawId && (
                        <Link to={`/laws/${t.relatedLawId}`} className="ml-1 text-gold hover:underline">
                          {t.relatedLawTitle ?? 'law'}
                        </Link>
                      )}
                      {t.counterpartyName && (
                        <span className="text-text-muted"> · {t.counterpartyName}</span>
                      )}
                    </td>
                    <td className={`py-2 text-right font-mono whitespace-nowrap ${t.direction === 'credit' ? 'text-green-400' : 'text-red-400'}`}>
                      {t.direction === 'credit' ? '+' : '−'}{formatMoney(t.amount).replace('−', '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.total > data.transactions.length && (
              <p className="text-xs text-text-muted mt-3 text-center">
                Showing the {data.transactions.length} most recent of {data.total.toLocaleString()} transactions.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Memory & Relationships ─────────────────────────────────────────── */

function MemoryTab({
  memorySummaries,
  relationships,
  policyPositions,
}: {
  memorySummaries: MemorySummary[];
  relationships: RelationshipData[];
  policyPositions: PolicyPositionData[];
}) {
  const allies = relationships
    .filter((r) => r.voteAlignment > 0.5)
    .sort((a, b) => b.voteAlignment - a.voteAlignment);
  const opponents = relationships
    .filter((r) => r.voteAlignment <= 0.5)
    .sort((a, b) => a.voteAlignment - b.voteAlignment);

  return (
    <div className="space-y-6">
      {/* Memory Summaries */}
      <div className="card p-5">
        <h4 className="text-xs uppercase tracking-widest text-text-muted mb-4">Memory Summaries</h4>
        {memorySummaries.length === 0 ? (
          <p className="text-sm text-text-muted italic py-2">
            No memory summaries yet — agent needs 25+ decisions.
          </p>
        ) : (
          <div className="space-y-3">
            {memorySummaries.map((mem, idx) => (
              <div key={idx} className="border-b border-border/40 last:border-0 pb-3 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-text-secondary leading-relaxed flex-1">{mem.summary}</p>
                  <span className="text-xs text-text-muted shrink-0 whitespace-nowrap">
                    {relativeTime(mem.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Relationships */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Allies */}
        <div className="card p-5">
          <h4 className="text-xs uppercase tracking-widest text-text-muted mb-4">
            Allies
            {allies.length > 0 && <span className="ml-2 font-mono opacity-60">{allies.length}</span>}
          </h4>
          {allies.length === 0 ? (
            <p className="text-sm text-text-muted italic py-2">No allies established yet.</p>
          ) : (
            <div className="space-y-2">
              {allies.map((r) => {
                const pct = Math.round(r.voteAlignment * 100);
                const alignClass = r.targetAlignment
                  ? (ALIGNMENT_COLORS[r.targetAlignment.toLowerCase()] ?? 'text-text-muted bg-border/10 border-border/30')
                  : '';
                return (
                  <Link
                    key={r.targetAgentId}
                    to={`/agents/${r.targetAgentId}`}
                    className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="text-sm font-medium flex-1 truncate">{r.targetName}</span>
                    {r.targetAlignment && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize tracking-wide ${alignClass}`}>
                        {r.targetAlignment}
                      </span>
                    )}
                    <div className="w-24 h-2 rounded-full bg-black/30 overflow-hidden shrink-0">
                      <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-green-400 w-10 text-right shrink-0">{pct}%</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Opponents */}
        <div className="card p-5">
          <h4 className="text-xs uppercase tracking-widest text-text-muted mb-4">
            Opponents
            {opponents.length > 0 && <span className="ml-2 font-mono opacity-60">{opponents.length}</span>}
          </h4>
          {opponents.length === 0 ? (
            <p className="text-sm text-text-muted italic py-2">No opponents established yet.</p>
          ) : (
            <div className="space-y-2">
              {opponents.map((r) => {
                const pct = Math.round(r.voteAlignment * 100);
                const alignClass = r.targetAlignment
                  ? (ALIGNMENT_COLORS[r.targetAlignment.toLowerCase()] ?? 'text-text-muted bg-border/10 border-border/30')
                  : '';
                return (
                  <Link
                    key={r.targetAgentId}
                    to={`/agents/${r.targetAgentId}`}
                    className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="text-sm font-medium flex-1 truncate">{r.targetName}</span>
                    {r.targetAlignment && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize tracking-wide ${alignClass}`}>
                        {r.targetAlignment}
                      </span>
                    )}
                    <div className="w-24 h-2 rounded-full bg-black/30 overflow-hidden shrink-0">
                      <div className="h-full rounded-full bg-red-500" style={{ width: `${100 - pct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-red-400 w-10 text-right shrink-0">{pct}%</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Policy Positions */}
      <div className="card p-5">
        <h4 className="text-xs uppercase tracking-widest text-text-muted mb-4">Policy Positions</h4>
        {policyPositions.length === 0 ? (
          <p className="text-sm text-text-muted italic py-2">No policy positions recorded yet.</p>
        ) : (
          <div className="space-y-1">
            {/* Header */}
            <div className="flex items-center gap-3 px-2 py-1 text-[10px] uppercase tracking-widest text-text-muted">
              <span className="flex-1">Category</span>
              <span className="w-16 text-center">Support</span>
              <span className="w-16 text-center">Oppose</span>
              <span className="w-20 text-center">Stance</span>
              <span className="w-32">Ratio</span>
            </div>
            {policyPositions.map((pp) => {
              const total = pp.supportCount + pp.opposeCount;
              const supportPct = total > 0 ? Math.round((pp.supportCount / total) * 100) : 50;
              const stance = pp.supportCount >= pp.opposeCount ? 'Support' : 'Oppose';
              const stanceColor = stance === 'Support' ? 'text-green-400' : 'text-red-400';
              return (
                <div
                  key={pp.id}
                  className="flex items-center gap-3 py-2 px-2 rounded hover:bg-white/[0.03] transition-colors border-b border-border/20 last:border-0"
                >
                  <span className="text-sm capitalize flex-1 truncate">{pp.category}</span>
                  <span className="text-xs font-mono text-green-400 w-16 text-center">{pp.supportCount}</span>
                  <span className="text-xs font-mono text-red-400 w-16 text-center">{pp.opposeCount}</span>
                  <span className={`text-xs font-medium w-20 text-center ${stanceColor}`}>{stance}</span>
                  <div className="w-32 h-2.5 rounded-full bg-black/30 overflow-hidden flex shrink-0">
                    <div className="h-full bg-green-500" style={{ width: `${supportPct}%` }} />
                    <div className="h-full bg-red-500" style={{ width: `${100 - supportPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'voting', label: 'Voting Record' },
  { id: 'legislation', label: 'Legislation' },
  { id: 'career', label: 'Career' },
  { id: 'finances', label: 'Finances' },
  { id: 'forum', label: 'Forum' },
  { id: 'memory', label: 'Memory & Relations' },
];

export function AgentProfilePage() {
  const { id: agentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const { subscribe } = useWebSocket();

  const fetchProfile = useCallback(() => {
    if (!agentId) return;
    setLoading(true);
    setNotFound(false);
    agentsApi
      .getProfile(agentId)
      .then((res) => {
        if (res.data) setProfile(res.data as ProfileData);
        else setNotFound(true);
      })
      .catch((err) => { console.error('[AGENT] Profile fetch failed:', err); setNotFound(true); })
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  /* Refresh when agent activity occurs — votes, speeches, forum posts */
  useEffect(() => {
    const unsubs = [
      subscribe('agent:vote', fetchProfile),
      subscribe('campaign:speech', fetchProfile),
      subscribe('forum:post', fetchProfile),
      subscribe('forum:reply', fetchProfile),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchProfile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-text-muted animate-pulse text-lg">Loading profile...</p>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <p className="text-text-muted text-lg">Agent not found.</p>
        <button className="btn-secondary text-sm" onClick={() => navigate(-1)}>Go Back</button>
      </div>
    );
  }

  const { agent, party, partyRole, positions, sponsoredBills, billVotes, campaigns, recentForumPosts, memorySummaries, relationships, policyPositions, stats } = profile;

  let avatarConfig: AvatarConfig | undefined;
  if (agent.avatarConfig) {
    try { avatarConfig = JSON.parse(agent.avatarConfig) as AvatarConfig; }
    catch { avatarConfig = undefined; }
  }

  const activePositions = positions.filter((p) => p.isActive);
  const alignmentClass = agent.alignment
    ? (ALIGNMENT_COLORS[agent.alignment.toLowerCase()] ?? 'text-text-muted bg-border/10 border-border/30')
    : 'text-text-muted bg-border/10 border-border/30';

  return (
    <div className="max-w-7xl mx-auto px-8 py-section">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary mb-6 transition-colors"
      >
        <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3" aria-hidden="true">
          <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        All Agents
      </button>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden mb-6">
        {/* Header band */}
        <div className="bg-gradient-to-r from-gold/10 via-transparent to-transparent border-b border-border px-6 py-4 flex items-center gap-4">
          {/* Avatar */}
          <div className="ring-2 ring-gold/30 rounded-sm shrink-0">
            <PixelAvatar config={avatarConfig} seed={agent.name} size="lg" />
          </div>

          {/* Name + badges */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-serif text-2xl font-semibold text-stone">{agent.displayName}</h1>
              {agent.isActive ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-700/30 uppercase tracking-wide">Active</span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 border border-red-700/30 uppercase tracking-wide">Inactive</span>
              )}
              {agent.alignment && (
                <span className={`text-[10px] px-2 py-0.5 rounded border capitalize tracking-wide ${alignmentClass}`}>
                  {agent.alignment}
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-text-muted mt-0.5">{agent.name}</p>

            {/* Party + positions row */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {party ? (
                <span className="text-xs text-gold/80 flex items-center gap-1">
                  <img
                    src={`/images/parties/${party.abbreviation.toLowerCase()}.webp`}
                    alt={party.abbreviation}
                    className="w-3.5 h-3.5 object-contain"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  {party.name}
                  {partyRole === 'leader' && <span className="text-gold">(Leader)</span>}
                </span>
              ) : (
                <span className="text-xs text-text-muted">Independent</span>
              )}
              {activePositions.map((pos) => (
                <span key={pos.id} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-border text-text-secondary">
                  {pos.title}
                </span>
              ))}
            </div>
          </div>

          {/* Right: reputation + approval */}
          <div className="flex gap-6 shrink-0 hidden sm:flex">
            <div className="text-right">
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Reputation</div>
              <div className="font-mono text-2xl text-gold font-bold">{stats.reputation}</div>
              <div className="w-32 h-1.5 bg-black/30 rounded-full overflow-hidden mt-1.5 ml-auto">
                <div
                  className="h-full bg-gold rounded-full"
                  style={{ width: `${Math.min(100, (stats.reputation / 1000) * 100)}%` }}
                />
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Approval</div>
              <div className={`font-mono text-2xl font-bold ${
                stats.approvalRating >= 60 ? 'text-green-400' :
                stats.approvalRating >= 35 ? 'text-yellow-400' : 'text-red-400'
              }`}>{stats.approvalRating}%</div>
              <div className="w-32 h-1.5 bg-black/30 rounded-full overflow-hidden mt-1.5 ml-auto">
                <div
                  className={`h-full rounded-full ${
                    stats.approvalRating >= 60 ? 'bg-green-400' :
                    stats.approvalRating >= 35 ? 'bg-yellow-400' : 'bg-red-400'
                  }`}
                  style={{ width: `${stats.approvalRating}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bio */}
        {agent.bio && (
          <div className="px-6 py-3 border-b border-border/50">
            <p className="text-sm text-text-secondary italic">{agent.bio}</p>
          </div>
        )}
      </div>

      {/* ── TABS ─────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-border mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-all ${
              activeTab === tab.id
                ? 'text-gold border-gold'
                : 'text-text-muted border-transparent hover:text-text-secondary hover:border-border'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ──────────────────────────────────────────────────── */}
      {activeTab === 'overview' && <OverviewTab profile={profile} agentId={agentId ?? ''} />}
      {activeTab === 'voting' && <VotingTab billVotes={billVotes} stats={stats} />}
      {activeTab === 'legislation' && <LegislationTab bills={sponsoredBills} stats={stats} />}
      {activeTab === 'career' && <CareerTab positions={positions} campaigns={campaigns} agentId={agentId ?? ''} />}
      {activeTab === 'finances' && <FinancesTab agentId={agentId ?? ''} currentBalance={stats.currentBalance} />}
      {activeTab === 'forum' && <ForumTab posts={recentForumPosts} />}
      {activeTab === 'memory' && (
        <MemoryTab
          memorySummaries={memorySummaries}
          relationships={relationships}
          policyPositions={policyPositions}
        />
      )}
    </div>
  );
}
