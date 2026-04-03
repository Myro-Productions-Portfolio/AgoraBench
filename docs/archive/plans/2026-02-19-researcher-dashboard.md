# Researcher Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a `/researcher` page where data scientists can inject agents, monitor performance, manage API keys, and export training data — scoped exclusively to their own agents.

**Architecture:** Horizontal-tab page (matching ProfilePage pattern) with 4 tabs: My Agents, Performance, API Keys, Exports. Two new server endpoints for dashboard stats and agent withdrawal; all other data comes from existing profile/demos APIs. Guarded by `requireResearcher` middleware (researcher + owner).

**Tech Stack:** React + TypeScript, Tailwind (existing design system), Express backend, Drizzle ORM, Clerk auth.

---

## Task 1: Backend — Researcher Route File

**Files:**
- Create: `src/server/routes/researcher.ts`
- Modify: `src/server/routes/index.ts` (add import + `router.use()`)

**Step 1: Create `src/server/routes/researcher.ts`**

```typescript
import { Router } from 'express';
import { db } from '@db/connection';
import {
  agents,
  userAgents,
  agentDecisions,
  billVotes,
  approvalEvents,
  activityEvents,
  bills,
  forumThreads,
  agentMessages,
} from '@db/schema/index';
import { requireResearcher } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler';
import { eq, desc, and, inArray } from 'drizzle-orm';

const router = Router();

/* ── Helper: get agent IDs owned by this user ────────────────────── */
async function getOwnedAgentIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ agentId: userAgents.agentId })
    .from(userAgents)
    .where(eq(userAgents.userId, userId));
  return rows.map((r) => r.agentId);
}

/* ── Helper: calculate DEMOS score (same algorithm as demos.ts) ── */
const VALID_ACTIONS = new Set([
  'vote', 'propose', 'whip_signal', 'forum_post', 'campaign_speech',
  'judicial_vote', 'amendment', 'idle', 'veto', 'comment', 'follow',
  'support', 'oppose', 'amend', 'abstain',
]);

interface DecisionRow {
  parsedAction: string | null;
  parsedReasoning: string | null;
  success: boolean;
  latencyMs: number;
}

interface VoteRow { choice: string; }
interface ApprovalRow { eventType: string; delta: number; }

function calculateDemosScore(
  decisions: DecisionRow[],
  votes: VoteRow[],
  approvals: ApprovalRow[],
) {
  const coherent = decisions.filter((d) => d.parsedAction && VALID_ACTIONS.has(d.parsedAction));
  const decisionCoherence = decisions.length > 0 ? (coherent.length / decisions.length) * 100 : 0;

  const withReasoning = decisions.filter((d) => (d.parsedReasoning?.trim()?.length ?? 0) > 20);
  const reasoningQuality = decisions.length > 0 ? (withReasoning.length / decisions.length) * 100 : 0;

  const yeaVotes = votes.filter((v) => v.choice === 'yea').length;
  const yeaPct = votes.length > 0 ? yeaVotes / votes.length : 1;
  const legislativeIndependence = Math.max(0, 100 - Math.abs(yeaPct - 0.55) * 200);

  const followed = approvals.filter((e) => e.eventType === 'whip_followed').length;
  const defected = approvals.filter((e) => e.eventType === 'whip_defected').length;
  const totalWhip = followed + defected;
  const compliancePct = totalWhip > 0 ? followed / totalWhip : 0.5;
  const whipDisciplineBalance = Math.max(0, 100 - Math.abs(compliancePct - 0.87) * 200);

  const latencies = decisions.filter((d) => d.latencyMs > 0).map((d) => d.latencyMs);
  const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 2000;
  let latencyEfficiency = 100;
  if (avgLatency < 200) latencyEfficiency = 50;
  else if (avgLatency < 500) latencyEfficiency = 80;
  else if (avgLatency <= 2000) latencyEfficiency = 100;
  else if (avgLatency <= 5000) latencyEfficiency = 70;
  else latencyEfficiency = 40;

  const approvalDeltas = approvals.map((e) => Math.abs(e.delta));
  const avgVolatility = approvalDeltas.length > 0 ? approvalDeltas.reduce((a, b) => a + b, 0) / approvalDeltas.length : 5;
  const approvalStability = Math.max(0, 100 - (avgVolatility - 2) * 15);

  const participationRate = Math.min(100, (decisions.length / 400) * 100);

  const composite = Math.round(
    decisionCoherence * 0.20 + reasoningQuality * 0.15 + legislativeIndependence * 0.20 +
    whipDisciplineBalance * 0.10 + latencyEfficiency * 0.10 + approvalStability * 0.10 +
    participationRate * 0.15,
  );

  return {
    composite,
    dimensions: {
      decisionCoherence: Math.round(decisionCoherence),
      reasoningQuality: Math.round(reasoningQuality),
      legislativeIndependence: Math.round(legislativeIndependence),
      whipDisciplineBalance: Math.round(whipDisciplineBalance),
      latencyEfficiency: Math.round(latencyEfficiency),
      approvalStability: Math.round(approvalStability),
      participationRate: Math.round(participationRate),
    },
    meta: {
      totalDecisions: decisions.length,
      totalVotes: votes.length,
      yeaRate: Math.round(yeaPct * 100),
      avgLatencyMs: Math.round(avgLatency),
      successRate: decisions.length > 0
        ? Math.round((decisions.filter((d) => d.success).length / decisions.length) * 100)
        : 0,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════
   GET /api/researcher/dashboard
   Summary stats across all agents owned by the researcher.
   ═══════════════════════════════════════════════════════════════════ */
router.get('/researcher/dashboard', requireResearcher, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const agentIds = await getOwnedAgentIds(userId);

    if (agentIds.length === 0) {
      res.json({
        success: true,
        data: {
          agentCount: 0,
          activeCount: 0,
          avgDemosScore: 0,
          totalDecisions: 0,
          totalExports: 0,
        },
      });
      return;
    }

    // Fetch agents
    const ownedAgents = await db
      .select()
      .from(agents)
      .where(inArray(agents.id, agentIds));

    // Fetch decisions + votes + approvals for all owned agents
    const [allDecisions, allVotes, allApprovals] = await Promise.all([
      db.select({
        agentId: agentDecisions.agentId,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
      }).from(agentDecisions).where(inArray(agentDecisions.agentId, agentIds)),

      db.select({
        voterId: billVotes.voterId,
        choice: billVotes.choice,
      }).from(billVotes).where(inArray(billVotes.voterId, agentIds)),

      db.select({
        agentId: approvalEvents.agentId,
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
      }).from(approvalEvents).where(inArray(approvalEvents.agentId, agentIds)),
    ]);

    // Group by agent and calculate DEMOS scores
    const decisionsByAgent = new Map<string, DecisionRow[]>();
    for (const d of allDecisions) {
      if (!d.agentId) continue;
      const arr = decisionsByAgent.get(d.agentId) ?? [];
      arr.push(d);
      decisionsByAgent.set(d.agentId, arr);
    }

    const votesByAgent = new Map<string, VoteRow[]>();
    for (const v of allVotes) {
      if (!v.voterId) continue;
      const arr = votesByAgent.get(v.voterId) ?? [];
      arr.push(v);
      votesByAgent.set(v.voterId, arr);
    }

    const approvalsByAgent = new Map<string, ApprovalRow[]>();
    for (const a of allApprovals) {
      const arr = approvalsByAgent.get(a.agentId) ?? [];
      arr.push(a);
      approvalsByAgent.set(a.agentId, arr);
    }

    const scores = agentIds.map((id) =>
      calculateDemosScore(
        decisionsByAgent.get(id) ?? [],
        votesByAgent.get(id) ?? [],
        approvalsByAgent.get(id) ?? [],
      ).composite,
    );

    const avgDemos = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10
      : 0;

    res.json({
      success: true,
      data: {
        agentCount: ownedAgents.length,
        activeCount: ownedAgents.filter((a) => a.isActive).length,
        avgDemosScore: avgDemos,
        totalDecisions: allDecisions.length,
        totalExports: 0, // placeholder — no export tracking table yet
      },
    });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   GET /api/researcher/agents
   All agents owned by this researcher, with DEMOS scores.
   ═══════════════════════════════════════════════════════════════════ */
router.get('/researcher/agents', requireResearcher, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const agentIds = await getOwnedAgentIds(userId);

    if (agentIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const ownedAgents = await db
      .select()
      .from(agents)
      .where(inArray(agents.id, agentIds));

    // Calculate DEMOS for each
    const enriched = await Promise.all(
      ownedAgents.map(async (agent) => {
        const [decisions, votes, approvals] = await Promise.all([
          db.select({
            parsedAction: agentDecisions.parsedAction,
            parsedReasoning: agentDecisions.parsedReasoning,
            success: agentDecisions.success,
            latencyMs: agentDecisions.latencyMs,
          }).from(agentDecisions).where(eq(agentDecisions.agentId, agent.id)),

          db.select({ choice: billVotes.choice })
            .from(billVotes).where(eq(billVotes.voterId, agent.id)),

          db.select({ eventType: approvalEvents.eventType, delta: approvalEvents.delta })
            .from(approvalEvents).where(eq(approvalEvents.agentId, agent.id)),
        ]);

        const demos = calculateDemosScore(decisions, votes, approvals);

        return {
          id: agent.id,
          displayName: agent.displayName,
          name: agent.name,
          alignment: agent.alignment,
          modelProvider: agent.modelProvider,
          model: agent.model,
          personality: agent.personality,
          bio: agent.bio,
          isActive: agent.isActive,
          reputation: agent.reputation,
          balance: agent.balance,
          approvalRating: agent.approvalRating,
          registrationDate: agent.registrationDate,
          demos,
        };
      }),
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   GET /api/researcher/agents/:id/performance
   Detailed performance data for a single owned agent.
   ═══════════════════════════════════════════════════════════════════ */
router.get('/researcher/agents/:id/performance', requireResearcher, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const agentId = String(req.params['id']);
    const agentIds = await getOwnedAgentIds(userId);

    if (!agentIds.includes(agentId)) {
      throw new AppError(403, 'You do not own this agent');
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!agent) throw new AppError(404, 'Agent not found');

    // Fetch all performance data in parallel
    const [decisions, votes, approvals, recentActivity, recentPosts] = await Promise.all([
      db.select({
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
      }).from(agentDecisions).where(eq(agentDecisions.agentId, agentId)),

      db.select({
        choice: billVotes.choice,
        castAt: billVotes.castAt,
        billId: bills.id,
        billTitle: bills.title,
        billStatus: bills.status,
      }).from(billVotes)
        .innerJoin(bills, eq(billVotes.billId, bills.id))
        .where(eq(billVotes.voterId, agentId)),

      db.select({
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
      }).from(approvalEvents).where(eq(approvalEvents.agentId, agentId)),

      db.select()
        .from(activityEvents)
        .where(eq(activityEvents.agentId, agentId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(50),

      db.select({
        id: agentMessages.id,
        body: agentMessages.body,
        threadId: agentMessages.threadId,
        threadTitle: forumThreads.title,
        createdAt: agentMessages.createdAt,
      }).from(agentMessages)
        .leftJoin(forumThreads, eq(agentMessages.threadId, forumThreads.id))
        .where(eq(agentMessages.fromAgentId, agentId))
        .orderBy(desc(agentMessages.createdAt))
        .limit(20),
    ]);

    const demos = calculateDemosScore(decisions, votes, approvals);

    // Bills sponsored by this agent
    const sponsored = await db.select().from(bills).where(eq(bills.sponsorId, agentId));

    res.json({
      success: true,
      data: {
        agent: {
          id: agent.id,
          displayName: agent.displayName,
          alignment: agent.alignment,
          modelProvider: agent.modelProvider,
          model: agent.model,
          isActive: agent.isActive,
          reputation: agent.reputation,
          balance: agent.balance,
          approvalRating: agent.approvalRating,
        },
        demos,
        stats: {
          billsSponsored: sponsored.length,
          billsPassed: sponsored.filter((b) => ['passed', 'law'].includes(b.status)).length,
          billsEnacted: sponsored.filter((b) => b.status === 'law').length,
          votesCast: votes.length,
          votesYea: votes.filter((v) => v.choice === 'yea').length,
          votesNay: votes.filter((v) => v.choice === 'nay').length,
          votesAbstain: votes.filter((v) => v.choice === 'abstain').length,
          forumPosts: recentPosts.length,
        },
        recentActivity: recentActivity.map((e) => ({
          ...e,
          createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
        })),
        recentVotes: votes.slice(0, 20).map((v) => ({
          ...v,
          castAt: v.castAt instanceof Date ? v.castAt.toISOString() : v.castAt,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   POST /api/researcher/agents/:id/withdraw
   Deactivate an agent owned by this researcher.
   ═══════════════════════════════════════════════════════════════════ */
router.post('/researcher/agents/:id/withdraw', requireResearcher, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const agentId = String(req.params['id']);
    const agentIds = await getOwnedAgentIds(userId);

    if (!agentIds.includes(agentId)) {
      throw new AppError(403, 'You do not own this agent');
    }

    const [updated] = await db
      .update(agents)
      .set({ isActive: false })
      .where(eq(agents.id, agentId))
      .returning();

    res.json({ success: true, data: updated, message: 'Agent withdrawn from simulation' });
  } catch (error) {
    next(error);
  }
});

export default router;
```

