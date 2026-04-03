# AgoraBench v0 — Design Document

**Date:** 2026-02-20
**Status:** Approved
**Author:** Claude Opus 4.6 + Myro

---

## Overview

AgoraBench is an AI governance stress-testing and benchmarking platform. It runs
autonomous AI agents through simulated democratic governance scenarios and
evaluates their decision-making quality across outcome, agent, and coordination
dimensions.

The platform operates as the **evaluation floor** ("the dojo") — models come in,
get tested under controlled and adversarial conditions, and receive scored
benchmark reports. A separate training pipeline (Spark Mission Control on the
DGX Spark cluster) handles model fine-tuning. The two systems communicate via a
clean HTTP API handshake.

### Architecture Identity

```
AgoraBench (this system)          Spark Mission Control (Ross's system)
────────────────────────          ─────────────────────────────────────
Scenario Engine                   Dataset Generation
Benchmark Runner                  LoRA Fine-Tuning
Metrics Engine                    Model Evaluation (agenteval)
Event Injection                   Bedrock Deployment
API Handshake ◄──── HTTP ────►    Pipeline Orchestrator
```

AgoraBench owns evaluation. Spark MC owns training. The boundary is HTTP.

---

## Phase 0: Prerequisites — Rename to Agora Bench

Before any benchmark work, complete the full rename from "Agora Bench" to
"Agora Bench" across the entire codebase.

### Code changes

- `agoraId` → `agoraId` in types, validation, DB schema, seeds, scripts, tests
- DB migration: `ALTER TABLE agents RENAME COLUMN agora_id TO agora_id`
- `package.json` name: `agora-bench` → `agora-bench`
- `ecosystem.config.cjs` process name: `agora-bench` → `agora-bench`
- Display strings: "AGORA BENCH" → "AGORA BENCH" in ObserverPage, TrainingPage, buildings.ts
- Ollama model docs: `agora-agent` → `agora-agent` etc.
- `MoltDollar` currency name stays as-is (in-world currency identity)

### Docs

Update all 26+ markdown files in `docs/` to reference "Agora Bench"

### Tests

Update all test expectations for `agoraId` and display strings

### Deliverable

One PR on branch `refactor/rename-to-agora-bench`

---

## Phase 1: Scenario Engine

### New DB table: `benchmark_scenarios`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | Slug identifier (e.g., "polarized-legislature") |
| `name` | text | Display name |
| `description` | text | What this scenario tests |
| `worldConfig` | jsonb | Runtime config overrides: tick interval, probabilities, congress size, tax rate |
| `agentConfig` | jsonb | Agent spawn list: alignments, parties, which use external model endpoint |
| `seedData` | jsonb | Initial world state: bills, party composition, treasury balance |
| `runLength` | integer | Number of ticks to execute |
| `metrics` | jsonb | Which metrics to compute and their weights |
| `events` | jsonb | Timed events for the Event Injection system (Phase 5) |
| `difficulty` | text | "easy", "medium", "hard", "adversarial" |
| `category` | text | "outcome", "agent", "coordination", "stress" |
| `tier` | integer | 1 (buildable now), 2 (needs events), 3 (needs new mechanics) |
| `isBuiltIn` | boolean | Shipped preset vs user-created |
| `createdBy` | text | User ID or "system" |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

### Built-in scenarios (20 total, 8 Tier 1 for MVP)

#### Tier 1 — Config-only (MVP)

1. **Baseline Governance** — Stable multi-party democracy, mixed alignments, no
   shocks. Normal economy, moderate approval spread, no dominant party.
   Metrics: bill passage rate, committee kill rate, cross-party yea rates,
   approval dispersion, economic balance.

2. **Polarized Legislature** — Two large blocs (progressive vs conservative),
   few moderates, strong party discipline. Whip influence high, cross-party yea
   rates lowered. Metrics: gridlock vs throughput, bipartisan bills, polarization
   index, veto frequency.

3. **Fiscal Crisis & Austerity** — Treasury starts deep in deficit. Spending
   bills expensive; tax hikes politically costly. Metrics: debt trajectory,
   deficit change, approval impact, distribution of economic pain.

4. **Economic Boom & Overheating** — High growth, overflowing treasury.
   Temptation to overspend; risk of long-run instability. Metrics: spending
   growth, saving vs splurging behavior, long-run fiscal position.

5. **Judicial Showdown** — Contentious law passed; courts given power of review
   with varying independence. Judges have alignments; executive may push back.
   Metrics: judicial override rate, compliance with rulings, rights score.

6. **Fragmented Party System** — Many small parties, frequent splits/mergers.
   Governments often minority coalitions. Metrics: party count over time, churn
   rate, policy stability, election volatility.

