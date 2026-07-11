# Spec: Elections Broadcast Page — backend-first, Electoral College, geographic map

2026-07-11. Research + spec + implementation plan for a three-phase "election broadcast" Elections
page, derived from the owner's Claude Design mockup at
`~/Downloads/broadcast-dashboard-mockup/project/Elections.dc.html`. The mockup is a design spec, not
code to copy — it runs entirely on fabricated data (5 fictional candidates, a hand-rolled IRV engine,
invented funding histories and itineraries). No fabricated election data ships to the live site.

Related prior work this spec builds on and must not duplicate or contradict:
- `docs/specs/2026-07-08-office-selection-fidelity.md` §2.4 — the Electoral College mechanic (shipped
  dark in PR #40, commit `c04fbb3`).
- `docs/design-briefs/05-election-night.md` — the existing broadcast design intent for the per-election
  detail page (`ElectionDetailPage.tsx`), including the `ElectionPodium`/`BallotTicker`/`RaceCallBanner`
  component sketches. This spec covers the elections *index* broadcast (campaign trail + national map);
  the two are complementary, not competing.
- `docs/DIVERGENCE_EXPERIMENT.md` §1.5 — the engine-is-physics-not-policy doctrine.

---

## 1. Summary

Rebuild the Elections index page (`ElectionsPage.tsx`) as a three-phase broadcast — Campaign Trail,
Election Night, Inauguration — riding real simulation data. The page is a spectator surface; the
backend supplies real per-state and Electoral College results that today are computed and thrown away.
Most of the work is backend: persist and serve the per-state winners and EV tallies the finalize path
already computes, add a per-state live-tally read during `voting`, and surface campaign data that
exists. The frontend then reuses the existing geographic `ChoroplethMap` (recolored per winning
candidate) and the existing design-system components.

The three locked owner decisions, restated as hard constraints:

1. **Backend first.** Every mockup data element is classified as already-exists, needs-new-backend, or
   out-of-scope (§2). Nothing fabricated ships as if real.
2. **Keep the Electoral College, reject ranked-choice.** The mockup's headline mechanic ("no electoral
   college, pure ranked-choice IRV with round elimination") is rejected outright — it contradicts the
   faithful EC shipped in PR #40 and the §1.5 doctrine ("replicate real-world processes including their
   flaws, never invent improved mechanics"). The page presents the real EC: per-state winner-take-all,
   270 of 538 EVs to win. The mockup's round-by-round tabulation UI is dropped and replaced with an
   EC-appropriate equivalent (per-state calls, a running EV total, a 270 line).
3. **Geographic choropleth, not the tile cartogram.** Reuse the existing `ChoroplethMap` (real US state
   SVG paths), recolored per winning candidate/party. The mockup's square-tile cartogram (`STATE_GRID`)
   is dropped.

---

## 2. Gap analysis

Each data element the mockup renders, classified against the real backend. "Exists" = already
available via a current API/table/column. "New backend" = must be built or served. "Out of scope" =
deliberately not built, with the reason.

| Mockup data element | Verdict | Real source / what's needed |
|---|---|---|
| Candidate identity (name, alignment, avatar) | Exists | `campaigns` join `agents`; `GET /elections/:id` `candidates[]` (`displayName`, `alignment`, `avatarConfig`). |
| Candidate platform | Exists | `campaigns.platform` (text, notNull). In `/:id` `candidates[].platform`. |
| Candidate party | Exists | `partyMemberships` join `parties`; `/:id` `candidates[].party {name, abbreviation}`. |
| Endorsements count | Exists | `campaigns.endorsements` (text, JSON-string array; parse and count client-side, as `ElectionsPage.tsx` already does). |
| Funding raised (single number) | Exists | `campaigns.contributions` (integer scalar). In `/:id` and `/past`. |
| Funding history over time (sparkline) | Out of scope | No per-tick contribution history table exists; `contributions` is a single mutable scalar. Same class of gap as the deferred `fiscal_tick_summaries` history work (TODO). Drop the sparkline; show the current scalar only. |
| Poll percentage / "momentum" (sparkline) | Out of scope (as time-series) | The mockup's `pollHistory` is fabricated. The real analog is contribution-share (`contributions / totalContributions`), computed client-side, already in `ElectionsPage.tsx`. Show the current share; no historical sparkline. |
| National popular vote tally (live, per candidate) | Exists (national) / New (per-state) | `GET /elections/:id` returns national `candidates[].voteCount`/`votePercentage`. Per-state live tally does not exist — see §3.2. |
| Per-state winner (map coloring) | New backend | Computed transiently in `finalizeElection.ts` L180-184 and discarded. Must be persisted + served (§3.1). |
| Electoral vote total per candidate | New backend | Computed in `finalizeElection.ts` L185-191, survives only inside `election_completed` activityEvents metadata JSON. Must be persisted + served (§3.1). |
| EV running total toward 270 | New backend | Derived from persisted per-state winners + `ELECTORAL_VOTES`. Served alongside §3.1. |
| Campaign itinerary (state-hopping dots) | Out of scope | No itinerary/travel schedule exists in schema; the mockup's `itinerary` arrays are fabricated. There is no candidacy-declaration or campaign-scheduling mechanic (TODO active gap). Drop the hopping-dots animation. See §4 for the real map treatment during Campaign Trail. |
| Candidate "next stop" / rally event modal | Out of scope | Same reason; `calendar_events` has styling for `election_rally` but nothing ever writes one (TODO active gap). Drop or stub the event modal. |
| Round-by-round elimination / IRV tabulation | Rejected (doctrine) | The engine is Electoral College, not IRV (decision #2). Replaced by per-state calls + EV tally. |
| "161M ballots cast" denominator | Out of scope | Fabricated. Real ballots are cast by agents (dozens), not citizens; `totalVotes` is the real count. Show the real ballot count, no fake 161M denominator. |
| Ballots-counted / % reporting | New backend (optional) | Real analog = states called so far / 51 during counting. Derivable from §3.1/§3.2. Optional. |
| Election phase / status | Exists | `elections.status` lifecycle: `scheduled, registration, campaigning, voting, certified`. Note `counting` is referenced in the active-filter but has no writer (vestigial) — treat `voting` as the live phase. |
| Countdown to election | Exists | `ElectionBanner` + `useActiveElection` hook already compute this; wired to `registrationDeadline`/`votingStartDate`/`votingEndDate`. |
| Activity feed (campaign events) | Exists (partial) | `ActivityFeed` component + activity events exist; a real campaign-scoped feed can be assembled from existing activity/websocket events. No new schema. |
| Inauguration oath / ceremony | Exists (data) / Frontend-only (staging) | Winner + party + final margin all exist post-`certified`. The oath text and "witnesses" framing are pure presentation over real winner/loser data. No backend. |
| Final tally / order of elimination | Reframed | "Order of elimination" is an IRV concept (rejected). Reframe as final EV ranking + national vote ranking, both real. |

Headline: **the map's data (per-state winners, EV tallies) is the only genuinely new backend surface,
and the engine already computes it — it's discarded, not missing.** Everything else is either already
served, a presentation layer over real data, or fabricated mockup detail that gets dropped.

---

## 3. Backend spec

Design rule inherited from doctrine and project rules: persist and serve what the honest engine already
computes; do not add scoring, do not fabricate. All pure tally logic stays in `electionMath.ts`
(already the home of `tallyElectionVotes`, `tallyElectoralCollege`, `assignVoterState`), unit-tested,
DB-free. Migrations are additive-only; on a fresh DB use `drizzle-kit push` then seed (project pitfall).

### 3.0 What already exists (do not rebuild)

- `src/core/server/lib/electoralCollege.ts` — `ELECTORAL_VOTES` (51 keys = 50 states + DC, 538 total,
  keyed by 2-letter abbreviation), `STATE_ORDER` (alphabetical), `EC_MAJORITY = 270`. Pure seed data.
- `src/core/server/lib/electionMath.ts` — `assignVoterState(agentId, evByState, stateOrder)` (FNV-1a
  hash, no DB, no `agents.state` column), `tallyElectoralCollege(stateResults, evByState,
  candidateOrder, threshold)`, `tallyElectionVotes(ballots, candidateOrder, fallback)`. All pure,
  unit-tested (`tests/unit/server/electionMath.test.ts`, `electoralCollege.test.ts`).
- `src/modules/elections/server/finalizeElection.ts` L163-204 — the live per-state→EC winner path,
  gated by `rc.electoralCollegeEnabled`. Buckets ballots by hashed state, runs `tallyElectionVotes`
  per state, runs `tallyElectoralCollege`, replaces the winner, documents the <270 contingent-election
  fallback (national plurality). This works today; it is off only because the flag defaults false.
- `RuntimeConfig.electoralCollegeEnabled` — declared `runtimeConfig.ts` L202, default `false` L393,
  full four-things treatment already shipped (admin whitelist branch `admin.ts` L526, AdminPage control
  + interface L213/L3189). No new config work needed to activate; the flag is complete.

### 3.1 Persist per-state winners and EV tallies (the core new work)

Today `stateResults` (per-state plurality winners) is computed at `finalizeElection.ts` L180-184 and
discarded; `evByCandidate` survives only inside the `election_completed` activity event metadata. The
map needs both, queryable per election.

Option A (recommended) — additive columns on `elections`, JSON-typed:
- Add `stateResults jsonb` — `{ [stateAbbr]: winnerAgentId }` (51 keys at most).
- Add `electoralVotes jsonb` — `{ evByCandidate: { [agentId]: number }, totalEvAllocated: number,
  winnerId: string|null, reachedMajority: boolean }` (exactly the `electoralResultNote` shape already
  built at `finalizeElection.ts` L186-191).
- Written in the same `db.update(elections).set(...)` at L244-252 that already sets `status:'certified'`.
- Null on non-presidential or non-EC elections — the API omits the EC block when null.

Option B — a `state_results` table (`electionId`, `state`, `winnerId`, `evAwarded`). More normalized,
better if per-state data grows (margins, per-state vote counts). Heavier: a migration + a join. Given
the data is small and read-mostly, Option A is the thinner slice. Recommend A; note B as the upgrade
path if per-state vote breakdowns are wanted later.

Migration: one additive migration adding the two columns (Option A). No edits to existing migrations.

Serve it: extend `GET /elections/:id` (`elections.ts` L191-208) to include, when present:
```
electoralCollege: {
  enabled: boolean,               // rc.electoralCollegeEnabled at certification time
  stateResults: { [stateAbbr]: winnerAgentId },
  evByCandidate: { [agentId]: number },
  totalEvAllocated: number,
  threshold: 270,
  winnerId: string | null,
  reachedMajority: boolean,
}
```
Field whitelist on the way out (read path, so low risk, but keep the response shape explicit — do not
spread the raw row). No auth change: the elections routes are intentionally public (spectator data),
consistent with `/world`.

### 3.2 Per-state live tally during `voting` (optional, second slice)

For an active (`voting`) presidential election, the map wants provisional per-state leaders before
certification. This does not exist. Two options:

- Compute-on-read: a new `GET /elections/:id/electoral` that runs the same bucket-by-hashed-state +
  `tallyElectionVotes` per state over the ballots cast *so far*, returning provisional `stateResults`
  + provisional `evByCandidate`. Pure reuse of `assignVoterState` + `tallyElectionVotes` +
  `tallyElectoralCollege`; no new math, no writes. Polled by the client on an interval (the design
  brief 05 already establishes polling, not per-ballot WS, as the liveness model).
- Persist-on-tick: have the Phase 14 vote pass write a provisional snapshot each tick. Heavier, adds a
  write path; unnecessary given the read is cheap. Recommend compute-on-read.

Guard: only runs when `rc.electoralCollegeEnabled` and `positionType === 'president'`; otherwise the
endpoint returns `{ enabled: false }` and the client shows the national tally only.

### 3.3 EC flag activation

Activating EC on the live site is a config flip (`electoralCollegeEnabled = true` via the admin panel),
identical to the fiscal-consequence-loop dark-flag pattern — no redeploy, rollback = flip false. But:
the per-state persistence (§3.1) must ship and deploy *before* the flip, or the map has nothing to read
for elections certified after the flip. Sequence: land §3.1 dark (flag still false, columns written as
null on national-only certifications) → deploy → flip the flag → the next certified presidential
election populates the columns → the map lights up. No RuntimeConfig field is added by this work; the
flag already exists with full four-things treatment.

### 3.4 New RuntimeConfig fields

None required. If a future slice adds one (e.g. a toggle for provisional live EC), it gets the full
four-things treatment in the same commit per CLAUDE.md rule #1: server whitelist branch + clamp in
`admin.ts` `POST /config`, AdminPage control, client `RuntimeConfig` interface entry, persistence
verify. Called out here so it is not forgotten if scope expands.

### 3.5 What explicitly does NOT exist (do not assume)

- No per-tick funding/poll history (sparklines are fabricated).
- No campaign itinerary / travel schedule / rally scheduling (dots-hopping and the event modal are
  fabricated; the candidacy-declaration and registration→campaigning mechanics are open TODO gaps).
- No `agents.state` column and none needed — state is a pure hash of `agentId` at tally time.
- No IRV / ranked-choice anywhere in schema or code (rejected by decision #2).
- No 161M-citizen ballot model; ballots are agent votes, counted honestly.

---

## 4. Frontend spec

The page adapts the mockup's three-phase structure to the real EC mechanic and real data. The map is
the geographic choropleth. Where the mockup relies on fabricated data, the corresponding UI is dropped
or stubbed (§2).

### 4.0 Page and phase model

`ElectionsPage.tsx` becomes the broadcast host. Phase is driven by the real `elections.status` of the
active presidential election (via `campaignsApi.active()` / `GET /elections/active`), not a spectator
toggle:
- Campaign Trail = `scheduled | registration | campaigning`.
- Election Night = `voting` (the `counting` status is vestigial — no writer — so `voting` is the live
  phase; if a `counting` election ever appears, treat it as live-tally too).
- Inauguration = `certified`.

The existing per-election detail page (`ElectionDetailPage.tsx`, design brief 05) keeps its podium/
race-call treatment for a single election; the index broadcast links into it. Reuse `ElectionBanner`
(props match exactly: `{title, description, targetDate}`) via the existing `useActiveElection` hook for
the countdown.

### 4.1 Shared ChoroplethMap extraction

`ChoroplethMap` is currently inline in `WorldPage.tsx` (L135-209), not exported, and colors each state
by world-event severity. Extract it to a shared component, e.g. `src/core/client/components/
ChoroplethMap.tsx` (or `src/modules/world/client/components/` if kept world-adjacent), generalized:

Current props (severity-coupled):
```ts
{ states: Record<fips, StateAgg>; selectedFips: string | null; onSelect: (fips: string) => void }
```
Generalized props:
```ts
{
  colorForState: (fips: string) => string;      // replaces internal severityTier→SEVERITY_COLORS
  labelForState?: (fips: string) => string | null;  // replaces the "abbr + count" centroid label
  ariaForState?: (fips: string) => string;       // replaces the severity aria-label
  selectedFips: string | null;
  onSelect: (fips: string) => void;
}
```
What stays as-is (already generic): the SVG/viewBox (`US_MAP_VIEWBOX = '0 0 960 560'`), the path/
centroid rendering, the selected-state gold-outline overlay, and the full click + keyboard (Enter/
Space) + focus-visible accessibility machinery. `WorldPage` is refactored to pass severity-derived
callbacks — a pure refactor with no behavior change, verifiable by the world page rendering identically.

Keying bridge (important): the map geometry (`usStatePaths.ts`: `US_STATE_PATHS`, `US_STATE_CENTROIDS`,
`FIPS_TO_STATE`) is keyed by **2-digit FIPS**; the EC data (`ELECTORAL_VOTES`, `STATE_ORDER`,
`stateResults`) is keyed by **2-letter abbreviation**. The Elections consumer bridges via
`FIPS_TO_STATE[fips].abbr` inside its `colorForState`/`labelForState` callbacks (look up the abbr, then
index the EC data). No change to either data source; the bridge lives in the caller.

### 4.2 Campaign Trail (status: scheduled/registration/campaigning)

- `ElectionBanner` countdown to the next milestone (real, via `useActiveElection`).
- Choropleth map, present but neutral — no fabricated per-state lean exists pre-vote, so states render
  in a single base color (or a light party-registration tint only if a real per-state signal is later
  added; none exists now). This is the honest replacement for the mockup's fabricated
  archetype-shaded map and its hopping candidate dots (both dropped).
- Fundraising leaderboard: reuse `CampaignCard` for each real candidate. Note it requires `initials`
  and `accentColor` in addition to the obvious props; `pollPercentage` is contribution-share (already
  computed client-side in `ElectionsPage.tsx`), labeled as contribution share, not vote share.
- Race Summary sidebar: `SidebarCard` with real totals (total raised, candidate count, parties
  represented, current phase). No fabricated "campaign day X/13".
- Campaign Activity: `ActivityFeed` from real activity/websocket events, campaign-scoped.
- Candidate dossier drawer: keep the drawer, populated from real `GET /elections/:id` candidate data
  (platform, contributions, party, alignment, policy positions if available). Drop the fabricated
  funding/poll sparklines and the "next stop" rally modal (no itinerary data). `PixelAvatar` by `seed`.

### 4.3 Election Night (status: voting)

- Choropleth colored by provisional per-state leader from `GET /elections/:id/electoral` (§3.2),
  bridged FIPS→abbr. Uncalled states render neutral. This replaces the mockup's tile map + its
  fabricated per-state returns.
- EV tally, replacing the rejected IRV round-bars: a per-candidate horizontal bar of electoral votes
  won, with a 270 line and a running `totalEvAllocated`. Sourced from the provisional `evByCandidate`.
  This is the EC-appropriate equivalent decision #2 calls for.
- National popular-vote tally sidebar: real `candidates[].voteCount`/`votePercentage` from
  `GET /elections/:id`. Honest, and can visibly diverge from the EC leader — a faithful feature, not a
  bug (mirror the finalize log's divergence note).
- Ballots counted: real `totalVotes` (agent ballots). Optionally "N of 51 states called" from the
  provisional per-state results. No fabricated 161M denominator.
- Liveness: poll `GET /elections/:id` and `/:id/electoral` on an interval (10-20s per design brief 05);
  do not assume a per-ballot WS event exists (there isn't one). React to `election:completed` to switch
  to Inauguration.

### 4.4 Inauguration (status: certified)

- Race-called banner: real winner (avatar, name, party, final EV count + national %). Sourced from the
  persisted `electoralCollege.winnerId`/`evByCandidate` (§3.1) plus national `votePercentage`.
- Oath/ceremony staging with defeated candidates as witnesses: pure presentation over real winner/loser
  identities. The oath copy is static flavor text, clearly presentational.
- Final tally, reframed off IRV: final EV ranking (from `evByCandidate`) and national-vote ranking (from
  `candidates[]`), both real. No "order of elimination".
- `BranchCard` for the executive seating (real winner as President; `BranchCard` takes `branch`,
  `title`, `icon`, `officialName`, `officialTitle`, `officialInitials`, `stats`).

### 4.5 Mockup features dropped, and why

- Ranked-choice/IRV round elimination, redistribution, "rounds of consensus" copy → rejected (decision
  #2, doctrine).
- Square-tile cartogram (`STATE_GRID`) → replaced by geographic choropleth (decision #3).
- Candidate itinerary dots hopping states, speech bubbles tied to itinerary, "next stop" rally modal →
  no itinerary data exists (fabricated).
- Funding-history and poll-history sparklines → no per-tick history exists (fabricated).
- "161M ballots cast" denominator, "51 precincts reporting" → fabricated citizen-scale numbers; use
  real agent-ballot counts and real states-called.

### 4.6 Component prop corrections (from the mockup's `AgoraBench.*` imports)

- `CampaignCard`: also requires `initials` and `accentColor` (mockup omits them); `pollPercentage` is
  contribution share.
- `CapitolIcon`: not a standalone file — import from `src/core/client/components/icons` (barrel);
  props are `IconProps` (`size?`, `className?`, `strokeWidth?`), not the mockup's `class`/`hint-size`.
- `SectionHeader` `{title, badge?}`, `SidebarCard` `{title, items[]}`, `CollapsibleSection`
  `{id, title, subtitle?, children, ...}`, `EventDetailModal` `{event, onClose}`, `ActivityFeed`
  `{items[], fill?}`, `SpeechBubble` `{bubble}`, `MapEventTicker` `{events[]}`, `PixelAvatar`
  `{seed?|config?, size?}` — all confirmed present; wire to real data shapes, not the mockup's fake
  objects.

---

## 5. Phased implementation plan

Thin vertical slices, each independently shippable and verifiable, backend before frontend per decision
#1. Risky bits behind the existing dark flag.

- Slice 0 — ChoroplethMap extraction (frontend-only, no data risk). Extract the inline map to a shared
  generic component; refactor WorldPage to pass severity callbacks. Verify: world page renders
  identically (visual + axe). Small (~half day). Independent of all backend work, can run in parallel.

- Slice 1 — Persist + serve per-state/EV results (backend, dark). Additive migration for the two
  `elections` columns (§3.1); write them in `finalizeElection` alongside the existing certified update;
  extend `GET /elections/:id` to surface them when present. Flag stays false, so columns write null on
  national-only certifications — zero behavior change to the live winner. Verify: unit test the write
  shape; hit `/:id` on a seeded EC-certified election. Small-to-medium (~1 day). Ships before any flip.

- Slice 2 — Elections broadcast page, Inauguration + Campaign Trail on real data (frontend). Rebuild
  `ElectionsPage.tsx` as the phased host; wire Campaign Trail (real candidates/leaderboard/summary) and
  Inauguration (real winner/EV tally, from Slice 1 data) using the shared map. Election Night uses the
  national tally only for now (provisional EC deferred to Slice 4). Verify: `/verify` the page across a
  seeded scheduled election and a certified EC election. Medium (~1-2 days).

- Slice 3 — Flip `electoralCollegeEnabled` (config, no code). After Slices 1-2 deploy, flip the flag via
  admin; the next certified presidential election populates the EC columns and the map. Rollback = flip
  false. Trivial, but gated on a live presidential election existing — coordinate timing. Owner-owned
  decision (see §6).

- Slice 4 — Provisional live EC during `voting` (backend + frontend). Add `GET /elections/:id/electoral`
  (compute-on-read, §3.2); wire the Election Night map + EV bars to poll it. Verify: `/verify` against a
  live `voting` election. Medium (~1 day). Independent follow-on; the page is already shippable without
  it (Election Night falls back to national tally).

Sequence: Slice 0 ∥ Slice 1 → Slice 2 → Slice 3 → Slice 4. Slices 0 and 1 are independent and can run
concurrently in isolated worktrees.

---

## 6. Open questions / owner decisions

1. Per-state persistence shape — Option A (two `jsonb` columns on `elections`, recommended) vs Option B
   (a normalized `state_results` table). A is thinner; B is the upgrade path if per-state vote
   breakdowns/margins are wanted later. Defaulting to A unless you want B.
2. EC flip timing (Slice 3) — flip `electoralCollegeEnabled` as soon as Slices 1-2 are live, or wait for
   a specific election? The map only populates from the next presidential certification after the flip.
   Recommend flip immediately once persistence is deployed.
3. Provisional live EC (Slice 4) — build it, or is national tally + final EC map enough for the live
   broadcast feel? Recommend building it; the page is shippable without it either way.