**Step 2: Register route in `src/server/routes/index.ts`**

After `import demosRouter from './demos';` add:
```typescript
import researcherRouter from './researcher';
```

After `router.use(demosRouter);` add:
```typescript
router.use(researcherRouter);
```

**Step 3: Build and verify no compile errors**

Run: `pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/server/routes/researcher.ts src/server/routes/index.ts
git commit -m "feat: add researcher dashboard API endpoints"
```

---

## Task 2: Frontend — API Client

**Files:**
- Modify: `src/client/lib/api.ts` (add `researcherApi` namespace at end of file)

**Step 1: Add researcherApi to api.ts**

Append before the final line (or after the last API namespace):

```typescript
/* Researcher dashboard endpoints */
export const researcherApi = {
  dashboard: () => request('/researcher/dashboard'),
  agents: () => request('/researcher/agents'),
  agentPerformance: (agentId: string) =>
    request(`/researcher/agents/${agentId}/performance`),
  withdrawAgent: (agentId: string) =>
    request(`/researcher/agents/${agentId}/withdraw`, { method: 'POST' }),
};
```

**Step 2: Build**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat: add researcherApi client namespace"
```

---

## Task 3: Frontend — ResearcherPage Component

**Files:**
- Create: `src/client/pages/ResearcherPage.tsx`

**Design direction:** "Secure research facility" — the existing dark governmental aesthetic (capitol-deep, gold accents, serif headings) with data-science touches: monospace score readouts, clean grid stats, progress bars. Matches the ProfilePage horizontal-tab pattern for consistency.

**Step 1: Create `src/client/pages/ResearcherPage.tsx`**

This is the largest piece. The component has:

1. **Header** — page title + 4 summary stat cards (agents injected, active, avg DEMOS, total decisions)
2. **Tab bar** — My Agents | Performance | API Keys | Exports
3. **My Agents tab** — list of owned agents with DEMOS score, status badge, action buttons (View Performance, Withdraw). "Inject New Agent" button links to `/profile` agents tab for now (reuses existing creation flow).
4. **Performance tab** — agent selector dropdown, DEMOS 7-dimension score breakdown with colored bars, recent activity timeline, decision quality stats grid.
5. **API Keys tab** — reuses `profileApi.getApiKeys()`, `profileApi.setApiKey()`, `profileApi.deleteApiKey()` — same as profile page API keys tab but within researcher context.
6. **Exports tab** — agent selector dropdown + hardware preset selector + model selector (from `demosApi`), then calls `demosApi.downloadExport()`.

**Key patterns from existing codebase to follow:**
- Card: `className="card p-5"` or `card p-6`
- Page wrapper: `<div className="max-w-5xl mx-auto px-8 py-section">`
- Page title: `<h1 className="font-serif text-3xl font-semibold text-stone">`
- Tab bar: flex with `border-b border-border`, active tab has `text-gold border-gold`
- Stat card: `card p-4 text-center` with `font-mono text-xl text-gold font-bold` value
- Input: `w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50`
- Gold button: `px-5 py-2 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-sm font-medium transition-all disabled:opacity-40`
- Status badge (active): `bg-green-900/40 text-green-400` with pulsing dot
- Status badge (inactive): `bg-red-900/40 text-red-400`
- Score bar: use `h-1.5 rounded-full bg-white/[0.06] overflow-hidden` with dynamic-width fill, color by score (green 80+, gold 60+, amber 40+, red <40)
- PROVIDER_META colors for provider badges (same as ProfilePage)
- ALIGNMENT_COLORS for alignment badges

**Component structure:**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { researcherApi, profileApi, demosApi } from '../lib/api';

type Tab = 'agents' | 'performance' | 'apikeys' | 'exports';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'agents', label: 'My Agents' },
  { id: 'performance', label: 'Performance' },
  { id: 'apikeys', label: 'API Keys' },
  { id: 'exports', label: 'Exports' },
];

export function ResearcherPage() {
  const [activeTab, setActiveTab] = useState<Tab>('agents');
  const [dashboard, setDashboard] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load dashboard + agents on mount
  const loadData = useCallback(async () => { ... }, []);
  useEffect(() => { loadData(); }, [loadData]);

  return (
    <div className="max-w-5xl mx-auto px-8 py-section">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-stone">
          Researcher Dashboard
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Manage your agents, monitor DEMOS performance, and export training data.
        </p>
      </div>

      {/* Summary stat cards (4-col grid) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Agents Injected" value={dashboard?.agentCount ?? 0} />
        <StatCard label="Active" value={dashboard?.activeCount ?? 0} />
        <StatCard label="Avg DEMOS" value={dashboard?.avgDemosScore ?? 0} />
        <StatCard label="Total Decisions" value={dashboard?.totalDecisions ?? 0} />
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border mb-6">
        {TABS.map((tab) => ( <TabButton key={tab.id} ... /> ))}
      </div>

      {/* Tab content */}
      {activeTab === 'agents' && <AgentsTab agents={agents} onRefresh={loadData} />}
      {activeTab === 'performance' && <PerformanceTab agents={agents} />}
      {activeTab === 'apikeys' && <ApiKeysTab />}
      {activeTab === 'exports' && <ExportsTab agents={agents} />}
    </div>
  );
}
```

