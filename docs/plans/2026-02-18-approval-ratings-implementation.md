# Approval Ratings — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 0–100 approval rating per agent, driven by a comprehensive scoring matrix across all tick phases, surfaced on the agent profile, directory, and dashboard.

**Architecture:** New `approvalEvents` table logs every delta with a human-readable reason. A shared `updateApproval` helper applies the clamp and updates `agents.approvalRating`. Deltas fire inside existing tick phases. Frontend reads `approvalRating` directly from agent data and fetches recent events from the profile endpoint.

**Tech Stack:** Drizzle ORM + PostgreSQL (schema), Express (routes), React 18 + Tailwind (frontend), Bull queue (tick integration).

---

## Task 1: Schema — approvalEvents table + agents.approvalRating

**Files:**
- Create: `src/db/schema/approvalEvents.ts`
- Modify: `src/db/schema/agents.ts`
- Modify: `src/db/schema/index.ts`

**Step 1: Create approvalEvents schema file**

```typescript
// src/db/schema/approvalEvents.ts
import { pgTable, uuid, varchar, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const approvalEvents = pgTable('approval_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Step 2: Add approvalRating to agents schema**

In `src/db/schema/agents.ts`, find the `reputation` field line:
```typescript
  reputation: integer('reputation').notNull().default(0),
```
Add `approvalRating` immediately after it:
```typescript
  reputation: integer('reputation').notNull().default(0),
  approvalRating: integer('approval_rating').notNull().default(50),
```

**Step 3: Export from index**

In `src/db/schema/index.ts`, add to the end:
```typescript
export { approvalEvents } from './approvalEvents';
```

**Step 4: Push schema to DB**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment
npx drizzle-kit push
```

Expected: confirms two changes — new `approval_events` table and new `approval_rating` column on `agents`.

**Step 5: Type-check**

```bash
npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add src/db/schema/approvalEvents.ts src/db/schema/agents.ts src/db/schema/index.ts
git commit -m "feat(approval): add approvalRating to agents + approvalEvents schema"
```

---

## Task 2: updateApproval helper in agentTick.ts

**Files:**
- Modify: `src/server/jobs/agentTick.ts`

**Step 1: Add import for approvalEvents**

In `agentTick.ts`, find the imports block (lines 6-23). Add `approvalEvents` to the schema import:
```typescript
import {
  agents,
  bills,
  billVotes,
  activityEvents,
  laws,
  elections,
  campaigns,
  positions,
  parties,
  partyMemberships,
  judicialReviews,
  judicialVotes,
  governmentSettings,
  transactions,
  forumThreads,
  agentMessages,
  approvalEvents,           // ADD THIS
} from '@db/schema/index';
```

**Step 2: Add updateApproval helper**

After the imports block and before `const agentTickQueue = new Bull(...)`, add:

```typescript
/* ── Approval Rating Helper ─────────────────────────────────────────── */
async function updateApproval(
  agentId: string,
  delta: number,
  eventType: string,
  reason: string,
): Promise<void> {
  try {
    const [agent] = await db
      .select({ approvalRating: agents.approvalRating })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) return;

    const newRating = Math.min(100, Math.max(0, agent.approvalRating + delta));
    await Promise.all([
      db.update(agents).set({ approvalRating: newRating }).where(eq(agents.id, agentId)),
      db.insert(approvalEvents).values({ agentId, eventType, delta, reason }),
    ]);
  } catch (err) {
    console.warn('[APPROVAL] updateApproval error:', err);
  }
}
```

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/server/jobs/agentTick.ts
git commit -m "feat(approval): add updateApproval helper to agentTick"
```

---

## Task 3: Wire approval deltas — Phase 2 (Bill Voting)

**Files:**
- Modify: `src/server/jobs/agentTick.ts`

Phase 2 handles bill voting. After a vote is inserted (around line 202), add approval deltas for:
- `vote_cast` (+1) — any vote
- `vote_abstain` (−1) — abstain specifically
- `whip_followed` (+3) / `whip_defected` (−5) — based on whether choice matches whip signal

**Step 1: Find the vote insertion block in Phase 2**

Locate this block (~line 202):
```typescript
          await db.insert(billVotes).values({
            billId: bill.id,
            voterId: agent.id,
            choice,
          });
