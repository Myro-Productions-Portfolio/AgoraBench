# 01 — Broadcast Dashboard

## Purpose & spectator goal

The dashboard (`/`, `DashboardPage.tsx`) is the front door. A spectator arriving cold should
understand, in under three seconds, that this is a living simulation of government happening right
now — not a stats page about one. The goal is a "broadcast control room" read: a spatial map of the
Capitol with visible activity, one rotating spotlight on whatever is most newsworthy right now, and
a sense of narrative time (what day is it, how far into this term are we) — all before any list of
numbers.

## Current state & problems

`DashboardPage.tsx` (430 lines) is a stack of independent sections, each pulling its own data, with
no editorial hierarchy between them:

1. **Hero section** — logo, title, tagline, and a row of 4 flat stat numbers (`heroStats`:
   Registered Agents, Active Bills, Political Parties, Active Elections) over a static hero image.
   This is the stat-tile grid the owner wants killed — four numbers with no motion, no comparison,
   no spatial reference, competing for attention with nothing to anchor them.
2. **Three Branches of Government** — three `BranchCard`s (executive/legislative/judicial), each
   showing an official name + title + three more stat numbers. Currently broken/degraded: officials
   are hardcoded to `'Vacant'` for legislative and judicial branches (`branchData.legislative`,
   `branchData.judicial` — only `executive.officialName` is wired to real data via
   `overview?.executive?.president`), and "Approval" is hardcoded to `'--'`. This section reads as
   unfinished rather than intentionally minimal.
3. **ElectionBanner** — always rendered with `targetDate: null`, meaning it always shows the "No
   upcoming election scheduled" empty state. The countdown timer capability exists in the component
   but the dashboard never gives it a real date.
4. **Recent Activity + sidebar** — an `ActivityFeed` list (last hour, mapped from `/api/activity`)
   next to a hand-rolled "Public Approval" top-3/bottom-3 leaderboard, plus three `SidebarCard`s
   (Treasury, Upcoming Events, Quick Stats) — several fields hardcoded to `'--'` (Revenue 30d,
   Spending 30d).
5. **Active Legislation carousel** (`LegislationCarousel`) and **Campaign Trail** grid
   (`CampaignCard`s) — both fine as components, but bolted on with no connection to what's
   happening on the map or right now.

Nowhere on this page does the Capitol map — the one truly spatial, alive part of this simulation —
appear. A spectator has to already know to click "Capitol Map" in the nav to find the thing that
actually looks like a living government. The dashboard, the highest-traffic page in the app, hides
its best asset.

## Data available

**`governmentApi.overview()` → `GovernmentOverview`** (`src/core/shared/types.ts`):
```
executive: { president: Agent | null, cabinet: [...], termEndDate: Date | null }
legislative: { totalSeats: number, filledSeats: number, activeBills: number, pendingVotes: number }
judicial: { supremeCourtJustices: number, activeCases: number }
stats: { totalAgents, totalParties, totalLaws, totalElections, treasuryBalance }
```

**`courtApi.stats()`** → `{ currentTick: number, ... }` — `currentTick` is the *authoritative sim
day* (completed `tick_log` row count). The dashboard already fetches this as `termDay`. This is the
same clock used everywhere else (bill journey, court case "Day 47" labels) — reuse it, don't invent
a second day counter.

**`legislationApi.list()`** → array of bills with `title, summary, sponsorId, sponsorDisplayName,
committee, status` (status ∈ `proposed | committee | floor | passed | law | failed | vetoed |
tabled | presidential_veto`).

**`campaignsApi.active()`** → campaigns joined to agent + party: `agentId, electionId, platform,
startDate, endDate, endorsements (JSON string), contributions, status, agent: {displayName,
avatarUrl}, party: {name}`.

**`activityApi.recent({ since })`** → `{ events: ActivityEvent[], total }` — **always unwrap
`.events`**, the endpoint never returns a bare array. Each event: `{ id, type, agentId, agentName,
title, description, metadata, createdAt }`. Real `type` values observed across the codebase (from
`useAgentMap.ts`'s `ACTIVITY_TYPE_TO_BUILDING` map and `LiveTicker.tsx`'s `TICKER_TYPES`): `vote,
bill_proposed, bill_resolved, bill_advanced, bill, debate, committee_review, committee_amendment,
bill_tabled, presidential_veto, veto_override_attempt, veto_override_success, veto_sustained,
campaign_speech, party, election_voting_started, election_completed, election, law, law_amended,
law_enacted, law_struck_down, law_upheld, court_case_filed, judicial_review_initiated,
judicial_vote, salary_payment, tax_collected, orchestrator_intervention, media_event,
election_called`.

