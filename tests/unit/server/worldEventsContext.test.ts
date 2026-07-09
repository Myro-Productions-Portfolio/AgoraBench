import { describe, it, expect, vi, beforeEach } from 'vitest';

/* buildWorldEventsBlock couples a DB query, runtime config, and formatting, so
   the test drives it through mocked @db/connection + @core/server/runtimeConfig
   (the repo's established vi.mock-factory pattern, see DashboardPage.test.tsx).
   The mock query builder is chainable and thenable: every method returns the
   same object, awaiting it resolves to `queryRows` — or throws `queryError`,
   exercising the never-throw path.

   The builder holds a module-level 10-min cache, so each test imports a fresh
   module instance (vi.resetModules() + dynamic import) to get a clean cache. */

let rc: Record<string, unknown>;
let queryRows: unknown[];
let queryError: Error | null;

vi.mock('@core/server/runtimeConfig', () => ({
  getRuntimeConfig: () => rc,
}));

vi.mock('@db/connection', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    if (queryError) return Promise.reject(queryError).then(resolve, reject);
    return Promise.resolve(queryRows).then(resolve, reject);
  };
  return { db: chain };
});

async function loadBuilder() {
  vi.resetModules();
  const mod = await import('@modules/world/server/services/worldEventsContext');
  return mod.buildWorldEventsBlock;
}

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    category: 'earthquake',
    severity: 0.75,
    title: 'M 6.2 - 10km SW of Somewhere',
    summary: 'M 6.2 earthquake 10km SW of Somewhere. Additional detail here.',
    location: null,
    ...over,
  };
}

beforeEach(() => {
  queryError = null;
  queryRows = [];
  rc = {
    worldEventsInjectionEnabled: true,
    worldEventsRecencyHours: 72,
    worldEventsMinSeverity: 0.35,
  };
});

describe('buildWorldEventsBlock', () => {
  it('returns empty string when the injection channel is disabled', async () => {
    rc.worldEventsInjectionEnabled = false;
    queryRows = [row()];
    const build = await loadBuilder();
    expect(await build()).toBe('');
  });

  it('returns empty string when no rows qualify', async () => {
    queryRows = [];
    const build = await loadBuilder();
    expect(await build()).toBe('');
  });

  it('formats a qualifying event with category, title, and severity tier', async () => {
    queryRows = [row({ summary: 'A tornado touched down near town. Damage reported.' })];
    const build = await loadBuilder();
    const block = await build();
    expect(block).toContain('[earthquake]');
    expect(block).toContain('M 6.2 - 10km SW of Somewhere');
    expect(block).toContain('(Severe)'); // 0.75 -> severe tier
    expect(block).toContain('A tornado touched down near town.');
    expect(block).not.toContain('Damage reported'); // firstSentence caps at the first period
  });

  it('maps a mid-range severity to the warning tier label', async () => {
    queryRows = [row({ severity: 0.6 })];
    const build = await loadBuilder();
    expect(await build()).toContain('(Warning)');
  });

  it('maps an advisory-floor severity to the advisory tier label', async () => {
    queryRows = [row({ severity: 0.4 })];
    const build = await loadBuilder();
    expect(await build()).toContain('(Advisory)');
  });

  it('renders location only for a valid state FIPS', async () => {
    queryRows = [row({ location: '06' })]; // California
    const build = await loadBuilder();
    expect(await build()).toContain('[earthquake, in 06]');
  });

  it('omits location for a non-state FIPS', async () => {
    queryRows = [row({ location: '75' })]; // territory, not a state
    const build = await loadBuilder();
    const block = await build();
    expect(block).toContain('[earthquake]');
    expect(block).not.toContain('in 75');
  });

  it('truncates the summary at the first sentence boundary', async () => {
    queryRows = [row({ summary: 'First sentence here. Second sentence should be dropped.' })];
    const build = await loadBuilder();
    const block = await build();
    expect(block).toContain('First sentence here.');
    expect(block).not.toContain('Second sentence');
  });

  it('caps the total block at MAX_CHARS (900)', async () => {
    const long = 'x'.repeat(500);
    queryRows = Array.from({ length: 6 }, (_, i) =>
      row({ title: `Event ${i} ${long}`, summary: `${long}.` }),
    );
    const build = await loadBuilder();
    expect((await build()).length).toBeLessThanOrEqual(900);
  });

  it('never throws on a DB error — returns empty string', async () => {
    queryError = new Error('connection refused');
    const build = await loadBuilder();
    await expect(build()).resolves.toBe('');
  });
});
