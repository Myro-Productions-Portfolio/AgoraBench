# Divergence Experiment — Spec & Implementation Plan

*2026-07-05 — from owner direction + `docs/research/us-federal-spending-reality-reference.md`*

---

## 1. Purpose

AgoraBench's core question: **can AI manage a government better than humans manage the real one?** That requires a controlled experiment, not a reality mirror:

1. **Baseline (T0)** — seed the sim 1:1 with the real US federal fiscal position (spending mix, revenue rate, debt).
2. **Free divergence** — from T0, the AI government owns every outcome. Endogenous state (budgets, balances, tax rates, deficits, program funding) is NEVER synced from reality again.
3. **Reference pool** — real data pulled periodically and stored *alongside* sim state, purely for comparison. Reality is the control group.
4. **Exogenous-only injection** — world-caused events (disasters, wars, shocks) flow into the sim so both governments face the same world. The test for every future "should this sync?" question: *did the government cause it, or did the world do it to them?* World → inject. Government → hands off.

**Non-goals (v1):** GDP feedback (stays pinned at $28T; noted as a later phase), state/local government, monetary policy/Fed, USAspending award-level detail.

---

## 2. Spec

### 2.1 Fiscal engine prerequisites — the `mandatory` lane + debt/interest

The research verdict: the sim cannot hold a realistic baseline today, for two structural reasons — no mandatory-spending channel (~60% of real outlays), and no debt/interest mechanics. Both must exist before T0.

**New fiscal kind: `mandatory`**

- A `laws` row with `fiscalKind='mandatory'`: debits the treasury every tick like `spend_recurring`, but **never lapses** — it is naturally exempt from the Phase 12.5 budget-session lapse loop, which already filters `fiscalKind='spend_recurring'` (`agentTick.ts:3045`), so exemption costs zero code.
- **Auto-growth:** the per-tick amount grows by `mandatoryGrowthPctAnnual` (new RuntimeConfig, default **5**, range 0–15 — matches real SS/Medicare growth drivers), applied as a daily compounding factor in the Phase 12 debit: `effectiveAmount = fiscalAmount × (1 + rate/100)^(daysSinceEnacted/365)`, computed, not mutated — the stored `fiscalAmount` stays the T0 figure so growth is auditable.
- **Agent interaction (v1):** agents cannot *create* mandatory programs (seed-only). They **can amend** one — an amendment bill targeting a mandatory law adjusts its base amount, clamped to ±`fiscalMaxMandatoryDeltaPct` (new RuntimeConfig, default **10**, range 1–25) per law. This is the sim's reconciliation analog: touching entitlements is possible but bounded. ⚑ *Owner-tunable: whether amending mandatory should additionally require a supermajority — v1 says no, normal bill flow.*

**Debt & interest**

