/**
 * Phase 4 judicial arc math — pure, deterministic, tick-number based.
 *
 * Stage gates key off TICK NUMBERS (the fiscal enactedTick pattern in
 * fiscalMath.ts), never wall-clock, so the arc survives tick-interval
 * changes, pauses, and restarts. Every input is guarded with
 * Number.isFinite so corrupt values can never advance or stall a case.
 *
 * Arc timeline (delay = courtHearingDelayTicks):
 *   filed at T -> docket due T+1 -> argument due hearingTick (T+1+delay)
 *   -> deliberation due hearingTick+1 -> decision due hearingTick+2
 *
 * Each due-function also checks the case STATUS, which is what makes tick
 * re-runs idempotent: a re-run after a committed stage sees the advanced
 * status and skips.
 */

/**
 * The active docket. The docket-room gate
 * (activeCount < courtMaxConcurrentCases) applies at FILING ONLY —
 * docketing (Stage B) is unconditional.
 */
export const ACTIVE_CASE_STATUSES = ['filed', 'docketed', 'argued', 'deliberating'] as const;
export type ActiveCaseStatus = (typeof ACTIVE_CASE_STATUSES)[number];

/** Ticks a stage may run past its due tick (postponements) before forced dismissal. */
export const STALL_GRACE_TICKS = 2;

/** Minimal timing shape shared by all due/stall checks (subset of a court_cases row). */
export interface CourtCaseTiming {
  status: string;
  filedTick: number;
  hearingTick: number | null;
}

/** Stage B gate — a filed case is docketed on the tick after filing. */
export function docketDue(c: CourtCaseTiming, tickNumber: number): boolean {
  if (c.status !== 'filed') return false;
  if (!Number.isFinite(tickNumber) || !Number.isFinite(c.filedTick)) return false;
  return tickNumber >= c.filedTick + 1;
}

/** Stage C gate — oral argument fires at/after hearingTick. */
export function hearingDue(c: CourtCaseTiming, tickNumber: number): boolean {
  if (c.status !== 'docketed') return false;
  if (c.hearingTick === null || !Number.isFinite(c.hearingTick)) return false;
  if (!Number.isFinite(tickNumber)) return false;
  return tickNumber >= c.hearingTick;
}

/** Stage D gate — justices deliberate and vote the tick after argument. */
export function deliberationDue(c: CourtCaseTiming, tickNumber: number): boolean {
  if (c.status !== 'argued') return false;
  if (c.hearingTick === null || !Number.isFinite(c.hearingTick)) return false;
  if (!Number.isFinite(tickNumber)) return false;
  return tickNumber >= c.hearingTick + 1;
}

/** Stage E gate — the ruling comes down the tick after deliberation. */
export function decisionDue(c: CourtCaseTiming, tickNumber: number): boolean {
  if (c.status !== 'deliberating') return false;
  if (c.hearingTick === null || !Number.isFinite(c.hearingTick)) return false;
  if (!Number.isFinite(tickNumber)) return false;
  return tickNumber >= c.hearingTick + 2;
}

/**
 * The tick at which the case's CURRENT stage was due to advance, or null
 * when the case is not active / its timing columns are unusable.
 * (Note: 'docketed' reads hearingTick, which Stage C postponements push
 * forward — so the stall clock resets with each postponement, bounding
 * every case to STALL_GRACE_TICKS of slack per gate.)
 */
export function expectedStageTick(c: CourtCaseTiming): number | null {
  switch (c.status) {
    case 'filed':
      return Number.isFinite(c.filedTick) ? c.filedTick + 1 : null;
    case 'docketed':
      return c.hearingTick !== null && Number.isFinite(c.hearingTick) ? c.hearingTick : null;
    case 'argued':
      return c.hearingTick !== null && Number.isFinite(c.hearingTick) ? c.hearingTick + 1 : null;
    case 'deliberating':
      return c.hearingTick !== null && Number.isFinite(c.hearingTick) ? c.hearingTick + 2 : null;
    default:
      return null; // decided / dismissed — never stalled
  }
}

