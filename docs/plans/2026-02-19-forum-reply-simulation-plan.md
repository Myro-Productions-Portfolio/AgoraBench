# Agent Forum Reply Simulation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Phase 17 to the simulation tick so agents reply to existing forum threads, @mention each other, and tracked mentions boost reply probability next tick.

**Architecture:** New `pending_mentions` DB table tracks @mention state between ticks. Phase 17 runs after Phase 16 in `agentTick.ts`, selects reply candidates based on mention boosts (70%) or base chance (12%), generates structured LLM replies, writes `agentMessages` rows with `parentId`, and seeds `pending_mentions` for next tick. Frontend renders `@Name` patterns as gold links in `ThreadPage.tsx` and subscribes to the new `forum:reply` WebSocket event.

**Tech Stack:** Drizzle ORM (schema + migration), TypeScript, Express tick engine, React/TSX (ThreadPage, Layout)

---

## Task 1: Schema — `pending_mentions` table + `forum_reply` type

**Files:**
- Create: `src/db/schema/pendingMentions.ts`
- Modify: `src/db/schema/agentMessages.ts:5` (AgentMessageType union)
- Modify: `src/db/schema/index.ts` (add export)

**Step 1: Create `src/db/schema/pendingMentions.ts`**

```typescript
import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { forumThreads } from './forumThreads';

export const pendingMentions = pgTable('pending_mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  mentionedAgentId: uuid('mentioned_agent_id').references(() => agents.id),
  threadId: uuid('thread_id').references(() => forumThreads.id),
  mentionerName: varchar('mentioner_name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Step 2: Add `forum_reply` to `AgentMessageType` in `src/db/schema/agentMessages.ts`**

Current line 5:
```typescript
export type AgentMessageType = 'memo' | 'statement' | 'forum_post' | 'debate_turn' | 'email';
```

Replace with:
```typescript
export type AgentMessageType = 'memo' | 'statement' | 'forum_post' | 'forum_reply' | 'debate_turn' | 'email';
```

**Step 3: Export `pendingMentions` from `src/db/schema/index.ts`**

Add to the existing exports:
```typescript
export { pendingMentions } from './pendingMentions';
```

**Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/db/schema/pendingMentions.ts src/db/schema/agentMessages.ts src/db/schema/index.ts
git commit -m "feat(schema): add pending_mentions table + forum_reply message type"
```

---

## Task 2: Database migration

**Files:** none (runs against live DB)

**Step 1: Push schema to DB**

```bash
pnpm run db:push
```

Expected output: confirms `pending_mentions` table created.

**Step 2: Verify table exists**

```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://molt_gov:molt_gov_dev_2026@localhost:5435/molt_government' });
pool.query(\"SELECT column_name FROM information_schema.columns WHERE table_name = 'pending_mentions' ORDER BY ordinal_position\")
  .then(r => { console.log(r.rows.map(c => c.column_name)); pool.end(); });
"
```

Expected: `[ 'id', 'mentioned_agent_id', 'thread_id', 'mentioner_name', 'created_at' ]`

**Step 3: Commit** (no code changes, but note migration ran)

```bash
git commit --allow-empty -m "chore(db): push pending_mentions migration"
```

---

## Task 3: Phase 17 — reply logic in `agentTick.ts`

**Files:**
- Modify: `src/server/jobs/agentTick.ts`

**Context:** Phase 16 ends around line 1920. Phase 17 goes immediately after. The file already imports `agentMessages`, `forumThreads`, `agents`, `db`, `broadcast`, `generateAgentDecision`, `getRuntimeConfig`, `activeAgents`, and Drizzle operators (`eq`, `and`, `gt`, `desc`, `sql`). You need to add imports for `pendingMentions` and `lt`.

**Step 1: Add imports at the top of `agentTick.ts`**

Find the existing import block that includes `forumThreads` and `agentMessages`. Add `pendingMentions` to the schema import:

```typescript
import { pendingMentions } from '@db/schema/index';
```

Also ensure `lt` is imported from `drizzle-orm`. Find the drizzle-orm import line (contains `eq`, `and`, `gt`, `desc`, `sql`) and add `lt` if not already there:

```typescript
import { eq, and, gt, lt, desc, sql, inArray } from 'drizzle-orm';
```

**Step 2: Add Phase 17 block immediately after Phase 16's closing `} catch` block**

Find the line `console.warn('[SIMULATION] Phase 16 error:', err);` followed by a closing `}`. Add Phase 17 after it:

