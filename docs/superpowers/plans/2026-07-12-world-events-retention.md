# World-Events Retention + Map Recency Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound the `world_events` table with a time-based hard-delete sweep and give the `/world` choropleth a recency window so state hotspots cool down instead of showing worst-ever severity forever.

**Architecture:** Two independent, config-gated changes per `docs/specs/world-events-retention.md`: (1) a `sweepWorldEvents()` DELETE keyed on `fetched_at`, run in the existing world-feed tick block right after `pollWorldEvents()`; (2) an `occurred_at >= now() - worldMapRecencyHours` predicate on `GET /api/world/state-summary`, with `windowHours` echoed in the payload so the page can label the window. Two new RuntimeConfig fields, no migration, no schema change, `status` column untouched (reserved for the future AGGE-curation slice).

**Tech Stack:** Node/Express/TypeScript, Drizzle ORM (Postgres), Vitest, React (AdminPage/WorldPage). No new dependencies.

## Global Constraints

- **Four-things rule (project CLAUDE.md §1):** each new RuntimeConfig field gets, in the SAME commit: interface + DEFAULTS entry in `src/core/server/runtimeConfig.ts`, a whitelist branch in `POST /admin/config` (`src/modules/admin/server/routes/admin.ts`), an AdminPage control + client-interface entry, and a persistence trace through `updateRuntimeConfig()`. Task 1 delivers all four for both fields in one commit.
- **Field clamps (copy exactly from spec §3):** `worldMapRecencyHours` — default 168, clamp 1–720. `worldEventsRetentionDays` — default 30, allowed 0 or 7–365 (0 = sweep disabled; 1–6 clamps up to 7).
- **Never write `world_events.status`** — the `pending|injected|rejected|expired` lifecycle belongs to the future AGGE curation slice (`docs/specs/exogenous-reality-feed.md`).
- **Sweep keys on `fetched_at`, never `occurred_at`** — OpenFEMA rows arrive with `occurred_at` months in the past and would churn (delete → re-insert every poll).
- **Failure isolation:** nothing in the world-feed tick block may ever throw into the tick. `sweepWorldEvents()` catches internally and returns 0, mirroring `pollWorldEvents()`.
- **No migrations, no edits to existing migrations, no new npm dependencies.**
- Comments sparse and non-obvious only (owner standing feedback). Repo commit style: `feat(world): ...` / conventional prefixes.
- Suite must stay green: `pnpm test` (525+ tests), `pnpm exec tsc --noEmit`, `pnpm run build`.
- Work on branch `feat/world-events-retention` cut from `main` (current checkout is on `fix/briefing-full-markers` — do not build on it).

---

### Task 1: Config plumbing for both fields (four-things rule, one commit)

**Files:**
- Modify: `src/core/server/runtimeConfig.ts` (interface ~line 179, DEFAULTS ~line 370)
- Modify: `src/modules/admin/server/routes/admin.ts` (world branch cluster, after the `worldEventsMinSeverity` branch ~line 470)
- Modify: `src/modules/admin/client/pages/AdminPage.tsx` (client interface ~line 193; World Events Feed card ~line 2803)

**Interfaces:**
- Consumes: existing `posInt(key, min, max)` / `num(key, min, max)` helpers in the admin config handler (clamp-into-range semantics, `admin.ts:159-168`).
- Produces: `rc.worldMapRecencyHours: number` and `rc.worldEventsRetentionDays: number` on `getRuntimeConfig()` — Tasks 2 and 3 read these exact names.

- [ ] **Step 1: Add the two fields to the server RuntimeConfig interface**

In `src/core/server/runtimeConfig.ts`, directly after the `worldEventsMinSeverity` interface line (~179):

```typescript
  worldMapRecencyHours: number;              // /world map + state-summary aggregation window (1-720h); spectator display only, independent of worldEventsRecencyHours
  worldEventsRetentionDays: number;          // hard-delete rows with fetched_at older than N days; 0 = never delete, otherwise 7-365
```

- [ ] **Step 2: Add DEFAULTS entries**

Directly after `worldEventsMinSeverity: 0.35,` (~line 370):

```typescript
  worldMapRecencyHours: 168,
  worldEventsRetentionDays: 30,
```

- [ ] **Step 3: Add the POST /admin/config whitelist branches**

In `src/modules/admin/server/routes/admin.ts`, immediately after the existing `worldEvents*` branches (the world cluster starting ~line 449):

