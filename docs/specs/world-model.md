# Spec: The World Model — Everything That Isn't Government

*2026-07-05 — the non-government half of the gap analysis. Governments are played by AI agents; everything else — economy dynamics, population, disasters, social response — is this layer: data-driven where reality is shared, stochastic where the sim's divergent state requires simulation. All parameters below are research-verified with sources (wave-2, 2026-07-05).*

## 1. The causality decomposition (the core design decision)

Every non-government phenomenon is one of three kinds, and each kind gets a different mechanism:

| Kind | Examples | Mechanism |
|---|---|---|
| **World-caused** (no government could cause it) | earthquakes, hurricanes, foreign shocks, oil prices | **Real feed** (`exogenous-reality-feed.md`) — both governments face the identical world; this is what makes the comparison fair |
| **Government-coupled** (the world responding to *this* government's choices) | GDP growth, unemployment, inflation, sentiment, protests, migration | **Simulated** with empirically-parameterized dynamics — reality's numbers reflect the *human* government and cannot be injected; the sim computes its own from the same starting point |
| **Slow structural** (drifts regardless of who governs) | population aging, birth/death rates, technology | **Data-seeded trend processes** — ticked deterministically with small noise |

The randomness the owner asked for lives in kind 2: calibrated stochastic processes whose *parameters* come from US data, whose *shocks* are shared with reality where observable (a real oil spike enters both worlds), and whose *policy inputs* come from the AI government. Divergence in outcomes is then attributable to governance — which is the experiment.

## 2. Layer 1 — Macro engine (the sim's own economy dynamics)

Replaces the static `gdpAnnual=$28T` peg. State vector, ticked daily (parameters quoted at their native monthly/quarterly frequency; convert as `p_daily = 1 − (1−p_monthly)^(1/30)` for hazards, `φ_daily = φ_period^(1/days)` for AR coefficients):

**2.1 Business-cycle regime** — 2-state Markov chain (NBER postwar: expansions avg 64.2 months, contractions 10.3):
- `p(expansion→recession) ≈ 0.0156/month`, `p(recession→expansion) ≈ 0.0971/month`
- v2 upgrade (flagged, not v1): duration-dependent Weibull hazard — real expansions aren't memoryless (12–128 months observed)

**2.2 GDP growth** — AR(1) around regime-conditioned trend: `g_t = (1−φ_g)·g*(regime) + φ_g·g_{t−1} + policy_t + shock_t + ε`
- trend g* ≈ +2.25%/yr in expansion, negative in recession; moderate persistence (growth mean-reverts faster than levels)
- `policy_t`: fiscal impulse × multiplier (see 2.5); `shock_t`: decaying event impulses (see 2.6)

**2.3 Unemployment** — Okun coupling + near-unit-root persistence: `Δu_t = −0.45 × (g_t − g*)` (modern consensus coefficient; Ball/Leigh/Loungani), with AR(1) φ≈1 on the level (labor-market hysteresis — shocks are near-permanent on sim timescales).

**2.4 Inflation** — regime-dependent Phillips curve, deliberately non-linear per 2020s Fed research:
- normal times: slope ≈ −0.15 to −0.2 on the unemployment gap; **tight labor market (u < ~4%): slope steepens to −1.0 to −1.2**
- persistence: AR(1) φ ≈ 0.55–0.65 per quarter (half-life ~1.4 quarters); plus pass-through from shared real shocks (oil/commodities via the feed)

**2.5 Policy coupling** — how the AI government's fiscal choices move the macro state (CBO-parameterized):
- Government purchases multiplier: central **1.5** (range 0.5–2.5); targeted transfers/tax: 0.3–1.5
- **State-dependent**: multipliers largest in recession/near-zero rates, smaller in expansion (CBO methodology)
- Lag structure: effect builds over 2–4 quarters, substantially dissipates by 6–9 (VAR literature placeholder — the exact CBO quarter-by-quarter table 403'd to automated fetch; pull manually before hardcoding, flagged)
- The divergence-experiment debt engine feeds back: sim interest costs respond to the sim Fed rate (simulation-completeness §D Taylor rule) once this layer exists

**2.6 Shock propagation** — every impulse (disaster damage, policy change, shared world shock) decays as `X_t = ρ^t·X_0`: typical shock ρ ≈ 0.84–0.89/quarter (half-life 4–6 q); financial/supply shocks ρ ≈ 0.90–0.93 (half-life 6.6–9.5 q). Per-category ρ in config.

**2.7 Consumer sentiment** — NOT an independent process: a lagged function of the sim's own inflation/unemployment/shock state (research classification: sentiment is reaction, not cause). Reality-side comparator: UMich UMCSENT — free keyless pull via `fred.stlouisfed.org/graph/fredgraph.csv?id=UMCSENT` (live-verified; real 2026 data shows 56.6→44.8 collapse Feb–May — the scoreboard will have interesting material immediately).

**Conservation discipline (steal from SFC/Godley-Lavoie):** the macro engine keeps a sector-balance identity — households/firms/government flows must net to zero each tick, extending the existing fiscal-summary invariant into a full transactions-flow check. This is the bug-class killer (money appearing from nowhere), and it becomes a per-tick automated test.

## 3. Layer 2 — Synthetic event processes (sim-side society events)

Real-feed events cover nature. Society-reacting-to-government events must be sim-generated (real protests respond to the *real* government):

- **Arrival**: Hawkes self-exciting process `λ(t) = μ + Σ α·e^(−β(t−t_i))` — unrest clusters (one protest raises the near-term intensity of more). **Stability constraint enforced in code: branching ratio α/β < 1** (checked at config write, not just documented). Baseline μ conditioned on sim state: approval lows, unemployment, inflation raise μ (Democracy-4 "situations with inertia" pattern).
- **Severity**: composite distribution per event class — Lognormal(μ=9.04, σ=2.02) body with Pareto tail (α≈1.5) above the ~95th percentile (published composite methodology for disaster/loss severity; reuse for strike-scale, protest-scale).
- **Future-proofing**: the same machinery can synthesize *natural* disasters if the sim ever runs faster than real time or a feed dies — calibrations ready: US billion-dollar disasters λ≈20–23/yr (2020–24 avg; non-stationary, drift λ +2–3%/yr; NOAA product discontinued May 2025 → Climate Central is the continuation source), hurricane landfalls λ≈1.7/yr (0.6 major), damaging US quakes λ≈0.15–0.3/yr **region-gated** (CA/AK/PNW — spatial gating matters for quakes, not storms), FEMA declarations ≈125/yr as the all-in arrival comparator.

## 4. Layer 3 — Synthetic population (citizens as cohorts, never as LLM agents)

The SimCity-2013 lesson is a hard rule: agents only for things whose individual decisions are the point (officeholders); everything bulk is aggregate math (Cities-Skylines discipline). Citizens = **statistical cohorts**, not individuals:

- **Seed**: cohort grid (age band × income quintile × state) from Census ACS marginals + PUMS joint distributions via the standard IPF recipe (RTI SynthPop methodology; >0.99 validation correlations). **Census API now requires a free key for ALL requests (mandatory since 2026-05-11, live-verified 302 without one)** — one-time signup, store in Vault + .env.
- **Vital dynamics** (daily ODE): births 11.99/1000/yr, deaths ~8.1/1000/yr, life expectancy 79.0 — slow structural trends. **Net international migration is NOT exogenous**: it swung 2.7M→1.3M in one real year on policy alone (trending ~321k or negative in 2026) — so sim NIM must respond to the AI government's own immigration policy (a policy lever the sim doesn't have yet; parked in simulation-completeness backlog, but the population layer reserves the input).
- **T0 seed vector** (real, July 2026, all sourced): population 341.8M (**runtime config still says 330M — fix at seed**), unemployment 4.2% (Jun 2026), CPI +4.2% y/y (May 2026), median household income $83,730, poverty 10.6% official / 12.9% SPM, uninsured 8.3%, homicide 5.0/100k, sentiment 44.8. Poverty/uninsured are *endogenous* (the SPM-vs-official gap literally measures government-program effect; the 18.1%-vs-9.0% uninsured gap between Medicaid-expansion regimes proves policy causality) — they're sim-computed outcomes, reality-compared on the scoreboard, never injected.
- **What cohorts drive**: entitlement cost growth (the divergence spec's `mandatoryGrowthPctAnnual` gets real drivers: cohort aging × per-capita cost), tax base realism, unemployment incidence by cohort, and —

## 5. Layer 4 — The voter graph (Democracy 4 steal, LLM-free)

Approval today is synthetic per-agent numbers. Replace the *source* with a legible weighted graph:

- Nodes: voter groups = cohort cross-sections (e.g., seniors×middle-income, young×low-income) + issue nodes (inflation, jobs, healthcare, safety) + policy nodes (active laws/programs).
- Edges: signed weights policy→issue→group-happiness; macro state feeds issue nodes directly (inflation node reads Layer-1 CPI).
- Outputs: per-group happiness → aggregated approval per officeholder/party (weighted by salience), turnout propensity, and vote choice in elections (feeding simulation-completeness §A real voting — agents campaign, cohorts vote).
- Membership migration: policy outcomes shift cohort classification over time (D4's mechanism), giving slow realignment dynamics.
- Deterministic + noise; auditable ("why did approval drop" = graph trace); zero LLM cost. EconAgent's published result (memory-conditioned economic context in agent prompts beats rule-based) justifies ALSO feeding Layer-1 macro state into officeholder prompts — agents should see the economy they govern.

## 6. Patterns adopted from precedents (and rejected ones)

- **PolicyEngine's Parameter/Variable split** (adopt as pattern): a law's fiscal provision = a *parameter change* flowing through fixed formulas — AgoraBench's runtime-config-driven engines already lean this way; formalize new world-model knobs the same way. PolicyEngine-US itself (MIT, Python, API) is an optional later add-on for real tax/benefit computation per cohort — noted, not v1.
- **LLM Economist's anchoring** (adopt): agents proposing tax changes get real 2026 IRS bracket anchors in prompts — bounded deltas from reality, not free-form numbers. Also gives the scoreboard a citable benchmark (Saez optimal-tax comparison) for "did the AI tax better."
- **Concordia's GM-as-entity** (adopt conceptually): AGGE/Bob as addressable world-engine entities — already our architecture; keep rule-adjudication introspectable.
- **Rejected**: OG-Core's general-equilibrium solver (overkill; steal the cohort idea only), Mesa/EURACE wholesale (scaffolding/theory mined, not imported), per-citizen agents (SimCity trap), AI-Town's continuous chat loop (wrong cadence).

## 7. Implementation shape (for the implementing model)

New module `src/modules/world/`: `server/macroEngine.ts` (pure functions: state vector in/out per tick — exhaustively unit-testable, the whole point of parameterized math), `server/populationEngine.ts` (cohort table + ODE), `server/voterGraph.ts`, `server/eventProcesses.ts` (Hawkes/Poisson samplers with the α/β<1 guard), DB: `world_state` (one row per tick: full macro vector), `population_cohorts`, `voter_groups`. Tick integration: one new deterministic phase (no LLM) before Phase 11, so proposal prompts read fresh world state. Every parameter above = RuntimeConfig field (four-things rule) grouped under a `world*` prefix; defaults exactly as quoted here with the source in the field comment. Random draws use a seeded PRNG stored per tick (`world_state.rngSeed`) so any tick's world evolution is exactly reproducible — a debugging and replay requirement, and the workflow-resume lesson applied to the sim itself.

Build order: macro engine (static population) → cohorts + vital ODE → voter graph swap-in for approval → sentiment + society-event Hawkes → PolicyEngine/Fed integrations. Each stage runs dark behind `worldModelEnabled` and ships with its invariant tests before the next begins.
