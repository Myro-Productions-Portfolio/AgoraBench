# World Weather Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/world` text-wall with a clickable US severity choropleth (map front-door, per-state text drill-down), driven by the existing NWS/USGS/FEMA `world_events` feed.

**Architecture:** Four isolated units — (1) a pure severity→color/label helper, (2) a `GET /api/world/state-summary` aggregate endpoint plus a `?state=` filter on the existing events route, (3) a build-time geometry generator that bakes `us-atlas` TopoJSON into a static SVG-paths module, (4) a `WorldPage.tsx` rewrite consuming all three. No new runtime dependencies; matches the project's "inline SVG, no chart dependency" house pattern.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Postgres), React 18, Tailwind, Vitest. Build-time geometry: `topojson-client` as a **devDependency only** (used by the generator script, never shipped).

## Global Constraints

- Branch: `feat/world-weather-map` (already checked out). PR to main, do not merge or deploy.
- Spec: `docs/specs/2026-07-07-world-weather-map-design.md` — authoritative.
- CLAUDE.md hard rules: no raw `ANY()` with JS arrays (use `inArray`); never spread `req.body`, whitelist query params; auth middleware on routers not individual routes (these routes are intentionally public, same posture as `/world/events`); migrations immutable (this slice adds NONE — no schema change).
- Severity thresholds (single source of truth, copied verbatim): `>= 0.75 → severe`; `>= 0.55 → warning`; `>= 0.35 → advisory`; `> 0 → calm`; `null → no-data`.
- Severity colors (semantic, NOT the gold accent): calm `#3E5A63`, advisory `#B99038`, warning `#C1702F`, severe `#A6382F`, no-data `#2f3136`.
- State FIPS rule: `location` length-2, numeric, ≤ 56 → paintable state; everything else → coastal/territory tray.
- Suite is 485 green at branch point; every task keeps it green. `pnpm build` clean each task.
- This slice touches ONLY human-facing rendering + read APIs. Zero changes to adapters, the poller, the `world_events` table, `services/ai.ts`, or any prompt/injection path. Grep each task's diff to confirm.

---

### Task 1: Pure severity helper

**Files:**
- Create: `src/modules/world/server/lib/worldSeverity.ts`
- Test: `tests/unit/server/worldSeverity.test.ts`

**Interfaces:**
- Produces: `type SeverityTier = 'severe'|'warning'|'advisory'|'calm'|'none'`; `severityTier(sev: number | null): SeverityTier`; `SEVERITY_COLORS: Record<SeverityTier, string>`; `SEVERITY_LABELS: Record<SeverityTier, string>`; `isStateFips(location: string | null): boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { severityTier, SEVERITY_COLORS, isStateFips } from '@world/server/lib/worldSeverity';

describe('severityTier', () => {
  it('maps boundary values to the right tier', () => {
    expect(severityTier(0.75)).toBe('severe');
    expect(severityTier(0.749)).toBe('warning');
    expect(severityTier(0.55)).toBe('warning');
    expect(severityTier(0.549)).toBe('advisory');
    expect(severityTier(0.35)).toBe('advisory');
    expect(severityTier(0.349)).toBe('calm');
    expect(severityTier(0.01)).toBe('calm');
    expect(severityTier(0)).toBe('none');
    expect(severityTier(null)).toBe('none');
  });
  it('has a color for every tier', () => {
    (['severe','warning','advisory','calm','none'] as const).forEach(t =>
      expect(SEVERITY_COLORS[t]).toMatch(/^#[0-9a-fA-F]{6}$/));
  });
});

describe('isStateFips', () => {
  it('accepts 2-digit numeric FIPS <= 56, rejects marine/territory/null', () => {
    expect(isStateFips('06')).toBe(true);   // California
    expect(isStateFips('56')).toBe(true);   // Wyoming (boundary)
    expect(isStateFips('57')).toBe(false);  // marine zone
    expect(isStateFips('75')).toBe(false);  // territory
    expect(isStateFips('6')).toBe(false);   // wrong length
    expect(isStateFips(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/server/worldSeverity.test.ts`
Expected: FAIL — module not found / exports missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
export type SeverityTier = 'severe' | 'warning' | 'advisory' | 'calm' | 'none';

export function severityTier(sev: number | null): SeverityTier {
  if (sev == null || sev <= 0) return 'none';
  if (sev >= 0.75) return 'severe';
  if (sev >= 0.55) return 'warning';
  if (sev >= 0.35) return 'advisory';
  return 'calm';
}