- New `government_settings.debtOutstanding` (bigint). Treasury stays operating cash and **never goes negative**: at end-of-tick settlement (Phase 13), a cash shortfall is covered by issuing debt (`debtOutstanding += shortfall`, treasury floors at 0); a surplus above `treasuryOperatingBufferDollars` (new RuntimeConfig, default **$1.5T** ≈ real Treasury General Account scale) automatically retires debt with the excess.
- **Interest accrual:** every tick, `interest = debtOutstanding × debtInterestRatePct / 100 / 365` (new RuntimeConfig, default **2.7** — real average rate implied by ~$970B interest on ~$36T debt; range 0–15) is added to tick spending and settled with everything else. Interest is *not* a law — it is an automatic outflow, exactly as in reality.
- The existing `treasuryHardFloor` becomes dead config once the debt engine is on (treasury can't go below 0); it is left in place behind the flag as the fallback behavior.
- **Kill switch:** all of this sits behind `debtEngineEnabled` (new RuntimeConfig, default **false**) so it deploys dark and turns on at seed time.

**Caps: no changes needed.** With mandatory in its own lane, agents' controllable surface is discretionary spending — real discretionary is ~$5.1B/day, comfortably inside the existing $8.82B/day aggregate recurring cap at the 23% tax rate (and inside it at the seed rate too). The cap problem in the research report dissolves once mandatory stops competing for recurring headroom.

**Crisis engine re-check:** Phase 11 / `aggeTick` stress thresholds currently key off treasury level. With treasury floored at 0 and debt as the real distress signal, crisis detection gains a debt-based condition: stress when `debtOutstanding / gdpAnnual` exceeds `debtCrisisRatioPct` (new RuntimeConfig, default **150**, range 50–500; real is ~120% and nobody calls it a crisis yet).

### 2.2 Baseline seed (T0)

One-time script, run once against prod after the engine slice is deployed and verified:

| Seed program | Kind | $/day at T0 |
|---|---|---:|
| Social Security | mandatory | $4.315B |
| Medicare | mandatory | $2.707B |
| Medicaid | mandatory | $1.830B |
| Other Mandatory (SNAP, EITC, veterans) | mandatory | $2.118B |
| Other Health (ACA/CHIP) | mandatory | $0.449B |
| National Defense | spend_recurring | $2.447B |
| Nondefense Discretionary (split ~6 named programs: Veterans Services, Education & Workforce, Transportation & Infrastructure, Science & Research, Justice & Public Safety, General Government) | spend_recurring | $2.685B total |
| Net Interest | — (automatic via debt engine) | ~$2.66B |
| **Total** | | **≈$19.2B/day** |

- Figures from the verified FY2025 CBO/Treasury reconciliation (research report §2). Discretionary seeds get `lastRenewedTick = seedTick` and normal lapse/renewal mechanics — **agents must actively keep the discretionary government funded from day one**, which is the realistic pressure.
- **Debt seed:** `debtOutstanding` set from the real debt-held-by-public figure pulled live at seed time (Fiscal Data "Debt to the Penny" endpoint; ~$30T scale). The AI government inherits the humans' actual fiscal hole — that *is* the experiment. ⚑ *Owner decision: full real debt (recommended — hardest, most honest test) vs. debt-free start (cleaner but unrealistic).*
- **Tax rate reset to 19%** at T0 (real effective: receipts $5.23T / GDP $28T ≈ 18.7%). The agents ratcheted the rate to 23% under the broken no-spending economy; T0 should equal reality. ⚑ *Owner decision: reset (recommended) vs. keep 23%.*
- Expected T0 dynamics (sanity check the seed against these): revenue ~$14.6B/day, spending ~$19.2B/day → **deficit ~$4.6–4.9B/day**, matching reality's ~$4.9B/day. Debt grows, interest compounds, agents feel the squeeze. If they fix it, that's the headline.
- T0 recorded as `divergenceT0Tick` + `divergenceT0Date` (RuntimeConfig) — the anchor for tick-date ↔ real-date mapping (ticks are days).
- Payroll (~$265k/payday) is noise at this scale; unchanged.

### 2.3 Reality reference pool

- New table `reality_snapshots`: `id, record_date, fiscal_year, fiscal_month, category (Treasury MTS bucket, null for top-line rows), outlays_fytd, receipts_fytd, deficit_fytd, debt_outstanding, source, fetched_at`. Unique on `(record_date, category, source)` — idempotent re-pulls.
- Puller service (`src/modules/government/server/lib/realityFeed.ts`) hits, with client-side cache + backoff (no rate-limit SLA on these APIs):
  - MTS Table 9 (spending by function) + Table 1 (receipts/outlays/deficit) — monthly, ~T+7 after month-end
  - Debt to the Penny — daily
- Scheduled inside the existing tick (a cheap fetch every N ticks, guarded so failures never touch the tick) — no new cron surface. Backfills FY2025→present monthly history on first run so charts have depth at launch.
- **Hard rule enforced in code review, not just convention: nothing reads `reality_snapshots` except the divergence API.** The pool cannot influence sim state.

### 2.4 Divergence surface (the product)

- New page **`/divergence` — "Sim vs Reality"**, spectator-first:
  - Side-by-side headline tiles: daily deficit (AI vs humans), debt & debt-to-GDP, tax burden, total spending
  - Overlay time series from T0: deficit trajectories, debt trajectories (same-day alignment via the tick-date mapping)
  - Spending-mix comparison: category shares side by side + a single **divergence score** (L1 distance between category-share vectors, 0 = identical mix, 2 = disjoint)
  - Program continuity: which seeded programs the AI government has kept funded / amended / let lapse — this is the narrative gold ("the AIs defunded the Department of X in month 2")
- `GET /api/divergence`: sim aggregates (from `fiscal_tick_summaries` + laws + debt) joined with latest `reality_snapshots`.
- "Better" v1 = the displayed metrics (fiscal balance, debt trajectory, spending mix, program continuity, agent approval alongside). No composite verdict score in v1 — let viewers judge; a weighted score is a later product decision.

### 2.5 Exogenous event injection — deferred

Designed under AGGE v2 / reality-injection Phase 2 (TODO.md), not here. The only contract this spec sets: injected events must pass the exogenous test (§1.4), and they enter through AGGE/orchestrator intervention paths, never by mutating fiscal state directly.

---

## 3. Implementation Plan

Five slices, each an independently deployable PR with tests green + live verification. Order matters; nothing turns on until the seed.

**Slice 1 — Engine: mandatory kind + debt/interest (the only risky slice)**
- Migration `0027`: `government_settings.debtOutstanding bigint NOT NULL DEFAULT 0`; no `laws` schema change needed (`fiscalKind` is varchar; `'mandatory'` is a new value, constraint check updated if one exists).
- `fiscalMath.ts`: `mandatoryEffectiveAmount(baseAmount, enactedTick, currentTick, growthPctAnnual)`, `tickInterest(debt, ratePct)`, `settleTreasury(cash, buffer) → {cash', debtDelta}` — pure functions, unit-tested (compounding, zero-debt, surplus-retirement, shortfall-issuance, boundary cases).
- `agentTick.ts` Phase 12: debit mandatory programs (effective amount) alongside recurring; accrue interest into `tickSpendingThisTick`. Phase 13: end-of-tick settlement (shortfall→debt / surplus→retire). Both `fiscalKind='mandatory'` rows and interest are naturally exempt from lapse/sunset loops (kind-filtered queries — verify each query, this is the regression surface).
- Amendment path: extend the Phase 3 renewal hook (`agentTick.ts:2686`) so an amendment to a mandatory law adjusts base amount within ±`fiscalMaxMandatoryDeltaPct`; `fiscalParsing.ts` accepts the amount field for mandatory-law amendments only.
- RuntimeConfig — **every field gets all four things in the same commit** (server handler branch w/ clamps, AdminPage control, client interface, persistence verify): `debtEngineEnabled` (bool, default false), `mandatoryGrowthPctAnnual` (0–15, def 5), `debtInterestRatePct` (0–15, def 2.7), `treasuryOperatingBufferDollars` (0–1e13, def 1.5e12), `fiscalMaxMandatoryDeltaPct` (1–25, def 10), `debtCrisisRatioPct` (50–500, def 150), `divergenceT0Tick` (int, def 0 = unset), `divergenceT0Date` (ISO string, def '').
- Crisis: debt-ratio stress condition added to Phase 11 + `aggeTick` alongside the existing treasury check.
- Agent prompt context (Phase 1 fiscal block + proposal prompts): agents must see debt outstanding, daily interest, mandatory totals, and the amend-mandatory option — they can't govern what they can't see.
- Deployed **dark** (`debtEngineEnabled=false` → Phase 12/13 behave exactly as today; regression suite must prove it).

**Slice 2 — Baseline seed script**
- `scripts/seed-divergence-baseline.ts`: idempotent (refuses to run if `divergenceT0Tick` set); pulls Debt to the Penny live for the debt figure; inserts the 13 seed laws (system-sponsored, `enactedTick = current`); sets tax rate 19%, `debtEngineEnabled=true`, T0 markers; writes one `activity_events` row ("The Divergence Experiment begins — the simulation now carries the real United States fiscal baseline").
- Run manually on prod after a fresh pg_dump. Verify over the next 3 ticks: spending ≈ $19.2B/day, deficit ≈ $4.6–4.9B/day, debt grows by deficit + interest, fiscal summaries reconcile to the transaction ledger.

**Slice 3 — Reality reference pool**
- Migration `0028`: `reality_snapshots` + indexes. `realityFeed.ts` puller (MTS 9, MTS 1, Debt to the Penny), tick-piggybacked every 16 ticks (~daily), failure-isolated, FY2025+ backfill on first run. Unit tests on response parsing against captured fixtures (APIs are unauthenticated — fixtures from real pulls).

**Slice 4 — Divergence page**
- `GET /api/divergence` + `/divergence` page (tiles, overlays, mix comparison, L1 divergence score, program-continuity table), nav entry, EmptyState until T0 is set. Uses `formatMoney`, the unified icon set, and the era-trim helper patterns already in place.

**Slice 5 — polish + docs**
- Wiki articles (the sim explains the experiment to visitors), BudgetPage gains debt/interest tiles, CLAUDE.md + AGORABENCH.md updated, TODO.md reconciled.

**Risk register:** bigint headroom fine ($30T ≪ 9.2e18); the single most dangerous change is Phase 12/13 settlement (money conservation — extend the fiscal-summary invariant checks and verify a payday tick under the debt engine before seeding); mandatory growth is computed-not-mutated to keep the ledger auditable; every new config field follows the four-things rule (the April incident class); reality puller failures must never fail a tick (wrap + log only).

**Sequencing note:** Slices 1–2 are the experiment. 3–4 are the scoreboard. If throughput on the upgraded vLLM lands and the tick interval shrinks, nothing here changes — all rates are per-day and ticks are days.

---

## 4. Flagged owner decisions (defaults chosen, say if you want different)

1. **Seed the real ~$30T debt** (recommended) or start debt-free.
2. **Reset tax rate to 19% at T0** (recommended) or keep the agents' 23%.
3. Mandatory amendments via **normal bill flow** (v1) or require supermajority.
