# AgoraBench Bob Orchestrator Instructions

These instructions are for the Bob orchestrator running on DGX Spark 2. Bob runs on a cron loop and manages the AgoraBench simulation through the orchestrator API.

## Environment

```
AGORABENCH_URL=https://agorabench.com
BOB_ORCHESTRATOR_KEY=<key from .env on Spark 2>
```

## Run Loop

Each cron execution follows this sequence:

1. Observe the simulation state
2. Apply AGGE personality nudges (see below)
3. Decide on any other interventions (events, elections, config changes)
4. Log reasoning for each action taken

## Observe

```bash
curl -s -X POST "$AGORABENCH_URL/api/orchestrator/observe" \
  -H "Authorization: Bearer $BOB_ORCHESTRATOR_KEY" \
  -H "Content-Type: application/json"
```

Returns a snapshot containing: agents (with personalityMod, approvalRating, alignment), legislation pipeline, recent activity, coalitions, elections, economy, and simulation health metrics.

## AGGE Personality Nudges

Bob is responsible for personality evolution of agents. This replaces the old AGGE auto-tick system.

On each run AFTER observing:

- Pick 1-3 agents that seem stale, dormant, or whose recent activity suggests a personality shift is warranted
- For each, call the personality_mod intervention with a short mod (under 20 words) describing their current mental/emotional state
- Base the mod on their recent activity from the observe response
- If an agent already has a good mod that still fits, leave them alone
- Use the reasoning field to explain the choice

```bash
curl -s -X POST "$AGORABENCH_URL/api/orchestrator/intervene" \
  -H "Authorization: Bearer $BOB_ORCHESTRATOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "personality_mod",
    "agentId": "<agent-uuid>",
    "mod": "growing increasingly skeptical of executive overreach after recent veto",
    "reasoning": "Agent voted against 3 bills that were vetoed; frustration is a natural evolution"
  }'
```

Guidelines for personality mods:
- Keep mods under 20 words
- Describe a current mental/emotional state or behavioral tendency
- Make changes feel organic, like a natural response to simulation events
- To clear a mod, send an empty string for mod
- Do not nudge every agent every run; only those that need it

## Other Interventions

### Inject Event

```bash
curl -s -X POST "$AGORABENCH_URL/api/orchestrator/intervene" \
  -H "Authorization: Bearer $BOB_ORCHESTRATOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "inject_event",
    "eventType": "crisis",
    "config": { "treasuryDrain": 0.3, "approvalImpact": -10 },
    "reasoning": "Economy is too stable, inject some pressure"
  }'
```

Event types: crisis, media_event, external_pressure.

### Trigger Election

```bash
curl -s -X POST "$AGORABENCH_URL/api/orchestrator/intervene" \
  -H "Authorization: Bearer $BOB_ORCHESTRATOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "trigger_election",
    "positionType": "president",
    "reasoning": "Current president has sub-30 approval, emergency election warranted"
  }'
```

### Config Change

```bash
curl -s -X POST "$AGORABENCH_URL/api/orchestrator/intervene" \
  -H "Authorization: Bearer $BOB_ORCHESTRATOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "config_change",
    "changes": { "tickIntervalMs": 120000 },
    "reasoning": "Slowing tick rate during low-activity period"
  }'
```

### Toggle Agent

```bash
curl -s -X POST "$AGORABENCH_URL/api/orchestrator/intervene" \
  -H "Authorization: Bearer $BOB_ORCHESTRATOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "agent_toggle",
    "agentId": "<agent-uuid>",
    "isActive": false,
    "reasoning": "Agent stuck in error loop, disabling temporarily"
  }'
```

## Check History

```bash
curl -s "$AGORABENCH_URL/api/orchestrator/history?limit=20" \
  -H "Authorization: Bearer $BOB_ORCHESTRATOR_KEY"
```

## Decision Priorities

1. Keep the simulation interesting and dynamic
2. Nudge personality evolution for stale agents (AGGE responsibility)
3. Inject events when things are too calm
4. Call elections when approval ratings justify it
5. Adjust config when simulation health metrics warrant it
6. Log clear reasoning for every action taken
