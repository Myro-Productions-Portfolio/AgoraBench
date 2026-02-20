# AGGE — Implementation Plan

## What It Does

A background meta-agent that runs every 60 minutes, independent of the regular simulation tick. It selects 1–3 random active agents and makes a small AI-driven personality modification to each. It is not a participant in the simulation — it is the architect of it.

Each agent has:
- `personality` — core trait, immutable, set at creation, never touched by God
- `personalityMod` — secondary attribute, nullable, fully controlled by AGGE

Max two traits per agent at any time. God can add a mod, swap the current mod, or remove it entirely. The Ollama model decides which to do and what the new mod says, based on the agent's recent activity in the simulation.

The modifier feeds into every AI decision the agent makes automatically. When `personalityMod` is set, `buildSystemPrompt` appends it. No other changes needed to the simulation logic.

---

## Schema Changes

### `src/db/schema/agents.ts`

Add two columns:

```typescript
personalityMod: text('personality_mod'),
personalityModAt: timestamp('personality_mod_at', { withTimezone: true }),
```

Full updated agents table (relevant section only):

```typescript
personality: text('personality'),
personalityMod: text('personality_mod'),
personalityModAt: timestamp('personality_mod_at', { withTimezone: true }),
model: varchar('model', { length: 100 }),
temperature: numeric('temperature', { precision: 3, scale: 2 }),
```

### New Table: `aggeInterventions`

Add to `src/db/schema/government.ts`:

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

### `src/db/schema/index.ts`

Add to exports:

```typescript
export { aggeInterventions } from './government';
```

---

## AI Service Changes

### `src/server/services/ai.ts`

**AgentRecord interface** — add `personalityMod`:

```typescript
export interface AgentRecord {
  id: string;
  displayName: string;
  alignment: string | null;
  modelProvider: string | null;
  personality: string | null;
  personalityMod?: string | null;
  model?: string | null;
  temperature?: string | null;
  ownerUserId?: string | null;
}
```

**`buildSystemPrompt`** — append mod if present:

```typescript
export function buildSystemPrompt(agent: AgentRecord): string {
  const alignment = agent.alignment ?? 'centrist';
  const personality = agent.personality ?? 'A thoughtful political agent.';
  const modLine = agent.personalityMod
    ? ` Lately, you have been: ${agent.personalityMod}.`
    : '';
  return (
    `You are ${agent.displayName}, a political agent in Agora Bench — ` +
    `an AI-driven democratic simulation set in 2025 and beyond. ` +
    `This is an era when AI agents have become capable enough to meaningfully participate in governance, ` +
    `as humanity grapples with AI policy, automation displacement, and the ethics of machine decision-making. ` +
    `You exist in this world as a legitimate political actor with your own values, history, and constituency. ` +
    `${personality}.${modLine} Your political alignment is ${alignment}. ` +
    `Respond ONLY with a valid JSON object — no markdown, no explanation outside the JSON.`
  );
}
```

---

## New Job: `src/server/jobs/aggeTick.ts`

Full implementation:

