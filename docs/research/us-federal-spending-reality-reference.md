# US Federal Spending — Reality Reference for AgoraBench

*Research report, compiled 2026-07-05*

---

## 1. Executive Summary

Real US federal outlays for FY2025 came in at $7.01 trillion against $5.23 trillion in receipts, a $1.775-1.8 trillion deficit — roughly 23.1-23.3% of GDP spent against 17.5% collected. CBO's February 2026 baseline projects FY2026 outlays at $7.4 trillion (23.3% of GDP). The single biggest structural fact for a sim to internalize: only about a quarter to a third of that spending is discretionary — subject to an annual congressional vote at all. The rest (Social Security, Medicare, Medicaid, other mandatory programs, and net interest) grows automatically under permanent law, with no bill and no vote required, and mandatory-plus-interest spending in FY2025 was large enough to roughly equal total revenue — meaning every dollar of discretionary spending Congress appropriates is, structurally, borrowed money. The best live data source by a clear margin is the Treasury Fiscal Data API (`api.fiscaldata.treasury.gov`) — no auth, plain GET requests, self-describing JSON, and its Monthly Treasury Statement Table 9 gives a ready-made 20-category spending breakdown that reconciles almost exactly to CBO's official top-line. AgoraBench's current fiscal engine has real problems representing this reality: it has exactly three provision kinds (one-time spend, recurring spend, tax change), all proportional to treasury/revenue rather than fixed dollars, but it has **no mandatory-spending concept at all** — every recurring program must be actively re-authorized every budget cycle or it lapses, the exact inverse of how real entitlement spending works — and its own math caps total recurring program spend at roughly half of what a GDP-scaled comparison to real federal outlays would require, even at the sim's maximum legal tax rate.

---

## 2. The Real Federal Budget

### Top line

| Metric | FY2025 (actual/final) | FY2026 (CBO Feb 2026 projection) |
|---|---|---|
| Total outlays | $7.01T (23.1-23.3% of GDP) | $7.4T (23.3% of GDP) |
| Total receipts | $5.23T | $5.6T (17.5% of GDP) |
| Deficit | $1.775-1.8T (5.8-5.9% of GDP) | $1.9T (5.8% of GDP) |
| YoY outlay growth | +4.1% / +$275.1B vs FY2024's $6.75-6.8T | — |

(https://fiscaldata.treasury.gov/americas-finance-guide/federal-spending/, https://www.cbo.gov/system/files/2025-10/60306-MBR.pdf, https://www.cbo.gov/publication/61882, https://www.americanactionforum.org/insight/highlights-of-cbos-february-2026-budget-and-economic-outlook/)

### FY2025 spending by category (CBO functional breakdown)

| Category | $/year (billions) | % of total | $/day |
|---|---:|---:|---:|
| Social Security | $1,575-1,580.7 | 22.5% | $4.315B |
| Medicare | $988-996.7 | 14.1% | $2.707B |
| Nondefense Discretionary | $980 | 14.0% | $2.685B |
| Net Interest | $970-1,000 | 13.8% | $2.658B |
| Defense Discretionary | $893-916.6 | 12.7% | $2.447B |
| Other Mandatory (SNAP, EITC, etc.) | $773-936 | 11.0% | $2.118B |
| Medicaid | $668-978.9 | 9.5% | $1.830B |
| Other Health (ACA/CHIP) | $164 | 2.3% | $0.449B |
| **Total** | **$7,011B (≈$7.0T)** | **100%** | **$19.21B** |

Two independent sources agree closely on shape: CBO's official spending-composition pie (via CRFB's February 2026 baseline slide deck) sums to $7,011B; Treasury's own Monthly Treasury Statement Table 9 (live API pull, FY2025 final) reports a slightly different functional cut (it uses Treasury's 20-bucket "budget function" scheme rather than CBO's 8-bucket categorization) totaling $7,009,973,667,049.30 — the two reconcile to within $1B on the top line, cross-validating both. The ranges above reflect that divergence in categorization; Treasury's Net Interest line reads $970,358,886,994.32 and its National Defense line reads $916,648,676,662.05, both slightly higher than CBO's category-pie defense figure because of classification differences.

