/**
 * Ballot prompt/response contract for the Phase 14 vote-casting exchange.
 *
 * Born from the inaugural presidential election recording ZERO ballots
 * despite 70 valid LLM responses: a 20-candidate ballot context (~7,020
 * chars of full platforms) overflowed rc.maxPromptLengthChars (4,000), and
 * callProvider truncation cut the TAIL — which held the response-format
 * instruction — so every voter answered in a well-formed-but-wrong schema
 * ({"vote": "<uuid>"}), parsed as 'unknown', was discarded, and the
 * zero-ballot contributions fallback decided the race. Three layers here
 * close that failure class:
 *   1. buildBallotContextMessage puts the instruction FIRST — truncation
 *      can only ever eat candidate/alignment tail, never the instruction.
 *   2. buildBallotCandidateLines excerpts platforms (<= 100 chars) and
 *      shrinks them further under a total budget so a crowded field still
 *      fits the prompt window.
 *   3. coerceBallotVote accepts the observed wrong-schema ballot shape.
 * Pure and DB-free so all of it unit-tests without mocking Drizzle
 * (courtMath / electionMath pattern).
 */

/** Exact legacy instruction wording — a wire contract with the parser; do not reword. */
export const BALLOT_RESPONSE_INSTRUCTION =
  'Respond with exactly this JSON structure: ' +
  '{"action":"election_vote","reasoning":"one sentence","data":{"candidateId":"<the id of your chosen candidate>"}}';

/* Identity fields stay legible at any input size; platforms absorb all the
   squeeze. Real names/parties sit well under these caps. */
const NAME_MAX_CHARS = 32;
const PARTY_MAX_CHARS = 24;
const PLATFORM_MAX_CHARS = 100;
const LINES_BUDGET_CHARS = 3500;

/** Whitespace-collapsed excerpt, hard-capped at `max` chars including the ellipsis. */
function excerptLine(text: string | null | undefined, max: number): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (max <= 0) return '';
  if (t.length <= max) return t;
  if (max <= 3) return t.slice(0, max);
  return `${t.slice(0, max - 3)}...`;
}

export interface BallotCandidateLineInput {
  agentId: string;
  displayName: string;
  party: string;
  approvalRating: number | null;
  platform: string | null;
  /** Flag-gated riders, pre-formatted by the caller ('' when the flag is off). */
  endorsementNote?: string;
  pollNote?: string;
  fiscalRecord?: string | null;
}

export interface BallotLineOptions {
  /** Hard per-platform excerpt cap (default 100). */
  platformMaxChars?: number;
  /** Budget for the joined lines (default 3500): platform excerpts shrink evenly until the block fits. */
  totalBudgetChars?: number;
}

export function buildBallotCandidateLines(
  candidates: BallotCandidateLineInput[],
  opts: BallotLineOptions = {},
): string[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const platformCap = opts.platformMaxChars ?? PLATFORM_MAX_CHARS;
  const budget = opts.totalBudgetChars ?? LINES_BUDGET_CHARS;

  const render = (perPlatform: number): string[] =>
    candidates.map((c) => {
      const base =
        `  - ${excerptLine(c.displayName, NAME_MAX_CHARS)} (id: ${c.agentId}, ` +
        `party: ${excerptLine(c.party, PARTY_MAX_CHARS)}, approval: ${c.approvalRating ?? 50}%` +
        `${c.endorsementNote ?? ''}${c.pollNote ?? ''}): ${excerptLine(c.platform, perPlatform)}`;
      return c.fiscalRecord ? `${base}\n    ${c.fiscalRecord}` : base;
    });
  const joinedLength = (lines: string[]): number =>
    lines.reduce((sum, l) => sum + l.length, 0) + (lines.length - 1);

  const lines = render(platformCap);
  if (joinedLength(lines) <= budget) return lines;

  /* Over budget: platforms are the only compressible field. Zero-platform
     length is exact, so the closed-form per-platform allowance can never
     overshoot the budget. A field so crowded that even zero-platform lines
     overflow returns them anyway — ballots must proceed; the
     instruction-first context and the parse fallback are the deeper nets. */
  const fixed = joinedLength(render(0));
  const perPlatform = Math.max(0, Math.min(platformCap, Math.floor((budget - fixed) / candidates.length)));
  return render(perPlatform);
}

/**
 * Instruction-FIRST ballot context: response format, then candidates, then
 * per-voter alignment. Truncation at rc.maxPromptLengthChars can now only
 * eat tail context, never the instruction that tells the model how to answer.
 */
export function buildBallotContextMessage(
  positionType: string,
  candidateBlock: string,
  alignmentLines?: string,
): string {
  return (
    `You are voting in the ${positionType} election. ` +
    BALLOT_RESPONSE_INSTRUCTION +
    `\n\nCandidates:\n${candidateBlock}` +
    (alignmentLines ? `\n\n${alignmentLines}` : '')
  );
}

export interface CoercedBallot {
  action: 'election_vote';
  reasoning: string;
  data: { candidateId: string };
}

/**
 * Wrong-schema ballot fallback, scoped to the election_voting phase ONLY:
 * a response with no usable "action" key but a top-level "vote" or
 * "candidateId" string is unambiguously a ballot — exactly the shape all 70
 * discarded inaugural-election responses had. Any non-empty "action" value
 * defers to the alias/retry machinery in ai.ts; no other phase is loosened.
 *
 * Not a write hole: Phase 14 validates the coerced candidateId against the
 * election's actual candidate set (candidateIds.has) before inserting, so a
 * coerced garbage value is discarded exactly as before.
 */
export function coerceBallotVote(parsed: unknown, phase: string | undefined): CoercedBallot | null {
  if (phase !== 'election_voting') return null;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const action = obj['action'];
  if (typeof action === 'string' && action.trim().length > 0) return null;
  const candidateId = [obj['candidateId'], obj['vote']]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (!candidateId) return null;
  const reasoning = [obj['reasoning'], obj['reason']]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return {
    action: 'election_vote',
    reasoning: reasoning ?? 'ballot recovered from bare vote-key response',
    data: { candidateId: candidateId.trim() },
  };
}
