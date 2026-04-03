# AgoraBench v0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Agora Bench from a governance simulation into a full
benchmark/stress-testing platform with Spark Mission Control integration.

**Architecture:** Scenario-driven benchmark system with isolated execution,
three-bucket metrics engine, and HTTP API handshake for external model testing.
Builds on existing simulation tick logic extracted into pure functions.

**Tech Stack:** TypeScript, Express, Drizzle ORM, PostgreSQL, Bull/Redis,
React, Tailwind CSS, WebSocket

**Design Doc:** `docs/plans/2026-02-20-agorabench-v0-design.md`

---

## Phase 0: Rename "Molt" to "Agora Bench"

Branch: `refactor/rename-to-agora-bench` (from `main`)

### Task 0.1: Rename `agoraId` to `agoraId` in shared types and validation

**Files:**
- Modify: `src/shared/types.ts:22,153`
- Modify: `src/shared/validation.ts:14`

**Step 1:** Update `src/shared/types.ts`
- Line 22: `agoraId: string;` → `agoraId: string;`
- Line 153: `agoraId: string;` → `agoraId: string;`

**Step 2:** Update `src/shared/validation.ts`
- Line 14: `agoraId: z.string().min(1, 'Agora ID is required'),` →
  `agoraId: z.string().min(1, 'Agora ID is required'),`

**Step 3:** Run tests: `npx vitest run tests/unit/shared/`
Expected: FAIL (tests still reference old field names)

**Step 4:** Commit
```bash
git add src/shared/types.ts src/shared/validation.ts
git commit -m "refactor: rename agoraId to agoraId in shared types"
```

### Task 0.2: Rename DB schema column

**Files:**
- Modify: `src/db/schema/agents.ts:5`
- Create: new migration file via Drizzle

**Step 1:** Update `src/db/schema/agents.ts`
- Line 5: `agoraId: varchar('agora_id', ...)` →
  `agoraId: varchar('agora_id', { length: 255 }).notNull().unique(),`

**Step 2:** Generate Drizzle migration:
```bash
npx drizzle-kit generate
```
This creates a new migration with `ALTER TABLE agents RENAME COLUMN agora_id TO agora_id`

**Step 3:** Apply migration:
```bash
npx drizzle-kit push
```

**Step 4:** Commit
```bash
git add src/db/schema/agents.ts drizzle/
git commit -m "refactor: rename agora_id column to agora_id"
```

### Task 0.3: Rename in server routes

**Files:**
- Modify: `src/server/routes/agents.ts:17,21,25,41`
- Modify: `src/server/routes/admin.ts:352`
- Modify: `src/server/routes/profile.ts:121`

**Step 1:** Update `src/server/routes/agents.ts`
- Line 17: comment `agoraId` → `agoraId`
- Line 21: `agents.agoraId, data.agoraId` → `agents.agoraId, data.agoraId`
- Line 25: `'Agent with this Agora ID already exists'` →
  `'Agent with this Agora ID already exists'`
- Line 41: `agoraId: data.agoraId` → `agoraId: data.agoraId`

**Step 2:** Update `src/server/routes/admin.ts`
- Line 352: `` agoraId: `agora_${name}_${Date.now()}` `` →
  `` agoraId: `agora_${name}_${Date.now()}` ``

**Step 3:** Update `src/server/routes/profile.ts`
- Line 121: `` agoraId: `agora_${name}_${Date.now()}` `` →
  `` agoraId: `agora_${name}_${Date.now()}` ``

**Step 4:** Commit
```bash
git add src/server/routes/agents.ts src/server/routes/admin.ts src/server/routes/profile.ts
git commit -m "refactor: rename agoraId to agoraId in routes"
```

### Task 0.4: Rename in seeds, scripts, client

**Files:**
- Modify: `src/db/seed.ts:117`
- Modify: `src/db/seedFn.ts:73`
- Modify: `src/db/seed.placeholder.ts:9,18,27,36,45`
- Modify: `scripts/add-political-agents.ts:31`
- Modify: `src/client/pages/AgentProfilePage.tsx:12`
- Modify: `src/client/lib/api.ts:46`

**Step 1:** Update all seed files — replace `agoraId` with `agoraId` and
`agora_` prefix with `agora_` prefix in generated IDs.

**Step 2:** Update `scripts/add-political-agents.ts:31` — same pattern.

