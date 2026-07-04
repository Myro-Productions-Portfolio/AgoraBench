import { describe, it, expect } from 'vitest';
import {
  parseCitedArticles,
  parseJudicialVoteData,
  parseJudicialOpinionData,
  parseJudicialFilingData,
} from '@core/server/lib/judicialParsing';
import { CONSTITUTION_ARTICLE_NUMBERS } from '@shared/constitution';

describe('parseCitedArticles', () => {
  it('rejects non-array input', () => {
    expect(parseCitedArticles(undefined)).toEqual([]);
    expect(parseCitedArticles(null)).toEqual([]);
    expect(parseCitedArticles('5')).toEqual([]);
    expect(parseCitedArticles(5)).toEqual([]);
    expect(parseCitedArticles({ 0: 5 })).toEqual([]);
  });

  it('returns empty array for empty array input', () => {
    expect(parseCitedArticles([])).toEqual([]);
  });

  it('accepts real numeric article numbers', () => {
    expect(parseCitedArticles([5, 7])).toEqual([5, 7]);
  });

  it('coerces numeric strings (deliberate lenient reading)', () => {
    expect(parseCitedArticles(['5', '7'])).toEqual([5, 7]);
  });

  it('drops non-existent article numbers', () => {
    expect(parseCitedArticles([999, 5, -1, 0])).toEqual([5]);
  });

  it('drops non-numeric / garbage entries silently', () => {
    expect(parseCitedArticles(['banana', null, undefined, {}, NaN])).toEqual([]);
  });

  /*
   * Not a bug in judicialParsing.ts itself, but a documented consequence of
   * the module's own header comment: "deliberate coercion" via Number().
   * Number(true) === 1 and Number([]) === 0 — since Article 1 is a real
   * article number, `true` in the raw array coerces into a valid citation.
   * Citations are decorative (never used for control flow per the header),
   * so this is low-severity, but it means a justice payload containing a
   * boolean can silently produce a real-looking citation. Documented here
   * as a regression guard, not fixed, per instructions.
   */
  it('documents Number() coercion quirk: booleans/empty-array coerce to numbers', () => {
    expect(parseCitedArticles([true])).toEqual([1]); // Number(true) === 1, Article 1 is real
    expect(parseCitedArticles([false])).toEqual([]); // Number(false) === 0, not a real article
    expect(parseCitedArticles([[]])).toEqual([]); // Number([]) === 0, not a real article
    expect(parseCitedArticles([[5]])).toEqual([5]); // Number([5]) === 5 — single-element array coerces too
  });

  it('truncates fractional article numbers toward zero', () => {
    // 5.9 truncates to 5 (a real article); 7.1 truncates to 7 (a real article)
    expect(parseCitedArticles([5.9, 7.1])).toEqual([5, 7]);
  });

  it('dedupes while preserving insertion order', () => {
    expect(parseCitedArticles([7, 5, 7, 5, 7])).toEqual([7, 5]);
  });

  it('dedupes equivalent numeric/string representations of the same article', () => {
    expect(parseCitedArticles([5, '5', 5.0])).toEqual([5]);
  });

  it('never returns more entries than exist in the constitution, even with duplicates/garbage flooding', () => {
    const flood = Array.from({ length: 500 }, (_, i) => (i % 2 === 0 ? 5 : 'junk'));
    const result = parseCitedArticles(flood);
    expect(result.length).toBeLessThanOrEqual(CONSTITUTION_ARTICLE_NUMBERS.length);
    expect(result).toEqual([5]);
  });

  it('accepts all real constitution article numbers', () => {
    expect(parseCitedArticles([...CONSTITUTION_ARTICLE_NUMBERS])).toEqual([...CONSTITUTION_ARTICLE_NUMBERS]);
  });

  it('rejects Infinity/-Infinity entries', () => {
    expect(parseCitedArticles([Infinity, -Infinity, 5])).toEqual([5]);
  });
});