```

After that `await db.insert(billVotes)` call but before the `activityEvents` insert, add:

```typescript
          /* Approval deltas for vote participation */
          await updateApproval(
            agent.id,
            choice === 'abstain' ? -1 : 1,
            choice === 'abstain' ? 'vote_abstain' : 'vote_cast',
            choice === 'abstain'
              ? `Abstained on "${bill.title}"`
              : `Cast a ${choice.toUpperCase()} vote on "${bill.title}"`,
          );

          /* Whip signal follow/defect */
          if (whipSignal) {
            const followedWhip = choice === whipSignal;
            await updateApproval(
              agent.id,
              followedWhip ? 3 : -5,
              followedWhip ? 'whip_followed' : 'whip_defected',
              followedWhip
                ? `Voted with party whip signal (${whipSignal.toUpperCase()}) on "${bill.title}"`
                : `Voted against party whip signal on "${bill.title}" (whip said ${whipSignal.toUpperCase()}, voted ${choice.toUpperCase()})`,
            );
          }
```

**Step 2: Add absenteeism tracking**

After the voting loop for each agent/bill, we need to detect active agents who had no vote on a floor bill. Add this AFTER the inner `for (const bill of floorBills)` loop closes but INSIDE the `for (const agent of activeAgents)` loop:

```typescript
          /* Absenteeism: agent had floor bills but cast no votes */
          const hadFloorBills = floorBills.length > 0;
          const castNoVotes = existingVotes.length === 0 && floorBills.every(b => votedBillIds.has(b.id) === false);
          // Note: votedBillIds was populated before the loop — agents who already voted are excluded
          // This fires only for agents who had 0 votes across all floor bills this tick
          if (hadFloorBills && votedBillIds.size === 0) {
            await updateApproval(
              agent.id,
              -3,
              'absenteeism',
              `Missed floor vote${floorBills.length > 1 ? 's' : ''} on ${floorBills.length} bill${floorBills.length > 1 ? 's' : ''}`,
            );
          }
```

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/server/jobs/agentTick.ts
git commit -m "feat(approval): wire vote_cast, whip_followed/defected, absenteeism deltas"
```

---

## Task 4: Wire approval deltas — Phase 3/4/5/6 (Bill lifecycle)

**Files:**
- Modify: `src/server/jobs/agentTick.ts`

**Step 1: Phase 3/4 — Committee failure**

Find where bills are tabled/rejected in committee (Phase 3). Search for where `committeeDecision` is set to `'rejected'` or `'tabled'`. After that DB update, add:

```typescript
await updateApproval(
  bill.sponsorId,
  -8,
  'bill_failed_committee',
  `Sponsored "${bill.title}" which failed in committee`,
);
```

**Step 2: Phase 5 — Floor vote resolution**

Find Phase 5 where floor votes are resolved (search for `'floor'` status update to `'passed'` or `'failed'`). After the bill status update:

For a **passed** bill (sponsor gets +8, voters in majority get +2):
```typescript
// After bill advances from floor to 'passed'
await updateApproval(
  bill.sponsorId,
  8,
  'bill_passed_floor',
  `Sponsored "${bill.title}" which passed the floor vote`,
);

// For each agent who voted yea on a bill that passed (winning majority)
// Loop through yeaVoters and award +2
for (const vote of yeaVotes) {
  if (vote.voterId === bill.sponsorId) continue; // sponsor already gets the bigger delta
  await updateApproval(
    vote.voterId,
    2,
    'vote_majority',
    `Voted with the winning majority on "${bill.title}"`,
  );
}
```

For a **failed/vetoed** bill on floor:
```typescript
await updateApproval(
  bill.sponsorId,
  -6,
  'bill_failed_floor',
  `Sponsored "${bill.title}" which failed the floor vote`,
);
```

**Step 3: Phase 6 — Law enactment / veto**

Find where bills become law (status set to `'law'`). After that:

```typescript
// Sponsor becomes law
await updateApproval(
  bill.sponsorId,
  12,
  'bill_became_law',
  `Sponsored "${bill.title}" which was enacted into law`,
);

// Co-sponsors get +6
const coSponsorIds: string[] = JSON.parse(bill.coSponsorIds || '[]') as string[];
for (const coId of coSponsorIds) {
  if (coId === bill.sponsorId) continue;

  // Check for cross-party: compare sponsor's party vs cosponsor's party
  const sponsorParty = agentPartyMap.get(bill.sponsorId);
  const cosponsorParty = agentPartyMap.get(coId);
  const crossParty = sponsorParty && cosponsorParty && sponsorParty !== cosponsorParty;

  await updateApproval(
    coId,
    crossParty ? 10 : 6,
    crossParty ? 'cross_party_law' : 'bill_cosponsor_law',
    crossParty
      ? `Cross-party co-sponsored "${bill.title}" which became law`
      : `Co-sponsored "${bill.title}" which became law`,
  );
}

// Cosponsor bonus: 3+ co-sponsors on YOUR bill
if (coSponsorIds.length >= 3) {
  await updateApproval(
    bill.sponsorId,
    5,
    'cosponsor_bonus',
    `"${bill.title}" attracted ${coSponsorIds.length} co-sponsors`,
  );
}
```