**Step 3:** Update `src/client/pages/AgentProfilePage.tsx:12` —
`agoraId: string;` → `agoraId: string;`

**Step 4:** Update `src/client/lib/api.ts:46` —
`register: (data: { agoraId: ...` → `register: (data: { agoraId: ...`

**Step 5:** Commit
```bash
git add src/db/ scripts/ src/client/
git commit -m "refactor: rename agoraId to agoraId in seeds, scripts, client"
```

### Task 0.5: Update tests

**Files:**
- Modify: `tests/unit/shared/validation.test.ts:16,24,26,35,44,53`
- Modify: `tests/unit/shared/constants.test.ts:122,124`

**Step 1:** Update all `agoraId` → `agoraId` in validation tests.
Update `agora_agent_test` → `agora_agent_test`, `agora_test` → `agora_test`.

**Step 2:** Run tests: `npx vitest run`
Expected: ALL PASS

**Step 3:** Commit
```bash
git add tests/
git commit -m "test: update tests for agoraId rename"
```

### Task 0.6: Rename display strings and package/process names

**Files:**
- Modify: `package.json:2`
- Modify: `ecosystem.config.cjs:4`
- Modify: `src/server/config.ts:17`
- Modify: `src/client/pages/ObserverPage.tsx:275`
- Modify: `src/client/pages/TrainingPage.tsx:619`
- Modify: `src/client/components/Layout.tsx:466`
- Modify: `src/db/seed.placeholder.ts:160,206`

**Step 1:** `package.json:2` — `"agora-bench"` → `"agora-bench"`

**Step 2:** `ecosystem.config.cjs:4` — `'agora-bench'` → `'agora-bench'`
NOTE: After merge, must run `pm2 delete agora-bench && pm2 start ecosystem.config.cjs`

**Step 3:** `src/server/config.ts:17` — `'agora-agent'` → `'agora-agent'`

**Step 4:** `ObserverPage.tsx:275` — `AGORA BENCH` → `AGORA BENCH`

**Step 5:** `TrainingPage.tsx:619` — `Agora Bench ... Agora Ecosystem` →
`Agora Bench ... Agora Ecosystem`

**Step 6:** `Layout.tsx:466` — `Agora Ecosystem` → `Agora Ecosystem`

**Step 7:** `seed.placeholder.ts` — Update display strings.

**Step 8:** Commit
```bash
git add package.json ecosystem.config.cjs src/
git commit -m "refactor: rename display strings and package name to Agora Bench"
```

### Task 0.7: Update docs (batch)

**Files:**
- Modify: All 26+ markdown files in `docs/`

**Step 1:** Find and replace across all docs:
- "Agora Bench" → "Agora Bench"
- "AgoraBench" → "AgoraBench"
- "agora-bench" → "agora-bench"
- "Moltbook" → "Agora" (except where referring to the in-world currency MoltDollar)

**Step 2:** Review each file for context-sensitive replacements.

**Step 3:** Commit
```bash
git add docs/
git commit -m "docs: rename all Agora Bench references to Agora Bench"
```

### Task 0.8: Build, test, and create PR

**Step 1:** Full build: `npm run build`
**Step 2:** Full test: `npx vitest run`
**Step 3:** Push and create PR to main.

---

## Phase 1: Scenario Engine

Branch: `feature/benchmark-scenarios` (from `main` after Phase 0 merge)

### Task 1.1: Create benchmark DB schema

**Files:**
- Create: `src/db/schema/benchmark.ts`

**Step 1:** Write the schema file with two tables:

