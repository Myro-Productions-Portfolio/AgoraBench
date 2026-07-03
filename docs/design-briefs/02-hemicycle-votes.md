# 02 — The Hemicycle: A Universal Vote Visualization

## Purpose & spectator goal

Every vote in AgoraBench — a floor vote on a bill, a Supreme Court ruling, an election tally — is
currently shown as a progress bar plus a text table of names and choices. That's accurate but
illegible at a glance: a spectator has to read rows to understand "who voted how," when the
simulation already knows exactly where every agent sits. This brief specs one reusable component,
the **Hemicycle**, that replaces those bars-and-tables everywhere a vote is shown: a semicircular
seat chart, colored by vote and clustered by party, sized to the real chamber or scaled down to a
7-justice mini-arc for the court. One glance should answer "did this pass, and by how much, and who
broke ranks" — the table of names becomes a drill-down, not the primary view.

**Chamber size — three conflicting numbers exist in this codebase; use the seat geometry, not
either count.** `GovernmentOverview.legislative.totalSeats` (`src/modules/government/server/routes/government.ts:85`)
is a **hardcoded literal `50`**, unrelated to any real seat data — it does not derive from a seat
table or the `buildings.ts` geometry. The actual physical seat geometry in `buildings.ts`'s
`capitol.seats` array defines exactly **19 legislator chairs** (1 podium + 5 inner-arc + 6
middle-arc + 8 outer-arc — precisely counted from the array, see Data available) plus 10 non-voting
gallery seats (2 pods of 5). `filledSeats` (`congressMembers.length`, a real count of active
`positions` rows with `type: 'congress_member'`) is the only trustworthy number of the three, and
it can legitimately exceed 19 today since it isn't clamped to the physical geometry. **Do not
build the Hemicycle around a fixed 19, 27, 30, or 50 — size the arc dynamically to
`seats.length` (the real roster passed in), with `buildings.ts`'s 3-row arc-radius proportions as
the layout algorithm, not a hardcoded seat count.** Flag the `totalSeats: 50` /
`capitol.seats` mismatch as a backend data-quality issue worth fixing separately; the frontend
should not paper over it by picking whichever number looks best.

## Current state & problems

**`BillDetailPage.tsx`** (`Vote Tally` section, lines ~230-278): a single horizontal three-segment
bar (`h-3 rounded-full`, green/red/gray for yea/nay/abstain), plus a full HTML `<table>` roll call
below it, one row per voter, click-to-expand for reasoning. This is functional but has no sense of
"chamber" at all — rows of text with no spatial or party read. Party affiliation isn't even shown
in the roll call rows currently, only name + choice + timestamp + expandable reasoning.

**`LawDetailPage.tsx` / `LawsPage.tsx`**: laws inherit the same problem — a law is just a bill that
passed, so any vote visualization improvement to `BillDetailPage.tsx` should be shared, not
duplicated, since laws reference their originating bill's vote data.

**`CasePage.tsx`** (the reference standard — see README): already does the spatial version
correctly for justices. The bench is 7 real seat coordinates from `buildings.ts`
(`supreme-court`'s seats 0–6, `BENCH_FILL_ORDER = [3, 2, 4, 1, 5, 0, 6]` fanning out from the chief
at center), rendered as `StageSeat` components — `PixelAvatar` in a colored ring (ring color =
alignment, via `getAlignmentColor()`), hover shows name + role. Votes aren't currently color-coded
onto those bench seats though — the opinion reader below groups votes into Majority/Dissent text
columns (`VoteCard`), separate from the seated bench. **This is the gap 02 closes**: the hemicycle
pattern should extend the bench's spatial idea into vote-coloring the seats themselves, and be the
same underlying component whether it's 7 justices or the full legislature.

**No existing legislature seat layout exists yet for individual agent-to-seat assignment on floor
votes** — `buildings.ts`'s `capitol` building does have a semicircular arc geometry built for the
interior map view (precisely: 1 podium seat + a 5-seat inner arc + a 6-seat middle arc + an 8-seat
outer arc = 19 legislator chairs, plus 10 non-voting gallery seats in two pods of 5 — counted
directly from the `seats[]` array, not from the building's stale "50 representatives" description
text), not currently wired to bill-vote data. This is the arc-radius/row-count *proportion* the
Hemicycle component should reuse as its layout algorithm — don't invent new seat math — but the
component must generate seat positions for however many real legislators are passed in
(`seats.length`), not hardcode 19 or any other fixed count, since `filledSeats` can already exceed
the physical geometry (see chamber-size note above).

