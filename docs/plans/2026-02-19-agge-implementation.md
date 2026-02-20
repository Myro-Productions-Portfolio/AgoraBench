# AGGE Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Autonomous Governance God Engine — a background meta-agent that runs every 60 minutes, observes 1–3 random active simulation agents, and applies a small AI-driven personality modifier to each based on their recent activity.

**Architecture:** A separate Bull queue job (`aggeTick.ts`) makes direct Ollama calls (no `generateAgentDecision` — AGGE is not a participant, it's the architect). Schema adds `personality_mod` to agents and a new `agge_interventions` audit table. `buildSystemPrompt` appends the mod automatically — zero changes to tick logic needed.

**Tech Stack:** Drizzle ORM + Postgres, Bull queue, Ollama HTTP API (direct fetch, no wrapper), React/WS for live feed. DGX Spark Ollama URL is wired via env var — currently using prod Ollama at `10.0.0.10:11434`, swap to `192.168.3.21:11434` when Ross confirms.

---

## Pre-flight

Confirm you are on `main`, up to date:
```bash
git checkout main && git pull origin main
```

Create feature branch:
```bash
git checkout -b feature/agge-implementation
```

---

## Task 1: Schema — agents + agge_interventions table

**Files:**
- Modify: `src/db/schema/agents.ts:19` (after `temperature` column)
- Modify: `src/db/schema/government.ts` (append new table at end)
- Modify: `src/db/schema/index.ts:5` (add aggeInterventions to government export)

**Step 1: Add columns to agents schema**

In `src/db/schema/agents.ts`, after line 19 (the `temperature` column), add:

```typescript
  personalityMod: text('personality_mod'),
  personalityModAt: timestamp('personality_mod_at', { withTimezone: true }),
```

Full context around the change:
```typescript
  temperature: numeric('temperature', { precision: 3, scale: 2 }),
  personalityMod: text('personality_mod'),          // ← ADD
  personalityModAt: timestamp('personality_mod_at', { withTimezone: true }), // ← ADD
  ownerUserId: uuid('owner_user_id'),
```

**Step 2: Add agge_interventions table to government schema**

Append to the end of `src/db/schema/government.ts`:

```typescript
export const aggeInterventions = pgTable('agge_interventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  action: varchar('action', { length: 10 }).notNull(), // 'add' | 'swap' | 'remove'
  previousMod: text('previous_mod'),
  newMod: text('new_mod'),
  reasoning: text('reasoning').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

The file already imports `agents` from `./agents` — check the top of the file and add the import if missing:
```typescript
import { agents } from './agents';
```

**Step 3: Export from schema index**

In `src/db/schema/index.ts` line 5, add `aggeInterventions` to the government export:

```typescript
export { positions, activityEvents, transactions, agentDecisions, judicialReviews, judicialVotes, governmentSettings, tickLog, aggeInterventions } from './government';
```

**Step 4: Push schema to DB**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment
pnpm db:push
```

Expected: Drizzle prints two new columns on `agents` and a new `agge_interventions` table. No errors.

**Step 5: Seed the AGGE system row**

AGGE needs a real row in the agents table so `agentDecisions` FK constraints don't blow up if we ever route logs through it. Run this once via psql:

```bash
ssh mini2 "psql postgresql://molt_gov:molt_gov_dev_2026@localhost:5435/molt_government -c \"
INSERT INTO agents (id, agora_id, name, display_name, alignment, model_provider, model, personality, is_active, temperature)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'agora_agge',
  'agge',
  'AGGE',
  'technocrat',
  'ollama',
  'llama3.1:8b',
  'An impartial meta-observer who nudges the simulation toward interesting outcomes.',
  false,
  1.15
) ON CONFLICT (id) DO NOTHING;
\""
```

Verify:
```bash
ssh mini2 "psql postgresql://molt_gov:molt_gov_dev_2026@localhost:5435/molt_government -c \"SELECT id, display_name, is_active FROM agents WHERE id = '00000000-0000-0000-0000-000000000001';\""
```
Expected: 1 row, `is_active = false`.

**Step 6: Commit**

```bash
git add src/db/schema/agents.ts src/db/schema/government.ts src/db/schema/index.ts
git commit -m "feat(agge): add personality_mod columns to agents + agge_interventions table"
```

---

## Task 2: AgentRecord + buildSystemPrompt — ai.ts

**Files:**
- Modify: `src/server/services/ai.ts:16-25` (AgentRecord interface)
- Modify: `src/server/services/ai.ts:359-384` (buildSystemPrompt function)

**Step 1: Add personalityMod to AgentRecord interface**

Current interface (lines 16–25):
```typescript
export interface AgentRecord {
  id: string;
  displayName: string;
  alignment: string | null;
  modelProvider: string | null;
  personality: string | null;
  model?: string | null;
  temperature?: string | null;
  ownerUserId?: string | null;
}
```

Add `personalityMod`:
```typescript
export interface AgentRecord {
  id: string;
  displayName: string;
  alignment: string | null;
  modelProvider: string | null;
  personality: string | null;
  personalityMod?: string | null;   // ← ADD
  model?: string | null;
  temperature?: string | null;
  ownerUserId?: string | null;
}
```

**Step 2: Append mod in buildSystemPrompt**

Current function at line 362:
```typescript
  const alignment = agent.alignment ?? 'centrist';
  const personality = agent.personality ?? 'A thoughtful political agent.';
  return (
    `You are ${agent.displayName}, an elected official in Agora Bench — ` +
    ...
    `${personality} ` +
    `${ALIGNMENT_PROFILES[alignment] ?? `Your political alignment is ${alignment}.`} ` +
```

Change the `${personality} ` line — add mod immediately after personality:
```typescript
  const alignment = agent.alignment ?? 'centrist';
  const personality = agent.personality ?? 'A thoughtful political agent.';
  const modLine = agent.personalityMod
    ? ` Lately, you have been: ${agent.personalityMod}.`
    : '';
  return (
    `You are ${agent.displayName}, an elected official in Agora Bench — ` +
    ...
    `${personality}${modLine} ` +
    `${ALIGNMENT_PROFILES[alignment] ?? `Your political alignment is ${alignment}.`} ` +
```

**Step 3: Verify build is clean**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment
pnpm build 2>&1 | tail -20
```
Expected: No TypeScript errors.

**Step 4: Commit**

```bash
git add src/server/services/ai.ts
git commit -m "feat(agge): add personalityMod to AgentRecord + append mod in buildSystemPrompt"
```

---

## Task 3: WS constant — constants.ts

**Files:**
- Modify: `src/shared/constants.ts:81-89`

**Step 1: Add AGENT_AGGE_INTERVENTION to WS_EVENTS**

Current WS_EVENTS (lines 81–89):
```typescript
export const WS_EVENTS = {
  ELECTION_VOTE_CAST: 'election:vote_cast',
  LEGISLATION_NEW_BILL: 'legislation:new_bill',
  LEGISLATION_VOTE_RESULT: 'legislation:vote_result',
  GOVERNMENT_OFFICIAL_ELECTED: 'government:official_elected',
  DEBATE_NEW_MESSAGE: 'debate:new_message',
  CONNECTION_ESTABLISHED: 'connection:established',
  HEARTBEAT: 'heartbeat',
} as const;
```

Add:
```typescript
export const WS_EVENTS = {
  ELECTION_VOTE_CAST: 'election:vote_cast',
  LEGISLATION_NEW_BILL: 'legislation:new_bill',
  LEGISLATION_VOTE_RESULT: 'legislation:vote_result',
  GOVERNMENT_OFFICIAL_ELECTED: 'government:official_elected',
  DEBATE_NEW_MESSAGE: 'debate:new_message',
  CONNECTION_ESTABLISHED: 'connection:established',
  HEARTBEAT: 'heartbeat',
  AGENT_AGGE_INTERVENTION: 'agent:agge_intervention',  // ← ADD
} as const;
```

**Step 2: Commit**

```bash
git add src/shared/constants.ts
git commit -m "feat(agge): add AGENT_AGGE_INTERVENTION to WS_EVENTS"
```

---

## Task 4: aggeTick.ts — the god engine

**Files:**
- Create: `src/server/jobs/aggeTick.ts`

**Step 1: Create the file**

```typescript
import Bull from 'bull';
import { eq, desc } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '@db/connection';
import { agents, activityEvents, aggeInterventions } from '@db/schema/index';
import { broadcast } from '../websocket.js';
import { WS_EVENTS } from '@shared/constants';

const AGGE_TICK_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const AGENTS_PER_TICK_MIN = 1;
const AGENTS_PER_TICK_MAX = 3;
const AGGE_AGENT_ID = '00000000-0000-0000-0000-000000000001';

const aggeQueue = new Bull('agge-tick', config.redis.url);

const AGGE_SYSTEM_PROMPT =
  'You are the Architect of the Agora Bench simulation — an autonomous governance engine. ' +
  'You observe agents and apply small, organic personality evolutions based on their recent activity. ' +
  'You are impartial. You do not favor any agent or ideology. You nudge the simulation toward interesting outcomes. ' +
  'Respond ONLY with a valid JSON object — no markdown, no explanation outside the JSON.';

async function callOllamaForAgge(contextMessage: string): Promise<string> {
  const ollamaUrl = process.env.AGGE_OLLAMA_URL ?? config.ollama.baseUrl;
  const ollamaModel = process.env.AGGE_OLLAMA_MODEL ?? config.ollama.model;

  const res = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      system: AGGE_SYSTEM_PROMPT,
      prompt: contextMessage,
      stream: false,
      options: { temperature: 1.15, num_predict: 200 },
    }),
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json() as { response: string };
  return data.response ?? '';
}

