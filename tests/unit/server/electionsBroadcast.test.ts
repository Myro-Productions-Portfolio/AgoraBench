import { describe, it, expect } from 'vitest';
import { buildElectoralCollegeBlock } from '@modules/elections/server/routes/elections';
import { EC_MAJORITY } from '@core/server/lib/electoralCollege';

describe('buildElectoralCollegeBlock (GET /elections/:id response block)', () => {
  it('returns null when the EC columns are null (non-presidential or flag-off certification) — the route omits the key', () => {
    expect(buildElectoralCollegeBlock(null, null)).toBeNull();
    /* A stray stateResults without the summary never fabricates a block. */
    expect(buildElectoralCollegeBlock({ CA: 'agent-a' }, null)).toBeNull();
  });

  it('whitelists exactly the spec §3.1 fields — no row spread, no extras', () => {
    const block = buildElectoralCollegeBlock(
      { CA: 'agent-a', TX: 'agent-b' },
      { winnerId: 'agent-a', totalEvAllocated: 94, evByCandidate: { 'agent-a': 54, 'agent-b': 40 }, reachedMajority: false },
    );
    expect(block).not.toBeNull();
    expect(Object.keys(block!).sort()).toEqual([
      'enabled',
      'evByCandidate',
      'reachedMajority',
      'stateResults',
      'threshold',
      'totalEvAllocated',
      'winnerId',
    ]);
    expect(block!.enabled).toBe(true);
    expect(block!.threshold).toBe(EC_MAJORITY);
    expect(block!.stateResults).toEqual({ CA: 'agent-a', TX: 'agent-b' });
    expect(block!.evByCandidate).toEqual({ 'agent-a': 54, 'agent-b': 40 });
    expect(block!.totalEvAllocated).toBe(94);
    expect(block!.winnerId).toBe('agent-a');
    expect(block!.reachedMajority).toBe(false);
  });

  it('defends against partially-populated rows (null stateResults alongside a summary)', () => {
    const block = buildElectoralCollegeBlock(null, {
      winnerId: null,
      totalEvAllocated: 12,
      evByCandidate: { 'agent-a': 12 },
      reachedMajority: false,
    });
    expect(block!.stateResults).toEqual({});
    expect(block!.winnerId).toBeNull();
  });
});
