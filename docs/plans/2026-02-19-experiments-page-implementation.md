# Experiments Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a functional Experiments tab in the admin panel with 7 CSV export cards covering all major simulation datasets.

**Architecture:** 8 new `GET /admin/export/*` routes added to `src/server/routes/admin.ts` (one counts endpoint + one per dataset). Frontend replaces the disabled stub in `AdminPage.tsx` with a card grid. Downloads use `fetch` + `Blob` + temp `<a>` element for browser-native file saving.

**Tech Stack:** Express, Drizzle ORM, PostgreSQL, React 18, TypeScript

---

## Context (read before starting)

**Project root:** `/Volumes/DevDrive-M4Pro/Projects/Molt-Goverment/`

**Key files:**
- `src/server/routes/admin.ts` — add export routes here (follow existing pattern: `router.get('/admin/...', async (_req, res, next) => { try { ... } catch (error) { next(error); } })`)
- `src/client/lib/api.ts` — add `exportCounts` and `downloadExport` to `adminApi` object (line ~172)
- `src/client/pages/AdminPage.tsx` — replace experiments stub, add state/effect for counts

**DB schema imports** (already available in admin.ts):
```typescript
// Already imported: agentDecisions, agents
// Need to add these imports:
import { approvalEvents, bills, laws, billVotes, elections, campaigns } from '@db/schema/index';
import { desc } from 'drizzle-orm';
```

**Schema column reference:**
- `agentDecisions`: id, agentId, provider, phase, parsedAction, parsedReasoning, success, latencyMs, createdAt
- `approvalEvents`: id, agentId, eventType, delta, reason, createdAt
- `bills`: id, title, summary, sponsorId, committee, status, billType, amendsLawId, introducedAt, lastActionAt
- `billVotes`: id, billId, voterId, choice, castAt
- `laws`: id, billId, title, enactedDate, isActive
- `elections`: id, positionType, status, scheduledDate, votingStartDate, votingEndDate, certifiedDate, winnerId, totalVotes, createdAt
- `campaigns`: id, agentId, electionId, platform, startDate, endDate, contributions, status
- `agents`: id, displayName, alignment, modelProvider, model, reputation, balance, approvalRating, isActive, registrationDate

**CSV helper pattern** (use exactly this for every CSV endpoint):
```typescript
function toCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const escape = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}
```

**Download pattern** for client (use this exact pattern for `downloadExport`):
```typescript
downloadExport: async (dataset: string, filename: string) => {
  const res = await fetch(`/api/admin/export/${dataset}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
},
```

**Git workflow reminder:**
```bash
# Start of session (if not already done):
git checkout dev && git pull origin dev
git checkout -b feature/experiments-page

