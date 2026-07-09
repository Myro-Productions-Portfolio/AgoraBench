# Spec: Office-Selection Fidelity — replicate how each seat is *really* filled

*2026-07-08 — audit + spec. Owner constraint: for every office, research how the real US government fills it and replicate that mechanic as faithfully as the sim's infrastructure allows. The engine provides the faithful mechanic (the vote/appointment actually happens, counted honestly); it never biases who wins, and it installs **no** anti-lobbying / anti-bloc / "vote your constituents" guardrail. Who gets lobbied and how an agent votes is emergent policy — hands off. This is the hard form of the project's "engine is physics, not policy" doctrine (`ROADMAP.md` §0, `DIVERGENCE_EXPERIMENT.md` §1.5).*

---

## 0. The core problem this spec fixes

Today, **the engine picks the winner** for four of the sim's six offices. That is exactly the doctrine violation the owner is calling out — a deterministic scoring function *is* a wall, not a seam. The real US government fills every one of these seats by a **vote or an appointment made by other officeholders**, not by a reputation/engagement ranking. This spec replaces each engine-decided seating with the real-world selection process, faithfully mirrored.

| Office (`positions.type`) | How the sim fills it TODAY | How it's REALLY filled | Faithful? |
|---|---|---|---|
| `president` | National popular-vote `COUNT(*)` of ballots (`electionMath.tallyElectionVotes`) | Popular vote **by state → Electoral College**, 270 to win, winner-take-all (ME/NE district method) | **No** — missing the EC layer |
| `congress_member` | Auto-fill by **reputation rank** (`agentTick.ts` Phase 14, ~5581) | Popular vote **per district/state** | **No** — appointed by fiat, no districts |
| `committee_chair` | Engine scores engagement + approval/100, hash tiebreak (`committeeAssignment.selectChair`, Phase 0.5) | Majority-party caucus/conference **vote** (steering committee nominates, conference ratifies; contested = secret ballot) | **No** — engine-decided |
| `supreme_justice` | Auto-fill top-`reputation` agents not holding a seat (Phase 10, ~3218) | President **nominates**, Senate **confirms** (advice & consent, majority vote) | **No** — engine-decided, no nomination/confirmation |
| `cabinet_secretary` | **Never created** — type is defined, salaried, ranked, titled, but no code ever inserts one | President **nominates**, Senate **confirms** | **No** — office doesn't exist |
| `lower_justice` | Never created (defined only) | President nominates, Senate confirms | **No** — office doesn't exist |
| "Speaker" | No backend concept at all (relabeled "Not tracked" in PR #35) | House elects its own Speaker by internal roll-call vote of sitting members, majority of votes cast | **N/A** — doesn't exist yet |

Two clean families emerge, and the real world draws the exact same line:

- **Elected seats** (president, congress, Speaker, committee chair): filled by a *vote*. The voters differ — citizenry (via EC for president; per-district for congress) vs. sitting members (Speaker, chairs) — but the mechanic is a ballot count.
- **Appointed seats** (cabinet, all justices): filled by *nomination + confirmation* — the president names someone, the legislature confirms by majority vote.

The sim currently has neither an EC layer, a Speaker, an appointment/confirmation flow, nor per-district congress. It has one real mechanic that works: cast ballots → honest `COUNT` → winner (`electionMath`, E3 slice A). Everything below reuses that honest-count primitive and the honest-legislative-vote primitive (Phase 1.7 / `tallyWeightedRatification`) rather than inventing new scoring.

---

## 1. Real-world mechanics (researched, sourced) — the targets to mirror

Each is the *answer*, not a design question, per the owner's directive.

### 1.1 President — Electoral College
Citizens vote **within their state**; each state casts its **electoral votes** (= House seats + 2 senators; min 3; 538 total, 270 to win) **winner-take-all** to the state popular-vote plurality. ME/NE split by congressional district (2 at-large + 1 per district). The national popular-vote total does **not** decide the winner. If no one reaches 270, a contingent election is thrown to the House (one vote per state delegation).
Sources: [National Archives — About the EC](https://www.archives.gov/electoral-college/about), [USAGov — Electoral College](https://www.usa.gov/electoral-college), [Wikipedia — US Electoral College](https://en.wikipedia.org/wiki/United_States_Electoral_College).

### 1.2 Speaker of the House
The House **elects its own Speaker** by **roll-call vote of sitting members**, a quorum present. Each party caucus nominates a candidate beforehand; on the floor members call out a name; **a numerical majority of votes cast "for a person by name"** wins (not necessarily 218 — "present"/absent lower the bar). No majority → repeated balloting until someone clears it. Not a citizen election, not an appointment.
Sources: [CRS R44243 — Electing the Speaker (FAQ)](https://www.congress.gov/crs-product/R44243), [House History — Multiple-Ballot Speaker Elections](https://history.house.gov/People/Office/Speakers-Multiple-Ballots/).

### 1.3 Committee chairs
Two-step, internal to the **majority party**: the party's **steering committee** ("committee on committees") nominates a chair (seniority is the strong traditional default but **not binding**), then the **full party caucus/conference ratifies by majority vote**; contested races are decided by **secret ballot**. The full House then approves the slate. Minority party names a "ranking member" by the same process.
Sources: [CRS R46786 — House Committee Assignment Procedures](https://www.congress.gov/crs-product/R46786), [House History — Committees Fact Sheet](https://history.house.gov/Education/Fact-Sheets/Committees-Fact-Sheet2/), [Senate — Committee Assignments](https://www.senate.gov/about/origins-foundations/committee-system/committee-assignments.htm).

### 1.4 Congress members
Popular vote **within a district (House) or state (Senate)** — a geographic constituency, not a national pool and not an appointment. (The sim is unicameral — "the Legislature" — so the faithful analog is per-constituency election, not reputation auto-fill.)

### 1.5 Cabinet secretaries & all justices — appointment + confirmation
President **nominates**; **Senate confirms by majority vote** ("advice and consent," Appointments Clause). Justices are lifetime; cabinet serve at the president's pleasure. Same two-beat shape for both: *nominate → legislature votes → seated iff majority yes*.
Sources: [Senate — About Nominations](https://www.senate.gov/about/powers-procedures/nominations.htm), [CRS R44234 — SCOTUS Appointment Process](https://www.congress.gov/crs-product/R44234), [Constitution Annotated — Appointments Clause](https://constitution.congress.gov/browse/essay/artII-S2-C2-3-1/ALDE_00013092/).

---

## 2. What we build — per office

Design rule for all of it: **reuse the two honest-count primitives already in the codebase.** Elected seats → cast `votes` rows + `electionMath.tallyElectionVotes` (real ballots, deterministic tie-break, already tested). Internal legislative votes (Speaker, chair ratification, confirmation) → the Phase-1.7 weighted-alignment tally already extracted as `tallyWeightedRatification` in `committeeAssignment.ts` — an agent's `alignment` in `[0,1]` toward the nominee is their probabilistic yes/no, exactly how floor votes already resolve. No new scoring function decides an outcome anywhere.

The build order is by **fidelity gain per unit of infrastructure**, cheapest and most doctrine-critical first. Chairs and Speaker are pure internal votes over the *existing* agent set — no new districts, no EC geography, no new tables in the minimal form — so they come first. President-EC and per-district congress need a geography layer (state/district seeding) that overlaps the World Model's cohort layer (E5) and the Government Vertical's state tier — so they're specified but sequenced later, and flagged where they genuinely depend on unbuilt infrastructure.

### 2.1 Committee chairs → majority-caucus vote (SLICE 1, do first)

**Replace** `selectChair`'s engine scoring with an internal vote of the committee's members.

Faithful mapping to the sim's flatter structure (unicameral, party alignments exist as `agents.alignment`):
1. **Nominee pool** = the committee's active members (the `committee_memberships` roster Phase 0.5 already builds). Seniority's real-world role → order the pool by tenure on that committee (`committee_memberships.assignedAt` asc) purely to pick the *nominee presented first*; this is a presentation order, **not** a winner-decider (mirrors "steering committee nominates, traditionally by seniority, but the vote decides").
2. **The vote**: the committee members vote on the nominee. Each member's `alignment` toward the nominee (their vote-alignment / sentiment from `agent_relationships`, same signal Phase 1.7 uses) feeds `tallyWeightedRatification(alignments, 0.5)`. Majority yes → seated as chair. Majority no → next nominee in order is put forward; repeat until one passes or the pool is exhausted (mirrors multi-ballot reality).
3. **No majority at all** (pathological, all nominees rejected) → committee runs chairless that tick exactly as today (`Phase 3 auto-advances its bills`). This is a faithful outcome (a real committee can deadlock), not an error.

Contested-race realism note: the owner wants lobbying/bloc behavior *possible*. It already is — `agent_relationships` alignment is shaped by prior deals, lobbying (`agent:lobby` events), and bloc voting. We feed that unaltered signal in; we do **not** normalize it, cap it, or add a "vote independent of relationships" term.

**Files:** `committeeAssignment.ts` (add `runChairElection` beside `selectChair`; keep `selectChair` only if something else uses it — grep says no, so delete it), `agentTick.ts` Phase 0.5 (~308–347) swaps the scoring loop for the vote loop. Pure vote logic stays in `committeeAssignment.ts`, unit-tested like the rest.
**Schema:** none required for the minimal form. Optional: a `chair_elections` log table for observability (defer — activity events already record the appointment).
**Config (four-things rule):** `committeeChairElectionEnabled` (bool, default **false** — ships dark, flip to cut over from the old scoring). One field, full four-things treatment (server whitelist branch + clamp, AdminPage control, client interface, persistence verify).

### 2.2 Speaker of the Legislature → internal roll-call vote (SLICE 2)

**New office**, mirroring the House electing its own presiding officer. Add `'speaker'` to `POSITION_TYPES`.

1. **Trigger**: after Phase 0.5 seats/refreshes congress, if there is no active `speaker` position and ≥ quorum of congress members are seated, run a Speaker election. Real cadence: at the start of each new Congress; sim analog: on vacancy or at the start of a new congressional term (`congressTermDays`).
2. **Candidates**: nominated per party bloc — for each `alignment` group with seated members, the highest-tenure seated member (earliest `positions.startDate`) is that bloc's nominee. (Presentation order only; the vote decides.)
3. **The vote**: **all seated congress members** cast a ballot for a nominee — this is a real cast-ballot election among a *closed electorate of sitting members*, so it reuses `votes` + `tallyElectionVotes`, not the weighted tally. Winner = **majority of votes cast** (abstentions/`present` lower the threshold, faithfully). No majority → re-ballot (cap iterations per tick; carry to next tick if still deadlocked — a faithful "House can't organize" state, which really happened in 2023).
4. Seated as `type:'speaker'`, salaried at the congress+bonus tier (add to `SALARY_TABLE`; the real Speaker is paid above rank-and-file). Speaker is **also** a sitting congress member — do **not** vacate their congress seat (the real Speaker holds their House seat); this is the one deliberate exception to the double-position vacate rule, gate it in `getSeatsToVacate` by leaving `speaker` rank equal to `congress_member`.

**Files:** `constants.ts` (`POSITION_TYPES`), `finalizeElection.ts`/`electionMath.ts` (`OFFICE_RANK` + title map — speaker = congress rank so no lower-seat vacate), a new Phase (14.5 or fold into 0.5) for the election, `simulationCore.ts` `SALARY_TABLE`, plus the `government.ts` overview + UI label surfaces that PR #35 relabeled to "Not tracked" (now becomes real).
**Config:** `speakerElectionEnabled` (bool, default false). Optionally `speakerReballotCap` (int, iterations/tick before deadlock carries over).
**Doctrine check**: the Speaker having real floor power (agenda control) is a *later* policy question — this slice only fills the seat faithfully. Giving the Speaker mechanical agenda power without the agents legislating it would be installing policy in the engine. Seat-fill now; powers are a separate, agent-legislated question.

### 2.3 Cabinet secretaries & justices → nominate + confirm (SLICE 3)

**New selection flow** for `cabinet_secretary`, `supreme_justice`, `lower_justice`. Currently justices engine-appoint and cabinet doesn't exist; both become **president nominates → Legislature confirms**.

1. **Vacancy detected** (Phase 10 for justices up to `supremeCourtJustices`; a new cabinet vacancy check for the 4 `CABINET_POSITIONS`).
2. **Nomination**: the sitting president (an LLM agent) is prompted to nominate a candidate for the vacant seat — a real agent decision, logged like any other. If there's no sitting president, the seat stays vacant (faithful — no president, no nominations; today's engine auto-fill silently violated this).
3. **Confirmation vote**: seated congress members vote to confirm. Reuse `tallyWeightedRatification(alignments toward nominee, 0.5)` (a real Senate confirmation is a simple-majority floor vote). Majority yes → seated. Majority no → president nominates again next cycle (faithful — rejected nominees happen; the seat stays open meanwhile).
4. Removes the reputation-rank auto-fill for justices (Phase 10 ~3218–3260) and never adds one for cabinet.

**Files:** `agentTick.ts` Phase 10 (justice fill → nominate+confirm), new cabinet phase, `ai.ts` (nomination prompt builder), `finalizeElection.ts` title map already has these, `electionMath.getSeatsToVacate` (a president keeps their office; nominating doesn't move them; a *confirmed* nominee vacates lower seats per existing rule).
**Config:** `appointmentConfirmationEnabled` (bool, default false). While false, justices keep today's reputation auto-fill and cabinet stays empty (fully dark cutover).
**Note**: this slice aligns with roadmap **E6 (Executive Package + Administrative State)**, which already earmarks "confirmations." If E6 is close, fold this there; the mechanic spec above is the same either way.

### 2.4 President → Electoral College (SLICE 4, geography-dependent)

**Add the EC layer** over the existing presidential ballot flow. The owner is explicit: replicate popular-vote-**into**-Electoral-College faithfully, flaws and all — do **not** switch to national popular vote (which is what the sim does today), and do **not** "fix" the EC to his own preference.

Faithful mechanic:
1. Each voting agent is assigned a **state** (needs a `state` dimension on the voter population — see dependency note). Ballots are cast as today (`votes` rows) but **tallied per state**.
2. Each state has **electoral votes** (seed from real 2024 apportionment; 538 total). Winner-take-all: the state's plurality winner takes all its EVs (ME/NE district split is a faithful refinement — include if district geography exists, else document the simplification).
3. **270 EVs wins.** `tallyElectionVotes` runs *per state* to get each state's plurality; a new pure `tallyElectoralCollege(stateResults, evByState)` sums EVs. No one reaches 270 (all-abstain / exact tie) → contingent election in the Legislature (one vote per state delegation) or, minimally, documented deadlock.

**Dependency (flag, not a blocker):** this needs a **state dimension on voters**. That geography is *already coming* — the World Model spec's cohort layer "carries a state dimension from day one" (`world-model.md`), and `government-vertical.md` seeds 5 real states. Building EC before that geography exists means seeding a states+EV table just for this. **Recommendation:** sequence Slice 4 after (or alongside) the World Model cohort layer (E5) so the state assignment is shared, not duplicated. Until then, president correctly stays a single honest national count — which is a *known, documented* infidelity, not an engine picking the winner (the ballots are still real and honestly counted; only the aggregation geography is missing).

**Files:** new pure `tallyElectoralCollege` in `electionMath.ts` (+ tests), a `states`/`electoral_votes` seed (or reuse the vertical's state table), `finalizeElection.ts` presidential branch tallies per-state then EC.
**Config:** `electoralCollegeEnabled` (bool, default false).

### 2.5 Congress → per-district election (SLICE 5, geography-dependent, lowest priority)

Faithful target: congress members elected **per constituency**, not reputation-auto-filled nationally. Same state/district geography dependency as Slice 4 — the honest reuse is: districts are constituencies, each runs its own `votes`+`tallyElectionVotes`. **Sequence with Slice 4 / the World Model geography.** Until then, the reputation auto-fill is the documented placeholder (and is the least doctrine-offensive of the four, since congress seats are fungible and the sim is unicameral — but it's still "engine picks who sits," so it's on the list to fix, not exempt).

---

## 3. Sequencing & why

| Slice | Office | New infra needed | Dependency | Priority |
|---|---|---|---|---|
| 1 | Committee chairs | none (votes over existing members) | — | **First** — pure fidelity win, zero new geography |
| 2 | Speaker | `speaker` position type | — | Second — internal vote, no geography |
| 3 | Cabinet + justices | nomination prompt + confirm vote | sitting president exists | Third — aligns with E6 |
| 4 | President (EC) | state dimension + EV table | World Model geography (E5) / vertical | After geography exists |
| 5 | Congress (districts) | district dimension | same as Slice 4 | Last — shares Slice 4's geography |

Slices 1–3 are buildable now and remove the three engine-decides-winner violations that are pure internal-agent politics (chairs, Speaker, appointments). Slices 4–5 are the two that genuinely need a geography layer the roadmap is already building — specified here so they're not re-derived, sequenced so they share that layer instead of duplicating it.

---

## 4. Non-negotiables carried from project doctrine

- **Every new `RuntimeConfig` field** (`committeeChairElectionEnabled`, `speakerElectionEnabled`, `appointmentConfirmationEnabled`, `electoralCollegeEnabled`, any caps) gets the **four things in the same commit** (server whitelist branch + clamp, AdminPage control, client interface, persistence verify) — CLAUDE.md rule #1.
- **All flags default off; each slice ships dark** and cuts over via admin toggle — matches the fiscal-consequence-loop pattern.
- **No `ANY(jsArray)` raw SQL; use `inArray`** (rule #2). Vote tallies group in-DB or in pure functions.
- **Pure vote/tally logic lives in `electionMath.ts` / `committeeAssignment.ts`**, unit-tested, DB-free — mirroring `courtMath`/`fiscalMath`. The tick calls the pure function; it never scores an outcome inline.
- **No editing existing migrations** — additive migrations only if a slice needs a table (Speaker needs none; EC needs a states/EV seed table).

## 5. The hard line the owner drew (restate, because it's the whole point)

The engine's only job per office is: **run the real mechanic and count honestly.** It must never —
- bias or predetermine who wins (the current engine-scoring is exactly this bias; removing it is the deliverable),
- add anti-lobbying, anti-bloc, or "vote your constituents" logic (agents may be lobbied, may bloc-vote, may betray constituents — that's the experiment),
- or normalize/cap the relationship-alignment signal that carries lobbying and bloc dynamics into the vote.

Whether AI officeholders resist or fall into the same failure modes as human institutions is a **result we measure**, produced by feeding the honest mechanic the agents' unaltered behavior — not an input we engineer.

## 6. Open items genuinely worth flagging (not guesses — real gaps)

1. **EC/district geography timing** (§2.4/2.5) — a sequencing decision, not a mechanic question: build the state/district dimension here, or wait for and share the World Model's. Recommendation: share it. Owner's call on timing only.
2. **Speaker floor powers** — deliberately *out of scope*: seat-fill is engine (physics); giving the Speaker mechanical agenda control is policy the agents should legislate. Flagged so it isn't quietly added.
3. **Cabinet secretary *function*** — this spec fills the four cabinet seats faithfully (nominate+confirm). What a confirmed secretary *does* (executive power surface) is E6's Executive Package, not this spec. The office existing and being filled correctly is the fidelity fix; its powers are separate.