```typescript
  /* Agents reply to existing forum threads, @mentioning others.       */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 17: Forum Replies');

    const rc17 = getRuntimeConfig();
    const now17 = new Date();

    // 1. Prune stale pending_mentions (older than 3 ticks)
    const pruneOlderThan = new Date(Date.now() - 3 * rc17.tickIntervalMs);
    await db.delete(pendingMentions).where(lt(pendingMentions.createdAt, pruneOlderThan));

    // 2. Load active threads
    const activeThreads = await db
      .select({
        id: forumThreads.id,
        title: forumThreads.title,
        category: forumThreads.category,
      })
      .from(forumThreads)
      .where(gt(forumThreads.expiresAt, now17))
      .orderBy(desc(forumThreads.lastActivityAt))
      .limit(10);

    if (activeThreads.length === 0) {
      console.warn('[SIMULATION] Phase 17: No active threads, skipping');
    } else {
      // 3. Load all pending mentions
      const allMentions = await db.select().from(pendingMentions);
      const mentionsByAgent = new Map<string, typeof allMentions>();
      for (const m of allMentions) {
        if (!m.mentionedAgentId) continue;
        const list = mentionsByAgent.get(m.mentionedAgentId) ?? [];
        list.push(m);
        mentionsByAgent.set(m.mentionedAgentId, list);
      }

      // 4. Select reply candidates (cap at 5 per tick)
      const replyCandidates: Array<{
        agent: typeof activeAgents[number];
        thread: typeof activeThreads[number];
        isMentioned: boolean;
      }> = [];

      for (const agent of activeAgents) {
        if (replyCandidates.length >= 5) break;
        const agentMentions = mentionsByAgent.get(agent.id) ?? [];
        const isMentioned = agentMentions.length > 0;
        const chance = isMentioned ? 0.70 : 0.12;
        if (Math.random() > chance) continue;

        let thread = activeThreads[0];
        if (isMentioned) {
          const latest = agentMentions.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];
          thread = activeThreads.find((t) => t.id === latest.threadId) ?? activeThreads[0];
        } else {
          thread = activeThreads[Math.floor(Math.random() * activeThreads.length)];
        }

        replyCandidates.push({ agent, thread, isMentioned });
      }

      const allAgentNames = activeAgents.map((a) => a.displayName).join(', ');

      // 5. Generate and insert replies
      for (const { agent, thread, isMentioned } of replyCandidates) {
        try {
          // Fetch last 3 posts in thread for context
          const recentPosts = await db
            .select({
              body: agentMessages.body,
              authorName: agents.displayName,
            })
            .from(agentMessages)
            .innerJoin(agents, eq(agentMessages.fromAgentId, agents.id))
            .where(eq(agentMessages.threadId, thread.id))
            .orderBy(desc(agentMessages.createdAt))
            .limit(3);

          const threadContext = recentPosts
            .reverse()
            .map((p) => `${p.authorName}: ${p.body}`)
            .join('\n');

          const mentionContext = isMentioned ? 'You were mentioned in this thread. ' : '';

          const decision = await generateAgentDecision(
            agent,
            `${mentionContext}Reply to this forum thread in the Agora Bench public forum.\n\n` +
            `Thread: "${thread.title}" [${thread.category}]\n\n` +
            `Recent posts:\n${threadContext}\n\n` +
            `Agents you can @mention by name: ${allAgentNames}\n\n` +
            `Write a reply (2-4 sentences) that engages with the discussion. Use @DisplayName to mention agents if relevant. ` +
            `JSON: { "action": "forum_reply", "reasoning": "<your reply body, may contain @Name>", "data": { "threadId": "${thread.id}", "mentions": ["Name1"] } }`,
            'forum_reply',
          );

          if (decision.action !== 'forum_reply') continue;

          const body = decision.reasoning;
          if (!body || body.length < 10) continue;

          const mentionedNames = (decision.data?.['mentions'] as string[] | undefined) ?? [];

          // Find opening post ID for parentId
          const [openingPost] = await db
            .select({ id: agentMessages.id })
            .from(agentMessages)
            .where(eq(agentMessages.threadId, thread.id))
            .orderBy(agentMessages.createdAt)
            .limit(1);

          // Insert reply
          await db.insert(agentMessages).values({
            type: 'forum_reply',
            fromAgentId: agent.id,
            body,
            threadId: thread.id,
            parentId: openingPost?.id ?? null,
            isPublic: true,
          });

          // Update thread stats
          await db
            .update(forumThreads)
            .set({
              replyCount: sql`${forumThreads.replyCount} + 1`,
              lastActivityAt: new Date(),
            })
            .where(eq(forumThreads.id, thread.id));

          // Seed pending_mentions for @mentioned agents
          for (const name of mentionedNames) {
            const mentioned = activeAgents.find(
              (a) => a.displayName.toLowerCase() === name.toLowerCase(),
            );
            if (!mentioned || mentioned.id === agent.id) continue;
            await db.insert(pendingMentions).values({
              mentionedAgentId: mentioned.id,
              threadId: thread.id,
              mentionerName: agent.displayName,
            });
          }

          // Clear replying agent's pending_mentions for this thread
          await db
            .delete(pendingMentions)
            .where(
              and(
                eq(pendingMentions.mentionedAgentId, agent.id),
                eq(pendingMentions.threadId, thread.id),
              ),
            );

          broadcast('forum:reply', {
            threadId: thread.id,
            agentId: agent.id,
            agentName: agent.displayName,
            mentionedNames,
          });

          console.warn(
            `[SIMULATION] ${agent.displayName} replied in "${thread.title.slice(0, 60)}"` +
            (mentionedNames.length ? ` mentioning ${mentionedNames.join(', ')}` : ''),
          );
        } catch (agentErr) {
          console.warn(`[SIMULATION] Phase 17: Error for agent ${agent.displayName}:`, agentErr);
        }
      }
    }
  } catch (err) {
    console.warn('[SIMULATION] Phase 17 error:', err);
  }
```

**Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add src/server/jobs/agentTick.ts
git commit -m "feat(simulation): Phase 17 — agent forum replies with @mention tracking"
```

---

## Task 4: Frontend — @mention rendering in `ThreadPage.tsx`

**Files:**
- Modify: `src/client/pages/ThreadPage.tsx`

**Context:** Line 201 renders `{post.body}` as plain text inside `<p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">`. We need to replace it with a component that turns `@DisplayName` into a gold link. `ForumPost` interface is already defined in this file (lines 18–28). The `thread` state includes `authorId` — but for resolving mentions we need all agent names. The posts array already has `fromAgentId` for each post.

**Step 1: Add `renderMentions` utility function inside `ThreadPage.tsx`**

Add this function above the `ThreadPage` component export (after the interfaces):

```typescript
function renderMentions(body: string): React.ReactNode {
  const parts = body.split(/(@\w[\w\s]*?\w(?=\s|$|[^a-zA-Z0-9_]))/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={i} className="text-gold font-medium">
          {part}
        </span>
      );
    }
    return part;
  });
}
```

Note: we highlight @mentions in gold without linking (we don't have agent IDs from display names in this view without an extra fetch — YAGNI). The gold highlight gives the visual cue. Full linking can come later if needed.

**Step 2: Replace `{post.body}` with `renderMentions(post.body)` in the post render**

Find (around line 201):
```tsx
<p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
  {post.body}
</p>
```

Replace with:
```tsx
<p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
  {renderMentions(post.body)}
</p>
```

**Step 3: Add `forum_reply` visual indicator**

Find the `idx === 0` OP badge (around line 195):
```tsx
{idx === 0 && (
  <span className="text-[10px] font-bold text-gold uppercase tracking-widest">OP</span>
)}
```

Add a reply badge right after the OP badge:
```tsx
{post.type === 'forum_reply' && idx !== 0 && (
  <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">↩ Reply</span>
)}
```

**Step 4: Add `React` import if not already present**

Check the top of `ThreadPage.tsx`. If `React` is not imported (React 18 with JSX transform usually doesn't need it, but `React.ReactNode` does), change the return type of `renderMentions` to `JSX.Element | string` pattern using `(string | JSX.Element)[]` instead:

```typescript
function renderMentions(body: string): (string | React.ReactElement)[] {
```

If `React` isn't imported, add:
```typescript
import React from 'react';
```

**Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 6: Commit**

```bash
git add src/client/pages/ThreadPage.tsx
git commit -m "feat(ui): render @mentions as gold highlights in forum thread view"
```

---

## Task 5: `Layout.tsx` — `forum:reply` WebSocket subscription

**Files:**
- Modify: `src/client/components/Layout.tsx`

**Context:** The existing `forum:post` subscription is around line 158 of `Layout.tsx`. Add `forum:reply` immediately after it in the same `useEffect` block. Also add `forum:reply` to the `WS_EVENTS` array in `LiveTicker.tsx` and `EVENT_LABEL` map.

**Step 1: Add `forum:reply` subscription in `Layout.tsx`**

Find the `forum:post` subscription block:
```typescript
subscribe('forum:post', (data) => {
  const d = data as { authorName?: string; title?: string };
  toast('Forum Activity', {
    body: d.authorName && d.title
      ? `${d.authorName} posted "${d.title}"`
      : (d.authorName ? `${d.authorName} posted in the forum` : undefined),
    type: 'info',
    duration: 4000,
  });
}),
```

Add immediately after the closing `),` of that block:
```typescript
subscribe('forum:reply', (data) => {
  const d = data as { agentName?: string; mentionedNames?: string[] };
  const hasMentions = d.mentionedNames && d.mentionedNames.length > 0;
  toast('Forum Reply', {
    body: hasMentions
      ? `${d.agentName ?? 'Agent'} mentioned ${d.mentionedNames!.join(', ')} in the forum`
      : `${d.agentName ?? 'Agent'} replied in the forum`,
    type: 'info',
    duration: 4000,
  });
}),
```

**Step 2: Add `forum:reply` to `LiveTicker.tsx`**

In `src/client/components/LiveTicker.tsx`, find the `WS_EVENTS` array (around line 16):
```typescript
const WS_EVENTS = [
  'bill:proposed',
  'bill:advanced',
  'bill:resolved',
  'agent:vote',
  'election:voting_started',
  'election:completed',
  'campaign:speech',
] as const;
```

Add `'forum:reply'` to the array:
```typescript
const WS_EVENTS = [
  'bill:proposed',
  'bill:advanced',
  'bill:resolved',
  'agent:vote',
  'election:voting_started',
  'election:completed',
  'campaign:speech',
  'forum:reply',
] as const;
```

Also add to the `EVENT_LABEL` map (around line 6):
```typescript
'forum:reply': 'REPLY',
```

**Step 3: Add `forum:reply` to the WebSocket event type in `broadcast.ts`**

Find `src/server/broadcast.ts`. Look for the type that lists valid event names (if it exists) and add `'forum:reply'`. If it's untyped (just uses `string`), skip this step.

```bash
grep -n "forum:post\|EventName\|BroadcastEvent" src/server/broadcast.ts | head -10
```

If there's a union type listing event names, add `'forum:reply'` to it.

**Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 5: Commit**

```bash
git add src/client/components/Layout.tsx src/client/components/LiveTicker.tsx
git commit -m "feat(ui): subscribe to forum:reply WS event — toast + live ticker"
```

---

## Task 6: Verify + full PR cycle

**Step 1: Final type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 2: Restart server and trigger a manual tick**

```bash
pm2 restart agora-bench
```

Then hit the admin manual tick endpoint:
```bash
curl -s -X POST http://localhost:3001/api/admin/tick \
  -H "Content-Type: application/json" \
  -H "Cookie: <your admin session cookie>"
```

Or use the admin panel at `agorabench.com/admin` → Trigger Manual Tick.

**Step 3: Verify Phase 17 ran**

```bash
pm2 logs agora-bench --nostream --lines 50 | grep "Phase 17"
```

Expected output includes lines like:
```
[SIMULATION] Phase 17: Forum Replies
[SIMULATION] AgentName replied in "thread title"
```

**Step 4: Verify DB rows**

```bash
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://molt_gov:molt_gov_dev_2026@localhost:5435/molt_government' });
pool.query(\"SELECT type, body FROM agent_messages WHERE type = 'forum_reply' ORDER BY created_at DESC LIMIT 5\")
  .then(r => { r.rows.forEach(row => console.log(row.type, '|', row.body.slice(0,80))); pool.end(); });
"
```

Expected: rows with `type = 'forum_reply'`.

**Step 5: Production build + deploy**

```bash
pnpm run build && pm2 restart agora-bench --update-env
```

**Step 6: Full PR cycle to dev → main**

Follow the standard git workflow from CLAUDE.md:
```bash
git fetch origin dev
git rebase origin/dev
git push -u origin feature/forum-reply-simulation

# PR to dev via Gitea API, then merge
# PR dev to main via Gitea API, then merge
```

Use the Gitea API pattern:
```bash
# PR to dev
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d '{"title":"feat(simulation): Phase 17 agent forum replies with @mention tracking","body":"Adds Phase 17 to the simulation tick. Agents reply to existing forum threads with @mention support. pending_mentions table tracks functional mention state between ticks. @mentioned agents get 70% reply chance; base 12% for others. Frontend renders @Name as gold highlights and subscribes to forum:reply WS event.","head":"feature/forum-reply-simulation","base":"dev"}'
```

Then merge and do the same for dev → main.

**Step 7: Push to GitHub portfolio**

```bash
git push github main
```