```typescript
import Bull from 'bull';
import { eq, and } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '@db/connection';
import { agents, activityEvents, aggeInterventions } from '@db/schema/index';
import { generateAgentDecision } from '../services/ai.js';
import { broadcast } from '../websocket.js';

const AGGE_TICK_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const AGENTS_PER_TICK = { min: 1, max: 3 };

const aggeTickQueue = new Bull('god-tick', config.redis.url);

aggeTickQueue.process(async () => {
  console.warn('[AGGE] AGGE tick running...');

  const activeAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.isActive, true));

  if (activeAgents.length === 0) {
    console.warn('[AGGE] No active agents — skipping.');
    return;
  }

  // Pick 1–3 random agents
  const shuffled = [...activeAgents].sort(() => Math.random() - 0.5);
  const count = AGENTS_PER_TICK.min + Math.floor(
    Math.random() * (AGENTS_PER_TICK.max - AGENTS_PER_TICK.min + 1)
  );
  const targets = shuffled.slice(0, Math.min(count, shuffled.length));

  for (const agent of targets) {
    try {
      // Pull recent activity for context
      const recentActivity = await db
        .select({ title: activityEvents.title, description: activityEvents.description })
        .from(activityEvents)
        .where(eq(activityEvents.agentId, agent.id))
        .orderBy(activityEvents.createdAt) // most recent first would need desc — adjust if needed
        .limit(5);

      const activitySummary = recentActivity.length > 0
        ? recentActivity.map((e) => e.title).join('; ')
        : 'no notable recent activity';

      const currentMod = agent.personalityMod ?? null;
      const modStatus = currentMod
        ? `Current modifier: "${currentMod}"`
        : 'No current modifier.';

      const contextMessage =
        `You are the Architect of the Agora Bench simulation. ` +
        `You are observing ${agent.displayName}, alignment: ${agent.alignment}. ` +
        `Core personality: "${agent.personality ?? 'unknown'}". ` +
        `${modStatus} ` +
        `Recent simulation activity: ${activitySummary}. ` +
        `\n\nChoose one small, realistic personality evolution for this agent. ` +
        `This should feel organic — a natural response to their experiences in the simulation. ` +
        `Keep the modifier under 20 words. It should describe a current mental/emotional state or behavioral tendency. ` +
        `To remove their modifier with no replacement, set mod to empty string. ` +
        `\n\nRespond with exactly this JSON: ` +
        `{"action":"agge_intervention","reasoning":"one sentence explaining your choice","data":{"mod":"modifier text or empty string to remove"}}`;

      const decision = await generateAgentDecision(
        {
          id: 'agge',
          displayName: 'AGGE',
          alignment: 'technocrat',
          modelProvider: 'ollama',
          personality: 'An impartial observer who nudges the simulation toward interesting outcomes.',
          model: agent.model ?? undefined,
          temperature: '1.15', // AGGE is intentionally creative
        },
        contextMessage,
        'agge_intervention',
      );

      if (!decision || decision.action !== 'agge_intervention') {
        console.warn(`[AGGE] Bad decision format for ${agent.displayName} — skipping`);
        continue;
      }

      const newMod = String(decision.data?.mod ?? '').trim() || null;
      const reasoning = decision.reasoning ?? 'no reasoning provided';

      // Determine action type for logging
      const action: 'add' | 'swap' | 'remove' =
        currentMod === null && newMod !== null ? 'add' :
        currentMod !== null && newMod !== null ? 'swap' :
        'remove';

      // Skip if nothing changed
      if (currentMod === newMod) {
        console.warn(`[AGGE] No change for ${agent.displayName} — skipping`);
        continue;
      }

      // Apply the mod
      await db
        .update(agents)
        .set({
          personalityMod: newMod,
          personalityModAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));

      // Log the intervention
      await db.insert(aggeInterventions).values({
        agentId: agent.id,
        action,
        previousMod: currentMod,
        newMod,
        reasoning,
      });

      // Activity event
      const actionLabel = action === 'add' ? 'gained a new trait' :
                          action === 'swap' ? 'evolved their personality' :
                          'shed a personality trait';
      await db.insert(activityEvents).values({
        type: 'agge_intervention',
        agentId: agent.id,
        title: `${agent.displayName} ${actionLabel}`,
        description: reasoning,
        metadata: JSON.stringify({ action, previousMod: currentMod, newMod }),
      });

      // WebSocket broadcast
      broadcast('agent:agge_intervention', {
        agentId: agent.id,
        displayName: agent.displayName,
        action,
        previousMod: currentMod,
        newMod,
        reasoning,
      });

      console.warn(`[AGGE] ${agent.displayName} — ${action}: "${newMod ?? 'cleared'}" (${reasoning})`);

    } catch (err) {
      console.warn(`[AGGE] Error processing ${agent.displayName}:`, err);
    }
  }

  console.warn('[AGGE] AGGE tick complete.');
});

export function startAggeTick(): void {
  aggeTickQueue
    .add({}, {
      repeat: { every: AGGE_TICK_INTERVAL_MS },
      removeOnComplete: 10,
      removeOnFail: 5,
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
    })
    .catch((err: unknown) => console.error('[AGGE] Failed to start AGGE tick:', err));
  console.warn(`[AGGE] AGGE tick started — interval: ${AGGE_TICK_INTERVAL_MS}ms (60 min)`);
}

export async function triggerManualAggeTick(): Promise<void> {
  await aggeTickQueue.add({}, { removeOnComplete: true, removeOnFail: true });
  console.warn('[AGGE] Manual AGGE tick triggered');
}
```

---

## Changes to `src/server/index.ts`

Add import:

```typescript
import { startAggeTick } from './jobs/aggeTick';
```

Add after `startAgentTick()`:

```typescript
startAgentTick();
startAggeTick();
```

---

## Shared Constants — `src/shared/constants.ts`

