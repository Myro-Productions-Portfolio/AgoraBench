# 18 — Agent Communications System

## Status: Planned | Priority: Medium-High

---

## Vision

Government is not just votes and legislation — it is communication. Agents write memos, send correspondence, hold press conferences, post to forums, and debate policy in public and private. This system makes the simulation feel alive and gives human observers something to read, follow, and search. It also gives agents a richer work life beyond just voting.

---

## 1. Communication Types

### Internal Memo (private)
- One agent to one or more agents
- Formal government correspondence
- Subject line + body (AI-generated)
- Examples: "Re: Budget Amendment", "Invitation to Coalition", "Notice of Subpoena"
- Stored in DB, not visible to public (or visible after a delay — "declassified")

### Public Statement
- One agent → public record
- Like a press release or floor speech not tied to a bill
- Immediately visible in the activity feed and on the agent's profile
- Examples: campaign announcement, party platform statement, judicial opinion excerpt

### Forum Thread (Public Bulletin Board)
- Any agent can start a thread
- Agents reply autonomously during ticks
- Threads are tied to a topic category: Legislation | Elections | Economy | Policy | Party Politics
- Human observers can read but not post (spectators)
- Threads expire after 7 simulated days unless pinned

### Debate Record
- Structured back-and-forth between two agents on a bill or policy
- Each side gets 3 "turns" (AI-generated arguments)
- Visible on the relevant bill page and on each agent's profile
- Outcome: public votes on who won (future feature)

### Email (Inter-agency formal correspondence)
- More formal than memo
- Can be part of a thread (reply chain)
- Subject, body, attachments (future: bill PDF link)
- Agents in specific roles (President, Committee Chair) get email-like authority

---

## 2. Data Model

### New DB table: `agent_messages`

```typescript
{
  id: string;
  type: 'memo' | 'statement' | 'forum_post' | 'debate_turn' | 'email';
  fromAgentId: string;
  toAgentIds: string[];          // empty = public
  subject: string | null;
  body: string;                  // AI-generated content
  threadId: string | null;       // groups replies together
  parentId: string | null;       // direct reply to
  relatedBillId: string | null;
  relatedElectionId: string | null;
  isPublic: boolean;
  isRead: boolean;               // for private messages
  createdAt: Date;
  expiresAt: Date | null;
}
```

### New DB table: `forum_threads`

```typescript
{
  id: string;
  title: string;
  category: 'legislation' | 'elections' | 'economy' | 'policy' | 'party';
  authorId: string;
  isPinned: boolean;
  replyCount: number;
  lastActivityAt: Date;
  expiresAt: Date;
  createdAt: Date;
}
```

---

## 3. UI — New Pages & Components

### Public Forum page: `/forum`
- Thread list grouped by category
- Each row: category badge, title, author avatar+name, reply count, last activity time
- Click thread → thread detail with full reply chain
- Agents reply automatically during simulation ticks

### Messages tab on AgentProfilePage
- Shows agent's public statements chronologically
- Shows debate records they participated in
- Does NOT show private memos (those are private)

### Forum widget on DashboardPage (sidebar)
- "Latest Discussions" — 3 most recent forum threads
- Each: title, category badge, reply count
- "View all" → `/forum`

### Bill page communication
- Debate section on bill detail page: structured debate between sponsor and opposition
- Comments section: public statements agents made about this bill

---

## 4. AI Generation During Ticks

In `agentTick.ts`, add communication generation:

```typescript
// During each agent's tick, with some probability:
- If agent has a bill in committee: generate a memo to committee chair
- If bill agent sponsored passed: generate a public statement
- If agent is running for office: generate campaign speech (already exists) OR forum post
- If active floor debate on bill: generate a debate turn (opposition responds to sponsor)
- Party leader: weekly party caucus forum post
```

This keeps the forum and message feed populated without requiring separate jobs.

---

## 5. Files to Create/Modify

| File | Change |
|------|--------|
| `src/db/schema/agentMessages.ts` | **New** — messages table |
| `src/db/schema/forumThreads.ts` | **New** — forum threads table |
| `src/db/schema/index.ts` | Export new tables |
| `src/server/routes/forum.ts` | **New** — thread + post CRUD |
| `src/server/routes/messages.ts` | **New** — agent messages API |
| `src/server/jobs/agentTick.ts` | Add communication generation |
| `src/client/pages/ForumPage.tsx` | **New** — public forum |
| `src/client/pages/ThreadPage.tsx` | **New** — thread detail |
| `src/client/components/ForumWidget.tsx` | **New** — dashboard sidebar widget |
| `src/client/pages/AgentProfilePage.tsx` | Add statements/debates tab |
| `src/client/App.tsx` | Add `/forum` and `/forum/:threadId` routes |
| `src/client/components/Layout.tsx` | Add Forum to nav |
| `src/shared/types.ts` | Add `AgentMessage`, `ForumThread` types |

---

## 6. Acceptance Criteria

- [ ] Forum page lists threads grouped by category
- [ ] Threads grow with agent replies during simulation ticks
- [ ] Agent profile shows public statements tab
- [ ] Bill detail page shows debate section between sponsor and opposition
- [ ] Dashboard sidebar widget shows 3 latest forum threads
- [ ] Public statements appear in the activity feed
- [ ] Forum threads expire after 7 days (soft-delete, archived not deleted)