```typescript
import { pgTable, text, integer, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const benchmarkScenarios = pgTable('benchmark_scenarios', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  worldConfig: jsonb('world_config').notNull().default({}),
  agentConfig: jsonb('agent_config').notNull().default({}),
  seedData: jsonb('seed_data').notNull().default({}),
  runLength: integer('run_length').notNull().default(100),
  metrics: jsonb('metrics').notNull().default({}),
  events: jsonb('events').notNull().default([]),
  difficulty: text('difficulty').notNull().default('medium'),
  category: text('category').notNull().default('outcome'),
  tier: integer('tier').notNull().default(1),
  isBuiltIn: boolean('is_built_in').notNull().default(false),
  createdBy: text('created_by').default('system'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const benchmarkRuns = pgTable('benchmark_runs', {
  id: text('id').primaryKey(),
  scenarioId: text('scenario_id').notNull().references(() => benchmarkScenarios.id),
  status: text('status').notNull().default('queued'),
  modelEndpoint: text('model_endpoint'),
  modelName: text('model_name').notNull(),
  modelBackend: text('model_backend').notNull().default('internal'),
  configHash: text('config_hash').notNull(),
  agentAssignment: jsonb('agent_assignment').default('all'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  ticksCompleted: integer('ticks_completed').default(0),
  metricsReport: jsonb('metrics_report'),
  rawData: jsonb('raw_data'),
  error: text('error'),
  triggeredBy: text('triggered_by').notNull().default('admin'),
  callbackUrl: text('callback_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

**Step 2:** Export from `src/db/schema/index.ts`

**Step 3:** Generate and apply migration:
```bash
npx drizzle-kit generate
npx drizzle-kit push
```

**Step 4:** Commit
```bash
git add src/db/schema/ drizzle/
git commit -m "feat(benchmark): add scenarios and runs DB tables"
```

### Task 1.2: Seed built-in scenarios

**Files:**
- Create: `src/db/seedBenchmarkScenarios.ts`

**Step 1:** Write seed file with all 20 scenarios. Tier 1 scenarios (8) get
full worldConfig and metrics. Tier 2/3 scenarios get description and metadata
only (stubs).

Each scenario includes:
- `worldConfig`: overrides for `GOVERNANCE_PROBABILITIES`, economy settings,
  congress size, party composition
- `agentConfig`: alignment distribution, number of agents per alignment
- `metrics`: which metrics to compute and their weights for composite score
- `events`: empty array for Tier 1, populated for Tier 2

**Step 2:** Add seed function call to main seed flow or create standalone script.

**Step 3:** Run seed: `npx tsx src/db/seedBenchmarkScenarios.ts`

**Step 4:** Commit
```bash
git add src/db/seedBenchmarkScenarios.ts
git commit -m "feat(benchmark): seed 20 built-in scenarios"
```

### Task 1.3: Scenario CRUD routes

**Files:**
- Create: `src/server/routes/benchmark.ts`
- Modify: `src/server/routes/index.ts`

**Step 1:** Create benchmark route file with:
- `GET /benchmark/scenarios` — list all scenarios (public)
- `GET /benchmark/scenarios/:id` — get single scenario (public)
- `POST /benchmark/scenarios` — create scenario (requireOwner)
- `PUT /benchmark/scenarios/:id` — update scenario (requireOwner)
- `DELETE /benchmark/scenarios/:id` — delete non-built-in (requireOwner)

**Step 2:** Mount in `src/server/routes/index.ts`:
```typescript
import benchmarkRouter from './benchmark';
router.use('/benchmark', benchmarkRouter);
```

**Step 3:** Test with curl:
```bash
curl http://localhost:3001/api/benchmark/scenarios | jq '.length'
# Expected: 20
```

**Step 4:** Commit
```bash
git add src/server/routes/benchmark.ts src/server/routes/index.ts
git commit -m "feat(benchmark): scenario CRUD API endpoints"
```

---

## Phase 2: Metrics Engine

Branch: `feature/benchmark-metrics` (from `main` after Phase 1 merge)

### Task 2.1: Define metric types

**Files:**
- Create: `src/server/services/benchmarkMetrics.ts`

**Step 1:** Define TypeScript interfaces for all three metric buckets:

```typescript
export interface OutcomeMetrics {
  billPassageRate: number;
  committeeKillRate: number;
  vetoRate: number;
  timeToLaw: number;
  crossPartyYeaRate: number;
  polarizationIndex: number;
  coalitionStability: number | null;
  approvalInequality: number;
  treasuryHealth: number;
  deficitTrajectory: number;
}

export interface AgentMetrics {
  actionValidityRate: number;
  successRate: number;
  latencyP50: number;
  latencyP90: number;
  latencyP99: number;
  costPerDecision: number;
  reasoningQuality: number;
  legislativeIndependence: number;
  governanceQuality: number;
}

export interface CoordinationMetrics {
  partyDiscipline: number;
  coalitionFormation: number;
  defectionRate: number;
  adversarialResilience: number | null;
}

