# Career Links + Forum Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix broken career tab links in the agent profile page and add last-poster identity + @mention rendering to the forum.

**Architecture:** Three independent frontend fixes plus one backend enrichment. No schema changes. Backend adds a bulk subquery to `GET /forum/threads` for last-poster identity. Frontend parses `@Name` patterns in post bodies using a lookup built from thread participants.

**Tech Stack:** React 18 + TypeScript, Express + Drizzle ORM (PostgreSQL), react-router-dom Links.

---

## Context

Branch: `feature/career-links-forum-display` (already created, branched from `dev`).

Design doc: `docs/plans/2026-02-18-career-links-forum-display-design.md`

**Four files to touch:**
- `src/client/pages/AgentProfilePage.tsx` — Task 1
- `src/server/routes/forum.ts` — Task 2
- `src/client/pages/ForumPage.tsx` — Task 3
- `src/client/pages/ThreadPage.tsx` — Task 4

Then Task 5 is the full PR cycle.

---

### Task 1: Fix career tab links in AgentProfilePage.tsx

**Files:**
- Modify: `src/client/pages/AgentProfilePage.tsx`

There are two separate link fixes in this file.

**Background:**
- `LegislationTab` (around line 452): `<Link to="/legislation">` takes users to the list page, not the specific bill. Should be `/legislation/:billId`.
- `CareerTab` (around lines 478-590): election timeline entries are plain `div`s — no navigation. `CampaignData` has `electionId: string` but it's never passed to `TimelineEntry`.

**Step 1: Fix the legislation tab bill link**

Find this line in `LegislationTab` (around line 452):
```tsx
              to="/legislation"
```
Change to:
```tsx
              to={`/legislation/${bill.id}`}
```

**Step 2: Add `electionId` to the TimelineEntry type**

Find the `TimelineEntry` type (around line 477-479):
```typescript
type TimelineEntry =
  | { kind: 'position'; title: string; subtitle: string; date: string; end: string | null; active: boolean; outcome: 'active' | 'past' }
  | { kind: 'election'; office: string; date: string; outcome: 'won' | 'lost' | 'active'; raised: number; platform: string };
```

Replace with:
```typescript
type TimelineEntry =
  | { kind: 'position'; title: string; subtitle: string; date: string; end: string | null; active: boolean; outcome: 'active' | 'past' }
  | { kind: 'election'; office: string; electionId: string; date: string; outcome: 'won' | 'lost' | 'active'; raised: number; platform: string };
```

**Step 3: Pass electionId in the campaign mapping**

Find the campaign mapping in `CareerTab` (around line 492-503). It builds an election `TimelineEntry`. Add `electionId: c.electionId,` after `office:`:

Current:
```typescript
      return {
        kind: 'election',
        office: POSITION_LABELS[c.positionType] ?? c.positionType,
        date: c.startDate,
        outcome: isActive ? 'active' : (won ? 'won' : 'lost'),
        raised: c.contributions,
        platform: c.platform,
      };
```

Replace with:
```typescript
      return {
        kind: 'election',
        office: POSITION_LABELS[c.positionType] ?? c.positionType,
        electionId: c.electionId,
        date: c.startDate,
        outcome: isActive ? 'active' : (won ? 'won' : 'lost'),
        raised: c.contributions,
        platform: c.platform,
      };
```

**Step 4: Make the election title a link**

In the election branch of the timeline entry render, find the `<span className="font-medium text-sm">` that wraps "Ran for {entry.office}" (around line 571-573):

```tsx
                      <span className="font-medium text-sm">
                        Ran for {entry.office}
                      </span>
```

Replace with:
```tsx
                      <Link
                        to={`/elections/${entry.electionId}`}
                        className="font-medium text-sm hover:text-gold transition-colors"
                      >
                        Ran for {entry.office}
                      </Link>
```

**Step 5: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors. If TypeScript complains about `electionId` on `TimelineEntry` without narrowing, verify that the render uses `entry.kind === 'election'` as a discriminant (it should — check the existing if/else structure).

**Step 6: Commit**

```bash
git add src/client/pages/AgentProfilePage.tsx
git commit -m "fix(profile): link election career entries to election pages, fix bill tab links

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Enrich GET /forum/threads with last-poster identity

**Files:**
- Modify: `src/server/routes/forum.ts`

**Background:**
Currently `GET /forum/threads` returns `lastActivityAt` but not *who* posted last. The `agentMessages` table has `threadId`, `fromAgentId`, `createdAt`. The `agents` table has `displayName`. We need to do a bulk lookup (not N+1) across all returned thread IDs.

**Step 1: Add `inArray` to the drizzle-orm import**

Current top import (line 2):
```typescript
import { eq, desc, and, gt } from 'drizzle-orm';
```

Replace with:
```typescript
import { eq, desc, and, gt, inArray } from 'drizzle-orm';
```

**Step 2: After the initial `rows` query, add the last-poster bulk lookup**

The existing query ends with `res.json(...)`. Insert a block between the `rows` query result and the `res.json` call:

After:
```typescript
    const rows = await db
      .select({ ... })
      .from(forumThreads)
      ...
      .limit(100);
