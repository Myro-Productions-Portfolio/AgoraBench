# 05 — Election Night

## Purpose & spectator goal

`ElectionDetailPage.tsx` is currently a well-organized document: header card, winner banner,
candidate list with vote bars, roll call table. It's accurate and readable, but it reads the same
whether the election ended a year of sim-time ago or is being certified this very tick. The goal is
to make an *active* election feel like an actual election-night broadcast — live tallies updating in
real time, candidates on podiums, a visible sense of momentum — while a *certified* election still
serves as a clean permanent record. This is the one page in the app where borrowing real broadcast-
news vocabulary (chyrons, podiums, a "calling it" moment) is directly appropriate, not just
thematically nice.

## Current state & problems

`ElectionDetailPage.tsx`: a back link, then a header card (status badge, type badge, title, total
votes cast if certified, a 4-cell timeline grid of dates — Scheduled/Registration
Deadline/Voting Opened/Voting Closed/Certified). Below that, conditionally: a winner banner
(`PixelAvatar` + name + party + final percentage, gold-tinted) only when `status === 'certified'`.
Then a candidates section — each candidate is a flat card: avatar, name, alignment badge, party
abbreviation badge, winner badge if applicable, vote percentage + count (only shown when certified),
a vote-share progress bar (only shown when certified), platform text truncated to 3 lines. Finally a
roll-call table (voter → candidate voted for → cast timestamp), matching the pattern used elsewhere
for bill votes.

Problems: **nothing distinguishes an in-progress election from a finished one except which optional
fields happen to be populated.** A `voting` status election shows the exact same card layout as a
`scheduled` one — no live tally, no sense that votes are actively being cast right now, no
countdown to when voting closes. The existing `ElectionBanner` component (semicircular-adjacent —
actually just a 4-unit day/hour/min/sec countdown) exists and works, but the dashboard's only
current usage (`DashboardPage.tsx`) always passes `targetDate: null`, so it's never actually seen
live — this page never uses it either. Candidates are shown as a vertical stack of near-identical
cards rather than any kind of head-to-head/podium framing.

## Data available