export interface BenchmarkReport {
  scenarioId: string;
  runId: string;
  modelName: string;
  modelBackend: string;
  configHash: string;
  ticksCompleted: number;
  duration: string;
  outcome: OutcomeMetrics;
  agent: AgentMetrics;
  coordination: CoordinationMetrics;
  composite: number;
  grade: string;
}
```

**Step 2:** Commit
```bash
git add src/server/services/benchmarkMetrics.ts
git commit -m "feat(benchmark): define metric type interfaces"
```

### Task 2.2: Implement outcome metric calculators

**Files:**
- Modify: `src/server/services/benchmarkMetrics.ts`
- Create: `tests/unit/server/benchmarkMetrics.test.ts`

**Step 1:** Write tests for each outcome metric calculator. Use mock
simulation data (arrays of bills, votes, laws, etc.).

**Step 2:** Implement each calculator as a pure function:
- `computeBillPassageRate(bills, laws)` → number
- `computeCommitteeKillRate(bills)` → number
- `computeVetoRate(bills)` → number
- `computeTimeToLaw(bills, laws, tickLog)` → number
- `computeCrossPartyYeaRate(votes, agents, partyMemberships)` → number
- `computePolarizationIndex(votes, partyMemberships)` → number
- `computeApprovalInequality(agents)` → number (Gini coefficient)
- `computeTreasuryHealth(startTreasury, endTreasury)` → number
- `computeDeficitTrajectory(treasurySnapshots)` → number (linear regression slope)

**Step 3:** Run tests: `npx vitest run tests/unit/server/benchmarkMetrics.test.ts`

**Step 4:** Commit
```bash
git add src/server/services/benchmarkMetrics.ts tests/
git commit -m "feat(benchmark): outcome metric calculators with tests"
```

### Task 2.3: Implement agent and coordination metric calculators

**Files:**
- Modify: `src/server/services/benchmarkMetrics.ts`
- Modify: `tests/unit/server/benchmarkMetrics.test.ts`

**Step 1:** Write tests, then implement:
- Agent metrics: mostly expand existing DEMOS calculations
- Coordination metrics: `computePartyDiscipline`, `computeDefectionRate`,
  `computeCoalitionFormation`
- Composite scorer: `computeComposite(outcome, agent, coordination, weights)` → number
- Grade mapper: `compositeToGrade(score)` → "A+".."F"

**Step 2:** Run tests: `npx vitest run tests/unit/server/benchmarkMetrics.test.ts`

**Step 3:** Commit
```bash
git add src/server/services/benchmarkMetrics.ts tests/
git commit -m "feat(benchmark): agent + coordination metrics with composite scorer"
```

---

## Phase 3: Benchmark Runner

Branch: `feature/benchmark-runner` (from `main` after Phase 2 merge)

### Task 3.1: Extract simulation tick logic into pure functions

**Files:**
- Create: `src/server/services/simulationCore.ts`
- Modify: `src/server/jobs/agentTick.ts` (refactor to call shared functions)

This is the critical refactor. The existing `agentTick.ts` has simulation logic
interleaved with DB reads/writes. We need to extract the core logic into pure
functions that both the live tick and the benchmark runner can call.

**Step 1:** Identify the core simulation phases in `agentTick.ts`:
- Bill proposal phase
- Whip signal phase
- Bill voting phase
- Committee review phase
- Presidential review phase
- Veto override phase
- Judicial review phase
- Campaign phase
- Forum post phase
- Election management phase
- Economy phase

**Step 2:** For each phase, create a pure function that:
- Takes: world state object + agent list + config
- Returns: list of mutations (state changes to apply)
- Does NOT read from or write to DB directly

**Step 3:** Refactor `agentTick.ts` to:
1. Read world state from DB into an object
2. Call pure phase functions
3. Write mutations back to DB

**Step 4:** Run existing tests to ensure no regression:
```bash
npx vitest run
```

**Step 5:** Commit
```bash
git add src/server/services/simulationCore.ts src/server/jobs/agentTick.ts
git commit -m "refactor: extract simulation tick logic into pure functions"
```

### Task 3.2: Create benchmark world state manager

**Files:**
- Create: `src/server/services/benchmarkWorldState.ts`

**Step 1:** Define an in-memory world state class:

```typescript
export class BenchmarkWorldState {
  agents: Agent[];
  bills: Bill[];
  laws: Law[];
  votes: BillVote[];
  parties: Party[];
  partyMemberships: PartyMembership[];
  positions: Position[];
  elections: Election[];
  campaigns: Campaign[];
  treasury: number;
  taxRate: number;
  decisions: AgentDecision[];
  approvalEvents: ApprovalEvent[];
  tickLog: TickLogEntry[];
  events: BenchmarkEvent[];

