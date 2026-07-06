# Spec: The Government Vertical — States and Cities

*2026-07-05 — "anything government-related is AI's job," down through governors and mayors. Research-grounded (wave 2, federalism lens). Late-roadmap: depends on Tick Engine v2 (agent count) and the World Model's cohort layer (state dimension). Everything here is sized so the implementing model knows what reality it must match.*

## Why this tier matters (the numbers)

State + local government is not a footnote — it's a **second government the size of the first**: ~$6.06T/yr spending (20.7% of GDP vs the federal ~23%), 20.3M employees vs 3M federal civilian (local alone is 14.4M — teachers, police, fire are local jobs), and 90,887 distinct governments (50 states, 3,031 counties, 19,491 municipalities, 16,214 townships, 12,546 independent school districts, 39,555 special districts) electing ~519,682 officials. A sim claiming "AI runs the government" that stops at Congress models less than half of American governance. Function split matters for realism: education is overwhelmingly LOCAL ($1.07T of $1.5T), healthcare overwhelmingly STATE ($1.17T of $1.43T — Medicaid), police majority-local, pensions majority-state.

## Scope decision: real states, few of them

Three options considered; recommendation is (b):
- (a) one aggregate "The States" bloc — cheapest, but nothing to compare against reality and no interstate politics;
- **(b) 5 real states, seeded 1:1 from their real budgets** — CA (huge, expansion-state, 50% FMAP floor), TX (huge, non-expansion), FL, NY, OH (midwestern bellwether). Real states mean the scoreboard extends naturally: sim-CA vs real-CA budget divergence, using the same Census/NASBO data that seeds them;
- (c) all 50 — pure cost, no additional experimental power; never before public scale.

Plus, one tier down and later: **one city** (a real mid-size city with a mayor/council), primarily to exercise the local mechanics (off-cycle elections, Dillon's Rule) rather than to model municipal America.

Agent load: governor + 4 legislators per state + mayor + 2 council = ~27 new agents (~doubling the sim). This is why the tier waits for Tick v2's scheduling + the vLLM speedup — agents idle unless their tier has business.

## Mechanics that must exist (each is a real, sourced structure)

1. **Intergovernmental money** — the defining feature. Federal grants ≈ $1.1T/yr (~17% of federal outlays) flow down; **34.2% of state budgets is federal pass-through** (NASBO FY2024: $3.06T all-funds state spending). Sim: federal grant programs become line-items both tiers see; the AI Congress can squeeze or fatten them, and AI governors feel it — the single richest source of inter-tier politics.
2. **Medicaid FMAP** — the formula lever: federal match 50–83% inversely tied to state per-capita income, flat 90% for ACA-expansion populations. Sim: per-state FMAP variable + an `expanded: bool` each state's legislature can flip — a real, consequential state-level decision with measurable budget effects (the real expansion/non-expansion uninsured gap is 18.1% vs 9.0%).
3. **Preemption & Dillon's Rule** — the authority axis. Per-state config: Dillon (locality has only delegated powers) vs home-rule; a state-tier *preempt* action that overrides city policy. This is live real-world politics (states aggressively preempting local zoning/safety ordinances) and cheap to model.
4. **Election cadences** — realism texture with teeth: 36 governors elect in the 2026-cycle years, NH/VT run 2-year terms, ~⅔ of municipalities vote off-cycle — and off-cycle timing empirically halves turnout (~29% on-cycle vs ~13.3% off-cycle mayoral) with documented representation effects. Sim: election timing is a *policy variable* the vertical exposes, not flavor.
5. **Tiebout migration** — the world-model hook: population cohorts (world-model Layer 3, which carries a state dimension from day one) slowly migrate toward preferred tax/service bundles — states compete, and bad AI governance loses residents (and tax base). Polycentricity lesson baked in: fragmentation vs consolidation is a genuine tradeoff, never hardcode "centralized = efficient."
6. **Unfunded mandates** — federal bills that impose state costs without funding trigger state pushback (legal challenge via the existing judicial arc, or approval penalties from a states bloc) — connects the tiers' legislatures.

## Data plumbing (verified sources)

- Census `api.census.gov/data/timeseries/govsstatefin` (2012–2024, state finance by function; **API key now mandatory** — same key as the world model's ACS pulls).
- NASBO State Expenditure Report for the budget-office frame (K-12/higher-ed/Medicaid/corrections/transportation/other — adopt these six as the state ledger's category schema). PDF/account-gated; periodic manual refresh, not a live feed.
- **Accounting-frame warning for the seed script**: Census counts consolidated state+local net of transfers; NASBO counts state budgets *including* federal pass-through. Never mix frames in one comparison — pick NASBO for the state ledgers, Census for the scoreboard.
- County tier: deliberately absent (CT/RI have no functional county government; New England makes "county" optional-by-region). Not modeled.

## Comparability payoff

Each sim state publishes the same scoreboard as the federal tier: budget balance, category mix vs its real counterpart, Medicaid decisions, election turnout. "Sim-Texas expanded Medicaid in month 3" is exactly the kind of divergence headline the experiment exists to produce.
