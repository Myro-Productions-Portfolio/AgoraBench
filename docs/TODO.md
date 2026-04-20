# TODO - Molt Government

Last Updated: 2026-04-19

## Recently Completed

- [x] 2026-04-19: MCP server live at `https://agorabench.com/mcp` — Streamable HTTP transport, bearer-gated with the existing `BOB_ORCHESTRATOR_KEY`. Exposes three tools: `observe_simulation`, `intervene`, `get_history`. Any MCP-compatible client (Openclaw/Bob, Claude Desktop, Cursor) can connect with one config block. Shared logic at `src/modules/admin/server/lib/orchestratorCore.ts` — both REST routes and MCP tools call it, so they can't drift apart. `@modelcontextprotocol/sdk@1.29.0` (stable). Verified initialize handshake + tool discovery end-to-end through Cloudflare tunnel. Bob's briefing at `bob/projects/agorabench/README.md` on Openclaw updated with MCP section (section 10).
- [x] 2026-04-19: Gemma-4-31B live on Spark 1 as sim inference — migrated off Qwen3-VL-32B-AWQ on Spark 2. vLLM container `vllm-reasoning` on bspark1, bf16 unquantized, served as `gemma-4-31b` on port **1234** (docker port-map, not 8000). Runtime config updated: `simInferenceUrl=http://10.0.0.69:1234/v1`, `simInferenceModel=gemma-4-31b`. Per-call latency ~12-17s (vs 3-4s for Qwen AWQ); PyTorch warned GB10 CUDA cap 12.1 > supported 12.0 but generation works. Spark 2's `sglang-qwen3vl` stopped. Pure text-only vs Qwen3-VL's vision-tuned variant.
- [x] 2026-04-19: Sim tuning for Gemma speed — withdrew 25 of 30 stale floor bills (Apr 11 backlog, tick had been stuck in Phase 1 whip signals for days), closed 27 in-flight `tick_log` rows going back to Apr 6, bumped `tickIntervalMs` from 30 min → 90 min. Fresh tick post-fix is now progressing cleanly through phases on Gemma.
- [x] 2026-04-19: Bob orchestrator handoff complete — AGGE auto-tick stays disabled (`BOB_ORCHESTRATOR_KEY` set), AGGE admin tab controls confirmed dead-UI (do not affect Bob). Bob briefing file dropped in Openclaw workspace at `bob/projects/agorabench/README.md` with full API reference (REST + MCP), auth details, cadence suggestions, guardrails, first-boot checklist.
- [x] 2026-04-19: Repo cleanup — deleted 76 stale remote branches on Gitea (71 fully merged + 4 stale unmerged design/AGGE branches from Feb), 12 local branches on dev machine, 11 on Linux box. Both remotes and both workstations now on `main` only. GitHub portfolio mirror also brought current (was 1 commit behind).
- [x] 2026-04-10: Congress context activated — set CONGRESS_API_KEY in .env on Linux box, restarted server. congressContext.ts now fetches real US Congress bills (119th Congress, AI/tech keywords, 90-day window) and injects them into agent system prompts as "Real-World Congressional Activity". Verified no "not set" warnings after initial startup race condition.
- [x] 2026-04-10: Agent pool expansion 10 → 30 — seeded 20 new agents via scripts/seed-expansion-agents.ts, distributed 4 per alignment across all 5 parties, routed through bspark2 vLLM. Tick 22:00 (first 30-agent tick): 611s. Tick 22:15 (all 30 fully seated in congress, worst case): 887s (~14:47, less than 15 seconds of headroom on the 15-min cron). Tick 22:30: 715s. Average ~12m 18s. Staged for next server restart: rc.tickIntervalMs 900000 → 1200000 (20 min, gives 5-min worst-case headroom) and rc.congressSeats 50 → 25 (agent pool can't sustain 50 anyway). Also staged: rc.simInferenceModel and rc.aggeInferenceModel (previously empty strings, now populated — breaks the .env var load-bearing dependency). None of these config changes require a code push; they activate on next restart. Phase 14 auto-fill verified seating 10+ new agents in the 22:00 tick.
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

- [ ] Reality injection phases 2+3 — Phase 2: broader real-world feeds (economic indicators, news, public opinion) as additional context block builders following the congressContext.ts pattern. Phase 3: MCP-based tool use where agents actively query external sources during decision-making. Brainstorming paused mid-session 2026-04-10 — user chose option D (all of the above, layered over time). Design spec not yet written.
- [ ] Real election vote casting — agents currently don't vote in elections at all. finalizeElection() picks a winner from `campaigns.contributions` as a placeholder (see comment in finalizeElection.ts). Needs a dedicated vote-casting phase in the tick where eligible agents make an LLM decision and write to the `votes` table. Then finalizeElection swaps the tally source from campaigns.contributions to `SELECT candidate_id, COUNT(*) FROM votes ... GROUP BY candidate_id`. Single source of truth — only touch finalizeElection().
- [ ] Resolve double-position state — Sam Ritter currently holds both President and Congress Member. Decide: does winning a higher office vacate a lower one? finalizeElection() should probably deactivate any `congress_member` position when the same agent is seated as `president`/`cabinet_secretary`. With 30 agents and 25 congressSeats + 7 justices + 1 president + potential cabinet, there's now enough pool slack that this matters.
- [ ] Tune rc.congressSeats for the 30-agent pool — currently set to 25 in DB (takes effect next restart), but the right number depends on how many justices + cabinet slots we reserve. With 30 total - 7 justices - 1 president = 22, so 20-22 is probably the realistic ceiling unless we allow multi-position holders.
- [ ] AGGE visibility — no way to see if personality adjustments are actually happening. Need intervention history visible on Agent profile page (personalityMod history, what changed, when, why)
- [ ] AGGE re-enable — remove BOB_ORCHESTRATOR_KEY gate, let AGGE run on its own interval independent of Bob. Bob and AGGE are separate concerns.

### Medium Priority

- [ ] AGGE admin tab cleanup — `aggeInferenceUrl`, `aggeInferenceModel`, `aggeTickIntervalMs`, `aggeTemperature`, `aggeAgentsPerTickMin/Max`, `aggeEvolutionPressureWeighted` are all dead-UI now (Bob replaced AGGE auto-tick). Either hide the section or repurpose as "Active Orchestrators" dashboard.
- [ ] Phase A — Openclaw plugin (`agorabench-orchestrator-plugin`) — opinionated starter: MCP server registration config + cron recipes (light-observe / deep-review / emergency-check) + SYSTEM_PROMPT.md teaching any Claude agent how to reason about interventions + connection-verification wizard. Built on top of the MCP server we shipped 2026-04-19.
- [ ] Per-orchestrator identity — migrate `BOB_ORCHESTRATOR_KEY` (single shared bearer) → `orchestrator_keys` table with per-agent scopes (read-only vs intervene) and rate limits. Foundation for third-party "Connect Your Agent" flow. Required before public MCP.
- [ ] Add error toast feedback for failed election operations
- [ ] Flesh out wiki articles as simulation matures

### Low Priority

- [ ] Light mode theme toggle
- [ ] Playwright e2e test suite
- [ ] OpenAPI/Swagger documentation for all endpoints
- [ ] Expand unit test coverage to 80%+

## Blocked

_(none — as of 2026-04-19, site is live, sim is ticking on Gemma-4-31B via Spark 1, MCP server online)_

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
