// File: src/modules/legislation/client/pages/CasePage.tsx
// Purpose: Courtroom scene for a single case — Phase 4 judicial arc.
// Three acts:
//   1. The courtroom stage — 16:9 letterboxed interior (BuildingInteriorPage
//      pattern) with the sitting bench, counsel tables, and status-reactive
//      dressing (scheduled plaque / live transcript bubbles / verdict banner).
//   2. The record — court_case_events vertical timeline grouped by sim day.
//   3. The opinion reader — majority + dissent with cited-article chips that
//      open the ConstitutionDrawer, and Majority/Dissent-grouped vote cards.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { courtApi } from '@core/client/lib/api';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { getBuildingById } from '@core/client/lib/buildings';
import type { SeatPosition } from '@core/client/lib/buildings';
import { SpeechBubble } from '@modules/government/client/components/map/SpeechBubble';
import { PixelAvatar } from '@modules/agents/client/components/PixelAvatar';
import type { AvatarConfig } from '@modules/agents/client/components/PixelAvatar';
import { ConstitutionDrawer, articleRoman } from '../components/ConstitutionDrawer';
import { CONSTITUTION } from '@shared/constitution';

/* Judicial slate + palette anchors (matches CourtPage / map ticker) */
const JUDICIAL_SLATE = '#6B7A8D';
const GOLD = '#B8956A';
const DANGER = '#8B3A3A';
const MUTED = '#72767D';

/* ── Wire types (GET /api/court/cases/:id) ─────────────────────────────── */

interface LawRef {
  id: string;
  title: string;
  enactedDate: string;
  isActive: boolean;
}

interface CaseEvent {
  id: string;
  tick: number;
  type: string;
  actorId: string | null;
  role: string | null;
  content: string;
  createdAt: string;
  actorName: string | null;
  actorAvatarConfig: string | null;
}

interface VoteDetail {
  id: string;
  justiceId: string;
  vote: string;
  reasoning: string | null;
  citedArticles: string | null;
  castAt: string;
  justiceName: string | null;
  justiceAvatarConfig: string | null;
  justiceAlignment: string | null;
}

interface BenchJustice {
  id: string;
  displayName: string;
  avatarConfig: string | null;
  alignment: string | null;
  isChief: boolean;
}

interface CaseDetail {
  id: string;
  caseNumber: string;
  caption: string;
  caseType: string;
  status: string;
  lawId: string | null;
  petitionerId: string;
  respondentId: string | null;
  questionPresented: string | null;
  filingText: string | null;
  filedTick: number;
  hearingTick: number | null;
  decidedTick: number | null;
  outcome: string | null;
  majorityOpinion: string | null;
  majorityAuthorId: string | null;
  majorityCitations: string | null;
  dissentOpinion: string | null;
  dissentAuthorId: string | null;
  dissentCitations: string | null;
  votesFor: number;
  votesAgainst: number;
  createdAt: string;
  decidedAt: string | null;
  petitionerName: string | null;
  petitionerAvatarConfig: string | null;
  respondentName: string | null;
  respondentAvatarConfig: string | null;
  lawTitle: string | null;
  law: LawRef | null;
  events: CaseEvent[];
  votes: VoteDetail[];
  bench: BenchJustice[];
}

/* ── Labels ────────────────────────────────────────────────────────────── */

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

const CASE_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  constitutional_challenge: { label: 'Constitutional Challenge', className: 'text-gold bg-gold/10 border-gold/30' },
  agent_dispute:            { label: 'Agent Dispute', className: 'text-blue-300 bg-blue-900/20 border-blue-700/30' },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  filing:            'Filing',
  docketed:          'Docketed',
  hearing_scheduled: 'Hearing Scheduled',
  oral_argument:     'Oral Argument',
  justice_question:  'Question from the Bench',
  deliberation:      'Deliberation',
  majority_opinion:  'Majority Opinion',
  dissent:           'Dissent',
  ruling:            'Ruling',
  dismissed:         'Dismissed',
  postponed:         'Postponed',
};

const VERDICT_LABELS: Record<string, string> = {
  struck_down: 'STRUCK DOWN',
  upheld:      'UPHELD',
  petitioner:  'FOR THE PETITIONER',
  respondent:  'FOR THE RESPONDENT',
  dismissed:   'DISMISSED',
};