describe('parseJudicialVoteData — constitutional_challenge', () => {
  const t = (raw: unknown) => parseJudicialVoteData(raw, 'constitutional_challenge');

  it('accepts "strike"', () => {
    expect(t({ vote: 'strike', citedArticles: [5] })).toEqual({ vote: 'strike', citedArticles: [5] });
  });

  it('accepts "strike_down" as an alias for strike', () => {
    expect(t({ vote: 'strike_down', citedArticles: [] })?.vote).toBe('strike');
  });

  it('accepts "unconstitutional" as an alias for strike', () => {
    expect(t({ vote: 'unconstitutional', citedArticles: [] })?.vote).toBe('strike');
  });

  it('accepts "uphold"', () => {
    expect(t({ vote: 'uphold', citedArticles: [4] })).toEqual({ vote: 'uphold', citedArticles: [4] });
  });

  it('accepts "constitutional" as an alias for uphold', () => {
    expect(t({ vote: 'constitutional', citedArticles: [] })?.vote).toBe('uphold');
  });

  it('is case-insensitive', () => {
    expect(t({ vote: 'STRIKE', citedArticles: [] })?.vote).toBe('strike');
    expect(t({ vote: 'Uphold', citedArticles: [] })?.vote).toBe('uphold');
    expect(t({ vote: 'UnConstitutional', citedArticles: [] })?.vote).toBe('strike');
  });

  it('normalizes whitespace and hyphens to underscores before matching', () => {
    expect(t({ vote: 'strike down', citedArticles: [] })?.vote).toBe('strike');
    expect(t({ vote: 'strike-down', citedArticles: [] })?.vote).toBe('strike');
    expect(t({ vote: '  strike_down  ', citedArticles: [] })?.vote).toBe('strike');
  });

  it('rejects petitioner/respondent keywords in challenge context (wrong vocabulary for case type)', () => {
    expect(t({ vote: 'petitioner', citedArticles: [] })).toBeNull();
    expect(t({ vote: 'respondent', citedArticles: [] })).toBeNull();
  });

  it('rejects garbage / missing / empty vote strings', () => {
    expect(t({ vote: '', citedArticles: [] })).toBeNull();
    expect(t({ vote: '   ', citedArticles: [] })).toBeNull();
    expect(t({ vote: 'maybe', citedArticles: [] })).toBeNull();
    expect(t({ citedArticles: [] })).toBeNull();
    expect(t({})).toBeNull();
  });

  it('rejects non-string vote fields', () => {
    expect(t({ vote: 1, citedArticles: [] })).toBeNull();
    expect(t({ vote: null, citedArticles: [] })).toBeNull();
    expect(t({ vote: ['strike'], citedArticles: [] })).toBeNull();
    expect(t({ vote: { toString: () => 'strike' }, citedArticles: [] })).toBeNull();
  });

  it('rejects non-object payloads entirely', () => {
    expect(t(undefined)).toBeNull();
    expect(t(null)).toBeNull();
    expect(t('strike')).toBeNull();
    expect(t(42)).toBeNull();
    expect(t(true)).toBeNull();
    expect(t(['strike'])).toBeNull();
  });

  it('handles multiple citations, dedupes and validates them', () => {
    expect(t({ vote: 'strike', citedArticles: [5, 7, 5, 999] })?.citedArticles).toEqual([5, 7]);
  });

  it('handles malformed citations by dropping them, not by nulling the whole vote', () => {
    expect(t({ vote: 'strike', citedArticles: 'not-an-array' })).toEqual({ vote: 'strike', citedArticles: [] });
    expect(t({ vote: 'strike', citedArticles: null })).toEqual({ vote: 'strike', citedArticles: [] });
    expect(t({ vote: 'strike' })).toEqual({ vote: 'strike', citedArticles: [] });
  });

  /*
   * BUG (documented, not fixed per task instructions): the module header
   * explicitly calls out that exact-equality matching is required because
   * 'unconstitutional' CONTAINS 'constitutional' as a substring — but the
   * matcher only guards against THAT specific collision via full-string
   * equality checks (v === 'unconstitutional' vs v === 'constitutional').
   * It does NOT reject strings that merely CONTAIN a keyword as a
   * substring, because readString/toLowerCase never strips surrounding
   * text — matching is by design exact-string (v === ...), so
   * 'i vote to strike' does NOT match 'strike' and correctly returns null
   * (ambiguous/unrecognized -> abstention). This is actually correct
   * behavior; asserting it here as a regression guard against a future
   * change that might loosen this to substring/`.includes()` matching,
   * which would reintroduce the exact collision the header warns about.
   */
  it('regression guard: does NOT substring-match — embedding a keyword in a longer sentence abstains', () => {
    expect(t({ vote: 'I vote to strike this down', citedArticles: [] })).toBeNull();
    expect(t({ vote: 'this law should be upheld', citedArticles: [] })).toBeNull();
  });

  it('ambiguous text containing both keywords as a single token still abstains (no keyword equals the full string)', () => {
    expect(t({ vote: 'strike_or_uphold', citedArticles: [] })).toBeNull();
    expect(t({ vote: 'uphold and strike', citedArticles: [] })).toBeNull();
  });

  it('truncates vote strings longer than 40 chars before comparison (still garbage, still null)', () => {
    const long = 'strike' + 'x'.repeat(100);
    expect(t({ vote: long, citedArticles: [] })).toBeNull();
  });
});