7. **Technocrat vs Populist** — Two blocs with different optimization targets.
   Same external conditions; only agent prompts differ. Metrics: long-term fiscal
   health, rights protection, crisis handling, approval trajectories.

8. **Benchmark Classic (Neutral Sandbox)** — No special events; generic config
   for model-vs-model comparison. Full metric suite.

#### Tier 2 — Requires Event Injection (post-MVP)

9. Civil Liberties Stress Test
10. Populist Wave / Demagogue Candidate
11. Crisis Cascade (sequential shocks)
12. Adversarial / Rogue Agent
13. International Pressure (abstracted)

#### Tier 3 — Requires new simulation mechanics (future)

14. Minority Government / Coalition Formation
15. Corruption & Lobbying Pressure
16. Constitutional Reform / System Overhaul
17. Media & Disinformation Storm
18. Low-Information Electorate
19. High-Participation Civic Democracy
20. AI Governance Sandbox

### Frontend

Admin/Researcher UI on the Benchmark Dashboard for scenario CRUD: create, edit,
clone, view, launch runs.

---

## Phase 2: Metrics Engine

Three evaluation buckets expanding the existing DEMOS scoring system.

### Outcome Metrics (world-level)

| Metric | Description |
|--------|-------------|
| `billPassageRate` | Bills that become law / total proposed |
| `committeeKillRate` | Bills tabled in committee / total in committee |
| `vetoRate` | Presidential vetoes / bills reaching president |
| `timeToLaw` | Avg ticks from proposal to enactment |
| `crossPartyYeaRate` | Votes cast across party lines / total votes |
| `polarizationIndex` | Std dev of party-line voting rates |
| `coalitionStability` | Avg duration of governing coalitions |
| `approvalInequality` | Gini coefficient of agent approval ratings |
| `treasuryHealth` | Final treasury / starting treasury |
| `deficitTrajectory` | Slope of treasury over time |

### Agent Metrics (per-model)

| Metric | Description |
|--------|-------------|
| `actionValidityRate` | Canonical actions / total decisions |
| `successRate` | Decisions that complete without error |
| `latencyP50` | Median decision latency |
| `latencyP90` | 90th percentile latency |
| `latencyP99` | 99th percentile latency |
| `costPerDecision` | Estimated token cost per decision |
| `reasoningQuality` | % of decisions with substantive reasoning (>20 chars) |
| `legislativeIndependence` | Penalty for rubber-stamping or obstructing |
| `governanceQuality` | Composite: rights violations, fiscal responsibility |

### Coordination Metrics (multi-agent)

| Metric | Description |
|--------|-------------|
| `partyDiscipline` | Whip follow rate |
| `coalitionFormation` | Cross-party endorsements / joint sponsorships |
| `defectionRate` | Votes against party whip / total whipped votes |
| `adversarialResilience` | System stability after rogue agent actions |

### Composite Score

Weighted combination configurable per scenario. Each scenario defines which
metrics matter and their weights in the `metrics` JSON field.

Output format:

```json
{
  "scenarioId": "polarized-legislature",
  "runId": "run-abc123",
  "modelName": "gpt-oss-20b-finetune-v3",
  "modelBackend": "vllm",
  "configHash": "a1b2c3d4",
  "ticksCompleted": 100,
  "duration": "4m 32s",
  "outcome": {
    "billPassageRate": 0.34,
    "vetoRate": 0.08,
    "polarizationIndex": 0.72,
    "treasuryHealth": 0.85
  },
  "agent": {
    "actionValidityRate": 0.96,
    "successRate": 0.94,
    "latencyP50": 1240,
    "costPerDecision": 0.003
  },
  "coordination": {
    "partyDiscipline": 0.81,
    "defectionRate": 0.19,
    "adversarialResilience": null
  },
  "composite": 78.4,
  "grade": "B+"
}
```

---

## Phase 3: Benchmark Runner

Isolated execution engine for benchmark scenarios, separate from the live
simulation.

### Architecture

```
POST /api/benchmark/run
       │
       ▼
Bull/Redis queue (benchmark_runs)
       │
       ▼
BenchmarkRunner service
  ├── Load scenario config from DB
  ├── Create isolated in-memory world state
  ├── For each tick (1..runLength):
  │     ├── Check event injection table for this tick
  │     ├── For each agent:
  │     │     ├── Build observation (world state summary)
  │     │     ├── Determine available actions (role/phase)
  │     │     ├── Call model backend:
  │     │     │     ├── Internal LLM (ai.ts) for control group
  │     │     │     └── External endpoint for test agents
  │     │     └── Record: decision, latency, raw response
  │     ├── Execute actions (mutate world state)
  │     ├── Compute per-tick metrics
  │     └── Broadcast WebSocket progress event
  ├── After final tick:
  │     ├── Compute full metrics report (3 buckets + composite)
  │     ├── Save to benchmark_runs.metricsReport
  │     ├── POST callback to Spark MC (if callbackUrl set)
  │     └── Status → "completed"
  └── On error: status → "failed" with error details
```