(https://www.crfb.org/sites/default/files/media/documents/February_2026_CBO_Baseline_Webinar.pdf, https://www.cbo.gov/system/files/2025-10/60306-MBR.pdf, https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_9)

### FY2025 receipts by category

| Category | $/year (billions) | % of total |
|---|---:|---:|
| Individual Income Taxes | $2,656 | 50.8% |
| Payroll Taxes | $1,748 | 33.4% |
| Corporate Income Taxes | $452 | 8.6% |
| Customs Duties | $195 | 3.7% |
| Other | $183 | 3.5% |
| **Total** | **$5,234B (≈$5.2T)** | **100%** |

Customs duties jumped ~153% year-over-year (from $77B in FY2024), reflecting 2025 tariff policy changes — the single largest percentage mover in either the spending or receipts breakdown.

(https://www.crfb.org/sites/default/files/media/documents/February_2026_CBO_Baseline_Webinar.pdf)

### By agency (a different lens — gross/net cost, not budget function)

Top agencies by net cost, FY2025: HHS $1,738.2B (24.8%), SSA ~$1,530B (21.9%), DoD $1,062.9-1,232.3B depending on whether a military-pension actuarial adjustment is included (15.2%). Together HHS+SSA+DoD = ~66.8% of total federal spending on this basis. Note this is a secondary aggregator source, not independently cross-checked against a primary Treasury/OMB agency-level table in this research; use the CBO functional figures above ($893B defense discretionary outlays, cash basis) for sim purposes rather than agency-level figures, which vary wildly (a separate USAspending pull put DoD at $2.21T on an obligations/awards basis — a different accounting concept entirely, not comparable to outlays).

(https://govtransparencyproject.org/articles/fy2025-federal-spending-by-agency-breakdown.html)

### Statutory caps vs. actual outlays — a distinction that matters

FY2025 statutory discretionary *budget authority* caps under the Fiscal Responsibility Act of 2023 were $895B (defense) and $711B (nondefense) — these are legislated funding ceilings, not cash spent. Actual FY2025 *outlays* (cash spent that year) were $893B defense and $980B nondefense; nondefense outlays exceed its $711B cap because outlays include spend-out of money appropriated in prior years. A sim ticking daily should use outlay figures, not budget-authority caps.

(https://www.cbo.gov/publication/60477, https://www.crfb.org/sites/default/files/media/documents/February_2026_CBO_Baseline_Webinar.pdf)

### Structural trend, FY2026-2036

Social Security, major health care programs, net interest, and mandatory veterans' programs will drive ~90% of nominal spending growth over the next decade: net interest alone is 28% of that growth, health care programs 30%, Social Security 27%, veterans' programs 5% — leaving only 10% of growth attributable to everything else, including discretionary spending. Net interest itself is projected to double, from ~$1.0T (2026) to ~$2.1T (2036).

(https://www.crfb.org/sites/default/files/media/documents/February_2026_CBO_Baseline_Webinar.pdf, https://www.cbo.gov/publication/61882)

---

## 3. Live Data Sources, Ranked

### Winner: Treasury Fiscal Data API — `api.fiscaldata.treasury.gov`

- **Endpoint example (category totals):** `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_9?filter=record_fiscal_year:eq:2025,record_calendar_month:eq:09`
- **Auth:** none required.
- **Format:** JSON:API-style REST; every response is self-describing (field labels, dataTypes, dataFormats — e.g. a field literally documents itself as currency-formatted `$10.20`), with `filter=field:eq:value` (comma-separated for AND), `sort=-field`, `page[size]`/`page[number]`, and `fields=a,b,c` column selection all confirmed working live.
- **Cadence:** MTS (Monthly Treasury Statement) is monthly, published within about a week of month-end — confirmed current through May 2026 as of early July 2026. A companion dataset, the Daily Treasury Statement (`deposits_withdrawals_operating_cash`), updates daily with a ~T+2/T+3 lag and gives per-agency/program cash-flow line items in whole-dollar-millions — the best available granularity for a sim that ticks more often than monthly.
- **Verdict:** Best fit. MTS Table 9 alone hands the sim a ready 20-bucket category breakdown that reconciles to the CBO top-line within ~$1B, with minimal reconciliation logic needed. Pure GET, no POST body construction, no auth setup.

(https://fiscaldata.treasury.gov/api-documentation/, https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_9, https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/, https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/)

### Second: same API family, Daily Treasury Statement

- **Endpoint example:** `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/deposits_withdrawals_operating_cash?filter=record_date:eq:2026-07-02`
- **Auth:** none.
- **Format:** identical JSON:API family to MTS.
- **Cadence:** daily, ~T+2/T+3 publication lag.
- **Verdict:** Use alongside MTS Table 9 specifically for day-granularity flavor data (per-agency daily withdrawals), not as the authoritative category total.

### Third: USAspending.gov API — `api.usaspending.gov`

- **Endpoint example:** POST `https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/` with a JSON body (`filters.time_period`, `category`, `limit`).
- **Auth:** none required (confirmed: "Endpoints do not currently require any authorization").
- **Format:** unusual for a public API — search/aggregation endpoints require POST with a nested JSON filter body, not simple GET query strings. Live pull for FY2025 top awarding agencies: HHS $2,024.2B, SSA $1,634.8B, DoD $501.5B, VA $288.0B, USDA $185.3B.
- **Cadence:** live/current; time_period search is limited to 2007-10-01 onward (bulk download needed for earlier data).
- **Verdict:** More integration code (POST + nested body) and, critically, its numbers are **award/obligation-level, not budget-function outlays** — its FY2025 aggregate was $5.31T in transaction obligations, about $1.7T short of the real $7.0T outlay figure. Do not sum USAspending totals expecting them to match Treasury's top-line. Good only for narrative/flavor detail ("HHS awarded $2.02T in grants and contracts this year"), never as a second contributor to a sim's top-line spending total.

(https://api.usaspending.gov/docs/endpoints, https://api.usaspending.gov/api/v2/search/spending_over_time/, https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/)

### Backup only: OMB Historical Tables / FRED FGEXPND

- OMB Historical Tables ship as a downloadable ZIP of XLS files (whitehouse.gov/omb), not a queryable API — a one-time/periodic parsing job at best, and reflects budget requests/enacted appropriations rather than live actuals.
- FRED's FGEXPND series has a real, documented, key-required REST API (`api.stlouisfed.org`) and read $7,580.2B annualized for Q3 2025 — useful as a macro cross-check but it's a National Income and Product Accounts concept (includes items like consumption of fixed capital) that doesn't map 1:1 to unified-budget outlays. Worse fit than Treasury/USAspending for category-level spending; keep for macro sanity-checks only.

(https://www.whitehouse.gov/omb/information-resources/budget/historical-tables/, https://fred.stlouisfed.org/series/FGEXPND)

### Operational notes

No rate-limit headers (`X-RateLimit-*`, `Retry-After`) were observed on either Treasury or USAspending APIs across repeated calls in this session, consistent with both being documented as no-key public APIs with "generous" limits. Neither publishes a formal SLA for high-frequency polling, so a production sim ticking every 90 minutes should still add client-side caching/backoff rather than relying on that being fine forever.

(https://fiscaldata.treasury.gov/api-documentation/, https://api.usaspending.gov/docs/endpoints)

---

## 4. How Real Spending Mechanically Works

### The three-way split

CBO's canonical framing: mandatory spending ~14% of GDP, discretionary spending ~6.1% of GDP (some framings state ~6%), net interest ~3.2% of GDP (~$970B-$1.0T, the first time it surpassed $1 trillion). A different framing bundles mandatory + interest together as "non-discretionary" (~73% of outlays), leaving discretionary as the remaining ~27% ($1.9T) — the two framings are consistent, just grouped differently. **Either way: only about a quarter to a third of total federal spending is subject to an annual congressional vote at all.**

(https://www.cbo.gov/publication/62286, https://www.congress.gov/crs-product/IN12477, https://bipartisanpolicy.org/explainer/a-growing-share-of-federal-spending-escapes-regular-congressional-review/)

### Mandatory spending grows on autopilot

Social Security's benefit formula is indexed to wage growth (which typically exceeds inflation) and, once claimed, further indexed to CPI-based cost-of-living adjustments. Medicare/Medicaid grow from both enrollment (aging population) and healthcare costs rising faster than general inflation. These programs bypass the annual appropriations process entirely — funding is available automatically each year under permanent authorizing law, with no new appropriations bill or vote required. In FY2025, mandatory + net interest spending roughly equaled total federal revenue — meaning every dollar of discretionary spending Congress appropriated was, structurally, borrowed.

(https://en.wikipedia.org/wiki/Mandatory_spending, https://www.congress.gov/crs-product/R44641, https://www.congress.gov/crs-product/IN12477, https://bipartisanpolicy.org/explainer/a-growing-share-of-federal-spending-escapes-regular-congressional-review/)

### Discretionary spending is annual, bill-by-bill

Discretionary spending is set via 12 separate regular appropriations bills, ideally preceded by a spring budget resolution that sets topline caps. Congress passed all 12 on time only 4 times between FY1977 and FY2015 (1977, 1989, 1995, 1997); continuing resolutions fill the gap the rest of the time. FY2026 example: after the longest government shutdown in modern history, Congress passed 3 of 12 bills outright in November 2025 (Agriculture, Legislative Branch, MilCon-VA) and funded the remaining 9 via continuing resolution through January 30, 2026. FY2026's full 12-bill package totals $1.653T ($898.5B defense / $742.6B non-defense), up only $10B from FY2025's $1.643T.

A continuing resolution funds government at prior-year levels (with minor formula adjustments/"anomalies") for a fixed period; failing to pass either a CR or full appropriations triggers a shutdown under the Antideficiency Act, which forbids officials from obligating unappropriated funds.

Structurally, appropriations acts nest as Division (one whole bill, used when multiple bills bundle into an omnibus/minibus) → Title (one department/agency) → Agency (bureau-level) → Account (the actual pot of money). Omnibus packages routinely run 1,000-4,000+ pages — the FY2023 Consolidated Appropriations Act combined all 12 bills into a single 4,155-page bill (6,825 pages with explanatory statements) appropriating $1.7 trillion, and 11 of 18 omnibus measures FY2012-FY2024 carried at least one unrelated non-appropriations rider.

(https://www.crfb.org/blogs/assessing-fy-2026-appropriations, https://en.wikipedia.org/wiki/Continuing_resolution, https://thehill.com/homenews/house/5701980-house-government-funding-bills/, https://blog.blazingstaranalytics.com/how-to-read-an-appropriations-act-structure/, https://en.wikipedia.org/wiki/Omnibus_spending_bill, https://www.congress.gov/crs-product/IN12324)

### Budget reconciliation — the mandatory-spending-law lever

A separate, optional, expedited track distinct from annual appropriations, used to change mandatory spending, revenue, or debt-limit law. Requires a budget resolution first (instructing committees to draft law changes), then committee action — its key advantage is bypassing the Senate's 60-vote filibuster via simple majority, constrained by the Byrd Rule barring "extraneous" non-budgetary provisions. This is the actual mechanism for altering entitlement formulas/eligibility; ordinary appropriations bills fund discretionary programs at existing authorized levels and cannot change entitlement formulas on their own.

(https://www.cbo.gov/topics/budget/reconciliation, https://www.congress.gov/crs-product/R48444, https://bipartisanpolicy.org/explainer/budget-reconciliation-simplified/)

### Implication for a sim

A realistic spending model needs at minimum three distinct legislative "lanes" with different friction and different renewal mechanics: (1) discretionary appropriations — annual, per-department, lapses into a CR or shutdown if missed; (2) mandatory/entitlement law — permanent, auto-scaling, changed only via a separate high-friction reconciliation-like process; (3) tax/revenue law — same reconciliation-style track as mandatory law changes. Interest is not a legislative category at all — it's an automatic function of debt stock and prevailing rates.

---

## 5. Fit with AgoraBench's Existing Mechanics

### What the sim currently has

Exactly three fiscal provision kinds, defined in `src/core/server/lib/fiscalParsing.ts` (`parseFiscalField`) — the only point where agent/LLM bill-proposal output can create fiscal state:

- **`spend_once`** — amount ∈ [1, floor(treasury × `fiscalMaxOneTimePctOfTreasury`/100)]; dropped if treasury ≤ 0.
- **`spend_recurring`** — amount ∈ [1, floor(expectedTickRevenue × `fiscalMaxProgramPctOfRevenue`/100)]; dropped if revenue ≤ 0, and *also* dropped if adding it would push aggregate active recurring spend over floor(revenue × `fiscalRecurringCapPctOfRevenue`/100) — the aggregate cap.
- **`tax_change`** — taxDelta ∈ ±`fiscalMaxTaxDeltaPerLaw` whole percentage points; a zero delta is a no-op.

All bounds are proportional (percent of treasury/revenue), never fixed dollar amounts — this is a deliberate design choice so caps scale as the sim's economy grows.

(src/core/server/lib/fiscalParsing.ts:12-30,121-199)

Recurring programs debit the treasury every tick (not just at enactment) via Phase 12 of `agentTick.ts`, and automatically lapse (`programActive` flips false) unless explicitly renewed via an amendment before `budgetCycleTicks` elapses since enactment/last renewal. `tax_change` laws apply an immediate, permanent rate shift with no lapse mechanic — a ratchet unless another law moves it back.

(src/core/server/lib/fiscalMath.ts:76-135, src/core/server/jobs/agentTick.ts:2688-2700,2803-2880,2975-3085,4316-4350)

### Current default config values

`budgetCycleTicks=24` (36 hours at the current 90-min tick interval), `fiscalMaxOneTimePctOfTreasury=5%`, `fiscalMaxProgramPctOfRevenue=10%`, `fiscalRecurringCapPctOfRevenue=50%`, `fiscalMaxTaxDeltaPerLaw=2` points, `taxRateMinPercent=10`, `taxRateMaxPercent=40`, `maxSunsetTicks=200`, `treasuryHardFloor=-$2T`, `gdpAnnual=$28,000,000,000,000`.

(src/core/server/runtimeConfig.ts:137-146,193-194,282-292)

### What maps cleanly

| Real-world structure | Sim mechanism |
|---|---|
| One-time appropriation (disaster relief, stimulus, infrastructure bill) | `spend_once` |
| Discretionary annually-appropriated program (agency budget, grant program) | `spend_recurring` with `sunsetTicks` + periodic renewal via amendment |
| Tax bracket/rate change | `tax_change` |

### What has no sim counterpart at all

- **Mandatory/entitlement spending** (Social Security, Medicare, Medicaid) — real programs that grow automatically without re-authorization and scale with beneficiary population/inflation. The sim's inverse default is active: every `spend_recurring` program requires affirmative re-authorization or it lapses, which is backwards from how ~60% of real federal spending behaves.
- **Interest on the national debt** — an automatic, non-legislated outflow tied to debt stock and interest rates. The sim treasury has no debt/bond mechanism at all; below `treasuryHardFloor` program debits merely suspend, there's no accruing liability.
- **Automatic stabilizers** (unemployment insurance scaling countercyclically).
- **Multi-year/multi-cycle appropriations** that don't need annual renewal.
- **Continuing resolutions / omnibus bundling** — the sim has no analog for funding multiple programs in one legislative act; each fiscal provision lives on a single bill, one kind at a time.
- **Amount escalation** — `fiscalAmount` is a static integer set at enactment/last clamp and never automatically grows with population or inflation.

(src/core/server/lib/fiscalParsing.ts:17,121-199, src/core/server/lib/fiscalMath.ts:100-113, src/core/server/jobs/agentTick.ts:2975-3085, src/core/server/runtimeConfig.ts:147)

### Can current caps even express realistic spending levels? No.

At the sim's own GDP peg (`gdpAnnual=$28T`, essentially identical to real 2024 US nominal GDP) and its cited operating tax rate of ~23%, per-tick revenue works out to `floor(28e12 × 23/100/365)` ≈ **$17.6B/day**. The aggregate recurring-spend cap at the default 50%-of-revenue setting is `floor(17,643,835,616 × 50/100)` = **$8.82B/day** — the sim's hard ceiling on total recurring program spend, regardless of how many programs agents pass.

Real FY2024 federal outlays were ~$6.75T/year ≈ **$18.49B/day** (~24% of GDP) — for direct comparison, the same-scale real FY2025 total-outlay figure of $19.21B/day. So even before accounting for the complete absence of a mandatory-spending channel, the sim's recurring-spend ceiling (~$8.8B/day) sits at under half of real per-day federal spending at an identical GDP peg.

Pushing to the sim's absolute legal maximum doesn't close the gap: at `taxRateMaxPercent=40%`, revenue tops out at `floor(28e12×40/100/365)` ≈ $30.68B/day, giving an absolute-max recurring cap of ~**$15.3B/day** — still short of the ~$18.5-19.2B/day real comparator, and that's the ceiling with every dollar of recurring-cap headroom filled and zero contribution from a mandatory-spending mechanism the sim doesn't have.

**Bottom line: under current caps, the sim structurally cannot reach a realistic total federal spending level, for two independent reasons** — (a) the recurring cap is a percentage of a revenue base that is itself capped by `taxRateMaxPercent`, and (b) there is no mandatory-spending channel to add the other ~60% of real outlays on top of discretionary-style recurring programs.

(src/core/server/lib/fiscalParsing.ts:151-166, src/core/server/lib/fiscalMath.ts:34-38, src/core/server/runtimeConfig.ts:141-145,194,285-290, docs/TODO.md:45)

---

## 6. Integration Options

### Option A — Seeded static baseline (low effort)

Insert one or more pre-enacted `spend_recurring` rows directly into the `laws` table at migration/seed time, bypassing the LLM parse path entirely: `fiscalKind='spend_recurring'`, `programActive=true`, `enactedTick` set to a past/seed tick, amount set to a realistic proportional share. The `laws` schema already carries every column needed (`fiscalKind`, `fiscalAmount`, `fiscalProgramName`, `programActive`, `enactedTick`, `lastRenewedTick`, `sunsetTicks`) — no schema change required. The existing Phase 12 per-tick debit loop in `agentTick.ts` (the same query used at lines 3045, 4326, 4491, 4968) picks up a seeded program automatically since it doesn't distinguish agent-authored from seeded rows.

**Buys:** A believable starting treasury baseline (e.g., seeded "Social Security"-style and "Defense"-style recurring programs at proportional shares of the sim's revenue) with zero new engine code. **Doesn't buy:** any auto-scaling/auto-renewal behavior — a seeded program is still subject to the same lapse-unless-renewed mechanic as any agent-authored one, so it will still require in-sim renewal votes to survive, which is the opposite of how mandatory spending behaves in reality.

(src/core/db/schema/index.ts; src/core/server/lib/fiscalParsing.ts:34-54,121-199; src/core/server/jobs/agentTick.ts:3039-3085,4316-4350,4482-4550,4960-4970)

### Option B — New RuntimeConfig-level baseline-spend target (medium effort)

Add a new field alongside the existing fiscal block in `runtimeConfig.ts`, following the CLAUDE.md "four things" rule in full (server handler branch, AdminPage.tsx UI control + client interface, `updateRuntimeConfig` persistence). This would hold a target baseline-spend value a bootstrap/admin action applies, rather than a one-time DB seed.

**Buys:** Admin-adjustable baseline without a redeploy/migration each time the owner wants to retune it. **Doesn't buy:** a genuine mandatory-spending mechanism — still just a config-driven variant of Option A's seeded rows. Requires introducing an actual new `fiscalKind` (e.g. `mandatory`, auto-renewing, formula-scaled) if the goal is to represent the ~60% of real spending that currently has no counterpart — that is new engine work, not just a config field.

### Option C — Live reality-injection feed (highest effort, most payoff)

Build a context-block builder analogous to the existing Congress API integration pattern (`src/modules/congress`, referenced in project memory as "Congress Context Live") that pulls Treasury MTS Table 9 category totals on a periodic sync (e.g. once per fiscal-month-equivalent of sim time) and feeds real proportional weights into agent prompts and/or a new mandatory-spending engine. Use Treasury MTS Table 9 as the authoritative category-total source; optionally layer USAspending's agency/award-level detail purely for narrative flavor text, never fed back into the top-line total. `docs/TODO.md`'s "Reality injection phases 2+3" item is the intended extension point for this kind of external economic-indicator feed.

**Buys:** A spending model that tracks real-world category proportions and could narrate real events ("Congress passed a $207.8B Labor-HHS-Education bill this cycle, matching the real FY2026 figure"). **Doesn't buy:** this alone still doesn't solve the mandatory-spending/no-debt-interest architecture gap — it needs to be paired with genuine new `fiscalKind` support (auto-renewing, population/inflation-scaled programs) and a debt/interest accrual mechanism against `treasuryBalance`, or the sim will keep hitting the same ~$8.8-15.3B/day recurring-spend ceiling regardless of how good the underlying data feed is.

(src/core/db/schema/index.ts; src/core/server/lib/fiscalParsing.ts:34-54,121-199; src/core/server/jobs/agentTick.ts:3039-3085,4316-4350,4482-4550,4960-4970; src/core/server/runtimeConfig.ts:137-146; docs/TODO.md:50)

---

## 7. Sources

- https://fiscaldata.treasury.gov/americas-finance-guide/federal-spending/
- https://www.cbo.gov/system/files/2025-10/60306-MBR.pdf
- https://www.crfb.org/sites/default/files/media/documents/February_2026_CBO_Baseline_Webinar.pdf
- https://www.cbo.gov/publication/61882
- https://www.americanactionforum.org/insight/highlights-of-cbos-february-2026-budget-and-economic-outlook/
- https://www.americanactionforum.org/insight/cbo-fy-2025-budget-deficit-totaled-1-8-trillion/
- https://govtransparencyproject.org/articles/fy2025-federal-spending-by-agency-breakdown.html
- https://www.cbo.gov/publication/60477
- https://www.cbo.gov/publication/61307
- https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_9
- https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/
- https://fiscaldata.treasury.gov/api-documentation/
- https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/mts/mts_table_1
- https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/
- https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/deposits_withdrawals_operating_cash
- https://api.usaspending.gov/docs/endpoints
- https://api.usaspending.gov/api/v2/search/spending_over_time/
- https://api.usaspending.gov/api/v2/search/spending_by_category/awarding_agency/
- https://www.whitehouse.gov/omb/information-resources/budget/historical-tables/
- https://fred.stlouisfed.org/series/FGEXPND
- https://www.fiscal.treasury.gov/files/reports-statements/combined-statement/cs2025/outlay.pdf
- https://www.cbo.gov/publication/62286
- https://www.congress.gov/crs-product/IN12477
- https://bipartisanpolicy.org/explainer/a-growing-share-of-federal-spending-escapes-regular-congressional-review/
- https://en.wikipedia.org/wiki/Mandatory_spending
- https://www.congress.gov/crs-product/R44641
- https://www.crfb.org/blogs/assessing-fy-2026-appropriations
- https://en.wikipedia.org/wiki/Continuing_resolution
- https://thehill.com/homenews/house/5701980-house-government-funding-bills/
- https://blog.blazingstaranalytics.com/how-to-read-an-appropriations-act-structure/
- https://en.wikipedia.org/wiki/Omnibus_spending_bill
- https://www.congress.gov/crs-product/IN12324
- https://www.cbo.gov/topics/budget/reconciliation
- https://www.congress.gov/crs-product/R48444
- https://bipartisanpolicy.org/explainer/budget-reconciliation-simplified/

### Internal (sim codebase)

- src/core/server/lib/fiscalParsing.ts
- src/core/server/lib/fiscalMath.ts
- src/core/server/jobs/agentTick.ts
- src/core/server/runtimeConfig.ts
- src/core/db/schema/index.ts
- docs/TODO.md
