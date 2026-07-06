# Spec: Simulation Completeness — the Government-Side Gap Matrix

*2026-07-05 — every channel through which a real government touches reality, crossed against what the sim actually implements (verified by code audit, wave 1). This is the government half of the gap analysis; the world half is `docs/specs/world-model.md`.*

## The matrix

Centrality per political-science research: CORE = governing doesn't exist without it; IMPORTANT = real lever, sim is poorer without it; PERIPHERAL = flavor/later.

| # | Channel | Centrality | Sim status (audited) | Gap |
|---|---|---|---|---|
| 1 | Legislation (bill lifecycle) | CORE | **COMPLETE** — 24-phase pipeline, whip/lobby/amend/vote/committee/veto/override/enact | Calibration only (cycle times vs real Congress) |
| 2 | Budget & appropriations | CORE | Partial — programs/lapse/budget sessions exist; divergence spec adds mandatory+debt | **No CR/shutdown mechanic** (§B below) |
| 3 | Elections & accountability | CORE | Machinery complete BUT **winner = campaign contributions; `votes` table exists and is referenced nowhere** (`finalizeElection.ts` says so in its own header) | **Real vote casting** (§A) |
| 4 | Courts & review | CORE | **COMPLETE** — full multi-stage judicial arc, live-verified; strike-down branch awaiting first case | Watch item only |
| 5 | Regulation & rulemaking | CORE | **ABSENT** — no agencies, no rules; most real day-to-day policy happens here | **Administrative state, minimal version** (§C) |
| 6 | Monetary policy (Fed) | CORE (but independent) | ABSENT | **Algorithmic Fed** — deliberately NOT agent-votable (§D); depends on world-model macro state |
| 7 | Executive orders | IMPORTANT | ABSENT (veto is the only executive power) | Same-tick directive with elevated litigation risk (§E) |
| 8 | Emergency declarations | IMPORTANT | ABSENT | Declare/no-declare choice unlocking emergency authority; pairs with exogenous feed (§E) |
| 9 | Appointments & vacancies | IMPORTANT | Justices auto-fill (Phase 10); no confirmation process | Senate-confirmation mini-process + vacancy capacity penalty (§F, with agencies) |
| 10 | Enforcement discretion | IMPORTANT | ABSENT | Per-law enforcement-priority dial changing effect magnitude without repeal (§E) |
| 11 | Lobbying & interest groups | IMPORTANT | **EXISTS** — Phase 1.5 pre-vote lobbying, vote pacts, deal-honor checks | Optional: economy-linked interest-group actors, later |
| 12 | Media & press | IMPORTANT | Partial — gazette/press room + forums exist; no narrative-pressure loop | Salience spikes forcing public response within N ticks (AGGE gravity handles the forcing) |
| 13 | Public communication/spin | PERIPHERAL | Partial — Phase 11.5 public statements exist | Credibility-bounded spin modifier, later |
| 14 | Protests & civil society | PERIPHERAL | ABSENT | Emergent event on issue-approval threshold — cheap once world-model opinion exists |
| 15 | Intergovernmental (states) | IMPORTANT | ABSENT | Deferred to `government-vertical.md` (the federalism spec) |
| 16 | Demographics | PERIPHERAL | Static | World-model population layer; reapportionment much later |
| 17 | Foreign affairs | IMPORTANT | ABSENT | Stub nation actors + executive-resolved actions; LAST — biggest scope, least comparable to the scoreboard |

Sim-only structural bugs the audit surfaced (fix regardless): double-position multi-salary (sam-ritter ×3 pay, verified in prod), AdminPage tick-stage bar "economy" stage has zero WS events mapped so it never lights up, AGGE admin tab is dead UI.

## A. Real election voting (smallest CORE gap, fully pre-scoped)

New vote-casting window in Phase 14's lifecycle: eligible agents make an LLM ballot decision (context: candidates' records, relationship alignment, party, approval) written to the dead `votes` table; `finalizeElection()` tally swaps from `campaigns.contributions` to `COUNT(*) GROUP BY candidate_id` (contributions stay as a campaign-strength signal). Fixes the placeholder called out in `finalizeElection.ts:1-14`. **Same PR resolves double-position**: winning a higher office vacates lower seats (recommended default; flag for owner), which also kills multi-salary payroll.

## B. Continuing resolutions & shutdowns

Real Congress misses Oct 1 nearly every year since FY1998; shutdowns are a headline governance-failure metric (43 days in 2025, 76-day DHS lapse in 2026). Sim mechanic: budget sessions gain a deadline; if appropriations (program renewals) miss it, a **CR state** auto-extends everything at current levels for `crDurationTicks` with an approval penalty; if agents *vote down* the CR, **shutdown state**: discretionary programs suspend (mandatory + interest continue — matching reality), payroll pauses for non-essential, approval decays hard per tick. Unlocks scoreboard metric #8. Small mechanic, huge narrative + comparability payoff.

## C. Administrative state (minimal but real)

The biggest ABSENT-CORE channel — most actual policy content in reality is rules, not statutes. Minimal version: `agencies` table (8–10 seeded: Treasury, Defense, HHS, Justice, State, Interior, Education, Transportation — aligned with the seed spending programs from the divergence baseline so agencies own budgets); each headed by an appointed agent (§F). New pipeline distinct from bills: agency head proposes a **rule** under an enacted law's authority → fixed-tick comment window (agents + future interest groups register support/oppose) → finalize → rule takes effect (modifies program parameters within law-set bounds, or sets enforcement posture). Courts can review rules (Phase 10 gains a rule-challenge case type — arbitrary/capricious analog). This gives the executive branch a real job between elections.

## D. Algorithmic Fed

The one output deliberately NOT under agent control, matching real institutional design. A Taylor-rule policy engine over the world-model's macro state (inflation, unemployment gap): `rate = neutral + a×(inflation − target) + b×outputGap`, coefficients in config. Sets the sim's interest-rate environment — which the debt engine's `debtInterestRatePct` then follows with a lag instead of being a static config. Depends on world-model macro state existing; until then the static rate stands. Agents can *pressure* the Fed in statements (and the scoreboard can show whether AI politicians jawbone the central bank like human ones do) but cannot vote its rate.

## E. Executive action package (EOs + emergencies + enforcement)

Three mechanics sharing one shape — unilateral, fast, bounded by courts:
- **Executive order**: president-agent same-tick directive (bounded action set: program parameter tweak within law bounds, enforcement posture, emergency declaration) with elevated court-challenge probability (Phase 10 hook exists).
- **Emergency declaration**: the response side of exogenous events — unlocks a time-boxed emergency spend_once authority above normal clamps (small multiple, config-capped) + starts a response-effectiveness clock; approval consequences keyed to response speed. Closes the loop: world event → declare/ignore → respond → approval.
- **Enforcement priority**: per-law dial (high/normal/low) on the executive; low-priority laws' effects attenuate without repeal. Cheap tension between branches.

## F. Appointments & vacancies

Agency heads (§C) + justices route through nomination → committee → floor confirmation (compressed: 2–3 ticks). Vacant agency = reduced rule throughput; vacant bench already postpones hearings (exists). Real-world anchor: ~1,200 PAS positions, mean 151 days to confirm — vacancy-as-normal is realistic texture the sim gets nearly free.

## Build order (registered in ROADMAP.md)

A (elections+double-position — small, ready now) → B (CR/shutdown — small, unlocks metric) → E (executive package — medium, pairs with exogenous feed arrival) → C+F (administrative state — large) → D (Fed — after world-model macro) → 12/13/14 (media/spin/protest — AGGE-era polish) → 17 (foreign — last).
