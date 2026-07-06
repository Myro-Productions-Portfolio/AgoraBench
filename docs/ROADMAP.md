# AgoraBench Master Roadmap

*2026-07-05 — the complete plan from here to the end goal. Written by the architect session (Fable 5) off two verified research waves (15 Sonnet agents, ~120 findings, all fact-checked); intended to be implemented epoch-by-epoch by Opus 4.8 without re-deriving intent. Specs carry the detail; this doc carries the shape, the order, and the reasons.*

---

## The goal (the one-sentence version of everything)

**An AI-run government simulation, seeded 1:1 from US reality, that diverges freely from a fixed baseline while ingesting the same exogenous world as the real one — so a live scoreboard can show, metric by metric, whether AI governs better than humans.**

Doctrine that every future decision inherits (from `docs/DIVERGENCE_EXPERIMENT.md`):
1. Baseline 1:1, then never sync endogenous state again.
2. Reality is the control group — pulled into a reference pool, compared, never injected.
3. Exogeneity test for every input: *did the government cause it, or did the world do it to them?* World → inject. Government → hands off.
4. Everything government is AI's job (eventually down to mayors); everything else is the world model — data-driven where the world is shared, stochastic-with-real-parameters where the sim's divergent state requires simulation.

## Spec index

| Spec | Covers | Status |
|---|---|---|
| `DIVERGENCE_EXPERIMENT.md` | Fiscal core: mandatory lane, debt engine, T0 seed, reference pool, /divergence page | **Spec approved-pending-3-flags; implement first** |
| `specs/exogenous-reality-feed.md` | World-event ingestion: USGS/NWS/FEMA tier-1 (live-verified), GDELT/FRED tier-2, pipeline, injection channels | Spec complete |
| `specs/observability-and-metrics.md` | The scoreboard: metric registry, 12 launch metrics in readiness tiers, 10-K narrative reports | Spec complete |
| `specs/simulation-completeness.md` | Government-side gap matrix (17 channels audited); elections fix, CR/shutdown, executive package, administrative state, algorithmic Fed | Spec complete |
| `specs/world-model.md` | Macro engine (real parameters: Okun −0.45, regime-switching Markov, state-dependent Phillips, CBO multipliers), Hawkes society events, cohort population, voter graph | Spec complete |
| `specs/tick-engine-v2.md` | Bull job-graph DAG, agent agendas, LLM semaphore — resolves the pending architecture decision | Spec complete |
| `specs/agge-v2.md` | AGGE as world engine: Bob untangling, event curation, behavioral gravity, document imperfection | Spec complete |
| `specs/government-vertical.md` | 5 real states + 1 city, FMAP/grants/preemption/Tiebout mechanics | Spec complete |
| `research/us-federal-spending-reality-reference.md` | The verified FY2025/26 numbers everything seeds from | Reference |

## The epochs

Dependency-ordered. Each epoch = a coherent shippable capability; slices within epochs are in the specs. **Bold** = the critical path to the first real scoreboard; the rest widen it.

**E1 — Divergence Core** *(spec approved, 3 owner flags default-resolved)*
Mandatory lane + debt engine (dark), T0 baseline seed, reality reference pool, /divergence v1 (fiscal metrics). Exit: the experiment is *running* — sim carries the real fiscal baseline and diverges measurably.

**E2 — World Events + AGGE Functions 0–1**
Feed adapters (read-only week first), `/world` page, AGGE untangled from Bob + curating injections (prompt channel first). Exit: agents live in the same world as reality, spectators see it.

**E3 — Government Completeness, small wins** *(parallel-capable with E2)*
Real election voting + double-position fix (one PR, pre-scoped), CR/shutdown mechanic. Exit: elections are real; scoreboard metric #8 unlocked; the two most embarrassing "placeholder" facts gone.

**E4 — Scoreboard v1**
Metric registry + tier A/B metrics (fiscal, legislative throughput, time-to-passage, approval trend), first AI-written 10-K report to the press room. Exit: the public product exists — sim vs humans, live.

