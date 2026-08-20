import { describe, it, expect } from 'vitest';
import { parseTenKArticle } from '@core/server/services/ai';

/* Rule-4 parse of the 10-K writer output — the pure half of
   generateTenKReport (the provider call itself is never exercised here;
   parseTenKArticle is the seam every raw response goes through). */

const okHeadline = 'Sim Government Outspends Reality Again';
const okBody = 'B'.repeat(400);

function raw(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('parseTenKArticle', () => {
  it('parses a clean JSON response', () => {
    expect(parseTenKArticle(raw({ headline: okHeadline, body: okBody }))).toEqual({
      headline: okHeadline,
      body: okBody,
    });
  });

  it('extracts the JSON object out of surrounding prose/markdown fences', () => {
    const wrapped = '```json\n' + raw({ headline: okHeadline, body: okBody }) + '\n```\nDone.';
    expect(parseTenKArticle(wrapped)).toEqual({ headline: okHeadline, body: okBody });
  });

  it('returns null when no JSON object exists', () => {
    expect(parseTenKArticle('no braces here')).toBeNull();
    expect(parseTenKArticle('')).toBeNull();
  });

  it('returns null on unrepairable JSON', () => {
    expect(parseTenKArticle('{ headline: totally, broken !!! }')).toBeNull();
  });

  it('returns null on non-object JSON and arrays', () => {
    expect(parseTenKArticle('[1, 2]')).toBeNull();
  });

  it('Rule 4: rejects missing or non-string whitelisted keys', () => {
    expect(parseTenKArticle(raw({ headline: okHeadline }))).toBeNull();
    expect(parseTenKArticle(raw({ body: okBody }))).toBeNull();
    expect(parseTenKArticle(raw({ headline: 42, body: okBody }))).toBeNull();
    expect(parseTenKArticle(raw({ headline: okHeadline, body: ['x'] }))).toBeNull();
  });

  it('Rule 4: ignores extra keys instead of reading them', () => {
    const parsed = parseTenKArticle(raw({ headline: okHeadline, body: okBody, evil: 'payload' }));
    expect(parsed).toEqual({ headline: okHeadline, body: okBody });
  });

  it('clamps headline to 200 chars (whitespace squashed) and body to 8000', () => {
    const parsed = parseTenKArticle(raw({ headline: 'H  e\n\n' + 'x'.repeat(500), body: 'y'.repeat(9000) }));
    expect(parsed).not.toBeNull();
    expect(parsed!.headline.length).toBe(200);
    expect(parsed!.headline.startsWith('H e x')).toBe(true);
    expect(parsed!.body.length).toBe(8000);
  });

  it('rejects degenerate output: headline < 5 chars or body < 50 chars', () => {
    expect(parseTenKArticle(raw({ headline: 'Hi', body: okBody }))).toBeNull();
    expect(parseTenKArticle(raw({ headline: okHeadline, body: 'short' }))).toBeNull();
  });
});
