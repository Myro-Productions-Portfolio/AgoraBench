# Remaining 5% Polish — Design Document

**Date:** 2026-02-20
**Status:** Approved
**Branch:** feature/polish-hardening

---

## Problem

The Molt Government codebase is ~95% complete. Three gaps remain:

1. **42+ silent catch blocks** — errors disappear without logging, making production debugging impossible
2. **Broken test config** — vitest path aliases are stale after the modular refactor; 83 existing tests can't run
3. **2 placeholder metrics** — `adversarialResilience` and `coalitionStability` return null

## Design

### Phase 1: Error Handling Hardening

**Principle:** Add observability without changing control flow. Every catch block gets logging; no behavior changes.

Three tiers:

| Tier | Pattern | Fix | Count |
|------|---------|-----|-------|
| Critical | Empty `catch {}` in server code | Add `console.error('[MODULE] context:', err)` | 3 |
| High | `.catch(() => {})` in client pages | Add `console.error` + optional error state | ~22 |
| Medium | JSON parse / fallback-without-logging | Add `console.warn` before returning fallback | ~12 |

**Files affected (server):**
- `src/core/server/middleware/auth.ts` — Clerk sync catch
- `src/core/server/jobs/aggeTick.ts` — tick init catch
- `src/core/server/services/ai.ts` — JSON parse, context builders, decision inserts

**Files affected (client):**
- `src/modules/admin/client/pages/AdminPage.tsx` — 12+ catches
- `src/modules/admin/client/pages/ObserverPage.tsx` — 10+ catches
- `src/modules/admin/client/pages/ResearcherPage.tsx` — 6 catches
- `src/modules/admin/client/pages/ProfilePage.tsx` — 3 catches
- `src/core/client/components/LiveTicker.tsx` — 1 catch
- `src/core/client/components/Layout.tsx` — 1 catch
- `src/modules/forum/client/components/ForumWidget.tsx` — 2 catches
- `src/modules/legislation/client/pages/LawsPage.tsx` — 1 catch
- `src/modules/legislation/client/pages/CourtPage.tsx` — 1 catch
- `src/modules/elections/client/pages/PartyDetailPage.tsx` — 1 catch
- `src/modules/agents/client/pages/AgentProfilePage.tsx` — 1 catch
- `src/modules/benchmark/server/routes/demos.ts` — 1 catch (tmpdir cleanup)
- `src/modules/government/client/pages/BuildingInteriorPage.tsx` — 1 catch (clipboard)
- `src/modules/admin/server/routes/providers.ts` — 1 catch
- `src/modules/admin/server/routes/profile.ts` — 1 catch
- `src/core/server/jobs/agentTick.ts` — 1 catch

### Phase 2: Fix Vitest Config

Update `vitest.config.ts` path aliases from the pre-refactor scheme to the new modular scheme:

```
@shared -> src/core/shared  (was src/shared)
@core   -> src/core         (new)
@db     -> src/core/db      (was src/db)
@modules -> src/modules     (new)
```

Then run all tests, fix any remaining import issues in test files.

### Phase 3: Placeholder Metrics

**`computeAdversarialResilience()`** — Measure how well agents maintain governance quality under adversarial conditions. Implementation: compare average governance scores of agents who faced opposition (>50% nay votes on their bills) vs. those who didn't. Return ratio.

**`coalitionStability`** — Measure coalition durability. Implementation: calculate the standard deviation of cross-party voting agreement over time windows. Lower deviation = more stable coalitions.

Both metrics use existing data from the decisions and votes tables — no new simulation mechanics required.

### Out of Scope

- Tier 3 benchmark scenario configs (require new simulation mechanics)
- useAgentMap fallback building sorting (requires position-holder data)
- New test files for untested modules (separate effort)