```typescript
    const wmrh = posInt('worldMapRecencyHours', 1, 720);
    if (wmrh !== undefined) update.worldMapRecencyHours = wmrh;
    // 0 = sweep off; any positive value clamps to 7-365 so retention can never
    // undercut the 72h prompt window or USGS's 7-day re-serve window.
    if (typeof body.worldEventsRetentionDays === 'number' && !Number.isNaN(body.worldEventsRetentionDays)) {
      const v = Math.round(body.worldEventsRetentionDays);
      update.worldEventsRetentionDays = v <= 0 ? 0 : Math.max(7, Math.min(365, v));
    }
```

- [ ] **Step 4: Add the fields to the AdminPage client RuntimeConfig interface**

In `src/modules/admin/client/pages/AdminPage.tsx`, after `worldEventsMinSeverity: number;` (~line 193):

```typescript
  worldMapRecencyHours: number;
  worldEventsRetentionDays: number;
```

- [ ] **Step 5: Add the admin controls**

In the "World Events Feed" `CollapsibleSection`, insert a new bordered group between the "Per-Source Enable" grid's closing `</div>` and the "Prompt Injection (E2 slice 2)" group (~line 2803):

```tsx
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Retention &amp; Map Display</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Retention (days)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.worldEventsRetentionDays}</span>
                      </div>
                      <input type="number" min={0} max={365} step={1}
                        value={simConfig.worldEventsRetentionDays}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, worldEventsRetentionDays: parseInt(e.target.value) || 0 } : c)}
                        onBlur={() => void saveConfig({ worldEventsRetentionDays: simConfig.worldEventsRetentionDays })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Rows fetched more than this many days ago are hard-deleted each poll. 0 = never delete; 1–6 clamps up to 7.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Map Window (hours)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.worldMapRecencyHours}</span>
                      </div>
                      <input type="number" min={1} max={720} step={1}
                        value={simConfig.worldMapRecencyHours}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, worldMapRecencyHours: parseInt(e.target.value) || 1 } : c)}
                        onBlur={() => void saveConfig({ worldMapRecencyHours: simConfig.worldMapRecencyHours })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">The /world choropleth and hotspot rail only aggregate events inside this window. Display-only — independent of the agent-prompt recency window below.</p>
                    </div>
                  </div>
                </div>
```

- [ ] **Step 6: Trace persistence (four-things item 4)**

Confirm by reading the code (no runtime needed): both branches write into `update`, which flows to `updateRuntimeConfig(update)` at the end of the handler; `loadRuntimeConfig()` merges DB JSON over DEFAULTS, so missing keys resolve to 168/30.

- [ ] **Step 7: Verify types + suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean tsc; full suite passes (no behavior change yet — nothing reads the new fields).

- [ ] **Step 8: Commit**

```bash
git add src/core/server/runtimeConfig.ts src/modules/admin/server/routes/admin.ts src/modules/admin/client/pages/AdminPage.tsx
git commit -m "feat(world): worldMapRecencyHours + worldEventsRetentionDays config (four-things rule)"
```

---

### Task 2: Retention sweep (TDD)

**Files:**
- Modify: `src/modules/world/server/lib/worldFeedPoller.ts`
- Modify: `src/core/server/jobs/agentTick.ts:59` (import) and the world-feed block (~lines 6251-6261)
- Test: `tests/unit/server/worldFeedSweep.test.ts` (new)

**Interfaces:**
- Consumes: `rc.worldEventsRetentionDays` (Task 1), `worldEvents.fetchedAt` column, `getRuntimeConfig` — note `worldFeedPoller.ts` imports it with the `.js` suffix (`'@core/server/runtimeConfig.js'`); the test's `vi.mock` specifier must match exactly.
- Produces: `retentionCutoff(retentionDays: number, now: Date): Date | null` and `sweepWorldEvents(): Promise<number>` (rows deleted), both exported from `worldFeedPoller.ts`. Task 5's live verification greps the log line `swept N aged row(s)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/server/worldFeedSweep.test.ts`. Mirrors `worldEventsContext.test.ts`'s chainable-thenable db mock; lazily-read module-level `let`s avoid the `vi.mock` hoist TDZ.

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/server/worldFeedSweep.test.ts`
Expected: FAIL — `retentionCutoff` / `sweepWorldEvents` are not exported from the poller module.

- [ ] **Step 3: Implement the sweep**

In `src/modules/world/server/lib/worldFeedPoller.ts`: add `lt` to the drizzle import and append after `pollWorldEvents`:

```typescript
import { lt } from 'drizzle-orm';
```

```typescript
/** Null = sweep disabled (retention 0/invalid); otherwise the fetched_at cutoff. */
export function retentionCutoff(retentionDays: number, now: Date): Date | null {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  return new Date(now.getTime() - retentionDays * 86_400_000);
}