export const SEVERITY_COLORS: Record<SeverityTier, string> = {
  severe: '#A6382F', warning: '#C1702F', advisory: '#B99038', calm: '#3E5A63', none: '#2f3136',
};

export const SEVERITY_LABELS: Record<SeverityTier, string> = {
  severe: 'Severe', warning: 'Warning', advisory: 'Advisory', calm: 'Calm', none: 'No alerts',
};

export function isStateFips(location: string | null): boolean {
  if (!location || location.length !== 2) return false;
  const n = Number(location);
  return Number.isInteger(n) && n >= 1 && n <= 56;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/server/worldSeverity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/world/server/lib/worldSeverity.ts tests/unit/server/worldSeverity.test.ts
git commit -m "feat(world): pure severity-tier + FIPS helper for the weather map"
```

---

### Task 2: State-summary API + events `?state` filter

**Files:**
- Modify: `src/modules/world/server/routes/world.ts` (add `/world/state-summary` route; add `?state` to `/world/events`)
- Modify: `src/core/client/lib/api.ts:146` (extend `worldApi`)
- Test: `tests/unit/server/worldStateSummary.test.ts` (pure aggregation helper)

**Interfaces:**
- Consumes: `isStateFips` from Task 1.
- Produces: `GET /api/world/state-summary?category={all|weather|disaster|earthquake}` → `{ success, data: { states: Array<{fips,count,maxSeverity,topCategory}>, coastal: Array<{fips,count,maxSeverity,topCategory}>, nationwide:{totalAlerts,statesWithAlerts} } }`. Extracts pure `splitStateAggregates(rows)` so aggregation is unit-testable. `worldApi.stateSummary(category: string)` and `worldApi.events(page, limit, state?)`.

- [ ] **Step 1: Write the failing test** (pure split helper)

```typescript
import { describe, it, expect } from 'vitest';
import { splitStateAggregates } from '@world/server/routes/world';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/server/worldStateSummary.test.ts`
Expected: FAIL — `splitStateAggregates` not exported.

- [ ] **Step 3: Implement the helper + route + events filter**

In `src/modules/world/server/routes/world.ts`, add imports and the helper, then the route. Add near the top:

```typescript
import { desc, sql, eq, and } from 'drizzle-orm';
import { isStateFips } from '@world/server/lib/worldSeverity';

export interface StateAgg { fips: string; count: number; maxSeverity: number; topCategory: string; }
interface AggRow { location: string | null; count: number; maxSeverity: number; topCategory: string; }

export function splitStateAggregates(rows: AggRow[]) {
  const states: StateAgg[] = [];
  const coastal: StateAgg[] = [];
  for (const r of rows) {
    if (r.location == null) continue;
    const agg: StateAgg = { fips: r.location, count: Number(r.count), maxSeverity: Number(r.maxSeverity), topCategory: r.topCategory };
    (isStateFips(r.location) ? states : coastal).push(agg);
  }
  return {
    states, coastal,
    nationwide: {
      totalAlerts: states.reduce((a, s) => a + s.count, 0),
      statesWithAlerts: states.length,
    },
  };
}

const ALLOWED_CATEGORIES = new Set(['all', 'weather', 'disaster', 'earthquake', 'news', 'market']);
```

Add the route (before `export default router`):

```typescript
router.get('/world/state-summary', async (req, res, next) => {
  try {
    const catParam = String(req.query.category ?? 'all');
    const category = ALLOWED_CATEGORIES.has(catParam) ? catParam : 'all';
    const whereCat = category === 'all' ? sql`TRUE` : sql`category = ${category}`;
    const rows = await db
      .select({
        location: worldEvents.location,
        count: sql<number>`COUNT(*)`,
        maxSeverity: sql<number>`MAX(${worldEvents.severity})`,
        topCategory: sql<string>`MODE() WITHIN GROUP (ORDER BY ${worldEvents.category})`,
      })
      .from(worldEvents)
      .where(whereCat)
      .groupBy(worldEvents.location);
    res.json({ success: true, data: splitStateAggregates(rows as AggRow[]) });
  } catch (error) {
    next(error);
  }
});
```

Extend `/world/events` to accept `?state`: inside its handler, after computing `page`/`limit`, add a whitelisted state filter used in BOTH the rows query and the count query:

```typescript
    const stateParam = typeof req.query.state === 'string' && /^[0-9]{2}$/.test(req.query.state)
      ? req.query.state : null;
    const whereState = stateParam ? eq(worldEvents.location, stateParam) : sql`TRUE`;
```
Then add `.where(whereState)` to the rows `select` (before `.orderBy`) and change the count query to `db.select({ count: sql<number>`COUNT(*)` }).from(worldEvents).where(whereState)`.

In `src/core/client/lib/api.ts`, extend `worldApi`:

```typescript
export const worldApi = {
  events: (page: number, limit: number, state?: string) =>
    request(`/world/events?page=${page}&limit=${limit}${state ? `&state=${state}` : ''}`),
  stateSummary: (category: string) =>
    request(`/world/state-summary?category=${category}`),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/server/worldStateSummary.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify build + no prompt-path changes**

Run: `pnpm build` (expect clean) and `git diff --name-only` — confirm no `services/ai.ts`, `congressContext.ts`, or `agentTick.ts` in the diff.

- [ ] **Step 6: Commit**

```bash
git add src/modules/world/server/routes/world.ts src/core/client/lib/api.ts tests/unit/server/worldStateSummary.test.ts
git commit -m "feat(world): state-summary aggregate API + per-state events filter"
```

---

### Task 3: Build-time US state geometry generator

**Files:**
- Create: `scripts/generate-us-state-paths.ts`
- Create (committed asset): `src/modules/world/client/lib/us-states-10m.json` (the `us-atlas` file, committed for reproducibility)
- Create (generated, committed): `src/modules/world/client/lib/usStatePaths.ts`
- Modify: `package.json` (add `topojson-client` to devDependencies; add `gen:map` script)

**Interfaces:**
- Produces: `usStatePaths.ts` exporting `US_STATE_PATHS: Record<string, string>` (FIPS → SVG path `d`), `US_STATE_CENTROIDS: Record<string, [number, number]>`, `US_MAP_VIEWBOX: string`, `FIPS_TO_STATE: Record<string, { name: string; abbr: string }>`.

- [ ] **Step 1: Fetch and commit the atlas file**

```bash
curl -s https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json -o src/modules/world/client/lib/us-states-10m.json
node -e "const d=require('./src/modules/world/client/lib/us-states-10m.json'); if(d.type!=='Topology'||!d.objects.states) throw new Error('bad atlas'); console.log('atlas ok, arcs', d.arcs.length)"
pnpm add -D topojson-client
```
Expected: `atlas ok, arcs 419`.

- [ ] **Step 2: Write the generator**

`scripts/generate-us-state-paths.ts` — uses `topojson-client.feature()` + `d3-geo`'s `geoAlbersUsa` + `geoPath` to render each state to an SVG path. (Add `d3-geo` as a devDependency too: `pnpm add -D d3-geo @types/d3-geo`.) Full script:

```typescript
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { geoAlbersUsa, geoPath } from 'd3-geo';

const W = 960, H = 560;
const topo = JSON.parse(readFileSync('src/modules/world/client/lib/us-states-10m.json', 'utf8'));
const fc: any = feature(topo, topo.objects.states);
const projection = geoAlbersUsa().fitSize([W, H], fc);
const path = geoPath(projection);

const FIPS_TO_STATE: Record<string, { name: string; abbr: string }> = {
  '01':{name:'Alabama',abbr:'AL'},'02':{name:'Alaska',abbr:'AK'},'04':{name:'Arizona',abbr:'AZ'},'05':{name:'Arkansas',abbr:'AR'},'06':{name:'California',abbr:'CA'},'08':{name:'Colorado',abbr:'CO'},'09':{name:'Connecticut',abbr:'CT'},'10':{name:'Delaware',abbr:'DE'},'11':{name:'D.C.',abbr:'DC'},'12':{name:'Florida',abbr:'FL'},'13':{name:'Georgia',abbr:'GA'},'15':{name:'Hawaii',abbr:'HI'},'16':{name:'Idaho',abbr:'ID'},'17':{name:'Illinois',abbr:'IL'},'18':{name:'Indiana',abbr:'IN'},'19':{name:'Iowa',abbr:'IA'},'20':{name:'Kansas',abbr:'KS'},'21':{name:'Kentucky',abbr:'KY'},'22':{name:'Louisiana',abbr:'LA'},'23':{name:'Maine',abbr:'ME'},'24':{name:'Maryland',abbr:'MD'},'25':{name:'Massachusetts',abbr:'MA'},'26':{name:'Michigan',abbr:'MI'},'27':{name:'Minnesota',abbr:'MN'},'28':{name:'Mississippi',abbr:'MS'},'29':{name:'Missouri',abbr:'MO'},'30':{name:'Montana',abbr:'MT'},'31':{name:'Nebraska',abbr:'NE'},'32':{name:'Nevada',abbr:'NV'},'33':{name:'New Hampshire',abbr:'NH'},'34':{name:'New Jersey',abbr:'NJ'},'35':{name:'New Mexico',abbr:'NM'},'36':{name:'New York',abbr:'NY'},'37':{name:'North Carolina',abbr:'NC'},'38':{name:'North Dakota',abbr:'ND'},'39':{name:'Ohio',abbr:'OH'},'40':{name:'Oklahoma',abbr:'OK'},'41':{name:'Oregon',abbr:'OR'},'42':{name:'Pennsylvania',abbr:'PA'},'44':{name:'Rhode Island',abbr:'RI'},'45':{name:'South Carolina',abbr:'SC'},'46':{name:'South Dakota',abbr:'SD'},'47':{name:'Tennessee',abbr:'TN'},'48':{name:'Texas',abbr:'TX'},'49':{name:'Utah',abbr:'UT'},'50':{name:'Vermont',abbr:'VT'},'51':{name:'Virginia',abbr:'VA'},'53':{name:'Washington',abbr:'WA'},'54':{name:'West Virginia',abbr:'WV'},'55':{name:'Wisconsin',abbr:'WI'},'56':{name:'Wyoming',abbr:'WY'},
};

const paths: Record<string,string> = {};
const centroids: Record<string,[number,number]> = {};
for (const f of fc.features) {
  const fips = String(f.id).padStart(2,'0');
  const d = path(f);
  if (!d) continue;                       // geoAlbersUsa clips territories to null — skipped, land in tray
  paths[fips] = d;
  const c = path.centroid(f);
  centroids[fips] = [Math.round(c[0]*10)/10, Math.round(c[1]*10)/10];
}

const out = `// GENERATED by scripts/generate-us-state-paths.ts — do not edit by hand.
// Regenerate: pnpm gen:map
export const US_MAP_VIEWBOX = '0 0 ${W} ${H}';
export const US_STATE_PATHS: Record<string,string> = ${JSON.stringify(paths)};
export const US_STATE_CENTROIDS: Record<string,[number,number]> = ${JSON.stringify(centroids)};
export const FIPS_TO_STATE: Record<string,{name:string;abbr:string}> = ${JSON.stringify(FIPS_TO_STATE)};
`;
writeFileSync('src/modules/world/client/lib/usStatePaths.ts', out);
console.log('wrote usStatePaths.ts —', Object.keys(paths).length, 'states');
```

Add to `package.json` scripts: `"gen:map": "tsx scripts/generate-us-state-paths.ts"`.

- [ ] **Step 3: Run the generator**

Run: `pnpm gen:map`
Expected: `wrote usStatePaths.ts — 51 states` (50 + DC; geoAlbersUsa places AK/HI as insets automatically, territories clip to null and are excluded).

- [ ] **Step 4: Verify generated output shape**

Run: `node -e "const m=require('./src/modules/world/client/lib/usStatePaths.ts'.replace('.ts',''))" 2>/dev/null; pnpm build 2>&1 | tail -2`
Then a quick assertion: `node -e "import('./src/modules/world/client/lib/usStatePaths.js').catch(()=>0)"` is not reliable pre-build; instead grep the file: it must contain `US_STATE_PATHS`, keys `06`,`36`,`48`, and a valid `M...Z` path. Confirm `Object.keys` count is 51 from Step 3 output. `pnpm build` clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-us-state-paths.ts src/modules/world/client/lib/us-states-10m.json src/modules/world/client/lib/usStatePaths.ts package.json pnpm-lock.yaml
git commit -m "feat(world): build-time us-atlas -> inline SVG state paths generator"
```

---

### Task 4: WorldPage map rewrite

**Files:**
- Modify: `src/modules/world/client/pages/WorldPage.tsx` (full rewrite)
- Create: `src/modules/world/client/lib/severityClient.ts` (client mirror of the tiers — same thresholds/colors, no server import across the boundary)

**Interfaces:**
- Consumes: `worldApi.stateSummary`, `worldApi.events(page,limit,state)` (Task 2); `US_STATE_PATHS`, `US_STATE_CENTROIDS`, `US_MAP_VIEWBOX`, `FIPS_TO_STATE` (Task 3); severity thresholds (Task 1, mirrored client-side).

- [ ] **Step 1: Create the client severity mirror**

`src/modules/world/client/lib/severityClient.ts` — identical thresholds/colors to Task 1 (kept separate so the client bundle doesn't import server code; the shared contract is the Global Constraints table):

```typescript
export type SeverityTier = 'severe' | 'warning' | 'advisory' | 'calm' | 'none';
export function severityTier(sev: number | null): SeverityTier {
  if (sev == null || sev <= 0) return 'none';
  if (sev >= 0.75) return 'severe';
  if (sev >= 0.55) return 'warning';
  if (sev >= 0.35) return 'advisory';
  return 'calm';
}
export const SEVERITY_COLORS: Record<SeverityTier,string> = {
  severe:'#A6382F', warning:'#C1702F', advisory:'#B99038', calm:'#3E5A63', none:'#2f3136',
};
export const SEVERITY_LABELS: Record<SeverityTier,string> = {
  severe:'Severe', warning:'Warning', advisory:'Advisory', calm:'Calm', none:'No alerts',
};
```

- [ ] **Step 2: Rewrite WorldPage** — map hero + rail + coastal tray + poll refresh. Reference implementation (the approved mockup's structure ported to React with the real API + `usStatePaths`):
  - State: `summary` (from `stateSummary`), `selectedFips`, `stateEvents` (from `events?state=`), `category` filter, `loading`, `error`.
  - `useEffect` fetches `stateSummary(category)` on mount + on `category` change + on a `setInterval(…, 30000)` poll (cleared on unmount).
  - Selecting a state fetches `events(1, 25, fips)` into `stateEvents`.
  - SVG: iterate `Object.entries(US_STATE_PATHS)`, fill each via `SEVERITY_COLORS[severityTier(summary.states[fips]?.maxSeverity ?? null)]`, `onClick` selects, `.selected` class on the pinned one; overlay abbr + count `<text>` at `US_STATE_CENTROIDS[fips]`.
  - Rail: nationwide bignum (`summary.nationwide`), clickable top-6 hotspot strip (states sorted by maxSeverity then count), and the detail card (selected state name + severity tag + its `stateEvents` list with per-event severity stripes).
  - Coastal tray: `summary.coastal` rendered as a compact labeled list under the map.
  - All styling via existing Tailwind tokens (`text-stone`, `bg-surface`, `border-border`, `text-gold`, serif via existing font classes). `prefers-reduced-motion` respected (no essential motion). Keyboard: states are `<path role="button" tabIndex={0}>` with `onKeyDown` Enter/Space → select; visible focus outline.
  - Preserve the existing page's loading/error/empty states and the "read-only, not injected" explanatory copy.

  (The full component is ~220 lines; implement it following the mockup at the artifact URL in the session and the data contracts above. Keep `EventCard`-style rows for the drill-down list.)

- [ ] **Step 3: Verify in the app**

Run: `pnpm build` (clean). Start the dev server against a DB with `world_events` rows (or the prod read replica per CLAUDE.md deploy notes — read-only), load `/world`: map paints, clicking a state loads its alerts, the category filter repaints, the coastal tray lists marine FIPS, the hotspot strip is clickable. Use the `/verify` skill for this user-facing change.

- [ ] **Step 4: Run full suite**

Run: `pnpm vitest run` — expect 485 + new tests green. `pnpm build` clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/world/client/pages/WorldPage.tsx src/modules/world/client/lib/severityClient.ts
git commit -m "feat(world): US severity choropleth map replaces the /world text wall"
```

---

## Final: PR

- [ ] Update `docs/TODO.md` (log the redesign under Recently Completed) and push the branch.
- [ ] Open PR to main via `gh` (account Myro-Productions-Portfolio active), title `feat(world): weather map redesign — clickable US severity choropleth`. Body: the four units, no-new-runtime-deps, NWS-only decision, poll refresh, explicit "nothing injected / no schema change." Do NOT merge, do NOT deploy.

## Self-review notes
- Spec coverage: units A–C + severity mapping + coastal tray + live refresh + out-of-scope all mapped to Tasks 1–4. ✔
- Type consistency: `StateAgg`/`splitStateAggregates`/`severityTier`/`US_STATE_PATHS` names identical across producing and consuming tasks. ✔
- No schema migration (spec says none) — confirmed no migration task. ✔