describe('parseJudicialVoteData — agent_dispute', () => {
  const t = (raw: unknown) => parseJudicialVoteData(raw, 'agent_dispute');

  it('accepts "petitioner"', () => {
    expect(t({ vote: 'petitioner', citedArticles: [7] })).toEqual({ vote: 'petitioner', citedArticles: [7] });
  });

  it('accepts "respondent"', () => {
    expect(t({ vote: 'respondent', citedArticles: [] })).toEqual({ vote: 'respondent', citedArticles: [] });
  });

  it('is case/whitespace insensitive', () => {
    expect(t({ vote: '  PETITIONER ', citedArticles: [] })?.vote).toBe('petitioner');
    expect(t({ vote: 'Respondent', citedArticles: [] })?.vote).toBe('respondent');
  });

  it('rejects strike/uphold keywords in dispute context (wrong vocabulary for case type)', () => {
    expect(t({ vote: 'strike', citedArticles: [] })).toBeNull();
    expect(t({ vote: 'uphold', citedArticles: [] })).toBeNull();
    expect(t({ vote: 'unconstitutional', citedArticles: [] })).toBeNull();
  });

  it('rejects garbage / missing / empty vote strings', () => {
    expect(t({ vote: '', citedArticles: [] })).toBeNull();
    expect(t({ vote: 'maybe', citedArticles: [] })).toBeNull();
    expect(t({})).toBeNull();
  });

  it('ambiguous text containing both dispute keywords abstains', () => {
    expect(t({ vote: 'petitioner_or_respondent', citedArticles: [] })).toBeNull();
  });
});