**`ElectionDetail`** (`ElectionDetailPage.tsx`'s wire type, `GET /api/elections/:id`):
```ts
{ id, title, type, status, scheduledDate, registrationDeadline, votingStartDate: string|null,
  votingEndDate: string|null, certifiedDate: string|null, totalVotes, winnerId: string|null,
  candidates: Candidate[], rollCall: RollCallEntry[] }

Candidate = { agentId, displayName, avatarConfig: string|null, alignment: string|null, platform,
  contributions, voteCount, votePercentage, party: {name, abbreviation}|null, isWinner }

RollCallEntry = { voterId, voterName, candidateId: string|null, candidateName: string|null,
  castAt: string|null }   // candidateId null = abstained
```
**Status values** (`STATUS_META` in `ElectionDetailPage.tsx`, matches `elections.status` schema
default `'scheduled'`): `scheduled, registration, campaigning, voting, counting, certified`. This is
a genuine 6-stage lifecycle, not just "upcoming vs done" — each stage has real distinguishing
copy/color already defined (`scheduled` blue, `registration` yellow, `campaigning` orange, `voting`
green, `counting` purple, `certified` emerald) that this brief should carry over as the broadcast's
own status-chyron color language rather than reinventing a palette.

**`elections` schema** (`src/modules/elections/db/schema/elections.ts`): `positionType
varchar(50)`, `status`, `scheduledDate, registrationDeadline` (both `NOT NULL`),
`votingStartDate, votingEndDate, certifiedDate` (nullable, populate as the election progresses),
`winnerId → agents.id`, `totalVotes integer default 0`.

**`campaigns` schema**: `agentId, electionId, platform text, startDate, endDate, endorsements text
default '[]'` (JSON array, parsed client-side — see `DashboardPage.tsx`'s
`JSON.parse(campaign.endorsements)`), `contributions integer default 0`, `status varchar(20) default
'active'`.

**`votes` schema** (general-purpose vote table, shared with bill votes structurally but distinct
rows): `voterId, electionId, billId (null here), candidateId, choice varchar(100), castAt`. This is
where individual ballot casts live — `rollCall` is this table joined to agent names.

**`ElectionBanner`** (existing component, `src/modules/elections/client/components/
ElectionBanner.tsx`): `{ title, description, targetDate: Date | null }`. When `targetDate` is set,
renders a live-updating (`setInterval` 1s) 4-unit countdown (Days/Hours/Min/Sec) in gold-bordered
mono tiles; when null, renders a calm "No upcoming election scheduled" state. This is a *ticking*
component already — reuse its countdown math for "time until voting closes" during an active
`voting`-status election, not just "time until an election starts."

**`CampaignCard`** (existing component): `{ name, party, avatar?, agentId?, platform, endorsements:
number, contributions: number, pollPercentage: number, accentColor, index }` — renders `PixelAvatar`
(or real avatar image), party, italicized platform quote, a poll-standing bar, endorsements +
M$ raised stats. `pollPercentage` here is *contribution share*, not vote share (computed client-side
in `DashboardPage.tsx` as `campaign.contributions / totalContributions`) — a pre-election proxy
metric, distinct from `Candidate.votePercentage` which only exists once voting has actually happened.
This distinction matters for the podium framing: during `campaigning`, show contribution-share
momentum (what `CampaignCard` already does); during/after `voting`, switch to real vote tallies.

**Party** — same 5-party roster as briefs 02/03 (Progressive Alliance, Moderate Coalition,
Constitutional Order Party, Liberty First Party, Technocratic Union), each with a `name` and
`abbreviation` field (used for badge display, e.g. "PA", already rendered via
`party.abbreviation.toLowerCase()` party icon image lookups in `AgentProfilePage.tsx`).

## Layout concept

**Status drives the entire page mode** — not a toggle a spectator picks, but an automatic framing
switch based on `election.status`:

**Pre-voting modes (`scheduled`, `registration`, `campaigning`)** — a "war room" framing: header
retains the status chyron and timeline grid (useful, keep as-is), but candidates render as
**podiums** in a row (not a vertical stack) — `PixelAvatar` portrait large and centered per podium,
name/party beneath, and during `campaigning` specifically, a live contribution-share bar per podium
(reusing `CampaignCard`'s `pollPercentage` computation) so momentum is visible before a single vote
is cast. `ElectionBanner`'s countdown, wired to `registrationDeadline` or `votingStartDate`
(whichever is next), sits prominently near the top — this is the first real usage of that component
with a live target anywhere in the app.

**Live mode (`voting`, `counting`)** — the actual "election night" broadcast framing: podiums now
show **live vote tallies** updating as ballots are cast (`voteCount`/`votePercentage` per candidate,
refetched on ballot-cast events — see Motion & liveness), with the leading candidate's podium
visually emphasized (slightly larger, brighter border) the way a broadcast graphic would bold the
current leader without yet "calling" the race. `ElectionBanner`'s countdown switches to counting
down to `votingEndDate`. A running vote-count ticker (total ballots cast so far vs. an implied
denominator from `filledSeats`/registered voter count) reinforces "this is happening right now."

**Winner-moment mode (`certified`)** — the current winner banner treatment is already good (gold-
tinted, avatar + name + party + final percentage) — keep it, but promote it to a genuine "calling
the race" moment: larger, centered, with the losing podiums visibly deflated/desaturated beside it
rather than reading as equally-weighted cards. The existing vote-share bars on each candidate stay,
now showing final numbers. Roll call table stays exactly as-is below — it's the permanent public
record and doesn't need broadcast styling, just needs to still exist and be reachable.

## Design-system components to compose

- `ElectionBanner` — the countdown component, finally used with a real live `targetDate` (either
  `registrationDeadline`, `votingStartDate`, or `votingEndDate` depending on current stage) instead
  of always `null`.
- `CampaignCard` — reused directly for pre-voting podium contribution-share display; its existing
  `pollPercentage`/`accentColor`/`endorsements`/`contributions` props already fit the podium concept,
  this brief mainly repositions it into a horizontal podium row instead of a grid.
- `PixelAvatar` — large size (`lg`/`xl`) for podium portraits, replacing the current small avatar
  treatment in candidate cards.
- Existing `STATUS_META` color language — carried through as the page's status chyron, unchanged.

**New components to invent:**

- **`ElectionPodium`** — `{ candidate: Candidate, mode: 'momentum' | 'live-tally' | 'final',
  isLeading?: boolean, contributionShare?: number, accentColor: string }`. Single-candidate podium
  unit, switching its internal metric display by `mode` (contribution bar pre-vote, live vote-share
  bar during voting, final vote-share + winner ribbon once certified). Rendered in a row, sized to
  candidate count (2-5 typical based on real party roster).
- **`BallotTicker`** — `{ totalVotes: number, expectedVoters?: number }`. A small running counter
  ("1,204 ballots cast") for the live-voting mode, optionally showing progress toward an expected
  total if a meaningful denominator exists (e.g. `filledSeats` for a legislative election).
- **`RaceCallBanner`** — the promoted winner-moment treatment: `{ winner: Candidate, totalVotes:
  number }`, replacing the current inline winner banner div with a more dominant, broadcast-styled
  version (larger avatar, "PROJECTED WINNER" / "ELECTED" framing, matching the gold-glow language
  already used elsewhere, e.g. `shadow-gold-glow`).

## Motion & liveness

No page currently subscribes to per-ballot WS events on `ElectionDetailPage.tsx` — it's a pure
fetch-once page today. The dashboard subscribes to `election:voting_started` and
`election:completed` (confirmed in `DashboardPage.tsx`), and `useAgentMap.ts` also handles both,
plus moving the winner agent to `election-center` on `election:completed`. This brief needs:

- **`election:voting_started`** — already emitted; on this page, triggers the mode switch from
  pre-voting to live-voting framing.
- **`election:completed`** — already emitted; triggers the mode switch to certified/winner-moment
  framing, and should drive the `RaceCallBanner`'s entrance animation (a deliberate "calling it"
  reveal — scale/fade in with the gold glow, not an instant swap).
- **Per-ballot updates during `voting`**: no confirmed per-vote WS event exists in the verified
  event list (`agent:vote` is specifically for *legislative* bill votes per its payload shape in
  `useAgentMap.ts` — `billTitle`, `choice` — not election ballots). Treat live tally updates during
  the `voting` stage as **polling-based** (refetch `ElectionDetail` on an interval, e.g. every
  10-20s) rather than assuming a granular WS event exists; flag a dedicated `election:vote_cast`
  event as a nice-to-have backend addition if smoother live-tally motion is wanted later, but don't
  design the mockup assuming it already exists.
- Podium reordering (if the leader changes) should animate position swaps smoothly (framer-motion
  `layout` prop, same pattern already used for map buildings via `LayoutGroup` in
  `CapitolMapPage.tsx`) rather than a jarring re-sort snap.

## States & edge cases

- **Uncontested election** (single candidate): podium row of one — still show the full live-tally
  treatment, don't collapse to a degenerate "winner announced early" state before `certified`
  actually fires.
- **Election abstains present in roll call** (`candidateId: null`): keep the existing "abstained"
  italic label in the roll-call table; podiums don't need an "abstain" podium, abstentions only
  affect the denominator/turnout number, not candidate tallies.
- **No candidates yet** (`scheduled` or early `registration` stage, before filing closes): podium
  row renders empty-state placeholders ("Filing opens [date]" / candidate slots pending) rather than
  nothing, so the page still communicates an election is coming.
- **Election stuck in `counting`** (votes closed, not yet certified): treat as live-tally mode still
  (numbers may still be settling), but swap the countdown for a "Certification pending" static
  state rather than counting down to a `votingEndDate` that's already passed.
- **Tie or near-tie**: the "leading candidate" emphasis treatment should have a defined threshold
  (e.g. only emphasize a leader if ahead by some minimum margin) so a near-tie doesn't visually
  imply false certainty before certification.
- **Very low turnout / very high candidate count**: podium row should scroll horizontally or wrap
  gracefully rather than squeezing candidates illegibly — this page doesn't have the ~30-agent scale
  problem the hemicycle does, election fields are typically small (2-5 candidates), but shouldn't
  assume that's a hard cap.

## What good looks like

- A spectator landing on an election page during active voting immediately feels like they're
  watching something happen live, not reading a static record.
- The exact same page, viewed after certification, reads as a clean permanent record — no leftover
  "live" chrome (pulsing dots, countdown tiles) persists once the race is called.
- `ElectionBanner`'s countdown component is finally doing real work somewhere in the app instead of
  always rendering its empty state.
- The winner moment feels like an actual broadcast "calling the race" — distinct, celebratory,
  visually dominant — not just another badge on a card.
- Pre-election momentum (contribution share) and actual vote tallies are never visually confused
  with each other — a spectator always knows which metric they're looking at.
- Losing candidates aren't erased once results are final — their final numbers stay visible,
  de-emphasized rather than deleted, preserving the record.

## Prompt to paste

> Redesign the AgoraBench election detail page as an election-night broadcast per
> `guidelines/05-election-night.md` — candidates on podiums (not stacked cards) that switch between
> contribution-share momentum, live vote tallies, and a final "race called" state driven by the
> election's real status lifecycle (scheduled/registration/campaigning/voting/counting/certified).
> Use the existing `ElectionBanner` countdown with a real target date and `CampaignCard`'s
> contribution-share logic for pre-voting podiums, and design new `ElectionPodium`, `BallotTicker`,
> and `RaceCallBanner` components per the brief's prop sketches.
