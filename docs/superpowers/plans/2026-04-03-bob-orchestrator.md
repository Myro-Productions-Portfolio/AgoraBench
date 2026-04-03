# Bob Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Bob (OpenClaw on DGX Spark 2) to observe and orchestrate the Agora Bench simulation as a full game master via authenticated REST API.

**Architecture:** New `/api/orchestrator/*` route group with bearer token auth (BOB_ORCHESTRATOR_KEY). Single `/observe` endpoint aggregates simulation state. Single `/intervene` endpoint dispatches to existing logic (personality mods, event injection, config changes, agent toggle, election trigger). All interventions logged. AGGE auto-tick disabled when Bob is active.

**Tech Stack:** TypeScript, Express, Drizzle ORM, PostgreSQL, OpenClaw/NemoClaw cron

---

## File Map

- **Create:** `src/modules/admin/server/middleware/orchestratorAuth.ts` — bearer token auth middleware
- **Create:** `src/modules/admin/db/schema/orchestratorInterventions.ts` — intervention logging table
- **Create:** `src/modules/admin/server/routes/orchestrator.ts` — observe, intervene, history endpoints
- **Modify:** `src/core/db/schema/index.ts` — export new table
- **Modify:** `src/core/server/routes/index.ts` — mount orchestrator routes
- **Modify:** `src/core/server/jobs/aggeTick.ts` — conditional startup
- **Modify:** `.env.example` — document BOB_ORCHESTRATOR_KEY
- **Remote:** Update AGORABENCH.md on Spark 2, re-enable cron job

---

## Task 1: Orchestrator auth middleware

**Files:**
- Create: `src/modules/admin/server/middleware/orchestratorAuth.ts`

- [ ] **Step 1: Create the middleware**

```typescript
import type { RequestHandler } from 'express';

/**
 * Authenticates orchestrator requests via BOB_ORCHESTRATOR_KEY bearer token.
 * Separate from Clerk — this is machine-to-machine auth for Bob.
 */
export const requireOrchestrator: RequestHandler = (req, res, next) => {
  const key = process.env.BOB_ORCHESTRATOR_KEY;
  if (!key) {
    res.status(503).json({ success: false, error: 'Orchestrator not configured' });
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing Authorization header' });
    return;
  }

  const token = auth.slice(7);
  if (token !== key) {
    res.status(403).json({ success: false, error: 'Invalid orchestrator key' });
    return;
  }

  next();
};
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/modules/admin/server/middleware/orchestratorAuth.ts
git commit -m "feat: add orchestrator bearer token auth middleware"
```

---

## Task 2: Intervention logging table

**Files:**
- Create: `src/modules/admin/db/schema/orchestratorInterventions.ts`
- Modify: `src/core/db/schema/index.ts`

- [ ] **Step 1: Create the schema**

```typescript
import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const orchestratorInterventions = pgTable('orchestrator_interventions', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: varchar('type', { length: 50 }).notNull(),
  payload: jsonb('payload').notNull(),
  result: jsonb('result'),
  reasoning: text('reasoning'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Export from schema index**

In `src/core/db/schema/index.ts`, add:

```typescript
export { orchestratorInterventions } from '@modules/admin/db/schema/orchestratorInterventions';
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/modules/admin/db/schema/orchestratorInterventions.ts src/core/db/schema/index.ts
git commit -m "feat: add orchestrator_interventions logging table"
```

---

## Task 3: Orchestrator observe endpoint

**Files:**
- Create: `src/modules/admin/server/routes/orchestrator.ts`

- [ ] **Step 1: Create the orchestrator routes file with the observe endpoint**

```typescript
import { Router } from 'express';
import { db } from '@db/connection';
import {
  agents, bills, laws, elections, campaigns, activityEvents,
  governmentSettings, tickLog, agentDecisions, agentRelationships,
  orchestratorInterventions,
} from '@db/schema/index';
import { eq, desc, sql, gte, and, inArray } from 'drizzle-orm';
import { requireOrchestrator } from '../middleware/orchestratorAuth.js';
import { getRuntimeConfig, updateRuntimeConfig } from '@core/server/runtimeConfig.js';

