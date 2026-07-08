# Fiscal Consequence Loop — Spec & Implementation Plan

*2026-07-08 — from the consequence-feedback audit (see `DIVERGENCE_EXPERIMENT.md §1.5`). The first consequence subsystem: makes fiscal reality bite. An early, focused down-payment on the roadmap's E5 exit criterion ("approval stops being synthetic"), pulled forward because the audit proved it is the keystone gap now.*

---

## 1. Why this exists

The audit verdict: agents **perceive** fiscal state (treasury, tax, debt, interest are in their prompts) but **nothing punishes them** for fiscal recklessness. The intended chain — *reckless spending → lower approval → lost election → party punished* — is severed at every link:

- Approval is fiscally blind (all 23 writes procedural; passing a treasury-draining bill is **+12**).
- Ballots never surface a candidate's fiscal record.
- Tax revenue is perfectly linear — raising it is strictly dominant (this is the 4%→26% ratchet).

Until a fiscal variable moves approval, **the engine cannot distinguish an AI that stabilizes from one that spends infinitely** — they earn identical rewards. This slice closes that.

**Doctrine check (§1.5): is this physics or policy?** Physics, all of it. Making approval react to a drained treasury is *the governed reacting* — a real-world consequence, not a rule forbidding a choice. Making tax revenue elastic is *how taxes actually behave*, not a tax cap. We are not telling agents what they may do; we are making the world respond to what they do. **No guardrail is installed** — agents remain free to spend into the ground; they will simply now feel it.

---

## 2. Design principles carried in

1. **Everything tunable.** Every consequence strength is owner-dialed `RuntimeConfig`, defaulting to **off / zero-effect**, so the loop deploys dark and the owner finds the "my people win but not everyone gets screwed" point live. We never bake a policy judgment into a constant.
2. **First of many subsystems.** Architect the fiscal→approval channel as a generic *consequence input*, not a fiscal special-case, so the future economy/unemployment/sentiment engines (E5) attach to the same approval-input seam without a rewrite. Concretely: approval consequence flows through one new pure scoring function whose inputs are a struct, not hardcoded fiscal reads — later subsystems add fields to the struct.
3. **Pure functions, unit-tested.** All new math lands in `fiscalMath.ts` (or a new `consequenceMath.ts`) as pure functions with exhaustive unit tests. No new system ships without them.
4. **Dark-safe regression.** With the master flag off, the tick must behave **byte-identically** to today. A regression test proves it.
5. **Sparse code.** No pedagogical comments; comment only genuinely non-obvious ordering/constants.

---

## 3. The three mechanisms

### 3.1 Fiscal → approval (the keystone)

**New pure fn** `fiscalApprovalDelta(state: FiscalConsequenceState, cfg): number` in a new `consequenceMath.ts`.

`FiscalConsequenceState` is a struct — the extensible seam for future subsystems:
```
{ treasuryBalance, debtOutstanding, gdpAnnual, taxRatePercent,
  deficitPerTick, treasuryBufferDollars }
```

The delta is a sum of independently-tunable, signed contributions, each a bounded function of one fiscal signal. v1 signals (each gated by its own strength knob, 0 = disabled):

| Signal | Shape | Rationale (physics) |
|---|---|---|
| **Debt/GDP ratio** | penalty scales past a *health* band, not the 150% crisis wall — mild drag at 100%, steeper approaching crisis | the governed sour on debt gradually, not at a cliff |
| **Treasury depletion** | penalty as treasury falls below the operating buffer toward/through zero | visible fiscal distress erodes confidence |
| **Deficit-per-tick** | penalty proportional to deficit as a share of revenue | chronic overspending is felt |
| **Tax burden** | penalty as tax rate rises above a *neutral* point toward the ceiling | high taxes cost political support (the missing downside to the ratchet) |

- Applied to **incumbents who hold office** (they own the outcome), each tick, via the existing `updateApproval` helper with `eventType='fiscal_consequence'`. Non-officeholders are unaffected — you're punished for governing badly, not for existing.
- **Every signal's strength is a config knob defaulting to 0.** The master `fiscalConsequenceEnabled=false` short-circuits the whole computation (dark).
- **Direction is symmetric**: a healthy surplus / low debt / moderate tax can yield a *small positive* delta, so fiscal responsibility is rewarded, not just recklessness punished. (Tunable; can be zeroed to make it punishment-only.)
- **Party/constituency weighting (v1, optional knob):** a fiscal-hawk-leaning agent takes a larger tax-burden penalty and a larger debt penalty; a spending-leaning agent takes a larger treasury-depletion penalty when *services* are cut. This is where "constraints per who they represent" becomes mechanical. v1 ships this as a single `fiscalConsequencePartyWeight` scalar (0 = party-blind, 1 = full weighting); the per-party curve is derived from existing alignment/party fields, not new policy we author.

### 3.2 Ballot fiscal record (the election link)

The Phase 14 ballot prompt (`agentTick.ts:~5397`) currently shows each candidate as `name (party, approval): platform`. Add a **fiscal record line** per candidate who currently holds or recently held office:

```
fiscal record: presided over $Xdeficit/day, debt $Y→$Z, tax A%→B% during tenure
```

- Sourced from `fiscal_tick_summaries` + `government_settings` history over the candidate's term window. Read-only aggregation; no schema change if term windows are derivable from `elections`/office history (verify — may need a lightweight per-agent tenure lookup).
- Gated by `ballotFiscalRecordEnabled` (default false). With it off, ballot prompt is unchanged (dark-safe).
- This makes the *voter* able to punish fiscal record directly, independent of whether approval encoded it — two independent paths to the same consequence, which is more robust.

