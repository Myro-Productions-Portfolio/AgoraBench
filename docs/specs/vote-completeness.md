# Spec: Vote Completeness — every leadership seat, and how it is filled

*2026-07-08 — a code + production audit of every office/seat/leadership role in the sim, crossed against whether it is filled through a real voted election or through some non-voted mechanism (silent appointment, seniority derivation, seed data, or nothing at all). Companion to `docs/specs/simulation-completeness.md` §A/§9, which pre-flagged this thread but scoped only real vote-casting for offices that already run elections.*

## Governing principle (the test every proposal below must pass)

The engine is physics, not policy (`docs/DIVERGENCE_EXPERIMENT.md` §1.5 doctrine). The engine may provide the *mechanic* — an election happens, a seat opens, a ballot window closes — but it must never predetermine or bias the *outcome* (who wins, who is seated). Owner's explicit instruction for this work: every leadership seat is filled through a real voted election, never appointed or hardcoded by fiat. The audit below flags every place the engine currently picks a winner.

## The seat matrix (audited against prod, tick ~803)

Verdict legend: VOTED = seated off a real `votes` tally. APPOINTED = engine picks the holder by a ranked heuristic, no ballot. DERIVED = holder computed from other state (seniority), no ballot. NOT MODELED = no filling mechanic exists. SEED = only ever created by seed fixtures.

| # | Seat / office | Position `type` | How it is filled today | Verdict | Prod reality |
|---|---|---|---|---|---|
| 1 | President | `president` | Phase 14 vacancy trigger creates an election, but it dies in `registration` (see gap A); the one certified prod president came from a seed-born `campaigning` election + manual admin advance | VOTED in principle, INERT in practice | 1 sitting, **term expires 2026-07-09 (tomorrow)** |
| 2 | Congress member | `congress_member` | Phase 14 vacancy auto-fill: highest-`reputation` unheld agents inserted directly into `positions` (`agentTick.ts:5581-5595`), activity event literally says "reputation rank fill" | **APPOINTED** | 23 seated, **0 ever elected**; end_dates weeks past, still `is_active=true` |
| 3 | Committee chair | `committee_chair` | Phase 0.5 `selectChair`: highest engagement + approval among the committee's members (`agentTick.ts:308-346`) | **APPOINTED** | 2 chairs (Budget, Technology), 0 ever voted |
| 4 | Supreme Court justice | `supreme_justice` | Phase 10 vacancy auto-fill: highest-`reputation` unheld agents inserted directly (`agentTick.ts:3227-3248`) | **APPOINTED** | 7 seated, 6 in one seed batch |
| 5 | Chief Justice | (none — derived) | Earliest-appointed sitting justice, computed at read time (`agentTick.ts:3267-3275`, surfaced on `GET /government/overview`) | **DERIVED** (seniority) | Decided by a millisecond of seed-order tie among 6 batch-seeded justices |
| 6 | Speaker of the Legislature | (none) | No schema value, no election, no tick phase — dashboard card is `notModeled:true` since PR #35 | **NOT MODELED** | Card reads "Not tracked" |
| 7 | Cabinet secretary | `cabinet_secretary` | Declared in `POSITION_TYPES`; wired into salary, officeRank, and UI labels — but **no code ever inserts one** | **NOT MODELED** | 0 exist |
| 8 | Lower / circuit justice | `lower_justice` | Same as #7 — declared, salaried in constants, labeled in UI, never created | **NOT MODELED** | 0 exist |

Only **one** positions-write path in the entire codebase is gated on a real ballot tally: `finalizeElection.ts:230`. Every other seat is filled by a ranked heuristic, seniority, or seed data. Confirmed: `votes` table has **0 rows in prod** — the E3 vote-casting window (shipped 2026-07-07) has never fired live, because no organic election has ever reached the `voting` state.

## The two structural bugs behind the matrix

### Gap A — the `registration -> campaigning` transition does not exist (dead-end elections)