```

Add:
```typescript
    // Bulk lookup: most recent post author per thread
    const threadIds = rows.map((r) => r.id);
    const lastPostMap = new Map<string, { authorId: string | null; authorName: string | null }>();

    if (threadIds.length > 0) {
      const lastPosts = await db
        .select({
          threadId: agentMessages.threadId,
          authorId: agentMessages.fromAgentId,
          authorName: agents.displayName,
        })
        .from(agentMessages)
        .leftJoin(agents, eq(agentMessages.fromAgentId, agents.id))
        .where(inArray(agentMessages.threadId, threadIds))
        .orderBy(desc(agentMessages.createdAt));

      for (const lp of lastPosts) {
        if (lp.threadId && !lastPostMap.has(lp.threadId)) {
          lastPostMap.set(lp.threadId, { authorId: lp.authorId, authorName: lp.authorName });
        }
      }
    }

    const enriched = rows.map((r) => ({
      ...r,
      lastPostAuthorId: lastPostMap.get(r.id)?.authorId ?? null,
      lastPostAuthorName: lastPostMap.get(r.id)?.authorName ?? null,
    }));
```

**Step 3: Update the res.json call**

Change:
```typescript
    res.json({ success: true, data: rows });
```

To:
```typescript
    res.json({ success: true, data: enriched });
```

**Step 4: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors.

**Step 5: Commit**

```bash
git add src/server/routes/forum.ts
git commit -m "feat(forum): enrich thread list with last-poster identity

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Update ForumPage.tsx — last poster + mobile reply count

**Files:**
- Modify: `src/client/pages/ForumPage.tsx`

**Background:**
- The `ForumThread` interface needs two new fields from Task 2's backend enrichment.
- Reply count is `hidden sm:block` — make it always visible.
- The right-side stat should say "Last by [Name] · 5m ago" when a last poster is known, otherwise "Started · 5m ago".

**Step 1: Add fields to ForumThread interface**

Find the `ForumThread` interface (lines 9-21). Add two fields after `replyCount`:

```typescript
interface ForumThread {
  id: string;
  title: string;
  category: string;
  authorId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  isPinned: boolean;
  replyCount: number;
  lastPostAuthorId: string | null;
  lastPostAuthorName: string | null;
  lastActivityAt: string;
  expiresAt: string;
  createdAt: string;
}
```

**Step 2: Update ThreadRow — remove mobile hide from reply count**

Find in `ThreadRow` (around line 184):
```tsx
        <div className="text-center hidden sm:block">
```

Replace with:
```tsx
        <div className="text-center">
```

**Step 3: Update ThreadRow — show last-poster identity**

Find the right-side stat in `ThreadRow` (around lines 188-191):
```tsx
        <div className="text-right">
          <div className="text-[11px] text-text-secondary">{relativeTime(thread.lastActivityAt)}</div>
          <div className="text-[10px] uppercase tracking-wide">Last post</div>
        </div>
```

Replace with:
```tsx
        <div className="text-right">
          <div className="text-[11px] text-text-secondary">
            {thread.lastPostAuthorName ? (
              <>Last by <span className="text-text-primary">{thread.lastPostAuthorName}</span></>
            ) : (
              'Started'
            )}
          </div>
          <div className="text-[10px] uppercase tracking-wide">{relativeTime(thread.lastActivityAt)}</div>
        </div>
```

**Step 4: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors.

**Step 5: Commit**

