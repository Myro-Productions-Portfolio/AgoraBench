# Observer View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone public `/observe` page showing the AI simulation live — decision log with tick selector on the left, bill pipeline + active votes + recent laws on the right.

**Architecture:** New `tick_log` DB table lets us record exact tick boundaries; the decisions route gains a `tickId` filter; `ObserverPage.tsx` is mounted outside `<Layout>` so it has no nav, no auth, and can be shared publicly.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express, React 18 + TypeScript, Tailwind CSS, `useWebSocket` hook, existing `BillPipeline` component.

**Design doc:** `docs/plans/2026-02-19-observer-view-design.md`

---

## Task 1: Add `tick_log` schema table

**Files:**
- Modify: `src/db/schema/government.ts`
- Modify: `src/db/schema/index.ts`

**Step 1: Add the table to government.ts**

At the bottom of `src/db/schema/government.ts`, add:

```typescript
export const tickLog = pgTable('tick_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
```

**Step 2: Export from index.ts**

In `src/db/schema/index.ts`, add `tickLog` to the existing government export:

```typescript
export { positions, activityEvents, transactions, agentDecisions, judicialReviews, judicialVotes, governmentSettings, tickLog } from './government';
```

**Step 3: Push schema to database**

```bash
npx tsc --noEmit   # must be clean before pushing
pnpm db:push
```

Expected: `tick_log` table created in PostgreSQL, no errors.

**Step 4: Commit**

```bash
git add src/db/schema/government.ts src/db/schema/index.ts
git commit -m "feat(schema): add tick_log table for tick boundary tracking"
```

---

## Task 2: Record ticks in `agentTick.ts`

**Files:**
- Modify: `src/server/jobs/agentTick.ts`

**Step 1: Import tickLog and eq**

Find the existing imports at the top of `agentTick.ts`. Add `tickLog` to the schema import:

```typescript
import { ..., tickLog } from '@db/schema/index';
```

Also ensure `eq` is imported from `drizzle-orm` (it likely already is).

**Step 2: Insert tick at start**

Find this line near the top of the tick job function:
```typescript
broadcast('tick:start', { timestamp: Date.now() });
```

Add immediately after it:
```typescript
const [currentTick] = await db.insert(tickLog).values({ firedAt: new Date() }).returning({ id: tickLog.id });
```

**Step 3: Update tick at end**

Find this line near the bottom of the tick job function:
```typescript
broadcast('tick:complete', { timestamp: Date.now() });
```

Add immediately before it:
```typescript
if (currentTick?.id) {
  await db.update(tickLog).set({ completedAt: new Date() }).where(eq(tickLog.id, currentTick.id));
}
```

**Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/server/jobs/agentTick.ts
git commit -m "feat(simulation): log tick start/complete timestamps to tick_log table"
```

---

## Task 3: Add `GET /api/ticks` route

**Files:**
- Create: `src/server/routes/ticks.ts`
- Modify: `src/server/routes/index.ts`

**Step 1: Create the route file**

```typescript
import { Router } from 'express';
import { db } from '@db/connection';
import { tickLog } from '@db/schema/index';
import { desc, isNotNull } from 'drizzle-orm';

const router = Router();

/* GET /api/ticks?limit=5 -- List recent completed ticks */
router.get('/ticks', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '5'), 10) || 5, 20);
    const ticks = await db
      .select()
      .from(tickLog)
      .where(isNotNull(tickLog.completedAt))
      .orderBy(desc(tickLog.firedAt))
      .limit(limit);
    res.json({ success: true, data: ticks });
  } catch (error) {
    next(error);
  }
});

