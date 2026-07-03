/**
 * Judicial LLM payload parsing — Phase 4 arc. Rule 4 applies in full: LLM
 * output is UNTRUSTED. This module is the ONLY point where model output can
 * become a court vote, opinion, or filing. Discipline copied from
 * fiscalParsing.ts / dealParsing.ts (the proven templates in this call
 * path): isPlainObject guard, Object.prototype.hasOwnProperty checks,
 * strict typeof on strings, whitelist of exactly the expected keys, and
 * null on ANY deviation. Never throws.
 *
 * One deliberate exception to the "no coercion" rule: citedArticles
 * elements go through Number() — Gemma frequently returns ["5","7"]
 * instead of [5,7], and a citation is decorative (filtered against the
 * real article numbers, never used for control flow), so lenient reading
 * is safe and loses nothing.
 */

import { CONSTITUTION_ARTICLE_NUMBERS } from '@shared/constitution';

/** 'strike'/'uphold' for constitutional challenges, 'petitioner'/'respondent' for disputes. */
export type JudicialVoteChoice = 'strike' | 'uphold' | 'petitioner' | 'respondent';

export interface ParsedJudicialVote {
  vote: JudicialVoteChoice;
  /** Validated against CONSTITUTION_ARTICLE_NUMBERS, deduped, insertion order. */
  citedArticles: number[];
}

export interface ParsedJudicialOpinion {
  opinion: string;
  citedArticles: number[];
}

export interface ParsedJudicialFiling {
  filing: string;
  questionPresented: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed, length-capped own-property string read. Null on any deviation. */
function readString(obj: Record<string, unknown>, key: string, maxChars: number): string | null {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const v = obj[key];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxChars);
}

/**
 * Filter an untrusted citedArticles value down to real article numbers.
 * Non-arrays and unrecognized entries silently drop — citations are
 * decorative, so the result is always a (possibly empty) valid array.
 */
export function parseCitedArticles(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const entry of raw) {
    if (out.length >= CONSTITUTION_ARTICLE_NUMBERS.length) break;
    const n = Number(entry); // deliberate coercion — see module header
    if (!Number.isFinite(n)) continue;
    const article = Math.trunc(n);
    if (!CONSTITUTION_ARTICLE_NUMBERS.includes(article)) continue;
    if (!out.includes(article)) out.push(article);
  }
  return out;
}

/**
 * Stage D vote payload. Expected shape:
 *   {"vote":"strike"|"uphold","citedArticles":[5,7]}        (challenge)
 *   {"vote":"petitioner"|"respondent","citedArticles":[7]}  (dispute)
 * Null (= abstention, not counted) on any deviation.
 */
export function parseJudicialVoteData(
  raw: unknown,
  caseType: 'constitutional_challenge' | 'agent_dispute',
): ParsedJudicialVote | null {
  if (!isPlainObject(raw)) return null;
  const voteStr = readString(raw, 'vote', 40);
  if (voteStr === null) return null;
  const v = voteStr.toLowerCase().replace(/[\s\-]+/g, '_');

  let vote: JudicialVoteChoice | null = null;
  if (caseType === 'constitutional_challenge') {
    /* Exact equality only — 'unconstitutional' CONTAINS 'constitutional',
       so substring matching here would flip votes. */
    if (v === 'strike' || v === 'strike_down' || v === 'unconstitutional') vote = 'strike';
    else if (v === 'uphold' || v === 'constitutional') vote = 'uphold';
  } else {
    if (v === 'petitioner') vote = 'petitioner';
    else if (v === 'respondent') vote = 'respondent';
  }
  if (vote === null) return null;

  return { vote, citedArticles: parseCitedArticles(raw['citedArticles']) };
}

/**
 * Stage E opinion payload: {"opinion":"...","citedArticles":[...]}.
 * Null on any deviation — the caller substitutes its deterministic
 * fallback opinion so the arc never stalls on a bad LLM response.
 */
export function parseJudicialOpinionData(raw: unknown): ParsedJudicialOpinion | null {
  if (!isPlainObject(raw)) return null;
  const opinion = readString(raw, 'opinion', 2400);
  if (opinion === null) return null;
  return { opinion, citedArticles: parseCitedArticles(raw['citedArticles']) };
}

/**
 * Stage A filing payload: {"filing":"...","questionPresented":"..."}.
 * Null on any deviation — the caller files with deterministic fallback
 * text (a rejected LLM call must not suppress a rolled filing).
 */
export function parseJudicialFilingData(raw: unknown): ParsedJudicialFiling | null {
  if (!isPlainObject(raw)) return null;
  const filing = readString(raw, 'filing', 1500);
  const questionPresented = readString(raw, 'questionPresented', 300);
  if (filing === null || questionPresented === null) return null;
  return { filing, questionPresented };
}