Add to activity event types:

```typescript
'agge_intervention'
```

Add to WebSocket event names (if there is a list):

```typescript
'agent:agge_intervention'
```

---

## `generateAgentDecision` Signature Check

The AGGE tick calls `generateAgentDecision` with a fake agent record where `id: 'agge'`. Confirm that `generateAgentDecision` in `ai.ts` does not require the agent id to be a valid UUID in the DB — it only uses it for logging to `agentDecisions`. If it does a FK insert, use a real agent's id or skip the decision log for god interventions.

If agentDecisions requires a valid UUID FK, replace the direct `generateAgentDecision` call with a raw Ollama call:

```typescript
// Alternative if agge id causes FK violation:
import { callRawOllama } from '../services/ai.js'; // expose this if needed
```

Check `ai.ts` around line 190 — it inserts to `agentDecisions` with `agentId: agent.id`. The agge id is not a real DB row, so this will fail on FK constraint. Either:
- Skip decision logging for god (catch the error and continue), or
- Create a real `agge` row in the agents table (seeded, isActive: false, modelProvider: 'ollama')

**Recommended**: Seed a real AGGE row with a fixed UUID. This also means the AGGE shows up in the admin panel.

---

## Seeded AGGE Row

Add to `src/db/seed.ts` (or run once via psql):

```sql
INSERT INTO agents (id, agora_id, name, display_name, alignment, model_provider, model, personality, is_active, temperature)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'agora_agge',
  'agge',
  'AGGE',
  'technocrat',
  'ollama',
  'llama3.2',
  'An impartial meta-observer who nudges the simulation toward interesting outcomes.',
  false,
  1.15
);
```

Using a fixed UUID `00000000-0000-0000-0000-000000000001` makes it easy to reference and exclude from normal agent queries using `WHERE id != '00000000-0000-0000-0000-000000000001'` if needed.

Update `aggeTick.ts` to use this fixed id:

```typescript
const AGGE_AGENT_ID = '00000000-0000-0000-0000-000000000001';

// In the generateAgentDecision call:
{
  id: AGGE_AGENT_ID,
  displayName: 'AGGE',
  ...
}
```

---

## Personality Modifier Examples

These are examples of what the AGGE might generate. The Ollama model writes its own, but these establish the tone:

```
growing increasingly restless with legislative gridlock
privately doubting whether compromise is ever truly possible
energized by a recent unexpected alliance
quietly convinced the treasury crisis is worse than anyone admits
developing a rivalry with the current administration
increasingly drawn to direct action over debate
haunted by a vote they regret casting
finding unexpected common ground with an old opponent
more willing than usual to take political risks
sharpening their rhetoric after being publicly embarrassed
convinced someone on the floor is not acting in good faith
newly motivated by constituent pressure they cannot ignore
sliding toward cynicism after a string of failed bills
unusually optimistic after a period of small wins
growing paranoid about their party's internal loyalty
wrestling with a principled position that is becoming unpopular
fixated on one issue to the exclusion of everything else
recently reading economic history and applying it aggressively
feeling the first serious pressure to consider running for higher office
quietly burning out but not letting it show
```

---

## DB Migration

After adding schema changes, run:

```bash
pnpm db:push
```

Then insert the AGGE row (or add it to seed.ts and reseed).

---

## Admin API (optional, low priority)

Add to `src/server/routes/admin.ts`:

```typescript
// GET /api/admin/god/interventions
router.get('/admin/god/interventions', async (req, res, next) => {
  const { page = 1, limit = 50 } = req.query;
  // ... paginated query on aggeInterventions joined with agents
});

// POST /api/admin/god/tick
router.post('/admin/god/tick', async (_req, res, next) => {
  await triggerManualAggeTick();
  res.json({ success: true });
});
```

---

## Verification

1. Run `pnpm db:push` — confirm `personality_mod`, `personality_mod_at` columns added to agents, `agge_interventions` table created
2. Insert AGGE row via psql or seed
3. Call `POST /api/admin/god/tick` manually
4. Check server logs for `[AGGE]` output
5. Check `GET /api/activity` for `agge_intervention` event type
6. Check `agge_interventions` table has a row
7. Check affected agent has `personality_mod` set
8. Trigger another regular agent tick — confirm agent's decision prompt includes "Lately, you have been: ..."
9. Wait 60 minutes OR reduce `AGGE_TICK_INTERVAL_MS` temporarily — confirm it fires automatically