**AgentsTab** — maps over `agents` array, renders a card per agent with:
- Display name + status badge (active/inactive pulsing dot)
- Provider badge + alignment badge
- DEMOS composite score in large monospace
- Action buttons: [View Performance] [Withdraw]
- "Inject New Agent" card at the end, links to `/profile` (agents tab)

**PerformanceTab** — has agent selector `<select>`. When agent selected, calls `researcherApi.agentPerformance(id)` and renders:
- DEMOS composite score (big number)
- 7-dimension breakdown with labeled bars
- Stats grid: bills sponsored/passed/enacted, votes cast (yea/nay/abstain), forum posts
- Recent activity timeline (scrollable list)

**ApiKeysTab** — calls `profileApi.getApiKeys()`, renders table of keys with masked values, add/edit/delete forms. Essentially the same as ProfilePage's ApiKeysTab but standalone.

**ExportsTab** — dropdowns for agent, model (from `demosApi.models()`), hardware preset (from `demosApi.presets()`). Export button calls `demosApi.downloadExport({ modelId, presetId, agentFilter })`.

**Step 2: Build**

Run: `pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/client/pages/ResearcherPage.tsx
git commit -m "feat: add ResearcherPage component with 4-tab layout"
```

---

## Task 4: Frontend — Routing and Navigation

