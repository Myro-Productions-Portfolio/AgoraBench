# 03 — Bill Journey: A Subway Map

## Purpose & spectator goal

A bill's life — proposed, committee, floor, passed, enacted, and now potentially challenged and
struck down years later — is a linear journey with real branch points (committee tabling, veto,
override, judicial strike-down). `BillDetailPage.tsx` currently shows this as a status badge plus a
scattering of independent sections. The goal is to make the bill's entire path visible as a single
diagram — a metro/subway line with stations — so a spectator immediately sees not just "where is
this bill now" but "what could still happen to it" and "what already happened at each stop."

## Current state & problems

`BillDetailPage.tsx` shows, top to bottom: a status badge (one of 9 possible values, see below), a
meta row (sponsor, committee chair, introduced/last-action dates, committee decision), an enacted-
law banner or withdrawal banner if applicable, then a stack of independent `Section`s: Summary,
Fiscal Note (conditional), `AmendmentsList`, Vote Tally (see brief 02), Full Text (collapsed by
default). None of these sections visually connect to each other as stages of one journey — a reader
has to mentally reconstruct the sequence from scattered dates and badges. There's also no
indication, on a bill that became a law, that the law could later be *challenged in court and
struck down* — that fact currently only surfaces if you separately navigate to the law page and
then to a related court case; the bill/law page itself doesn't show it happened.

`BillPipeline.tsx` is the closest existing thing to a journey view, but it's an *aggregate filter
bar* for the legislation list page (`LegislationPage.tsx`), not a per-bill journey — it shows counts
per stage across *all* bills, with clickable stage buttons that filter the list. It flows
`proposed → committee → floor → passed → law` left to right, with a `|` separator before terminal
failure states (`failed, vetoed, tabled, presidential_veto`). This brief's subway map borrows that
same left-to-right flow topology but applies it to *one bill's actual path*, not a filter aggregate
— they're complementary, not duplicates: `BillPipeline` stays exactly as-is on the list page, this
brief adds a new per-bill component to the detail page.

## Data available

**Full bill status lifecycle** (`bills.status varchar(20)`, confirmed values from `STATUS_META` in
both `BillDetailPage.tsx` and `AgentProfilePage.tsx`'s `BILL_STATUS`, plus `BillPipeline.tsx`'s
stage lists): `proposed, committee, floor, passed, presidential_veto, failed, vetoed, law,
withdrawn`. `BillPipeline.tsx` additionally lists `tabled` as a terminal stage (committee-stage
death). Full station set for the journey diagram: **Proposed → Committee → Floor → Passed →
[Presidential Veto ⟷ override] → Law**, with terminal branch-offs at **Committee** (→ Tabled),
**Floor** (→ Failed), and **Passed** (→ Vetoed, if the president acts, with a further branch to
Veto Override if Congress overrides).

**Post-enactment judicial review — the new branch this brief must add**: a law is not necessarily
final. `court_cases` (`src/modules/government/db/schema/court.ts`) has `caseType:
'constitutional_challenge' | 'agent_dispute'`, `lawId: uuid` (references `laws.id`, null for agent
disputes), `outcome: 'struck_down' | 'upheld' | 'petitioner' | 'respondent' | 'dismissed'`. The
`laws` table itself carries `isActive: boolean` — a struck-down law has `isActive = false`. This
means the subway map needs one more station past "Law": **Law → [challenged in court] → Struck
Down**, rendered only when a `constitutional_challenge` case with `lawId` matching this bill's
enacted law exists. `BillDetailPage.tsx`'s current `bill.law: { id, title, enactedDate, isActive }`
already carries `isActive` but the page currently only uses it for a parenthetical "(repealed)"
label on the enacted banner — it doesn't link to *which* case struck it down or show the judicial
journey at all. The bill/law fetch will need to additionally join the `court_cases` row (if any)
referencing this law, exposing at minimum `{ caseId, caseNumber, caption, status, outcome,
decidedTick }` — new backend plumbing this brief depends on.

**Amendments** (`AmendmentsList.tsx`, hangs off the Committee/Floor stops) — component exists and is
already composed on `BillDetailPage.tsx` as a standalone section; this brief repositions it as a
detail hung off the relevant station rather than a separate top-level section. Exact amendment
schema wasn't independently re-verified in this pass beyond its existing composition in
`BillDetailPage.tsx`; treat `AmendmentsList`'s existing props (`billId`, `billStatus`) as the
contract, unchanged.

**Fiscal notes** — bills carry (all nullable, `NULL` = no provision — see the extensive schema
comments in `src/modules/legislation/db/schema/legislation.ts`):
```ts
fiscalKind: 'spend_once' | 'spend_recurring' | 'tax_change' | null
fiscalAmount: number | null        // M$, per-tick for recurring, total for one-time
fiscalTaxDelta: number | null      // signed whole percentage points, tax_change only
fiscalProgramName: string | null
sunsetTicks: number | null         // law auto-deactivates this many ticks after enactment
```
`BillDetailPage.tsx` additionally computes a deterministic server-side projection,
`fiscalNote: FiscalNote | null`:
```ts
{ kind, oneTimeCost, perTickDelta, perCycleDelta, horizonTicks, projected10TickDelta,
  pctOfCurrentTreasury, expectedTickRevenue }
```
This should hang off the **Passed/Law** station — a fiscal note is a property of the bill's
financial commitment once enacted, not an independent top-level page section.

