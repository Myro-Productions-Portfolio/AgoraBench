# TODO - Molt Government

Last Updated: 2026-04-07

## Recently Completed

- [x] 2026-04-07: Logs drawer — live log viewer anchored to admin panel bottom, two split panes (Simulation / Full), alternating tan/gold lines, JSON/CSV export, WebSocket delivery via console.warn intercept
- [x] 2026-04-07: Admin layout locked to full viewport — h-screen overflow-hidden, footer hidden on /admin, Logs button always visible
- [x] 2026-04-07: GitHub remote synced — was 7 commits behind, now current with Gitea/Linux box
- [x] 2026-04-07: cloudflared enabled on boot (sudo systemctl enable cloudflared on 10.0.0.10)
- [x] 2026-04-07: AGGE admin controls — Bob mode indicator badge, Force AGGE Tick button, Bob Test Observe button
- [x] 2026-04-07: CLAUDE.md deploy section corrected — removed dev:local, documented pnpm run deploy as the only valid deploy command
- [x] 2026-04-06: Wiki drawer — 35vw right-side drawer with file tree, article pane, font scaling (13–17px), full-text search
- [x] 2026-04-06: Nav redesign — Tools & Profile dropdown replacing flat right-nav links, wiki icon replacing `?` button
- [x] 2026-04-06: Wiki content — 20 full articles covering agents, legislature, elections, economy, config, orchestration, reference
- [x] 2026-04-05: Dynamic Weight Engine smoke test passed (90 rel deltas, 30 policy positions, 2 laws, 1 judicial review)
- [x] 2026-04-05: Dynamic Weight Engine comprehensive documentation (docs/DYNAMIC_WEIGHT_ENGINE.md with Mermaid diagrams)
- [x] 2026-04-05: Dynamic Weight Engine — all 10 phases implemented
  - Phase 1: Foundation (bio field, forum_reply action, 16 rc fields, vote count denorm, term config)
  - Phase 2: Relationship Evolution Engine (delta+decay model, sentiment from co-sponsorship/tabling/veto, forumInteractions writes)
  - Phase 3: Approval + Economy Context (economy context block, approval in prompts, treasury crisis events, approval decay config)
  - Phase 4: Legislative Decision Router (whip follow rate, dead committee config, Phase 7 override context)
  - Phase 5: Presidential Veto Composite (5-signal veto probability, signing statements)
  - Phase 6: Forum Routing Engine (forumRouter.ts, softmax sampling, generateForumPost/Reply wrappers, parentId targeting)
  - Phase 7: Economic Pressure Engine (economy-modified proposal rate, amendment rc config, weighted judicial challenge, economy in bill prompts)
  - Phase 8: Electoral Weight + Campaign Desperation (margin-scaled deltas, totalVotes, personalityMod cascades, desperation gradient)
  - Phase 9: AGGE Evolution Pressure (weighted agent selection, enriched intervention context)
  - Phase 10: Coalition Formation (coalition_snapshots table, BFS clustering, co-sponsor hints)
- [x] 2026-04-05: Floor activity — lobbying (Phase 1.5), amendments (Phase 1.7), deal honor check (Phase 2c), bill withdrawal (Phase 5.5), public statements (Phase 11.5)
- [x] 2026-04-05: Admin election management endpoints (trigger, advance, list active)
- [x] 2026-04-05: Tick phase broadcast (tick:phase events in agentTick.ts)
- [x] 2026-04-05: TickStageBar component showing live tick phase progress
- [x] 2026-04-05: Next Tick countdown (MM:SS) with progress bar on Overview and Simulation tabs
- [x] 2026-04-05: Elections section in admin panel (trigger, active table, advance phase)
- [x] 2026-03-31: Bob orchestrator API (observe, intervene, history endpoints)
- [x] 2026-03-31: AGGE auto-tick disable when BOB_ORCHESTRATOR_KEY is set

## Active Tasks

### High Priority

- [ ] Validate election trigger/advance endpoints with live simulation — voting election in progress, watch for winner in activity feed
- [ ] Test TickStageBar rendering across all 9 phases
- [ ] Investigate AGGE/OpenClaw config not saving (Bob mode config persistence issue — not a codebase bug)

### Medium Priority

- [ ] Add admin UI for selecting LLM model from models endpoint
- [ ] Add error toast feedback for failed election operations
- [ ] E2e test coverage for admin election management flow
- [ ] Document orchestrator API in docs/
- [ ] Flesh out wiki articles as simulation matures — current content covers architecture, not live sim state

### Low Priority

- [ ] Light mode theme toggle
- [ ] Playwright e2e test suite
- [ ] OpenAPI/Swagger documentation for all endpoints
- [ ] Expand unit test coverage to 80%+

## Blocked

- Nothing currently blocked

## Architecture Decisions Pending

- None pending
