# TODO - Molt Government

Last Updated: 2026-04-10

## Recently Completed

- [x] 2026-04-10: Elections pipeline fix — admin POST /admin/elections/:id/advance was a naive status-string bumper with no business logic. Force-advancing a presidential election left winner_id NULL, total_votes 0, and no positions row (no president seated). Extracted phase 14 finalize logic into shared finalizeElection(electionId) helper at src/modules/elections/server/finalizeElection.ts. Admin advance now delegates to it for voting→certified. Dropped dead 'counting' phase. Unified terminal state to 'certified' (phase 14 previously wrote 'completed' which ai.ts and elections.ts did not read). Added phase 14 auto-fill for congress vacancies (mirrors justice pattern) and auto-trigger for presidential elections when no sitting president + no in-flight election. Backfilled stuck election 03e1591a — Sam Ritter seated as president (8757 vote total). Cancelled duplicate election 1c65b018. Verified live on tick 16:45 UTC — phase 14 detected 48 vacancies, seated Zara Moss (only remaining unassigned agent).
- [x] 2026-04-10: Simulation verified running on bspark2 (10.0.0.169:8000) with Qwen/Qwen2.5-32B-Instruct-GPTQ-Int8. 15-min cron has zero drift, avg tick duration ~356s, ~940 decisions/6h. Populated simInferenceModel + aggeInferenceModel DB config fields (was falling through to env var only).
- [x] 2026-04-07: Inference URL preset dropdowns + smart model dropdowns — both AGGE and Simulation sections get preset URL combo (bspark1/bspark2/OpenRouter/Anthropic/OpenAI/Custom), model dropdown fetches curated lists for cloud providers, live query for vLLM. Split simModels/aggeModels state. simInferenceUrl/simInferenceModel added to runtimeConfig and persisted.
- [x] 2026-04-07: Fixed bspark2 inference — simulation was pointing at bspark1 (10.0.0.69), corrected to bspark2 (10.0.0.169) in .env on Linux box. Model corrected to Qwen/Qwen2.5-32B-Instruct-GPTQ-Int8.
- [x] 2026-04-07: Fixed AGGE model — stale anthropic/claude-sonnet-4-5 updated to anthropic/claude-sonnet-4-6 in .env and DB
- [x] 2026-04-07: OpenClaw config repaired after auto-update broke schema — removed invalid keys, fixed exec security value, resolved Docker volume shadow issue, killed competing openclaw-gateway process
- [x] 2026-04-07: Cloudflare browser_cache_ttl set to 0 (respect origin headers) — was caching API HTML responses
- [x] 2026-04-07: SidebarCard duplicate key fix — key={label+idx} prevents warning when two elections share same positionType label
- [x] 2026-04-07: api.ts content-type guard — checks response is JSON before calling .json(), throws clear error instead of SyntaxError on HTML responses
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
- [x] 2026-04-05: Dynamic Weight Engine — all 10 phases implemented
- [x] 2026-04-05: Floor activity — lobbying, amendments, deal honor check, bill withdrawal, public statements
- [x] 2026-04-05: Admin election management endpoints (trigger, advance, list active)
- [x] 2026-04-05: Tick phase broadcast + TickStageBar component
- [x] 2026-04-05: Next Tick countdown with progress bar
- [x] 2026-03-31: Bob orchestrator API (observe, intervene, history endpoints)
- [x] 2026-03-31: AGGE auto-tick disable when BOB_ORCHESTRATOR_KEY is set

## Active Tasks

### High Priority

- [ ] Real election vote casting — agents currently don't vote in elections at all. finalizeElection() picks a winner from `campaigns.contributions` as a placeholder (see comment in finalizeElection.ts). Needs a dedicated vote-casting phase in the tick where eligible agents make an LLM decision and write to the `votes` table. Then finalizeElection swaps the tally source from campaigns.contributions to `SELECT candidate_id, COUNT(*) FROM votes ... GROUP BY candidate_id`. Single source of truth — only touch finalizeElection().
- [ ] Agent pool is too small for 50 congress seats — currently 10 agents total, all now holding at least one position. congress auto-fill runs but can only seat whoever's unassigned. Either (a) reduce rc.congressSeats to match agent pool, (b) seed many more agents, or (c) allow agents to hold multiple positions simultaneously (already accidentally happening with Sam Ritter = president + congress member).
- [ ] Resolve double-position state — Sam Ritter now holds both President and Congress Member positions. Decide: does winning a higher office vacate a lower one? Phase 14 finalize should probably deactivate any `congress_member` position when the same agent is seated as `president`/`cabinet_secretary`.
- [ ] AGGE visibility — no way to see if personality adjustments are actually happening. Need intervention history visible on Agent profile page (personalityMod history, what changed, when, why)
- [ ] AGGE re-enable — remove BOB_ORCHESTRATOR_KEY gate, let AGGE run on its own interval independent of Bob. Bob and AGGE are separate concerns.

### Medium Priority

- [ ] Add error toast feedback for failed election operations
- [ ] Flesh out wiki articles as simulation matures

### Low Priority

- [ ] Light mode theme toggle
- [ ] Playwright e2e test suite
- [ ] OpenAPI/Swagger documentation for all endpoints
- [ ] Expand unit test coverage to 80%+

## Blocked

- Nothing currently blocked

## Architecture Decisions Pending

### AGGE v2 — Reality Injection Layer

AGGE is the overseer of the simulation — not just a personality ticker. Full scope:

1. **Personality nudges** (current, broken/invisible) — scheduled LLM call adjusts agent personalityMod based on behavior patterns
2. **Reality event injection** — external world events (economic shifts, news, crises) that agents must respond to
3. **Document imperfection** — when agents produce outputs (bills, paperwork), AGGE introduces human-like noise: minor errors, ambiguity, revision triggers
4. **Behavioral gravity** — pull agents toward scheduled obligations ("you authored that bill, you need a press briefing")

Decision needed: scope and sequencing of AGGE v2 phases before implementation begins.

### Tick System v2 — Branching Parallel Architecture

Current tick is a sequential straight line. Real architecture needs:
- Parallel agent inference (agents don't all infer the same thing at the same time)
- Branching paths (not every agent participates in every phase)
- Proper queuing — agents pulled toward tasks on their schedule, not pushed through a uniform pipeline
- Routing gates and weighted gates to keep the simulation alive and reactive

Decision needed: queue architecture design (Bull job graph vs event-driven vs hybrid) before refactor begins.
