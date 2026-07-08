import { describe, it, expect } from 'vitest';
import { splitStateAggregates } from '@modules/world/server/routes/world';

const rows = [
  { location: '06', count: 39, maxSeverity: 0.75, topCategory: 'weather' },
  { location: '57', count: 101, maxSeverity: 0.5, topCategory: 'weather' },  // marine
  { location: null, count: 2, maxSeverity: 0.6, topCategory: 'earthquake' }, // ungeocoded
];

describe('splitStateAggregates', () => {
  it('separates paintable states from coastal/territory and computes nationwide', () => {
    const out = splitStateAggregates(rows as any);
    expect(out.states.map(s => s.fips)).toEqual(['06']);
    expect(out.coastal.map(s => s.fips)).toEqual(['57']);   // null-location rows drop from both
    expect(out.nationwide.statesWithAlerts).toBe(1);
    expect(out.nationwide.totalAlerts).toBe(39);            // states only
  });
});