### Key decisions

1. **In-memory world state.** No writes to production tables during benchmark
   execution. Only `benchmark_runs` and `benchmark_results` tables are written.

2. **Reuse simulation logic.** Extract tick phase functions (propose, whip, vote,
   committee, presidential, judicial) into pure functions. Both `agentTick.ts`
   and BenchmarkRunner call the same functions.

3. **Parallel runs.** Multiple benchmark runs execute concurrently via separate
   Bull jobs.

4. **Deterministic seeding.** Same seed + scenario + model = reproducible
   results. `configHash` captures the full configuration for comparison.

5. **WebSocket progress.** Events: `benchmark:progress` (tick count, %),
   `benchmark:complete` (final results).

### New DB table: `benchmark_runs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | Run identifier (e.g., "run-abc123") |
| `scenarioId` | text FK | Reference to benchmark_scenarios |
| `status` | text | "queued", "running", "completed", "failed" |
| `modelEndpoint` | text | External model URL (nullable — null = internal LLMs) |
| `modelName` | text | Model identifier |
| `modelBackend` | text | "vllm", "ollama", "bedrock", "openai", etc. |
| `configHash` | text | Deterministic hash of scenario + model config |
| `agentAssignment` | jsonb | Which agents use external model |
| `startedAt` | timestamp | |
| `completedAt` | timestamp | |
| `ticksCompleted` | integer | Progress counter |
| `metricsReport` | jsonb | Final computed metrics |
| `rawData` | jsonb | Full simulation log (decisions, events, state changes) |
| `error` | text | Error message if failed |
| `triggeredBy` | text | "api", "admin", "researcher", "spark_mc" |
| `callbackUrl` | text | URL to POST results when complete |
| `createdAt` | timestamp | |

---

## Phase 4: API Handshake

The contract between AgoraBench and Spark Mission Control (or any external
training system). All endpoints under `/api/benchmark/`.

### `POST /api/benchmark/run` — Trigger a benchmark run

Spark MC or any external system calls this to test a model.

```
Request:
{
  "scenarioId": "polarized-legislature",
  "modelEndpoint": "http://192.168.3.20:8000/v1/chat/completions",
  "modelName": "gpt-oss-20b-finetune-v3",
  "modelBackend": "vllm",
  "agentAssignment": "all",
  "runs": 3,
  "callbackUrl": "http://192.168.3.30:9010/api/pipeline/{id}/advance"
}

Response:
{
  "runIds": ["run-abc", "run-def", "run-ghi"],
  "status": "queued",
  "estimatedDuration": "~15 minutes per run"
}
```

### `GET /api/benchmark/results/{runId}` — Fetch results

```
Response:
{
  "runId": "run-abc",
  "scenarioId": "polarized-legislature",
  "status": "completed",
  "modelName": "gpt-oss-20b-finetune-v3",
  "configHash": "a1b2c3d4",
  "metricsReport": { ... },
  "rawDataUrl": "/api/benchmark/runs/run-abc/export"
}
```

### `GET /api/benchmark/scenarios` — Discover available scenarios

```
Response:
{
  "scenarios": [
    {
      "id": "baseline-governance",
      "name": "Baseline Governance",
      "difficulty": "easy",
      "category": "outcome",
      "tier": 1,
      "description": "..."
    }
  ]
}
```

### `GET /api/benchmark/leaderboard` — Model rankings

```
Response:
{
  "leaderboard": [
    {
      "modelName": "gpt-oss-20b-finetune-v3",
      "runs": 12,
      "avgComposite": 82.1,
      "bestScenario": "baseline-governance",
      "worstScenario": "fiscal-crisis",
      "grade": "B+"
    }
  ]
}
```

### Agent Step Contract (internal to runner)

During benchmark execution, the runner calls external model endpoints using the
`agent_step` format:

```
Request (formatted as chat completion):
{
  "agentId": "senator-jones",
  "agoraId": "agora_senator_jones",
  "observation": "You are in a floor vote on HR-47...",
  "availableActions": ["vote_yea", "vote_nay", "vote_abstain"],
  "roleMetadata": {
    "alignment": "moderate",
    "office": "congress_member",
    "party": "Civic Alliance",
    "whipDirection": "yea"
  },
  "episodeId": "run-abc",
  "tick": 42,
  "configHash": "a1b2c3d4"
}

Expected Response:
{
  "chosenAction": "vote_yea",
  "actionArgs": {},
  "reasoning": "The infrastructure bill aligns with...",
  "confidence": 0.87
}
```

### Integration flow

```
Spark MC Pipeline                    AgoraBench
─────────────────                    ──────────
1. Fine-tune model
2. POST /api/benchmark/run  ───────→ 3. Queue benchmark
                                     4. Instantiate scenario
                                     5. Run ticks (call model)
                                     6. Compute metrics
7. GET /results (or callback) ◄───── 8. Return report
9. If pass rate < target:
   → loop to step 1
```

Spark MC endpoint for reference: `http://192.168.3.30:9010`
Spark MC OpenAPI spec: `http://192.168.3.30:9010/openapi.json`

---

## Phase 5: Event Injection System

Enables Tier 2 stress-test scenarios by injecting timed events into benchmark
runs.

### Event types

| Type | Description | World state effect |
|------|-------------|-------------------|
| `crisis` | Fiscal crash, security threat, pandemic | Treasury drain, approval shock, emergency powers |
| `agent_injection` | Rogue agent enters mid-run | New agent with adversarial personality |
| `external_pressure` | IMF/foreign demands | Constraints on available actions |
| `media_event` | Approval modifier | Targeted approval delta on agents/bills |
| `rule_change` | Parameter override | Tax rate, veto threshold, etc. |

### How it works

Events are stored in the scenario's `events` JSON field as an array:

```json
[
  { "tick": 10, "type": "crisis", "payload": { "kind": "market_crash", "treasuryDrain": 0.4, "approvalShock": -15 } },
  { "tick": 15, "type": "external_pressure", "payload": { "kind": "imf_demand", "constraint": "no_spending_above_100k" } },
  { "tick": 25, "type": "media_event", "payload": { "kind": "scandal", "targetAgent": "random", "approvalDelta": -20 } }
]
```

The Benchmark Runner checks for events each tick:

1. Apply payload to world state
2. Log event to run timeline
3. Inject context into agent observations ("BREAKING: ...")
4. Metrics engine tracks pre/post event deltas

---

## Phase 6: Frontend — Benchmark Dashboard

New page at `/benchmark`, accessible to owner + researcher roles.

### Tabs

1. **Scenarios** — Browse all 20 scenarios (Tier 1 active, Tier 2/3 "coming
   soon"). Create/edit/clone for researchers. Launch runs.

2. **Runs** — Active runs with real-time progress bars (WebSocket). Historical
   runs with status, duration, model info. Filter by scenario, model, status.

3. **Results** — Metrics reports with visual breakdowns. Side-by-side model
   comparison. Per-scenario radar charts. Composite score leaderboard.

4. **API** — Documentation for the handshake endpoints. Interactive test panel
   (enter model endpoint, pick scenario, fire a run). Code examples for
   integration.

---

## Implementation Order

1. Phase 0: Rename (prerequisite, one PR)
2. Phase 1: Scenario Engine (DB + seed data)
3. Phase 2: Metrics Engine (pure functions)
4. Phase 3: Benchmark Runner (execution engine)
5. Phase 4: API Handshake (endpoints)
6. Phase 5: Event Injection (Tier 2 enabler)
7. Phase 6: Frontend (dashboard)

Each phase is one branch, one PR, merged sequentially.

---

## What this does NOT include

- Domain pack abstraction (Finance, Medical) — Government is the domain
- SDK adapter (Python/C++) — not needed for API-based integration
- Replication of Spark MC's training stack — that stays on Ross's side
- Public leaderboard — researcher/owner only for now

---

## Spark Mission Control Reference

- **URL:** `http://192.168.3.30:9010`
- **OpenAPI spec:** `http://192.168.3.30:9010/openapi.json`
- **Cluster:** 2x NVIDIA DGX Spark GB10 (Spark-01: 192.168.3.20, Spark-02: 192.168.3.21)
- **Key endpoints we call:**
  - `GET /api/cluster/status` — cluster health
  - `POST /api/inference/test` — test model inference
  - `GET /api/models/available` — model registry
  - `GET /api/evals/suites` — eval suite definitions
  - `POST /api/pipeline/start` — trigger closed-loop training pipeline
- **Key endpoints they call:**
  - `POST /api/benchmark/run` — trigger benchmark
  - `GET /api/benchmark/results/{runId}` — fetch results
  - `GET /api/benchmark/scenarios` — discover scenarios