  constructor(scenario: BenchmarkScenario) { /* init from scenario config */ }
  applyMutations(mutations: Mutation[]) { /* apply state changes */ }
  snapshot(): WorldStateSnapshot { /* serializable copy for metrics */ }
}
```

**Step 2:** Commit
```bash
git add src/server/services/benchmarkWorldState.ts
git commit -m "feat(benchmark): in-memory world state manager"
```

### Task 3.3: Create benchmark runner service

**Files:**
- Create: `src/server/services/benchmarkRunner.ts`
- Create: `src/server/jobs/benchmarkJob.ts`

**Step 1:** Create the runner that:
1. Loads scenario from DB
2. Creates `BenchmarkWorldState` from scenario config
3. Runs tick loop calling `simulationCore` pure functions
4. For external model agents: calls `modelEndpoint` via HTTP
5. For internal agents: calls `ai.ts` service
6. After each tick: records decisions, computes per-tick metrics
7. After final tick: computes full `BenchmarkReport`
8. Saves results to `benchmark_runs` table
9. If `callbackUrl`: POSTs results

**Step 2:** Create Bull job wrapper in `benchmarkJob.ts`:
```typescript
const benchmarkQueue = new Queue('benchmark', { connection: redis });

benchmarkQueue.process(async (job) => {
  const runner = new BenchmarkRunner(job.data);
  await runner.execute();
});
```

**Step 3:** Commit
```bash
git add src/server/services/benchmarkRunner.ts src/server/jobs/benchmarkJob.ts
git commit -m "feat(benchmark): runner service with Bull job queue"
```

### Task 3.4: Add WebSocket progress events

**Files:**
- Modify: `src/shared/constants.ts` (add WS events)
- Modify: `src/server/services/benchmarkRunner.ts`

**Step 1:** Add WebSocket events:
```typescript
// In WS_EVENTS
BENCHMARK_PROGRESS: 'benchmark:progress',
BENCHMARK_COMPLETE: 'benchmark:complete',
BENCHMARK_FAILED: 'benchmark:failed',
```

**Step 2:** Broadcast progress during run execution (every tick).

**Step 3:** Commit
```bash
git add src/shared/constants.ts src/server/services/benchmarkRunner.ts
git commit -m "feat(benchmark): WebSocket progress events"
```

---

## Phase 4: API Handshake

Branch: `feature/benchmark-api` (from `main` after Phase 3 merge)

### Task 4.1: Benchmark run endpoints

**Files:**
- Modify: `src/server/routes/benchmark.ts`

**Step 1:** Add endpoints to existing benchmark route file:

```typescript
// POST /benchmark/run — trigger a benchmark run
// Accepts: scenarioId, modelEndpoint, modelName, modelBackend, agentAssignment, runs, callbackUrl
// Returns: runIds[], status, estimatedDuration

// GET /benchmark/results/:runId — fetch results
// Returns: full BenchmarkReport or status if still running

// GET /benchmark/runs — list all runs with filters
// Query params: scenarioId, modelName, status, limit, offset

// GET /benchmark/runs/:runId/export — download raw data as JSONL

// GET /benchmark/leaderboard — model rankings
// Query params: scenarioId (optional filter)
```

**Step 2:** Test each endpoint with curl:
```bash
# Trigger a run
curl -X POST http://localhost:3001/api/benchmark/run \
  -H "Content-Type: application/json" \
  -d '{"scenarioId":"benchmark-classic","modelName":"claude-haiku","modelBackend":"internal","runs":1}'

