# Assessment: AgentSociety Integration — Evaluated and Not Recommended

*2026-07-13 — owner surfaced a proposal (third-party AI analysis) to wire Tsinghua FIB Lab's AgentSociety as a "population service" behind a JSON contract: AgoraBench emits enacted-policy deltas, AgentSociety runs a citizen population forward and returns sentiment/unemployment/inequality as constituent pressure. Researched fresh (web, 2026-07-13); verdict below. The proposal's* seam *is right — its* engine *is wrong, and we already own a better one (`world-model.md`, spec complete).*

## 1. What the proposal got right

- **The seam**: enacted policy → population dynamics → aggregate pressure → next-cycle campaigning is exactly the feedback loop AgoraBench needs. This is our roadmap's **E5** (`ROADMAP.md`: macro engine → cohorts → voter graph → sentiment/Hawkes; "approval stops being synthetic").
- **Contract-not-merge**: two systems behind a typed interface is the correct integration shape for any population engine.
- **Compute honesty**: "most citizens should be statistical, LLM only for a sample" — which is precisely our `world-model.md` §4 design, taken to its conclusion (cohorts all the way, LLM for zero citizens).

## 2. Why AgentSociety specifically fails the fit test (researched 2026-07-13)

| Claim in the proposal | Reality |
|---|---|
| "AgentSociety has the city/economy engine" | Only **v1** (legacy, sparse maintenance since ~2025) has the economy agents (Firm/Bank/Government/NBS). **v2** — the actively developed line (v2.8.2 released 2026-07-12, weekly cadence) — is a research-workflow orchestrator that **removed the economy, the city simulator, and those agent types entirely**. |
| "Consumes policy deltas as environmental changes" | **No runtime policy-injection API exists in either version.** v1's control surface is message-interception middleware ("supervisor") + scenario config at launch; v2's REST API is read-only replay/metadata. A `set_tax_rate()` contract would be a bespoke fork. |
| "Emits population state: sentiment, unemployment, inequality" | v1's paper explicitly states it does **not** model the labor market or unemployment. Aggregates it does produce (GDP, consumption, working hours via NBSAgent) export via Postgres/Avro dumps, not a live API. |
| "Runs on the second Spark" | Only published scale point: 30k agents on **24× A800**. No small-N single-box numbers exist anywhere; spark2 (GB10, thermal caveat, ComfyUI duty) is unproven for this and would need original benchmarking. |
| "A few focused sessions" | Realistic shape: fork v1 and fight the MOSS city-simulator dependency + build both contract adapters + build the missing unemployment model — or build economics from scratch inside v2. Either path is a project, not plumbing. |

Other verified facts: Apache 2.0 (one `commercial/` folder excluded) — free to mine; LLM layer is litellm (OpenAI-compatible, would speak to our vLLM endpoint fine — the one thing that "just works"); messaging is Redis pub/sub + Ray actors; no first-class mixed LLM/rule-based agent mode.

## 3. The alternative we already own

`world-model.md` (spec complete, wave-2 research-verified parameters) produces **every metric the proposal promised**, LLM-free, auditable, conservation-checked:

- Unemployment: Okun coupling (−0.45) with hysteresis. Inflation: state-dependent Phillips. GDP: AR(1) over NBER-calibrated regimes. Sentiment: lagged endogenous function with a live UMich comparator. Inequality-adjacent: income-quintile cohorts, endogenous poverty/SPM and uninsured rates. Unrest: Hawkes self-exciting events conditioned on sim state. Constituent pressure: the Democracy-4-style voter graph → approval/turnout/vote choice.
- Policy coupling is already designed (CBO multipliers, PolicyEngine parameter/variable split), and the clock problem doesn't exist — it's in-process with the tick, not a second free-running simulation.
- §4 hard rule, reaffirmed by this assessment: **citizens as cohorts, never as LLM agents** (the SimCity-2013 trap). AgentSociety is that trap at research scale.

## 4. What to salvage

1. **Priority signal**: independent analysis converged on the same missing piece — E5 is the highest-value next epoch after the fiscal loop. The divergence experiment already gives it live consumers (approval loop, ballots, elections).
2. **Mining rights**: Apache 2.0 — v1's Taylor-rule BankAgent and NBSAgent prompt/aggregation patterns are legitimate references when building `world-model.md` Layer 1 / the completeness spec's §D Fed.
3. **The one defensible LLM-citizen idea** (not in any spec yet, deliberately small): a *vox-pop panel* — ~20 sampled personas conditioned on cohort state, quoted in the Press Room/Gazette for spectator flavor. Physics stays in cohorts; the panel is a rendering layer. Park as a candidate feature for after E5 Layer 4, owner's call.

## 5. Recommendation

**Reject AgentSociety adoption** (both versions, both as dependency and as fork). **Build E5 per `world-model.md`** when the owner greenlights it — Layer 1 (macro engine) first: it is self-contained, immediately feeds the live fiscal-consequence loop, and every later layer (cohorts, voter graph, Hawkes) composes on top. Re-evaluate external frameworks only if E5's native build hits a wall the spec didn't anticipate.