const VOTE_LABELS: Record<string, string> = {
  strike:     'Strike',
  uphold:     'Uphold',
  petitioner: 'For Petitioner',
  respondent: 'For Respondent',
};

/* Winning vote value per outcome — groups votes into Majority vs Dissent */
const WINNING_VOTE: Record<string, string> = {
  struck_down: 'strike',
  upheld:      'uphold',
  petitioner:  'petitioner',
  respondent:  'respondent',
};

/* Event types voiced from a seat during argued/deliberating transcript cycling */
const TRANSCRIPT_EVENT_TYPES = new Set(['oral_argument', 'justice_question', 'deliberation']);

/* ── Helpers ───────────────────────────────────────────────────────────── */

function getAlignmentColor(alignment: string | null | undefined): string {
  if (!alignment) return GOLD;
  const a = alignment.toLowerCase();
  if (a.includes('progress') || a.includes('liberal') || a.includes('tech') || a.includes('digital')) return '#6B7A8D';
  if (a.includes('conserv') || a.includes('right') || a.includes('nation') || a.includes('auth')) return '#8B3A3A';
  if (a.includes('labor') || a.includes('union') || a.includes('social') || a.includes('green')) return '#3A6B3A';
  return GOLD;
}

function parseAvatar(raw: string | null): AvatarConfig | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AvatarConfig;
  } catch {
    return undefined;
  }
}

/* citedArticles / majorityCitations / dissentCitations are JSON int-array-as-
   text, written only by the Stage D/E validators — but parse defensively. */
function parseCitations(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  } catch {
    return [];
  }
}