# Check results
curl http://localhost:3001/api/benchmark/results/run-xxx | jq
```

**Step 3:** Commit
```bash
git add src/server/routes/benchmark.ts
git commit -m "feat(benchmark): run trigger and results API endpoints"
```

### Task 4.2: External model adapter

**Files:**
- Create: `src/server/services/externalModelAdapter.ts`

**Step 1:** Create adapter that formats the `agent_step` contract as a chat
completion request to any OpenAI-compatible endpoint:

```typescript
export async function callExternalModel(
  endpoint: string,
  agentStep: AgentStepRequest,
  modelName: string,
): Promise<AgentStepResponse> {
  // Format as chat completion
  const messages = [
    { role: 'system', content: buildSystemPrompt(agentStep) },
    { role: 'user', content: buildUserPrompt(agentStep) },
  ];

  const response = await fetch(`${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages,
      max_tokens: 1000,
      temperature: 0.7,
    }),
  });

  // Parse structured response from model output
  return parseAgentStepResponse(await response.json());
}
```

**Step 2:** Commit
```bash
git add src/server/services/externalModelAdapter.ts
git commit -m "feat(benchmark): external model adapter for agent_step contract"
```

---

## Phase 5: Event Injection

Branch: `feature/benchmark-events` (from `main` after Phase 4 merge)

### Task 5.1: Event processor

**Files:**
- Create: `src/server/services/benchmarkEventProcessor.ts`

**Step 1:** Create event processor that handles each event type:

```typescript
export function processEvent(
  event: BenchmarkEvent,
  worldState: BenchmarkWorldState,
): { mutations: Mutation[]; observationContext: string } {
  switch (event.type) {
    case 'crisis':
      return handleCrisis(event.payload, worldState);
    case 'agent_injection':
      return handleAgentInjection(event.payload, worldState);
    case 'external_pressure':
      return handleExternalPressure(event.payload, worldState);
    case 'media_event':
      return handleMediaEvent(event.payload, worldState);
    case 'rule_change':
      return handleRuleChange(event.payload, worldState);
  }
}
```

**Step 2:** Each handler returns:
- `mutations`: changes to world state (treasury drain, approval delta, etc.)
- `observationContext`: text injected into agent observations ("BREAKING: ...")

**Step 3:** Integrate into BenchmarkRunner tick loop (check events each tick).

**Step 4:** Commit
```bash
git add src/server/services/benchmarkEventProcessor.ts
git commit -m "feat(benchmark): event injection processor"
```

### Task 5.2: Populate Tier 2 scenario events

**Files:**
- Modify: `src/db/seedBenchmarkScenarios.ts`

**Step 1:** Add event arrays to Tier 2 scenarios:
- Civil Liberties: security crisis at tick 5, emergency powers proposal at tick 10
- Populist Wave: charismatic agent injection at tick 1, media bias events
- Crisis Cascade: pandemic tick 10, disaster tick 20, financial crash tick 30
- Adversarial: rogue agent injection at tick 5
- International Pressure: IMF demands at tick 15, sanctions threat at tick 25

**Step 2:** Update Tier 2 scenarios to `tier: 2` (active, not "coming soon").

**Step 3:** Re-run seed: `npx tsx src/db/seedBenchmarkScenarios.ts`

**Step 4:** Commit
```bash
git add src/db/seedBenchmarkScenarios.ts
git commit -m "feat(benchmark): populate Tier 2 scenario events"
```

---

## Phase 6: Frontend — Benchmark Dashboard

Branch: `feature/benchmark-dashboard` (from `main` after Phase 5 merge)

### Task 6.1: API client functions

**Files:**
- Modify: `src/client/lib/api.ts`

**Step 1:** Add `benchmarkApi` namespace:
```typescript
export const benchmarkApi = {
  scenarios: () => get<BenchmarkScenario[]>('/benchmark/scenarios'),
  scenario: (id: string) => get<BenchmarkScenario>(`/benchmark/scenarios/${id}`),
  triggerRun: (data: TriggerRunRequest) => post('/benchmark/run', data),
  runs: (params?: RunFilterParams) => get<BenchmarkRun[]>('/benchmark/runs', params),
  results: (runId: string) => get<BenchmarkReport>(`/benchmark/results/${runId}`),
  leaderboard: (scenarioId?: string) => get('/benchmark/leaderboard', { scenarioId }),
};
```

**Step 2:** Commit
```bash
git add src/client/lib/api.ts
git commit -m "feat(benchmark): client API functions"
```

### Task 6.2: Benchmark page scaffold

**Files:**
- Create: `src/client/pages/BenchmarkPage.tsx`
- Modify: `src/client/App.tsx` (add route)
- Modify: `src/client/components/Layout.tsx` (add nav link)

**Step 1:** Create `BenchmarkPage.tsx` with 4 tabs:
- Scenarios — list all scenarios with tier badges, difficulty, category
- Runs — active + historical runs with status indicators
- Results — metrics reports, comparison view
- API — endpoint documentation, test panel

Follow existing design patterns from `AdminPage.tsx` and `ResearcherPage.tsx`:
card layout, gold accents, monospace scores, serif headings.

**Step 2:** Add route in `App.tsx`: `<Route path="/benchmark" element={<BenchmarkPage />} />`

**Step 3:** Add nav link in `Layout.tsx` with keyboard shortcut `b: '/benchmark'`,
gated to owner + researcher roles.

**Step 4:** Commit
```bash
git add src/client/pages/BenchmarkPage.tsx src/client/App.tsx src/client/components/Layout.tsx
git commit -m "feat(benchmark): dashboard page with 4-tab layout"
```

### Task 6.3: Scenarios tab implementation

**Files:**
- Modify: `src/client/pages/BenchmarkPage.tsx`

**Step 1:** Implement scenarios tab:
- Grid of scenario cards with name, description, difficulty badge, tier badge
- Tier 1 scenarios: full details + "Launch Run" button
- Tier 2 scenarios: full details + "Launch Run" button (after Phase 5)
- Tier 3 scenarios: grayed out with "Coming Soon" badge
- Owner-only: "Create Scenario" button + edit/delete for custom scenarios

**Step 2:** Commit
```bash
git add src/client/pages/BenchmarkPage.tsx
git commit -m "feat(benchmark): scenarios tab with cards and launch button"
```

### Task 6.4: Runs tab with real-time progress

**Files:**
- Modify: `src/client/pages/BenchmarkPage.tsx`

**Step 1:** Implement runs tab:
- Active runs: progress bar (from WebSocket `benchmark:progress`), model info
- Completed runs: status badge, duration, composite score, model name
- Failed runs: error message
- Filter by: scenario, model, status
- Click run → expands to show full metrics report

**Step 2:** Commit
```bash
git add src/client/pages/BenchmarkPage.tsx
git commit -m "feat(benchmark): runs tab with real-time progress"
```

### Task 6.5: Results tab with comparison

**Files:**
- Modify: `src/client/pages/BenchmarkPage.tsx`

**Step 1:** Implement results tab:
- Leaderboard view: models ranked by composite score
- Per-scenario breakdown: radar chart of metric buckets
- Side-by-side comparison: pick 2 models, see all metrics compared
- Export: download results as JSON

**Step 2:** Commit
```bash
git add src/client/pages/BenchmarkPage.tsx
git commit -m "feat(benchmark): results tab with leaderboard and comparison"
```

### Task 6.6: API documentation tab

**Files:**
- Modify: `src/client/pages/BenchmarkPage.tsx`

**Step 1:** Implement API tab:
- Endpoint documentation (method, URL, request/response examples)
- Interactive test panel: enter model endpoint URL, pick scenario, fire run
- Code examples (curl, Python, TypeScript)
- Link to Spark MC integration docs

**Step 2:** Commit
```bash
git add src/client/pages/BenchmarkPage.tsx
git commit -m "feat(benchmark): API documentation tab"
```

---

## Post-Implementation

### Verification

After all phases merged:

1. **Rename verification:**
   - `grep -ri "agora" src/` returns 0 results
   - `grep -ri "molt.government" src/` returns 0 results (MoltDollar is OK)
   - All tests pass: `npx vitest run`
   - Full build succeeds: `npm run build`

2. **Benchmark verification:**
   - Scenario list: `curl /api/benchmark/scenarios` returns 20 scenarios
   - Trigger internal run: `POST /api/benchmark/run` with internal model
   - Results returned with all 3 metric buckets + composite score
   - Dashboard loads at `/benchmark` with all 4 tabs

3. **Spark MC integration verification:**
   - Trigger run with Spark MC model endpoint
   - Results callback received by Spark MC
   - Leaderboard shows both internal and external model scores

### Production deployment

1. Merge all PRs to main
2. `pm2 delete agora-bench` (old process name)
3. `npm run build`
4. `pm2 start ecosystem.config.cjs`
5. Verify at https://agorabench.com/benchmark
