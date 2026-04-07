# Bug Fixes + Admin Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 bugs in the admin/simulation systems and add 3 admin panel improvements (AGGE config, model per provider, health dashboard).

**Architecture:** Bug fixes target specific endpoints and queries. Admin improvements extend the existing runtimeConfig + AdminPage pattern. New health metrics endpoints aggregate data from tickLog and agentDecisions tables.

**Tech Stack:** TypeScript, React, Express, Drizzle ORM, PostgreSQL, Bull queue

---

## File Map

### Bug Fixes
- **Modify:** `src/modules/admin/server/routes/admin.ts` — add missing providers endpoint
- **Modify:** `src/modules/admin/client/pages/AdminPage.tsx` — fix agent fetch, add new tabs
- **Modify:** `src/core/server/jobs/aggeTick.ts` — fix inference endpoint defaults
- **Modify:** `src/modules/elections/server/routes/parties.ts` — compute member count
- **Modify:** `src/core/server/jobs/agentTick.ts` — justice vacancy filling in Phase 10

### Admin Improvements
- **Modify:** `src/core/server/runtimeConfig.ts` — add AGGE config params
- **Modify:** `src/modules/admin/db/schema/providers.ts` — add defaultModel column
- **Modify:** `src/core/server/services/ai.ts` — DB-aware getDefaultModel
- **Create:** `src/modules/admin/server/routes/health.ts` — health metrics endpoints
- **Modify:** `src/core/client/lib/api.ts` — add health + providers API methods

---

## Task 1: Add missing GET /api/admin/providers endpoint

**Files:**
- Modify: `src/modules/admin/server/routes/admin.ts`

- [ ] **Step 1: Add the providers list endpoint**

In `src/modules/admin/server/routes/admin.ts`, add after the existing economy endpoints (around line 272). Make sure `apiProviders` is imported from `@db/schema/index` at the top of the file (it likely already is — check first).

```typescript
/* GET /api/admin/providers — list configured AI providers */
router.get('/admin/providers', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: apiProviders.id,
        providerName: apiProviders.providerName,
        isActive: apiProviders.isActive,
        ollamaBaseUrl: apiProviders.ollamaBaseUrl,
        hasKey: sql<boolean>`${apiProviders.encryptedKey} IS NOT NULL`,
        updatedAt: apiProviders.updatedAt,
      })
      .from(apiProviders)
      .orderBy(apiProviders.providerName);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});
```

Note: We return `hasKey` boolean instead of the encrypted key itself — never expose secrets to the client.

- [ ] **Step 2: Verify the import exists**