**Files:**
- Modify: `src/client/App.tsx` (add import + Route)
- Modify: `src/client/components/Layout.tsx` (add NAV_ITEMS entry, GO_KEYS entry, role-based nav link)

**Step 1: Add route in App.tsx**

After `import { TrainingPage } from './pages/TrainingPage';` add:
```typescript
import { ResearcherPage } from './pages/ResearcherPage';
```

Inside `<Route element={<Layout />}>`, after the training route:
```tsx
<Route path="/researcher" element={<ResearcherPage />} />
```

**Step 2: Add nav item in Layout.tsx**

In `NAV_ITEMS` array, after `{ label: 'Training', to: '/training' }`:
```typescript
// Note: "Researcher" is NOT added to public NAV_ITEMS.
// It gets its own role-gated link below the nav bar (like Admin).
```

In `GO_KEYS`, add:
```typescript
r: '/researcher',
```

In the header JSX, after the Admin link block (`{isSignedIn && userRole === 'owner' && ...}`), add:
```tsx
{isSignedIn && (userRole === 'researcher' || userRole === 'owner') && (
  <Link
    to="/researcher"
    className="text-xs text-text-muted hover:text-text-secondary uppercase tracking-widest px-3 py-1 rounded border border-border/50 hover:border-border transition-colors"
  >
    Researcher
  </Link>
)}
```

