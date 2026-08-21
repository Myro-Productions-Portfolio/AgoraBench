import { describe, it, expect } from 'vitest';
import { eligibleEndorsers } from '@modules/elections/server/campaignEngine';

describe('eligibleEndorsers set math', () => {
  it('unions officeholders and party leaders, dedupes, excludes candidates and the already-decided, id-sorted', () => {
    const out = eligibleEndorsers({
      officeholderIds: ['off-1', 'off-2', 'both-1'],
      partyLeaderIds: ['lead-1', 'both-1'],
      candidateIds: new Set(['off-2']),
      decidedIds: new Set(['lead-1']),
    });
    expect(out).toEqual(['both-1', 'off-1']);
  });
  it('a candidate who is also an officeholder can never endorse in their own race', () => {
    const out = eligibleEndorsers({
      officeholderIds: ['pres'],
      partyLeaderIds: ['pres'],
      candidateIds: new Set(['pres']),
      decidedIds: new Set(),
    });
    expect(out).toEqual([]);
  });
  it('neutral markers count as decided (asked once, ever)', () => {
    const out = eligibleEndorsers({
      officeholderIds: ['a', 'b'],
      partyLeaderIds: [],
      candidateIds: new Set(),
      decidedIds: new Set(['a', 'b']),
    });
    expect(out).toEqual([]);
  });
  it('empty establishment yields an empty ask list', () => {
    expect(eligibleEndorsers({ officeholderIds: [], partyLeaderIds: [], candidateIds: new Set(), decidedIds: new Set() })).toEqual([]);
  });
});
