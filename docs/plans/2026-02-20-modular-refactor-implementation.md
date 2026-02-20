# Modular Structure Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the flat project layout into domain-based vertical modules so related files live together.

**Architecture:** Move ~70 files into 7 domain modules (`src/modules/`) and shared infrastructure (`src/core/`). Each module is a vertical slice: server routes, services, jobs, client pages/components, and db schema. Migration is phased from least-coupled to most-coupled, one commit per phase. No logic changes -- only file moves and import path updates.

**Tech Stack:** TypeScript, Express, Drizzle ORM, React, Vite. Path aliases via tsconfig + vite.config.ts.

**Design doc:** `docs/plans/2026-02-20-modular-refactor-design.md`

---

## Conventions

Every task follows the same pattern:
1. Create target directories with `mkdir -p`
2. Move files with `git mv` (preserves history)
3. Update imports **inside** the moved files to use new relative paths or aliases
4. Update imports **in other files** that reference the moved files
5. Run `npx tsc --noEmit` -- zero errors
6. Run `npm test` -- all tests pass (if tests exist for that module)
7. Commit

**Import alias reference (applied in Task 9):**
- `@modules/*` -> `src/modules/*`
- `@core/*` -> `src/core/*`
- `@shared/*` -> `src/core/shared/*`
- `@db/*` -> `src/core/db/*`

Until Task 9, use **relative paths** for moved files since old aliases still point to old locations.

---

### Task 1: Extract Forum Module

The most isolated module. 1 route, 2 pages, 1 component, 3 schema files.

**Files to move:**

| From | To |
|------|----|
| `src/server/routes/forum.ts` | `src/modules/forum/server/routes/forum.ts` |
| `src/client/pages/ForumPage.tsx` | `src/modules/forum/client/pages/ForumPage.tsx` |
| `src/client/pages/ThreadPage.tsx` | `src/modules/forum/client/pages/ThreadPage.tsx` |
| `src/client/components/ForumWidget.tsx` | `src/modules/forum/client/components/ForumWidget.tsx` |
| `src/db/schema/forumThreads.ts` | `src/modules/forum/db/schema/forumThreads.ts` |
| `src/db/schema/agentMessages.ts` | `src/modules/forum/db/schema/agentMessages.ts` |
| `src/db/schema/pendingMentions.ts` | `src/modules/forum/db/schema/pendingMentions.ts` |

**Step 1: Create directories**

```bash
mkdir -p src/modules/forum/server/routes
mkdir -p src/modules/forum/client/pages
mkdir -p src/modules/forum/client/components
mkdir -p src/modules/forum/db/schema
```

**Step 2: Move files**

```bash
git mv src/server/routes/forum.ts src/modules/forum/server/routes/forum.ts
git mv src/client/pages/ForumPage.tsx src/modules/forum/client/pages/ForumPage.tsx
git mv src/client/pages/ThreadPage.tsx src/modules/forum/client/pages/ThreadPage.tsx
git mv src/client/components/ForumWidget.tsx src/modules/forum/client/components/ForumWidget.tsx
git mv src/db/schema/forumThreads.ts src/modules/forum/db/schema/forumThreads.ts
git mv src/db/schema/agentMessages.ts src/modules/forum/db/schema/agentMessages.ts
git mv src/db/schema/pendingMentions.ts src/modules/forum/db/schema/pendingMentions.ts
```

**Step 3: Create module barrel**

Create `src/modules/forum/index.ts`:
```typescript
export { default as forumRouter } from './server/routes/forum.js';
export { forumThreads } from './db/schema/forumThreads.js';
export { agentMessages } from './db/schema/agentMessages.js';
export { pendingMentions } from './db/schema/pendingMentions.js';
```

**Step 4: Update imports in moved files**

In `src/modules/forum/server/routes/forum.ts`:
- `@db/connection` -> `../../../../db/connection.js` (temporary relative, until Task 9)
- `@db/schema/index` -> `../../../../db/schema/index.js` (the barrel still at old location, references will be updated in Task 9)

In `src/modules/forum/client/pages/ForumPage.tsx`:
- `../lib/api` -> update to relative path to `src/client/lib/api`
- `../components/ForumWidget` -> `../components/ForumWidget` (if both moved) or adjust