### 3.3 Tax elasticity (kill the free-money exploit)

`dailyCitizenRevenue(gdpAnnual, taxRatePercent)` is currently perfectly linear. Replace with an **elastic** revenue curve: revenue rises with the rate but with diminishing returns past a neutral rate, and can *fall* past a peak (a real Laffer-shaped response — behavioral drag, avoidance, base erosion).

- **New pure fn** `elasticCitizenRevenue(gdpAnnual, taxRatePercent, cfg)` — the linear fn stays as the `elasticity=0` degenerate case, so this is a strict generalization.
- Knobs: `taxElasticityStrength` (0 = today's linear behavior, default 0), `taxNeutralRatePercent` (rate below which behavior is ~unaffected), optionally `taxRevenuePeakPercent` (rate of maximum revenue).
- Shape derived from real public-finance parameters (documented in the fn, one line, cited), not invented. This is physics: it's how a tax base actually responds. It is **not** a cap — agents can still set any rate in `[min,max]`; they'll just discover, endogenously, that 40% doesn't raise 2× what 20% does.
- **Supersedes** the "tax-ratchet cooldown" standing-backlog item — elasticity makes the ratchet self-limiting through consequence rather than a hard rule.

---

## 4. RuntimeConfig fields (four-things rule — all in the same commit)

Every field below gets: (1) server handler branch in `POST /admin/config` with type check + range clamp, (2) AdminPage control, (3) client interface entry, (4) persistence verified.

| Field | Type | Default | Range | Purpose |
|---|---|---|---|---|
| `fiscalConsequenceEnabled` | bool | **false** | — | master kill switch (dark) |
| `fiscalApprovalDebtWeight` | number | 0 | 0–50 | debt/GDP → approval strength |
| `fiscalApprovalTreasuryWeight` | number | 0 | 0–50 | treasury depletion → approval strength |
| `fiscalApprovalDeficitWeight` | number | 0 | 0–50 | deficit → approval strength |
| `fiscalApprovalTaxWeight` | number | 0 | 0–50 | tax burden → approval strength |
| `fiscalConsequencePartyWeight` | number | 0 | 0–1 | party/constituency weighting (0 = blind) |
| `fiscalApprovalMaxDeltaPerTick` | number | 5 | 1–20 | clamp on total fiscal approval move per tick (stability guard) |
| `ballotFiscalRecordEnabled` | bool | **false** | — | show fiscal record on ballots (dark) |
| `taxElasticityStrength` | number | 0 | 0–1 | 0 = linear (today); 1 = full Laffer response |
| `taxNeutralRatePercent` | number | 19 | 0–40 | rate below which elasticity ~inert |
| `taxRevenuePeakPercent` | number | 45 | 20–60 | rate of max revenue on the curve |

All strength knobs default to a **zero-effect** value: shipping this changes nothing until the owner dials it.

---

## 5. Implementation plan (slices, each PR: tests green + dark-safe proof)

**Slice 1 — `consequenceMath.ts` + tax elasticity (pure, no wiring)**
- New `src/core/server/lib/consequenceMath.ts`: `fiscalApprovalDelta(state, cfg)`, `FiscalConsequenceState` type. Add `elasticCitizenRevenue` to `fiscalMath.ts`.
- Unit tests: zero-weight → 0 delta; each signal in isolation; combined; clamp respected; symmetry (surplus → positive); party weighting; elasticity `strength=0` ≡ existing linear fn (regression against `dailyCitizenRevenue`); Laffer peak behaves (revenue at peak > revenue at ceiling).
- No tick changes. Ships inert.

**Slice 2 — wire fiscal→approval into the tick**
- New Phase (near the existing decay-to-baseline, `agentTick.ts:~6000`, so it runs after all procedural approval moves): build `FiscalConsequenceState` from `government_settings` + this tick's fiscal summary, compute `fiscalApprovalDelta` per officeholder, apply via `updateApproval`. Clamp by `fiscalApprovalMaxDeltaPerTick`.
- Gate on `fiscalConsequenceEnabled`; off = phase is a no-op (regression test proves identical tick).
- Swap `dailyCitizenRevenue` call sites to `elasticCitizenRevenue` (Phase 13 revenue + the `expectedRevenue11` cap basis at `agentTick.ts:4580`) — with `taxElasticityStrength=0` these are byte-identical.

**Slice 3 — ballot fiscal record**
- Tenure-window fiscal aggregation helper (pure, tested against fixtures) + inject the record line into the Phase 14 candidate block, gated by `ballotFiscalRecordEnabled`.

**Slice 4 — admin UI + docs**
- All 11 config fields wired into AdminPage (four-things rule), grouped under a new "Fiscal Consequences" section. Wiki note. `DIVERGENCE_EXPERIMENT.md §1.5` gap map updated: mark #1/#3/#5 as "addressed, dark, tunable."

**Regression guarantee:** the whole slice defaults to zero-effect. CI proves a tick with all flags off / weights zero produces identical state to `main`. Nothing reaches the live sim until the owner flips `fiscalConsequenceEnabled` and dials weights — which is a deploy + admin action, not a code default.

---

## 6. Open owner dials (all have safe defaults; adjust live, not in code)

1. Where the "health band" for debt/GDP starts (default: mild drag from 100%, matching the audit's note that real ~120% isn't yet called a crisis).
2. Whether fiscal responsibility earns *positive* approval or only avoids penalty (default: symmetric, small positive).
3. Party weighting strength (default 0 = blind for the first live run, so the raw fiscal signal is observed before layering constituency effects).

These are `RuntimeConfig`, not spec decisions — the point of building it tunable is that the owner answers them empirically by watching the sim, not up front.