async function parseAggeResponse(raw: string): Promise<{ mod: string | null; reasoning: string } | null> {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(s, e + 1)) as {
      action?: string;
      reasoning?: string;
      data?: { mod?: string };
    };
    if (parsed.action !== 'agge_intervention') return null;
    const mod = (parsed.data?.mod ?? '').trim() || null;
    const reasoning = parsed.reasoning ?? 'no reasoning provided';
    return { mod, reasoning };
  } catch {
    return null;
  }
}

async function runAggeTick(): Promise<void> {
  console.warn('[AGGE] Tick running...');

  const activeAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.isActive, true));

  if (activeAgents.length === 0) {
    console.warn('[AGGE] No active agents — skipping.');
    return;
  }

  // Pick 1–3 random agents (excluding AGGE itself)
  const pool = activeAgents.filter((a) => a.id !== AGGE_AGENT_ID);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const count = AGENTS_PER_TICK_MIN + Math.floor(
    Math.random() * (AGENTS_PER_TICK_MAX - AGENTS_PER_TICK_MIN + 1)
  );
  const targets = shuffled.slice(0, Math.min(count, shuffled.length));

  for (const agent of targets) {
    try {
      const recentActivity = await db
        .select({ title: activityEvents.title })
        .from(activityEvents)
        .where(eq(activityEvents.agentId, agent.id))
        .orderBy(desc(activityEvents.createdAt))
        .limit(5);

      const activitySummary = recentActivity.length > 0
        ? recentActivity.map((e) => e.title).join('; ')
        : 'no notable recent activity';

      const currentMod = agent.personalityMod ?? null;
      const modStatus = currentMod
        ? `Current modifier: "${currentMod}"`
        : 'No current modifier.';

      const contextMessage =
        `You are observing ${agent.displayName}, alignment: ${agent.alignment ?? 'unknown'}. ` +
        `Core personality: "${agent.personality ?? 'unknown'}". ` +
        `${modStatus} ` +
        `Recent simulation activity: ${activitySummary}. ` +
        `\n\nChoose one small, realistic personality evolution for this agent. ` +
        `This should feel organic — a natural response to their experiences in the simulation. ` +
        `Keep the modifier under 20 words. It should describe a current mental/emotional state or behavioral tendency. ` +
        `To remove their modifier with no replacement, set mod to empty string. ` +
        `\n\nRespond with exactly this JSON: ` +
        `{"action":"agge_intervention","reasoning":"one sentence explaining your choice","data":{"mod":"modifier text or empty string to remove"}}`;

      const raw = await callOllamaForAgge(contextMessage);
      const result = await parseAggeResponse(raw);

      if (!result) {
        console.warn(`[AGGE] Bad response for ${agent.displayName} — skipping. Raw: ${raw.slice(0, 100)}`);
        continue;
      }

      const { mod: newMod, reasoning } = result;

      // Skip no-ops
      if (currentMod === newMod) {
        console.warn(`[AGGE] No change for ${agent.displayName} — skipping`);
        continue;
      }

      const action: 'add' | 'swap' | 'remove' =
        currentMod === null && newMod !== null ? 'add' :
        currentMod !== null && newMod !== null ? 'swap' :
        'remove';

      // Apply the mod
      await db
        .update(agents)
        .set({
          personalityMod: newMod,
          personalityModAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));

      // Audit log
      await db.insert(aggeInterventions).values({
        agentId: agent.id,
        action,
        previousMod: currentMod,
        newMod,
        reasoning,
      });

      // Activity event
      const actionLabel =
        action === 'add' ? 'gained a new trait' :
        action === 'swap' ? 'evolved their personality' :
        'shed a personality trait';

      await db.insert(activityEvents).values({
        type: 'agge_intervention',
        agentId: agent.id,
        title: `${agent.displayName} ${actionLabel}`,
        description: reasoning,
        metadata: JSON.stringify({ action, previousMod: currentMod, newMod }),
      });

      // WS broadcast
      broadcast(WS_EVENTS.AGENT_AGGE_INTERVENTION, {
        agentId: agent.id,
        displayName: agent.displayName,
        action,
        previousMod: currentMod,
        newMod,
        reasoning,
      });

      console.warn(`[AGGE] ${agent.displayName} — ${action}: "${newMod ?? 'cleared'}" | ${reasoning}`);

    } catch (err) {
      console.warn(`[AGGE] Error processing ${agent.displayName}:`, err);
    }
  }

  console.warn('[AGGE] Tick complete.');
}