The canonical election lifecycle is `scheduled -> registration -> campaigning -> voting -> certified` (`admin.ts:1114`; `ELECTION_STATUSES` in `constants.ts:55-62` also carries a dead `'counting'` value that is never written — recommend deleting it). The tick engine (Phase 14) implements only two forward edges: `campaigning -> voting` (`agentTick.ts:5300-5306`) and `voting -> certified` (`agentTick.ts:5548` via `finalizeElection`). **Nothing in the tick engine ever advances an election into `campaigning`** — a grep for any `set status = 'campaigning'` in the tick returns empty. The only code that walks `registration -> campaigning` is the manual owner-only admin `/advance` button (`admin.ts:1206`).

Consequently, every organically-triggered election (the Phase 14 presidential-vacancy trigger at `agentTick.ts:5630-5640`, the admin `/trigger` endpoint, the orchestrator `trigger_election` tool) is born in `registration` and **stays there forever**. The only elections that have ever completed are seed-data elections, which cheat by being seeded directly in `campaigning`. This is why prod has exactly 2 elections ever (both president: 1 cancelled, 1 seed-born certified) and 0 votes.

Worse, the presidential trigger's in-flight guard (`agentTick.ts:5613-5624`) treats a stuck `registration` election as "an election is already in flight," so once one dead-ends, it permanently suppresses re-triggering. **This bug is about to demonstrate itself live**: the sitting president's term expires 2026-07-09, Phase 14 will trigger a presidential election, and it will freeze in `registration` with no candidates.

### Gap B — no candidacy-declaration mechanic (agents can never choose to run)

Campaigns (this codebase has no `candidates` table — candidacy IS a `campaigns` row) come from exactly two sources: seed fixtures, and the manual `POST /api/campaigns/announce` REST endpoint (`campaigns.ts:12-101`). **Nothing in the tick engine ever inserts a campaign.** Phase 15 "Agent Campaigning" only makes speeches that bump `contributions` on *already-existing* campaigns; it never creates one. So even if gap A were fixed, a freshly-`campaigning` election would have zero candidates and would certify to nobody (or fall back on contributions from candidates who never existed). Agents cannot organically decide to run for office. This is the root cause; gap A is its enabler.

---

## Proposed fixes

All proposals reuse the existing `elections` / `campaigns` / `votes` / `positions` tables. `elections.positionType` and `positions.type` are free `varchar(50)` with no DB enum, so new office types (Speaker, cabinet) need **no migration** — only new string values and the tick logic to fill them. The one possible additive migration is an optional election-scope column discussed in D.

### A. Add the missing `registration -> campaigning` transition + a candidacy-declaration phase

This is the keystone — it makes elections actually run and unblocks everything else. Add to Phase 14, before the existing `campaigning -> voting` edge:

1. **Candidacy window.** For each election in `registration` whose `registrationDeadline` is still in the future, run a candidacy-declaration pass: eligible agents who are not already candidates make one LLM decision — "run for `<positionType>`, or sit this one out?" — given the office, its salary, their standing, the incumbent (if any), and who has already declared. A "yes" inserts a `campaigns` row (reusing the exact insert + filing-fee logic already in `campaigns.ts`, extracted into a shared helper so the tick and the REST endpoint stay in sync). This is the physics-not-policy core: the engine *asks*, the agent *decides*. The engine never nominates anyone.
2. **Transition.** When `registrationDeadline <= now`, advance the election `registration -> campaigning` (mirrors the existing `campaigning -> voting` block). If zero candidates declared by the deadline, the election is cancelled (status `cancelled`) with an activity event and — for a vacant mandatory office — Phase 14 re-triggers a fresh one next cycle rather than dead-ending.
3. **Guard fix.** The presidential in-flight guard must not count a `cancelled` election as in-flight (it already excludes `certified`/`cancelled`), and the stuck-`registration` permanent-suppression problem disappears once registration actually terminates.