**`calendarApi.upcoming()`** → `{ legacy: CalendarEvent[] }` where `CalendarEvent = { type, label,
date, detail }`.

**`agentsApi.list(1, 100)`** → agents with `id, displayName, approvalRating` (used for the
leaderboard) — full `Agent` shape also carries `alignment`, used for map dot coloring.

**Capitol map data** — `useAgentMap()` hook (`src/core/client/hooks/useAgentMap.ts`) is the single
source of truth for map liveness. It derives `agentLocations: Record<agentId, buildingId>` from
recent activity + a deterministic hash fallback, and exposes:
```ts
BuildingPulse = { buildingId: string, color: string, triggeredAt: number }   // 1.4s one-shot ring
TickerEvent   = { id, text, highlight, type, timestamp }                     // rolling 10-item log
SpeechBubble  = { id, agentId, text, type: 'speech'|'vote', expiresAt }
```
This hook already listens to every real WS event the map cares about (see Motion & liveness below)
and is reusable as-is — the dashboard hero should mount a small version of the same map, not
reinvent event handling.

**Buildings** (`src/core/client/lib/buildings.ts`, `BUILDINGS` const) — 7 real locations, each with
`id, name, type, description, x, y, width, height` (map %), `color` (hex), and a full `seats[]`
array for interior views: `capitol` (Legislative, gold #C9B99B), `executive` (Executive, teal
#0ac0ab), `supreme-court` (Judicial, slate #6B7A8D), `treasury` (Finance, gold #B8956A),
`party-hall` (Political, red #8B3A3A), `archives` (Records, gray #72767D), `election-center`
(Democracy, green #3A6B3A).

**Term-day / tick cadence**: 90-minute ticks = 1 sim day (per project CLAUDE.md). `currentTick`
from `courtApi.stats()` is the count of completed `tick_log` rows — this is "Day N" everywhere in
the app (court case labels, budget page tick axis). There is no separate "term day" concept distinct
from this tick count in the code the dashboard currently reads — `termDay` in `DashboardPage.tsx`
is just `currentTick` relabeled. A term-day *dial* should visualize progress through the current
president's term using `overview.executive.termEndDate` (a real `Date | null` field) against
`currentTick`, not invent a new denominator.

## Layout concept

Three stacked zones, each doing one job, in descending order of spectacle:

**Zone 1 — Capitol map hero (dominant, ~55vh).** Not the full interactive `CapitolMapPage`, but a
locked, non-draggable, slightly zoomed-out version of the same map: the 7 buildings at their real
`x/y/width/height` percentages, rendered with `BuildingPulseRing` reacting to live pulses, small
`AgentAvatarDot` clusters (or simplified colored dots at high agent counts) showing where the
roster of registered agents (`overview.stats.totalAgents`, ~30 at typical seed size — a total
population count, distinct from the legislature's own seat geometry, see `02-hemicycle-votes.md`'s
chamber-size note) currently are. A soft radial vignette and the `hero-capitol.jpg` background are already
available for texture. Overlaid in a corner: the **term-day dial** — a circular/arc progress
indicator showing `currentTick` progress toward `termEndDate`, with "Day 47" as the dominant number
inside it (reuse the "Day N" vocabulary from the court and budget pages, don't invent new copy).
This replaces the entire hero stat-tile row — the four numbers (agents, bills, parties, elections)
either move into the map as small annotated counts near their relevant building, or move to a
compact strip beneath the map, never as the first thing on the page.

**Zone 2 — HAPPENING NOW spotlight (single dominant card, full width, ~200-260px tall).** One
rotating slot showing the single most newsworthy live thing, picked by priority: an active floor
vote in progress > a hearing scheduled/argued today > an election in its voting window > (fallback)
the most recent high-signal activity event. This is not a feed — it's one story at a time,
auto-rotating every ~8-10s if multiple qualify, with a manual next/prev affordance. Each state has
distinct dressing:
- **Floor vote**: bill title, a compact live tally (reuses `02-hemicycle-votes.md`'s semicircle at
  small scale), "voting in progress" pulse.
- **Hearing today**: case caption, case number, "Oral argument today" (reuses the language from
  `CasePage.tsx`'s `dayLine()` helper), a `PixelAvatar` row of the bench.
- **Election countdown**: replaces the current always-empty `ElectionBanner` — only render it with
  a real `targetDate` computed from the election's `votingStartDate`/`registrationDeadline`, or
  don't render the countdown units at all (see States & edge cases).
- **Fallback**: the most recent `bill_resolved` / `court:ruling` / `election:completed` activity
  event, styled as a headline with one line of body text.

**Zone 3 — Integrated ticker + supporting rail.** The existing `MapEventTicker` /
`LiveTicker`-style scrolling strip sits directly under the spotlight (not as a separate dismissable
nav element floating disconnected from content) so it reads as the spotlight's supporting evidence
stream, not a separate feature. Below that, keep `LegislationCarousel` and the `CampaignCard` grid,
but demote them — they're supporting detail once the map and spotlight have told the main story,
not top-of-page content.

**Kill entirely**: the flat 4-stat hero row, the "Vacant" / "--" `BranchCard`s (don't ship a card
that visibly announces its own data is missing — either wire it to real data or fold the branch
summary into the map itself as building labels/badges), the disconnected "Public Approval"
leaderboard as a standalone block (fold top/bottom approval into agent dots on the map via color
intensity or a small corner readout, or keep it but demote far below the fold).

## Design-system components to compose

- `BuildingPulseRing` — event pulses on map buildings (already correct: 1.4s one-shot,
  `pulse.triggeredAt` keys the animation).
- `AgentAvatarDot` — agent presence dots on the map, colored by `alignment` via the existing
  `getAlignmentColor()` convention (progressive/tech → slate `#6B7A8D`, conservative → red
  `#8B3A3A`, labor/social → green `#3A6B3A`, default gold `#B8956A`).
- `MapEventTicker` — the scrolling event strip; reuse instead of `LiveTicker`'s standalone marquee
  if the goal is visual continuity with the map (both consume similar event shapes; `MapEventTicker`
  is already positioned as a map overlay in `CapitolMapPage.tsx`).
- `ElectionBanner` — only mount when a real countdown target exists (see States & edge cases);
  compose it *inside* the spotlight rotation, not as a permanent fixture.
- `LegislationCarousel`, `CampaignCard`, `PixelAvatar`, `SectionHeader`, `SidebarCard` — keep for
  the demoted supporting-detail zone below the fold.

**New components to invent:**

- **`TermDayDial`** — `{ currentTick: number, termEndDate: Date | null, label?: string }`. Circular
  or arc progress ring, gold stroke, "Day N" as the large mono center number, subtitle showing days
  remaining in term (or "—" if `termEndDate` is null, e.g. no sitting president). Small enough to
  sit as a corner overlay on the map hero.
- **`SpotlightCard`** — `{ kind: 'vote' | 'hearing' | 'election' | 'headline', data: ...,
  onNext: () => void, onPrev: () => void }`. The rotating single-story slot. Internally switches
  layout by `kind`; each variant composes existing pieces (mini hemicycle for `vote`, `PixelAvatar`
  row for `hearing`, `ElectionBanner`-style countdown for `election`, headline typography for
  `headline`).
- **`MapMiniAgentCluster`** — a simplified stand-in for full `AgentAvatarDot` layout when a building
  has more occupants than comfortably fit as individual dots (the existing `CapitolMapPage`
  "+N" overflow badge pattern, lifted into a reusable piece for the smaller hero map).

## Motion & liveness

Every animation here binds to a WS event already emitted and consumed somewhere in the codebase —
verified by grep against `useAgentMap.ts`, `DashboardPage.tsx`, `LiveTicker.tsx`, `BillDetailPage.tsx`:

- `agent:vote` — pulse `capitol` gold, optional speech bubble with vote + reasoning.
- `bill:proposed` — pulse `capitol` gold.
- `bill:resolved` — pulse `capitol` + `archives` green/red by result; **this is the dashboard's
  own existing refetch trigger** (`DashboardPage.tsx` already subscribes to it).
- `bill:advanced`, `bill:tabled`, `bill:committee_amended` — pulse `capitol` gold.
- `bill:presidential_veto` — pulse `capitol` red; `bill:veto_overridden` — pulse `capitol` +
  `archives` green; `bill:veto_sustained` — pulse `capitol` red.
- `campaign:speech` — pulse `party-hall` red, speech bubble.
- `election:voting_started` / `election:completed` — pulse `election-center` green; dashboard
  already refetches on both.
- `law:struck_down` — pulse `supreme-court` red/danger.
- `law:amended` — pulse `archives` gold.
- `court:case_filed`, `court:hearing`, `court:ruling` — pulse `supreme-court` slate/danger
  depending on outcome.

**Caveat on `WS_EVENTS`**: `src/core/shared/constants.ts` exports a `WS_EVENTS` object
(`ELECTION_VOTE_CAST`, `LEGISLATION_NEW_BILL`, etc.) that does **not** match the event names
actually emitted and subscribed to across the app (`bill:resolved`, `court:ruling`, etc., all
called as raw string literals). Treat that constant as stale/legacy — build against the string
literals verified above, which is what every real page (`DashboardPage`, `BillDetailPage`,
`CasePage`, `BudgetPage`) actually subscribes to.

The `TermDayDial` has no push event to react to (tick advancement isn't itself a distinct
broadcast) — it should simply re-fetch `courtApi.stats()` on the same cadence the dashboard already
polls/refetches, and can pulse briefly on `bill:resolved` or any tick-boundary event as a "the day
moved" cue if one becomes available later. Don't fake a tick-tick animation with a client-side
timer — 90 minutes is too slow for a countdown to read as alive; a static, correct number beats a
janky fake-progress bar.

## States & edge cases

- **No sitting president** (`overview.executive.president === null`): dial shows "Day N" with no
  term-end subtitle ("Vacant" is acceptable single-word framing, not a full empty-state card).
- **No active election**: the spotlight rotation simply skips the `election` kind — don't render
  `ElectionBanner`'s "No upcoming election scheduled" state inside a broadcast-styled hero, it reads
  as a bug, not a calm empty state. Only surface an election story when a real `targetDate` exists.
- **No floor votes and no hearings today**: spotlight falls through to the `headline` kind using the
  most recent high-signal activity event; if activity is also empty (fresh install), show a single
  calm "The simulation is warming up" headline card, not a spinner forever.
- **Fewer than 3 agents with approval data**: skip the leaderboard rail entirely rather than showing
  partial/empty top-3/bottom-3 columns.
- **WebSocket disconnected**: map and ticker should freeze on last-known state, not blank out —
  same pattern the existing `LiveTicker` already follows (initial REST fetch, WS only for deltas).
- **Very high agent density in one building** (e.g. after an election result moves many agents to
  `election-center`): use the existing "+N" overflow badge pattern from `CapitolMapPage.tsx` rather
  than letting dots overlap illegibly.

## What good looks like

- The map is the first thing a spectator's eye lands on, not a stat number.
- At any moment, there is exactly one "main story" — never zero competing headlines, never three
  headlines fighting for attention.
- Every pulse on the map corresponds to a real, verifiable WS event — no decorative animation with
  no underlying cause.
- No card on the page ever displays a hardcoded placeholder value like `'--'` or `'Vacant'` as if it
  were real data — missing data means the element doesn't render, or renders an intentional calm
  empty state.
- Someone who has never seen AgoraBench before can tell within 3 seconds that this is a running
  simulation, not a dashboard about a static system.
- The term-day dial gives an at-a-glance sense of "how far into this presidency are we" without
  requiring a click.
- Legislation carousel and campaign trail are still present and still useful, but visually
  subordinate to the map and spotlight — no one mistakes them for the page's main content.

## Prompt to paste

> Redesign the AgoraBench dashboard (landing page) as a broadcast control room, following
> `guidelines/01-broadcast-dashboard.md`. Build a dominant Capitol map hero with live building
> pulses and a term-day dial, a single rotating "happening now" spotlight card below it (floor
> vote / hearing / election / headline), and an integrated event ticker — replacing the current
> flat stat-tile grid entirely. Compose from the synced design system (`BuildingPulseRing`,
> `AgentAvatarDot`, `MapEventTicker`, `ElectionBanner`, `LegislationCarousel`, `CampaignCard`) and
> propose `TermDayDial` and `SpotlightCard` as new components per the brief's prop sketches.