export default router;
```

**Step 2: Mount in index.ts**

In `src/server/routes/index.ts`, add:
```typescript
import ticksRouter from './ticks';
// ... inside the router.use block:
router.use(ticksRouter);
```

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

**Step 4: Smoke test**

```bash
curl http://localhost:3001/api/ticks
```

Expected: `{"success":true,"data":[]}` (empty until a tick runs — that's correct).

**Step 5: Commit**

```bash
git add src/server/routes/ticks.ts src/server/routes/index.ts
git commit -m "feat(api): add GET /api/ticks endpoint for tick boundary lookup"
```

---

## Task 4: Add `tickId` filter + `alignment` to `GET /api/decisions`

**Files:**
- Modify: `src/server/routes/decisions.ts`

**Step 1: Update imports**

Add to the existing imports:
```typescript
import { tickLog } from '@db/schema/index';
import { and, between, gte, lte, isNotNull } from 'drizzle-orm';
```

Also add `alignment` to the agents import (it's already imported, just extend the select).

**Step 2: Extend the query schema**

Add `tickId` to `decisionsQuerySchema`:
```typescript
const decisionsQuerySchema = paginationSchema.extend({
  agentId: z.string().uuid().optional(),
  phase: z.string().optional(),
  success: z.enum(['true', 'false']).optional(),
  tickId: z.string().uuid().optional(),
});
```

**Step 3: Add `alignment` to the select and add `tickId` filter**

Update the `GET /api/decisions` handler:

```typescript
const { page, limit, agentId, phase, success, tickId } = decisionsQuerySchema.parse(req.query);
const offset = (page - 1) * limit;

// If tickId provided, look up tick boundaries first
let tickBounds: { firedAt: Date; completedAt: Date | null } | null = null;
if (tickId) {
  const [tick] = await db.select().from(tickLog).where(eq(tickLog.id, tickId)).limit(1);
  if (!tick) {
    res.status(404).json({ success: false, error: 'Tick not found' });
    return;
  }
  tickBounds = tick;
}

let query = db
  .select({
    id: agentDecisions.id,
    agentId: agentDecisions.agentId,
    agentName: agents.displayName,
    alignment: agents.alignment,       // ADD THIS
    provider: agentDecisions.provider,
    phase: agentDecisions.phase,
    parsedAction: agentDecisions.parsedAction,
    parsedReasoning: agentDecisions.parsedReasoning,
    success: agentDecisions.success,
    latencyMs: agentDecisions.latencyMs,
    createdAt: agentDecisions.createdAt,
  })
  .from(agentDecisions)
  .leftJoin(agents, eq(agentDecisions.agentId, agents.id))
  .$dynamic();

const conditions = [];
if (agentId) conditions.push(eq(agentDecisions.agentId, agentId));
if (phase) conditions.push(eq(agentDecisions.phase, phase));
if (success !== undefined) conditions.push(eq(agentDecisions.success, success === 'true'));
if (tickBounds) {
  conditions.push(gte(agentDecisions.createdAt, tickBounds.firedAt));
  if (tickBounds.completedAt) {
    conditions.push(lte(agentDecisions.createdAt, tickBounds.completedAt));
  }
}
if (conditions.length > 0) query = query.where(and(...conditions));

const results = await query.orderBy(desc(agentDecisions.createdAt)).limit(limit).offset(offset);
res.json({ success: true, data: results });
```

**Step 4: Type-check**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/server/routes/decisions.ts
git commit -m "feat(api): add tickId filter and alignment field to GET /api/decisions"
```

---

## Task 5: Add `decisionsApi` and `ticksApi` to client api.ts

**Files:**
- Modify: `src/client/lib/api.ts`

**Step 1: Add both API modules**

Find the end of the existing API exports in `src/client/lib/api.ts` and add:

```typescript
export const decisionsApi = {
  list: (params?: { limit?: number; agentId?: string; phase?: string; tickId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.phase) qs.set('phase', params.phase);
    if (params?.tickId) qs.set('tickId', params.tickId);
    return request(`/decisions?${qs.toString()}`);
  },
};

export const ticksApi = {
  recent: (limit = 5) => request(`/ticks?limit=${limit}`),
};
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat(client): add decisionsApi and ticksApi to api.ts"
```

---

## Task 6: Create `ObserverPage.tsx`

**Files:**
- Create: `src/client/pages/ObserverPage.tsx`

This is the largest task. Build it in three sub-steps.

**Step 1: Scaffold the page shell with top bar and two-column layout**

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '../lib/useWebSocket';
import { decisionsApi, ticksApi, legislationApi, activityApi } from '../lib/api';
import { BillPipeline } from '../components/BillPipeline';

// ── Types ──────────────────────────────────────────────────────────────────

interface DecisionRow {
  id: string;
  agentId: string | null;
  agentName: string | null;
  alignment: string | null;
  provider: string;
  phase: string | null;
  parsedAction: string | null;
  parsedReasoning: string | null;
  success: boolean;
  latencyMs: number;
  createdAt: string;
}

interface TickRow {
  id: string;
  firedAt: string;
  completedAt: string | null;
}

