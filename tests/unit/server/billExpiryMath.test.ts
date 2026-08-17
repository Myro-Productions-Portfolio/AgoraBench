import { describe, it, expect } from 'vitest';
import { floorExpiryCutoff, selectExpiredFloorBills, type ExpiryCandidate } from '@core/server/lib/billExpiryMath';

describe('floorExpiryCutoff', () => {
  const now = new Date('2026-08-16T00:00:00Z');

  it('returns null for 0, negative, and non-finite expiryTicks (sweep disabled)', () => {
    expect(floorExpiryCutoff(0, 90 * 60_000, now)).toBeNull();
    expect(floorExpiryCutoff(-5, 90 * 60_000, now)).toBeNull();
    expect(floorExpiryCutoff(Number.NaN, 90 * 60_000, now)).toBeNull();
  });

  it('returns null for non-finite or non-positive tickIntervalMs', () => {
    expect(floorExpiryCutoff(90, 0, now)).toBeNull();
    expect(floorExpiryCutoff(90, -1, now)).toBeNull();
    expect(floorExpiryCutoff(90, Number.NaN, now)).toBeNull();
  });

  it('returns now minus expiryTicks * tickIntervalMs', () => {
    // 90 ticks * 90min ticks = 8100 min = 5.625 days
    const cutoff = floorExpiryCutoff(90, 90 * 60_000, now);
    expect(cutoff?.toISOString()).toBe('2026-08-10T09:00:00.000Z');
  });
});

describe('selectExpiredFloorBills', () => {
  const cutoff = new Date('2026-08-10T00:00:00Z');

  function bill(overrides: Partial<ExpiryCandidate>): ExpiryCandidate {
    return {
      id: 'b1',
      status: 'floor',
      lastActionAt: new Date('2026-08-01T00:00:00Z'),
      ...overrides,
    };
  }

  it('returns empty when cutoff is null (sweep disabled)', () => {
    expect(selectExpiredFloorBills([bill({})], null)).toEqual([]);
  });

  it('returns empty for non-array input', () => {
    // @ts-expect-error deliberate bad input
    expect(selectExpiredFloorBills(null, cutoff)).toEqual([]);
  });

  it('selects only floor bills older than cutoff', () => {
    const aged = bill({ id: 'aged', lastActionAt: new Date('2026-08-01T00:00:00Z') });
    const fresh = bill({ id: 'fresh', lastActionAt: new Date('2026-08-15T00:00:00Z') });
    const result = selectExpiredFloorBills([aged, fresh], cutoff);
    expect(result.map((b) => b.id)).toEqual(['aged']);
  });

  it('excludes non-floor bills even if old', () => {
    const oldCommittee = bill({ id: 'c1', status: 'committee', lastActionAt: new Date('2026-01-01T00:00:00Z') });
    const oldPassed = bill({ id: 'p1', status: 'passed', lastActionAt: new Date('2026-01-01T00:00:00Z') });
    expect(selectExpiredFloorBills([oldCommittee, oldPassed], cutoff)).toEqual([]);
  });

  it('boundary: lastActionAt exactly at cutoff is NOT expired (strict less-than)', () => {
    const atCutoff = bill({ id: 'edge', lastActionAt: new Date(cutoff.getTime()) });
    expect(selectExpiredFloorBills([atCutoff], cutoff)).toEqual([]);
  });

  it('boundary: lastActionAt 1ms before cutoff IS expired', () => {
    const justBefore = bill({ id: 'edge2', lastActionAt: new Date(cutoff.getTime() - 1) });
    expect(selectExpiredFloorBills([justBefore], cutoff).map((b) => b.id)).toEqual(['edge2']);
  });

  it('ignores malformed rows defensively', () => {
    // @ts-expect-error deliberate bad row
    expect(selectExpiredFloorBills([null, undefined], cutoff)).toEqual([]);
  });
});
