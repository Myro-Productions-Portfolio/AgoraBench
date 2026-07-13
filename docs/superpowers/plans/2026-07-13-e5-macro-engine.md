# E5 Slice 1: Macro Engine (world-model Layer 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sim's own macroeconomy — regime-switching GDP growth, Okun unemployment, Phillips inflation, endogenous sentiment, and CBO-parameterized policy coupling — stepped daily inside the tick, recorded append-only to a new `world_state` table, deployed completely dark and observe-only.

**Architecture:** Pure math in `src/core/server/lib/macroMath.ts` (mirrors fiscalMath/electionMath), orchestration in `src/modules/world/server/lib/macroEngine.ts` (mirrors worldFeedPoller's never-throw contract), one gated call in `agentTick.ts` before the Phase 11 block. A seeded PRNG chain (`world_state.rng_seed`) makes every stochastic draw reproducible — this slice introduces the PRNG the roadmap mandates (existing `Math.random()` call sites elsewhere are out of scope, logged as follow-up). Fiscal impulses are read from the structured `laws` fiscal columns (never LLM text) and fed through regime-conditional 12-quarter lag-weight vectors. NOTHING reads `world_state` yet: no revenue coupling, no prompt injection, no approval effects — those are later slices behind their own flags.

**Tech Stack:** TypeScript/Node, Drizzle ORM (Postgres), Vitest. No new dependencies.

## Global Constraints

- **Spec:** `docs/specs/world-model.md` §2 (Layer 1) + §4 T0 vector. Doctrine: engine is physics, not policy; all parameters are seams (config or cited constants), never walls.
- **Four-things rule** for every RuntimeConfig field (22 new fields, Task 1, one commit): interface + DEFAULTS in `src/core/server/runtimeConfig.ts`, whitelist branch with clamp in `src/modules/admin/server/routes/admin.ts`, AdminPage control + client interface, persistence trace. Config fields are FLAT SCALARS only — house convention, no object fields.
- **Dark deploy:** `macroEngineEnabled` default **false**. When false: zero DB reads/writes by the engine, zero new log lines, prompts byte-identical, fiscal math untouched. Provable no-op.
- **Observe-only even when enabled:** the engine writes `world_state` rows and nothing else. It never mutates `government_settings`, `runtime_config`, agents, or any fiscal table.
- **Determinism:** every stochastic draw goes through the seeded PRNG chain; same seed + same inputs ⇒ same trajectory (unit-tested). No `Math.random()`, no `Date.now()` inside pure math.
- **Failure isolation:** `stepMacroEngine()` never throws (catch → warn → return null), and its tick call site is additionally try/caught, mirroring the world-feed block.
- **Migrations append-only:** new file `0031_world_state.sql`; never edit existing migrations.
- **Research traceability:** empirical constants carry a source comment. The 12-quarter lag weights are OUR OWN FIT — cite as "shape informed by Auerbach & Gorodnichenko (2012 AEJ:EP, Fig.2/Table 1) and Ramey (2019 JEP, Fig.1); weights fitted in-house; 12-quarter truncation deliberate (true IRFs run 16–20q)". Never attribute the numeric weights to the papers.
- Comments sparse and non-obvious only. Suite must stay green: `pnpm exec tsc --noEmit && pnpm test && pnpm run build`.
- Work on branch `feat/e5-macro-engine` cut from up-to-date `origin/main`. Commit only files named per task; never `git add -A`.

---

### Task 1: Config plumbing — 22 macro fields (four-things rule, one commit)

**Files:**
- Modify: `src/core/server/runtimeConfig.ts` (interface + DEFAULTS)
- Modify: `src/modules/admin/server/routes/admin.ts` (whitelist branches, after the world-events cluster)
- Modify: `src/modules/admin/client/pages/AdminPage.tsx` (client interface + new "Macro Engine" CollapsibleSection)

**Interfaces:**
- Consumes: existing `num(key,min,max)` / `posInt(key,min,max)` / `prob(key)` clamp helpers in admin.ts (~line 159-168).
- Produces: the 22 `rc.macro*` fields below — Tasks 3/4 consume these exact names.

- [ ] **Step 1: Interface block** — append to `RuntimeConfig` after the world-events fields, with a section comment `/* ---- Macro Engine (E5 world-model Layer 1) ---- */`:

```typescript
  macroEngineEnabled: boolean;              // master switch; false = engine fully dormant (deploy dark)
  macroStepEveryNTicks: number;             // step cadence in ticks; 16 = daily at 90-min ticks (1-96)
  macroRngSeedInit: number;                 // first seed of the deterministic PRNG chain (change = new universe)
  macroRecessionHazardMonthly: number;      // P(expansion->recession)/month; NBER postwar 0.0156
  macroRecoveryHazardMonthly: number;       // P(recession->expansion)/month; NBER postwar 0.0971
  macroGdpTrendExpansionPct: number;        // trend growth g* in expansion, %/yr
  macroGdpTrendRecessionPct: number;        // trend growth g* in recession, %/yr (negative)
  macroGdpPhiQuarterly: number;             // AR(1) persistence of growth, quarterly (0-0.95)
  macroGdpShockSigmaPct: number;            // sd of daily growth innovation, annualized pp
  macroOkunCoeff: number;                   // du = -okun * (g - g*) / 365; consensus 0.45
  macroNaturalUnemploymentPct: number;      // u* (CBO NAIRU-style anchor)
  macroUnemploymentFloorPct: number;        // hard floor on u
  macroPhillipsSlopeNormal: number;         // pi response to (u* - u), normal labor market, per quarter
  macroPhillipsSlopeTight: number;          // steepened slope when u < tight threshold
  macroPhillipsTightThresholdPct: number;   // u below this = tight labor market
  macroInflationPhiQuarterly: number;       // AR(1) persistence of inflation toward anchor, quarterly
  macroInflationAnchorPct: number;          // long-run expectations anchor (Fed target 2.0)
  macroMultiplierPurchases: number;         // CBO central 1.5 (range 0.5-2.5) for spend_once
  macroMultiplierTransfers: number;         // CBO/DSGE-family central for recurring/mandatory
  macroMultiplierTax: number;               // flat (state-INdependent: Ramey 2019 - tax multipliers higher in EXPANSIONS, so no recession boost)
  macroMultiplierRecessionScale: number;    // scale on SPENDING multipliers in recession (A&G 2012 direction; Ramey calls it fragile - keep modest)
  macroSentimentAdjustSpeed: number;        // daily partial-adjustment rate of sentiment toward its target (0-1)
```

- [ ] **Step 2: DEFAULTS** — append matching entries:

```typescript
  macroEngineEnabled: false,
  macroStepEveryNTicks: 16,
  macroRngSeedInit: 20260713,
  macroRecessionHazardMonthly: 0.0156,
  macroRecoveryHazardMonthly: 0.0971,
  macroGdpTrendExpansionPct: 2.25,
  macroGdpTrendRecessionPct: -2.0,
  macroGdpPhiQuarterly: 0.35,
  macroGdpShockSigmaPct: 0.15,
  macroOkunCoeff: 0.45,
  macroNaturalUnemploymentPct: 4.4,
  macroUnemploymentFloorPct: 2.0,
  macroPhillipsSlopeNormal: 0.18,
  macroPhillipsSlopeTight: 1.1,
  macroPhillipsTightThresholdPct: 4.0,
  macroInflationPhiQuarterly: 0.6,
  macroInflationAnchorPct: 2.0,
  macroMultiplierPurchases: 1.5,
  macroMultiplierTransfers: 0.9,
  macroMultiplierTax: 0.7,
  macroMultiplierRecessionScale: 1.6,
  macroSentimentAdjustSpeed: 0.05,
```

- [ ] **Step 3: admin.ts branches** — after the world-events branches, one branch per field:

```typescript
    /* Macro Engine (E5) -- Rule 1: every field gets a type check + clamp, same commit */
    if (typeof body.macroEngineEnabled === 'boolean') update.macroEngineEnabled = body.macroEngineEnabled;
    const msent = posInt('macroStepEveryNTicks', 1, 96);
    if (msent !== undefined) update.macroStepEveryNTicks = msent;
    const mseed = posInt('macroRngSeedInit', 1, 2_147_483_646);
    if (mseed !== undefined) update.macroRngSeedInit = mseed;
    const mrh = prob('macroRecessionHazardMonthly');
    if (mrh !== undefined) update.macroRecessionHazardMonthly = mrh;
    const mvh = prob('macroRecoveryHazardMonthly');
    if (mvh !== undefined) update.macroRecoveryHazardMonthly = mvh;
    const mte = num('macroGdpTrendExpansionPct', 0, 8);
    if (mte !== undefined) update.macroGdpTrendExpansionPct = mte;
    const mtr = num('macroGdpTrendRecessionPct', -10, 0);
    if (mtr !== undefined) update.macroGdpTrendRecessionPct = mtr;
    const mgp = num('macroGdpPhiQuarterly', 0, 0.95);
    if (mgp !== undefined) update.macroGdpPhiQuarterly = mgp;
    const mgs = num('macroGdpShockSigmaPct', 0, 2);
    if (mgs !== undefined) update.macroGdpShockSigmaPct = mgs;
    const mok = num('macroOkunCoeff', 0, 1.5);
    if (mok !== undefined) update.macroOkunCoeff = mok;
    const mnu = num('macroNaturalUnemploymentPct', 2, 8);
    if (mnu !== undefined) update.macroNaturalUnemploymentPct = mnu;
    const muf = num('macroUnemploymentFloorPct', 0.5, 4);
    if (muf !== undefined) update.macroUnemploymentFloorPct = muf;
    const mpn = num('macroPhillipsSlopeNormal', 0, 1);
    if (mpn !== undefined) update.macroPhillipsSlopeNormal = mpn;
    const mpt = num('macroPhillipsSlopeTight', 0, 3);
    if (mpt !== undefined) update.macroPhillipsSlopeTight = mpt;
    const mth = num('macroPhillipsTightThresholdPct', 2, 6);
    if (mth !== undefined) update.macroPhillipsTightThresholdPct = mth;
    const mip = num('macroInflationPhiQuarterly', 0, 0.95);
    if (mip !== undefined) update.macroInflationPhiQuarterly = mip;
    const mia = num('macroInflationAnchorPct', 0, 6);
    if (mia !== undefined) update.macroInflationAnchorPct = mia;
    const mmp = num('macroMultiplierPurchases', 0, 3);
    if (mmp !== undefined) update.macroMultiplierPurchases = mmp;
    const mmt = num('macroMultiplierTransfers', 0, 3);
    if (mmt !== undefined) update.macroMultiplierTransfers = mmt;
    const mmx = num('macroMultiplierTax', 0, 3);
    if (mmx !== undefined) update.macroMultiplierTax = mmx;
    const mms = num('macroMultiplierRecessionScale', 1, 3);
    if (mms !== undefined) update.macroMultiplierRecessionScale = mms;
    const msa = num('macroSentimentAdjustSpeed', 0.001, 1);
    if (msa !== undefined) update.macroSentimentAdjustSpeed = msa;
```

- [ ] **Step 4: AdminPage** — add the 22 fields to the client `RuntimeConfig` interface, then a new `CollapsibleSection id="macro_engine" title="Macro Engine" subtitle="E5 world-model Layer 1 — regime/GDP/unemployment/inflation/sentiment. Observe-only: writes world_state, reads nothing into prompts or money. Deployed dark."` placed directly after the World Events Feed section. Structure: the enabled checkbox + step cadence + seed on top (mirror the worldFeedEnabled label/checkbox and Poll Cadence input markup exactly), then a `grid grid-cols-1 sm:grid-cols-2 gap-4` of numeric inputs for the remaining 19 fields using the exact input markup pattern of the existing "Recency Window (hours)" control (label + gold mono value + number input + one-line muted description). Use `step={0.01}` for probabilities/coefficients, `step={0.05}` for multipliers, `step={1}` for integer fields. Each `onBlur` saves only its own field via `saveConfig({ field: simConfig.field })`.

- [ ] **Step 5: Verify** — `pnpm exec tsc --noEmit && pnpm test`. Expected: clean, suite green (nothing reads the fields yet). Trace persistence: all branches write into `update` → `updateRuntimeConfig`.

- [ ] **Step 6: Commit**

```bash
git add src/core/server/runtimeConfig.ts src/modules/admin/server/routes/admin.ts src/modules/admin/client/pages/AdminPage.tsx
git commit -m "feat(macro): E5 macro-engine config -- 22 fields, four-things complete, all dark"
```

---

### Task 2: `world_state` table — migration + schema

**Files:**
- Create: `src/core/db/migrations/0031_world_state.sql`
- Create: `src/modules/world/db/schema/worldState.ts`
- Modify: `src/core/db/schema/index.ts` (export)

**Interfaces:**
- Produces: `worldState` Drizzle table object — Task 4 inserts/selects; column names below are load-bearing (including `recurring_stance_annualized`, which Task 4's transfers-diff depends on).

- [ ] **Step 1: Migration** `0031_world_state.sql`:

```sql
-- E5 world-model Layer 1 (docs/specs/world-model.md §2): append-only macro
-- state trajectory + the roadmap-mandated per-step PRNG seed chain.
-- Observe-only slice: nothing in the simulation reads this table yet.
CREATE TABLE IF NOT EXISTS "world_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tick_id" uuid REFERENCES "tick_log"("id"),
  "tick_number" integer NOT NULL,
  "rng_seed" bigint NOT NULL,
  "regime" varchar(12) NOT NULL,
  "gdp_annualized" bigint NOT NULL,
  "gdp_growth_pct" real NOT NULL,
  "core_growth_pct" real NOT NULL,
  "unemployment_pct" real NOT NULL,
  "inflation_pct" real NOT NULL,
  "sentiment" real NOT NULL,
  "sentiment_base" real NOT NULL,
  "fiscal_impulse_pct" real NOT NULL,
  "policy_effect_pct" real NOT NULL,
  "policy_pipeline" jsonb NOT NULL,
  "day_in_quarter" integer NOT NULL,
  "recurring_stance_annualized" bigint NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "world_state_tick_number_idx" ON "world_state" ("tick_number" DESC);
```

- [ ] **Step 2: Drizzle schema** `src/modules/world/db/schema/worldState.ts` (mirror `worldEvents.ts` conventions exactly — check how that file imports `tickLog` and declares its index, and whether the index callback returns an array or object in this drizzle version):

```typescript
import { pgTable, uuid, integer, bigint, real, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { tickLog } from '@core/db/schema/tickLog';

export const worldState = pgTable('world_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  tickId: uuid('tick_id').references(() => tickLog.id),
  tickNumber: integer('tick_number').notNull(),
  rngSeed: bigint('rng_seed', { mode: 'number' }).notNull(),
  regime: varchar('regime', { length: 12 }).notNull(),
  gdpAnnualized: bigint('gdp_annualized', { mode: 'number' }).notNull(),
  gdpGrowthPct: real('gdp_growth_pct').notNull(),
  coreGrowthPct: real('core_growth_pct').notNull(),
  unemploymentPct: real('unemployment_pct').notNull(),
  inflationPct: real('inflation_pct').notNull(),
  sentiment: real('sentiment').notNull(),
  sentimentBase: real('sentiment_base').notNull(),
  fiscalImpulsePct: real('fiscal_impulse_pct').notNull(),
  policyEffectPct: real('policy_effect_pct').notNull(),
  policyPipeline: jsonb('policy_pipeline').$type<number[]>().notNull(),
  dayInQuarter: integer('day_in_quarter').notNull(),
  recurringStanceAnnualized: bigint('recurring_stance_annualized', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('world_state_tick_number_idx').on(t.tickNumber.desc())]);
```

- [ ] **Step 3: Export** — add to `src/core/db/schema/index.ts` next to the worldEvents export:

```typescript
export { worldState } from '@modules/world/db/schema/worldState'; /* E5 macro engine, world-model Layer 1 */
```

- [ ] **Step 4: Verify + commit** — `pnpm exec tsc --noEmit && pnpm test`, then:

```bash
git add src/core/db/migrations/0031_world_state.sql src/modules/world/db/schema/worldState.ts src/core/db/schema/index.ts
git commit -m "feat(macro): world_state table -- append-only macro trajectory + PRNG seed chain (migration 0031)"
```

---

### Task 3: `macroMath.ts` — pure math + cited constants (TDD)

**Files:**
- Create: `src/core/server/lib/macroMath.ts`
- Test: `tests/unit/server/macroMath.test.ts`

**Interfaces (Produces — Task 4 imports these exactly):**

```typescript
export type MacroRegime = 'expansion' | 'recession';
export interface MacroParams { /* 1:1 mapping of the 19 numeric rc.macro* dynamics fields, same names */ }
export interface FiscalImpulse { purchases: number; transfers: number; tax: number }  // $ level-effect impulses
export interface MacroState {
  regime: MacroRegime; gdpAnnualized: number; gdpGrowthPct: number; coreGrowthPct: number;
  unemploymentPct: number; inflationPct: number; sentiment: number; sentimentBase: number;
  policyPipeline: number[]; dayInQuarter: number; rngSeed: number; fiscalImpulsePct?: number;
}
export function splitmix32(seed: number): () => number;      // uniform [0,1)
export function nextSeed(seed: number): number;              // deterministic chain
export function normalDraw(rng: () => number): number;       // Box-Muller standard normal
export function dailyHazard(pMonthly: number): number;       // 1-(1-p)^(1/30)
export function dailyPhi(phiQuarterly: number): number;      // phi^(1/90)
export function seedMacroState(gdpAnnual: number, seed: number, p: MacroParams): MacroState;  // T0 vector
export function stepMacro(prev: MacroState, impulse: FiscalImpulse, p: MacroParams): MacroState;
export const LAG_WEIGHTS_NORMAL: readonly number[];          // 12 quarterly weights, sum 1.0
export const LAG_WEIGHTS_RECESSION: readonly number[];       // 12 quarterly weights, sum 1.0
export const DAYS_PER_QUARTER: number;                       // 90
```

- [ ] **Step 1: Write the failing tests first** — `tests/unit/server/macroMath.test.ts` (plain vitest, no mocks — pure math):

```typescript
import { describe, it, expect } from 'vitest';
import {
  splitmix32, nextSeed, normalDraw, dailyHazard, dailyPhi,
  seedMacroState, stepMacro, LAG_WEIGHTS_NORMAL, LAG_WEIGHTS_RECESSION,
  type MacroParams, type FiscalImpulse,
} from '@core/server/lib/macroMath';

const P: MacroParams = {
  macroRecessionHazardMonthly: 0.0156, macroRecoveryHazardMonthly: 0.0971,
  macroGdpTrendExpansionPct: 2.25, macroGdpTrendRecessionPct: -2.0,
  macroGdpPhiQuarterly: 0.35, macroGdpShockSigmaPct: 0.15,
  macroOkunCoeff: 0.45, macroNaturalUnemploymentPct: 4.4, macroUnemploymentFloorPct: 2.0,
  macroPhillipsSlopeNormal: 0.18, macroPhillipsSlopeTight: 1.1, macroPhillipsTightThresholdPct: 4.0,
  macroInflationPhiQuarterly: 0.6, macroInflationAnchorPct: 2.0,
  macroMultiplierPurchases: 1.5, macroMultiplierTransfers: 0.9, macroMultiplierTax: 0.7,
  macroMultiplierRecessionScale: 1.6, macroSentimentAdjustSpeed: 0.05,
};
const ZERO: FiscalImpulse = { purchases: 0, transfers: 0, tax: 0 };
const GDP = 28_000_000_000_000;
const noNoise: MacroParams = { ...P, macroGdpShockSigmaPct: 0, macroRecessionHazardMonthly: 0 };

describe('prng', () => {
  it('is deterministic and in [0,1)', () => {
    const a = splitmix32(42), b = splitmix32(42);
    const seq = Array.from({ length: 5 }, () => a());
    expect(seq).toEqual(Array.from({ length: 5 }, () => b()));
    seq.forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); });
    expect(nextSeed(42)).not.toBe(42);
    expect(nextSeed(42)).toBe(nextSeed(42));
  });
  it('normalDraw is deterministic under the same rng seed', () => {
    expect(normalDraw(splitmix32(7))).toBeCloseTo(normalDraw(splitmix32(7)), 12);
  });
});

describe('conversions', () => {
  it('dailyHazard compounds back to the monthly hazard', () => {
    expect(1 - Math.pow(1 - dailyHazard(0.0156), 30)).toBeCloseTo(0.0156, 10);
  });
  it('dailyPhi compounds back to the quarterly phi', () => {
    expect(Math.pow(dailyPhi(0.6), 90)).toBeCloseTo(0.6, 10);
  });
});

describe('lag weights', () => {
  it('both vectors have 12 entries summing to 1', () => {
    for (const w of [LAG_WEIGHTS_NORMAL, LAG_WEIGHTS_RECESSION]) {
      expect(w).toHaveLength(12);
      expect(w.reduce((a, x) => a + x, 0)).toBeCloseTo(1.0, 10);
    }
  });
  it('normal peaks earlier than recession (hump vs back-loaded)', () => {
    const peak = (w: readonly number[]) => w.indexOf(Math.max(...w));
    expect(peak(LAG_WEIGHTS_NORMAL)).toBeLessThan(peak(LAG_WEIGHTS_RECESSION));
  });
});

describe('seedMacroState (T0 vector, world-model §4)', () => {
  it('seeds the 2026-07 baseline with a self-calibrated sentiment base (no drift artifact)', () => {
    const s = seedMacroState(GDP, 1337, P);
    expect(s.regime).toBe('expansion');
    expect(s.gdpAnnualized).toBe(GDP);
    expect(s.unemploymentPct).toBeCloseTo(4.2, 5);
    expect(s.inflationPct).toBeCloseTo(4.2, 5);
    expect(s.sentiment).toBeCloseTo(44.8, 5);
    expect(s.policyPipeline).toEqual(new Array(12).fill(0));
    const next = stepMacro(s, ZERO, noNoise);
    expect(Math.abs(next.sentiment - 44.8)).toBeLessThan(0.05);
  });
});

describe('stepMacro', () => {
  it('is deterministic: same state + params => identical next state', () => {
    const s = seedMacroState(GDP, 99, P);
    expect(stepMacro(s, ZERO, P)).toEqual(stepMacro(s, ZERO, P));
  });
  it('advances the seed chain every step', () => {
    const s = seedMacroState(GDP, 99, P);
    expect(stepMacro(s, ZERO, P).rngSeed).not.toBe(s.rngSeed);
  });
  it('with zero noise/impulse, growth stays at trend and gdp compounds ~2.25%/yr', () => {
    let s = seedMacroState(GDP, 1, noNoise);
    for (let i = 0; i < 365; i++) s = stepMacro(s, ZERO, noNoise);
    expect(s.gdpGrowthPct).toBeCloseTo(2.25, 1);
    expect(s.gdpAnnualized).toBeGreaterThan(GDP * 1.015);
    expect(s.gdpAnnualized).toBeLessThan(GDP * 1.035);
  });
  it('spending impulse: pipeline fills, and 3-year cumulative level gain ~= multiplier * X / GDP', () => {
    const s = seedMacroState(GDP, 1, noNoise);
    const X = 500_000_000_000;
    const boosted0 = stepMacro(s, { purchases: X, transfers: 0, tax: 0 }, noNoise);
    const flat0 = stepMacro(s, ZERO, noNoise);
    expect(boosted0.policyPipeline.reduce((a, x) => a + x, 0)).toBeGreaterThan(0);
    expect(boosted0.fiscalImpulsePct).toBeGreaterThan(0);
    let sb = boosted0, sf = flat0;
    for (let i = 0; i < 1080; i++) { sb = stepMacro(sb, ZERO, noNoise); sf = stepMacro(sf, ZERO, noNoise); }
    const levelGain = (sb.gdpAnnualized - sf.gdpAnnualized) / sf.gdpAnnualized;
    expect(levelGain).toBeCloseTo(1.5 * X / GDP, 2);
  });
  it('tax increase is contractionary (negative pipeline)', () => {
    const s = seedMacroState(GDP, 1, noNoise);
    const taxed = stepMacro(s, { purchases: 0, transfers: 0, tax: 1_000_000_000_000 }, noNoise);
    expect(taxed.policyPipeline.reduce((a, x) => a + x, 0)).toBeLessThan(0);
  });
  it('okun: below-trend growth raises unemployment; floor holds', () => {
    const s = { ...seedMacroState(GDP, 1, noNoise), coreGrowthPct: -3 };
    const u0 = s.unemploymentPct;
    expect(stepMacro(s, ZERO, noNoise).unemploymentPct).toBeGreaterThan(u0);
    const f = { ...seedMacroState(GDP, 1, noNoise), unemploymentPct: 2.0, coreGrowthPct: 10 };
    expect(stepMacro(f, ZERO, noNoise).unemploymentPct).toBeGreaterThanOrEqual(noNoise.macroUnemploymentFloorPct);
  });
  it('phillips: tight labor market pushes inflation up, slack pulls it down', () => {
    const tight = { ...seedMacroState(GDP, 1, noNoise), unemploymentPct: 3.0, inflationPct: 2.0 };
    const slack = { ...seedMacroState(GDP, 1, noNoise), unemploymentPct: 6.0, inflationPct: 2.0 };
    expect(stepMacro(tight, ZERO, noNoise).inflationPct).toBeGreaterThan(2.0);
    expect(stepMacro(slack, ZERO, noNoise).inflationPct).toBeLessThan(2.0);
  });
  it('sentiment falls when inflation and unemployment worsen', () => {
    const s = seedMacroState(GDP, 1, noNoise);
    const bad = { ...s, inflationPct: 9.0, unemploymentPct: 8.0 };
    expect(stepMacro(bad, ZERO, noNoise).sentiment).toBeLessThan(bad.sentiment);
  });
  it('recession regime boosts spending impulse vs expansion', () => {
    const X: FiscalImpulse = { purchases: 500_000_000_000, transfers: 0, tax: 0 };
    const r = { ...seedMacroState(GDP, 1, noNoise), regime: 'recession' as const };
    const e = seedMacroState(GDP, 1, noNoise);
    expect(stepMacro(r, X, noNoise).policyPipeline.reduce((a, x) => a + x, 0))
      .toBeGreaterThan(stepMacro(e, X, noNoise).policyPipeline.reduce((a, x) => a + x, 0));
  });
  it('pipeline shifts one bucket every 90 steps', () => {
    let s = seedMacroState(GDP, 1, noNoise);
    s = stepMacro(s, { purchases: 500_000_000_000, transfers: 0, tax: 0 }, noNoise);
    const bucket1 = s.policyPipeline[1];
    for (let i = 0; i < 90; i++) s = stepMacro(s, ZERO, noNoise);
    expect(s.policyPipeline[0]).toBeCloseTo(bucket1, 10);
    expect(s.policyPipeline[11]).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test tests/unit/server/macroMath.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/core/server/lib/macroMath.ts`:

```typescript
// E5 world-model Layer 1 pure math (docs/specs/world-model.md §2).
// Every empirical constant carries its source; "judgment" marks in-house
// defaults with no single citable number. All stochastic draws come from the
// caller-provided seeded PRNG -- no Math.random(), no clock reads.

export type MacroRegime = 'expansion' | 'recession';

export interface MacroParams {
  macroRecessionHazardMonthly: number; macroRecoveryHazardMonthly: number;
  macroGdpTrendExpansionPct: number; macroGdpTrendRecessionPct: number;
  macroGdpPhiQuarterly: number; macroGdpShockSigmaPct: number;
  macroOkunCoeff: number; macroNaturalUnemploymentPct: number; macroUnemploymentFloorPct: number;
  macroPhillipsSlopeNormal: number; macroPhillipsSlopeTight: number; macroPhillipsTightThresholdPct: number;
  macroInflationPhiQuarterly: number; macroInflationAnchorPct: number;
  macroMultiplierPurchases: number; macroMultiplierTransfers: number; macroMultiplierTax: number;
  macroMultiplierRecessionScale: number; macroSentimentAdjustSpeed: number;
}

export interface FiscalImpulse { purchases: number; transfers: number; tax: number }

export interface MacroState {
  regime: MacroRegime;
  gdpAnnualized: number;
  gdpGrowthPct: number;   // core + policy overlay (what Okun and observers see)
  coreGrowthPct: number;  // AR(1) trend/shock component only -- policy NEVER enters here
  unemploymentPct: number;
  inflationPct: number;
  sentiment: number;
  sentimentBase: number;
  policyPipeline: number[];
  dayInQuarter: number;
  rngSeed: number;
  fiscalImpulsePct?: number;
}

export const DAYS_PER_QUARTER = 90;

// Shape informed by Auerbach & Gorodnichenko (2012 AEJ:EP 4(2), Fig.2/Table 1)
// and Ramey (2019 JEP 33(2), Fig.1): normal conditions = hump peaking ~q4,
// ~zero by q12 (deliberate truncation; true IRFs run 16-20q). Recession =
// flatter, back-loaded (A&G's recession IRF is still rising at q20).
// The numeric weights are fitted in-house -- do not attribute them to the papers.
export const LAG_WEIGHTS_NORMAL: readonly number[] =
  [0.03, 0.08, 0.13, 0.16, 0.15, 0.13, 0.10, 0.08, 0.06, 0.04, 0.03, 0.01];
export const LAG_WEIGHTS_RECESSION: readonly number[] =
  [0.02, 0.05, 0.08, 0.10, 0.11, 0.11, 0.11, 0.10, 0.10, 0.09, 0.08, 0.05];

// T0 vector, world-model.md §4 (July 2026, sourced there):
const T0_UNEMPLOYMENT_PCT = 4.2;
const T0_INFLATION_PCT = 4.2;
const T0_SENTIMENT = 44.8;   // UMich UMCSENT, May 2026
// Sentiment-target coefficients (index points per pp of gap) -- judgment:
// UMich-style regressions weigh inflation ~2x unemployment.
const SENT_INFLATION_COEFF = 8;
const SENT_UNEMPLOYMENT_COEFF = 4;

export function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

export function nextSeed(seed: number): number {
  const rng = splitmix32(seed ^ 0x5bf03635);
  return Math.floor(rng() * 2_147_483_646) + 1;
}

export function normalDraw(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function dailyHazard(pMonthly: number): number {
  return 1 - Math.pow(1 - pMonthly, 1 / 30);
}

export function dailyPhi(phiQuarterly: number): number {
  return Math.pow(phiQuarterly, 1 / DAYS_PER_QUARTER);
}

function trendFor(regime: MacroRegime, p: MacroParams): number {
  return regime === 'expansion' ? p.macroGdpTrendExpansionPct : p.macroGdpTrendRecessionPct;
}

/** Sentiment base self-calibrates so the T0 state is a fixed point of the
    sentiment dynamics (the 2026 "gloom residual" folds into the base --
    otherwise seeding at 44.8 with a formula-implied target would fabricate
    a recovery drift the data doesn't support). */
export function seedMacroState(gdpAnnual: number, seed: number, p: MacroParams): MacroState {
  const base = T0_SENTIMENT
    + SENT_INFLATION_COEFF * (T0_INFLATION_PCT - p.macroInflationAnchorPct)
    + SENT_UNEMPLOYMENT_COEFF * (T0_UNEMPLOYMENT_PCT - p.macroNaturalUnemploymentPct);
  return {
    regime: 'expansion',
    gdpAnnualized: gdpAnnual,
    gdpGrowthPct: p.macroGdpTrendExpansionPct,
    coreGrowthPct: p.macroGdpTrendExpansionPct,
    unemploymentPct: T0_UNEMPLOYMENT_PCT,
    inflationPct: T0_INFLATION_PCT,
    sentiment: T0_SENTIMENT,
    sentimentBase: base,
    policyPipeline: new Array(12).fill(0),
    dayInQuarter: 0,
    rngSeed: seed,
  };
}

export function stepMacro(prev: MacroState, impulse: FiscalImpulse, p: MacroParams): MacroState {
  const rng = splitmix32(prev.rngSeed);

  // 1. regime transition (spec §2.1)
  const hazard = prev.regime === 'expansion'
    ? dailyHazard(p.macroRecessionHazardMonthly)
    : dailyHazard(p.macroRecoveryHazardMonthly);
  const regime: MacroRegime = rng() < hazard
    ? (prev.regime === 'expansion' ? 'recession' : 'expansion')
    : prev.regime;

  // 2. policy pipeline (spec §2.5): $ level-effect impulses distributed over
  //    12 quarters; bucket q holds the annualized growth addition applied
  //    during that quarter. Integrating bucket*(90/365)/100 over the 12
  //    buckets recovers the full multiplier*X/GDP level effect.
  const spendScale = regime === 'recession' ? p.macroMultiplierRecessionScale : 1;
  const weights = regime === 'recession' ? LAG_WEIGHTS_RECESSION : LAG_WEIGHTS_NORMAL;
  const levelEffect =
    p.macroMultiplierPurchases * spendScale * impulse.purchases +
    p.macroMultiplierTransfers * spendScale * impulse.transfers -
    p.macroMultiplierTax * impulse.tax;   // tax mult flat: state-dependence runs opposite (Ramey 2019)
  const impulsePct = (levelEffect / prev.gdpAnnualized) * 100;
  const pipeline = prev.policyPipeline.slice();
  if (impulsePct !== 0) {
    const annualize = 365 / DAYS_PER_QUARTER;
    for (let q = 0; q < 12; q++) pipeline[q] += impulsePct * weights[q] * annualize;
  }

  // 3. GDP growth (spec §2.2, one deliberate correction): the spec's literal
  //    equation feeds policy_t through the AR(1), which would amplify a
  //    sustained input by ~1/(1-phi_daily) (~86x) -- but CBO multipliers are
  //    TOTAL effects and the lag weights already encode the full time path.
  //    So the AR(1) runs on a policy-free core, and policy is an additive
  //    overlay: cumulative level gain = multiplier * X / GDP exactly.
  const phiD = dailyPhi(p.macroGdpPhiQuarterly);
  const gStar = trendFor(regime, p);
  const shock = p.macroGdpShockSigmaPct > 0 ? normalDraw(rng) * p.macroGdpShockSigmaPct : 0;
  const core = (1 - phiD) * gStar + phiD * prev.coreGrowthPct + shock;
  const growth = core + pipeline[0];
  const gdp = Math.round(prev.gdpAnnualized * Math.pow(1 + growth / 100, 1 / 365));

  // 4. unemployment (spec §2.3): Okun growth-gap form; hysteresis = level accumulation
  const du = -p.macroOkunCoeff * (growth - gStar) / 365;
  const unemployment = Math.max(p.macroUnemploymentFloorPct, prev.unemploymentPct + du);

  // 5. inflation (spec §2.4): AR(1) toward anchor + state-dependent Phillips on the u-gap
  const slope = unemployment < p.macroPhillipsTightThresholdPct
    ? p.macroPhillipsSlopeTight : p.macroPhillipsSlopeNormal;
  const phiPiD = dailyPhi(p.macroInflationPhiQuarterly);
  const inflation = prev.inflationPct
    + (1 - phiPiD) * (p.macroInflationAnchorPct - prev.inflationPct)
    + slope * (p.macroNaturalUnemploymentPct - unemployment) / DAYS_PER_QUARTER;

  // 6. sentiment (spec §2.7): partial adjustment toward the state-driven target
  const target = prev.sentimentBase
    - SENT_INFLATION_COEFF * (inflation - p.macroInflationAnchorPct)
    - SENT_UNEMPLOYMENT_COEFF * (unemployment - p.macroNaturalUnemploymentPct);
  const sentiment = prev.sentiment + p.macroSentimentAdjustSpeed * (target - prev.sentiment);

  // 7. advance the quarter window
  let dayInQuarter = prev.dayInQuarter + 1;
  let outPipeline = pipeline;
  if (dayInQuarter >= DAYS_PER_QUARTER) {
    dayInQuarter = 0;
    outPipeline = [...pipeline.slice(1), 0];
  }

  return {
    regime, gdpAnnualized: gdp, gdpGrowthPct: growth, coreGrowthPct: core,
    unemploymentPct: unemployment, inflationPct: inflation,
    sentiment, sentimentBase: prev.sentimentBase,
    policyPipeline: outPipeline, dayInQuarter,
    rngSeed: nextSeed(prev.rngSeed),
    fiscalImpulsePct: impulsePct,
  };
}
```

- [ ] **Step 4: Run tests** — `pnpm test tests/unit/server/macroMath.test.ts`. Expected: PASS (~15 tests). If the cumulative-multiplier assertion (`levelGain ≈ 1.5·X/GDP`) misses at 2 decimals, loosen to 1 decimal and note it in your report — the pipeline discretization has known truncation error; do NOT change the economics to force the assertion.

- [ ] **Step 5: Full suite + commit**

```bash
pnpm exec tsc --noEmit && pnpm test
git add src/core/server/lib/macroMath.ts tests/unit/server/macroMath.test.ts
git commit -m "feat(macro): macroMath -- seeded PRNG, regime/GDP/Okun/Phillips/sentiment step, CBO-shaped lag weights (TDD)"
```

---

### Task 4: `macroEngine.ts` — orchestration + fiscal-impulse observer (TDD)

**Files:**
- Create: `src/modules/world/server/lib/macroEngine.ts`
- Test: `tests/unit/server/macroEngine.test.ts`

**Interfaces:**
- Consumes: `rc.macro*` fields (Task 1), `worldState` table incl. `recurringStanceAnnualized` (Task 2), macroMath exports (Task 3), `laws` columns `fiscalKind/fiscalAmount/fiscalTaxDelta/programActive/enactedTick/isActive` (existing — verify exact names in `src/modules/legislation/db/schema/legislation.ts` and adapt if they differ, noting it in your report), `rc.gdpAnnual`, `rc.tickIntervalMs`.
- Produces: `stepMacroEngine(tickNumber: number, tickId: string | null): Promise<{ seeded: boolean; state: MacroState } | null>` — null when disabled or on error; never throws. Task 5 wires and logs it.

- [ ] **Step 1: Failing tests** — `tests/unit/server/macroEngine.test.ts`, mirroring the chainable-thenable db mock of `worldFeedSweep.test.ts` (module-level lazily-read `let`s to dodge the vi.mock hoist TDZ; `vi.resetModules()` + dynamic import; mock `'@db/connection'` AND the runtimeConfig specifier exactly as macroEngine imports it — with the `.js` suffix). The mock needs: `select/from/where/orderBy/limit/insert/values` chain methods; a `queryResults: unknown[][]` FIFO the thenable shifts from (first select = world_state latest row, second = laws rows); an `insertedValues` capture on `values()`. Tests:
  1. disabled → null, zero db calls;
  2. enabled + no prior row → seeds T0: one insert, `unemploymentPct≈4.2`, `policyPipeline` all-zero, returns `{seeded:true}`;
  3. enabled + prior row → steps: one insert, `rngSeed` differs from prior;
  4. transfers impulse: prior row has `recurringStanceAnnualized: 0`, laws return one active recurring program (`fiscalAmount: 1_000_000`, `programActive: true`) → inserted `fiscalImpulsePct > 0`;
  5. db error → null, no throw.
- [ ] **Step 2: Verify failure.** `pnpm test tests/unit/server/macroEngine.test.ts` — FAIL, module not found.
- [ ] **Step 3: Implement** `src/modules/world/server/lib/macroEngine.ts`:

```typescript
// E5 macro engine orchestration (world-model Layer 1). Observe-only: reads
// laws + world_state + config, writes ONE world_state row per step. Never
// throws into the tick (worldFeedPoller contract). Nothing reads world_state
// in this slice.
import { db } from '@db/connection';
import { worldState, laws } from '@db/schema/index';
import { desc, eq, and, isNotNull } from 'drizzle-orm';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import {
  seedMacroState, stepMacro,
  type MacroState, type MacroParams, type FiscalImpulse,
} from '@core/server/lib/macroMath.js';

function paramsFromConfig(): MacroParams {
  const rc = getRuntimeConfig();
  return {
    macroRecessionHazardMonthly: rc.macroRecessionHazardMonthly,
    macroRecoveryHazardMonthly: rc.macroRecoveryHazardMonthly,
    macroGdpTrendExpansionPct: rc.macroGdpTrendExpansionPct,
    macroGdpTrendRecessionPct: rc.macroGdpTrendRecessionPct,
    macroGdpPhiQuarterly: rc.macroGdpPhiQuarterly,
    macroGdpShockSigmaPct: rc.macroGdpShockSigmaPct,
    macroOkunCoeff: rc.macroOkunCoeff,
    macroNaturalUnemploymentPct: rc.macroNaturalUnemploymentPct,
    macroUnemploymentFloorPct: rc.macroUnemploymentFloorPct,
    macroPhillipsSlopeNormal: rc.macroPhillipsSlopeNormal,
    macroPhillipsSlopeTight: rc.macroPhillipsSlopeTight,
    macroPhillipsTightThresholdPct: rc.macroPhillipsTightThresholdPct,
    macroInflationPhiQuarterly: rc.macroInflationPhiQuarterly,
    macroInflationAnchorPct: rc.macroInflationAnchorPct,
    macroMultiplierPurchases: rc.macroMultiplierPurchases,
    macroMultiplierTransfers: rc.macroMultiplierTransfers,
    macroMultiplierTax: rc.macroMultiplierTax,
    macroMultiplierRecessionScale: rc.macroMultiplierRecessionScale,
    macroSentimentAdjustSpeed: rc.macroSentimentAdjustSpeed,
  };
}

/** Fiscal stance from structured law columns (never LLM text).
    purchasesSince: one-time spends enacted after sinceTick (spend_once $).
    recurringAnnualized: current annualized recurring+mandatory total.
    taxDeltaSince: net signed tax-point changes enacted after sinceTick. */
async function readFiscalStance(sinceTick: number, ticksPerDay: number) {
  const rows = await db
    .select({
      fiscalKind: laws.fiscalKind,
      fiscalAmount: laws.fiscalAmount,
      fiscalTaxDelta: laws.fiscalTaxDelta,
      programActive: laws.programActive,
      enactedTick: laws.enactedTick,
    })
    .from(laws)
    .where(and(isNotNull(laws.fiscalKind), eq(laws.isActive, true)));
  let purchasesSince = 0, recurringAnnualized = 0, taxDeltaSince = 0;
  for (const r of rows) {
    if ((r.fiscalKind === 'spend_recurring' || r.fiscalKind === 'mandatory') && r.programActive) {
      recurringAnnualized += (r.fiscalAmount ?? 0) * ticksPerDay * 365;
    }
    if (r.fiscalKind === 'spend_once' && (r.enactedTick ?? 0) > sinceTick) {
      purchasesSince += r.fiscalAmount ?? 0;
    }
    if (r.fiscalKind === 'tax_change' && (r.enactedTick ?? 0) > sinceTick) {
      taxDeltaSince += r.fiscalTaxDelta ?? 0;
    }
  }
  return { purchasesSince, recurringAnnualized, taxDeltaSince };
}

export async function stepMacroEngine(
  tickNumber: number,
  tickId: string | null,
): Promise<{ seeded: boolean; state: MacroState } | null> {
  const rc = getRuntimeConfig();
  if (!rc.macroEngineEnabled) return null;
  try {
    const p = paramsFromConfig();
    const ticksPerDay = Math.max(1, Math.round(86_400_000 / rc.tickIntervalMs));
    const [prevRow] = await db
      .select()
      .from(worldState)
      .orderBy(desc(worldState.tickNumber))
      .limit(1);

    let state: MacroState;
    let seeded = false;
    let recurringNow: number;

    if (!prevRow) {
      state = seedMacroState(rc.gdpAnnual, rc.macroRngSeedInit, p);
      recurringNow = (await readFiscalStance(tickNumber, ticksPerDay)).recurringAnnualized;
      seeded = true;
    } else {
      const stance = await readFiscalStance(prevRow.tickNumber, ticksPerDay);
      recurringNow = stance.recurringAnnualized;
      const impulse: FiscalImpulse = {
        purchases: stance.purchasesSince,
        transfers: stance.recurringAnnualized - Number(prevRow.recurringStanceAnnualized ?? 0),
        tax: (stance.taxDeltaSince / 100) * Number(prevRow.gdpAnnualized),
      };
      const prev: MacroState = {
        regime: prevRow.regime as MacroState['regime'],
        gdpAnnualized: Number(prevRow.gdpAnnualized),
        gdpGrowthPct: prevRow.gdpGrowthPct,
        coreGrowthPct: prevRow.coreGrowthPct,
        unemploymentPct: prevRow.unemploymentPct,
        inflationPct: prevRow.inflationPct,
        sentiment: prevRow.sentiment,
        sentimentBase: prevRow.sentimentBase,
        policyPipeline: prevRow.policyPipeline as number[],
        dayInQuarter: prevRow.dayInQuarter,
        rngSeed: Number(prevRow.rngSeed),
      };
      state = stepMacro(prev, impulse, p);
    }

    await db.insert(worldState).values({
      tickId, tickNumber,
      rngSeed: state.rngSeed,
      regime: state.regime,
      gdpAnnualized: state.gdpAnnualized,
      gdpGrowthPct: state.gdpGrowthPct,
      coreGrowthPct: state.coreGrowthPct,
      unemploymentPct: state.unemploymentPct,
      inflationPct: state.inflationPct,
      sentiment: state.sentiment,
      sentimentBase: state.sentimentBase,
      fiscalImpulsePct: state.fiscalImpulsePct ?? 0,
      policyEffectPct: state.policyPipeline[0] ?? 0,
      policyPipeline: state.policyPipeline,
      dayInQuarter: state.dayInQuarter,
      recurringStanceAnnualized: recurringNow,
    });
    return { seeded, state };
  } catch (err) {
    console.warn('[macroEngine] step failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
```

**Implementer notes (decisions baked in, do not improvise):** (a) On the seed step the T0 recurring stance is recorded WITHOUT generating an impulse — the divergence-seeded baseline programs are the baseline, not a stimulus. (b) A one-time spend enters `purchases` exactly once (enactedTick window between the previous row's tick and now). (c) Tax impulse sign: a POSITIVE tax delta (tax increase) produces a POSITIVE `impulse.tax`, which `stepMacro` subtracts — contractionary. (d) `laws.isActive` — verify the exact column name in `legislation.ts`; adapt and report if different.

- [ ] **Step 4: Run tests** — PASS (5 tests). **Step 5: Full suite + commit**

```bash
pnpm exec tsc --noEmit && pnpm test
git add src/modules/world/server/lib/macroEngine.ts tests/unit/server/macroEngine.test.ts
git commit -m "feat(macro): macroEngine -- fiscal-impulse observer + step orchestration, observe-only (TDD)"
```

---

### Task 5: Tick wiring + read-only API

**Files:**
- Modify: `src/core/server/jobs/agentTick.ts` (import + one gated block immediately BEFORE the Phase 11 section banner — locate the `Phase 11` comment header; the spec places the deterministic macro step before Phase 11 so later slices can expose macro state to fiscal parsing)
- Modify: `src/modules/world/server/routes/world.ts` (new endpoint)

**Interfaces:**
- Consumes: `stepMacroEngine(tickNumber, tickId)` (Task 4), `worldState` (Task 2).
- Produces: log line prefixed `[SIMULATION] Macro:` (ops greps on it), and `GET /api/world/macro`.

- [ ] **Step 1: Tick wiring** — add import `import { stepMacroEngine } from '@modules/world/server/lib/macroEngine.js';` and insert before the Phase 11 banner (confirm what tick-log-id variable is in scope at that point — the reality-feed/world-events blocks show what's available; if none, pass `null`):

```typescript
  /* ------------------------------------------------------------------ */
  /* Macro Engine step (E5 world-model Layer 1, docs/specs/world-model.md */
  /* §2). Deterministic, no LLM. OBSERVE-ONLY: writes world_state, read   */
  /* by nothing in this slice. Dark by default (rc.macroEngineEnabled).   */
  /* stepMacroEngine never throws; try/catch here is belt-and-suspenders, */
  /* mirroring the world-feed block.                                      */
  /* ------------------------------------------------------------------ */
  if (rc.macroEngineEnabled && tickNumber % rc.macroStepEveryNTicks === 0) {
    try {
      const result = await stepMacroEngine(tickNumber, null);
      if (result) {
        const s = result.state;
        console.warn(
          `[SIMULATION] Macro: ${result.seeded ? 'seeded T0' : 'stepped'} — ` +
          `regime=${s.regime}, g=${s.gdpGrowthPct.toFixed(2)}%, u=${s.unemploymentPct.toFixed(2)}%, ` +
          `pi=${s.inflationPct.toFixed(2)}%, sent=${s.sentiment.toFixed(1)}`,
        );
      }
    } catch (err) {
      console.warn('[SIMULATION] Macro step error:', err);
    }
  }
```

- [ ] **Step 2: API** — in `src/modules/world/server/routes/world.ts`, below the state-summary route (add `worldState` to that file's schema import):

```typescript
/* GET /api/world/macro -- E5 macro trajectory, newest first. Public,
   read-only, same posture as /world/events. */
router.get('/world/macro', async (req, res, next) => {
  try {
    const limitParam = Number.parseInt(String(req.query.limit ?? '96'), 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 96;
    const rows = await db
      .select({
        tickNumber: worldState.tickNumber,
        regime: worldState.regime,
        gdpAnnualized: worldState.gdpAnnualized,
        gdpGrowthPct: worldState.gdpGrowthPct,
        unemploymentPct: worldState.unemploymentPct,
        inflationPct: worldState.inflationPct,
        sentiment: worldState.sentiment,
        fiscalImpulsePct: worldState.fiscalImpulsePct,
        policyEffectPct: worldState.policyEffectPct,
        createdAt: worldState.createdAt,
      })
      .from(worldState)
      .orderBy(desc(worldState.tickNumber))
      .limit(limit);
    res.json({ success: true, data: { steps: rows } });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 3: Full suite + commit**

```bash
pnpm exec tsc --noEmit && pnpm test
git add src/core/server/jobs/agentTick.ts src/modules/world/server/routes/world.ts
git commit -m "feat(macro): tick wiring (pre-Phase-11, gated+isolated) + GET /world/macro"
```

---

### Task 6: Whole-branch gate + dark-deploy invariants + docs

**Files:**
- Modify: `docs/TODO.md`

- [ ] **Step 1: Full gate** — `pnpm exec tsc --noEmit && pnpm test && pnpm run build`. All green.
- [ ] **Step 2: Dark invariants** (against `origin/main`):
  - `git diff origin/main -- src/core/server/services/ai.ts src/core/server/lib/fiscalMath.ts src/core/server/lib/consequenceMath.ts` → MUST be empty (prompts + money math untouched).
  - `git diff origin/main -- src/core/server/jobs/agentTick.ts` → ONLY the new import + the new gated block; no existing phase touched.
  - Diff contains no new `Math.random` occurrences.
- [ ] **Step 3: TODO.md entry** — top of Recently Completed:

```markdown
- [x] 2026-07-13: **E5 Slice 1 — Macro Engine (world-model Layer 1) BUILT, DEPLOYED DARK** (`docs/superpowers/plans/2026-07-13-e5-macro-engine.md`). Regime-switching GDP (NBER hazards), Okun unemployment (−0.45), state-dependent Phillips, endogenous sentiment (self-calibrating T0 base), CBO-parameterized policy coupling via regime-conditional 12-quarter lag weights (shape per A&G 2012/Ramey 2019, weights in-house, 12q truncation documented). Seeded PRNG chain in new `world_state` (migration 0031) — first real implementation of the roadmap's reproducibility mandate (existing Math.random sites = follow-up). Fiscal impulses from structured `laws` columns: spend_once→purchases, recurring/mandatory→transfers (both recession-scaled), tax→flat multiplier (Ramey: tax state-dependence runs opposite — deliberately not boosted). 22 config fields four-things complete; observe-only (writes world_state, read by NOTHING); `GET /api/world/macro`. Enable = flip `macroEngineEnabled` (safe, observational). Next slices: revenue coupling (dynamic GDP → elasticCitizenRevenue, + SFC sector-balance check), §2.6 exogenous shock impulses (world-events feed → macro), officeholder prompt injection (EconAgent pattern), /divergence charts, Layer 3 cohorts, Layer 4 voter graph.
```

- [ ] **Step 4: Commit**

```bash
git add docs/TODO.md docs/superpowers/plans/2026-07-13-e5-macro-engine.md
git commit -m "docs(macro): E5 slice-1 plan + TODO entry"
```

---

### Task 7: PR, deploy dark, verify no-op, enable observation

- [ ] **Step 1: PR** — `gh auth status` (repo under `Myro-Productions-Portfolio`); push; `gh pr create` titled `feat(macro): E5 slice 1 — macro engine (world-model Layer 1), deploy dark`; merge after the final whole-branch review passes (squash, repo convention).
- [ ] **Step 2: Deploy** — pull + `pnpm run deploy` on 10.0.0.10. Check how migrations 0029/0030 were applied on the box (deploy log) and apply 0031 the same way (`drizzle-kit push` is the house fallback for fresh-DB quirks).
- [ ] **Step 3: Verify no-op while dark** — service active, site 200, config loaded, next tick completes normally, `SELECT COUNT(*) FROM world_state` = 0, zero `[SIMULATION] Macro:` log lines.
- [ ] **Step 4: Enable observation** — flip `macroEngineEnabled=true` via runtime_config read-merge-write + restart between ticks (admin POST is Clerk-gated; this is the established CLI path — backup the config row first, same as the fiscal flip). After the next step-boundary tick: one `[SIMULATION] Macro: seeded T0` line; one `world_state` row with u=4.2 / π=4.2 / sent=44.8 / regime=expansion; `GET /api/world/macro` returns it. One step later: second row, seed advanced, values plausible.
- [ ] **Step 5: Follow-up logging** — add one TODO Active Tasks line: existing `Math.random()` call sites (agentTick, aggeTick, forumRouter, simulationCore) still bypass the seeded PRNG; migrate in a later slice.