## Data available

**Bill votes** (`BillDetailPage.tsx`'s `BillDetail.rollCall`, sourced from `bill_votes` table +
joins): each entry is
```ts
{ voterId, voterName, choice: 'yea'|'nay'|'abstain', castAt: string|null,
  reasoning: string|null, followedWhip: boolean }
```
plus the aggregate `tally: { yea, nay, abstain, total }`. `billVotes` schema
(`src/modules/legislation/db/schema/legislation.ts`): `billId, voterId, choice varchar(20), castAt`.
Choice values confirmed as `'yea' | 'nay' | 'abstain'` from `VOTE_COLORS` maps in both
`BillDetailPage.tsx` and `AgentProfilePage.tsx`'s `VotingTab`.

**Vote reasoning** (shipped per git log `fa69783`): `bill_votes`-adjacent reasoning text, exposed on
each `rollCall` entry as `reasoning: string | null`, plus a `followedWhip: boolean` flag — when an
agent has no stored reasoning but followed the party line, the UI shows a "Followed party whip"
badge instead of blank. Typical reasoning length: 1-3 sentences (rendered at `text-xs
leading-relaxed`, no truncation currently applied, unlike statement excerpts elsewhere which
truncate at 150-280 chars).

**Party affiliation**: agents join to `parties` via `party_memberships`. Real party values (from
`src/core/db/seed.ts`): **Progressive Alliance** (progressive), **Moderate Coalition** (moderate),
**Constitutional Order Party** (conservative), **Liberty First Party** (libertarian),
**Technocratic Union** (technocrat) — 5 parties, 5-point alignment spectrum
(`ALIGNMENTS` const: progressive, moderate, conservative, libertarian, technocrat). Party isn't
currently joined into `rollCall` entries on `BillDetailPage` — the hemicycle component will need
that join added (agent → party_memberships → parties) to cluster seats by party; this is new
plumbing, flag it as a backend dependency, not something the frontend can fake from existing data.

**Court votes** (`court_case_votes` table, `src/modules/government/db/schema/court.ts`):
```ts
{ id, caseId, justiceId, vote: 'strike'|'uphold' (challenge) | 'petitioner'|'respondent' (dispute),
  reasoning, citedArticles: JSON-int-array-as-text, castAt }
```
`CasePage.tsx`'s `CaseDetail.bench: BenchJustice[]` gives the sitting 7: `{ id, displayName,
avatarConfig, alignment, isChief }`. `WINNING_VOTE` maps outcome → the vote value that constitutes
"majority" (`struck_down → strike`, `upheld → uphold`, etc.) — this is exactly the majority/dissent
split the hemicycle needs to color seats by "won" vs "lost" in addition to raw choice.

**Committee votes** (shipped per git log `fa69783`, "committee visibility"): `bills.committeeDecision
varchar(20)` (e.g. `'approve' | 'table' | 'amend'`, exact values not enumerated in schema but
rendered capitalized on `BillDetailPage.tsx` as `bill.committeeDecision.replace(/_/g, ' ')`) and
`bills.committeeChairId`. This is a single chair decision, not a multi-member committee tally — the
hemicycle's full-chamber view is for floor votes only; committee stage should stay a compact
decision badge, not a seat chart (there's no committee membership roster with individual votes in
the current schema, only `committeeMemberships` table existence noted in file listing — worth a
backend-side check before assuming per-member committee votes exist).

## Layout concept

**`Hemicycle` component**: an SVG or absolutely-positioned-div semicircle, seats arranged in
concentric arcs opening upward (matching `buildings.ts capitol` seat geometry — inner arc of 6 at
smallest radius, each row's seat count scaled proportionally to `seats.length`, not fixed; a
podium marker at top center where the speaker/chief sits). Each seat is a small colored dot/chip:

- **Fill color = vote choice.** Yea → green (`#4CAF50`-family, matches existing vote-tally green),
  Nay → red (`#F44336`/`danger` family), Abstain → dimmed/desaturated stone gray at reduced opacity
  (this directly implements the "abstain dimming" requirement — an abstaining seat should visually
  recede, not compete with yea/nay for attention).
- **Ring/border color = party**, using the 5-party alignment palette already established across the
  app (`getAlignmentColor()`: progressive/technocrat → slate `#6B7A8D`, conservative → danger red
  `#8B3A3A`, labor/social(moderate here has no direct bucket in the existing 3-color simplification
  — extend to 5 distinct hues per the 5 real parties rather than reusing the simplified 3-bucket
  map built for map dots, since a legislature-wide chart needs to actually distinguish 5 caucuses).
  This is the party-clustering requirement: don't literally re-sort seats by party (seat assignment
  is fixed geometry from `buildings.ts`), cluster visually via consistent color coding so party
  blocks become visible as color patterns even though physical seat order is fixed.
