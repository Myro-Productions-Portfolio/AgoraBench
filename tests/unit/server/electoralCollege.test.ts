import { describe, it, expect } from 'vitest';
import { ELECTORAL_VOTES, STATE_ORDER, EC_MAJORITY } from '@core/server/lib/electoralCollege';

describe('electoralCollege seed data', () => {
  it('sums to exactly 538 electoral votes', () => {
    const total = Object.values(ELECTORAL_VOTES).reduce((a, b) => a + b, 0);
    expect(total).toBe(538);
  });

  it('has 51 jurisdictions (50 states + DC)', () => {
    expect(Object.keys(ELECTORAL_VOTES)).toHaveLength(51);
    expect(ELECTORAL_VOTES.DC).toBe(3);
  });

  it('majority threshold is 270 (a strict majority of 538)', () => {
    expect(EC_MAJORITY).toBe(270);
    expect(EC_MAJORITY * 2).toBeGreaterThan(538);
    expect((EC_MAJORITY - 1) * 2).toBeLessThanOrEqual(538);
  });

  it('every jurisdiction has at least 3 EVs (2 senators + ≥1 rep / DC floor)', () => {
    for (const ev of Object.values(ELECTORAL_VOTES)) {
      expect(ev).toBeGreaterThanOrEqual(3);
    }
  });

  it('STATE_ORDER covers every jurisdiction and is sorted', () => {
    expect([...STATE_ORDER].sort()).toEqual(Object.keys(ELECTORAL_VOTES).sort());
    expect([...STATE_ORDER]).toEqual([...STATE_ORDER].sort());
  });

  it('California has the most electoral votes (54)', () => {
    const max = Math.max(...Object.values(ELECTORAL_VOTES));
    expect(ELECTORAL_VOTES.CA).toBe(max);
    expect(ELECTORAL_VOTES.CA).toBe(54);
  });
});