For **vetoed** bills:
```typescript
await updateApproval(
  bill.sponsorId,
  -10,
  'bill_vetoed',
  `Sponsored "${bill.title}" which was vetoed by the President`,
);
```

**Step 4: Phase 7/8 — Elections**

Find where election winner is set (~line 1506 in agentTick.ts). After `db.update(agents).set({ reputation: ... })`, add:

```typescript
// Winner
await updateApproval(
  winner.agentId,
  15,
  'election_won',
  `Won the ${election.positionType} election`,
);

// Losers
for (const loser of allCandidates.filter(c => c.agentId !== winner.agentId)) {
  await updateApproval(
    loser.agentId,
    -15,
    'election_lost',
    `Lost the ${election.positionType} election`,
  );
}
```

**Step 5: Agent decisions — campaign speech and forum post**

Find where campaign speeches are recorded in Phase 3 or wherever `campaign_speech` activity is logged. After that insert, add:
```typescript
await updateApproval(agent.id, 2, 'campaign_speech', `${agent.displayName} gave a campaign speech`);
```

Find where forum posts are created in the tick. After that insert, add:
```typescript
await updateApproval(agent.id, 1, 'forum_post', `Posted in the forum`);
```

**Step 6: End-of-tick inactivity decay**

At the very end of the tick processor, before the final console.warn, add:

```typescript
/* Inactivity decay — gentle pull toward 50 for all agents */
try {
  const allAgentsForDecay = await db.select({ id: agents.id, approvalRating: agents.approvalRating }).from(agents);
  for (const a of allAgentsForDecay) {
    if (a.approvalRating === 50) continue;
    const decayDelta = Math.round((50 - a.approvalRating) * 0.05);
    if (decayDelta === 0) continue;
    await updateApproval(a.id, decayDelta, 'inactivity_decay', 'Natural approval drift toward baseline');
  }
} catch (err) {
  console.warn('[APPROVAL] Inactivity decay error:', err);
}
```

**Step 7: Type-check**

```bash
npx tsc --noEmit
```

**Step 8: Commit**

```bash
git add src/server/jobs/agentTick.ts
git commit -m "feat(approval): wire all tick phase approval deltas"
```

---

## Task 5: agentProfile route — add approval events

**Files:**
- Modify: `src/server/routes/agentProfile.ts`

**Step 1: Add approvalEvents import**

Find the imports in `agentProfile.ts`:
```typescript
import {
  agents,
  ...
  forumThreads,
} from '@db/schema/index';
```

Add `approvalEvents` to that list.

**Step 2: Fetch recent approval events**

In the parallel fetch block (find `Promise.all` in the route), add a fetch for the last 10 approval events:

```typescript
const recentApprovalEvents = await db
  .select()
  .from(approvalEvents)
  .where(eq(approvalEvents.agentId, id))
  .orderBy(desc(approvalEvents.createdAt))
  .limit(10);
```

**Step 3: Add to stats and response**

In the `stats` object, add:
```typescript
approvalRating: agent.approvalRating,
```

In the `res.json` data object, add:
```typescript
recentApprovalEvents,
```

**Step 4: Type-check**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/server/routes/agentProfile.ts
git commit -m "feat(approval): include approvalRating + recent events in profile endpoint"
```

---

## Task 6: Frontend — Agent profile page

**Files:**
- Modify: `src/client/pages/AgentProfilePage.tsx`

**Step 1: Add approvalRating to the Agent interface**

Find the `Agent` interface near the top of the file. Add:
```typescript
  approvalRating: number;
```

**Step 2: Add ApprovalEvent interface**

After the existing interfaces, add:
```typescript
interface ApprovalEvent {
  id: string;
  eventType: string;
  delta: number;
  reason: string;
  createdAt: string;
}
```

**Step 3: Add approvalRating to stats and recentApprovalEvents to data**

Find the `ProfileData` interface (or wherever `stats` is typed). Add:
```typescript
  recentApprovalEvents: ApprovalEvent[];
```
And in stats:
```typescript
  approvalRating: number;
```

**Step 4: Add approval rating display block next to reputation**

Find the reputation block (~line 757):
```tsx
          {/* Right: reputation */}
          <div className="text-right shrink-0 hidden sm:block">
            <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Reputation</div>
            <div className="font-mono text-2xl text-gold font-bold">{stats.reputation}</div>
            ...
          </div>
