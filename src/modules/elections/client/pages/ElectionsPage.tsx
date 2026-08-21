import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { SectionHeader } from '@core/client/components/SectionHeader';
import { SidebarCard } from '@core/client/components/SidebarCard';
import { EmptyState } from '@core/client/components/EmptyState';
import { ActivityFeed } from '@modules/agents/client/components/ActivityFeed';
import { PixelAvatar } from '@modules/agents/client/components/PixelAvatar';
import type { AvatarConfig } from '@modules/agents/client/components/PixelAvatar';
import { ChoroplethMap } from '@modules/world/client/components/ChoroplethMap';
import { FIPS_TO_STATE } from '@modules/world/client/lib/usStatePaths';
import { formatMoney } from '@core/client/lib/formatMoney';
import { CampaignCard } from '../components/CampaignCard';
import { ElectionBanner } from '../components/ElectionBanner';
import { BranchCard } from '../components/BranchCard';
import {
  deriveBannerTargetDate,
  deriveBannerTitle,
  deriveBannerDescription,
  type ActiveElection,
} from '../hooks/activeElectionBanner';
import { EV_BY_STATE, EC_MAJORITY_CLIENT, EC_TOTAL_EV, EC_STATE_COUNT } from '../lib/electoralVotesClient';
import { campaignsApi, electionsApi, activityApi } from '@core/client/lib/api';

/* ── Types (mirror the elections/campaigns/activity APIs) ─────────────────── */

interface EnrichedCampaign {
  id: string;
  agentId: string;
  electionId: string;
  platform: string;
  endorsements: string;
  contributions: number;
  status: string;
  agent: { id: string; displayName: string; avatarUrl: string | null } | null;
  party: { name: string } | null;
}

interface DetailCandidate {
  agentId: string;
  campaignId: string;
  displayName: string;
  avatarConfig: string | null;
  alignment: string | null;
  platform: string;
  contributions: number;
  spent: number;
  voteCount: number;
  votePercentage: number;
  party: { name: string; abbreviation: string } | null;
  isWinner: boolean;
}

/* Campaign-realism poll snapshot (results keyed by campaignId). */
interface PollSnapshotRow {
  tick: number;
  results: Record<string, number>;
  undecidedPct: number;
  sampleSize: number;
}

interface ElectoralCollegeBlock {
  enabled: boolean;
  stateResults: Record<string, string>;
  evByCandidate: Record<string, number>;
  totalEvAllocated: number;
  threshold: number;
  winnerId: string | null;
  reachedMajority: boolean;
}

interface ElectionDetail {
  id: string;
  title: string;
  type: string;
  status: string;
  certifiedDate: string | null;
  totalVotes: number;
  winnerId: string | null;
  candidates: DetailCandidate[];
  rollCall: { voterId: string; candidateId: string | null }[];
  pollHistory?: PollSnapshotRow[];
  latestPoll?: PollSnapshotRow;
  electoralCollege?: ElectoralCollegeBlock;
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

interface ActivityRow {
  id: string;
  type: string;
  agentId: string | null;
  agentName: string | null;
  description: string;
  createdAt: string;
}

/* GET /elections/:id/electoral — provisional EC snapshot during voting. */
interface ElectoralSnapshotResponse {
  enabled: boolean;
  status?: string;
  provisional?: boolean;
  stateResults?: Record<string, string>;
  evByCandidate?: Record<string, number>;
  totalEvAllocated?: number;
  threshold?: number;
  winnerId?: string | null;
  reachedMajority?: boolean;
  ballotsCounted?: number;
  statesCalled?: number;
}

type BroadcastPhase = 'campaign' | 'night' | 'inauguration' | 'none';

/* ── Constants ────────────────────────────────────────────────────────────── */

/* Campaign Trail = scheduled/registration/campaigning (everything not live).
   'counting' has no writer (vestigial) but is treated as live if it ever appears. */
const LIVE_STATUSES = new Set(['voting', 'counting']);

const NIGHT_POLL_MS = 15_000;
const NEUTRAL_STATE_FILL = '#2f3136';

/* First three match CAMPAIGN_ACCENT_COLORS so leaderboard and map stay kin. */
const CANDIDATE_COLORS = ['#B8956A', '#6B7A8D', '#8B3A3A', '#4E7A5E', '#7A5E8C'];
const CAMPAIGN_ACCENT_COLORS = ['#B8956A', '#6B7A8D', '#8B3A3A'];

const ALIGNMENT_BADGE: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  registration: 'Registration Open',
  campaigning: 'Campaigning',
  voting: 'Voting Open',
  counting: 'Counting',
  certified: 'Certified',
};

const PHASE_STEPS: { key: Exclude<BroadcastPhase, 'none'>; label: string }[] = [
  { key: 'campaign', label: 'Campaign Trail' },
  { key: 'night', label: 'Election Night' },
  { key: 'inauguration', label: 'Inauguration' },
];