**Law effects / sunset** — on the `laws` table itself (copied from the enacting bill at enactment):
`fiscalKind, fiscalAmount, fiscalTaxDelta, fiscalProgramName, sunsetTicks, programActive: boolean,
enactedTick: number, lastRenewedTick: number`. `BudgetPage.tsx`'s "Active Spending Programs" table
shows `ticksUntilLapse` per program — a recurring-spend law with `programActive = true` is a *living
station state*, not a static "enacted" endpoint: the Law station should show whether the program is
still active, how many ticks until it lapses (from `budgetApi`/`governmentApi.budget()`'s
`activePrograms[].ticksUntilLapse`), and whether it's been renewed (`lastRenewedTick` vs
`enactedTick`).

**Lobbying** (`LobbyingFeed.tsx`, `DealLog.tsx`) — existing components already composed via
`BillSidebar.tsx` (rendered conditionally when `bill.status` is `floor | passed |
presidential_veto`). These hang off the **Floor** station specifically — lobbying and deal-making
happen while a bill is actively being voted on, not before or after. Keep them as sidebar/detail
content triggered by selecting the Floor station, not as independent top-level sections.

**Committee decision** — `bills.committeeDecision varchar(20)` and `bills.committeeChairId`,
rendered today as a plain meta-row value (`bill.committeeDecision.replace(/_/g, ' ')`, capitalized).
This hangs off the **Committee** station as its resolution detail.

## Layout concept

**The subway line**: a horizontal (or vertical on narrow viewports) line of stations running the
full width of a dedicated section near the top of `BillDetailPage.tsx`, replacing the current
scattered status badge + meta row as the primary "where are we" indicator (the badge can remain as
a small redundant label, but the line is now the primary visual). Stations, left to right:

```
Proposed ─→ Committee ─┬→ Tabled (dead end)
                        └→ Floor ─┬→ Failed (dead end)
                                  └→ Passed ─┬→ Vetoed ─┬→ Override Sustained ─→ Law
                                             │           └→ Veto Sustained (dead end)
                                             └→ Law ──────────────────→ [Challenged?] ─┬→ Upheld (stays Law)
                                                                                        └→ Struck Down
```

Rendered as a straight main line with branch spurs peeling off at the relevant station rather than
a literal diagram of every possible path — most bills never see a veto or a court challenge, so the
default rendering is a clean straight line (Proposed → Committee → Floor → Passed → Law) with the
current position marked; branch stations (Tabled/Failed/Vetoed/Struck Down) only render as visible
spurs on bills that actually took that path, using a distinct visual treatment (dashed connector,
muted/danger color) so the common path stays visually dominant.

