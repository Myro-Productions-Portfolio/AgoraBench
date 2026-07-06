# Spec: AGGE v2 — The World Engine

*2026-07-05 — resolves the "AGGE v2 — Reality Injection Layer" pending architecture decision in TODO.md. AGGE stops being a personality ticker and becomes the layer that plays "the world" against the AI government.*

## Role

The government is the agents'. The **world** — events, friction, consequences, gravity — is AGGE's. Four functions, sequenced below in build order. AGGE actions remain interventions with audit rows (`agge_interventions` exists), never silent state edits. Bob (external orchestrator) keeps override authority; the `BOB_ORCHESTRATOR_KEY` gating question is resolved by splitting concerns (function 0).

## Function 0 — Untangle AGGE from Bob (prerequisite, small)

Today `aggeTick` is disabled whenever `BOB_ORCHESTRATOR_KEY` is set — AGGE and Bob are treated as the same concern. Split them: new config `aggeEnabled` (bool, independent of the key; four-things rule). AGGE runs on its own interval; Bob observes/intervenes through the orchestrator API as a *peer* overseer. Also closes the TODO item "AGGE visibility": intervention history renders on agent profiles (personalityMod: what changed, when, why — data already in `agge_interventions`).

## Function 1 — Exogenous event injection (the divergence experiment's world-input)

AGGE is the *curator* of the exogenous feed (mechanics of ingestion/adapters live in `docs/specs/exogenous-reality-feed.md`):

- Reads the normalized `world_events` queue, applies the **exogeneity test** (world-caused → eligible; government-caused → reject, logged with reason) and a **materiality test** (would a national government notice?).
- Chooses impact channels per event (defined in the feed spec): prompt context, crisis/DWE modulation, fiscal-shock agenda item, emergency session. Never direct mutation of endogenous fiscal state.
- Budgeted: `aggeMaxEventInjectionsPerDay` (default 3) — a spectator sim drowning in news is noise, not drama.
- Every injection is an `agge_interventions` row + activity event, so the public feed shows "A magnitude 7.1 earthquake strikes California — Congress faces emergency relief demands" with provenance.

## Function 2 — Behavioral gravity

Agents currently act only when the pipeline pushes them. Gravity pulls them toward obligations their own actions created:

- Rule-driven (no LLM needed to *detect*): authored bill reached floor → owner should whip/defend it; program the agent sponsored lapsing next session → renewal pressure; case filed against your law → prepare arguments; election announced → campaign actions.
- Implementation: AGGE writes `agent_agenda` rows (table introduced by Tick Engine v2 step 4; until then, gravity injects into the agent's Phase 1/11.5 prompt context as "Your obligations this tick: …").
- The LLM is used only for *how* the agent responds, never whether the obligation exists.

## Function 3 — Document imperfection

Real governance is full of friction: ambiguous drafting, clerical errors, revision cycles. AGGE introduces bounded noise:

- On bill enactment, small probability (`aggeImperfectionRatePct`, default 5) the law text carries a flagged ambiguity → seeds future litigation (feeds the judicial arc — the sim's courts finally get a realistic case source beyond constitutional challenges).
- On fiscal provisions: never touch amounts (money stays exact); imperfection is textual/legal only. This keeps the divergence metrics clean.

## Function 4 — Personality nudges (v1 behavior, kept, now visible)

Unchanged mechanically (scheduled LLM pass adjusting `personalityMod` from behavior patterns), but: runs under `aggeEnabled`, capped per cycle, every nudge visible on the agent profile (Function 0), and nudges must cite the behavior pattern that triggered them in the intervention row.

## Explicitly out of scope for AGGE

- Anything the divergence experiment defines as endogenous (budgets, rates, program funding) — AGGE may create *pressure* (an event, an obligation), never the fiscal outcome itself.
- Editing agent memories/relationships directly.

## Config (all four-things rule)

`aggeEnabled` (bool, false until Function 0 ships), `aggeIntervalTicks` (1–48, def 8), `aggeMaxEventInjectionsPerDay` (0–10, def 3), `aggeImperfectionRatePct` (0–25, def 5), `aggeMaxNudgesPerCycle` (0–10, def 3).

## Build order & effort

0 (small, unblocks visibility TODO) → 1 (medium; pairs with the exogenous feed epic) → 2 (medium; full version wants Tick v2's agenda table but has a prompt-injection interim) → 3 (small) → 4 (already exists; polish only). LLM cost note: curation and nudges can run on the sim's local model — no cloud spend.