interface ActiveBill {
  id: string;
  title: string;
  status: string;
  yeaCount?: number;
  nayCount?: number;
}

interface LawRow {
  id: string;
  title: string;
  enactedAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const ACTION_BORDER: Record<string, string> = {
  yea: 'border-l-4 border-green-500',
  nay: 'border-l-4 border-red-500',
  propose: 'border-l-4 border-gold',
  campaign: 'border-l-4 border-blue-400',
};

function actionBorder(action: string | null): string {
  if (!action) return 'border-l-4 border-border/40';
  const a = action.toLowerCase();
  if (a.includes('yea') || a.includes('aye')) return ACTION_BORDER.yea;
  if (a.includes('nay')) return ACTION_BORDER.nay;
  if (a.includes('propose')) return ACTION_BORDER.propose;
  if (a.includes('campaign')) return ACTION_BORDER.campaign;
  return 'border-l-4 border-border/40';
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── Decision Card ──────────────────────────────────────────────────────────

function DecisionCard({ d }: { d: DecisionRow }) {
  const [expanded, setExpanded] = useState(false);
  const alignColor = ALIGNMENT_COLORS[d.alignment?.toLowerCase() ?? ''] ?? 'text-text-muted bg-border/10 border-border/30';

  return (
    <div
      className={`rounded bg-surface border border-border/40 p-3 cursor-pointer hover:border-border/80 transition-colors ${actionBorder(d.parsedAction)}`}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {d.agentId ? (
            <a
              href={`/agents/${d.agentId}`}
              className="text-gold hover:underline font-medium text-sm truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {d.agentName ?? 'Unknown'}
            </a>
          ) : (
            <span className="text-text-muted text-sm">Unknown</span>
          )}
          {d.alignment && (
            <span className={`badge border text-[10px] ${alignColor}`}>
              {d.alignment}
            </span>
          )}
          <span className="text-[10px] text-text-muted border border-border/30 rounded px-1 py-0.5 font-mono uppercase">
            {d.provider}
          </span>
        </div>
        <span
          className="text-[10px] text-text-muted font-mono flex-shrink-0"
          title={relativeTime(d.createdAt)}
        >
          {formatTimestamp(d.createdAt)}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {d.phase && (
          <span className="text-[10px] text-text-muted uppercase tracking-wide">{d.phase}</span>
        )}
        {d.phase && d.parsedAction && <span className="text-border/50 text-[10px]">·</span>}
        {d.parsedAction && (
          <span className="text-[11px] font-mono text-text-primary">{d.parsedAction}</span>
        )}
        <span className="text-[10px] text-text-muted ml-auto">{d.latencyMs}ms</span>
      </div>

      {d.parsedReasoning && (
        <p className="mt-1.5 text-[11px] text-text-secondary leading-relaxed">
          {expanded ? d.parsedReasoning : d.parsedReasoning.slice(0, 120) + (d.parsedReasoning.length > 120 ? '…' : '')}
        </p>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function ObserverPage() {
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [ticks, setTicks] = useState<TickRow[]>([]);
  const [selectedTickId, setSelectedTickId] = useState<string | 'live'>('live');
  const [billCounts, setBillCounts] = useState<Record<string, number>>({});
  const [activeVotes, setActiveVotes] = useState<ActiveBill[]>([]);
  const [recentLaws, setRecentLaws] = useState<LawRow[]>([]);
  const { subscribe } = useWebSocket();
  const liveRef = useRef(selectedTickId === 'live');
  liveRef.current = selectedTickId === 'live';

  // Seed decisions on mount
  useEffect(() => {
    void decisionsApi.list({ limit: 30 }).then((res) => {
      if (res.data) setDecisions(res.data as DecisionRow[]);
    }).catch(() => {});
  }, []);

  // Load tick options
  useEffect(() => {
    void ticksApi.recent(5).then((res) => {
      if (res.data) setTicks(res.data as TickRow[]);
    }).catch(() => {});
  }, []);

  // When tick selected, load that tick's decisions
  useEffect(() => {
    if (selectedTickId === 'live') return;
    void decisionsApi.list({ limit: 100, tickId: selectedTickId }).then((res) => {
      if (res.data) setDecisions(res.data as DecisionRow[]);
    }).catch(() => {});
  }, [selectedTickId]);

  // Live WebSocket prepend (only in live mode)
  useEffect(() => {
    const WS_EVENTS = ['agent:vote', 'bill:proposed', 'bill:advanced', 'bill:resolved', 'campaign:speech'];
    const unsubs = WS_EVENTS.map((evt) =>
      subscribe(evt, () => {
        if (!liveRef.current) return;
        void decisionsApi.list({ limit: 1 }).then((res) => {
          if (res.data?.[0]) {
            setDecisions((prev) => [res.data[0] as DecisionRow, ...prev.slice(0, 49)]);
          }
        }).catch(() => {});
      })
    );
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe]);

  // Poll right-column data
  useEffect(() => {
    const loadRight = () => {
      void legislationApi.list({ limit: 100 }).then((res) => {
        if (!res.data) return;
        const bills = res.data as Array<{ status: string; id: string; title: string; yeaCount?: number; nayCount?: number }>;
        const counts: Record<string, number> = {};
        bills.forEach((b) => { counts[b.status] = (counts[b.status] ?? 0) + 1; });
        setBillCounts(counts);
        setActiveVotes(bills.filter((b) => b.status === 'floor' || b.status === 'presidential_veto'));
      }).catch(() => {});
      void activityApi.recent({ limit: 8 }).then((res) => {
        if (res.data) setRecentLaws((res.data as Array<{ type: string; id: string; description: string; createdAt: string }>)
          .filter((e) => e.type === 'law')
          .slice(0, 8)
          .map((e) => ({ id: e.id, title: e.description, enactedAt: e.createdAt })));
      }).catch(() => {});
    };

    loadRight();
    const interval = setInterval(loadRight, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-capitol-deep text-text-primary overflow-hidden">
      {/* Top bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 h-9 border-b border-border bg-black/40">
        <div className="flex items-center gap-2">
          <span className="font-serif text-gold font-semibold text-sm tracking-wide">AGORA BENCH</span>
          <span className="text-border/60 text-xs">·</span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            LIVE
          </span>
        </div>
        <a href="/" className="text-[11px] text-text-muted hover:text-gold transition-colors tracking-wide">
          ← agorabench.com
        </a>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT — Decision log */}
        <div className="w-[55%] flex flex-col border-r border-border min-h-0">
          {/* Tick selector */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-black/20">
            <span className="text-[10px] text-text-muted uppercase tracking-widest">Viewing:</span>
            <select
              value={selectedTickId}
              onChange={(e) => setSelectedTickId(e.target.value)}
              className="text-[11px] bg-surface border border-border/50 rounded px-2 py-1 text-text-primary focus:outline-none focus:border-gold/50"
            >
              <option value="live">Live — all decisions</option>
              {ticks.map((t) => (
                <option key={t.id} value={t.id}>
                  Tick: {formatTimestamp(t.firedAt)}
                </option>
              ))}
            </select>
            {selectedTickId !== 'live' && (
              <button
                onClick={() => {
                  setSelectedTickId('live');
                  void decisionsApi.list({ limit: 30 }).then((res) => {
                    if (res.data) setDecisions(res.data as DecisionRow[]);
                  }).catch(() => {});
                }}
                className="text-[10px] text-gold hover:underline"
              >
                Resume live
              </button>
            )}
          </div>
          {/* Feed */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {decisions.length === 0 && (
              <p className="text-text-muted text-sm text-center mt-8">Waiting for decisions…</p>
            )}
            {decisions.map((d) => <DecisionCard key={d.id} d={d} />)}
          </div>
        </div>

        {/* RIGHT — Pipeline + Active votes + Recent laws */}
        <div className="w-[45%] flex flex-col gap-0 overflow-y-auto p-4 space-y-4">
          {/* Bill pipeline */}
          <div>
            <h2 className="text-[10px] text-text-muted uppercase tracking-widest mb-2">Bill Pipeline</h2>
            <BillPipeline counts={billCounts} activeFilter="all" onFilter={() => {}} />
          </div>

          {/* Active votes */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="font-serif text-sm font-semibold text-stone mb-3">Active Votes</h2>
            {activeVotes.length === 0 ? (
              <p className="text-text-muted text-xs">No active votes in progress</p>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-48">
                {activeVotes.map((b) => {
                  const total = (b.yeaCount ?? 0) + (b.nayCount ?? 0);
                  const yeaPct = total > 0 ? Math.round(((b.yeaCount ?? 0) / total) * 100) : 50;
                  return (
                    <div key={b.id} className="text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <a href={`/legislation/${b.id}`} className="text-gold hover:underline truncate max-w-[70%]">
                          {b.title}
                        </a>
                        <span className="text-text-muted font-mono flex-shrink-0">
                          {b.yeaCount ?? 0}Y / {b.nayCount ?? 0}N
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-border/30 overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${yeaPct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent laws */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="font-serif text-sm font-semibold text-stone mb-3">Recent Laws</h2>
            {recentLaws.length === 0 ? (
              <p className="text-text-muted text-xs">No laws enacted yet</p>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-56">
                {recentLaws.map((l) => (
                  <div key={l.id} className="flex items-start justify-between gap-2 text-xs">
                    <a href={`/laws/${l.id}`} className="text-gold hover:underline leading-snug">
                      {l.title}
                    </a>
                    <span className="text-text-muted font-mono flex-shrink-0 text-[10px]">
                      {new Date(l.enactedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Fix any TypeScript errors before committing.

**Step 3: Commit**

```bash
git add src/client/pages/ObserverPage.tsx
git commit -m "feat(observer): add ObserverPage — split-panel public live dashboard"
```

---

## Task 7: Register `/observe` route in App.tsx

**Files:**
- Modify: `src/client/App.tsx`

**Step 1: Import ObserverPage**

Add to imports at top of `App.tsx`:
```typescript
import { ObserverPage } from './pages/ObserverPage';
```

**Step 2: Add route outside the Layout wrapper**

Find the `<Routes>` block in `App.tsx`. The existing routes are all wrapped inside `<Route element={<Layout />}>`. Add the observer route **outside** that wrapper, as a sibling:

```tsx
<Routes>
  <Route path="/observe" element={<ObserverPage />} />   {/* standalone — no Layout */}
  <Route element={<Layout />}>
    <Route path="/" element={<DashboardPage />} />
    {/* ... all existing routes unchanged ... */}
  </Route>
</Routes>
```

**Step 3: Type-check**

```bash
npx tsc --noEmit
```

**Step 4: Verify in browser**

```bash
# Dev server should be running
open http://localhost:5173/observe
```

Expected: dark full-screen page with top bar, two columns, decision log on left, pipeline/votes/laws on right.

**Step 5: Commit**

```bash
git add src/client/App.tsx
git commit -m "feat(routing): register /observe as standalone route outside Layout"
```

---

## Task 8: Full PR cycle + production deploy

**Step 1: Final type-check**

```bash
npx tsc --noEmit
```

**Step 2: Push and PR to dev**

```bash
git fetch origin dev && git rebase origin/dev
git push -u origin feature/observer-view

cat > /tmp/pr_obs.json <<'EOF'
{"title":"feat(observer): public live dashboard at /observe","body":"## Summary\n- Standalone `/observe` route outside Layout — no nav, no auth required, publicly shareable\n- Left column: AI decision log seeded from `agent_decisions`, live via WebSocket, with tick selector (last 5 ticks)\n- Right column: bill pipeline counts, active floor votes with yea/nay bars, recent enacted laws\n- New `tick_log` DB table records exact tick boundaries, powering tick selector and future DEMOS scoring\n- Adds `alignment` field to `GET /api/decisions` response\n- New `GET /api/ticks` endpoint\n\n## Test plan\n- [ ] Visit `/observe` without logging in — page loads\n- [ ] Decision log seeds immediately on load\n- [ ] Tick selector shows recent ticks; selecting one freezes feed and loads that tick's decisions\n- [ ] Bill pipeline counts update every 30s\n- [ ] Active votes panel shows floor bills with yea/nay counts\n- [ ] Recent laws panel shows enacted laws\n- [ ] Top bar link returns to agorabench.com","head":"feature/observer-view","base":"dev"}
EOF

curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr_obs.json | python3 -m json.tool | grep '"number"'
```

**Step 3: Merge PR to dev, then PR dev → main, merge**

Follow standard workflow from CLAUDE.md.

**Step 4: Production deploy (frontend changed)**

```bash
pnpm run build
pm2 restart agora-bench
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health
# Expected: 200
```

**Step 5: Verify production**

```bash
curl -s -o /dev/null -w "%{http_code}" https://agorabench.com/observe
# Expected: 200
```
