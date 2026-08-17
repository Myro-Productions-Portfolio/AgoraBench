import { describe, it, expect } from 'vitest';
import { excludedOfficeHolderIds, excludeOfficeHolders, type HeldPosition } from '@core/server/lib/officeExclusivity';

const PRESIDENT = 'a0000000-0000-0000-0000-000000000001';
const JUSTICE = 'a0000000-0000-0000-0000-000000000002';
const CONGRESS_MEMBER = 'a0000000-0000-0000-0000-000000000003';
const CHAIR = 'a0000000-0000-0000-0000-000000000004';
const REGULAR = 'a0000000-0000-0000-0000-000000000005';

describe('excludedOfficeHolderIds', () => {
  it('includes agents holding an active president position', () => {
    const positions: HeldPosition[] = [{ agentId: PRESIDENT, type: 'president' }];
    expect(excludedOfficeHolderIds(positions)).toEqual(new Set([PRESIDENT]));
  });

  it('includes agents holding an active supreme_justice position', () => {
    const positions: HeldPosition[] = [{ agentId: JUSTICE, type: 'supreme_justice' }];
    expect(excludedOfficeHolderIds(positions)).toEqual(new Set([JUSTICE]));
  });

  it('excludes other position types (congress_member, committee_chair)', () => {
    const positions: HeldPosition[] = [
      { agentId: CONGRESS_MEMBER, type: 'congress_member' },
      { agentId: CHAIR, type: 'committee_chair' },
    ];
    expect(excludedOfficeHolderIds(positions).size).toBe(0);
  });

  it('handles a mixed roster, deduping repeated agent ids', () => {
    const positions: HeldPosition[] = [
      { agentId: PRESIDENT, type: 'president' },
      { agentId: PRESIDENT, type: 'president' },
      { agentId: JUSTICE, type: 'supreme_justice' },
      { agentId: CONGRESS_MEMBER, type: 'congress_member' },
    ];
    expect(excludedOfficeHolderIds(positions)).toEqual(new Set([PRESIDENT, JUSTICE]));
  });

  it('returns an empty set for an empty roster', () => {
    expect(excludedOfficeHolderIds([]).size).toBe(0);
  });
});

describe('excludeOfficeHolders', () => {
  const candidates = [{ id: PRESIDENT }, { id: JUSTICE }, { id: REGULAR }];

  it('drops every agent in excludeIds', () => {
    const filtered = excludeOfficeHolders(candidates, new Set([PRESIDENT, JUSTICE]));
    expect(filtered).toEqual([{ id: REGULAR }]);
  });

  it('is a no-op when excludeIds is empty', () => {
    expect(excludeOfficeHolders(candidates, new Set())).toEqual(candidates);
  });

  it('preserves candidate order', () => {
    const ordered = [{ id: REGULAR }, { id: PRESIDENT }, { id: CONGRESS_MEMBER }];
    expect(excludeOfficeHolders(ordered, new Set([PRESIDENT]))).toEqual([{ id: REGULAR }, { id: CONGRESS_MEMBER }]);
  });

  it('an agent set containing a president/justice never gets seated/picked (end-to-end predicate composition)', () => {
    const activePositions: HeldPosition[] = [
      { agentId: PRESIDENT, type: 'president' },
      { agentId: JUSTICE, type: 'supreme_justice' },
    ];
    const excluded = excludedOfficeHolderIds(activePositions);
    const seatable = excludeOfficeHolders(candidates, excluded);
    expect(seatable.some((c) => c.id === PRESIDENT)).toBe(false);
    expect(seatable.some((c) => c.id === JUSTICE)).toBe(false);
    expect(seatable).toEqual([{ id: REGULAR }]);
  });
});
