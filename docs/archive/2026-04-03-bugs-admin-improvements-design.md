# Design: Bug Fixes + Admin Improvements

**Date:** 2026-04-03
**Status:** Approved
**Scope:** 5 bug fixes + 3 admin panel improvements

---

## Bug 1: Admin Overview shows "0 agents total / 0 active"

### Root Cause

`AdminPage.tsx` line ~453: `fetchAgents()` calls `/api/admin/agents`, but the response mapping to `AgentRow[]` fails silently. The state never updates, so the Overview tab displays the initial state of 0.

### Fix

Debug the response structure in `fetchAgents()`. The API returns `{ success: true, data: [...] }` but the client may be reading the wrong property. Verify the destructuring matches the actual response shape. Add error logging that surfaces the actual response when the mapping fails.

### Files
- Modify: `src/modules/admin/client/pages/AdminPage.tsx` — `fetchAgents` function
- Verify: `src/modules/admin/server/routes/admin.ts` — `GET /admin/agents` response shape

---

## Bug 2: 18 console errors on admin page

### Root Cause

`AdminPage.tsx` calls `fetchProviders()` on mount, which hits `/api/admin/providers`. This endpoint does not exist in `admin.ts`. Every page load fires a 404, plus cascading errors from the undefined response.

### Fix

Add `GET /api/admin/providers` route to `admin.ts` that queries the `apiProviders` table and returns provider configurations (name, isActive, ollamaBaseUrl — NOT the encrypted keys, those stay server-side). The client already has the UI for this tab; it just needs the data.

### Files
- Modify: `src/modules/admin/server/routes/admin.ts` — add GET /admin/providers endpoint
- Verify: `src/modules/admin/client/pages/AdminPage.tsx` — Providers tab expects `{ providerName, isActive, ollamaBaseUrl }[]`

---

## Bug 3: AGGE hitting wrong inference endpoint

### Root Cause

`aggeTick.ts` line 23: `const baseUrl = process.env.AGGE_INFERENCE_URL ?? 'http://192.168.3.20:8000'`. The fallback is Ross's DGX Spark 2, which is not where the simulation inference runs.

### Fix

Change the default fallback to read `OPENAI_BASE_URL` (the same env var the simulation uses), so AGGE uses the same vLLM instance by default. Keep `AGGE_INFERENCE_URL` as an override for when Bob eventually takes over orchestration from a separate Spark.

```typescript
const baseUrl = process.env.AGGE_INFERENCE_URL
  ?? process.env.OPENAI_BASE_URL
  ?? 'http://localhost:8000';
```

Also change the model default similarly:
```typescript
const model = process.env.AGGE_INFERENCE_MODEL
  ?? process.env.OPENAI_MODEL
  ?? 'gpt-4o-mini';
```

### Files
- Modify: `src/core/server/jobs/aggeTick.ts` — lines 23-24, change defaults

---

## Bug 4: Parties showing "1 member" per party

### Root Cause

`parties` schema has `memberCount` column defaulting to 1. It's never incremented when agents join via `partyMemberships`. The `/api/parties/list` endpoint returns the stale column value.

### Fix

In the `/api/parties/list` endpoint, replace the direct `memberCount` column read with a computed count from `partyMemberships`. Use a subquery or left join with count:

```typescript
const partiesWithCounts = await db
  .select({
    ...parties,
    memberCount: sql<number>`(SELECT COUNT(*) FROM ${partyMemberships} WHERE ${partyMemberships.partyId} = ${parties.id})`,
  })
  .from(parties)
  .where(eq(parties.isActive, true));
```

This makes the display always accurate regardless of whether the column is maintained.

### Files
- Modify: `src/modules/elections/server/routes/parties.ts` — GET /parties/list endpoint
- Optional: Remove `memberCount` column from schema if no other code writes to it

---

## Bug 5: Court — 48 cases all "1-0 UPHELD"

### Root Cause

`supremeCourtJustices` runtime config is 7, but only 1 justice position exists in the `positions` table. The judicial review phase (Phase 10) only loops over active justice positions, so only 1 vote is cast per case.

### Fix

Two parts:

1. **Seed justice positions**: Add logic to check if the correct number of justice positions exist. If fewer exist than `supremeCourtJustices` config, create vacant positions. This should run on server startup or as part of the tick initialization.

2. **Fill vacancies**: The election/appointment system should assign agents to vacant justice positions. For now, add a simple vacancy-filling mechanism: when a justice position is vacant, assign the highest-reputation unassigned agent from a rotation. This can be replaced later with a proper judicial appointment process.

3. **Dissent logic**: With multiple justices, the existing LLM-based voting in Phase 10 will naturally produce dissent since different agents have different alignments/personalities.

### Files
- Modify: `src/core/server/jobs/agentTick.ts` — add justice vacancy check at start of Phase 10
- Modify: `src/core/db/seed.ts` or create a startup routine — seed N justice positions matching config
- Verify: Phase 10 voting loop already handles multiple justices correctly

---

## Item 6: AGGE Config in Admin Panel

### What to build

New "AGGE" tab in AdminPage with:

