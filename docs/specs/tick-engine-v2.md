# Spec: Tick Engine v2 — Branching, Parallel, Schedule-Driven

*2026-07-05 — resolves the "Tick System v2" pending architecture decision in TODO.md. Enabling infrastructure for near-1:1 living pace; NOT a blocker for the Divergence Experiment epochs, which run fine on the v1 sequential tick at 90-minute intervals.*

## Problem

The v1 tick is one sequential ~4,000-line function (`src/core/server/jobs/agentTick.ts`, 17 phases + AGGE). Every agent is pushed through every phase in lockstep; per-phase LLM fan-out uses `Promise.allSettled` batches (phases 1, 1.5, 1.7, 2, 3, 7, 10, 15–17), but phases themselves are strictly serial. Consequences:

- Tick wall-clock is the sum of all phases; at Gemma latency (~12–17s/call) that forced the 90-minute interval.
- Every agent does the same thing at the same time — no agent has a *schedule*; behavior is pipeline-shaped, not life-shaped.
- A hung phase stalls the whole tick (restart-safety exists via `tick_log`, but partial progress inside a tick is lost except where phases persist their own state, e.g. the judicial arc).
- New behaviors (press briefings, hearings, emergency sessions — behavioral gravity from AGGE v2) have nowhere to attach except "add phase 18."

## Decision: hybrid Bull job-graph, phases become jobs, agents get schedules

Chosen over (a) pure event-driven (too big a rewrite, hard to reason about money-conservation invariants) and (b) status quo (caps the living-pace goal). Redis/Bull is already in the stack — no new infrastructure.

### Architecture

1. **Phase DAG, not phase list.** Each v1 phase becomes a Bull job type with declared dependencies:
   - `whip → lobby → amend → vote → tally(2b,2c)` (the floor chain — genuinely serial)
   - `committee(3)`, `judicial(10)`, `forums(15-17)`, `elections(14)` — independent branches that today run serially but only depend on the tick snapshot, not each other → run concurrently.
   - `enactment(9) → fiscal(11-13)` — the money chain, runs after floor + committee; **stays strictly serial internally** (money conservation is verified against the ledger, concurrency here buys nothing and risks everything).
   - A `tick:complete` barrier job closes the tick (fiscal summary write, `tick_log.completed_at`) only after all branches settle.
2. **Agent task queue.** New table `agent_agenda` (`agentId, taskType, dueTick, payload, status`). Phases stop iterating "all agents" and instead drain agenda items: Phase 10 already works this way implicitly (cases advance stage-per-tick); this generalizes it. AGGE v2's behavioral gravity writes agenda items ("you authored the bill that passed — press briefing due tick N"); the engine routes them to the right job.
3. **Concurrency budget.** One global LLM semaphore (config `maxConcurrentLlmCalls`, default sized to vLLM throughput) shared across branches — branches interleave their calls instead of each phase bursting its own batch. This is where the upgraded-vLLM throughput (500–600 tok/s claim) converts directly into shorter ticks.
4. **Interval decoupling.** `tickIntervalMs` stays the *cadence*; a tick that finishes in 6 minutes just waits. Shrinking the interval toward 1:1 living pace becomes a config change once measured tick wall-clock allows.

### Migration path (each step deployable, sim never down)

1. **Extract phases to modules** (`src/core/server/jobs/phases/*.ts`), same execution order, agentTick.ts becomes an orchestrator that calls them serially. Pure refactor, regression suite must show byte-identical behavior on a fixture tick. *(Biggest single win for maintainability even if v2 stops here.)*
2. **Introduce the DAG runner** executing extracted phases with declared deps, initially with the serial-equivalent DAG (every phase depends on the previous) — proves the runner in prod with zero behavior change.
3. **Loosen the DAG**: parallelize the independent branches (committee ∥ judicial ∥ forums ∥ elections). Measure wall-clock.
4. **Agent agenda table + first agenda-driven behavior** (judicial arc converts, or a new AGGE behavioral-gravity task).
5. **Global LLM semaphore + interval shrink** as inference allows.

### Invariants that must survive

- Money conservation: fiscal summary = ledger delta per tick (extend existing checks; the fiscal chain stays serial).
- Restart safety: a crashed tick resumes or voids cleanly (`tick_log` open-row handling exists; DAG runner must persist job state in Bull, which it does natively).
- Single-writer: `agentTick` remains the only writer of sim state; branches touch disjoint tables (enforce by review + a table-ownership map in the phase module headers).

### Config (four-things rule applies)

`maxConcurrentLlmCalls` (1–64, default 8), `tickDagParallelismEnabled` (bool, default false — step 3's switch).

### Effort

Step 1 is the long pole (mechanical but wide). Steps 2–3 are contained. Recommend scheduling after Divergence epochs 1–2 ship, or opportunistically if vLLM upgrade lands sooner and the owner wants pace.