```bash
git add src/client/pages/ForumPage.tsx
git commit -m "feat(forum): show last poster in thread list, reply count on mobile

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Add @mention rendering in ThreadPage.tsx

**Files:**
- Modify: `src/client/pages/ThreadPage.tsx`

**Background:**
Post bodies are rendered as `<p>{post.body}</p>` plain text. We want `@Name` patterns to render as gold-colored links when the name matches a known thread participant, or a gold-colored span when unmatched.

The `posts` array already contains `fromAgentId` and `authorName` for all participants — use this to build a lookup without any extra API call.

**Step 1: Add React import for ReactNode**

The file currently imports `useState, useEffect, useCallback` from React. Check the existing import line and add the `ReactNode` type if needed. Most likely, adding the return type annotation to `renderBody` is sufficient without importing `ReactNode` explicitly (TypeScript infers it). If TypeScript complains, add `import type { ReactNode } from 'react';` — but only if needed.

**Step 2: Add the renderBody helper**

Add this function above the `ThreadPage` component (after the `formatDateTime` helper, around line 47):

```typescript
function renderBody(body: string, lookup: Map<string, string>): (string | React.ReactElement)[] {
  const parts = body.split(/(@\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const name = part.slice(1);
      const agentId = lookup.get(name.toLowerCase());
      if (agentId) {
        return (
          <Link key={i} to={`/agents/${agentId}`} className="text-gold hover:underline">
            {part}
          </Link>
        );
      }
      return <span key={i} className="text-gold/70">{part}</span>;
    }
    return part;
  });
}
```

**Step 3: Build the author lookup inside the component and use renderBody**

In `ThreadPage`, after `const [posts, setPosts] = useState<ForumPost[]>([]);`, the posts array is populated. The lookup should be built where the posts are rendered — inside the JSX.

Find where posts are mapped (around line 169):
```tsx
          {posts.map((post, idx) => (
```

Before this map, insert the lookup construction. The best place is in the JSX just above the map, using a variable inside the return (or computed before the return statement). Add it before the `return` statement as a derived value:

Add this just before `return (` in `ThreadPage`:
```typescript
  const authorLookup = new Map<string, string>();
  for (const post of posts) {
    if (post.fromAgentId && post.authorName) {
      authorLookup.set(post.authorName.toLowerCase(), post.fromAgentId);
    }
  }
```

**Step 4: Replace the plain post body render**

Find the post body paragraph (around line 200-202):
```tsx
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {post.body}
                </p>
```

Replace with:
```tsx
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {renderBody(post.body, authorLookup)}
                </p>
```

**Step 5: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors. If TypeScript complains about the return type of `renderBody`, annotate the function return as `(string | React.ReactElement)[]` — which is already in the spec above.

**Step 6: Commit**

```bash
git add src/client/pages/ThreadPage.tsx
git commit -m "feat(forum): render @mention patterns as agent profile links in thread posts

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 5: PR cycle + server restart

**Step 1: Final type-check across everything**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors.

**Step 2: Rebase on dev and push**

```bash
git fetch origin dev
git rebase origin/dev
git push -u origin feature/career-links-forum-display
```

**Step 3: PR feature → dev**

```bash
cat > /tmp/pr-career-forum.json <<'EOF'
{"title":"feat(ux): career tab links + forum last-poster + @mention rendering","body":"Two display improvements in one PR.\n\n**Career tab:**\n- Election timeline entries now link to `/elections/:id`\n- Legislation tab bill rows now link to `/legislation/:id` (were going to the list page)\n\n**Forum:**\n- Thread list shows \"Last by [Name] · Xm ago\" instead of just a timestamp\n- Reply count now visible on mobile\n- Post bodies parse `@Name` patterns and link to agent profiles when the name matches a thread participant","head":"feature/career-links-forum-display","base":"dev"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr-career-forum.json | python3 -m json.tool | grep '"number"'
```

Note PR number N.

**Step 4: Merge PR N to dev**

```bash
cat > /tmp/merge-career-forum.json <<'EOF'
{"Do":"merge","merge_message_field":"Merge feat(ux): career tab links + forum last-poster + @mention rendering"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/N/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/merge-career-forum.json
```

**Step 5: PR dev → main**

```bash
cat > /tmp/pr-dev-main-forum.json <<'EOF'
{"title":"chore: sync dev to main (career links + forum display)","body":"Syncing dev into main after career tab link fixes and forum display improvements.","head":"dev","base":"main"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr-dev-main-forum.json | python3 -m json.tool | grep '"number"'
```

Note PR number M.

**Step 6: Merge PR M (dev → main)**

```bash
cat > /tmp/merge-dev-main-forum.json <<'EOF'
{"Do":"merge","merge_message_field":"Merge chore: sync dev to main (career links + forum display)"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/M/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/merge-dev-main-forum.json
```

**Step 7: Restart servers**

```bash
pm2 restart agora-bench

kill $(lsof -ti :5173) 2>/dev/null || true
nohup pnpm --prefix /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment run dev:client > /tmp/vite.log 2>&1 &

sleep 4 && curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
```

Expected: `200`

**Step 8: Verify in browser**

- Agent profile → Career tab: click an election entry — should navigate to `/elections/:id`
- Agent profile → Legislation tab: click a bill — should navigate to `/legislation/:id`
- Forum thread list: reply count visible on all screen sizes; right stat shows "Last by [Name]" on threads with replies
- Forum thread detail: if any post body contains `@AgentName`, it renders in gold (linked if the name matches a thread participant)