In `src/modules/forum/client/components/ForumWidget.tsx`:
- `../lib/api` -> update relative path

**Step 5: Update imports in files that reference moved files**

In `src/server/routes/index.ts`:
- `'./forum'` -> `'../../modules/forum/server/routes/forum.js'`

In `src/db/schema/index.ts`:
- `'./forumThreads'` -> `'../../modules/forum/db/schema/forumThreads.js'`
- `'./agentMessages'` -> `'../../modules/forum/db/schema/agentMessages.js'`
- `'./pendingMentions'` -> `'../../modules/forum/db/schema/pendingMentions.js'`

In `src/client/App.tsx`:
- `'./pages/ForumPage'` -> `'../modules/forum/client/pages/ForumPage'`
- `'./pages/ThreadPage'` -> `'../modules/forum/client/pages/ThreadPage'`

In `src/client/components/Layout.tsx` (if it imports ForumWidget):
- Check and update any reference

In `src/client/pages/DashboardPage.tsx` (if it imports ForumWidget):
- Check and update any reference

**Step 6: Verify**

```bash
npx tsc --noEmit
```
Expected: zero errors.

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract forum module to src/modules/forum"
```

---

### Task 2: Extract Benchmark Module

Second most isolated, largest service count. 2 routes, 5 services, 1 job, 1 schema, 2 pages.

**Files to move:**

| From | To |
|------|----|
| `src/server/routes/benchmark.ts` | `src/modules/benchmark/server/routes/benchmark.ts` |
| `src/server/routes/demos.ts` | `src/modules/benchmark/server/routes/demos.ts` |
| `src/server/services/benchmarkRunner.ts` | `src/modules/benchmark/server/services/benchmarkRunner.ts` |
| `src/server/services/benchmarkMetrics.ts` | `src/modules/benchmark/server/services/benchmarkMetrics.ts` |
| `src/server/services/benchmarkWorldState.ts` | `src/modules/benchmark/server/services/benchmarkWorldState.ts` |
| `src/server/services/benchmarkEventProcessor.ts` | `src/modules/benchmark/server/services/benchmarkEventProcessor.ts` |
| `src/server/services/externalModelAdapter.ts` | `src/modules/benchmark/server/services/externalModelAdapter.ts` |
| `src/server/jobs/benchmarkJob.ts` | `src/modules/benchmark/server/jobs/benchmarkJob.ts` |
| `src/client/pages/BenchmarkPage.tsx` | `src/modules/benchmark/client/pages/BenchmarkPage.tsx` |
| `src/client/pages/TrainingPage.tsx` | `src/modules/benchmark/client/pages/TrainingPage.tsx` |
| `src/db/schema/benchmark.ts` | `src/modules/benchmark/db/schema/benchmark.ts` |
| `src/db/seedBenchmarkScenarios.ts` | `src/modules/benchmark/db/seedBenchmarkScenarios.ts` |

**Same process as Task 1:**
1. `mkdir -p` all target directories
2. `git mv` all files
3. Create `src/modules/benchmark/index.ts` barrel
4. Update imports inside moved files (route -> schema, runner -> metrics/worldState/ai/simulationCore, job -> runner)
5. Update `src/server/routes/index.ts` (benchmark, demos imports)
6. Update `src/db/schema/index.ts` (benchmark schema)
7. Update `src/client/App.tsx` (BenchmarkPage, TrainingPage)
8. Update any cross-references (e.g., `scripts/triggerBenchmarkRun.ts` imports benchmarkJob and schema)
9. `npx tsc --noEmit` -- zero errors
10. Commit: `git commit -m "refactor: extract benchmark module to src/modules/benchmark"`

**Key imports to update inside benchmark services:**
- `benchmarkRunner.ts` imports from `ai.ts`, `simulationCore.ts` (stays in `src/server/services/` until Task 9)
- `benchmarkRunner.ts` imports `benchmarkMetrics`, `benchmarkWorldState`, `benchmarkEventProcessor` (now same module -- use relative `./`)
- `benchmarkJob.ts` imports `benchmarkRunner` (now `../services/benchmarkRunner.js`)
- `benchmark.ts` route imports `benchmarkQueue` from job (now `../jobs/benchmarkJob.js`)

---

### Task 3: Extract Elections Module

3 routes, 4 pages, 3 components, 2 schema files.

**Files to move:**

| From | To |
|------|----|
| `src/server/routes/elections.ts` | `src/modules/elections/server/routes/elections.ts` |
| `src/server/routes/campaigns.ts` | `src/modules/elections/server/routes/campaigns.ts` |
| `src/server/routes/parties.ts` | `src/modules/elections/server/routes/parties.ts` |
| `src/client/pages/ElectionsPage.tsx` | `src/modules/elections/client/pages/ElectionsPage.tsx` |
| `src/client/pages/ElectionDetailPage.tsx` | `src/modules/elections/client/pages/ElectionDetailPage.tsx` |
| `src/client/pages/PartiesPage.tsx` | `src/modules/elections/client/pages/PartiesPage.tsx` |
| `src/client/pages/PartyDetailPage.tsx` | `src/modules/elections/client/pages/PartyDetailPage.tsx` |
| `src/client/components/CampaignCard.tsx` | `src/modules/elections/client/components/CampaignCard.tsx` |
| `src/client/components/ElectionBanner.tsx` | `src/modules/elections/client/components/ElectionBanner.tsx` |
| `src/client/components/BranchCard.tsx` | `src/modules/elections/client/components/BranchCard.tsx` |
| `src/db/schema/elections.ts` | `src/modules/elections/db/schema/elections.ts` |
| `src/db/schema/parties.ts` | `src/modules/elections/db/schema/parties.ts` |

**Same process.** Update:
- `src/server/routes/index.ts` (elections, campaigns, parties imports)
- `src/db/schema/index.ts` (elections, parties schemas)
- `src/client/App.tsx` (4 page imports)
- `src/client/components/Layout.tsx` (if it imports ElectionBanner)
- `src/client/pages/DashboardPage.tsx` (if it imports ElectionBanner or CampaignCard)
- Any pages that import from `../components/` -- check for cross-references

Commit: `git commit -m "refactor: extract elections module to src/modules/elections"`

---

### Task 4: Extract Legislation Module

4 routes, 6 pages, 3 components, 1 schema file.

**Files to move:**

| From | To |
|------|----|
| `src/server/routes/legislation.ts` | `src/modules/legislation/server/routes/legislation.ts` |
| `src/server/routes/votes.ts` | `src/modules/legislation/server/routes/votes.ts` |
| `src/server/routes/decisions.ts` | `src/modules/legislation/server/routes/decisions.ts` |
| `src/server/routes/court.ts` | `src/modules/legislation/server/routes/court.ts` |
| `src/client/pages/LegislationPage.tsx` | `src/modules/legislation/client/pages/LegislationPage.tsx` |
| `src/client/pages/BillDetailPage.tsx` | `src/modules/legislation/client/pages/BillDetailPage.tsx` |
| `src/client/pages/LawsPage.tsx` | `src/modules/legislation/client/pages/LawsPage.tsx` |
| `src/client/pages/LawDetailPage.tsx` | `src/modules/legislation/client/pages/LawDetailPage.tsx` |
| `src/client/pages/CourtPage.tsx` | `src/modules/legislation/client/pages/CourtPage.tsx` |
| `src/client/pages/CasePage.tsx` | `src/modules/legislation/client/pages/CasePage.tsx` |
| `src/client/components/BillCard.tsx` | `src/modules/legislation/client/components/BillCard.tsx` |
| `src/client/components/BillPipeline.tsx` | `src/modules/legislation/client/components/BillPipeline.tsx` |
| `src/client/components/LegislationCarousel.tsx` | `src/modules/legislation/client/components/LegislationCarousel.tsx` |
| `src/db/schema/legislation.ts` | `src/modules/legislation/db/schema/legislation.ts` |

**Same process.** Key notes:
- `legislation.ts` route imports agents schema (for sponsor names) -- use relative path to `src/db/schema/index.ts` until agents module is extracted
- `votes.ts` route may reference both election votes and bill votes -- check if it should stay in legislation or be split
- `src/client/pages/DashboardPage.tsx` likely imports `BillCard`, `BillPipeline`, or `LegislationCarousel`
- `src/client/components/Layout.tsx` may reference legislation components

Commit: `git commit -m "refactor: extract legislation module to src/modules/legislation"`

---

### Task 5: Extract Agents Module

3 routes, 2 pages, 2 components, 2 schema files. Central entity -- many other modules reference the agents schema.

**Files to move:**

| From | To |
|------|----|
| `src/server/routes/agents.ts` | `src/modules/agents/server/routes/agents.ts` |
| `src/server/routes/agentProfile.ts` | `src/modules/agents/server/routes/agentProfile.ts` |
| `src/server/routes/activity.ts` | `src/modules/agents/server/routes/activity.ts` |
| `src/client/pages/AgentsDirectoryPage.tsx` | `src/modules/agents/client/pages/AgentsDirectoryPage.tsx` |
| `src/client/pages/AgentProfilePage.tsx` | `src/modules/agents/client/pages/AgentProfilePage.tsx` |
| `src/client/components/PixelAvatar.tsx` | `src/modules/agents/client/components/PixelAvatar.tsx` |
| `src/client/components/ActivityFeed.tsx` | `src/modules/agents/client/components/ActivityFeed.tsx` |
| `src/db/schema/agents.ts` | `src/modules/agents/db/schema/agents.ts` |
| `src/db/schema/approvalEvents.ts` | `src/modules/agents/db/schema/approvalEvents.ts` |

**Key note:** Many files import `agents` from `@db/schema/index`. Since the barrel in `src/db/schema/index.ts` re-exports everything, we only need to update the barrel's import path. All consumers that use `@db/schema/index` continue working without changes.

However, check if any file imports directly from `@db/schema/agents` (bypassing the barrel). Those need updating.

Also check: `PixelAvatar.tsx` is likely imported by many pages (DashboardPage, AgentProfilePage, etc.) -- update all references.

Commit: `git commit -m "refactor: extract agents module to src/modules/agents"`

---

### Task 6: Extract Government Module

1 route, 1 service, 2 pages, map components, 2 schema files.

**Files to move:**

| From | To |
|------|----|
| `src/server/routes/government.ts` | `src/modules/government/server/routes/government.ts` |
| `src/server/services/congressContext.ts` | `src/modules/government/server/services/congressContext.ts` |
| `src/client/pages/CapitolMapPage.tsx` | `src/modules/government/client/pages/CapitolMapPage.tsx` |
| `src/client/pages/BuildingInteriorPage.tsx` | `src/modules/government/client/pages/BuildingInteriorPage.tsx` |
| `src/client/components/map/` (entire dir) | `src/modules/government/client/components/map/` |
| `src/db/schema/government.ts` | `src/modules/government/db/schema/government.ts` |
| `src/db/schema/governmentEvents.ts` | `src/modules/government/db/schema/governmentEvents.ts` |

**Key note:** `government.ts` schema is heavily imported by many routes (admin, agentTick, etc.) because it contains `positions`, `transactions`, `agentDecisions`, `judicialReviews`, `governmentSettings`, `tickLog`. All go through the barrel, so only the barrel import needs updating.

Commit: `git commit -m "refactor: extract government module to src/modules/government"`

---

### Task 7: Extract Admin Module

4 routes, 4 pages, 2 schema files. The hub -- imports from everywhere.

**Files to move:**

| From | To |
|------|----|
| `src/server/routes/admin.ts` | `src/modules/admin/server/routes/admin.ts` |
| `src/server/routes/researcher.ts` | `src/modules/admin/server/routes/researcher.ts` |
| `src/server/routes/providers.ts` | `src/modules/admin/server/routes/providers.ts` |
| `src/server/routes/profile.ts` | `src/modules/admin/server/routes/profile.ts` |
| `src/client/pages/AdminPage.tsx` | `src/modules/admin/client/pages/AdminPage.tsx` |
| `src/client/pages/ProfilePage.tsx` | `src/modules/admin/client/pages/ProfilePage.tsx` |
| `src/client/pages/ResearcherPage.tsx` | `src/modules/admin/client/pages/ResearcherPage.tsx` |
| `src/client/pages/ObserverPage.tsx` | `src/modules/admin/client/pages/ObserverPage.tsx` |
| `src/db/schema/users.ts` | `src/modules/admin/db/schema/users.ts` |
| `src/db/schema/providers.ts` | `src/modules/admin/db/schema/providers.ts` |

**Key note:** `admin.ts` route imports from `agentTick.ts` (job control functions), `aggeTick.ts`, and every schema. These imports will use relative paths up to the old locations until Task 8.

Commit: `git commit -m "refactor: extract admin module to src/modules/admin"`

---

### Task 8: Extract Core Infrastructure

Move remaining shared files into `src/core/`. This is where the old flat directories get replaced.

**Files to move:**

| From | To |
|------|----|
| `src/server/index.ts` | `src/core/server/index.ts` |
| `src/server/config.ts` | `src/core/server/config.ts` |
| `src/server/runtimeConfig.ts` | `src/core/server/runtimeConfig.ts` |
| `src/server/websocket.ts` | `src/core/server/websocket.ts` |
| `src/server/middleware/auth.ts` | `src/core/server/middleware/auth.ts` |
| `src/server/middleware/index.ts` | `src/core/server/middleware/index.ts` |
| `src/server/services/ai.ts` | `src/core/server/services/ai.ts` |
| `src/server/services/simulationCore.ts` | `src/core/server/services/simulationCore.ts` |
| `src/server/jobs/agentTick.ts` | `src/core/server/jobs/agentTick.ts` |
| `src/server/jobs/aggeTick.ts` | `src/core/server/jobs/aggeTick.ts` |
| `src/server/routes/index.ts` | `src/core/server/routes/index.ts` |
| `src/server/routes/health.ts` | `src/core/server/routes/health.ts` |
| `src/server/routes/search.ts` | `src/core/server/routes/search.ts` |
| `src/server/routes/calendar.ts` | `src/core/server/routes/calendar.ts` |
| `src/server/routes/ticks.ts` | `src/core/server/routes/ticks.ts` |
| `src/server/lib/` (if exists) | `src/core/server/lib/` |
| `src/client/App.tsx` | `src/core/client/App.tsx` |
| `src/client/main.tsx` | `src/core/client/main.tsx` |
| `src/client/lib/api.ts` | `src/core/client/lib/api.ts` |
| `src/client/lib/useWebSocket.ts` | `src/core/client/lib/useWebSocket.ts` |
| `src/client/lib/buildings.ts` | `src/core/client/lib/buildings.ts` |
| `src/client/lib/tickerPrefs.ts` | `src/core/client/lib/tickerPrefs.ts` |
| `src/client/lib/toastStore.ts` | `src/core/client/lib/toastStore.ts` |
| `src/client/components/Layout.tsx` | `src/core/client/components/Layout.tsx` |
| `src/client/components/GlobalSearch.tsx` | `src/core/client/components/GlobalSearch.tsx` |
| `src/client/components/KeyboardShortcutsModal.tsx` | `src/core/client/components/KeyboardShortcutsModal.tsx` |
| `src/client/components/LiveTicker.tsx` | `src/core/client/components/LiveTicker.tsx` |
| `src/client/components/ToastContainer.tsx` | `src/core/client/components/ToastContainer.tsx` |
| `src/client/components/SectionHeader.tsx` | `src/core/client/components/SectionHeader.tsx` |
| `src/client/components/SidebarCard.tsx` | `src/core/client/components/SidebarCard.tsx` |
| `src/client/components/CollapsibleSection.tsx` | `src/core/client/components/CollapsibleSection.tsx` |
| `src/client/components/EventDetailModal.tsx` | `src/core/client/components/EventDetailModal.tsx` |
| `src/client/components/icons/` | `src/core/client/components/icons/` |
| `src/client/pages/DashboardPage.tsx` | `src/core/client/pages/DashboardPage.tsx` |
| `src/client/pages/CalendarPage.tsx` | `src/core/client/pages/CalendarPage.tsx` |
| `src/db/connection.ts` | `src/core/db/connection.ts` |
| `src/db/schema/index.ts` | `src/core/db/schema/index.ts` |
| `src/db/migrations/` | `src/core/db/migrations/` |
| `src/db/seed.ts` | `src/core/db/seed.ts` |
| `src/db/seedFn.ts` | `src/core/db/seedFn.ts` |
| `src/db/seed.placeholder.ts` | `src/core/db/seed.placeholder.ts` |
| `src/shared/constants.ts` | `src/core/shared/constants.ts` |
| `src/shared/types.ts` | `src/core/shared/types.ts` |
| `src/shared/validation.ts` | `src/core/shared/validation.ts` |
| `src/shared/index.ts` | `src/core/shared/index.ts` |

**This is the largest task.** Every import path that uses `@server/`, `@client/`, `@db/`, or `@shared/` needs updating. However, we handle this in the next step (Task 9) by updating the aliases rather than rewriting every import.

**Step 1:** Create all `src/core/` directories and `git mv` everything.

**Step 2:** Update the entry point references:
- `start-server.sh`: change `src/server/index.ts` -> `src/core/server/index.ts`
- `ecosystem.config.cjs`: no change (uses start-server.sh)
- `package.json` scripts: update `dev:server` to `tsx watch src/core/server/index.ts`
- `vite.config.ts`: update `root` if needed (likely no change)

**Step 3:** Verify, then commit.

Commit: `git commit -m "refactor: extract core infrastructure to src/core"`

---

### Task 9: Update Path Aliases and Fix All Imports

Now that everything is in its final location, update tsconfig and Vite aliases.

**Step 1: Update `tsconfig.json` paths**

```json
{
  "paths": {
    "@modules/*": ["src/modules/*"],
    "@core/*": ["src/core/*"],
    "@shared/*": ["src/core/shared/*"],
    "@db/*": ["src/core/db/*"]
  }
}
```

Remove old `@server/*` and `@client/*` aliases.

**Step 2: Update `vite.config.ts` resolve aliases**

```typescript
resolve: {
  alias: {
    '@modules': path.resolve(__dirname, 'src/modules'),
    '@core': path.resolve(__dirname, 'src/core'),
    '@shared': path.resolve(__dirname, 'src/core/shared'),
    '@db': path.resolve(__dirname, 'src/core/db'),
  },
},
```

**Step 3: Global find-and-replace old alias imports**

Search for all `@server/` imports and replace with `@core/server/`:
- `@server/config` -> `@core/server/config`
- `@server/middleware/auth` -> `@core/server/middleware/auth`
- `@server/services/ai` -> `@core/server/services/ai`
- `@server/websocket` -> `@core/server/websocket`
- etc.

Search for all `@client/` imports and replace with `@core/client/`:
- `@client/lib/api` -> `@core/client/lib/api`
- `@client/components/Layout` -> `@core/client/components/Layout`
- etc.

`@shared/*` and `@db/*` should still work since we kept those aliases pointing to the new locations.

**Step 4: Fix any remaining relative imports**

Temporary relative paths used in Tasks 1-8 (like `../../../../db/connection.js`) should now use aliases:
- `../../../../db/connection.js` -> `@db/connection`
- `../../../../server/services/ai.js` -> `@core/server/services/ai`

**Step 5: Verify**

```bash
npx tsc --noEmit
npm run build
npm test
```

All must pass with zero errors.

Commit: `git commit -m "refactor: update path aliases to @modules/@core scheme"`

---

### Task 10: Cleanup

**Step 1:** Remove empty old directories:

```bash
rmdir src/server/routes src/server/services src/server/jobs src/server/middleware src/server/lib src/server
rmdir src/client/pages src/client/components src/client/lib src/client
rmdir src/db/schema src/db
rmdir src/shared
```

(Only remove if actually empty. Some may have been fully moved, some may not.)

**Step 2:** Update any remaining references:
- `drizzle.config.ts` (if it references schema paths)
- CI/CD configs
- Docker configs
- README references to file paths

**Step 3:** Verify one final time:

```bash
npx tsc --noEmit
npm run build
npm test
npx pm2 restart agora-bench
```

Open browser, verify all pages load.

Commit: `git commit -m "refactor: remove empty directories and update config references"`

---

## Summary

| Task | Module | Files Moved | Risk |
|------|--------|-------------|------|
| 1 | Forum | 7 | Very Low |
| 2 | Benchmark | 12 | Low |
| 3 | Elections | 12 | Low |
| 4 | Legislation | 14 | Low |
| 5 | Agents | 9 | Medium (central entity) |
| 6 | Government | 7+ | Medium (schema heavily used) |
| 7 | Admin | 10 | Medium (hub, many imports) |
| 8 | Core | ~40 | High (everything else) |
| 9 | Aliases | 0 (config only) | High (global import rewrite) |
| 10 | Cleanup | 0 | Low |

**Total:** ~110 file moves, ~200 import updates, 10 commits, zero logic changes.