- **Hover → agent + reasoning.** Hovering a seat shows a tooltip/popover with `PixelAvatar` (seed =
  agent name), display name, party, vote choice, and the reasoning text (or "Followed party whip"
  badge) — this replaces the roll-call table's click-to-expand interaction with a hover, keeping the
  table available below as a secondary, sortable/filterable detail view rather than the primary read.

**Two sizes, one component, a `variant` prop:**

- **`variant="chamber"`** (seat count = `seats.length`, currently ~19-24 filled legislator
  positions depending on live roster — never hardcoded): the full legislature arc, used on bill detail floor votes and
  law pages. Podium marker at top center (unoccupied unless there's a Speaker position to show).
- **`variant="court"`** (7 seats): the bench mini-arc, reusing exactly the `supreme-court` seat
  positions and `BENCH_FILL_ORDER` chief-centering logic already implemented in `CasePage.tsx`'s
  `StageSeat`/`placements` code — this brief formalizes that inline logic into the reusable
  component so future court UI doesn't reimplement it, and so a compact hemicycle can appear
  elsewhere (e.g. brief 01's spotlight card) without loading the full courtroom stage.

**Where it replaces text:**

- **Bill detail** (`BillDetailPage.tsx`): replaces the current 3-segment bar + full-width table.
  The hemicycle becomes the primary "Vote Tally" section content; the existing roll-call table stays
  underneath as a secondary, collapsed-by-default detail list (or a filter/search-driven table) for
  spectators who want to scan names directly.
- **Law pages** (`LawDetailPage.tsx`/`LawsPage.tsx`): a law is a passed bill — show the *final
  enacting vote* hemicycle (read-only, no live updates needed since the vote is historical), likely
  smaller/collapsed by default since law pages emphasize the law's ongoing effects (fiscal note,
  amendment history, and — new since the judicial arc shipped — any court case that has
  challenged/struck it down) over the vote that created it.
- **Case pages** (`CasePage.tsx`): the `variant="court"` hemicycle should eventually replace or
  augment the current inline `StageSeat` bench rendering on the courtroom stage itself — ring color
  by alignment already matches, the addition is vote-choice fill color once a case is `decided`
  (currently the bench shows agent identity but not vote outcome spatially; that read is only in
  the text-based Majority/Dissent `VoteCard` columns below). This is additive to the courtroom
  scene, not a replacement of its stage — the stage keeps its speech bubbles and verdict banner;
  the hemicycle formalization simply makes the existing bench seats vote-colored once decided.

## Design-system components to compose

- `PixelAvatar` (size `xs`/`sm`) — inside hover tooltips and any seat that shows a portrait instead
  of a plain dot.
- `SectionHeader` — "Vote Tally — N votes cast" heading pattern, already used on `BillDetailPage`.
- Existing badge/status vocabulary (`.badge`, status color classes) for the compact chair-decision
  badge at committee stage.

**New component to invent:**

- **`Hemicycle`** —
  ```ts
  interface HemicycleSeat {
    agentId: string;
    displayName: string;
    party: { name: string; alignment: string } | null;
    choice: 'yea' | 'nay' | 'abstain' | 'strike' | 'uphold' | 'petitioner' | 'respondent';
    isWinningSide?: boolean;   // for court variant, from WINNING_VOTE mapping
    reasoning: string | null;
    followedWhip?: boolean;
    avatarConfig?: AvatarConfig;
  }
  interface HemicycleProps {
    variant: 'chamber' | 'court';
    seats: HemicycleSeat[];       // length = live legislator roster for chamber, ≤7 for court
    tally: { yea: number; nay: number; abstain: number; total: number }
         | { for: number; against: number };
    onSeatClick?: (agentId: string) => void;   // navigate to agent profile
  }
  ```
  Internally sources seat *positions* from `buildings.ts` (`capitol.seats` sliced for chamber,
  `supreme-court.seats.slice(0,7)` + `BENCH_FILL_ORDER` for court) so geometry never drifts from
  the map/courtroom the rest of the app already uses.
- **`VoteTallyBadge`** — small inline `{ yea, nay, abstain? }` chip for contexts too small for a
  full hemicycle (e.g. a bill card in a list, or brief 01's spotlight card) — a compact
  three-segment bar retained from the current pattern, explicitly the *fallback* for tight spaces,
  not the primary pattern anywhere a full hemicycle fits.

## Motion & liveness

- **Bill detail**: `BillDetailPage.tsx` already subscribes to `agent:vote`, `bill:advanced`,
  `bill:resolved`, `bill:presidential_veto`, `bill:floor_amendment_proposed`, `bill:amended`,
  `bill:withdrawn`, `agent:lobby` and refetches on all of them. Wire the same refetch to the
  hemicycle: as votes come in live during an active floor session, seats should fill in one at a
  time (a seat transitions from empty/gray to its vote color with a brief highlight pulse — reuse
  the `BuildingPulseRing` timing convention, ~1.4s ease-out, rather than an instant color snap) —
  this is the moment the hemicycle earns its "broadcast" framing: watching a chamber fill in live is
  more compelling than watching a progress bar tick up.
- **Court**: `CasePage.tsx` already subscribes to `court:case_filed`, `court:hearing`,
  `court:ruling` filtered to the current case ID. On `court:ruling`, the hemicycle (once integrated
  into the bench) should transition from "identity only" (current state) to vote-colored, timed to
  coincide with the existing `VerdictPulse`/verdict banner animation rather than firing
  independently and looking uncoordinated.
- **Law pages**: no live motion needed — the enacting vote is historical. Render statically.

## States & edge cases

- **Vote in progress, not all seats cast yet**: uncast seats render as empty outlines (party ring
  color only, no fill) rather than defaulting to "abstain" styling — an uncast seat and an
  abstaining seat must be visually distinct, since conflating them misrepresents the chamber's
  state mid-vote.
- **Unanimous vote**: hemicycle still renders normally (all one color) — don't special-case into a
  different layout, the visual "wash of one color" is itself the signal of unanimity.
- **Court: even split / no majority side determined yet** (case `argued` or `deliberating`, not yet
  `decided`): bench renders identity-only (current `StageSeat` behavior), no fill color — the
  hemicycle's vote-coloring only activates once `outcome` is non-null.
- **Fewer seats filled than the arc has room for** (e.g. dev/test data, or a chamber below its
  typical roster size): render vacant seats as faint dashed outlines (this exact visual — `border:
  1px dashed rgba(201,185,155,0.3)` — already exists in `CasePage.tsx`'s "faint markers on the bench
  + counsel seats," reuse it directly for consistency). **Do not use `overview.legislative.totalSeats`
  as the vacancy denominator** — it's a hardcoded `50` unrelated to real seat data (see chamber-size
  note above); use the live roster size the page already has.
- **Party data missing for an agent** (independent, no `party_memberships` row): ring color falls
  back to neutral stone/gray rather than defaulting to any one party's color.
- **Mobile / narrow viewport**: the semicircle should scale down as a unit (SVG viewBox scaling)
  rather than reflowing into a list — if width genuinely can't support a legible chamber, fall back
  to `VoteTallyBadge`'s compact bar, not a squished illegible hemicycle.

## What good looks like

- A spectator can tell whether a bill passed, and by roughly how much, without reading a single
  number — the color wash of the arc communicates it.
- Party blocs are visible as color clusters even though seat geometry is fixed — someone who knows
  the five parties' colors can spot cross-party defection at a glance.
- Abstaining seats visibly recede rather than competing for attention with yea/nay.
- The exact same component, same code path, renders both a full-chamber floor vote and a 7-justice
  bench — no parallel implementation drift between the two, and no hardcoded seat count baked into
  either.
- Hovering any seat surfaces the agent's actual reasoning text (or an honest "no reasoning
  recorded" / "followed party whip" state) without navigating away.
- On a live floor vote, watching seats fill in one at a time is more compelling to watch than the
  progress bar it replaces.
- The roll-call table isn't deleted — it survives as a secondary, searchable detail view, not the
  primary way to read a vote.

## Prompt to paste

> Design a reusable semicircular "Hemicycle" vote visualization component per
> `guidelines/02-hemicycle-votes.md` — seats colored by vote choice (yea/nay/abstain, dimmed for
> abstain) with party-colored rings, hover reveals agent + reasoning via `PixelAvatar`. Build two
> size variants sharing one component: a full chamber arc sized to the live legislator roster (bill/law floor votes) and a
> 7-seat court bench mini-arc reusing the existing courtroom bench geometry. Show it composed into
> the bill detail vote-tally section, replacing the current progress-bar-plus-table pattern.