# After all tasks complete:
npx tsc --noEmit                        # must be clean
git add src/server/routes/admin.ts src/client/lib/api.ts src/client/pages/AdminPage.tsx
git commit -m "feat(experiments): CSV export panel in admin tab"
git fetch origin dev && git rebase origin/dev
git push -u origin feature/experiments-page
# PR to dev (curl), merge, PR dev→main, merge, npm run build, pm2 restart --update-env
```

---

## Task 1: Add `toCSV` helper and counts endpoint to admin.ts

**Files:**
- Modify: `src/server/routes/admin.ts`

**Step 1:** Open `src/server/routes/admin.ts`. Add the following import additions to the existing import on line 3:

```typescript
// Change line 3 from:
import { agentDecisions, agents, governmentSettings, users, researcherRequests } from '@db/schema/index';
// To:
import { agentDecisions, agents, governmentSettings, users, researcherRequests, approvalEvents, bills, laws, billVotes, elections, campaigns } from '@db/schema/index';
```

Also add `desc` to the drizzle-orm import on line 4:
```typescript
// Change line 4 from:
import { count, eq, sql, asc } from 'drizzle-orm';
// To:
import { count, eq, sql, asc, desc } from 'drizzle-orm';
```

**Step 2:** Add the `toCSV` helper function directly after the `const router = Router();` line (after line 18):

```typescript
/* ---- CSV helper ---- */
function toCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const escape = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}
```

**Step 3:** At the very end of `admin.ts` (just before `export default router;`), add the counts endpoint:

```typescript
/* GET /api/admin/export/counts — row counts for all exportable datasets */
router.get('/admin/export/counts', async (_req, res, next) => {
  try {
    const [
      [decisions],
      [approvals],
      [billsCount],
      [billVotesCount],
      [lawsCount],
      [electionsCount],
      [agentsCount],
    ] = await Promise.all([
      db.select({ n: count() }).from(agentDecisions),
      db.select({ n: count() }).from(approvalEvents),
      db.select({ n: count() }).from(bills),
      db.select({ n: count() }).from(billVotes),
      db.select({ n: count() }).from(laws),
      db.select({ n: count() }).from(elections),
      db.select({ n: count() }).from(agents),
    ]);
    res.json({
      success: true,
      data: {
        agentDecisions: decisions.n,
        approvalEvents: approvals.n,
        bills: billsCount.n,
        billVotes: billVotesCount.n,
        laws: lawsCount.n,
        elections: electionsCount.n,
        agents: agentsCount.n,
      },
    });
  } catch (error) {
    next(error);
  }
});
```

**Step 4:** Run type-check:
```bash
npx tsc --noEmit
```
Expected: no errors.

---

## Task 2: Add 7 CSV export endpoints to admin.ts

**Files:**
- Modify: `src/server/routes/admin.ts`

Add these 7 routes after the counts endpoint from Task 1. Each follows the same pattern: query DB, call `toCSV`, set headers, send.

**Step 1:** Add agent decisions export:

```typescript
/* GET /api/admin/export/agent-decisions */
router.get('/admin/export/agent-decisions', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agentDecisions.id,
        createdAt: agentDecisions.createdAt,
        agentName: agents.displayName,
        provider: agentDecisions.provider,
        phase: agentDecisions.phase,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
      })
      .from(agentDecisions)
      .leftJoin(agents, eq(agentDecisions.agentId, agents.id))
      .orderBy(desc(agentDecisions.createdAt));

    const csv = toCSV(
      ['id', 'createdAt', 'agentName', 'provider', 'phase', 'parsedAction', 'parsedReasoning', 'success', 'latencyMs'],
      rows.map((r) => [r.id, r.createdAt?.toISOString(), r.agentName, r.provider, r.phase, r.parsedAction, r.parsedReasoning, r.success, r.latencyMs]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="agent-decisions.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});
```

**Step 2:** Add approval events export:

```typescript
/* GET /api/admin/export/approval-events */
router.get('/admin/export/approval-events', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: approvalEvents.id,
        createdAt: approvalEvents.createdAt,
        agentName: agents.displayName,
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
        reason: approvalEvents.reason,
      })
      .from(approvalEvents)
      .leftJoin(agents, eq(approvalEvents.agentId, agents.id))
      .orderBy(desc(approvalEvents.createdAt));

    const csv = toCSV(
      ['id', 'createdAt', 'agentName', 'eventType', 'delta', 'reason'],
      rows.map((r) => [r.id, r.createdAt?.toISOString(), r.agentName, r.eventType, r.delta, r.reason]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="approval-events.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});
```

**Step 3:** Add bills export:

```typescript
/* GET /api/admin/export/bills */
router.get('/admin/export/bills', async (_req, res, next) => {
  try {
    const sponsorAlias = { displayName: agents.displayName };
    const rows = await db
      .select({
        id: bills.id,
        introducedAt: bills.introducedAt,
        title: bills.title,
        sponsorName: agents.displayName,
        committee: bills.committee,
        status: bills.status,
        billType: bills.billType,
        lastActionAt: bills.lastActionAt,
      })
      .from(bills)
      .leftJoin(agents, eq(bills.sponsorId, agents.id))
      .orderBy(desc(bills.introducedAt));

    const csv = toCSV(
      ['id', 'introducedAt', 'title', 'sponsorName', 'committee', 'status', 'billType', 'lastActionAt'],
      rows.map((r) => [r.id, r.introducedAt?.toISOString(), r.title, r.sponsorName, r.committee, r.status, r.billType, r.lastActionAt?.toISOString()]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bills.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});
```

**Step 4:** Add bill votes export (requires two joins — voter agent and bill):

```typescript
/* GET /api/admin/export/bill-votes */
router.get('/admin/export/bill-votes', async (_req, res, next) => {
  try {
    const voterAgents = alias(agents, 'voter');
    const rows = await db
      .select({
        id: billVotes.id,
        castAt: billVotes.castAt,
        voterName: voterAgents.displayName,
        billTitle: bills.title,
        choice: billVotes.choice,
      })
      .from(billVotes)
      .leftJoin(voterAgents, eq(billVotes.voterId, voterAgents.id))
      .leftJoin(bills, eq(billVotes.billId, bills.id))
      .orderBy(desc(billVotes.castAt));

    const csv = toCSV(
      ['id', 'castAt', 'voterName', 'billTitle', 'choice'],
      rows.map((r) => [r.id, r.castAt?.toISOString(), r.voterName, r.billTitle, r.choice]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bill-votes.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});
```

**Important:** The bill-votes endpoint uses Drizzle's `alias` function. Add this import:
```typescript
// Add 'alias' to the drizzle-orm/pg-core import (or add a new import line):
import { alias } from 'drizzle-orm/pg-core';
```

**Step 5:** Add laws export:

```typescript
/* GET /api/admin/export/laws */
router.get('/admin/export/laws', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: laws.id,
        enactedDate: laws.enactedDate,
        title: laws.title,
        isActive: laws.isActive,
        billId: laws.billId,
      })
      .from(laws)
      .orderBy(desc(laws.enactedDate));

    const csv = toCSV(
      ['id', 'enactedDate', 'title', 'isActive', 'billId'],
      rows.map((r) => [r.id, r.enactedDate?.toISOString(), r.title, r.isActive, r.billId]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="laws.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});
```

**Step 6:** Add elections export (join campaigns to elections, join agents for candidate name and winner name):

```typescript
/* GET /api/admin/export/elections */
router.get('/admin/export/elections', async (_req, res, next) => {
  try {
    const winnerAgents = alias(agents, 'winner');
    const candidateAgents = alias(agents, 'candidate');

    const rows = await db
      .select({
        electionId: elections.id,
        positionType: elections.positionType,
        status: elections.status,
        scheduledDate: elections.scheduledDate,
        votingStartDate: elections.votingStartDate,
        votingEndDate: elections.votingEndDate,
        certifiedDate: elections.certifiedDate,
        winnerName: winnerAgents.displayName,
        totalVotes: elections.totalVotes,
        campaignId: campaigns.id,
        candidateName: candidateAgents.displayName,
        campaignStatus: campaigns.status,
        contributions: campaigns.contributions,
      })
      .from(elections)
      .leftJoin(winnerAgents, eq(elections.winnerId, winnerAgents.id))
      .leftJoin(campaigns, eq(campaigns.electionId, elections.id))
      .leftJoin(candidateAgents, eq(campaigns.agentId, candidateAgents.id))
      .orderBy(desc(elections.createdAt));

    const csv = toCSV(
      ['electionId', 'positionType', 'status', 'scheduledDate', 'votingStartDate', 'votingEndDate', 'certifiedDate', 'winnerName', 'totalVotes', 'campaignId', 'candidateName', 'campaignStatus', 'contributions'],
      rows.map((r) => [r.electionId, r.positionType, r.status, r.scheduledDate?.toISOString(), r.votingStartDate?.toISOString(), r.votingEndDate?.toISOString(), r.certifiedDate?.toISOString(), r.winnerName, r.totalVotes, r.campaignId, r.candidateName, r.campaignStatus, r.contributions]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="elections.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});
```

**Step 7:** Add agent snapshot export:

```typescript
/* GET /api/admin/export/agents */
router.get('/admin/export/agents', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        name: agents.name,
        alignment: agents.alignment,
        modelProvider: agents.modelProvider,
        model: agents.model,
        reputation: agents.reputation,
        balance: agents.balance,
        approvalRating: agents.approvalRating,
        isActive: agents.isActive,
        registrationDate: agents.registrationDate,
      })
      .from(agents)
      .orderBy(asc(agents.displayName));

    const csv = toCSV(
      ['id', 'displayName', 'name', 'alignment', 'modelProvider', 'model', 'reputation', 'balance', 'approvalRating', 'isActive', 'registrationDate'],
      rows.map((r) => [r.id, r.displayName, r.name, r.alignment, r.modelProvider, r.model, r.reputation, r.balance, r.approvalRating, r.isActive, r.registrationDate?.toISOString()]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="agents-snapshot.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});
```

**Step 8:** Run type-check:
```bash
npx tsc --noEmit
```
Expected: no errors.

---

## Task 3: Add client API methods

**Files:**
- Modify: `src/client/lib/api.ts` (around line 196, inside the `adminApi` object)

**Step 1:** Add these two methods to the `adminApi` object in `src/client/lib/api.ts`, after the `rejectResearcherRequest` entry:

```typescript
  exportCounts: () => request('/admin/export/counts'),
  downloadExport: async (dataset: string, filename: string): Promise<void> => {
    const res = await fetch(`/api/admin/export/${dataset}`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
```

**Step 2:** Run type-check:
```bash
npx tsc --noEmit
```
Expected: no errors.

---

## Task 4: Build the Experiments panel in AdminPage.tsx

**Files:**
- Modify: `src/client/pages/AdminPage.tsx`

This task has multiple steps. Work through them in order.

**Step 1:** Add export counts state near the top of the `AdminPage` component (around line 337, with the other state declarations):

```typescript
const [exportCounts, setExportCounts] = useState<Record<string, number> | null>(null);
const [exportingDataset, setExportingDataset] = useState<string | null>(null);
```

**Step 2:** Add a `fetchExportCounts` callback alongside the other fetch callbacks (after `fetchUsers`, around line 452):

```typescript
const fetchExportCounts = useCallback(async () => {
  try {
    const res = await adminApi.exportCounts();
    setExportCounts(res.data as Record<string, number>);
  } catch { /* ignore */ }
}, []);
```

**Step 3:** Add `fetchExportCounts` to the `useEffect` initial load block (line ~454):

```typescript
// Add this line inside the useEffect, with the other void fetchX() calls:
void fetchExportCounts();
```

Also add `fetchExportCounts` to the dependency array of that `useEffect`.

**Step 4:** Add a `handleExport` function inside `AdminPage` (add it with the other handler functions, e.g., after `toggleSidebar`):

```typescript
const handleExport = async (dataset: string, filename: string) => {
  setExportingDataset(dataset);
  try {
    await adminApi.downloadExport(dataset, filename);
  } catch {
    /* silent — browser handles download errors */
  } finally {
    setExportingDataset(null);
  }
};
```

**Step 5:** Replace the experiments stub (currently around line 1820) with the full panel. Find this block:

```tsx
{activeTab === 'experiments' && (
  <div className="rounded-lg border border-border bg-surface p-8 text-center space-y-2">
    <p className="font-serif text-stone text-lg">Experiments</p>
    <p className="text-text-muted text-sm">Coming in Phase 4.5</p>
  </div>
)}
```

Replace it with:

```tsx
{activeTab === 'experiments' && (
  <div className="space-y-6">
    <div>
      <h2 className="font-serif text-stone text-xl font-semibold">Experiments</h2>
      <p className="text-text-muted text-sm mt-1">Export raw simulation data as CSV for analysis.</p>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {([
        { dataset: 'agent-decisions', filename: 'agent-decisions.csv', label: 'Agent Decisions', description: 'Every AI decision: action, reasoning, provider, latency.' },
        { dataset: 'approval-events', filename: 'approval-events.csv', label: 'Approval Events', description: 'Full audit trail of every approval rating change by event type.' },
        { dataset: 'bills', filename: 'bills.csv', label: 'Bills', description: 'All legislation: sponsor, committee, status, and timestamps.' },
        { dataset: 'bill-votes', filename: 'bill-votes.csv', label: 'Bill Votes', description: 'How each agent voted on every bill.' },
        { dataset: 'laws', filename: 'laws.csv', label: 'Laws', description: 'All enacted laws with enactment date and active status.' },
        { dataset: 'elections', filename: 'elections.csv', label: 'Elections & Campaigns', description: 'Election results joined with candidate campaign data.' },
        { dataset: 'agents', filename: 'agents-snapshot.csv', label: 'Agent Snapshot', description: 'Current state of all agents: alignment, provider, balance, approval.' },
      ] as const).map(({ dataset, filename, label, description }) => (
        <div key={dataset} className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-text-primary">{label}</p>
              <p className="text-text-muted text-xs mt-0.5">{description}</p>
            </div>
            {exportCounts && (
              <span className="badge border border-border/40 text-text-muted bg-border/10 whitespace-nowrap shrink-0">
                {(exportCounts[dataset.replace('-', '')] ?? exportCounts[dataset] ?? '—').toLocaleString()} rows
              </span>
            )}
          </div>
          <button
            onClick={() => void handleExport(dataset, filename)}
            disabled={exportingDataset !== null}
            className="mt-auto px-4 py-2 rounded text-sm font-medium transition-all bg-white/10 text-text-primary hover:bg-white/20 border border-border disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {exportingDataset === dataset ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Exporting...
              </>
            ) : (
              'Download CSV'
            )}
          </button>
        </div>
      ))}
    </div>
  </div>
)}
```

**Step 6:** Run type-check:
```bash
npx tsc --noEmit
```
Expected: no errors.

---

## Task 5: Enable the experiments sidebar tab

**Files:**
- Modify: `src/client/pages/AdminPage.tsx`

**Step 1:** Find the `isDisabled` line (~line 683):

```typescript
const isDisabled = tab.id === 'experiments';
```

Replace with:

```typescript
const isDisabled = false;
```

**Step 2:** Find and remove the "coming soon" badge in the sidebar. It's around line 707:

```tsx
{sidebarOpen && tab.id === 'experiments' && (
  <span className="...">Soon</span>
)}
```

Delete that entire conditional block.

**Step 3:** Run type-check:
```bash
npx tsc --noEmit
```
Expected: no errors.

---

## Task 6: Fix row count key mapping + final type-check + commit

**Context:** The counts endpoint returns keys like `agentDecisions`, `approvalEvents`, `bills`, `billVotes`, `laws`, `elections`, `agents`. The UI card `dataset` strings are `agent-decisions`, `approval-events`, `bills`, `bill-votes`, `laws`, `elections`, `agents`. The row count lookup in the JSX needs to map correctly.

**Step 1:** In the card grid JSX from Task 4, the count lookup `exportCounts[dataset.replace('-', '')]` won't correctly map multi-hyphen keys. Replace the count lookup expression with a proper map:

Find this expression inside the `.map(...)` callback:
```tsx
{(exportCounts[dataset.replace('-', '')] ?? exportCounts[dataset] ?? '—').toLocaleString()} rows
```

Replace with:
```tsx
{(() => {
  const keyMap: Record<string, string> = {
    'agent-decisions': 'agentDecisions',
    'approval-events': 'approvalEvents',
    'bills': 'bills',
    'bill-votes': 'billVotes',
    'laws': 'laws',
    'elections': 'elections',
    'agents': 'agents',
  };
  const n = exportCounts[keyMap[dataset] ?? dataset];
  return n !== undefined ? n.toLocaleString() : '—';
})()} rows
```

**Step 2:** Final type-check:
```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 3:** Commit:
```bash
git add src/server/routes/admin.ts src/client/lib/api.ts src/client/pages/AdminPage.tsx
git commit -m "feat(experiments): CSV export panel in admin tab

- 7 CSV export endpoints: agent-decisions, approval-events, bills,
  bill-votes, laws, elections, agents-snapshot
- Counts endpoint for row counts displayed on each card
- AdminPage experiments tab fully enabled with download cards
- tick:complete broadcast added to agentTick.ts (from prior session)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Step 4:** Push and PR:
```bash
git fetch origin dev && git rebase origin/dev
git push -u origin feature/experiments-page

# PR to dev:
cat > /tmp/pr118.json <<'EOF'
{"title":"feat(experiments): CSV export panel in admin tab","body":"## Summary\n- 7 CSV export endpoints in /admin/export/*\n- Row counts endpoint for card display\n- Experiments tab enabled in admin sidebar\n- 7 export cards: agent decisions, approval events, bills, bill votes, laws, elections, agent snapshot\n\n## Test plan\n- [ ] Open admin /experiments tab — all 7 cards show with row counts\n- [ ] Click Download CSV on each card — file downloads correctly\n- [ ] Spinner appears during download, buttons disabled while one is active","head":"feature/experiments-page","base":"dev"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr118.json | python3 -m json.tool | grep '"number"'

# Merge PR to dev (replace N with PR number):
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/N/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d '{"Do":"merge","merge_message_field":"Merge feat(experiments): CSV export panel"}'

# PR dev→main:
cat > /tmp/pr119.json <<'EOF'
{"title":"feat(experiments): CSV export panel in admin tab","body":"Merge dev into main.","head":"dev","base":"main"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr119.json | python3 -m json.tool | grep '"number"'

# Merge PR dev→main (replace M with PR number):
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/M/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d '{"Do":"merge","merge_message_field":"Merge feat(experiments): CSV export panel"}'

# Build + restart:
npm run build && pm2 restart agora-bench --update-env
```

---

## Backlog note (not this session)

- Overview tab dashboard graphs: approval rating trends, decision count by provider, tick activity timeline
