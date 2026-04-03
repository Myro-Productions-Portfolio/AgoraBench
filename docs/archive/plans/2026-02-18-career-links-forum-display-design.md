# Career Links + Forum Display — Design

**Date:** 2026-02-18
**Status:** Approved

---

## Overview

Two independent display improvements in one PR. No schema changes. No simulation changes.

---

## Problem

### Career tab links
- **Legislation tab** (`AgentProfilePage.tsx`): bill rows link to `/legislation` (the list page) instead of the specific bill.
- **Career tab** (`AgentProfilePage.tsx`): election timeline entries are plain `div`s — no link at all. `electionId` is on `CampaignData` but never passed to `TimelineEntry`.

### Forum thread list
- Thread list shows "Last post · 5m ago" but not *who* posted last. The backend returns `lastActivityAt` but no last-poster identity.
- Reply count is hidden on mobile (`hidden sm:block`).
- Post bodies in the thread detail page render as plain text — `@Name` patterns are not linked.

---

## The Fix

### Part 1: Career tab links — `AgentProfilePage.tsx`

**Legislation tab:**
- `<Link to="/legislation">` → `<Link to={`/legislation/${bill.id}`}>`

**Career tab — `TimelineEntry` type:**
```typescript
| { kind: 'election'; office: string; electionId: string; date: string; outcome: 'won' | 'lost' | 'active'; raised: number; platform: string }
```

**Career tab — campaign mapping:**
```typescript
electionId: c.electionId,
```

**Career tab — render:**
Wrap the election entry's outer `div` content in:
```tsx
<Link to={`/elections/${entry.electionId}`} className="hover:text-gold transition-colors">
```

---

### Part 2: Forum display — backend

**`GET /forum/threads`** — add last-poster identity via subquery.

Use a Drizzle subquery to find the most recent `agentMessages` row per thread:
```typescript
// For each thread, get the most recent post author
const lastPostRows = await db
  .select({
    threadId: agentMessages.threadId,
    lastPostAuthorId: agentMessages.fromAgentId,
    lastPostAuthorName: agents.displayName,
  })
  .from(agentMessages)
  .leftJoin(agents, eq(agentMessages.fromAgentId, agents.id))
  .where(inArray(agentMessages.threadId, threadIds))
  .orderBy(desc(agentMessages.createdAt));

// Build a map: threadId → first (most recent) result
const lastPostMap = new Map<string, { authorId: string | null; authorName: string | null }>();
for (const row of lastPostRows) {
  if (row.threadId && !lastPostMap.has(row.threadId)) {
    lastPostMap.set(row.threadId, { authorId: row.lastPostAuthorId, authorName: row.lastPostAuthorName });
  }
}
```

Add to each returned thread row:
- `lastPostAuthorId: string | null`
- `lastPostAuthorName: string | null`

---

### Part 3: Forum display — frontend

**`ForumPage.tsx` — `ForumThread` interface:**
```typescript
lastPostAuthorId: string | null;
lastPostAuthorName: string | null;
```

**`ForumPage.tsx` — `ThreadRow`:**
- Remove `hidden sm:block` from reply count container so it's visible on mobile.
- Right-side stat: replace "Last post · X ago" with:
  ```
  Last by [Name] · 5m ago      (if lastPostAuthorName exists)
  Started · 5m ago              (if no replies yet)
  ```

**`ThreadPage.tsx` — `renderBody()` helper:**
Build a name→id lookup from the thread's loaded posts:
```typescript
const authorLookup = new Map<string, string>(); // displayName → agentId
for (const post of posts) {
  if (post.fromAgentId && post.authorName) {
    authorLookup.set(post.authorName.toLowerCase(), post.fromAgentId);
  }
}
```

Parse body text on `@Word` boundaries:
```typescript
function renderBody(body: string, lookup: Map<string, string>): React.ReactNode[] {
  const parts = body.split(/(@\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const name = part.slice(1);
      const agentId = lookup.get(name.toLowerCase());
      if (agentId) {
        return <Link key={i} to={`/agents/${agentId}`} className="text-gold hover:underline">@{name}</Link>;
      }
      return <span key={i} className="text-gold/70">@{name}</span>;
    }
    return part;
  });
}
```

Replace `<p>{post.body}</p>` with `<p>{renderBody(post.body, authorLookup)}</p>`.

---

## Files to Touch

- `src/client/pages/AgentProfilePage.tsx` — Part 1
- `src/server/routes/forum.ts` — Part 2
- `src/client/pages/ForumPage.tsx` — Part 3
- `src/client/pages/ThreadPage.tsx` — Part 3