Eligibility knobs (all RuntimeConfig, four-things rule per CLAUDE.md): per-tick candidacy-decision cap (LLM budget), max candidates per election, whether incumbents auto-appear on the ballot or must re-declare. Failure-isolated exactly like the Phase 14 ballot pass (a rejected LLM call = that agent doesn't declare this tick).

### B. Congress seats — convert appointment to election (the biggest doctrine violation)

Congress is 23 seated agents, 0 ever elected — pure reputation-rank appointment. Under the doctrine this is the seat most in need of a real election. Proposal: replace the direct-insert auto-fill (`agentTick.ts:5577-5606`) with an **election trigger** identical in shape to the presidential one — when active congress seats fall below `rc.congressSeats`, trigger a `congress_member` election for the open seats (a single multi-winner race, top-N by ballots, or one race per seat — see design question Q3). Seats flow through the same `registration -> campaigning -> voting -> certified` pipeline and `finalizeElection`. `finalizeElection` already handles `congress_member` as a `positionType` and already seats the winner; it needs a multi-winner tally path if we go top-N (electionMath addition, pure + tested).

Interim safety: keep a **bounded** appointment fallback ONLY to prevent a fully empty legislature deadlocking the bill pipeline (quorum needs bodies), gated behind a config flag and clearly logged as an emergency backstop, not the normal path — or drop it entirely if the owner wants the legislature to be allowed to sit under-filled while elections resolve. This is design question Q4.

### C. Speaker of the Legislature — new voted office (a real internal election)

Introduce a `speaker` position type filled by a real election. The single genuine design decision is the electorate (Q1 below): a real US House elects its Speaker *internally* (members only, majority of the chamber), not by public vote. Recommended: model it that way — a `speaker` election whose eligible voters are the sitting `congress_member` agents and whose candidates are drawn from that same body. Mechanically it is the same pipeline with a restricted voter/candidate pool (a filter on the existing Phase 14 ballot eligibility set, which already excludes candidates from voting on their own race). Trigger it when the legislature is seated and the chair is vacant; term-tie it to the congressional term or make it a standing election on Speaker vacancy. Dashboard card flips from `notModeled` to a real holder.

### D. Committee chairs — voted by committee members (optional, lower centrality)

Real committee chairs are chosen by the majority caucus, not the public. Proposal (if owner wants it in scope): replace `selectChair` (engagement+approval heuristic) with a small election among the committee's own members, same restricted-pool pattern as the Speaker. Lower priority than A/B/C — committee chairs are an internal-procedure office and the current heuristic is defensible as a caucus-seniority proxy. Flag for owner (Q5): worth voting, or leave as an appointed internal role and spend the LLM budget on the higher-centrality seats. If we do vote it, the restricted-electorate election introduced for Speaker generalizes directly — this is where an optional `elections.electorateScope` column (`public` | `congress` | `committee:<name>`) earns its one additive migration, so restricted-pool elections are first-class rather than special-cased per office.

### E. Chief Justice — design question, not a silent default (Q2)

Currently DERIVED by seniority (earliest-appointed sitting justice), which is arbitrary in prod because 6 of 7 justices were seed-batched into the same second. Real US practice is neither seniority nor election: the Chief Justice is a *separate presidential nomination + Senate confirmation* — a distinct appointment, not automatic. Three coherent options for THIS sim, presented for an owner call rather than assumed (Q2):
- **(a) Elected by the sitting justices** (an internal court vote) — cleanest fit with the "every seat is voted" doctrine, symmetric with the Speaker proposal, and defensible as how a collegial body picks its lead. Recommended if the doctrine is applied strictly.
- **(b) Presidential nomination + Congress confirmation** — most faithful to real US mechanics, but it is an *appointment* channel (the President picks, the body confirms), which sits in tension with "never appointed by fiat" unless the confirmation vote is treated as the voted mechanic. This also builds toward the `simulation-completeness.md` §9 Senate-confirmation mini-process, so it has reuse value beyond the chief.
- **(c) Keep seniority** — acceptable only if the justice-seating batch-tie is fixed so seniority is meaningful; still the odd seat out under a strict voted-seats doctrine.

### F. Cabinet secretary and lower justice — decide model-or-remove (Q6)

Both are declared in `POSITION_TYPES`, salaried, ranked, and UI-labeled, but no code creates them. They are dead aspirational offices. Either give them a filling mechanic (cabinet = presidential appointment + confirmation, per §9 of the completeness spec; lower justices = same auto-fill or election as the Supreme bench) or remove them from the constants and salary tables to stop them implying offices that will never fill. Lowest priority; recommend deferring the *build* but making the keep-or-cut call now so the matrix isn't misleading. Not a doctrine violation today (nothing is being filled wrongly — nothing is being filled at all).

### G. Supreme Court justice seating — flag, defer (Q6-adjacent)

Justices are reputation-rank appointed (`agentTick.ts:3227-3248`). Real justices are appointed, not elected, so this is the one APPOINTED seat that arguably *should* stay an appointment — but by fiat-of-reputation, not by any agent decision. If the doctrine is applied maximally, justice seating becomes the presidential-nomination + confirmation channel (shared with cabinet, §9). Recommend treating justices together with the chief-justice decision (E) since they are the same body.

---

## Recommended build order

1. **Gap A (candidacy declaration + `registration -> campaigning`)** — keystone, unblocks every real election; ship first, dark-flaggable, verify one full president election runs organically end-to-end into `votes`.
2. **Gap B (congress elections)** — highest-count doctrine violation; reuses A's pipeline + a multi-winner tally.
3. **C (Speaker)** — new voted office, introduces the restricted-electorate pattern.
4. **E + G (Chief Justice / justice seating)** — one owner decision, one body.
5. **D (committee chairs)** and **F (cabinet/lower justice)** — optional, lowest centrality; do or cut per owner.

## Design questions requiring an owner call

- **Q1 — Speaker electorate.** Public vote (like President) or sitting-Congress-only internal vote? Recommend congress-only (matches a real House; keeps the office an internal-procedure seat). The engine runs the election either way — this only sets who is eligible to cast/receive ballots.
- **Q2 — Chief Justice selection.** Elected by the justices (a), presidential nomination + confirmation (b), or keep fixed seniority with the batch-tie fixed (c)? Recommend (a) under a strict voted-seats doctrine; (b) if you want to build the confirmation channel now.
- **Q3 — Congress election shape.** One multi-winner race per election cycle (top-N by ballots), or one single-winner race per open seat? Recommend a single multi-winner race per cycle — fewer LLM ballots, closer to a general election, and it maps cleanly onto a top-N tally.
- **Q4 — Under-filled legislature.** While a congress election resolves, may the legislature sit below `congressSeats` (no appointment backstop), or keep a bounded emergency appointment fallback to preserve bill-pipeline quorum? Recommend allowing under-fill with a quorum floor; keep a flagged, clearly-logged emergency backstop only if empty-legislature deadlock is observed.
- **Q5 — Committee chairs.** Vote them (committee-member election) or leave the current engagement+approval appointment as an accepted internal-procedure heuristic? Recommend leave-as-is for now; revisit after A/B/C land.
- **Q6 — Cabinet secretary + lower justice.** Model them (via the confirmation channel) or remove the dead types from constants/salary/UI? Recommend cut-or-defer the build now, decide keep-or-remove so the office matrix stops implying phantom seats.

## Minor cleanups surfaced by the audit (not doctrine issues)

- `ELECTION_STATUSES` (`constants.ts:55-62`) carries a dead `'counting'` value never written anywhere — drop it.
- Two `positions.type` read-filters (`agentTick.ts:509`, `:6100`) include `'leader'`, which is never a valid position type — the real "leader" concept is `party_memberships.role`. Dead filter term; remove for clarity.
- `cabinet_secretary` and `lower_justice` (gap F) are the same class of dead declaration.

## Non-goals for this work

Confirmation mini-process build-out (`simulation-completeness.md` §9), continuing-resolution/shutdown mechanics (§B), and any world-model coupling are out of scope. This spec is strictly about making leadership seats fill through real voted elections instead of appointment/seniority/seed/nothing.
