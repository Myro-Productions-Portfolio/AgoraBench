import { describe, it, expect, vi, beforeEach } from 'vitest';

let rc: Record<string, unknown>;
let deletedRows: unknown[];
let queryError: Error | null;
let deleteCalls: number;

vi.mock('@core/server/runtimeConfig.js', () => ({
  getRuntimeConfig: () => rc,
}));

vi.mock('@db/connection', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['insert', 'values', 'onConflictDoNothing', 'where', 'returning']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.delete = vi.fn(() => { deleteCalls++; return chain; });
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    if (queryError) return Promise.reject(queryError).then(resolve, reject);
    return Promise.resolve(deletedRows).then(resolve, reject);
  };
  return { db: chain };
});

async function loadPoller() {
  vi.resetModules();
  return import('@modules/world/server/lib/worldFeedPoller');
}

beforeEach(() => {
  rc = { worldEventsRetentionDays: 30 };
  deletedRows = [];
  queryError = null;
  deleteCalls = 0;
});

describe('retentionCutoff', () => {
  it('returns null for 0, negative, and non-finite retention (sweep disabled)', async () => {
    const { retentionCutoff } = await loadPoller();
    const now = new Date('2026-07-12T00:00:00Z');
    expect(retentionCutoff(0, now)).toBeNull();
    expect(retentionCutoff(-5, now)).toBeNull();
    expect(retentionCutoff(Number.NaN, now)).toBeNull();
  });

  it('returns now minus N days', async () => {
    const { retentionCutoff } = await loadPoller();
    const now = new Date('2026-07-12T00:00:00Z');
    expect(retentionCutoff(30, now)?.toISOString()).toBe('2026-06-12T00:00:00.000Z');
  });
});

describe('sweepWorldEvents', () => {
  it('no-ops without touching the db when retention is 0', async () => {
    rc.worldEventsRetentionDays = 0;
    const { sweepWorldEvents } = await loadPoller();
    expect(await sweepWorldEvents()).toBe(0);
    expect(deleteCalls).toBe(0);
  });

  it('deletes aged rows and returns the count', async () => {
    deletedRows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const { sweepWorldEvents } = await loadPoller();
    expect(await sweepWorldEvents()).toBe(3);
    expect(deleteCalls).toBe(1);
  });

  it('never throws: db failure logs and returns 0', async () => {
    queryError = new Error('connection refused');
    const { sweepWorldEvents } = await loadPoller();
    expect(await sweepWorldEvents()).toBe(0);
  });
});
