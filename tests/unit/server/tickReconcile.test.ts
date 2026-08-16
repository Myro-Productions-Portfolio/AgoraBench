import { describe, it, expect } from 'vitest';
import { staleRepeatableKeys, type RepeatableJobInfo } from '@core/server/lib/tickReconcile';

describe('staleRepeatableKeys', () => {
  it('returns nothing when no repeatables exist', () => {
    expect(staleRepeatableKeys([], 5_400_000)).toEqual([]);
  });

  it('returns nothing when the single repeatable already matches config', () => {
    const jobs: RepeatableJobInfo[] = [{ key: 'a', every: 5_400_000 }];
    expect(staleRepeatableKeys(jobs, 5_400_000)).toEqual([]);
  });

  it('flags a repeatable whose interval no longer matches config', () => {
    const jobs: RepeatableJobInfo[] = [{ key: 'stale-120000', every: 120_000 }];
    expect(staleRepeatableKeys(jobs, 5_400_000)).toEqual(['stale-120000']);
  });

  it('flags only the mismatched entries when multiple repeatables coexist', () => {
    const jobs: RepeatableJobInfo[] = [
      { key: 'stale-120000', every: 120_000 },
      { key: 'current-5400000', every: 5_400_000 },
    ];
    expect(staleRepeatableKeys(jobs, 5_400_000)).toEqual(['stale-120000']);
  });

  it('flags all entries when none match config', () => {
    const jobs: RepeatableJobInfo[] = [
      { key: 'a', every: 120_000 },
      { key: 'b', every: 60_000 },
    ];
    expect(staleRepeatableKeys(jobs, 5_400_000)).toEqual(['a', 'b']);
  });
});