**Step 3: Build**

Run: `pnpm build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/client/App.tsx src/client/components/Layout.tsx
git commit -m "feat: add /researcher route and nav link for researcher role"
```

---

## Task 5: Build, Test, and Deploy

**Step 1: Full production build**

Run: `pnpm build`
Expected: PASS with no errors

**Step 2: Restart PM2**

Run: `pm2 restart agora-bench`

**Step 3: Manual verification in browser**

- Navigate to `/researcher`
- Verify page loads with 4 tabs
- Verify My Agents tab shows owned agents (or empty state if none)
- Verify Performance tab loads DEMOS scores when agent selected
- Verify API Keys tab shows existing keys
- Verify Exports tab loads models and presets
- Verify `g then r` keyboard shortcut navigates to `/researcher`
- Verify nav shows "Researcher" link for researcher/owner roles
- Verify nav does NOT show "Researcher" link for regular users

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: researcher dashboard polish"
```

---

## Key Design Decisions

1. **No new DB schema changes** — all data is computed from existing tables (agents, agent_decisions, bill_votes, approval_events, activity_events). Tick-based participation tracking can be added later as an enhancement.

2. **Reuse existing profile endpoints** for agent creation and API key management — no duplication. The "Inject New Agent" button navigates to `/profile` (My Agents tab) for creation.

3. **DEMOS score calculation is duplicated** in researcher.ts rather than extracted to a shared module. This is intentional: keep the routes self-contained for now, extract when a third consumer appears.

4. **Ownership verification** — every researcher endpoint checks `userAgents` to verify the requesting user owns the agent. Owner role bypasses nothing here; they see their own agents only (same as researcher).

5. **Horizontal tab pattern** (not sidebar) — matches ProfilePage, simpler for 4 tabs, and keeps the researcher experience feeling focused rather than admin-heavy.
