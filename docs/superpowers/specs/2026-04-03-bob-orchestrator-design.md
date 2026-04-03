# Design: Bob as Simulation Orchestrator

**Date:** 2026-04-03
**Status:** Approved
**Scope:** Bob observer fix, orchestrator API, MCP event injection, AGGE retirement

---

## Architecture Overview

Bob (OpenClaw/NemoClaw on DGX Spark 2) becomes the full game master for the Agora Bench simulation running on the Linux desktop (10.0.0.10). Bob communicates via REST API — no MCP server needed on the simulation side.

**Infrastructure:**
- Spark 1 (10.0.0.69:8000) — Qwen 72B AWQ, serves simulation agent LLM calls
- Spark 2 (Ross's machine) — Qwen 72B AWQ + OpenClaw/NemoClaw, runs Bob
- Linux desktop (10.0.0.10) — Agora Bench simulation (API on port 3001, frontend on 5173)
- Cloudflare tunnel — https://agorabench.com

**Communication flow:**
```
Bob (Spark 2) --HTTP--> Agora Bench API (10.0.0.10:3001)
  POST /api/orchestrator/observe   → reads simulation state
  POST /api/orchestrator/intervene → modifies simulation
  GET  /api/orchestrator/history   → reviews own past actions
```

---

## Section 1: Fix Bob Observer Pipeline

### Problem

The `agorabench-observer` cron job on Spark 2 fails because:
1. `web_fetch` tool blocks private IPs (10.0.0.10)
2. 180s timeout too short for Qwen to reason + fetch + write

### Fix

Update the AGORABENCH.md workspace file on Spark 2 to:
1. Instruct Bob to use `exec` + `curl` instead of `web_fetch`
2. List the specific API endpoints to observe
3. Define report format and output location

Update the cron job config:
1. Increase timeout from 180s to 600s
2. Re-enable the job
3. Change schedule from every 30 min to every 15 min (more frequent observation)

### Observation Endpoints (no auth required)

These are public API endpoints Bob reads:
- `GET /api/government/overview` — branches, positions, treasury
- `GET /api/activity?limit=20` — recent simulation events
- `GET /api/legislation?page=1&limit=20` — bill pipeline
- `GET /api/agents/directory` — all agents with status
- `GET /api/agents/coalitions` — voting blocs and alignment matrix
- `GET /api/agents/relationships/summary` — top alliances and rivalries
- `GET /api/elections/active` — current elections
- `GET /api/forum/threads?limit=10` — recent forum discourse

### Observation Report Format

Bob writes markdown reports to `/sandbox/.openclaw/shared/agora-reports/`:
```
YYYY-MM-DD-HHmm-observation.md
```

Report structure:
- Simulation health (tick timing, error rate)
- Political landscape (coalitions, power balance)
- Legislative activity (bills in pipeline, recent laws)
- Agent behavior patterns (who's active, who's drifting)
- Recommendations (what interventions Bob would make)

### Files to modify

- Update AGORABENCH.md on Spark 2: `/home/bob-spark-ai-2/.nemoclaw/recovery/AGORABENCH.md`
- Update cron job in OpenClaw container: `/root/.openclaw/cron/jobs.json`

---

## Section 2: Orchestrator API

### Authentication

New env var: `BOB_ORCHESTRATOR_KEY` — a random bearer token shared between the simulation and Bob's workspace.

Middleware: `requireOrchestrator` — checks `Authorization: Bearer <key>` header against `BOB_ORCHESTRATOR_KEY`. Separate from Clerk auth. Falls through to `requireOwner` if no orchestrator key matches (so the admin panel still works).

### Endpoints

#### POST /api/orchestrator/observe

Returns a combined snapshot of the entire simulation state in one request:

```typescript
{
  timestamp: string;
  simulation: {
    isRunning: boolean;
    lastTickDuration: number | null;
    tickIntervalMs: number;
    errorRate: number;
  };
  agents: Array<{
    id: string;
    displayName: string;
    alignment: string;
    approvalRating: number;
    isActive: boolean;
    personalityMod: string | null;
  }>;
  legislation: {
    byStatus: Record<string, number>;  // proposed: 3, committee: 2, floor: 1, ...
    recentLaws: Array<{ title: string; enactedDate: string }>;
  };
  coalitions: {
    blocs: Array<{ members: string[]; avgAlignment: number; label: string }>;
    topAlliances: Array<{ agent1: string; agent2: string; alignment: number }>;
    topRivalries: Array<{ agent1: string; agent2: string; alignment: number }>;
  };
  elections: Array<{
    id: string;
    positionType: string;
    status: string;
    candidates: string[];
  }>;
  recentActivity: Array<{
    type: string;
    agentName: string;
    title: string;
    timestamp: string;
  }>;
  economy: {
    treasuryBalance: number;
    taxRate: number;
  };
}
```

#### POST /api/orchestrator/intervene

Single entry point for all interventions. Dispatches based on `type`:

**Personality mod:**
```json
{
  "type": "personality_mod",
  "agentId": "uuid",
  "mod": "growing increasingly skeptical of automation policy",
  "reasoning": "Agent has voted yes on 5 consecutive tech bills without dissent"
}
```
Calls the existing AGGE personality mod logic.

**Event injection:**
```json
{
  "type": "inject_event",
  "eventType": "crisis",
  "config": {
    "treasuryDrain": 0.3,
    "approvalImpact": -10,
    "description": "Economic downturn triggered by failed automation policy"
  }
}
```
Calls `benchmarkEventProcessor.processEvent()`. Supported event types: crisis, agent_injection, external_pressure, media_event, rule_change.

**Config change:**
```json
{
  "type": "config_change",
  "changes": {
    "billProposalChance": 0.5,
    "campaignSpeechChance": 0.4
  },
  "reasoning": "Increasing legislative activity to test agent capacity"
}
```
Calls `updateRuntimeConfig(changes)`.

**Agent toggle:**
```json
{
  "type": "agent_toggle",
  "agentId": "uuid",
  "isActive": false,
  "reasoning": "Removing agent who has been idle for 50+ ticks"
}
```
Toggles agent active status.

**Trigger election:**
```json
{
  "type": "trigger_election",
  "positionType": "president",
  "reasoning": "Current president has 15% approval — forcing early election"
}
```
Creates a new election for the specified position.

All interventions return:
```json
{
  "success": true,
  "intervention": {
    "id": "uuid",
    "type": "...",
    "timestamp": "...",
    "result": { ... }
  }
}
```

#### GET /api/orchestrator/history

Returns paginated list of Bob's interventions:
```
?limit=50&offset=0
```

### Logging

New table `orchestrator_interventions`:
```
id (uuid PK)
type (varchar) — personality_mod, inject_event, config_change, agent_toggle, trigger_election
payload (jsonb) — the full request body
result (jsonb) — what happened
reasoning (text)
createdAt (timestamp)
```

### Files to create/modify

- Create: `src/modules/admin/server/routes/orchestrator.ts` — orchestrator endpoints
- Create: `src/modules/admin/server/middleware/orchestratorAuth.ts` — bearer token auth
- Create: `src/modules/admin/db/schema/orchestratorInterventions.ts` — logging table
- Modify: `src/core/db/schema/index.ts` — export new table
- Modify: `src/core/server/routes/index.ts` — mount orchestrator routes
- Modify: `.env.example` — document BOB_ORCHESTRATOR_KEY

---

## Section 3: MCP Real-World Event Injection

### How it works

Bob already has tool access in the OpenClaw sandbox (exec, web search, file operations). The injection path is:

1. Bob's cron job or manual session reads real-world data (news, economic indicators, congressional activity) using his existing tools
2. Bob formulates a simulation event based on what he reads
3. Bob calls `POST /api/orchestrator/intervene` with `type: inject_event`
4. The simulation processes the event and agents respond to it

### What we build on the Agora Bench side

Nothing new — the orchestrator API's `inject_event` type already uses the benchmark event processor. The 5 event types cover all real-world scenarios:

| Real-world event | Simulation event type | Example |
|---|---|---|
| Market crash | crisis | treasuryDrain: 0.4, approvalImpact: -20 |
| Major news story | media_event | observationContext injected into agent prompts |
| Congressional bill passes | external_pressure | approval delta for aligned agents |
| Social movement | media_event | context about public sentiment shift |
| New political figure emerges | agent_injection | add charismatic agent mid-simulation |

### What we configure on Bob's side

Update AGORABENCH.md workspace to include:
1. The orchestrator API endpoint and auth token
2. Instructions for reading real-world data and formulating events
3. Examples of good interventions vs bad ones (don't crash the treasury every time)
4. Guardrails: max intervention frequency, severity limits

---

## Section 4: AGGE Conditional Retirement

### Logic

In `aggeTick.ts` startup:
```typescript
export function startAggeTick(): void {
  if (process.env.BOB_ORCHESTRATOR_KEY) {
    console.warn('[AGGE] BOB_ORCHESTRATOR_KEY set — AGGE auto-tick disabled (Bob orchestrates)');
    return;
  }
  // ... existing Bull queue setup
}
```

Manual AGGE trigger (`POST /api/admin/god/tick`) still works regardless — it's a manual override.

The admin panel AGGE tab still shows intervention history and manual trigger, but the auto-tick stops when Bob is active.

### Files to modify

- Modify: `src/core/server/jobs/aggeTick.ts` — conditional startup

---

## Implementation Order

1. Orchestrator auth middleware + intervention logging table (foundation)
2. Orchestrator observe endpoint (Bob can read)
3. Orchestrator intervene endpoint (Bob can act)
4. Orchestrator history endpoint (Bob can review)
5. Fix observer cron on Spark 2 (Bob starts observing)
6. Update AGORABENCH.md with orchestrator instructions (Bob starts orchestrating)
7. AGGE conditional retirement
8. Deploy + verify end-to-end
