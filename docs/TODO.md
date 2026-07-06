# TODO - AgoraBench

Last Updated: 2026-07-05

## Recently Completed

- [x] 2026-07-05: First bi-weekly payday (tick 742) verified in prod TO THE DOLLAR — gross payroll $265,228 debited (Pres $15,384, Justices $11,792, Congress/chairs $6,692 = annual/26 exactly), withholding $50,377 at the 19% rate then in force remitted back as revenue (Phase 13), treasury delta = revenue − spending exact, `balance_after` reconstructs as a correct running net balance. The 4e7582e money-minting fix holds in production.
- [x] 2026-07-05: Fiscal clamps verified holding under $-scale proposals (PR-less, read-only check) — `spend_once` max stored $85B was within the 5%-of-treasury dynamic cap at proposal time; recurring bills stored at exactly 10%-of-revenue boundary values, proving the clamp actively fires; tax deltas all within ±2.
- [x] 2026-07-05: Judicial damages path verified on AB-723-1 (agent_dispute, 0–7 → respondent) — damages flowed loser→winner, amount = min(courtDamagesAmount, loser balance) under the config then in force ($50 pre-rebase; now $25,000 post-overhaul). The `struck` law-flip path remains unexercised — see Active Tasks.
- [x] 2026-07-05: Budget page charts fixed for dollar scale (PR #14, `675337a`) — compact y-axis labels via formatMoney, new `trimToCurrentEra()` helper (unit-tested, 325 suite green) drops pre-rebase MoltDollar points so the treasury chart no longer flatlines against one vertical jump, Revenue vs Spending bars use disclosed square-root scaling.

- [x] 2026-07-04: Economy overhaul built on branch `feat/economy-overhaul` (6 commits, 318→323 tests green, build clean). Full US scale: 330M population, $28T GDP, ~$1.5T treasury. All money columns → bigint (migration `0026_economy_bigint_rebase.sql`, idempotent-guarded data rebase `newBalance = 25000 + old×20`). New model: daily citizen tax revenue (GDP×rate/365 ≈ $13.8B/day) replaces the per-agent wealth tax; bi-weekly net-of-withholding payroll (real 2026 salaries, annual/26); election cash bonus removed; campaign filing + party fees now charged with ledger rows; currency display now plain `$`. New `formatMoney` shared formatter. Map "everyone in the Treasury" bug fixed (salary_payment unmapped). New agent Finances timeline (endpoint + tab). Budget/Dashboard/Admin UI rescaled. RuntimeConfig gained payPeriodTicks/gdpAnnual/agoraPopulation. NOT YET DEPLOYED — deploy steps: run migration, then `docs/deploy/economy-overhaul-config.sql`, then `pnpm run deploy`.
- [x] 2026-07-04: Judicial Phase 10 VERIFIED live in production — 6 cases filed across ticks 717–729, 4 decided through the full filing → hearing → deliberation → opinion → ruling lifecycle. Task #21 closed.
- [x] 2026-07-04: Regression tests for `judicialParsing` + `courtMath` — 90 tests added, commit `0df49d3`, full suite 288 green. Task #12 closed. Gap remaining: majority-tally and damages math are inline in `agentTick.ts` Phase 10 and still untested directly — see Active Tasks.
- [x] 2026-07-04: Task #22 data bugs fixed and deployed (`2830526`, `58e2013`) — `totalSeats` now derives from `runtimeConfig.congressSeats` instead of a hardcoded 50; `BranchCard` has a proper vacant state and takes an `icon` prop (the `/images/branches/*.webp` hardcode is gone); `WS_EVENTS` rebuilt from the 38 actually-emitted events; `ElectionBanner` null `targetDate` was already handled correctly.
- [x] 2026-07-04: Dashboard `ElectionBanner` wired to real election data via a shared `useActiveElection` hook; banner hides when there's no active election. Commit `c2c9848`, deployed.
- [x] 2026-07-04: `moltgovernment.com` now 301-redirects to `agorabench.com`, preserving path + query — app middleware (`0d3997a`) + `agora-bench` tunnel ingress + proxied CNAMEs. Old Clerk CNAMEs and junk DNS records deleted. Domain registration runs to 2027-02-17 — redirect dies then unless renewed (see Active Tasks).
- [x] 2026-07-04: Dead `mac-mini-homelab` Cloudflare tunnel retired; its 16 DNS records deleted (snapshot kept at `/Volumes/DevDrive-M4Pro/Backups/homelab/` on the dev Mac). Vaultwarden was already deliberately retired 2026-05-23; owner confirmed its DB is not needed.
- [x] 2026-07-04: Off-box DB backups automated — `agorabench-offbox` systemd user timer (10:00 UTC daily) rsyncs nightly pg_dumps to `bobclaw:/Volumes/NetworkBackup/Backups/agorabench/`, 90-day retention, size-verified; first run confirmed.
- [x] 2026-07-04: Owner deleted the 10 auto-minted Cloudflare tunnel API tokens himself.
- [x] 2026-07-04: `/privacy` and `/terms` reviewed — accurate and final, not template text.
- [x] 2026-07-04: Repo hygiene — 6 stale worktrees, 11 merged branches, 1 stale remote branch removed; the 2 old Linux-clone stashes archived to the dev Mac's Backups then dropped.
- [x] 2026-04-19: MCP server live at `https://agorabench.com/mcp` — Streamable HTTP transport, bearer-gated with the existing `BOB_ORCHESTRATOR_KEY`. Exposes three tools: `observe_simulation`, `intervene`, `get_history`. Any MCP-compatible client (Openclaw/Bob, Claude Desktop, Cursor) can connect with one config block. Shared logic at `src/modules/admin/server/lib/orchestratorCore.ts` — both REST routes and MCP tools call it, so they can't drift apart. `@modelcontextprotocol/sdk@1.29.0` (stable). Verified initialize handshake + tool discovery end-to-end through Cloudflare tunnel. Bob's briefing at `bob/projects/agorabench/README.md` on Openclaw updated with MCP section (section 10).
- [x] 2026-04-19: Gemma-4-31B live on Spark 1 as sim inference — migrated off Qwen3-VL-32B-AWQ on Spark 2. vLLM container `vllm-reasoning` on bspark1, bf16 unquantized, served as `gemma-4-31b` on port **1234** (docker port-map, not 8000). Runtime config updated: `simInferenceUrl=http://10.0.0.69:1234/v1`, `simInferenceModel=gemma-4-31b`. Per-call latency ~12-17s (vs 3-4s for Qwen AWQ); PyTorch warned GB10 CUDA cap 12.1 > supported 12.0 but generation works. Spark 2's `sglang-qwen3vl` stopped. Pure text-only vs Qwen3-VL's vision-tuned variant.
- [x] 2026-04-19: Sim tuning for Gemma speed — withdrew 25 of 30 stale floor bills (Apr 11 backlog, tick had been stuck in Phase 1 whip signals for days), closed 27 in-flight `tick_log` rows going back to Apr 6, bumped `tickIntervalMs` from 30 min → 90 min. Fresh tick post-fix is now progressing cleanly through phases on Gemma.
- [x] 2026-04-19: Bob orchestrator handoff complete — AGGE auto-tick stays disabled (`BOB_ORCHESTRATOR_KEY` set), AGGE admin tab controls confirmed dead-UI (do not affect Bob). Bob briefing file dropped in Openclaw workspace at `bob/projects/agorabench/README.md` with full API reference (REST + MCP), auth details, cadence suggestions, guardrails, first-boot checklist.
- [x] 2026-04-19: Repo cleanup — deleted 76 stale remote branches on Gitea (71 fully merged + 4 stale unmerged design/AGGE branches from Feb), 12 local branches on dev machine, 11 on Linux box. Both remotes and both workstations now on `main` only. GitHub portfolio mirror also brought current (was 1 commit behind).
- [x] 2026-04-10: Congress context activated — set CONGRESS_API_KEY in .env on Linux box, restarted server. congressContext.ts now fetches real US Congress bills (119th Congress, AI/tech keywords, 90-day window) and injects them into agent system prompts as "Real-World Congressional Activity". Verified no "not set" warnings after initial startup race condition.
- [x] 2026-04-10: Agent pool expansion 10 → 30 — seeded 20 new agents via scripts/seed-expansion-agents.ts, distributed 4 per alignment across all 5 parties, routed through bspark2 vLLM. Tick timing validated within the 15-min cron window across multiple ticks. Phase 14 auto-fill verified seating new agents.
- [x] 2026-04-10: Elections pipeline fix — force-advance now delegates to a shared `finalizeElection(electionId)` helper (`src/modules/elections/server/finalizeElection.ts`), fixing NULL winners / no-position bugs. Terminal state unified to `certified`. Phase 14 auto-fill added for congress vacancies.
- [x] 2026-04-10: Simulation verified running on bspark2 with Qwen2.5-32B-Instruct-GPTQ-Int8, zero cron drift, ~356s avg tick.
- [x] 2026-04-07 and earlier: Inference URL/model preset dropdowns, bspark2 inference fix, AGGE model fix, OpenClaw config repair, Cloudflare cache-TTL fix, SidebarCard key fix, api.ts content-type guard, Logs drawer, admin layout fixes, GitHub remote sync, cloudflared boot-enable, AGGE admin controls, CLAUDE.md deploy doc fix, wiki drawer + nav redesign + 20 wiki articles, Dynamic Weight Engine (10 phases) + smoke test, floor activity mechanics, admin election endpoints, tick phase broadcast, next-tick countdown, Bob orchestrator API, AGGE/Bob auto-tick gating. (Full detail in git history if ever needed — collapsed here to keep this file scannable.)

## Decisions (do not re-propose)

- **Claude Design (claude.ai/design) iteration for the UI revamp is SHELVED.** Owner decided design happens directly in code; `docs/design-briefs/` is the intent spec to build from. The design project is kept only for genuinely new pages in the future, not as the primary revamp workflow.
- **No notification channel for `agorabench-watch`.** Owner explicitly declined one. Log-only is the final state — do not propose adding alerting for it.
- **bobclaw's 100Mbps ethernet link is a known, parked issue.** Diagnosed as 2 dead pairs to the gateway's port 1; re-seating the cable didn't fix it. Suspects: router jack or cable. Owner parked it deliberately — do not re-raise unless asked.

## Active Tasks

### High Priority

- [ ] Watch for the first `struck` outcome in production and spot-check the law flip (`isActive=false` + `law_struck_down` event, `agentTick.ts:~3855`). The damages/tally half of this item was verified 2026-07-05 on AB-723-1; only the strike-down branch remains unexercised (11 decided cases so far: 8 upheld, 2 dismissed, 1 respondent).
- [ ] **OWNER DECISION — economy has no spending side at scale.** Revenue is ~$14–17.6B/day; outflow is bi-weekly payroll (~$265k) plus nothing. Treasury grows ~$16B/tick unbounded ($1.77T and climbing), and agents are responding by *raising taxes* — ten "treasury stabilization" revenue acts ratcheted the rate 4% → 23% in 48h. Recurring spending programs exist as a mechanic (cap $8.8B/day) but none has been enacted yet; several $1.4–1.8B/day proposals are on the floor. Options when ready: let the sim discover spending on its own, seed a baseline program, or have AGGE inject a fiscal-pressure event. Related: consider whether the tax-rate ratchet needs a cooldown clamp (one revenue act per N ticks).
- [ ] UI revamp per `docs/design-briefs/` (01 broadcast dashboard, 02 hemicycle votes, etc.) — implemented directly in code per the shelved-Claude-Design decision above. Start when owner initiates.

### Medium Priority

- [ ] Reality injection phases 2+3 — Phase 2: broader real-world feeds (economic indicators, news, public opinion) as additional context block builders following the congressContext.ts pattern. Phase 3: MCP-based tool use where agents actively query external sources during decision-making. Design spec not yet written.
- [ ] Real election vote casting — agents currently don't vote in elections at all. `finalizeElection()` picks a winner from `campaigns.contributions` as a placeholder. Needs a dedicated vote-casting phase in the tick where eligible agents make an LLM decision and write to the `votes` table, then swap the tally source in `finalizeElection()` to `SELECT candidate_id, COUNT(*) FROM votes ... GROUP BY candidate_id`.
- [ ] Resolve double-position state — an agent can currently hold both a Congress seat and a higher office (e.g. President) simultaneously. Decide whether winning a higher office should vacate the lower one in `finalizeElection()`. Now has a visible payroll consequence: on the tick-742 payday sam-ritter drew THREE salaries (president + committee chair + congress member) and desmond-park two (chair + member) — payroll pays per position held, so resolving this also fixes multi-dipping paychecks.
- [ ] AGGE visibility — no way to see if personality adjustments are actually happening. Need intervention history visible on the Agent profile page (personalityMod history: what changed, when, why).
- [ ] AGGE re-enable — remove the `BOB_ORCHESTRATOR_KEY` gate so AGGE runs on its own interval independent of Bob; they're separate concerns.
- [ ] Per-orchestrator identity — migrate `BOB_ORCHESTRATOR_KEY` (single shared bearer) → an `orchestrator_keys` table with per-agent scopes (read-only vs intervene) and rate limits. Foundation for a future "Connect Your Agent" flow. Required before making the MCP server public.

### Low Priority

- [ ] Light mode theme toggle
- [ ] Playwright e2e test suite
- [ ] OpenAPI/Swagger documentation for all endpoints
- [ ] Expand unit test coverage beyond current 288

### Pending expiry decision

- [ ] `moltgovernment.com` registration expires 2027-02-17 — decide then whether to renew (keeps the redirect to agorabench.com alive) or let it lapse.

## Blocked

_(none as of 2026-07-04 — site is live, sim is ticking on Gemma-4-31B via Spark 1, MCP server online, judicial Phase 10 verified live)_

## Master Roadmap

**`docs/ROADMAP.md` is now the authoritative plan** (2026-07-05): goal, doctrine, 10 epochs + Social Economy expansion, full spec index under `docs/specs/`. The two "Architecture Decisions Pending" below are now RESOLVED by specs — kept for history: AGGE v2 → `docs/specs/agge-v2.md`; Tick System v2 → `docs/specs/tick-engine-v2.md` (Bull job-graph hybrid chosen).

## Architecture Decisions Pending (RESOLVED — see Master Roadmap above)

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