const PHASE_BADGE: Record<BroadcastPhase, string | undefined> = {
  campaign: 'Campaign Trail',
  night: 'Election Night',
  inauguration: 'Inauguration',
  none: undefined,
};

/* Campaign-scoped activity: real election/campaign event types only. */
const CAMPAIGN_ACTIVITY_PREFIXES = ['election_', 'campaign_', 'candidacy_'];

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function relativeTime(date: string | Date): string {
  const diffSec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function parseEndorsementCount(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/** Stable candidate → color map (sorted by agentId so colors never flip mid-broadcast). */
function buildCandidateColors(candidates: DetailCandidate[]): Record<string, string> {
  const map: Record<string, string> = {};
  [...candidates]
    .sort((a, b) => a.agentId.localeCompare(b.agentId))
    .forEach((c, i) => {
      map[c.agentId] = CANDIDATE_COLORS[i % CANDIDATE_COLORS.length]!;
    });
  return map;
}

function parseAvatar(raw: string | null): AvatarConfig | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AvatarConfig;
  } catch {
    return undefined;
  }
}

/* ── Phase rail ───────────────────────────────────────────────────────────── */

function PhaseRail({ phase }: { phase: Exclude<BroadcastPhase, 'none'> }) {
  return (
    <ol className="flex items-center gap-2 mb-6" aria-label="Broadcast phase">
      {PHASE_STEPS.map((step, i) => {
        const active = step.key === phase;
        return (
          <li key={step.key} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="w-6 h-px bg-border" />}
            <span
              aria-current={active ? 'step' : undefined}
              className={`px-3 py-1.5 rounded-full border text-xs tracking-wide ${
                active
                  ? 'border-gold/40 bg-gold/10 text-gold font-semibold'
                  : 'border-border text-text-muted'
              }`}
            >
              {active && step.key === 'night' && (
                <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-gold animate-pulse mr-1.5 align-middle" />
              )}
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Election map card (trail: neutral; live/final: colored by state winner) ─ */

interface ElectionMapCardProps {
  mode: 'trail' | 'live' | 'final';
  /** stateAbbr -> winning agentId. Null renders the honest neutral map. */
  stateWinners: Record<string, string> | null;
  colorByAgent: Record<string, string>;
  nameByAgent: Record<string, string>;
}

function ElectionMapCard({ mode, stateWinners, colorByAgent, nameByAgent }: ElectionMapCardProps) {
  const [selectedFips, setSelectedFips] = useState<string | null>(null);

  const winnerForFips = (fips: string): string | null => {
    const abbr = FIPS_TO_STATE[fips]?.abbr;
    if (!abbr || !stateWinners) return null;
    return stateWinners[abbr] ?? null;
  };

  const verb = mode === 'final' ? 'called for' : 'leaning';
  const selMeta = selectedFips ? FIPS_TO_STATE[selectedFips] : null;
  const selWinner = selectedFips ? winnerForFips(selectedFips) : null;
  const selEv = selMeta ? EV_BY_STATE[selMeta.abbr] ?? 0 : 0;

  const calledAgents = stateWinners ? [...new Set(Object.values(stateWinners))] : [];

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <ChoroplethMap
        ariaLabel={
          mode === 'trail'
            ? 'US map — no pre-vote state leanings exist'
            : `US map of per-state ${mode === 'final' ? 'results' : 'leaders'}`
        }
        colorForState={(fips) => {
          const winner = winnerForFips(fips);
          return winner ? colorByAgent[winner] ?? NEUTRAL_STATE_FILL : NEUTRAL_STATE_FILL;
        }}
        labelForState={(fips) => {
          const meta = FIPS_TO_STATE[fips];
          if (!meta || !winnerForFips(fips)) return null;
          return `${meta.abbr} ${EV_BY_STATE[meta.abbr] ?? 0}`;
        }}
        ariaForState={(fips) => {
          const meta = FIPS_TO_STATE[fips];
          if (!meta) return fips;
          const winner = winnerForFips(fips);
          const ev = EV_BY_STATE[meta.abbr] ?? 0;
          return winner
            ? `${meta.name}: ${verb} ${nameByAgent[winner] ?? winner}, ${ev} electoral vote${ev === 1 ? '' : 's'}`
            : `${meta.name}: ${mode === 'trail' ? `${ev} electoral votes` : 'no returns yet'}`;
        }}
        selectedFips={selectedFips}
        onSelect={(fips) => setSelectedFips((prev) => (prev === fips ? null : fips))}
      />

      {/* Selected-state readout */}
      {selMeta && (
        <p className="text-xs text-text-secondary">
          <span className="font-medium text-stone">{selMeta.name}</span>
          <span className="text-text-muted"> · {selEv} electoral vote{selEv === 1 ? '' : 's'}</span>
          {selWinner && (
            <>
              {' · '}
              <span style={{ color: colorByAgent[selWinner] }}>{verb} {nameByAgent[selWinner] ?? selWinner}</span>
            </>
          )}
        </p>
      )}

      {/* Legend / honest caption */}
      {stateWinners && calledAgents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
          {calledAgents.map((agentId) => (
            <span key={agentId} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: colorByAgent[agentId] ?? NEUTRAL_STATE_FILL }}
              />
              {nameByAgent[agentId] ?? agentId}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: NEUTRAL_STATE_FILL }} />
            {mode === 'final' ? 'No ballots cast' : 'No returns yet'}
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-text-muted">
          {mode === 'trail'
            ? 'States carry no pre-vote lean — the map colors in with real returns on election night.'
            : 'Awaiting the first state returns.'}
        </p>
      )}
    </div>
  );
}

/* ── Electoral vote bars (270 line) ───────────────────────────────────────── */

interface EvBarsProps {
  evByCandidate: Record<string, number>;
  totalEvAllocated: number;
  colorByAgent: Record<string, string>;
  nameByAgent: Record<string, string>;
  provisional: boolean;
}

function EvBars({ evByCandidate, totalEvAllocated, colorByAgent, nameByAgent, provisional }: EvBarsProps) {
  const ranked = Object.entries(evByCandidate).sort((a, b) => b[1] - a[1]);
  const thresholdPct = (EC_MAJORITY_CLIENT / EC_TOTAL_EV) * 100;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-serif text-base font-semibold text-stone">Electoral College</h3>
        <span className="text-badge text-text-muted">
          {EC_MAJORITY_CLIENT} to win · {totalEvAllocated}/{EC_TOTAL_EV} EV {provisional ? 'allocated so far' : 'allocated'}
        </span>
      </div>
      <div className="space-y-2.5">
        {ranked.map(([agentId, ev]) => (
          <div key={agentId}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-text-secondary">{nameByAgent[agentId] ?? agentId}</span>
              <span className="font-mono text-gold">{ev} EV</span>
            </div>
            <div className="relative h-3 rounded-full bg-capitol-deep overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (ev / EC_TOTAL_EV) * 100)}%`, backgroundColor: colorByAgent[agentId] ?? NEUTRAL_STATE_FILL }}
              />
              <div
                aria-hidden="true"
                className="absolute top-0 bottom-0 w-px bg-gold/70"
                style={{ left: `${thresholdPct}%` }}
              />
            </div>
          </div>
        ))}
        {ranked.length === 0 && (
          <p className="text-xs text-text-muted">No electoral votes allocated yet.</p>
        )}
      </div>
      <p className="text-[11px] text-text-muted">
        Winner-take-all by state · gold line marks {EC_MAJORITY_CLIENT}
        {provisional ? ' · provisional, states can flip until certification' : ''}
      </p>
    </div>
  );
}

/* ── National popular tally ───────────────────────────────────────────────── */

function NationalTally({
  candidates,
  certified,
  colorByAgent,
}: {
  candidates: DetailCandidate[];
  certified: boolean;
  colorByAgent: Record<string, string>;
}) {
  const counted = candidates.reduce((sum, c) => sum + c.voteCount, 0);
  const shareOf = (c: DetailCandidate): number =>
    certified ? c.votePercentage : counted > 0 ? Math.round((c.voteCount / counted) * 100) : 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <h3 className="font-serif text-base font-semibold text-stone">National Popular Vote</h3>
      <div className="space-y-2.5">
        {candidates.map((c) => (
          <div key={c.agentId}>
            <div className="flex justify-between text-xs mb-1">
              <Link to={`/agents/${c.agentId}`} className="text-text-secondary hover:text-gold transition-colors truncate">
                {c.displayName}
                {c.party ? <span className="text-text-muted"> ({c.party.abbreviation})</span> : null}
              </Link>
              <span className="font-mono text-text-primary shrink-0">
                {c.voteCount} · {shareOf(c)}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-capitol-deep overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${shareOf(c)}%`, backgroundColor: colorByAgent[c.agentId] ?? NEUTRAL_STATE_FILL }}
              />
            </div>
          </div>
        ))}
        {candidates.length === 0 && <p className="text-xs text-text-muted">No candidates on the ballot.</p>}
      </div>
      {!certified && (
        <p className="text-[11px] text-text-muted">
          The popular vote does not decide a presidential race — the Electoral College does. Divergence is faithful, not a bug.
        </p>
      )}
    </div>
  );
}

/* ── Candidate dossier drawer (real data only — no sparklines, no itinerary) ─ */

/* ── Poll trend sparkline (campaign realism — renders only with 2+ snapshots) ── */

function PollSparkline({
  history,
  candidates,
  colorByAgent,
}: {
  history: PollSnapshotRow[];
  candidates: DetailCandidate[];
  colorByAgent: Record<string, string>;
}) {
  if (history.length < 2 || candidates.length === 0) return null;
  const W = 280;
  const H = 72;
  const PAD = 4;
  const xs = (i: number) => PAD + (i * (W - 2 * PAD)) / (history.length - 1);
  const ys = (v: number) => H - PAD - (Math.min(100, Math.max(0, v)) * (H - 2 * PAD)) / 100;
  return (
    <div className="rounded-lg border border-border bg-surface p-4 mt-4">
      <h4 className="text-badge text-text-muted mb-2">Poll Trend</h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Poll share trend by candidate">
        {candidates.map((c) => (
          <polyline
            key={c.campaignId}
            points={history.map((row, i) => `${xs(i)},${ys(row.results[c.campaignId] ?? 0)}`).join(' ')}
            fill="none"
            stroke={colorByAgent[c.agentId] ?? '#888888'}
            strokeWidth={1.5}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {candidates.map((c) => (
          <span key={c.campaignId} className="flex items-center gap-1 text-badge text-text-muted">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: colorByAgent[c.agentId] ?? '#888888' }} />
            {c.displayName}
          </span>
        ))}
      </div>
    </div>
  );
}

function DossierDrawer({
  candidate,
  campaign,
  contributionShare,
  pollShare,
  showVotes,
  onClose,
}: {
  candidate: DetailCandidate;
  campaign: EnrichedCampaign | null;
  contributionShare: number;
  pollShare: number | null;
  showVotes: boolean;
  onClose: () => void;
}) {
  const alignClass = candidate.alignment
    ? ALIGNMENT_BADGE[candidate.alignment.toLowerCase()] ?? 'text-text-muted bg-border/10 border-border/30'
    : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label={`Candidate dossier: ${candidate.displayName}`}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-surface p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <PixelAvatar config={parseAvatar(candidate.avatarConfig)} seed={candidate.displayName} size="md" />
            <div className="min-w-0">
              <Link
                to={`/agents/${candidate.agentId}`}
                className="font-serif text-lg font-semibold text-stone hover:text-gold transition-colors"
              >
                {candidate.displayName}
              </Link>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {candidate.party && (
                  <span className="badge border border-border/40 text-text-muted bg-border/10">{candidate.party.name}</span>
                )}
                {alignClass && candidate.alignment && (
                  <span className={`badge border ${alignClass} capitalize`}>{candidate.alignment}</span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dossier"
            className="text-text-muted hover:text-text-secondary text-lg leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold shrink-0"
          >
            ✕
          </button>
        </div>

        <div>
          <h4 className="text-badge text-text-muted mb-1.5">Platform</h4>
          <p className="text-sm text-text-secondary italic leading-relaxed p-3 bg-black/15 rounded border-l-2 border-border">
            "{candidate.platform}"
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded border border-border/50 bg-capitol-deep/30 p-3">
            <div className="font-mono text-lg text-gold">{formatMoney(candidate.contributions)}</div>
            <div className="text-stat-label text-text-muted uppercase">Raised</div>
          </div>
          <div className="rounded border border-border/50 bg-capitol-deep/30 p-3">
            <div className="font-mono text-lg text-gold">{contributionShare}%</div>
            <div className="text-stat-label text-text-muted uppercase">Contribution share</div>
          </div>
          {candidate.spent > 0 && (
            <div className="rounded border border-border/50 bg-capitol-deep/30 p-3">
              <div className="font-mono text-lg text-gold">{formatMoney(candidate.spent)}</div>
              <div className="text-stat-label text-text-muted uppercase">Spent</div>
            </div>
          )}
          {pollShare !== null && (
            <div className="rounded border border-border/50 bg-capitol-deep/30 p-3">
              <div className="font-mono text-lg text-gold">{pollShare}%</div>
              <div className="text-stat-label text-text-muted uppercase">Poll standing</div>
            </div>
          )}
          {campaign && (
            <div className="rounded border border-border/50 bg-capitol-deep/30 p-3">
              <div className="font-mono text-lg text-gold">{parseEndorsementCount(campaign.endorsements)}</div>
              <div className="text-stat-label text-text-muted uppercase">Endorsements</div>
            </div>
          )}
          {showVotes && (
            <div className="rounded border border-border/50 bg-capitol-deep/30 p-3">
              <div className="font-mono text-lg text-gold">{candidate.voteCount}</div>
              <div className="text-stat-label text-text-muted uppercase">Ballots won</div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/* ── Other concurrent races ───────────────────────────────────────────────── */

function OtherRaces({ races }: { races: ActiveElection[] }) {
  if (races.length === 0) return null;
  return (
    <div className="mt-8">
      <h3 className="font-serif text-lg text-stone mb-3">Also Underway</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {races.map((race) => (
          <Link
            key={race.id}
            to={`/elections/${race.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface hover:border-gold/30 transition-colors px-4 py-3"
          >
            <span className="font-serif text-sm font-semibold text-stone truncate">{race.title}</span>
            <span className="badge border border-border/40 text-text-muted bg-border/10 shrink-0">
              {STATUS_LABEL[race.status] ?? race.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ── Past elections archive (unchanged rendering from the previous page) ──── */

function PastElectionsList({ pastElections }: { pastElections: PastElection[] }) {
  return (
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
              ? fmtDate(election.certifiedDate)
              : election.scheduledDate
                ? fmtDate(election.scheduledDate)
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
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function ElectionsPage() {
  const [actives, setActives] = useState<ActiveElection[]>([]);
  const [pastElections, setPastElections] = useState<PastElection[]>([]);
  const [campaigns, setCampaigns] = useState<EnrichedCampaign[]>([]);
  const [detail, setDetail] = useState<ElectionDetail | null>(null);
  const [electoral, setElectoral] = useState<ElectoralSnapshotResponse | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [dossierAgentId, setDossierAgentId] = useState<string | null>(null);
  const { subscribe } = useWebSocket();

  /* ── Fetching ── */

  const fetchLists = useCallback(async () => {
    try {
      const [activeRes, pastRes, campaignsRes, activityRes] = await Promise.allSettled([
        electionsApi.active(),
        electionsApi.past(),
        campaignsApi.active(),
        activityApi.recent({ limit: 60 }),
      ]);
      if (activeRes.status === 'fulfilled' && Array.isArray(activeRes.value.data)) {
        setActives(activeRes.value.data as ActiveElection[]);
      }
      if (pastRes.status === 'fulfilled' && Array.isArray(pastRes.value.data)) {
        setPastElections(pastRes.value.data as PastElection[]);
      }
      if (campaignsRes.status === 'fulfilled' && Array.isArray(campaignsRes.value.data)) {
        setCampaigns(campaignsRes.value.data as EnrichedCampaign[]);
      }
      if (activityRes.status === 'fulfilled' && activityRes.value.data) {
        const events = (activityRes.value.data as { events?: ActivityRow[] }).events ?? [];
        setActivity(events.filter((e) => CAMPAIGN_ACTIVITY_PREFIXES.some((p) => e.type.startsWith(p))));
      }
    } catch {
      /* transient — leave current state */
    }
  }, []);

  /* ── Phase derivation (driven by real election status, never a toggle) ── */

  const focus = useMemo(() => {
    return (
      actives.find((e) => e.type === 'president') ??
      actives.find((e) => e.type === 'congress_general') ??
      actives[0] ??
      null
    );
  }, [actives]);

  const latestCertified = useMemo(() => {
    if (pastElections.length === 0) return null;
    return [...pastElections].sort(
      (a, b) => new Date(b.certifiedDate ?? b.scheduledDate).getTime() - new Date(a.certifiedDate ?? a.scheduledDate).getTime(),
    )[0]!;
  }, [pastElections]);

  const phase: BroadcastPhase = focus
    ? LIVE_STATUSES.has(focus.status)
      ? 'night'
      : 'campaign'
    : latestCertified
      ? 'inauguration'
      : 'none';

  const detailTargetId = phase === 'inauguration' ? latestCertified?.id ?? null : focus?.id ?? null;

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await electionsApi.getById(id);
      if (res.data) setDetail(res.data as ElectionDetail);
    } catch {
      /* transient — leave current state */
    }
  }, []);

  useEffect(() => {
    void fetchLists();
    const refetch = () => { void fetchLists(); };
    const unsubs = [
      subscribe('election:voting_started', refetch),
      subscribe('election:completed', refetch),
      subscribe('campaign:speech', refetch),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [fetchLists, subscribe]);

  useEffect(() => {
    if (!detailTargetId) {
      setDetail(null);
      return;
    }
    void fetchDetail(detailTargetId);
  }, [detailTargetId, fetchDetail]);

  const fetchElectoral = useCallback(async (id: string) => {
    try {
      const res = await electionsApi.electoral(id);
      if (res.data) setElectoral(res.data as ElectoralSnapshotResponse);
    } catch {
      /* transient — leave current state */
    }
  }, []);

  /* Election Night liveness: poll the detail + provisional EC snapshot
     (design brief 05's polling model) and refetch on ballot broadcasts
     scoped to the focused race. */
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== 'night' || !detailTargetId) {
      setElectoral(null);
      return;
    }
    const refetchLive = () => {
      void fetchDetail(detailTargetId);
      void fetchElectoral(detailTargetId);
    };
    void fetchElectoral(detailTargetId);
    pollRef.current = setInterval(refetchLive, NIGHT_POLL_MS);
    const unsub = subscribe('election:ballot_cast', (data) => {
      const electionId = (data as { electionId?: string } | null)?.electionId;
      if (!electionId || electionId === detailTargetId) refetchLive();
    });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      unsub();
    };
  }, [phase, detailTargetId, fetchDetail, fetchElectoral, subscribe]);

  /* Poll snapshots land once per tick — refetch the focused race's detail
     (campaign trail and election night alike). */
  useEffect(() => {
    if (!detailTargetId) return;
    const unsub = subscribe('election:poll', (data) => {
      const electionId = (data as { electionId?: string } | null)?.electionId;
      if (!electionId || electionId === detailTargetId) void fetchDetail(detailTargetId);
    });
    return () => unsub();
  }, [detailTargetId, fetchDetail, subscribe]);

  /* ── Derived view data ── */

  const activeDetail = detail && detail.id === detailTargetId ? detail : null;
  const candidates = activeDetail ? activeDetail.candidates : [];
  const colorByAgent = useMemo(() => buildCandidateColors(candidates), [candidates]);
  const nameByAgent = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of candidates) map[c.agentId] = c.displayName;
    return map;
  }, [candidates]);

  const focusCampaigns = useMemo(
    () => (focus ? campaigns.filter((c) => c.electionId === focus.id) : []),
    [campaigns, focus],
  );
  const totalContributions = candidates.reduce((sum, c) => sum + c.contributions, 0);
  const contributionShareOf = (c: DetailCandidate): number =>
    totalContributions > 0 ? Math.round((c.contributions / totalContributions) * 100) : 0;

  /* Real poll data (pollsEnabled snapshots) — when present it replaces the
     contribution-share proxy everywhere a share renders. */
  const latestPoll = activeDetail?.latestPoll ?? null;
  const pollHistory = activeDetail?.pollHistory ?? [];
  const pollShareOf = (c: DetailCandidate): number | null =>
    latestPoll ? latestPoll.results[c.campaignId] ?? 0 : null;
  const displayShareOf = (c: DetailCandidate): number => pollShareOf(c) ?? contributionShareOf(c);
  const pollLeader = latestPoll
    ? [...candidates].sort((a, b) => (pollShareOf(b) ?? 0) - (pollShareOf(a) ?? 0))[0] ?? null
    : null;

  const campaignByAgent = useMemo(() => {
    const map: Record<string, EnrichedCampaign> = {};
    for (const c of focusCampaigns) map[c.agentId] = c;
    return map;
  }, [focusCampaigns]);

  const otherRaces = useMemo(
    () => actives.filter((e) => e.id !== focus?.id),
    [actives, focus],
  );

  const bannerElection = phase === 'campaign' || phase === 'night' ? focus : null;
  const dossierCandidate = dossierAgentId ? candidates.find((c) => c.agentId === dossierAgentId) ?? null : null;

  const activityItems = activity.map((e) => ({
    id: e.id,
    type: (e.type.startsWith('campaign_') || e.type.startsWith('candidacy_') ? 'campaign' : 'vote') as 'campaign' | 'vote',
    highlight: e.agentName ?? 'System',
    text: e.description,
    time: relativeTime(e.createdAt),
  }));

  /* ── Phase sections ── */

  const winner = activeDetail ? candidates.find((c) => c.isWinner) ?? null : null;
  const ec = activeDetail?.electoralCollege ?? null;
  const ballotsCast = activeDetail ? activeDetail.rollCall.length : 0;
  const countedForCandidates = candidates.reduce((sum, c) => sum + c.voteCount, 0);
  const abstentions = Math.max(0, ballotsCast - countedForCandidates);

  return (
    <div className="max-w-content mx-auto px-8 py-section">
      <SectionHeader title="Elections" badge={PHASE_BADGE[phase]} />

      {phase !== 'none' && <PhaseRail phase={phase} />}

      {/* ═══ No race, no record ═══ */}
      {phase === 'none' && (
        <>
          <ElectionBanner title="Election" description="0 candidates declared." targetDate={null} />
          <div className="rounded-lg border border-border bg-surface p-6 mt-6">
            <EmptyState
              title="No election underway."
              hint="The broadcast goes live when the next race is called — campaign trail, election night, inauguration."
            />
          </div>
        </>
      )}

      {/* ═══ Campaign Trail ═══ */}
      {phase === 'campaign' && focus && (
        <>
          <ElectionBanner
            title={deriveBannerTitle(bannerElection)}
            description={deriveBannerDescription(bannerElection, candidates.length)}
            targetDate={deriveBannerTargetDate(bannerElection)}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start gap-6">
            <div className="space-y-6 min-w-0">
              {/* Per-state geography only ever exists for presidential races —
                  a congress_general is a national at-large vote, so no map. */}
              {focus.type === 'president' && (
                <ElectionMapCard mode="trail" stateWinners={null} colorByAgent={colorByAgent} nameByAgent={nameByAgent} />
              )}

              <div>
                <h3 className="font-serif text-lg text-stone mb-4">Fundraising Leaderboard</h3>
                {candidates.length === 0 ? (
                  <div className="card p-6 text-center text-text-muted text-sm">
                    No declared candidates yet — registration is open.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {[...candidates]
                      .sort((a, b) => latestPoll
                        ? (pollShareOf(b) ?? 0) - (pollShareOf(a) ?? 0)
                        : b.contributions - a.contributions)
                      .map((c, idx) => (
                        <CampaignCard
                          key={c.agentId}
                          name={c.displayName}
                          party={c.party?.name ?? 'Independent'}
                          initials={c.displayName.slice(0, 2).toUpperCase()}
                          agentId={c.agentId}
                          platform={c.platform}
                          endorsements={campaignByAgent[c.agentId] ? parseEndorsementCount(campaignByAgent[c.agentId]!.endorsements) : 0}
                          contributions={c.contributions}
                          pollPercentage={displayShareOf(c)}
                          pollIsReal={latestPoll !== null}
                          accentColor={CAMPAIGN_ACCENT_COLORS[idx % CAMPAIGN_ACCENT_COLORS.length]!}
                          index={idx}
                        />
                      ))}
                  </div>
                )}
                {candidates.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    <span className="text-badge text-text-muted">Dossiers:</span>
                    {candidates.map((c) => (
                      <button
                        key={c.agentId}
                        type="button"
                        onClick={() => setDossierAgentId(c.agentId)}
                        className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-text-secondary hover:border-gold/40 hover:text-gold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
                      >
                        <PixelAvatar config={parseAvatar(c.avatarConfig)} seed={c.displayName} size="xs" />
                        {c.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0">
              <SidebarCard
                title="Race Summary"
                items={[
                  { label: 'Office', value: focus.title.replace(/ Election$/, '') },
                  { label: 'Phase', value: STATUS_LABEL[focus.status] ?? focus.status },
                  { label: 'Candidates', value: candidates.length },
                  { label: 'Parties', value: new Set(candidates.filter((c) => c.party).map((c) => c.party!.name)).size },
                  { label: 'Total raised', value: formatMoney(totalContributions) },
                  ...(latestPoll && pollLeader
                    ? [
                        { label: 'Leading (poll)', value: `${pollLeader.displayName} — ${pollShareOf(pollLeader) ?? 0}%` },
                        { label: 'Undecided', value: `${latestPoll.undecidedPct}%` },
                      ]
                    : []),
                ]}
              />
              <PollSparkline history={pollHistory} candidates={candidates} colorByAgent={colorByAgent} />
              <div className="relative min-h-[440px]">
                <ActivityFeed items={activityItems} fill />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ Election Night ═══ */}
      {phase === 'night' && focus && (
        <>
          <ElectionBanner
            title={`${deriveBannerTitle(bannerElection)} — polls are open`}
            description={`${ballotsCast} ballot${ballotsCast === 1 ? '' : 's'} cast so far. Voting closes when the window ends.`}
            targetDate={deriveBannerTargetDate(bannerElection)}
          />

          {/* The EC map/bars render only where per-state data can ever exist:
              a presidential race whose snapshot is not switched off (§3.2 —
              { enabled: false } means national tally only). While the first
              snapshot is in flight (electoral null) the neutral map shows. */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start gap-6">
            <div className="space-y-6 min-w-0">
              {focus.type === 'president' && electoral?.enabled !== false ? (
                <>
                  <ElectionMapCard
                    mode="live"
                    stateWinners={electoral?.enabled ? electoral.stateResults ?? null : null}
                    colorByAgent={colorByAgent}
                    nameByAgent={nameByAgent}
                  />
                  {electoral?.enabled && (
                    <EvBars
                      evByCandidate={electoral.evByCandidate ?? {}}
                      totalEvAllocated={electoral.totalEvAllocated ?? 0}
                      colorByAgent={colorByAgent}
                      nameByAgent={nameByAgent}
                      provisional
                    />
                  )}
                </>
              ) : (
                <NationalTally candidates={candidates} certified={false} colorByAgent={colorByAgent} />
              )}
            </div>

            <div className="space-y-4 min-w-0">
              {focus.type === 'president' && electoral?.enabled !== false && (
                <NationalTally candidates={candidates} certified={false} colorByAgent={colorByAgent} />
              )}
              <div className="rounded-lg border border-border bg-surface p-5">
                <p className="text-xs text-text-muted uppercase tracking-widest">Ballots cast</p>
                <p className="font-serif text-4xl font-semibold text-stone mt-1">{ballotsCast}</p>
                <p className="text-xs text-text-muted mt-1">
                  {countedForCandidates} for candidates{abstentions > 0 ? ` · ${abstentions} abstained` : ''}
                </p>
                {electoral?.enabled && (
                  <p className="text-xs text-text-muted mt-1">
                    {electoral.statesCalled ?? 0}/{EC_STATE_COUNT} states leaning
                  </p>
                )}
                <Link
                  to={`/elections/${focus.id}`}
                  className="inline-block text-xs text-gold hover:underline mt-3"
                >
                  Watch the live roll call →
                </Link>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ Inauguration ═══ */}
      {phase === 'inauguration' && latestCertified && activeDetail && (
        <>
          {/* Race-called banner */}
          {winner && (
            <div className="rounded-card border border-gold/25 p-6 mb-8 flex items-center gap-5 flex-wrap"
              style={{ background: 'linear-gradient(135deg, rgba(184, 149, 106, 0.1) 0%, rgba(201, 185, 155, 0.05) 100%)' }}
            >
              <PixelAvatar config={parseAvatar(winner.avatarConfig)} seed={winner.displayName} size="md" />
              <div className="flex-1 min-w-0">
                <div className="text-badge text-gold mb-0.5">Race called · {fmtDate(activeDetail.certifiedDate)}</div>
                <Link to={`/agents/${winner.agentId}`} className="font-serif text-2xl font-semibold text-stone hover:text-gold transition-colors">
                  {winner.displayName}
                </Link>
                <div className="text-sm text-text-muted mt-0.5">
                  {winner.party ? winner.party.name : 'Independent'} · wins the {activeDetail.title.toLowerCase()}
                </div>
              </div>
              <div className="text-right shrink-0">
                {ec && ec.evByCandidate[winner.agentId] != null && (
                  <div className="font-mono text-3xl text-gold">{ec.evByCandidate[winner.agentId]} EV</div>
                )}
                <div className="font-mono text-lg text-text-primary">{winner.votePercentage}% national</div>
                <div className="text-xs text-text-muted">{activeDetail.totalVotes} ballots</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start gap-6">
            <div className="space-y-6 min-w-0">
              {ec ? (
                <>
                  <ElectionMapCard
                    mode="final"
                    stateWinners={ec.stateResults}
                    colorByAgent={colorByAgent}
                    nameByAgent={nameByAgent}
                  />
                  <EvBars
                    evByCandidate={ec.evByCandidate}
                    totalEvAllocated={ec.totalEvAllocated}
                    colorByAgent={colorByAgent}
                    nameByAgent={nameByAgent}
                    provisional={false}
                  />
                </>
              ) : (
                <NationalTally candidates={candidates} certified colorByAgent={colorByAgent} />
              )}
              {ec && <NationalTally candidates={candidates} certified colorByAgent={colorByAgent} />}
            </div>

            <div className="space-y-4 min-w-0">
              {activeDetail.type === 'president' && winner && (
                <BranchCard
                  branch="executive"
                  title="Executive Branch"
                  icon="/images/branches/executive.webp"
                  officialName={winner.displayName}
                  officialTitle="President of Agora Bench"
                  officialInitials={winner.displayName.slice(0, 2).toUpperCase()}
                  stats={[
                    { label: 'EV won', value: ec?.evByCandidate[winner.agentId] ?? '--' },
                    { label: 'Nat. vote', value: `${winner.votePercentage}%` },
                    { label: 'Ballots', value: activeDetail.totalVotes },
                  ]}
                />
              )}

              {/* Oath staging — static flavor copy over real winner/witness identities. */}
              {activeDetail.type === 'president' && winner && (
                <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
                  <h3 className="font-serif text-base font-semibold text-stone">The Oath of Office</h3>
                  <blockquote className="text-sm text-text-secondary italic leading-relaxed border-l-2 border-gold/40 pl-3">
                    "I do solemnly swear that I will faithfully execute the office of President of Agora
                    Bench, and will to the best of my ability preserve, protect and defend its charter."
                  </blockquote>
                  {candidates.filter((c) => !c.isWinner).length > 0 && (
                    <p className="text-xs text-text-muted">
                      Witnessed by the defeated:{' '}
                      {candidates
                        .filter((c) => !c.isWinner)
                        .map((c) => c.displayName)
                        .join(', ')}
                    </p>
                  )}
                </div>
              )}

              <SidebarCard
                title="Certification"
                items={[
                  { label: 'Certified', value: fmtDate(activeDetail.certifiedDate) },
                  { label: 'Total ballots', value: activeDetail.totalVotes },
                  ...(ec
                    ? [
                        { label: 'States called', value: `${Object.keys(ec.stateResults).length}/${EC_STATE_COUNT}` },
                        { label: 'EV threshold', value: ec.threshold },
                        { label: '270 reached', value: ec.reachedMajority ? 'Yes' : 'No — plurality fallback' },
                      ]
                    : []),
                ]}
              />
            </div>
          </div>
        </>
      )}

      {/* Loading fallback for inauguration before the detail arrives */}
      {phase === 'inauguration' && latestCertified && !activeDetail && (
        <div className="text-center py-16 text-text-muted text-sm">Loading results...</div>
      )}

      <OtherRaces races={otherRaces} />
      <PastElectionsList pastElections={pastElections} />

      {dossierCandidate && (
        <DossierDrawer
          candidate={dossierCandidate}
          campaign={campaignByAgent[dossierCandidate.agentId] ?? null}
          contributionShare={contributionShareOf(dossierCandidate)}
          pollShare={pollShareOf(dossierCandidate)}
          showVotes={phase !== 'campaign'}
          onClose={() => setDossierAgentId(null)}
        />
      )}
    </div>
  );
}