**E5 — World Model** *(the big one)*
Macro engine → population cohorts → voter graph → sentiment + Hawkes society events → algorithmic Fed (from completeness spec). Exit: the sim has an economy that responds to governance; tier-C metrics (unemployment, inflation, GDP growth) go live; approval stops being synthetic.

**E6 — Executive Package + Administrative State**
EOs, emergency declarations (pairs with E2's events), enforcement dials; then agencies, rulemaking, confirmations. Exit: the executive branch has a real job; most day-to-day policy surface exists.

**E7 — Tick Engine v2** *(timing driven by the vLLM upgrade — slot anywhere after E1)*
Phase extraction → DAG runner → parallel branches → agent agendas → interval shrink toward living pace.

**E8 — Government Vertical**
5 real states + 1 city, intergovernmental money, FMAP, preemption, Tiebout migration. Needs E5 cohorts + E7 scheduling.

**E9 — AGGE v2 full + civic texture**
Behavioral gravity at full strength, document imperfection, media narrative loop, protest emergence (Hawkes, conditioned on sim state).

**E10 — Public platform**
Per-orchestrator identity (`orchestrator_keys`, scopes, rate limits), "Connect Your Agent," researcher data API. Prereq for anything public-facing beyond spectating.

**EXP-1 — The Social Economy** *(expansion pack; owner's Social-World project, way-later by design)*
The Time-Debt / Treatment Economy from `/Users/myro-pro/Documents/Claude/Projects/Social-World` (see `HANDOFF.md` + `the-idea-plain-english.md` there): power decoupled from wealth — leaders keep luxuries only while the people under them measurably flourish. Six-gauge Treatment Dashboard (retention, present-tense affordability, rest/burnout, growth, safety, did-the-builders-share), must-pass-every-floor (no averaging), measured at the bottom decile, anti-monopoly size multiplier, luxury-credit erosion with a circuit breaker, necessities permanently locked.
**Why it belongs here**: AgoraBench solves that project's own #1 unsolved problem — cold-start legitimacy. No real institution will volunteer to be audited; a simulated economy will. Once E5 exists (cohorts, firms-as-aggregates, social-state vector), the sim can instantiate treatment gauges over synthetic employers, and the AI government can *legislate the treatment economy into existence* — an A/B inside the divergence experiment: does the social economy beat the dollar economy on the social-state vector without wrecking the fiscal one? That is a genuinely novel experiment neither project can run alone.
Prereqs: E5 (population/firm aggregates), E4 (scoreboard to judge it). Design doc to be written fresh at that time against the Social-World artifacts (which also carry its honest prior-art critique — read `prior-art-reality-check.md` before designing).

## Standing backlog (not epic-shaped; schedule opportunistically)

- Tax-ratchet cooldown decision (agents ratcheted 4%→23% in 48h; owner decision item in TODO.md)
- AdminPage tick-stage bar: "economy" stage has zero WS events mapped — can never light up (audit find)
- AGGE admin tab dead-UI cleanup (subsumed by AGGE v2 Function 0)
- Two undiagnosed dashboard console errors (pre-existing)
- UI revamp per `docs/design-briefs/` (owner-initiated when ready)
- Light mode, Playwright e2e, OpenAPI docs (long-standing low-priority)
- API keys to acquire when their epochs start: FRED (E2/E4), Census (E5) — both free; store in Vault + .env

## Handoff notes for the implementing model

- Every spec obeys the house rules: RuntimeConfig four-things rule, no raw ANY() arrays, router-level auth, whitelisted request fields, JSONB read-merge-write, migrations append-only. They are restated here because they each cost a production incident once.
- Deploy dark behind a flag, prove no-op by regression, then enable — the divergence spec's slice discipline applies to every epoch.
- Money-conservation invariants extend with every economic change (SFC sector-balance checks in E5); a payday tick must be re-verified after any Phase 12/13 edit.
- The sim's world must stay reproducible: all stochastic draws through the seeded per-tick PRNG (`world_state.rngSeed`).
- When in doubt about intent, the doctrine section above outranks convenience; the exogeneity test outranks everything.