**Controls:**
- Inference URL (text input, reads from runtimeConfig, defaults to current env var)
- Model name (text input)
- Tick interval (preset buttons: 15m, 30m, 1h, 2h, 4h)
- Agents per tick — min (number input, 1-5) and max (number input, 1-10)
- Temperature (range slider, 0.5-2.0, default 1.15)
- Manual trigger button (calls existing `POST /api/admin/god/tick`)

**Display:**
- Recent interventions log (calls existing `GET /api/admin/god/interventions`) — show last 20 interventions with agent name, action (add/swap/remove), old mod, new mod, reasoning, timestamp
- Next scheduled tick countdown

### Implementation

Add AGGE parameters to `runtimeConfig.ts`:
```typescript
aggeTickIntervalMs: 3_600_000,
aggeAgentsPerTickMin: 1,
aggeAgentsPerTickMax: 3,
aggeTemperature: 1.15,
aggeInferenceUrl: '',    // empty = use OPENAI_BASE_URL
aggeInferenceModel: '',  // empty = use OPENAI_MODEL
```

`aggeTick.ts` reads these from `getRuntimeConfig()` instead of hardcoded constants.

Admin API: `GET/POST /api/admin/config` already handles runtimeConfig — adding new fields to the config object is all that's needed server-side.

### Files
- Modify: `src/core/server/runtimeConfig.ts` — add AGGE params
- Modify: `src/core/server/jobs/aggeTick.ts` — read from runtimeConfig instead of constants
- Modify: `src/modules/admin/client/pages/AdminPage.tsx` — add AGGE tab

---

## Item 7: Model Override per Provider

### What to build

In the Providers tab, add a "Default Model" text field next to each provider's API key config. This lets the admin set which model each provider uses without changing code or env vars.

### Implementation

Add `defaultModel` column to `apiProviders` table:
```typescript
defaultModel: text('default_model'),
```

Update `getDefaultModel()` in `ai.ts` to check the provider's DB row first:
```typescript
function getDefaultModel(provider: string): string {
  // Check DB provider config first (cached)
  const dbModel = providerModelCache.get(provider);
  if (dbModel) return dbModel;
  // Then env var
  if (provider === 'openai' && process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  // Then hardcoded defaults
  switch (provider) {
    case 'anthropic': return config.anthropic.model;
    case 'openai': return 'gpt-4o-mini';
    case 'google': return 'gemini-2.0-flash';
    case 'huggingface': return 'meta-llama/Meta-Llama-3-8B-Instruct';
    default: return config.ollama.model;
  }
}
```

Cache the DB values with a 5-minute TTL to avoid per-decision DB lookups.

### Files
- Modify: `src/modules/admin/db/schema/providers.ts` — add `defaultModel` column
- Modify: `src/core/server/services/ai.ts` — update `getDefaultModel()` with DB lookup + cache
- Modify: `src/modules/admin/client/pages/AdminPage.tsx` — add model field to Providers tab
- Modify: `src/modules/admin/server/routes/admin.ts` — include model in GET/POST providers

---

## Item 8: Simulation Health Dashboard

### What to build

New "Health" tab in AdminPage showing real-time simulation health metrics.

**Sections:**

1. **Tick Timing** — bar chart of last 20 ticks showing duration (completedAt - firedAt). Highlight ticks that exceeded 2x the target interval. Current tick interval displayed.

2. **LLM Latency** — aggregate stats from `agentDecisions.latencyMs`:
   - Average, p50, p95, p99 for last 100 decisions
   - Breakdown by provider
   - Breakdown by phase
   - Sparkline chart of recent latency trend

3. **Error Rate** — from `agentDecisions` where `success = false`:
   - Count in last hour, last 24h
   - Error rate percentage
   - Most common error phases

4. **Active Status** — combined view:
   - Simulation running/paused
   - AGGE running/paused
   - Queue depth (waiting/active/failed)
   - Last tick timestamp + next tick ETA
   - Cloudflare tunnel status (call health endpoint)

### API Endpoints

```
GET /api/admin/health/ticks?limit=20
  → [{ id, firedAt, completedAt, durationMs }]

GET /api/admin/health/latency?limit=100
  → { avg, p50, p95, p99, byProvider: {...}, byPhase: {...}, recent: [...] }

GET /api/admin/health/errors?hours=24
  → { count, rate, byPhase: {...} }
```

### Files
- Create: `src/modules/admin/server/routes/health.ts` — new health metrics routes
- Modify: `src/modules/admin/server/routes/admin.ts` — mount health routes
- Modify: `src/modules/admin/client/pages/AdminPage.tsx` — add Health tab
- Modify: `src/core/client/lib/api.ts` — add health API methods

---

## Implementation Order

1. Bug 2 (missing providers endpoint) — unblocks admin page loading without errors
2. Bug 1 (agent count) — admin overview becomes trustworthy
3. Bug 3 (AGGE endpoint) — AGGE starts working on the right infrastructure
4. Bug 4 (party members) — parties page shows real data
5. Bug 5 (court justices) — judicial branch becomes meaningful
6. Item 7 (model per provider) — schema change, deploy early
7. Item 6 (AGGE admin tab) — depends on Bug 3 fix + runtimeConfig additions
8. Item 8 (health dashboard) — independent, can be built any time after bugs are fixed