/**
 * Hard-delete rows fetched more than rc.worldEventsRetentionDays ago
 * (docs/specs/world-events-retention.md §1.2). Keyed on fetchedAt, not
 * occurredAt: OpenFEMA serves its 25 newest declarations regardless of age,
 * so occurredAt-keyed deletes would churn them every poll. status is never
 * written here -- that lifecycle belongs to the AGGE curation slice.
 * Never throws (same contract as pollWorldEvents).
 */
export async function sweepWorldEvents(): Promise<number> {
  const rc = getRuntimeConfig();
  const cutoff = retentionCutoff(rc.worldEventsRetentionDays, new Date());
  if (cutoff === null) return 0;
  try {
    const deleted = await db
      .delete(worldEvents)
      .where(lt(worldEvents.fetchedAt, cutoff))
      .returning({ id: worldEvents.id });
    return deleted.length;
  } catch (err) {
    console.warn('[worldFeedPoller] sweep failed:', err instanceof Error ? err.message : String(err));
    return 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/server/worldFeedSweep.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire into the tick**

In `src/core/server/jobs/agentTick.ts` line 59, extend the import:

```typescript
import { pollWorldEvents, sweepWorldEvents } from '@modules/world/server/lib/worldFeedPoller.js';
```

In the world-feed block (~6251-6257), replace the poll call + log line so the sweep runs under the same `worldFeedEnabled && tickNumber % worldFeedPollTicks === 0` gate and inside the same try/catch:

```typescript
      const { inserted, errors } = await pollWorldEvents();
      const swept = await sweepWorldEvents();
      console.warn(
        `[SIMULATION] World events: pulled ${inserted} event(s), swept ${swept} aged row(s)` +
        (errors.length > 0 ? ` (${errors.length} source error(s): ${errors.join('; ')})` : ''),
      );
```

- [ ] **Step 6: Full suite + types**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean; whole suite green.

- [ ] **Step 7: Commit**

```bash
git add src/modules/world/server/lib/worldFeedPoller.ts src/core/server/jobs/agentTick.ts tests/unit/server/worldFeedSweep.test.ts
git commit -m "feat(world): retention sweep -- hard-delete world_events past worldEventsRetentionDays"
```

---

### Task 3: Map recency window on state-summary + windowed label on /world

**Files:**
- Modify: `src/modules/world/server/routes/world.ts` (imports + `GET /world/state-summary` handler, ~lines 99-118)
- Modify: `src/modules/world/client/pages/WorldPage.tsx` (`StateSummaryResponse` ~line 40; nationwide card ~line 353)

**Interfaces:**
- Consumes: `rc.worldMapRecencyHours` (Task 1); `splitStateAggregates` (unchanged).
- Produces: `state-summary` payload becomes `{ ...splitStateAggregates(rows), windowHours: number }` — the client type marks `windowHours` optional so a stale cached bundle polling a new server (or vice versa during deploy) never breaks.

- [ ] **Step 1: Window the query and echo windowHours**

In `src/modules/world/server/routes/world.ts`, extend the drizzle import and add the config import:

```typescript
import { desc, sql, eq, and, gte } from 'drizzle-orm';
import { getRuntimeConfig } from '@core/server/runtimeConfig';
```

Replace the `state-summary` handler body (keep the surrounding comment and category-filter lines):

```typescript
    const catParam = String(req.query.category ?? 'all');
    const category = ALLOWED_CATEGORIES.has(catParam) ? catParam : 'all';
    const whereCat = category === 'all' ? sql`TRUE` : sql`category = ${category}`;
    const windowHours = getRuntimeConfig().worldMapRecencyHours;
    const since = new Date(Date.now() - windowHours * 3_600_000);
    const rows = await db
      .select({
        location: worldEvents.location,
        count: sql<number>`COUNT(*)`,
        maxSeverity: sql<number>`MAX(${worldEvents.severity})`,
        topCategory: sql<string>`MODE() WITHIN GROUP (ORDER BY ${worldEvents.category})`,
      })
      .from(worldEvents)
      .where(and(gte(worldEvents.occurredAt, since), whereCat))
      .groupBy(worldEvents.location);
    res.json({ success: true, data: { ...splitStateAggregates(rows as AggRow[]), windowHours } });
```

- [ ] **Step 2: Client type + label**

In `src/modules/world/client/pages/WorldPage.tsx`, extend the response type (~line 40):

```typescript
interface StateSummaryResponse {
  states: StateAgg[];
  coastal: StateAgg[];
  nationwide: { totalAlerts: number; statesWithAlerts: number };
  windowHours?: number;
}
```

Replace the nationwide-card caption (~line 353):

```tsx
                <p className="text-xs text-text-muted mt-1">
                  active alert{summary.nationwide.totalAlerts === 1 ? '' : 's'} across {summary.nationwide.statesWithAlerts} state{summary.nationwide.statesWithAlerts === 1 ? '' : 's'}
                  {summary.windowHours ? ` · past ${summary.windowHours >= 48 ? `${Math.round(summary.windowHours / 24)} days` : `${summary.windowHours}h`}` : ''}
                </p>
```

- [ ] **Step 3: Verify suite + types**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean; `worldStateSummary.test.ts` still green (`splitStateAggregates` untouched).

- [ ] **Step 4: Commit**

```bash
git add src/modules/world/server/routes/world.ts src/modules/world/client/pages/WorldPage.tsx
git commit -m "feat(world): recency-window the /world choropleth (worldMapRecencyHours) + windowed label"
```

---

### Task 4: Whole-branch verification + docs

**Files:**
- Modify: `docs/TODO.md` (Recently Completed entry)

- [ ] **Step 1: Full gate**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm run build`
Expected: all clean, suite fully green, client + server build.

- [ ] **Step 2: Grep the two invariants from spec §4**

Run: `git diff main -- src/modules/world/server/services/worldEventsContext.ts src/core/server/services/ai.ts`
Expected: empty — the agent-prompt channel is byte-identical.

Run: `git diff main -- src | grep -n "status"`
Expected: no line that sets or updates `world_events.status` (the only acceptable hits are pre-existing reads, e.g. the client type).

- [ ] **Step 3: TODO.md entry + commit**

Add under Recently Completed:

```markdown
- [x] 2026-07-12: **World-events retention + map recency window (spec `docs/specs/world-events-retention.md`)** — `/world` state-summary now aggregates only the last `worldMapRecencyHours` (default 168h) so hotspots cool down, payload carries `windowHours` for the map label; new `sweepWorldEvents()` hard-deletes rows with `fetched_at` older than `worldEventsRetentionDays` (default 30, 0=off) each poll tick, bounding the table at ~100 MB steady state. Keyed on fetched_at (FEMA top-25 churn accepted + documented), `status` untouched (reserved for AGGE curation). Both fields four-things complete. No migration.
```

```bash
git add docs/TODO.md docs/specs/world-events-retention.md docs/superpowers/plans/2026-07-12-world-events-retention.md
git commit -m "docs(world): retention spec + plan + TODO entry"
```

---

### Task 5: PR, deploy, live verification (spec §4)

- [ ] **Step 1: PR**

`gh auth status` first — repo remote is `Myro-Productions-Portfolio/AgoraBench`; switch with `gh auth switch --user Myro-Productions-Portfolio` if the personal account is active.

```bash
git push -u origin feat/world-events-retention
gh pr create --title "feat(world): retention sweep + map recency window" --body "Per docs/specs/world-events-retention.md — bounds world_events growth and recency-windows the /world choropleth. Two RuntimeConfig fields (four-things complete), no migration, status column untouched, agent-prompt channel byte-identical.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Merge + deploy (after owner review)**

```bash
ssh myroproductions@10.0.0.10 "cd /home/myroproductions/Projects/AgoraBench && git pull && pnpm run deploy >> /tmp/agorabench-deploy.log 2>&1 &"
```

- [ ] **Step 3: Live verify — map window**

Call `https://agorabench.com/api/world/state-summary` and cross-check one state against direct SQL with the same predicate:

```bash
ssh myroproductions@10.0.0.10 "sudo docker exec molt-gov-postgres psql -U molt_gov -d molt_government -c \"SELECT location, COUNT(*), MAX(severity) FROM world_events WHERE occurred_at >= now() - interval '168 hours' GROUP BY location ORDER BY 2 DESC LIMIT 5;\""
```

Expected: API `count`/`maxSeverity` per state match SQL; payload contains `"windowHours":168`; a state whose only events are older than 7 days is absent.

- [ ] **Step 4: Live verify — sweep fires**

Nothing is >30 days old yet (feed live since 7/05), so: set `worldEventsRetentionDays=7` in the admin panel, wait one poll tick (≤90 min), then:

```bash
ssh myroproductions@10.0.0.10 "grep 'swept' /tmp/agorabench.log | tail -3"
ssh myroproductions@10.0.0.10 "sudo docker exec molt-gov-postgres psql -U molt_gov -d molt_government -c 'SELECT MIN(fetched_at), COUNT(*) FROM world_events;'"
```

Expected: `swept N aged row(s)` with N > 0; `MIN(fetched_at)` newer than 7 days ago. Then set retention back to 30 and confirm the next tick logs `swept 0`.

- [ ] **Step 5: Live verify — off switch**

Set `worldEventsRetentionDays=0`, confirm one tick logs `swept 0 aged row(s)` and row count only grows; restore to 30.