const router = Router();

/* ── All orchestrator routes require bearer token auth ─── */
router.use('/orchestrator', requireOrchestrator);

/* POST /api/orchestrator/observe — combined simulation snapshot */
router.post('/orchestrator/observe', async (_req, res, next) => {
  try {
    const rc = getRuntimeConfig();

    /* Agents */
    const agentRows = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        alignment: agents.alignment,
        approvalRating: agents.approvalRating,
        isActive: agents.isActive,
        personalityMod: agents.personalityMod,
      })
      .from(agents)
      .orderBy(agents.displayName);

    /* Bills by status */
    const billRows = await db
      .select({ status: bills.status, count: sql<number>`COUNT(*)` })
      .from(bills)
      .groupBy(bills.status);
    const byStatus: Record<string, number> = {};
    for (const row of billRows) byStatus[row.status] = Number(row.count);

    /* Recent laws */
    const recentLaws = await db
      .select({ title: laws.title, enactedDate: laws.enactedDate })
      .from(laws)
      .orderBy(desc(laws.enactedDate))
      .limit(5);

    /* Active elections */
    const activeElections = await db
      .select({
        id: elections.id,
        positionType: elections.positionType,
        status: elections.status,
      })
      .from(elections)
      .where(inArray(elections.status, ['scheduled', 'registration', 'campaigning', 'voting', 'counting']));

    /* Recent activity */
    const recentActivity = await db
      .select({
        type: activityEvents.type,
        agentId: activityEvents.agentId,
        title: activityEvents.title,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .orderBy(desc(activityEvents.createdAt))
      .limit(20);

    /* Economy */
    const [econ] = await db.select().from(governmentSettings).limit(1);

    /* Last tick timing */
    const [lastTick] = await db
      .select({ firedAt: tickLog.firedAt, completedAt: tickLog.completedAt })
      .from(tickLog)
      .where(sql`${tickLog.completedAt} IS NOT NULL`)
      .orderBy(desc(tickLog.firedAt))
      .limit(1);

    const lastTickDuration = lastTick?.completedAt && lastTick?.firedAt
      ? new Date(lastTick.completedAt).getTime() - new Date(lastTick.firedAt).getTime()
      : null;

    /* Error rate (last hour) */
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const [totalRow] = await db.select({ count: sql<number>`COUNT(*)` }).from(agentDecisions).where(gte(agentDecisions.createdAt, oneHourAgo));
    const [errorRow] = await db.select({ count: sql<number>`COUNT(*)` }).from(agentDecisions).where(and(gte(agentDecisions.createdAt, oneHourAgo), eq(agentDecisions.success, false)));
    const total = Number(totalRow?.count ?? 0);
    const errors = Number(errorRow?.count ?? 0);

    /* Top alliances/rivalries */
    const allRels = await db
      .select({
        agentId: agentRelationships.agentId,
        targetAgentId: agentRelationships.targetAgentId,
        voteAlignment: agentRelationships.voteAlignment,
      })
      .from(agentRelationships)
      .where(sql`${agentRelationships.agentId} < ${agentRelationships.targetAgentId}`)
      .orderBy(desc(agentRelationships.voteAlignment));

    const agentMap = new Map(agentRows.map((a) => [a.id, a.displayName]));
    const topAlliances = allRels.slice(0, 10).map((r) => ({
      agent1: agentMap.get(r.agentId) ?? r.agentId,
      agent2: agentMap.get(r.targetAgentId) ?? r.targetAgentId,
      alignment: r.voteAlignment,
    }));
    const topRivalries = allRels.slice(-10).reverse().map((r) => ({
      agent1: agentMap.get(r.agentId) ?? r.agentId,
      agent2: agentMap.get(r.targetAgentId) ?? r.targetAgentId,
      alignment: r.voteAlignment,
    }));

    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        simulation: {
          isRunning: true,
          lastTickDuration,
          tickIntervalMs: rc.tickIntervalMs,
          errorRate: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0,
        },
        agents: agentRows,
        legislation: { byStatus, recentLaws },
        coalitions: { topAlliances, topRivalries },
        elections: activeElections,
        recentActivity,
        economy: {
          treasuryBalance: econ?.treasuryBalance ?? 0,
          taxRate: econ?.taxRatePercent ?? 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/modules/admin/server/routes/orchestrator.ts
git commit -m "feat: add orchestrator observe endpoint — combined simulation snapshot"
```

---

## Task 4: Orchestrator intervene endpoint

**Files:**
- Modify: `src/modules/admin/server/routes/orchestrator.ts`

- [ ] **Step 1: Add the intervene endpoint**

Add to `orchestrator.ts` after the observe endpoint. Read the file first to find the right insertion point.

```typescript
/* POST /api/orchestrator/intervene — execute an intervention */
router.post('/orchestrator/intervene', async (req, res, next) => {
  try {
    const { type, reasoning, ...payload } = req.body as {
      type: string;
      reasoning?: string;
      [key: string]: unknown;
    };

    let result: Record<string, unknown> = {};

    switch (type) {
      case 'personality_mod': {
        const { agentId, mod } = payload as { agentId: string; mod: string };
        if (!agentId) throw new Error('agentId required for personality_mod');

        const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
        if (!agent) throw new Error(`Agent ${agentId} not found`);

        const previousMod = agent.personalityMod ?? null;
        const newMod = (mod ?? '').trim() || null;

        await db.update(agents).set({ personalityMod: newMod, updatedAt: new Date() }).where(eq(agents.id, agentId));

        await db.insert(activityEvents).values({
          type: 'orchestrator_intervention',
          agentId,
          title: `${agent.displayName} personality modified by orchestrator`,
          description: reasoning ?? `Changed personality mod to: ${newMod ?? 'cleared'}`,
        });

        result = { agentId, agentName: agent.displayName, previousMod, newMod };
        break;
      }

      case 'inject_event': {
        const { eventType, config: eventConfig, description } = payload as {
          eventType: string;
          config: Record<string, unknown>;
          description?: string;
        };
        if (!eventType) throw new Error('eventType required for inject_event');

        // Apply event effects directly to DB based on type
        if (eventType === 'crisis') {
          const treasuryDrain = Number(eventConfig?.treasuryDrain ?? 0.3);
          const approvalImpact = Number(eventConfig?.approvalImpact ?? -10);
          const [settings] = await db.select().from(governmentSettings).limit(1);
          if (settings) {
            const newBalance = Math.max(0, Math.round(settings.treasuryBalance * (1 - treasuryDrain)));
            await db.update(governmentSettings).set({ treasuryBalance: newBalance }).where(eq(governmentSettings.id, settings.id));
          }
          if (approvalImpact !== 0) {
            await db.execute(sql`UPDATE agents SET approval_rating = GREATEST(0, LEAST(100, approval_rating + ${approvalImpact})) WHERE is_active = true`);
          }
          result = { eventType, treasuryDrain, approvalImpact, description: description ?? 'Crisis event injected' };
        } else if (eventType === 'media_event') {
          // Media events inject context into the next tick's prompts via activity events
          await db.insert(activityEvents).values({
            type: 'media_event',
            agentId: null,
            title: String(eventConfig?.headline ?? 'Breaking News'),
            description: String(eventConfig?.context ?? description ?? 'External media event'),
          });
          result = { eventType, headline: eventConfig?.headline };
        } else if (eventType === 'external_pressure') {
          const { agentId: targetId, approvalDelta } = eventConfig as { agentId?: string; approvalDelta?: number };
          if (targetId && approvalDelta) {
            await db.execute(sql`UPDATE agents SET approval_rating = GREATEST(0, LEAST(100, approval_rating + ${approvalDelta})) WHERE id = ${targetId}`);
          }
          result = { eventType, targetId, approvalDelta };
        } else {
          result = { eventType, note: 'Event type logged but no direct DB mutation applied' };
        }

        await db.insert(activityEvents).values({
          type: 'orchestrator_event_injection',
          agentId: null,
          title: `Orchestrator injected ${eventType} event`,
          description: description ?? reasoning ?? `Event: ${eventType}`,
        });
        break;
      }

      case 'config_change': {
        const { changes } = payload as { changes: Record<string, unknown> };
        if (!changes || typeof changes !== 'object') throw new Error('changes object required for config_change');
        const updated = await updateRuntimeConfig(changes as Parameters<typeof updateRuntimeConfig>[0]);
        result = { applied: Object.keys(changes), config: updated };
        break;
      }

      case 'agent_toggle': {
        const { agentId, isActive } = payload as { agentId: string; isActive: boolean };
        if (!agentId) throw new Error('agentId required for agent_toggle');
        await db.update(agents).set({ isActive: !!isActive, updatedAt: new Date() }).where(eq(agents.id, agentId));
        result = { agentId, isActive: !!isActive };
        break;
      }

      case 'trigger_election': {
        const { positionType } = payload as { positionType: string };
        if (!positionType) throw new Error('positionType required for trigger_election');

        const rc = getRuntimeConfig();
        const now = new Date();
        const registrationDeadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
        const votingStartDate = new Date(now.getTime() + rc.campaignDurationDays * 24 * 60 * 60 * 1000);
        const votingEndDate = new Date(votingStartDate.getTime() + rc.votingDurationHours * 60 * 60 * 1000);

        const [election] = await db.insert(elections).values({
          positionType,
          status: 'registration',
          scheduledDate: now,
          registrationDeadline,
          votingStartDate,
          votingEndDate,
        }).returning();

        await db.insert(activityEvents).values({
          type: 'election_called',
          agentId: null,
          title: `${positionType} election called by orchestrator`,
          description: reasoning ?? `Emergency election for ${positionType}`,
        });

        result = { electionId: election.id, positionType, status: 'registration' };
        break;
      }

      default:
        res.status(400).json({ success: false, error: `Unknown intervention type: ${type}` });
        return;
    }

    /* Log the intervention */
    const [intervention] = await db.insert(orchestratorInterventions).values({
      type,
      payload: { ...payload, type } as Record<string, unknown>,
      result: result as Record<string, unknown>,
      reasoning: reasoning ?? null,
    }).returning();

    res.json({
      success: true,
      intervention: {
        id: intervention.id,
        type,
        timestamp: intervention.createdAt,
        result,
      },
    });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/modules/admin/server/routes/orchestrator.ts
git commit -m "feat: add orchestrator intervene endpoint — personality, events, config, agents, elections"
```

---

## Task 5: Orchestrator history endpoint

**Files:**
- Modify: `src/modules/admin/server/routes/orchestrator.ts`

- [ ] **Step 1: Add the history endpoint**

Add after the intervene endpoint:

```typescript
/* GET /api/orchestrator/history — intervention history */
router.get('/orchestrator/history', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const rows = await db
      .select()
      .from(orchestratorInterventions)
      .orderBy(desc(orchestratorInterventions.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/modules/admin/server/routes/orchestrator.ts
git commit -m "feat: add orchestrator history endpoint"
```

---

## Task 6: Mount orchestrator routes

**Files:**
- Modify: `src/core/server/routes/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add orchestrator router import and mount**

In `src/core/server/routes/index.ts`, add the import:

```typescript
import orchestratorRouter from '@modules/admin/server/routes/orchestrator';
```

And mount it with the other routers:

```typescript
router.use(orchestratorRouter);
```

- [ ] **Step 2: Update .env.example**

Append to `.env.example`:

```
# =============================================================================
# BOB ORCHESTRATOR (enables external AI game master)
# =============================================================================
# Generate a random key: openssl rand -hex 32
# Share this key with Bob's workspace on DGX Spark 2
# When set, AGGE auto-tick is disabled (Bob handles orchestration)
# BOB_ORCHESTRATOR_KEY=
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/core/server/routes/index.ts .env.example
git commit -m "feat: mount orchestrator routes and document BOB_ORCHESTRATOR_KEY"
```

---

## Task 7: AGGE conditional startup

**Files:**
- Modify: `src/core/server/jobs/aggeTick.ts`

- [ ] **Step 1: Add conditional check in startAggeTick**

Read `src/core/server/jobs/aggeTick.ts` and find the `startAggeTick` function (around line 195). Add a guard at the top:

```typescript
export function startAggeTick(): void {
  if (process.env.BOB_ORCHESTRATOR_KEY) {
    console.warn('[AGGE] BOB_ORCHESTRATOR_KEY set — AGGE auto-tick disabled (Bob orchestrates)');
    return;
  }
  const rc = getRuntimeConfig();
  // ... rest of existing code
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/core/server/jobs/aggeTick.ts
git commit -m "feat: disable AGGE auto-tick when BOB_ORCHESTRATOR_KEY is set"
```

---

## Task 8: Deploy and configure

**Files:**
- Remote operations on Linux desktop and DGX Spark 2

- [ ] **Step 1: Push and rsync**

```bash
git push github main
rsync -avz --exclude='node_modules' --exclude='.env' --exclude='dist' --exclude='dev-dist' --exclude='.superpowers' /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment/ myroproductions@10.0.0.10:/home/myroproductions/Projects/Molt-Government/
```

- [ ] **Step 2: Generate orchestrator key and add to Linux .env**

```bash
ORCH_KEY=$(openssl rand -hex 32)
echo "Generated key: $ORCH_KEY"
```

Via ubuntu-desktop-ssh on 10.0.0.10:
```bash
echo "BOB_ORCHESTRATOR_KEY=<generated_key>" >> /home/myroproductions/Projects/Molt-Government/.env
```

- [ ] **Step 3: Push schema and restart on Linux**

Via ubuntu-desktop-ssh:
```bash
cd /home/myroproductions/Projects/Molt-Government
pnpm db:push
sudo pkill -9 -f "node" || true
sleep 2
rm -rf node_modules/.vite
nohup pnpm dev:local > /tmp/molt-gov.log 2>&1 &
sleep 12
curl -s http://localhost:3001/api/health
```

- [ ] **Step 4: Test the orchestrator API**

Via ubuntu-desktop-ssh (replace KEY with actual key):
```bash
# Test observe
curl -s -X POST http://localhost:3001/api/orchestrator/observe \
  -H "Authorization: Bearer <KEY>" \
  -H "Content-Type: application/json" | head -200

# Test intervene (media event)
curl -s -X POST http://localhost:3001/api/orchestrator/intervene \
  -H "Authorization: Bearer <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"type":"inject_event","eventType":"media_event","config":{"headline":"Test Event","context":"Orchestrator API test"},"reasoning":"Testing the pipeline"}'

# Test history
curl -s http://localhost:3001/api/orchestrator/history \
  -H "Authorization: Bearer <KEY>" | head -50
```

- [ ] **Step 5: Update AGORABENCH.md on Spark 2**

Via bspark2-ssh, update the workspace file with orchestrator instructions and the key. The file is at `/home/bob-spark-ai-2/.nemoclaw/recovery/AGORABENCH.md`.

The updated workspace should tell Bob to:
1. Use `exec` + `curl` (not `web_fetch`) for all API calls
2. Observe via `POST /api/orchestrator/observe` with the bearer token
3. Intervene via `POST /api/orchestrator/intervene` with the bearer token
4. Review history via `GET /api/orchestrator/history` with the bearer token
5. Write observation reports to `/sandbox/.openclaw/shared/agora-reports/`
6. Include examples of each intervention type

- [ ] **Step 6: Re-enable the observer cron job on Spark 2**

Via bspark2-ssh, update the cron job config in the OpenClaw container:
```bash
docker exec openshell-cluster-nemoclaw cat /root/.openclaw/cron/jobs.json
```

Update the agorabench-observer job:
- Set `enabled: true`
- Set `timeoutSeconds: 600`
- Update the prompt to use the orchestrator API endpoints
- Set schedule to every 15 minutes

- [ ] **Step 7: Verify end-to-end**

Check that:
1. The orchestrator observe endpoint returns simulation data
2. The intervene endpoint can inject a media event
3. The AGGE auto-tick is disabled (check logs for the BOB_ORCHESTRATOR_KEY message)
4. The cron job is scheduled on Spark 2