Check that `apiProviders` is imported at the top of admin.ts. Also ensure `sql` is imported from `drizzle-orm`. If not, add them.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/admin/server/routes/admin.ts
git commit -m "fix: add missing GET /api/admin/providers endpoint"
```

---

## Task 2: Fix admin overview "0 agents" display bug

**Files:**
- Modify: `src/modules/admin/client/pages/AdminPage.tsx`

- [ ] **Step 1: Read AdminPage.tsx and find the fetchAgents function**

Read `src/modules/admin/client/pages/AdminPage.tsx` around lines 451-456. The issue is that `res.data` might be wrapped differently than expected. The API returns `{ success: true, data: rows }`, and the client API wrapper (`request()` in api.ts) may or may not unwrap this.

- [ ] **Step 2: Check the api.ts request wrapper**

Read `src/core/client/lib/api.ts` to see what the `request()` function returns. Specifically check if it returns the raw response or unwraps `response.json()`. The `adminApi.getAgents()` call goes through this wrapper.

- [ ] **Step 3: Fix the response mapping**

Based on what `request()` returns, fix the `fetchAgents` callback. The most likely issue is that `res` is already `{ success: true, data: rows }`, so `res.data` is correct — but if `request()` returns the fetch Response object, `res.data` would be undefined.

If the wrapper returns the parsed JSON directly:
```typescript
const fetchAgents = useCallback(async () => {
  try {
    const res = await adminApi.getAgents();
    const data = res.data ?? res;
    if (Array.isArray(data)) {
      setAgentList(data as AgentRow[]);
    } else {
      console.error('[ADMIN] fetchAgents: unexpected response shape', res);
    }
  } catch (err) { console.error('[ADMIN] fetchAgents failed:', err); }
}, []);
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/client/pages/AdminPage.tsx
git commit -m "fix: admin overview agent count — handle response structure correctly"
```

---

## Task 3: Fix AGGE inference endpoint defaults

**Files:**
- Modify: `src/core/server/jobs/aggeTick.ts:22-24`

- [ ] **Step 1: Update the inference URL and model defaults**

In `src/core/server/jobs/aggeTick.ts`, replace lines 22-24:

```typescript
// Before:
async function callInferenceForAgge(contextMessage: string): Promise<string> {
  const baseUrl = process.env.AGGE_INFERENCE_URL ?? 'http://10.0.0.69:8000';
  const model   = process.env.AGGE_INFERENCE_MODEL ?? 'openai/gpt-oss-20b';

// After:
async function callInferenceForAgge(contextMessage: string): Promise<string> {
  const baseUrl = process.env.AGGE_INFERENCE_URL
    ?? process.env.OPENAI_BASE_URL
    ?? 'http://localhost:8000';
  const model = process.env.AGGE_INFERENCE_MODEL
    ?? process.env.OPENAI_MODEL
    ?? 'gpt-4o-mini';
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/server/jobs/aggeTick.ts
git commit -m "fix: AGGE defaults to OPENAI_BASE_URL instead of hardcoded Ross DGX IP"
```

---

## Task 4: Fix party member count

**Files:**
- Modify: `src/modules/elections/server/routes/parties.ts:11-28`

- [ ] **Step 1: Replace static memberCount with computed count**

In `src/modules/elections/server/routes/parties.ts`, replace the GET /parties/list handler (lines 12-28):

```typescript
/* GET /api/parties/list -- List all parties */
router.get('/parties/list', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const offset = (page - 1) * limit;

    const results = await db
      .select({
        id: parties.id,
        name: parties.name,
        abbreviation: parties.abbreviation,
        description: parties.description,
        founderId: parties.founderId,
        alignment: parties.alignment,
        memberCount: sql<number>`CAST((SELECT COUNT(*) FROM ${partyMemberships} WHERE ${partyMemberships.partyId} = ${parties.id}) AS int)`,
        platform: parties.platform,
        isActive: parties.isActive,
        createdAt: parties.createdAt,
      })
      .from(parties)
      .where(eq(parties.isActive, true))
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
});
```

Make sure `sql` is imported from `drizzle-orm` at the top. Add it if not present.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/elections/server/routes/parties.ts
git commit -m "fix: compute party member count from partyMemberships instead of stale column"
```

---

## Task 5: Fix court — fill justice vacancies

**Files:**
- Modify: `src/core/server/jobs/agentTick.ts` — Phase 10 section

- [ ] **Step 1: Read the Phase 10 section**

Read `src/core/server/jobs/agentTick.ts` from line 1219 to ~1250 to understand the current justice position query.

- [ ] **Step 2: Add vacancy-filling logic at the start of Phase 10**

After the `justicePositions` query (line 1240) and before the `if (justicePositions.length === 0)` check (line 1242), add vacancy-filling logic:

```typescript
    /* Auto-fill justice vacancies up to supremeCourtJustices config */
    if (justicePositions.length < rc.supremeCourtJustices) {
      const vacancyCount = rc.supremeCourtJustices - justicePositions.length;
      console.warn(`[SIMULATION] Phase 10: ${vacancyCount} justice vacancies — filling...`);

      /* Get agents not currently holding any position, sorted by reputation */
      const currentPositionHolders = await db
        .select({ agentId: positions.agentId })
        .from(positions)
        .where(eq(positions.isActive, true));
      const heldAgentIds = new Set(currentPositionHolders.map((p) => p.agentId));

      const eligibleAgents = activeAgents
        .filter((a) => !heldAgentIds.has(a.id))
        .sort((a, b) => b.reputation - a.reputation)
        .slice(0, vacancyCount);

      for (const agent of eligibleAgents) {
        await db.insert(positions).values({
          agentId: agent.id,
          type: 'supreme_justice',
          title: 'Supreme Court Justice',
          startDate: new Date(),
          isActive: true,
        });

        await db.insert(activityEvents).values({
          type: 'appointment',
          agentId: agent.id,
          title: `${agent.displayName} appointed to Supreme Court`,
          description: `Appointed as Supreme Court Justice to fill vacancy`,
        });

        console.warn(`[SIMULATION] Phase 10: Appointed ${agent.displayName} as Supreme Court Justice`);
      }

      /* Re-fetch justice positions after filling vacancies */
      const updatedJusticePositions = await db
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.isActive, true),
            inArray(positions.type, ['supreme_justice']),
          ),
        );

      /* Replace justicePositions with updated list for the rest of Phase 10 */
      justicePositions.length = 0;
      justicePositions.push(...updatedJusticePositions);
    }
```

Note: `justicePositions` needs to be declared with `let` or as a mutable array for the push to work. Check if it's `const` — if so, either change to `let` and reassign, or use the push approach above which mutates the array in place.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/core/server/jobs/agentTick.ts
git commit -m "fix: auto-fill supreme court justice vacancies in Phase 10"
```

---

## Task 6: Add AGGE config to runtimeConfig

**Files:**
- Modify: `src/core/server/runtimeConfig.ts`

- [ ] **Step 1: Add AGGE params to RuntimeConfig interface**

In `src/core/server/runtimeConfig.ts`, add after the Guard Rails section in the interface (after line 60):

```typescript
  /* ---- AGGE (God Agent) ---- */
  aggeTickIntervalMs: number;
  aggeAgentsPerTickMin: number;
  aggeAgentsPerTickMax: number;
  aggeTemperature: number;
  aggeInferenceUrl: string;      // empty = use OPENAI_BASE_URL
  aggeInferenceModel: string;    // empty = use OPENAI_MODEL
```

- [ ] **Step 2: Add defaults to the current object**

In the `let current: RuntimeConfig` object, add after maxCampaignSpeechesPerTick (after line 113):

```typescript
  /* AGGE */
  aggeTickIntervalMs: 3_600_000,
  aggeAgentsPerTickMin: 1,
  aggeAgentsPerTickMax: 3,
  aggeTemperature: 1.15,
  aggeInferenceUrl: '',
  aggeInferenceModel: '',
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/core/server/runtimeConfig.ts
git commit -m "feat: add AGGE configuration params to runtimeConfig"
```

---

## Task 7: Wire aggeTick.ts to read from runtimeConfig

**Files:**
- Modify: `src/core/server/jobs/aggeTick.ts`

- [ ] **Step 1: Replace hardcoded constants with runtimeConfig reads**

In `aggeTick.ts`, add the import at the top:

```typescript
import { getRuntimeConfig } from '../runtimeConfig.js';
```

Then in the `aggeQueue.process` callback, replace the hardcoded constants with config reads. Find where `AGENTS_PER_TICK_MIN`, `AGENTS_PER_TICK_MAX` are used and replace:

```typescript
aggeQueue.process(async () => {
  const rc = getRuntimeConfig();
  console.warn('[AGGE] AGGE tick running...');
  // ... existing activeAgents fetch ...

  const count = rc.aggeAgentsPerTickMin + Math.floor(
    Math.random() * (rc.aggeAgentsPerTickMax - rc.aggeAgentsPerTickMin + 1)
  );
```

Also update `callInferenceForAgge` to read from runtimeConfig:

```typescript
async function callInferenceForAgge(contextMessage: string): Promise<string> {
  const rc = getRuntimeConfig();
  const baseUrl = rc.aggeInferenceUrl
    || process.env.AGGE_INFERENCE_URL
    || process.env.OPENAI_BASE_URL
    || 'http://localhost:8000';
  const model = rc.aggeInferenceModel
    || process.env.AGGE_INFERENCE_MODEL
    || process.env.OPENAI_MODEL
    || 'gpt-4o-mini';
  const temperature = rc.aggeTemperature;
```

And update the `startAggeTick` function to read the interval from config:

```typescript
export function startAggeTick(): void {
  const rc = getRuntimeConfig();
  aggeQueue
    .add({}, {
      repeat: { every: rc.aggeTickIntervalMs },
      removeOnComplete: 10,
      removeOnFail: 5,
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
    })
    .catch((err: unknown) => console.error('[AGGE] Failed to start AGGE tick:', err));
  console.warn(`[AGGE] AGGE tick started — interval: ${rc.aggeTickIntervalMs}ms`);
}
```

Remove the old hardcoded constants at the top (`AGGE_TICK_INTERVAL_MS`, `AGENTS_PER_TICK_MIN`, `AGENTS_PER_TICK_MAX`).

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/server/jobs/aggeTick.ts
git commit -m "feat: wire AGGE to read from runtimeConfig instead of hardcoded constants"
```

---

## Task 8: Add AGGE tab to AdminPage

**Files:**
- Modify: `src/modules/admin/client/pages/AdminPage.tsx`

- [ ] **Step 1: Read the AdminPage tab structure**

Read AdminPage.tsx to understand how tabs are defined. Find the tab list and the tab content rendering pattern. Identify where to add a new tab.

- [ ] **Step 2: Add AGGE tab to the tab list**

Find the tabs array/navigation and add `'AGGE'` as a new tab option after the existing tabs.

- [ ] **Step 3: Add AGGE tab content**

Add the AGGE tab panel content. This should include:

1. **Inference Config Section:**
   - Inference URL text input (reads `simConfig.aggeInferenceUrl`, calls `adminApi.setConfig`)
   - Model name text input (reads `simConfig.aggeInferenceModel`)
   - Temperature slider (0.5-2.0, step 0.05)

2. **Timing Section:**
   - Tick interval presets: 15m, 30m, 1h, 2h, 4h (updates `aggeTickIntervalMs`)
   - Agents per tick: min (number 1-5) and max (number 1-10)

3. **Controls Section:**
   - Manual trigger button calling `POST /api/admin/god/tick`
   - Current status (next tick countdown)

4. **Recent Interventions Log:**
   - Fetch from `GET /api/admin/god/interventions`
   - Display last 20: agent name, action (add/swap/remove), old mod -> new mod, reasoning, timestamp

Use the same patterns as the existing Simulation tab (preset buttons, range sliders, config save calls).

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/client/pages/AdminPage.tsx
git commit -m "feat: add AGGE configuration tab to admin panel"
```

---

## Task 9: Add defaultModel column to apiProviders

**Files:**
- Modify: `src/modules/admin/db/schema/providers.ts`

- [ ] **Step 1: Add the column**

In `src/modules/admin/db/schema/providers.ts`, add after `ollamaBaseUrl`:

```typescript
  defaultModel: varchar('default_model', { length: 200 }),
```

Full file should be:

```typescript
import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const apiProviders = pgTable('api_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerName: varchar('provider_name', { length: 30 }).notNull().unique(),
  encryptedKey: text('encrypted_key'),
  isActive: boolean('is_active').notNull().default(false),
  ollamaBaseUrl: varchar('ollama_base_url', { length: 500 }),
  defaultModel: varchar('default_model', { length: 200 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/admin/db/schema/providers.ts
git commit -m "feat: add defaultModel column to apiProviders schema"
```

---

## Task 10: Update getDefaultModel to check DB provider config

**Files:**
- Modify: `src/core/server/services/ai.ts`

- [ ] **Step 1: Read the current getDefaultModel function**

Read `src/core/server/services/ai.ts` and find `getDefaultModel`. Note its line number and current implementation.

- [ ] **Step 2: Add a provider model cache and update the function**

Add a cache above `getDefaultModel`:

```typescript
// Provider model cache: providerName → defaultModel, 5-minute TTL
const providerModelCache = new Map<string, { model: string; ts: number }>();
const PROVIDER_MODEL_TTL_MS = 5 * 60_000;

async function getProviderModel(providerName: string): Promise<string | null> {
  const cached = providerModelCache.get(providerName);
  if (cached && Date.now() - cached.ts < PROVIDER_MODEL_TTL_MS) return cached.model;

  const [row] = await db
    .select({ defaultModel: apiProviders.defaultModel })
    .from(apiProviders)
    .where(and(eq(apiProviders.providerName, providerName), eq(apiProviders.isActive, true)))
    .limit(1);

  if (row?.defaultModel) {
    providerModelCache.set(providerName, { model: row.defaultModel, ts: Date.now() });
    return row.defaultModel;
  }
  return null;
}
```

Then update `getDefaultModel` to be async and check DB first:

```typescript
async function getDefaultModel(provider: string): Promise<string> {
  // 1. Check DB provider config
  const dbModel = await getProviderModel(provider).catch(() => null);
  if (dbModel) return dbModel;
  // 2. Check env var
  if (provider === 'openai' && process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  // 3. Hardcoded defaults
  switch (provider) {
    case 'anthropic': return config.anthropic.model;
    case 'openai': return 'gpt-4o-mini';
    case 'google': return 'gemini-2.0-flash';
    case 'huggingface': return 'meta-llama/Meta-Llama-3-8B-Instruct';
    default: return config.ollama.model;
  }
}
```

Note: Making this async requires updating the caller in `callProvider` where `getDefaultModel` is used. Find it (around line 499: `const model = agent.model ?? getDefaultModel(provider)`) and add await:

```typescript
const model = agent.model ?? await getDefaultModel(provider);
```

- [ ] **Step 3: Update providers endpoint to include defaultModel**

In `admin.ts`, update the GET /admin/providers endpoint (Task 1) to also return `defaultModel`:

```typescript
        defaultModel: apiProviders.defaultModel,
```

And add a POST endpoint for setting the model if one doesn't exist:

Check if there's already a `POST /admin/providers/:name` endpoint. If so, add `defaultModel` to its update logic. If not, add handling for the model field.

- [ ] **Step 4: Add model field to Providers tab in AdminPage**

In AdminPage.tsx, find the Providers tab section. Add a text input for "Default Model" next to each provider's API key config. Use the same save pattern as the API key — call `providersApi.set(name, { defaultModel: value })`.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/core/server/services/ai.ts src/modules/admin/server/routes/admin.ts src/modules/admin/client/pages/AdminPage.tsx
git commit -m "feat: model override per provider — DB config with 5-min cache"
```

---

## Task 11: Create health metrics API endpoints

**Files:**
- Create: `src/modules/admin/server/routes/health.ts`
- Modify: `src/modules/admin/server/routes/admin.ts` — mount health routes

- [ ] **Step 1: Create the health routes file**

Create `src/modules/admin/server/routes/health.ts`:

```typescript
import { Router } from 'express';
import { db } from '@db/connection';
import { tickLog, agentDecisions } from '@db/schema/index';
import { desc, sql, gte, eq, and } from 'drizzle-orm';

const router = Router();

/* GET /api/admin/health/ticks — recent tick durations */
router.get('/admin/health/ticks', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const ticks = await db
      .select({
        id: tickLog.id,
        firedAt: tickLog.firedAt,
        completedAt: tickLog.completedAt,
      })
      .from(tickLog)
      .where(sql`${tickLog.completedAt} IS NOT NULL`)
      .orderBy(desc(tickLog.firedAt))
      .limit(limit);

    const data = ticks.map((t) => ({
      id: t.id,
      firedAt: t.firedAt,
      completedAt: t.completedAt,
      durationMs: t.completedAt && t.firedAt
        ? new Date(t.completedAt).getTime() - new Date(t.firedAt).getTime()
        : null,
    }));

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/health/latency — LLM latency stats */
router.get('/admin/health/latency', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const recent = await db
      .select({
        provider: agentDecisions.provider,
        phase: agentDecisions.phase,
        latencyMs: agentDecisions.latencyMs,
        success: agentDecisions.success,
      })
      .from(agentDecisions)
      .where(sql`${agentDecisions.latencyMs} IS NOT NULL`)
      .orderBy(desc(agentDecisions.createdAt))
      .limit(limit);

    const latencies = recent.filter((r) => r.latencyMs != null).map((r) => r.latencyMs!);
    latencies.sort((a, b) => a - b);

    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const idx = Math.ceil(arr.length * p / 100) - 1;
      return arr[Math.max(0, idx)];
    };

    // By provider
    const byProvider: Record<string, { avg: number; count: number }> = {};
    for (const r of recent) {
      const p = r.provider ?? 'unknown';
      if (!byProvider[p]) byProvider[p] = { avg: 0, count: 0 };
      byProvider[p].count++;
      byProvider[p].avg += (r.latencyMs ?? 0);
    }
    for (const p of Object.keys(byProvider)) {
      byProvider[p].avg = Math.round(byProvider[p].avg / byProvider[p].count);
    }

    // By phase
    const byPhase: Record<string, { avg: number; count: number }> = {};
    for (const r of recent) {
      const ph = r.phase ?? 'unknown';
      if (!byPhase[ph]) byPhase[ph] = { avg: 0, count: 0 };
      byPhase[ph].count++;
      byPhase[ph].avg += (r.latencyMs ?? 0);
    }
    for (const ph of Object.keys(byPhase)) {
      byPhase[ph].avg = Math.round(byPhase[ph].avg / byPhase[ph].count);
    }

    res.json({
      success: true,
      data: {
        avg: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        count: latencies.length,
        byProvider,
        byPhase,
        recent: latencies.slice(0, 20),
      },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/health/errors — error rate stats */
router.get('/admin/health/errors', async (req, res, next) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 24, 168);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const [totalRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(agentDecisions)
      .where(gte(agentDecisions.createdAt, since));

    const [errorRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(agentDecisions)
      .where(and(gte(agentDecisions.createdAt, since), eq(agentDecisions.success, false)));

    const total = Number(totalRow?.count ?? 0);
    const errors = Number(errorRow?.count ?? 0);

    // Errors by phase
    const byPhase = await db
      .select({
        phase: agentDecisions.phase,
        count: sql<number>`COUNT(*)`,
      })
      .from(agentDecisions)
      .where(and(gte(agentDecisions.createdAt, since), eq(agentDecisions.success, false)))
      .groupBy(agentDecisions.phase);

    const byPhaseMap: Record<string, number> = {};
    for (const row of byPhase) {
      byPhaseMap[row.phase ?? 'unknown'] = Number(row.count);
    }

    res.json({
      success: true,
      data: {
        total,
        errors,
        rate: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0,
        hours,
        byPhase: byPhaseMap,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
```

- [ ] **Step 2: Mount health routes in admin.ts**

In `src/modules/admin/server/routes/admin.ts`, add at the top:

```typescript
import healthRouter from './health.js';
```

And after the router definition, mount it:

```typescript
router.use(healthRouter);
```

Or if admin.ts exports the router and health routes should be under the same auth, just add the health routes directly to the same router.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/admin/server/routes/health.ts src/modules/admin/server/routes/admin.ts
git commit -m "feat: add health metrics API — tick timing, LLM latency, error rates"
```

---

## Task 12: Add health API methods to client

**Files:**
- Modify: `src/core/client/lib/api.ts`

- [ ] **Step 1: Add health API methods**

In `src/core/client/lib/api.ts`, add after the existing `adminApi` object:

```typescript
export const healthApi = {
  ticks: (limit = 20) => request(`/admin/health/ticks?limit=${limit}`),
  latency: (limit = 100) => request(`/admin/health/latency?limit=${limit}`),
  errors: (hours = 24) => request(`/admin/health/errors?hours=${hours}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/core/client/lib/api.ts
git commit -m "feat: add health metrics API client methods"
```

---

## Task 13: Add Health tab to AdminPage

**Files:**
- Modify: `src/modules/admin/client/pages/AdminPage.tsx`

- [ ] **Step 1: Read the existing tab pattern**

Read AdminPage.tsx to understand the tab rendering pattern — how tabs are listed, how content switches, what state variables control the active tab.

- [ ] **Step 2: Add Health tab to the tab list**

Add `'Health'` to the tab options (alongside Overview, Simulation, Government, etc.).

- [ ] **Step 3: Add Health tab state and fetch**

Add state variables:

```typescript
const [healthTicks, setHealthTicks] = useState<Array<{ id: string; firedAt: string; completedAt: string; durationMs: number | null }>>([]);
const [healthLatency, setHealthLatency] = useState<{ avg: number; p50: number; p95: number; p99: number; count: number; byProvider: Record<string, { avg: number; count: number }>; byPhase: Record<string, { avg: number; count: number }>; recent: number[] } | null>(null);
const [healthErrors, setHealthErrors] = useState<{ total: number; errors: number; rate: number; hours: number; byPhase: Record<string, number> } | null>(null);
```

Add fetch function:

```typescript
const fetchHealth = useCallback(async () => {
  try {
    const [ticksRes, latencyRes, errorsRes] = await Promise.all([
      healthApi.ticks(20),
      healthApi.latency(100),
      healthApi.errors(24),
    ]);
    if (ticksRes.data) setHealthTicks(ticksRes.data);
    if (latencyRes.data) setHealthLatency(latencyRes.data);
    if (errorsRes.data) setHealthErrors(errorsRes.data);
  } catch (err) { console.error('[ADMIN] fetchHealth failed:', err); }
}, []);
```

Call `fetchHealth()` in the useEffect alongside other fetches.

- [ ] **Step 4: Add Health tab content**

Render the Health tab with three sections:

**Tick Timing:**
- Table of last 20 ticks: fired at, completed at, duration
- Highlight durations > 2x the target tick interval in red
- Show current `simConfig.tickIntervalMs` as reference

**LLM Latency:**
- Stats bar: avg, p50, p95, p99
- By provider breakdown (table)
- By phase breakdown (table)

**Error Rate:**
- Error count / total in last 24h
- Error rate percentage
- By phase breakdown

Use simple HTML tables and inline styles matching the existing admin panel aesthetic.

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/admin/client/pages/AdminPage.tsx
git commit -m "feat: add Health tab to admin panel — tick timing, latency, error rates"
```

---

## Task 14: Final verification and push

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: All existing tests pass

- [ ] **Step 3: Push to GitHub**

```bash
git push github main
```

- [ ] **Step 4: Rsync to Linux and restart**

```bash
rsync -avz --exclude='node_modules' --exclude='.env' --exclude='dist' --exclude='dev-dist' /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment/ myroproductions@10.0.0.10:/home/myroproductions/Projects/Molt-Government/
```

Then on Linux via SSH:
```bash
cd /home/myroproductions/Projects/Molt-Government && pnpm install && pnpm db:push
sudo pkill -9 -f "node" || true
sleep 2
rm -rf node_modules/.vite
nohup pnpm dev:local > /tmp/molt-gov.log 2>&1 &
```

- [ ] **Step 5: Verify via Playwright**

Navigate to https://agorabench.com/admin and verify:
- Overview shows correct agent count
- No console errors
- AGGE tab is present with controls
- Health tab shows tick timing and latency data
- Providers tab loads without errors