/**
 * True when the case's current stage is overdue by more than
 * STALL_GRACE_TICKS — the phase then force-advances or dismisses without
 * prejudice so no case can wedge the docket forever.
 */
export function isStalled(c: CourtCaseTiming, tickNumber: number): boolean {
  if (!Number.isFinite(tickNumber)) return false;
  const expected = expectedStageTick(c);
  if (expected === null) return false;
  return tickNumber - expected > STALL_GRACE_TICKS;
}

/**
 * Case-number reference extractor. caseNumber format is AB-{filedTick}-{seq}
 * (e.g. AB-42-1), globally unique. Scans free text (filings, opinions, event
 * content, vote reasoning) for inline references to other cases and returns
 * the distinct set, preserving first-seen order. Pure and defensive: a
 * non-string input yields an empty list rather than throwing.
 */
export function extractCaseNumbers(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const matches = text.match(/\bAB-\d+-\d+\b/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

/**
 * Minimal shape needed to render a prior ruling as one line of precedent for
 * a Phase 10 prompt. Distinct from the wire/DB row so the formatter stays pure
 * and testable without a court_cases select.
 */
export interface PrecedentSummary {
  caseNumber: string;
  caption: string;
  outcome: string | null;
  votesFor: number;
  votesAgainst: number;
  holding: string;
}

/** Max length of a distilled holding before it is ellipsized. */
export const HOLDING_MAX_LEN = 200;

/**
 * The first sentence of a majority opinion, whitespace-normalized and hard-
 * capped so a precedent line stays a low-token summary rather than a full
 * opinion. Empty-safe: a null/blank opinion yields ''. Sentence boundary is
 * the first '. ', '! ', or '? ' (or terminal punctuation); if none is found
 * the whole (capped) text is used.
 */
export function distillHolding(majorityOpinion: string | null, maxLen: number = HOLDING_MAX_LEN): string {
  if (typeof majorityOpinion !== 'string') return '';
  const normalized = majorityOpinion.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return '';

  const boundary = normalized.search(/[.!?](\s|$)/);
  const firstSentence =
    boundary >= 0 ? normalized.slice(0, boundary + 1) : normalized;

  if (firstSentence.length <= maxLen) return firstSentence;
  return `${firstSentence.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

const OUTCOME_LABEL: Record<string, string> = {
  struck_down: 'struck_down',
  upheld: 'upheld',
  petitioner: 'petitioner',
  respondent: 'respondent',
  dismissed: 'dismissed',
};

/**
 * A compact numbered precedent block — one line per prior ruling:
 *   AB-12-1 "Doe v. Agora" — struck_down (3-2): <holding>
 * Empty input yields '' so callers can append nothing at zero cost. Pure and
 * defensive: a non-array input is treated as empty.
 */
export function buildPrecedentBlock(precedents: PrecedentSummary[]): string {
  if (!Array.isArray(precedents) || precedents.length === 0) return '';
  return precedents
    .map((p, i) => {
      const outcome = p.outcome ? (OUTCOME_LABEL[p.outcome] ?? p.outcome) : 'decided';
      const tally = `${p.votesFor ?? 0}-${p.votesAgainst ?? 0}`;
      const holding = (p.holding ?? '').trim();
      const head = `${i + 1}. ${p.caseNumber} "${p.caption}" — ${outcome} (${tally})`;
      return holding ? `${head}: ${holding}` : head;
    })
    .join('\n');
}

/**
 * The full precedent prompt injection — the numbered block wrapped in the
 * citation instruction — or '' when there is no precedent (the common early-
 * sim case pays zero prompt-size cost). Kept here so the "append nothing when
 * empty" rule lives in one pure, tested place.
 */
export function buildPrecedentInjection(precedents: PrecedentSummary[]): string {
  const block = buildPrecedentBlock(precedents);
  if (block.length === 0) return '';
  return (
    `Relevant precedent of this Court:\n${block}\n` +
    `When your reasoning relies on a prior ruling, cite it by case number (e.g. AB-12-1). ` +
    `If you depart from precedent, acknowledge it. `
  );
}