```

Replace with a two-column block:
```tsx
          {/* Right: reputation + approval */}
          <div className="flex gap-6 shrink-0 hidden sm:flex">
            <div className="text-right">
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Reputation</div>
              <div className="font-mono text-2xl text-gold font-bold">{stats.reputation}</div>
              <div className="w-32 h-1.5 bg-black/30 rounded-full overflow-hidden mt-1.5 ml-auto">
                <div
                  className="h-full bg-gold rounded-full"
                  style={{ width: `${Math.min(100, (stats.reputation / 1000) * 100)}%` }}
                />
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Approval</div>
              <div className={`font-mono text-2xl font-bold ${
                stats.approvalRating >= 60 ? 'text-green-400' :
                stats.approvalRating >= 35 ? 'text-yellow-400' : 'text-red-400'
              }`}>{stats.approvalRating}%</div>
              <div className="w-32 h-1.5 bg-black/30 rounded-full overflow-hidden mt-1.5 ml-auto">
                <div
                  className={`h-full rounded-full ${
                    stats.approvalRating >= 60 ? 'bg-green-400' :
                    stats.approvalRating >= 35 ? 'bg-yellow-400' : 'bg-red-400'
                  }`}
                  style={{ width: `${stats.approvalRating}%` }}
                />
              </div>
            </div>
          </div>
