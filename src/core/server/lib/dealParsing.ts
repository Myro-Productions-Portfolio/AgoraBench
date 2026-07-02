/**
 * Deal parsing from Phase 1.5 lobbying output — Rule 4 applies in full:
 * LLM output is untrusted. Only the whitelisted `deal.myVote` key is ever
 * read; agent IDs and the bill always come from server-side loop variables,
 * never from model output. Commitment strings are SERVER-COMPOSED so the
 * Phase 2c honor check can parse vote intent exactly.
 */

export type DealVote = 'yea' | 'nay';

export interface ParsedDeal {
  myVote: DealVote;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract an optional vote-pact offer from an LLM decision's `data` payload.
 *
 * Returns non-null ONLY when `data.deal` is a plain object whose `myVote`
 * value strictly normalizes to 'yea' or 'nay'. Every other key, shape, or
 * value is ignored — arrays, strings, numbers, nested junk, prototype keys.
 * Never throws.
 */
export function parseDealField(data: unknown): ParsedDeal | null {
  if (!isPlainObject(data)) return null;
  if (!Object.prototype.hasOwnProperty.call(data, 'deal')) return null;

  const deal = data['deal'];
  if (!isPlainObject(deal)) return null;
  if (!Object.prototype.hasOwnProperty.call(deal, 'myVote')) return null;

  const rawVote = deal['myVote'];
  /* Strict: must already be a string — String() coercion would let
     single-element arrays like ["yea"] stringify their way through. */
  if (typeof rawVote !== 'string') return null;

  const myVote = rawVote.toLowerCase().trim();
  if (myVote === 'yea' || myVote === 'nay') return { myVote };
  return null;
}

const COMMITMENT_TITLE_MAX_CHARS = 150;

/**
 * Compose a deal commitment string. The `vote <yea|nay>` prefix is the
 * machine-readable contract: Phase 2c's honor check parses vote intent from
 * exactly this prefix (bill titles can legally contain the substring "yea" —
 * e.g. "Fiscal Year..." — so intent must never be inferred from the full
 * string).
 */
export function composeCommitment(vote: DealVote, billTitle: string): string {
  const title = billTitle.replace(/"/g, "'").slice(0, COMMITMENT_TITLE_MAX_CHARS);
  return `vote ${vote} on "${title}"`;
}

/**
 * Parse promised vote direction from a commitment string.
 * Exact match on the server-composed `vote <yea|nay>` prefix; falls back to
 * the legacy substring heuristic for any non-conforming string.
 */
export function commitmentPromisesYea(commitment: string): boolean {
  const m = commitment.toLowerCase().match(/^\s*vote\s+(yea|nay)\b/);
  if (m) return m[1] === 'yea';
  return commitment.toLowerCase().includes('yea');
}
