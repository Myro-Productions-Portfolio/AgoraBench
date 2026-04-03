# Modular Structure Refactor Design

**Goal:** Restructure the flat project layout into domain-based vertical modules for better cohesion, discoverability, and scalability.

**Approach:** Domain Modules (full vertical slices) -- each module contains its own server routes, services, jobs, client pages, client components, and db schema. Shared infrastructure lives in `core/`.

---

## Module Map

| Module | Server Routes | Server Services | Server Jobs | DB Schema | Client Pages | Client Components |
|--------|--------------|----------------|-------------|-----------|-------------|-------------------|
| **benchmark** | benchmark.ts, demos.ts | benchmarkRunner, benchmarkMetrics, benchmarkWorldState, benchmarkEventProcessor, externalModelAdapter | benchmarkJob | benchmark.ts | BenchmarkPage, TrainingPage | -- |
| **legislation** | legislation.ts, votes.ts, decisions.ts, court.ts | -- | -- | legislation.ts | LegislationPage, BillDetailPage, LawsPage, LawDetailPage, CourtPage, CasePage | BillCard, BillPipeline, LegislationCarousel |
| **elections** | elections.ts, campaigns.ts, parties.ts | -- | -- | elections.ts, parties.ts | ElectionsPage, ElectionDetailPage, PartiesPage, PartyDetailPage | CampaignCard, ElectionBanner, BranchCard |
| **agents** | agents.ts, agentProfile.ts, activity.ts | -- | -- | agents.ts, approvalEvents.ts | AgentsDirectoryPage, AgentProfilePage | PixelAvatar, ActivityFeed |
| **forum** | forum.ts | -- | -- | forumThreads.ts, agentMessages.ts, pendingMentions.ts | ForumPage, ThreadPage | ForumWidget |
| **government** | government.ts | congressContext.ts | -- | government.ts, governmentEvents.ts | CapitolMapPage, BuildingInteriorPage | map/* |
| **admin** | admin.ts, researcher.ts, providers.ts, profile.ts | -- | -- | users.ts, providers.ts | AdminPage, ProfilePage, ResearcherPage, ObserverPage | -- |

## Core (Shared Infrastructure)

| Layer | Files |
|-------|-------|
| **core/server/services** | ai.ts, simulationCore.ts |
| **core/server/jobs** | agentTick.ts, aggeTick.ts |
| **core/server/routes** | health.ts, search.ts, calendar.ts, ticks.ts, index.ts (route aggregator) |
| **core/server/middleware** | auth.ts, index.ts (errorHandler, requestLogger) |
| **core/server** | config.ts, runtimeConfig.ts, websocket.ts, index.ts (Express app) |
| **core/client/lib** | api.ts, useWebSocket.ts, buildings.ts, tickerPrefs.ts, toastStore.ts |
| **core/client/components** | Layout, GlobalSearch, KeyboardShortcutsModal, LiveTicker, ToastContainer, SectionHeader, SidebarCard, CollapsibleSection, EventDetailModal, icons/ |
| **core/client/pages** | DashboardPage |
| **core/client** | App.tsx, main.tsx |
| **core/db** | connection.ts, migrations/, seed.ts, seedFn.ts, seed.placeholder.ts, seedBenchmarkScenarios.ts, schema/index.ts (barrel re-export) |
| **core/shared** | constants.ts, types.ts, validation.ts, index.ts |

## Directory Structure

```
src/
  modules/
    benchmark/
      server/
        routes/          benchmark.ts, demos.ts
        services/        benchmarkRunner.ts, benchmarkMetrics.ts, benchmarkWorldState.ts,
                         benchmarkEventProcessor.ts, externalModelAdapter.ts
        jobs/            benchmarkJob.ts
      client/
        pages/           BenchmarkPage.tsx, TrainingPage.tsx
      db/
        schema/          benchmark.ts
      index.ts

    legislation/
      server/
        routes/          legislation.ts, votes.ts, decisions.ts, court.ts
      client/
        pages/           LegislationPage.tsx, BillDetailPage.tsx, LawsPage.tsx,
                         LawDetailPage.tsx, CourtPage.tsx, CasePage.tsx
        components/      BillCard.tsx, BillPipeline.tsx, LegislationCarousel.tsx
      db/
        schema/          legislation.ts
      index.ts

    elections/
      server/
        routes/          elections.ts, campaigns.ts, parties.ts
      client/
        pages/           ElectionsPage.tsx, ElectionDetailPage.tsx,
                         PartiesPage.tsx, PartyDetailPage.tsx
        components/      CampaignCard.tsx, ElectionBanner.tsx, BranchCard.tsx
      db/
        schema/          elections.ts, parties.ts
      index.ts

    agents/
      server/
        routes/          agents.ts, agentProfile.ts, activity.ts
      client/
        pages/           AgentsDirectoryPage.tsx, AgentProfilePage.tsx
        components/      PixelAvatar.tsx, ActivityFeed.tsx
      db/
        schema/          agents.ts, approvalEvents.ts
      index.ts

    forum/
      server/
        routes/          forum.ts
      client/
        pages/           ForumPage.tsx, ThreadPage.tsx
        components/      ForumWidget.tsx
      db/
        schema/          forumThreads.ts, agentMessages.ts, pendingMentions.ts
      index.ts

    government/
      server/
        routes/          government.ts
        services/        congressContext.ts
      client/
        pages/           CapitolMapPage.tsx, BuildingInteriorPage.tsx
        components/      map/
      db/
        schema/          government.ts, governmentEvents.ts
      index.ts

    admin/
      server/
        routes/          admin.ts, researcher.ts, providers.ts, profile.ts
      client/
        pages/           AdminPage.tsx, ProfilePage.tsx, ResearcherPage.tsx,
                         ObserverPage.tsx
      db/
        schema/          users.ts, providers.ts
      index.ts

  core/
    server/
      middleware/        auth.ts, index.ts
      routes/            health.ts, search.ts, calendar.ts, ticks.ts, index.ts
      jobs/              agentTick.ts, aggeTick.ts
      services/          ai.ts, simulationCore.ts
      config.ts
      runtimeConfig.ts
      websocket.ts
      index.ts
    client/
      lib/               api.ts, useWebSocket.ts, buildings.ts, tickerPrefs.ts, toastStore.ts
      components/        Layout.tsx, GlobalSearch.tsx, KeyboardShortcutsModal.tsx,
                         LiveTicker.tsx, ToastContainer.tsx, SectionHeader.tsx,
                         SidebarCard.tsx, CollapsibleSection.tsx, EventDetailModal.tsx, icons/
      pages/             DashboardPage.tsx
      App.tsx
      main.tsx
    db/
      connection.ts
      migrations/
      schema/
        index.ts         (barrel re-export of all module schemas)
      seed.ts
      seedFn.ts
      seed.placeholder.ts
      seedBenchmarkScenarios.ts
    shared/
      constants.ts
      types.ts
      validation.ts
      index.ts
```

## Import Strategy

**New tsconfig path aliases:**

```json
{
  "@modules/*": ["src/modules/*"],
  "@core/*": ["src/core/*"],
  "@shared/*": ["src/core/shared/*"],
  "@db/*": ["src/core/db/*"]
}
```

Old `@server/*` and `@client/*` aliases are removed.

**Import rules:**
- Modules can import from `@core/*` and `@shared/*` freely.
- Modules can import other modules' **schema only** (e.g., legislation needs agents schema for sponsor references).
- Modules must NOT import other modules' routes, services, or pages.
- `core/` can import module schemas (for the barrel re-export) but nothing else from modules.

Vite config aliases must be updated to match.

## Migration Strategy

Phased, least-coupled-first, one commit per phase:

1. **Forum** -- most isolated (1 route, 2 pages, 3 schema). Proves the pattern.
2. **Benchmark** -- second most isolated, largest service count.
3. **Elections** -- clean boundaries, no services.
4. **Legislation** -- imports agents schema for sponsor names.
5. **Agents** -- central entity, many modules reference its schema.
6. **Government** -- depends on agents schema.
7. **Admin** -- the hub, imports from everywhere. Move last.
8. **Core extraction** -- move shared files into `core/`, update tsconfig + Vite aliases.
9. **Cleanup** -- remove empty directories, verify build + tests.

**Per-phase process:**
1. Create module directory structure
2. `git mv` files (preserves history)
3. Update import paths in moved files
4. Update import paths in files referencing moved files
5. Update route aggregator and schema barrel export
6. `tsc --noEmit` -- zero errors
7. Run tests -- all pass
8. Commit

**Safety:** TypeScript catches broken imports. git mv preserves history. Each phase is one revertible commit.