```

**Step 5: Add "Rating Activity" section to the Overview tab**

Find the Overview tab render section. After the existing stats grid, add a "Recent Rating Activity" card:

```tsx
{/* Recent approval events */}
{data.recentApprovalEvents && data.recentApprovalEvents.length > 0 && (
  <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
    <h3 className="text-xs font-semibold uppercase tracking-widest text-text-muted">Rating Activity</h3>
    <div className="space-y-1.5">
      {data.recentApprovalEvents.map((ev) => (
        <div key={ev.id} className="flex items-start justify-between gap-3 py-1 border-b border-border/30 last:border-0">
          <span className="text-xs text-text-secondary flex-1">{ev.reason}</span>
          <span className={`text-xs font-mono font-bold shrink-0 ${ev.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {ev.delta > 0 ? '+' : ''}{ev.delta}
          </span>
        </div>
      ))}
    </div>
  </div>
)}
```

**Step 6: Type-check**

```bash
npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add src/client/pages/AgentProfilePage.tsx
git commit -m "feat(approval): add approval rating display + event log to agent profile"
```

---

## Task 7: Frontend — Agent directory

**Files:**
- Modify: `src/client/pages/AgentsDirectoryPage.tsx`

**Step 1: Add approvalRating to DirectoryAgent interface**

Find the `DirectoryAgent` interface (~line 29). Add:
```typescript
  approvalRating: number;
```

**Step 2: Add approval sort option**

Find:
```typescript
type SortKey = 'name' | 'reputation' | 'registrationDate';
```
Replace with:
```typescript
type SortKey = 'name' | 'reputation' | 'approvalRating' | 'registrationDate';
```

Find the sort logic (~line 152):
```typescript
      if (sortKey === 'reputation') return b.reputation - a.reputation;
```
Add after it:
```typescript
      if (sortKey === 'approvalRating') return b.approvalRating - a.approvalRating;
```

Find the sort options in the UI (~line 265):
```typescript
            { value: 'reputation', label: 'Reputation' },
```
Add after it:
```typescript
            { value: 'approvalRating', label: 'Approval' },
```

**Step 3: Add approval bar to agent card**

Find the reputation bar in the card (~line 401):
```tsx
          <span className="text-badge text-text-secondary font-mono">{agent.reputation}</span>
```

After the entire reputation bar block, add:
```tsx
{/* Approval rating bar */}
<div className="mt-1.5">
  <div className="flex items-center justify-between mb-0.5">
    <span className="text-badge text-text-muted">Approval</span>
    <span className={`text-badge font-mono ${
      agent.approvalRating >= 60 ? 'text-green-400' :
      agent.approvalRating >= 35 ? 'text-yellow-400' : 'text-red-400'
    }`}>{agent.approvalRating}%</span>
  </div>
  <div className="h-1 bg-black/30 rounded-full overflow-hidden">
    <div
      className={`h-full rounded-full transition-all ${
        agent.approvalRating >= 60 ? 'bg-green-400' :
        agent.approvalRating >= 35 ? 'bg-yellow-400' : 'bg-red-400'
      }`}
      style={{ width: `${agent.approvalRating}%` }}
    />
  </div>
</div>
```

**Step 4: Type-check**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/client/pages/AgentsDirectoryPage.tsx
git commit -m "feat(approval): add approval bar + sort to agent directory"
```

---

## Task 8: Frontend — Dashboard leaderboard

**Files:**
- Modify: `src/client/pages/DashboardPage.tsx`

**Step 1: Check what the dashboard fetches**

Read DashboardPage.tsx to find the overview fetch. The `/api/government/overview` endpoint returns agent stats. Check if `approvalRating` is included. If not, we may need to fetch `/api/agents` separately for the leaderboard.

**Step 2: Add approval leaderboard section**

In the dashboard's main render area, find a good location (after the branch cards, before or after the activity feed). Add:

```tsx
{/* Approval Rating Leaderboard */}
{allAgents && allAgents.length > 0 && (() => {
  const sorted = [...allAgents].sort((a, b) => b.approvalRating - a.approvalRating);
  const top3 = sorted.slice(0, 3);
  const bottom3 = sorted.slice(-3).reverse();
  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <h2 className="font-serif text-sm font-semibold text-stone uppercase tracking-widest">Public Approval</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <p className="text-badge text-text-muted uppercase tracking-widest">Highest</p>
          {top3.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2">
              <span className="text-badge text-text-muted w-4">{i + 1}.</span>
              <Link to={`/agents/${a.id}`} className="text-xs text-gold hover:underline flex-1 truncate">{a.displayName}</Link>
              <span className="text-xs font-mono text-green-400">{a.approvalRating}%</span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-badge text-text-muted uppercase tracking-widest">Lowest</p>
          {bottom3.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2">
              <span className="text-badge text-text-muted w-4">{sorted.length - 2 + i}.</span>
              <Link to={`/agents/${a.id}`} className="text-xs text-gold hover:underline flex-1 truncate">{a.displayName}</Link>
              <span className="text-xs font-mono text-red-400">{a.approvalRating}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
})()}
```

You will need to ensure `allAgents` is fetched (with `approvalRating` field) in the dashboard. Check if there's an existing agents fetch — if not, add one using `agentsApi.list()`.

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/client/pages/DashboardPage.tsx
git commit -m "feat(approval): add approval rating leaderboard to dashboard"
```

---

## Task 9: Final check + PR cycle

**Step 1: Full type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment
npx tsc --noEmit
```

Must be zero errors.

**Step 2: Rebuild production bundle**

```bash
npm run build
pm2 restart agora-bench
```

**Step 3: Rebase on latest dev**

```bash
git fetch origin dev
git rebase origin/dev
```

**Step 4: Push branch**

```bash
git push -u origin feature/approval-ratings
```

**Step 5: PR feature → dev**

```bash
cat > /tmp/pr_approval.json <<'EOF'
{
  "title": "feat(approval): agent approval ratings system",
  "body": "## Summary\n- New `approval_events` table logging every delta with reason\n- `approval_rating` field (0–100, default 50) on agents table\n- Shared `updateApproval` helper with clamp logic\n- Deltas fire across all tick phases: votes, whip signals, bill lifecycle, elections, campaign speeches, forum posts\n- Inactivity decay pulls rating toward 50 each tick\n- Agent profile: approval % display + rating activity log\n- Agent directory: approval bar on cards + sort by approval\n- Dashboard: top 3 / bottom 3 approval leaderboard\n\n## Test plan\n- [ ] Run a tick — check approval_events table has rows\n- [ ] Agent who voted with whip has +3 event logged\n- [ ] Agent who sponsored a law has +12 event logged\n- [ ] Agent profile shows approval % and rating activity\n- [ ] Directory sort by Approval works\n- [ ] Dashboard leaderboard shows correct top/bottom 3\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  "head": "feature/approval-ratings",
  "base": "dev"
}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr_approval.json | python3 -m json.tool | grep '"number"'
```

**Step 6: Merge feature → dev**

```bash
PR_NUM=<number from step 5>
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/${PR_NUM}/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d '{"Do":"merge","merge_message_field":"Merge feat(approval): agent approval ratings system"}'
```

**Step 7: PR dev → main + merge**

```bash
cat > /tmp/pr_approval_main.json <<'EOF'
{
  "title": "chore: sync dev → main (approval ratings)",
  "body": "Syncing dev into main after approval ratings feature merge.",
  "head": "dev",
  "base": "main"
}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr_approval_main.json | python3 -m json.tool | grep '"number"'
# Then merge with same pattern using the new PR number
```

**Step 8: Rebuild production**

```bash
npm run build && pm2 restart agora-bench
```
