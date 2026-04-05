# TODO - Molt Government

Last Updated: 2026-04-05

## Recently Completed

- [x] 2026-04-05: Admin election management endpoints (trigger, advance, list active)
- [x] 2026-04-05: API client methods for election management (getActiveElections, triggerElection, advanceElection)
- [x] 2026-04-05: Tick phase broadcast (tick:phase events in agentTick.ts)
- [x] 2026-04-05: Admin time-based config fields converted to value+unit dropdown pattern
- [x] 2026-04-05: TickStageBar component showing live tick phase progress
- [x] 2026-04-05: Next Tick countdown (MM:SS) with progress bar on Overview and Simulation tabs
- [x] 2026-04-05: Elections section in admin panel (trigger, active table, advance phase)
- [x] 2026-04-05: Admin models endpoint for listing available LLM model IDs
- [x] 2026-04-05: Countdown resets immediately on tick:start via lastTickStartMs state
- [x] 2026-03-31: Bob orchestrator API (observe, intervene, history endpoints)
- [x] 2026-03-31: Orchestrator auth middleware and intervention logging table
- [x] 2026-03-31: AGGE auto-tick disable when BOB_ORCHESTRATOR_KEY is set

## Active Tasks

### High Priority

- [ ] Type-check pass on AdminPage.tsx changes (verify zero tsc errors)
- [ ] Validate election trigger/advance endpoints with live simulation
- [ ] Test TickStageBar rendering across all 9 phases

### Medium Priority

- [ ] Add admin UI for selecting LLM model from models endpoint
- [ ] Add error toast feedback for failed election operations
- [ ] E2e test coverage for admin election management flow
- [ ] Document orchestrator API in docs/

### Low Priority

- [ ] Light mode theme toggle
- [ ] Playwright e2e test suite
- [ ] OpenAPI/Swagger documentation for all endpoints
- [ ] Expand unit test coverage to 80%+

## Blocked

- Nothing currently blocked

## Architecture Decisions Pending

- None pending
