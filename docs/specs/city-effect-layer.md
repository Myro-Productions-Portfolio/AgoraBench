# Spec: Capitol City — the Visible Effect Layer (Micropolis fork)

*2026-08-16 — owner direction locked: Micropolis-first (OpenTTD parked as a later agent-played spectacle). Research basis: `game-effect-layer-research.md`. Doctrine basis: `agentsociety-assessment.md` + world-model spec. Working name "Capitol City" — owner may rename.*

## 1. What this is

One representative city, rendered live on agorabench.com, whose fate is driven by the AI government's choices. A synecdoche: the sim is federal-scale; the city is where spectators *watch* the consequences. Long-term it becomes the spatial body of the E5 world-model — cohorts get districts, resource flows get streets — but it is **never a second source of truth**.

**Hard seam (non-negotiable, from the AgentSociety verdict):** data flows one way, AgoraBench → city. Nothing computed inside the city engine feeds approval, elections, the macro state, or any agent prompt. The truth about whether laws benefit constituents lives in the world-model (macro engine now; cohorts/voter graph later). The city renders that truth; it does not produce it.

## 2. Architecture

```
agentTick (90 min)                      spectator browser
  └─ macro engine state ──┐                  ▲
                          ▼                  │ GET /api/city/state (read-only, public)
                   city driver               │
              (mapping table, §3)            │
                          ▼                  │
                micropolis engine ──► city_state row (Postgres)
             (vendored JS, headless,         └─ city_snapshots (per-tick history
              in-process, deterministic)         → timelapse feature)
```

- **Engine:** fork the `micropolisJS` simulation core (GPL-3.0) into `src/modules/city/engine/`, stripped of DOM/UI code, patched headless (the Hallucinating Splines project proved ~4 small patches suffice — use as reference, take no dependency on it). Plain TS/JS, runs **in-process** with the backend; the 1989-era sim is computationally trivial next to our LLM calls.
- **Clocking:** the city advances **only on the government tick** — `cityMonthsPerTick` city-months per gov tick (default 1). No free-running clock: keeps causality legible ("this tick's budget → this month's city"), keeps runs deterministic/replayable, and avoids the AgentSociety clock problem by construction.
- **Persistence:** full engine state (tile map + valves + funds + RNG seed) serialized to a `city_state` single-row table each tick; compressed snapshot appended to `city_snapshots` (map is ~120×100 small ints — a few KB gzipped; verify exact dims against engine source in slice 1). Snapshots power the timelapse ("the city across administrations") — a marquee spectator feature that costs almost nothing to capture from day one.
- **Licensing posture:** GPL-3.0 engine stays **server-side only** — running GPL code on a server triggers no source-distribution obligation (that is AGPL's domain; verify once during slice 1). The browser gets a **from-scratch thin renderer** (tile array → canvas) so no GPL code enters our client bundle. City *state/output* on the public site is unencumbered.

## 3. The driver — macro state → city knobs (MVP mapping table)

All couplings read state that exists in production today. Exact engine knob names/ranges verified against source in slice 1; the mapping lives in one module (`src/modules/city/driver.ts`) as a declarative table, not scattered constants.

| Sim state (exists now) | City knob | Shape |
|---|---|---|
| tax rate | city tax rate (0–20 native range) | direct, clamped |
| budget allocation: public safety share | police + fire funding % | proportional to share vs. baseline |
| budget allocation: infrastructure/transport share | roads/transit funding % | proportional to share vs. baseline |
| GDP growth + regime | R/C/I demand valves | expansion lifts valves; recession suppresses |
| unemployment | residential demand + growth damping | high u → out-migration pressure |
| shock impulses (macro §2.6) | (MVP: none) | disasters wired in Phase 2 from Layer 2 events, not before |

Anything without a row here **intentionally no-ops** — the curated-whitelist principle from the research doc. No bill-text NLP, no LLM anywhere in this system.

## 4. Spectator surface (MVP)

- New top-level page/tab: live city map (custom canvas renderer), population/funds/service-level stat strip, and a "this tick" delta line ("Tax 34% → roads funded at 80% → traffic worsening in the east district").
- Read path: `GET /api/city/state` (public, read-only, no auth — same class as other public sim reads) returning tile array + stats + last-tick deltas. Poll on load + on tick; WebSocket later if wanted.
- Feature-flagged dark: `cityEnabled` RuntimeConfig field, default off. **RuntimeConfig rule applies: server handler branch + AdminPage control + client interface + persistence check, same commit** (fields: `cityEnabled`, `cityMonthsPerTick`).

## 5. Phases

- **MVP (this spec, slices below):** engine vendored headless + driver + persistence/snapshots + spectator page, dark.
- **Phase 2 — law flavor:** curated per-category law hooks (infrastructure law → visible road/transit funding boost; public-safety law → police/fire; disaster events from world-model Layer 2 → engine disasters), Gazette cross-references.
- **Phase 3 — E5 convergence (the owner's "real Sim Society"):** when Layer 3 cohorts exist, assign cohorts to city districts — income quintiles become neighborhoods, poverty/uninsured rates become visible district decay/renewal. This is where "did the laws benefit these humans" becomes literally watchable, with the cohort model still the truth underneath.
- **Phase 4 — our own subsystems:** trade goods / resource allocation as new engine physics (our code, our rules), coupled to macro + cohort state. First fully-invented subsystem per the Society-as-Physics-Subsystems north star.
- **Parked:** OpenTTD dedicated server + agent player ("infrastructure minister" spectacle, possibly a spark2 agent — thermal caveat stands). Re-open only after Phase 3.

## 6. Implementation plan (thin slices, each verified before the next)

Feature branch `feature/capitol-city`, PR per slice or one PR with slice commits — implementer's call. Coder subagents implement; each slice ends verified.

1. **Slice 1 — engine harness.** Vendor micropolisJS sim core into `src/modules/city/engine/`, headless patches, deterministic seed, serialize/deserialize round-trip. Deliverable: a script/test that boots a city, ticks 24 months, saves, reloads, resumes identically. Verify engine knob names/ranges + map dims; confirm GPL server-side posture. No app wiring yet.
2. **Slice 2 — driver + persistence.** `driver.ts` mapping table, hook into `agentTick` behind `cityEnabled` (both RuntimeConfig fields with all four required pieces), `city_state` + `city_snapshots` migrations (new files only — never edit existing migrations). Deliverable: with flag on in a dev run, ticks advance the city and rows appear; flag off = zero behavior change.
3. **Slice 3 — spectator page.** `/api/city/state` public read endpoint, custom canvas tile renderer, stat strip + delta line, nav entry. Deliverable: page renders live state end-to-end in a dev run.
4. **Slice 4 — deploy dark + verify.** Deploy with `cityEnabled=off`, verify no-op in prod logs, then flip on via admin UI, watch 2–3 real ticks, screenshot for owner. Timelapse endpoint/UI can ride a later slice.

Estimate: slices 1–2 are the substance (engine surgery + coupling); 3–4 are routine for this codebase.

## 7. Explicitly out of scope

Game→sim feedback of any kind; LLM calls in the city path; per-bill text interpretation; multiple cities; OpenTTD (parked); letting sim agents *play* the city (they govern the nation — the city obeys physics).