**Animated current position**: the bill's current station gets a distinct marker — pulsing ring
(reuse `BuildingPulseRing`'s timing/easing convention), gold glow, larger than passed/future
stations. Passed stations render solid/filled (this happened). Future stations on the likely path
render as outlined/dimmed (hasn't happened, might). Dead-end branches the bill did *not* take don't
render at all (a bill that passed committee cleanly shows no "Tabled" spur).

**Hung details**: clicking or hovering a station expands an inline detail card beneath the line —
this is where `AmendmentsList` (Committee/Floor), `LobbyingFeed`/`DealLog` (Floor), the fiscal note
(Passed/Law), and the judicial-review branch detail (post-Law) all live, rather than as independent
stacked page sections. Only one station's detail expands at a time (accordion behavior), keeping the
page from becoming a wall of simultaneously-open sections again.

**Judicial branch styling**: since this is new territory (a law that already looked "final"), the
Struck Down spur should visually read as distinct from the earlier legislative branches — use the
judicial slate color (`#6B7A8D`, matching `CasePage.tsx`'s `JUDICIAL_SLATE` constant) rather than
the danger red used for `Failed`/`Vetoed`, so a spectator's eye associates it with "the court," not
"the bill failed" — being struck down is a different kind of event than failing to pass. Include a
direct link to the case page (`/court/cases/:id`) from this spur.

## Design-system components to compose

- `BillPipeline` stays untouched on `LegislationPage.tsx` (aggregate filter, not this brief's
  concern) — this brief's new subway component is a sibling, not a replacement.
- `AmendmentsList`, `LobbyingFeed`, `DealLog`, `BillSidebar` — reused as the expandable detail
  content hung off relevant stations, unchanged internally, just repositioned in the page layout.
- `SectionHeader` — retained for the overall "Bill Journey" section label.
- The Hemicycle component from `02-hemicycle-votes.md` hangs off the **Floor** station as its vote
  detail (replacing the current always-visible Vote Tally section with an on-demand expansion).
- Fiscal note content (existing `FiscalNoteSection` logic in `BillDetailPage.tsx`) — repositioned as
  Passed/Law station detail, kept internally as-is.

**New components to invent:**

- **`BillSubwayLine`** —
  ```ts
  interface JourneyStation {
    key: string;               // 'proposed' | 'committee' | 'floor' | 'passed' | 'law' | 'tabled' | 'failed' | 'vetoed' | 'override' | 'struck_down' | 'upheld'
    label: string;
    reached: boolean;          // did the bill's actual path include this station
    isCurrent: boolean;
    date: string | null;       // when this station was reached
    branch?: 'main' | 'terminal-negative' | 'judicial';
  }
  interface BillSubwayLineProps {
    stations: JourneyStation[];
    onSelectStation: (key: string) => void;
    selectedStation: string | null;
  }
  ```
  Computes the rendered path from the bill's actual `status` + historical timestamps
  (`introducedAt`, `lastActionAt`, `vetoedAt`, `law.enactedDate`) plus the new judicial-review join
  described above. Orientation switches horizontal→vertical below a width breakpoint.
- **`JudicialReviewSpur`** — a small dedicated card for the post-enactment challenge state:
  `{ caseNumber, caption, status, outcome, decidedTick, caseId }`, judicial-slate styling, links to
  `/court/cases/:id`. Rendered as the hung detail when the "Law" or "Struck Down" station is
  selected on a bill with an associated case.

## Motion & liveness

`BillDetailPage.tsx` already subscribes to `agent:vote`, `bill:advanced`, `bill:resolved`,
`bill:presidential_veto`, `bill:floor_amendment_proposed`, `bill:amended`, `bill:withdrawn`,
`agent:lobby` — the subway line should animate a station transition (marker moves from old current
station to new one, with the newly-reached station transitioning outline→filled) whenever
`bill:advanced` or `bill:resolved` fires and changes `status`. For the new judicial branch, there is
no existing subscription on this page to court events — add `court:ruling` (already used elsewhere
in the app, e.g. `CasePage.tsx`, `useAgentMap.ts`) filtered to cases whose `lawId` matches this
bill's law, so a law being struck down while a spectator is sitting on its detail page animates the
new spur appearing live, rather than requiring a refresh.

## States & edge cases

- **Bill still in `proposed`**: line renders with only the first station reached/current, all others
  fully dimmed outlines — don't pre-render future station dates as blank/dashed, just omit dates
  entirely on unreached stations.
- **Withdrawn bill** (`status === 'withdrawn'`): a distinct terminal marker at whatever station it
  was withdrawn from (use `lastActionAt` to infer which), styled neutrally (stone, not danger red —
  withdrawal isn't failure, it's the sponsor's choice), reusing the existing withdrawal banner copy.
- **Vetoed then overridden**: show both the Vetoed spur *and* the Override→Law continuation — this
  is a real, visible branch-and-rejoin, not a dead end; don't collapse it to just "Law" and hide
  that a veto happened.
- **Law never challenged**: no judicial spur renders at all — the main line simply ends cleanly at
  "Law." Do not render an empty/grayed "Challenged?" station as a permanent fixture; its absence is
  itself information (this law has stood unchallenged).
- **Law challenged but case still in progress** (`filed/docketed/argued/deliberating`, not yet
  `decided`): show the spur in an "in progress" state (pulsing, no outcome color yet) rather than
  waiting for a final verdict to show anything — a spectator on the bill page should know a
  challenge exists even before it's decided.
- **Recurring-spend law nearing sunset lapse**: the Law station's detail should surface
  `ticksUntilLapse` from the budget API in a warning tone when low (mirrors `BudgetPage.tsx`'s
  existing `p.ticksUntilLapse <= Math.ceil(budgetCycleTicks / 4)` yellow-warning threshold) — a law
  quietly expiring is a real state change spectators should be able to see from the bill page, not
  just the budget page.

## What good looks like

- A spectator can see, in one glance at the top of the page, the bill's entire realized path — not
  just its current status badge.
- The common case (a clean bill that passed and became law, never challenged) renders as a simple,
  uncluttered straight line — the branch complexity only appears for bills that actually took a
  branch.
- A law that was later struck down by the court is now visible *from the bill/law page itself*,
  with a direct link to the deciding case — this fact was previously invisible unless you already
  knew to look for it.
- Amendments, lobbying, and fiscal notes read as details *of a specific point in the journey*
  instead of a disconnected stack of unrelated sections.
- The judicial branch is visually distinguishable from legislative failure — being struck down
  reads as a different kind of event than being vetoed or failing a floor vote.
- Live updates (a bill advancing, a law being struck down) animate the line rather than requiring a
  page refresh to notice.

## Prompt to paste

> Design a horizontal subway/metro-line "Bill Journey" component per
> `guidelines/03-bill-journey.md` for the AgoraBench bill detail page — stations for Proposed,
> Committee, Floor, Passed, Law, with branch spurs for Tabled, Failed, Vetoed/Override, and a new
> post-enactment Judicial Review spur (a law can be struck down by the Supreme Court after
> enactment) styled in judicial slate to read as distinct from legislative failure. Animate the
> current-position marker and hang amendments, fiscal note, and lobbying detail off the relevant
> station via click-to-expand, replacing the current stack of independent page sections.
