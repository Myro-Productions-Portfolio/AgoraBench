import { describe, it, expect } from 'vitest';
import {
  parseDealField,
  composeCommitment,
  commitmentPromisesYea,
} from '@core/server/lib/dealParsing';

describe('parseDealField', () => {
  it('accepts a valid yea deal', () => {
    expect(parseDealField({ deal: { myVote: 'yea' } })).toEqual({ myVote: 'yea' });
  });

  it('accepts a valid nay deal', () => {
    expect(parseDealField({ deal: { myVote: 'nay' } })).toEqual({ myVote: 'nay' });
  });

  it('normalizes case and whitespace', () => {
    expect(parseDealField({ deal: { myVote: '  YEA ' } })).toEqual({ myVote: 'yea' });
    expect(parseDealField({ deal: { myVote: 'Nay' } })).toEqual({ myVote: 'nay' });
  });

  it('rejects non-object data payloads', () => {
    expect(parseDealField(undefined)).toBeNull();
    expect(parseDealField(null)).toBeNull();
    expect(parseDealField('deal')).toBeNull();
    expect(parseDealField(42)).toBeNull();
    expect(parseDealField(true)).toBeNull();
    expect(parseDealField([{ deal: { myVote: 'yea' } }])).toBeNull();
  });

  it('rejects data without a deal key', () => {
    expect(parseDealField({})).toBeNull();
    expect(parseDealField({ desiredVote: 'yea', targetId: 'abc' })).toBeNull();
  });

  it('rejects non-object deal values', () => {
    expect(parseDealField({ deal: 'yea' })).toBeNull();
    expect(parseDealField({ deal: ['yea'] })).toBeNull();
    expect(parseDealField({ deal: 7 })).toBeNull();
    expect(parseDealField({ deal: null })).toBeNull();
  });

  it('rejects a deal missing myVote', () => {
    expect(parseDealField({ deal: {} })).toBeNull();
    expect(parseDealField({ deal: { vote: 'yea' } })).toBeNull();
  });

  it('rejects invalid vote values', () => {
    expect(parseDealField({ deal: { myVote: 'abstain' } })).toBeNull();
    expect(parseDealField({ deal: { myVote: 'yes' } })).toBeNull();
    expect(parseDealField({ deal: { myVote: '' } })).toBeNull();
    expect(parseDealField({ deal: { myVote: 1 } })).toBeNull();
    expect(parseDealField({ deal: { myVote: { nested: 'yea' } } })).toBeNull();
    expect(parseDealField({ deal: { myVote: ['yea'] } })).toBeNull();
    expect(parseDealField({ deal: { myVote: null } })).toBeNull();
  });

  it('ignores every key except deal.myVote (whitelist parsing)', () => {
    const result = parseDealField({
      deal: {
        myVote: 'yea',
        amount: 999999,
        targetId: 'attacker-controlled-id',
        billId: 'attacker-controlled-bill',
        status: 'honored',
      },
      targetId: 'other-attacker-id',
    });
    expect(result).toEqual({ myVote: 'yea' });
    expect(Object.keys(result as object)).toEqual(['myVote']);
  });

  it('handles JSON.parse-produced __proto__ keys without prototype pollution', () => {
    const data = JSON.parse('{"deal":{"myVote":"yea","__proto__":{"polluted":true}}}') as unknown;
    const result = parseDealField(data);
    expect(result).toEqual({ myVote: 'yea' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a __proto__-only deal payload', () => {
    const data = JSON.parse('{"deal":{"__proto__":{"myVote":"yea"}}}') as unknown;
    expect(parseDealField(data)).toBeNull();
    expect(({} as Record<string, unknown>).myVote).toBeUndefined();
  });

  it('never throws on hostile shapes', () => {
    expect(() => parseDealField({ deal: { myVote: Symbol('yea').toString() } })).not.toThrow();
    expect(() => parseDealField(Object.create(null))).not.toThrow();
  });
});

describe('composeCommitment', () => {
  it('composes the machine-readable vote prefix', () => {
    expect(composeCommitment('yea', 'Housing Act')).toBe('vote yea on "Housing Act"');
    expect(composeCommitment('nay', 'Housing Act')).toBe('vote nay on "Housing Act"');
  });

  it('escapes double quotes in titles', () => {
    expect(composeCommitment('yea', 'The "Big" Bill')).toBe(`vote yea on "The 'Big' Bill"`);
  });

  it('caps very long titles', () => {
    const longTitle = 'X'.repeat(500);
    const commitment = composeCommitment('yea', longTitle);
    expect(commitment.length).toBeLessThanOrEqual('vote yea on ""'.length + 150);
  });
});

describe('commitmentPromisesYea (Phase 2c honor-check parse)', () => {
  it('parses yea from a composed commitment', () => {
    expect(commitmentPromisesYea(composeCommitment('yea', 'Housing Act'))).toBe(true);
  });

  it('parses nay from a composed commitment', () => {
    expect(commitmentPromisesYea(composeCommitment('nay', 'Housing Act'))).toBe(false);
  });

  it('is not fooled by "yea" substrings in the bill title (e.g. "Year")', () => {
    /* "year".includes("yea") === true — the exact prefix match must win */
    expect(commitmentPromisesYea(composeCommitment('nay', 'Fiscal Year 2026 Budget Act'))).toBe(false);
    expect(commitmentPromisesYea(composeCommitment('yea', 'Fiscal Year 2026 Budget Act'))).toBe(true);
  });

  it('falls back to the legacy substring heuristic for non-conforming strings', () => {
    expect(commitmentPromisesYea('I will support with a yea ballot')).toBe(true);
    expect(commitmentPromisesYea('I will oppose this measure')).toBe(false);
  });

  it('is case-insensitive on the composed prefix', () => {
    expect(commitmentPromisesYea('Vote YEA on "Housing Act"')).toBe(true);
    expect(commitmentPromisesYea('  vote Nay on "Housing Act"')).toBe(false);
  });
});