function plural(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

/* Relative-day line — Day N (tick number) is the authoritative clock,
   same semantics as the CourtPage docket cards. */
function dayLine(c: CaseDetail, currentTick: number): { primary: string; day: number | null } {
  if (c.status === 'filed') return { primary: 'Awaiting docketing', day: c.filedTick };
  if (c.status === 'docketed' && c.hearingTick !== null) {
    const n = c.hearingTick - currentTick;
    return { primary: n <= 0 ? 'Oral argument today' : `Oral argument in ${plural(n)}`, day: c.hearingTick };
  }
  if (c.status === 'argued' && c.hearingTick !== null) {
    const n = c.hearingTick + 1 - currentTick;
    return { primary: n <= 0 ? 'Deliberation today' : `Deliberation in ${plural(n)}`, day: c.hearingTick + 1 };
  }
  if (c.status === 'deliberating' && c.hearingTick !== null) {
    const n = c.hearingTick + 2 - currentTick;
    return { primary: n <= 0 ? 'Decision today' : `Decision in ${plural(n)}`, day: c.hearingTick + 2 };
  }
  if ((c.status === 'decided' || c.status === 'dismissed') && c.decidedTick !== null) {
    const n = currentTick - c.decidedTick;
    const verb = c.status === 'decided' ? 'Decided' : 'Dismissed';
    return { primary: n <= 0 ? `${verb} today` : `${verb} ${plural(n)} ago`, day: c.decidedTick };
  }
  return { primary: STATUS_LABELS[c.status] ?? c.status, day: c.filedTick };
}

/* ── Stage seat layout ─────────────────────────────────────────────────── */
/* buildings.ts supreme-court seats: [0..6] bench (3 = chief center),
   [7..8] counsel table 1 (left), [9..10] counsel table 2 (right).       */

/* bench[0] is the chief (earliest appointed) — center seat, then fan
   outward by seniority so senior justices sit nearest the chief.        */
const BENCH_FILL_ORDER = [3, 2, 4, 1, 5, 0, 6];

interface StagePlacement {
  key: string;
  agentId: string;
  name: string;
  avatarConfig: string | null;
  alignment: string | null;
  seat: SeatPosition;
  roleLabel: string;
}

/* ── Stage sub-components ──────────────────────────────────────────────── */

function StageSeat({ p }: { p: StagePlacement }) {
  const ringColor = getAlignmentColor(p.alignment);
  return (
    <div
      className="absolute group"
      style={{ left: `${p.seat.x}%`, top: `${p.seat.y}%`, transform: 'translate(-50%, -50%)', zIndex: 10 }}
    >
      <Link to={`/agents/${p.agentId}`} title={`${p.name} — ${p.roleLabel}`}>
        <motion.div
          whileHover={{ scale: 1.2 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden bg-capitol-deep"
          style={{
            border: `2px solid ${ringColor}`,
            boxShadow: `0 0 10px ${ringColor}66, 0 2px 8px rgba(0,0,0,0.5)`,
          }}
        >
          <PixelAvatar config={parseAvatar(p.avatarConfig)} seed={p.name} size="sm" />
        </motion.div>
      </Link>
      {/* Name + role label on hover */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-1.5 py-0.5 bg-capitol-elevated border border-border rounded text-[0.55rem] text-text-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
        {p.name}
        <span className="ml-1 text-text-muted uppercase tracking-widest text-[0.45rem]">{p.roleLabel}</span>
      </div>
    </div>
  );
}

/* Repeating pulse glow on the whole stage for decided cases —
   BuildingPulseRing styling, looped. */
function VerdictPulse({ color }: { color: string }) {
  return (
    <motion.div
      className="absolute inset-0 pointer-events-none"
      initial={{ opacity: 0.55 }}
      animate={{ opacity: [0.55, 0] }}
      transition={{ duration: 2.4, ease: 'easeOut', repeat: Infinity }}
      style={{
        border: `2px solid ${color}`,
        boxShadow: `inset 0 0 32px ${color}55, 0 0 16px ${color}66`,
      }}
      aria-hidden="true"
    />
  );
}

/* ── Opinion reader pieces ─────────────────────────────────────────────── */

function ArticleChips({ raw, onOpen }: { raw: string | null; onOpen: (n: number) => void }) {
  const numbers = parseCitations(raw);
  if (numbers.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {numbers.map((n) => {
        const article = CONSTITUTION.find((a) => a.number === n);
        if (!article) return null;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onOpen(n)}
            className="badge border text-badge text-gold bg-gold/10 border-gold/30 hover:bg-gold/20 transition-colors"
            title={`Open Article ${articleRoman(n)} in the Constitution`}
          >
            Art. {articleRoman(n)} — {article.title}
          </button>
        );
      })}
    </div>
  );
}

function VoteCard({ vote, onOpenArticle }: { vote: VoteDetail; onOpenArticle: (n: number) => void }) {
  const name = vote.justiceName ?? 'Former Justice';
  const ringColor = getAlignmentColor(vote.justiceAlignment);
  return (
    <div className="rounded-lg border border-border bg-capitol-card p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <PixelAvatar config={parseAvatar(vote.justiceAvatarConfig)} seed={name} size="sm" />
          <div className="min-w-0">
            <Link to={`/agents/${vote.justiceId}`} className="text-sm font-medium text-gold hover:underline truncate block">
              {name}
            </Link>
            {vote.justiceAlignment && (
              <span className="text-badge capitalize" style={{ color: ringColor }}>
                {vote.justiceAlignment}
              </span>
            )}
          </div>
        </div>
        <span className="badge border text-badge shrink-0 text-stone bg-stone/10 border-stone/30">
          {VOTE_LABELS[vote.vote] ?? vote.vote}
        </span>
      </div>
      {vote.reasoning && (
        <p className="text-xs text-text-secondary leading-relaxed">{vote.reasoning}</p>
      )}
      <ArticleChips raw={vote.citedArticles} onOpen={onOpenArticle} />
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { subscribe } = useWebSocket();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [currentTick, setCurrentTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [transcriptIdx, setTranscriptIdx] = useState(0);
  const [openArticle, setOpenArticle] = useState<number | null>(null);

  const fetchAll = useCallback(() => {
    if (!id) return;
    Promise.all([courtApi.caseById(id), courtApi.stats()])
      .then(([caseRes, statsRes]) => {
        if (caseRes.data) setCaseData(caseRes.data as CaseDetail);
        else setNotFound(true);
        const stats = statsRes.data as { currentTick?: number } | undefined;
        if (typeof stats?.currentTick === 'number') setCurrentTick(stats.currentTick);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  /* Live record — refetch when this case moves through the arc */
  useEffect(() => {
    if (!id) return;
    const onCourtEvent = (data: unknown) => {
      const payload = data as { caseId?: string } | undefined;
      if (payload?.caseId === id) fetchAll();
    };
    const unsubs = ['court:case_filed', 'court:hearing', 'court:ruling'].map((event) =>
      subscribe(event, onCourtEvent),
    );
    return () => unsubs.forEach((u) => u());
  }, [id, subscribe, fetchAll]);

  const building = getBuildingById('supreme-court');

  /* Transcript cycling during argued/deliberating */
  const transcriptEvents = useMemo(
    () =>
      (caseData?.events ?? []).filter(
        (e) => TRANSCRIPT_EVENT_TYPES.has(e.type) && e.actorId !== null,
      ),
    [caseData?.events],
  );
  const isLiveSession = caseData?.status === 'argued' || caseData?.status === 'deliberating';

  useEffect(() => {
    if (!isLiveSession || transcriptEvents.length < 2) return;
    const t = setInterval(() => setTranscriptIdx((i) => i + 1), 6000);
    return () => clearInterval(t);
  }, [isLiveSession, transcriptEvents.length]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <p className="text-text-muted text-center py-16">Loading case...</p>
      </div>
    );
  }

  if (notFound || !caseData || !building) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-4">
        <Link to="/court" className="text-badge text-text-muted hover:text-gold transition-colors">
          Back to Court
        </Link>
        <p className="text-text-muted text-center py-16">Case not found.</p>
      </div>
    );
  }

  const typeBadge = CASE_TYPE_BADGES[caseData.caseType] ?? {
    label: caseData.caseType,
    className: 'text-text-muted bg-border/10 border-border/30',
  };
  const { primary: dayPrimary, day } = dayLine(caseData, currentTick);

  /* Seat placements: bench (chief center) + counsel tables */
  const benchSeats = building.seats.slice(0, 7);
  const placements: StagePlacement[] = [];
  caseData.bench.slice(0, BENCH_FILL_ORDER.length).forEach((justice, i) => {
    placements.push({
      key: `justice-${justice.id}`,
      agentId: justice.id,
      name: justice.displayName,
      avatarConfig: justice.avatarConfig,
      alignment: justice.alignment,
      seat: benchSeats[BENCH_FILL_ORDER[i]],
      roleLabel: justice.isChief ? 'Chief Justice' : 'Justice',
    });
  });
  placements.push({
    key: 'petitioner',
    agentId: caseData.petitionerId,
    name: caseData.petitionerName ?? 'Petitioner',
    avatarConfig: caseData.petitionerAvatarConfig,
    alignment: null,
    seat: building.seats[8],
    roleLabel: 'Petitioner',
  });
  if (caseData.respondentId) {
    placements.push({
      key: 'respondent',
      agentId: caseData.respondentId,
      name: caseData.respondentName ?? 'Respondent',
      avatarConfig: caseData.respondentAvatarConfig,
      alignment: null,
      seat: building.seats[9],
      roleLabel: 'Respondent',
    });
  }
  const seatByAgent = new Map(placements.map((p) => [p.agentId, p.seat]));

  const activeBubbleEvent =
    isLiveSession && transcriptEvents.length > 0
      ? transcriptEvents[transcriptIdx % transcriptEvents.length]
      : null;
  const activeBubbleSeat = activeBubbleEvent?.actorId
    ? seatByAgent.get(activeBubbleEvent.actorId)
    : undefined;

  /* Verdict dressing */
  const isDecided = caseData.status === 'decided';
  const isDismissed = caseData.status === 'dismissed';
  const totalVotes = caseData.votesFor + caseData.votesAgainst;
  const majorityFirstLine =
    totalVotes > 0
      ? `${Math.max(caseData.votesFor, caseData.votesAgainst)}–${Math.min(caseData.votesFor, caseData.votesAgainst)}`
      : null;
  const verdictColor = isDismissed
    ? MUTED
    : caseData.outcome === 'struck_down'
      ? DANGER
      : GOLD;
  const verdictLabel = caseData.outcome ? (VERDICT_LABELS[caseData.outcome] ?? caseData.outcome.toUpperCase()) : null;

  /* Scheduled plaque (pre-argument) */
  const showPlaque = caseData.status === 'filed' || caseData.status === 'docketed';
  const plaqueTitle =
    caseData.status === 'docketed' && caseData.hearingTick !== null
      ? `ARGUMENT SCHEDULED — DAY ${caseData.hearingTick}`
      : 'CASE FILED — AWAITING DOCKETING';
  const plaqueSubtitle =
    caseData.status === 'docketed' && caseData.hearingTick !== null
      ? caseData.hearingTick - currentTick <= 0
        ? 'today'
        : `in ${plural(caseData.hearingTick - currentTick)}`
      : `filed on Day ${caseData.filedTick}`;

  /* The record — group events by sim day */
  const eventsByDay: Array<{ tick: number; events: CaseEvent[] }> = [];
  for (const event of caseData.events) {
    const last = eventsByDay[eventsByDay.length - 1];
    if (last && last.tick === event.tick) last.events.push(event);
    else eventsByDay.push({ tick: event.tick, events: [event] });
  }

  /* Opinion reader grouping */
  const majoritySideVote = caseData.outcome ? WINNING_VOTE[caseData.outcome] : undefined;
  const majorityVotes = majoritySideVote
    ? caseData.votes.filter((v) => v.vote === majoritySideVote)
    : [];
  const dissentVotes = majoritySideVote
    ? caseData.votes.filter((v) => v.vote !== majoritySideVote)
    : caseData.votes;
  const justiceName = (agentId: string | null): string | null => {
    if (!agentId) return null;
    return (
      caseData.bench.find((j) => j.id === agentId)?.displayName ??
      caseData.votes.find((v) => v.justiceId === agentId)?.justiceName ??
      null
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <Link to="/court" className="text-badge text-text-muted hover:text-gold transition-colors">
        Back to Court
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="font-serif text-3xl font-semibold text-stone leading-snug">{caseData.caption}</h1>
            <span className="font-mono text-xs text-text-muted">{caseData.caseNumber}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`badge border text-badge ${typeBadge.className}`}>{typeBadge.label}</span>
            <span className={`badge border text-badge ${STATUS_BADGES[caseData.status] ?? 'text-text-muted bg-border/10 border-border/30'}`}>
              {STATUS_LABELS[caseData.status] ?? caseData.status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <span className="text-text-secondary">{dayPrimary}</span>
          {day !== null && <span className="font-mono text-badge text-text-muted">Day {day}</span>}
          {caseData.law && (
            <span className="text-text-muted">
              Challenging:{' '}
              <Link to={`/laws/${caseData.law.id}`} className="text-gold hover:underline">
                {caseData.law.title}
              </Link>
              {!caseData.law.isActive && <span className="ml-1.5 text-text-muted">(no longer in force)</span>}
            </span>
          )}
        </div>
      </div>

      {/* ── Act 1: The courtroom stage ─────────────────────────────────── */}
      <div
        className="h-[56vh] min-h-[320px] flex items-center justify-center bg-capitol-deep rounded-lg border border-border overflow-hidden"
        style={{ containerType: 'size' } as React.CSSProperties}
      >
        {/* Locked 16:9 room — container query units letterbox it inside the
            available space in either dimension (BuildingInteriorPage pattern) */}
        <div
          className="relative overflow-hidden"
          style={{
            width: 'min(100cqw, calc(100cqh * 16 / 9))',
            height: 'min(100cqh, calc(100cqw * 9 / 16))',
          }}
        >
          {/* Backdrop: courtroom image or placeholder gradient */}
          {!imgError ? (
            <img
              src="/images/interiors/supreme-court.webp"
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full"
              style={{ objectFit: 'fill' }}
              onError={() => setImgError(true)}
              draggable={false}
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(ellipse at 50% 30%, ${JUDICIAL_SLATE}14 0%, transparent 65%),
                             linear-gradient(180deg, #1A1B1E 0%, #1C1F23 100%)`,
              }}
              aria-hidden="true"
            />
          )}

          {/* Vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.5) 100%)' }}
            aria-hidden="true"
          />

          {/* Faint markers on the bench + counsel seats */}
          {building.seats.slice(0, 11).map((seat, i) => (
            <div
              key={i}
              className="absolute w-10 h-10 rounded-full pointer-events-none"
              style={{
                left: `${seat.x}%`,
                top: `${seat.y}%`,
                transform: 'translate(-50%, -50%)',
                border: '1px dashed rgba(201,185,155,0.3)',
              }}
              aria-hidden="true"
            />
          ))}

          {/* Bench + counsel */}
          {placements.map((p) => (
            <StageSeat key={p.key} p={p} />
          ))}

          {/* Chief Justice marker under the center seat */}
          {caseData.bench.length > 0 && (
            <div
              className="absolute pointer-events-none text-[0.5rem] font-mono uppercase tracking-widest"
              style={{
                left: `${benchSeats[3].x}%`,
                top: `${benchSeats[3].y + 7}%`,
                transform: 'translate(-50%, 0)',
                color: 'rgba(201,185,155,0.75)',
              }}
            >
              Chief
            </div>
          )}

          {/* Live transcript bubble (argued / deliberating) */}
          {activeBubbleEvent && activeBubbleSeat && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${activeBubbleSeat.x}%`,
                top: `${activeBubbleSeat.y}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: 30,
              }}
            >
              <SpeechBubble
                bubble={{
                  id: `${activeBubbleEvent.id}-${transcriptIdx}`,
                  agentId: activeBubbleEvent.actorId ?? '',
                  text: activeBubbleEvent.content,
                  type: 'speech',
                  expiresAt: 0,
                }}
              />
            </div>
          )}

          {/* Scheduled plaque (filed / docketed) */}
          {showPlaque && (
            <motion.div
              className="absolute left-1/2 pointer-events-none"
              style={{ top: '42%', transform: 'translate(-50%, -50%)' }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            >
              <div
                className="px-6 py-3 rounded text-center"
                style={{
                  background: 'rgba(26,27,30,0.88)',
                  border: `1px solid ${GOLD}99`,
                  boxShadow: `0 0 18px ${GOLD}33`,
                }}
              >
                <p className="font-serif text-sm tracking-widest whitespace-nowrap" style={{ color: GOLD }}>
                  {plaqueTitle}
                </p>
                <p className="text-[0.6rem] font-mono uppercase tracking-widest mt-1 text-text-muted">
                  {plaqueSubtitle}
                </p>
              </div>
            </motion.div>
          )}

          {/* Verdict banner + pulse (decided / dismissed) */}
          {(isDecided || isDismissed) && verdictLabel && (
            <>
              <VerdictPulse color={verdictColor} />
              <motion.div
                className="absolute left-1/2 pointer-events-none"
                style={{ top: '42%', transform: 'translate(-50%, -50%)' }}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              >
                <div
                  className="px-8 py-4 rounded text-center"
                  style={{
                    background: 'rgba(26,27,30,0.9)',
                    border: `1px solid ${verdictColor}`,
                    boxShadow: `0 0 24px ${verdictColor}55`,
                  }}
                >
                  <p
                    className="font-serif text-2xl font-semibold tracking-widest whitespace-nowrap"
                    style={{ color: verdictColor }}
                  >
                    {verdictLabel}
                    {isDecided && majorityFirstLine ? ` ${majorityFirstLine}` : ''}
                  </p>
                </div>
              </motion.div>
            </>
          )}
        </div>
      </div>

      {/* ── Act 2: The record ──────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="font-serif text-lg font-semibold text-stone">The Record</h2>

        {caseData.questionPresented && (
          <div className="rounded-lg border border-border bg-capitol-card p-5 space-y-1.5">
            <p className="text-badge text-text-muted uppercase tracking-widest">Question Presented</p>
            <p className="font-serif text-base text-stone leading-relaxed">{caseData.questionPresented}</p>
          </div>
        )}

        {eventsByDay.length === 0 ? (
          <p className="text-text-muted text-sm">The record is empty.</p>
        ) : (
          <div className="space-y-6">
            {eventsByDay.map(({ tick, events }) => (
              <div key={tick} className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-badge text-text-muted uppercase tracking-widest shrink-0">
                    Day {tick}
                  </span>
                  <div className="h-px flex-1 bg-border/40" />
                </div>
                <div className="space-y-3 border-l pl-4 ml-1.5" style={{ borderColor: `${JUDICIAL_SLATE}55` }}>
                  {events.map((event) => (
                    <div key={event.id} className="rounded-lg border border-border bg-capitol-card p-4 space-y-2">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {event.actorId ? (
                            <>
                              <PixelAvatar
                                config={parseAvatar(event.actorAvatarConfig)}
                                seed={event.actorName ?? event.actorId}
                                size="xs"
                              />
                              <Link
                                to={`/agents/${event.actorId}`}
                                className="text-xs font-medium text-gold hover:underline truncate"
                              >
                                {event.actorName ?? 'Unknown'}
                              </Link>
                              {event.role && (
                                <span className="text-badge uppercase tracking-widest text-text-muted shrink-0">
                                  {event.role}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-badge uppercase tracking-widest text-text-muted">The Court</span>
                          )}
                        </div>
                        <span
                          className="text-badge uppercase tracking-widest shrink-0"
                          style={{ color: JUDICIAL_SLATE }}
                        >
                          {EVENT_TYPE_LABELS[event.type] ?? event.type}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed">{event.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Act 3: The opinion reader (decided only) ───────────────────── */}
      {isDecided && (
        <div className="space-y-4">
          <h2 className="font-serif text-lg font-semibold text-stone">Opinions of the Court</h2>

          {caseData.majorityOpinion && (
            <div
              className="rounded-lg border border-border bg-capitol-card p-6 space-y-3"
              style={{ borderLeft: `4px solid ${GOLD}` }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-badge uppercase tracking-widest" style={{ color: GOLD }}>
                  Opinion of the Court
                </p>
                {justiceName(caseData.majorityAuthorId) && (
                  <p className="text-xs text-text-muted">
                    Delivered by{' '}
                    <Link to={`/agents/${caseData.majorityAuthorId}`} className="text-gold hover:underline">
                      {justiceName(caseData.majorityAuthorId)}
                    </Link>
                  </p>
                )}
              </div>
              <p className="font-serif text-sm text-text-primary leading-relaxed whitespace-pre-line">
                {caseData.majorityOpinion}
              </p>
              <ArticleChips raw={caseData.majorityCitations} onOpen={setOpenArticle} />
            </div>
          )}

          {caseData.dissentOpinion && (
            <div
              className="rounded-lg border border-border bg-capitol-card p-6 space-y-3"
              style={{ borderLeft: `4px solid ${DANGER}` }}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-badge uppercase tracking-widest" style={{ color: '#B07A7A' }}>
                  Dissenting Opinion
                </p>
                {justiceName(caseData.dissentAuthorId) && (
                  <p className="text-xs text-text-muted">
                    Delivered by{' '}
                    <Link to={`/agents/${caseData.dissentAuthorId}`} className="text-gold hover:underline">
                      {justiceName(caseData.dissentAuthorId)}
                    </Link>
                  </p>
                )}
              </div>
              <p className="font-serif text-sm text-text-primary leading-relaxed whitespace-pre-line">
                {caseData.dissentOpinion}
              </p>
              <ArticleChips raw={caseData.dissentCitations} onOpen={setOpenArticle} />
            </div>
          )}

          {/* Votes grouped by side */}
          {caseData.votes.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <h3 className="text-badge uppercase tracking-widest" style={{ color: GOLD }}>
                  Majority ({majorityVotes.length})
                </h3>
                {majorityVotes.length === 0 ? (
                  <p className="text-text-muted text-xs">No recorded majority votes.</p>
                ) : (
                  majorityVotes.map((vote) => (
                    <VoteCard key={vote.id} vote={vote} onOpenArticle={setOpenArticle} />
                  ))
                )}
              </div>
              <div className="space-y-3">
                <h3 className="text-badge uppercase tracking-widest" style={{ color: '#B07A7A' }}>
                  Dissent ({dissentVotes.length})
                </h3>
                {dissentVotes.length === 0 ? (
                  <p className="text-text-muted text-xs">The Court was unanimous.</p>
                ) : (
                  dissentVotes.map((vote) => (
                    <VoteCard key={vote.id} vote={vote} onOpenArticle={setOpenArticle} />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filing text (all statuses, below the fold) */}
      {caseData.filingText && (
        <div className="rounded-lg border border-border bg-capitol-card p-6 space-y-2">
          <p className="text-badge text-text-muted uppercase tracking-widest">Petition as Filed</p>
          <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">{caseData.filingText}</p>
        </div>
      )}

      <ConstitutionDrawer articleNumber={openArticle} onClose={() => setOpenArticle(null)} />
    </div>
  );
}