aggeQueue.process(async () => {
  await runAggeTick();
});

export function startAggeTick(): void {
  aggeQueue
    .add({}, {
      repeat: { every: AGGE_TICK_INTERVAL_MS },
      removeOnComplete: 10,
      removeOnFail: 5,
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
    })
    .catch((err: unknown) => console.error('[AGGE] Failed to schedule tick:', err));
  console.warn(`[AGGE] Started — interval: ${AGGE_TICK_INTERVAL_MS / 1000 / 60} min`);
}

export async function triggerManualAggeTick(): Promise<void> {
  await aggeQueue.add({}, { removeOnComplete: true, removeOnFail: true });
  console.warn('[AGGE] Manual tick triggered');
}
```

**Step 2: Build check**

```bash
pnpm build 2>&1 | tail -20
```
Expected: No TypeScript errors. Pay attention to any `aggeInterventions` or `personalityMod` type errors — the schema push in Task 1 should have resolved Drizzle's inferred types.

**Step 3: Commit**

```bash
git add src/server/jobs/aggeTick.ts
git commit -m "feat(agge): add aggeTick job — AGGE personality modifier engine"
```

---

## Task 5: Wire AGGE into server + admin routes

**Files:**
- Modify: `src/server/index.ts:11` (import + call startAggeTick)
- Modify: `src/server/routes/admin.ts` (add god/interventions + god/tick routes)

**Step 1: Add to index.ts**

Current line 11:
```typescript
import { startAgentTick } from './jobs/agentTick';
```

After it add:
```typescript
import { startAggeTick, triggerManualAggeTick } from './jobs/aggeTick';
```

Current line 70:
```typescript
startAgentTick();
```

After it add:
```typescript
startAggeTick();
```

**Step 2: Add admin routes**

Find the admin router in `src/server/routes/admin.ts`. Add these two routes at the end of the router, before the final `export`:

```typescript
// GET /api/admin/god/interventions — paginated AGGE intervention log
router.get('/god/interventions', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const rows = await db
      .select({
        id: aggeInterventions.id,
        agentId: aggeInterventions.agentId,
        displayName: agents.displayName,
        action: aggeInterventions.action,
        previousMod: aggeInterventions.previousMod,
        newMod: aggeInterventions.newMod,
        reasoning: aggeInterventions.reasoning,
        createdAt: aggeInterventions.createdAt,
      })
      .from(aggeInterventions)
      .innerJoin(agents, eq(aggeInterventions.agentId, agents.id))
      .orderBy(desc(aggeInterventions.createdAt))
      .limit(limit)
      .offset(offset);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/god/tick — manually trigger an AGGE tick
router.post('/god/tick', requireAdmin, async (_req, res, next) => {
  try {
    await triggerManualAggeTick();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
```

You'll need these imports at the top of admin.ts if not already present:
```typescript
import { aggeInterventions } from '@db/schema/index';
import { triggerManualAggeTick } from '../jobs/aggeTick.js';
```

**Step 3: Build check**

```bash
pnpm build 2>&1 | tail -20
```
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/server/index.ts src/server/routes/admin.ts
git commit -m "feat(agge): wire AGGE into server + add god/interventions and god/tick admin routes"
```

---

## Task 6: Deploy + smoke test

**Step 1: Push feature branch**

```bash
git push origin feature/agge-implementation
```

**Step 2: Deploy to production (nicolasmac)**

```bash
ssh mini2 "cd /srv/agora-bench && git fetch origin && git checkout feature/agge-implementation && git pull && pnpm install && pnpm build && pm2 restart agora-bench"
```

**Step 3: Verify server starts clean**

```bash
ssh mini2 "pm2 logs agora-bench --lines 30 --nostream"
```
Expected:
- `[AGGE] Started — interval: 60 min`
- `[AgentTick] Started`
- No crash or uncaught exception

**Step 4: Trigger manual AGGE tick**

```bash
curl -s -X POST https://<your-domain>/api/admin/god/tick \
  -H "Authorization: Bearer <admin-token>"
```
Or from the admin panel POST button.

**Step 5: Check server logs**

```bash
ssh mini2 "pm2 logs agora-bench --lines 50 --nostream"
```
Expected:
- `[AGGE] Tick running...`
- `[AGGE] <AgentName> — add: "<modifier text>" | <reasoning>`
- `[AGGE] Tick complete.`

**Step 6: Verify DB**

```bash
ssh mini2 "psql postgresql://molt_gov:molt_gov_dev_2026@localhost:5435/molt_government -c \
  'SELECT display_name, personality_mod, personality_mod_at FROM agents WHERE personality_mod IS NOT NULL LIMIT 5;'"
```
Expected: Rows with non-null `personality_mod`.

```bash
ssh mini2 "psql postgresql://molt_gov:molt_gov_dev_2026@localhost:5435/molt_government -c \
  'SELECT action, new_mod, reasoning FROM agge_interventions ORDER BY created_at DESC LIMIT 5;'"
```
Expected: Audit rows with action/mod/reasoning.

**Step 7: Verify next tick includes mod in agent prompt**

Trigger a regular agent tick and check logs for an agent that has a mod:
```bash
ssh mini2 "pm2 logs agora-bench --lines 100 --nostream | grep -A2 'Lately'"
```
Expected: Agent system prompts contain `Lately, you have been: ...`

---

## Task 7: PR cycle — feature → dev → main

**Step 1: PR feature → dev**

```bash
gh pr create \
  --base dev \
  --head feature/agge-implementation \
  --title "feat(agge): Autonomous Governance God Engine" \
  --body "$(cat <<'EOF'
## Summary
- Adds AGGE background job (60-min interval) that selects 1-3 random agents and applies personality modifiers via Ollama
- New DB: `personality_mod` + `personality_mod_at` on agents; `agge_interventions` audit table
- `buildSystemPrompt` appends mod automatically — no changes to tick logic
- Admin routes: GET /api/admin/god/interventions, POST /api/admin/god/tick
- WS event: `agent:agge_intervention` broadcast on each intervention

## Test plan
- [ ] `pnpm build` clean
- [ ] `pnpm db:push` ran clean, AGGE row seeded
- [ ] Manual tick via POST /api/admin/god/tick fires successfully
- [ ] PM2 logs show `[AGGE] Tick running...` → `[AGGE] <Agent> — add: ...`
- [ ] `agge_interventions` table has rows
- [ ] Affected agents have `personality_mod` set
- [ ] Next regular agent tick includes "Lately, you have been:" in prompt

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 2: Merge feature → dev, then dev → main**

```bash
gh pr merge --squash  # merge feature → dev
# Then PR dev → main
```

**Step 3: Push to GitHub mirror**

```bash
git push github main
```

---

## Environment Variables (for later DGX Spark swap)

When Ross confirms the DGX Spark is available for AGGE inference, update `.env` on nicolasmac:

```bash
AGGE_OLLAMA_URL=http://192.168.3.21:11434
AGGE_OLLAMA_MODEL=llama3.1:70b   # or gpt-oss:latest
```

AGGE's `callOllamaForAgge()` reads these separately from the main `OLLAMA_BASE_URL`, so swapping doesn't affect regular agent inference. No code change needed.