describe('parseJudicialOpinionData', () => {
  it('accepts a valid opinion with citations', () => {
    expect(parseJudicialOpinionData({ opinion: 'The law stands.', citedArticles: [4, 5] })).toEqual({
      opinion: 'The law stands.',
      citedArticles: [4, 5],
    });
  });

  it('trims whitespace from the opinion text', () => {
    expect(parseJudicialOpinionData({ opinion: '  padded  ', citedArticles: [] })?.opinion).toBe('padded');
  });

  it('rejects empty / whitespace-only opinion text', () => {
    expect(parseJudicialOpinionData({ opinion: '', citedArticles: [] })).toBeNull();
    expect(parseJudicialOpinionData({ opinion: '   ', citedArticles: [] })).toBeNull();
  });

  it('rejects missing opinion key or non-string opinion', () => {
    expect(parseJudicialOpinionData({ citedArticles: [] })).toBeNull();
    expect(parseJudicialOpinionData({ opinion: 123, citedArticles: [] })).toBeNull();
    expect(parseJudicialOpinionData({ opinion: null, citedArticles: [] })).toBeNull();
    expect(parseJudicialOpinionData({ opinion: ['text'], citedArticles: [] })).toBeNull();
  });

  it('caps opinion text at 2400 chars', () => {
    const long = 'x'.repeat(3000);
    const r = parseJudicialOpinionData({ opinion: long, citedArticles: [] });
    expect(r?.opinion.length).toBe(2400);
  });

  it('drops malformed citations without nulling the opinion', () => {
    expect(parseJudicialOpinionData({ opinion: 'text', citedArticles: 'nope' })).toEqual({
      opinion: 'text',
      citedArticles: [],
    });
    expect(parseJudicialOpinionData({ opinion: 'text' })).toEqual({ opinion: 'text', citedArticles: [] });
  });

  it('rejects non-object payloads', () => {
    expect(parseJudicialOpinionData(undefined)).toBeNull();
    expect(parseJudicialOpinionData(null)).toBeNull();
    expect(parseJudicialOpinionData('opinion')).toBeNull();
    expect(parseJudicialOpinionData(42)).toBeNull();
    expect(parseJudicialOpinionData(['opinion'])).toBeNull();
  });
});

describe('parseJudicialFilingData', () => {
  it('accepts a valid filing', () => {
    expect(parseJudicialFilingData({ filing: 'We petition the court.', questionPresented: 'Is X constitutional?' })).toEqual({
      filing: 'We petition the court.',
      questionPresented: 'Is X constitutional?',
    });
  });

  it('trims whitespace from both fields', () => {
    const r = parseJudicialFilingData({ filing: '  a  ', questionPresented: '  b  ' });
    expect(r).toEqual({ filing: 'a', questionPresented: 'b' });
  });

  it('rejects when either field is missing', () => {
    expect(parseJudicialFilingData({ filing: 'text' })).toBeNull();
    expect(parseJudicialFilingData({ questionPresented: 'text' })).toBeNull();
    expect(parseJudicialFilingData({})).toBeNull();
  });

  it('rejects when either field is empty/whitespace-only', () => {
    expect(parseJudicialFilingData({ filing: '', questionPresented: 'Q' })).toBeNull();
    expect(parseJudicialFilingData({ filing: 'F', questionPresented: '   ' })).toBeNull();
  });

  it('rejects non-string fields', () => {
    expect(parseJudicialFilingData({ filing: 1, questionPresented: 'Q' })).toBeNull();
    expect(parseJudicialFilingData({ filing: 'F', questionPresented: [] })).toBeNull();
  });

  it('caps filing at 1500 chars and questionPresented at 300 chars', () => {
    const r = parseJudicialFilingData({ filing: 'a'.repeat(2000), questionPresented: 'b'.repeat(500) });
    expect(r?.filing.length).toBe(1500);
    expect(r?.questionPresented.length).toBe(300);
  });

  it('rejects non-object payloads', () => {
    expect(parseJudicialFilingData(undefined)).toBeNull();
    expect(parseJudicialFilingData(null)).toBeNull();
    expect(parseJudicialFilingData('filing')).toBeNull();
    expect(parseJudicialFilingData(42)).toBeNull();
    expect(parseJudicialFilingData([{ filing: 'F', questionPresented: 'Q' }])).toBeNull();
  });

  it('never throws on hostile shapes', () => {
    expect(() => parseJudicialFilingData(Object.create(null))).not.toThrow();
    expect(() =>
      parseJudicialFilingData({ filing: { toString: () => 'F' }, questionPresented: 'Q' }),
    ).not.toThrow();
  });
});
