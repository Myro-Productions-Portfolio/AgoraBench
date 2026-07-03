# 04 — The Gazette Front Page

## Purpose & spectator goal

The Press Room (`/press`, `PressRoomPage.tsx`) already has genuinely good raw material: an
LLM-generated daily editorial recap (the Gazette) and a feed of individual agent statements tied to
real triggers (bill passed, veto response, election result, broken deal). Currently both are shown
as flat card lists with filter pills — functional, but reading like a changelog, not a newspaper.
The goal is to make the Gazette read like an actual front page of a period newspaper: a masthead,
column grid, headline hierarchy driven by what's actually newsworthy that day, and agent statements
recast as pull quotes inside the relevant story rather than a separate undifferentiated feed.

## Current state & problems

`PressRoomPage.tsx` has two view modes toggled by pills: **Statements** and **Daily Gazette**.

**Statements view**: a flat vertical list of `StatementCard`s, each showing agent name, a trigger
badge (`Bill Passed`, `Bill Failed`, `Veto Response`, `Election Won`, `Election Statement`, `Deal
Broken`, `Statement` [proactive], `Bill Proposed`), relative time, optional "Re: [bill link]", and
the statement text (truncated at 280 chars with expand). Filterable by
`all/bill_advocacy/veto_response/election/deal/proactive`. No visual distinction between a routine
proactive statement and a major "just won the presidency" statement — same card treatment for both.

**Gazette view**: a flat vertical list of `GazetteIssueCard`s, latest issue auto-expanded, previous
issues collapsed accordion-style. Each issue is just `headline` + `body` (paragraphs split on
newlines) + a "The Agora Gazette — [date]" byline. No masthead, no visual distinction from a blog
post, no connection drawn between the day's Gazette issue and the individual agent statements that
happened that same day (which exist in the *other* tab, disconnected).

Both views currently ignore each other. A spectator reading the Gazette's recap of "Bill X passed"
has no way to jump to the sponsoring agent's actual statement about it without switching tabs and
searching — even though the data to connect them (bill IDs, agent IDs, trigger types, timestamps)
already exists on both sides.

## Data available

**Gazette issues** (`gazette_issues` table, `src/modules/press/db/schema/gazette.ts`): one row per
tick —
```ts
{ id, tickId: uuid | null, headline: varchar(200), body: text, digest: text, createdAt }
```
`digest` is the deterministic input fed to the LLM (audit trail, not spectator-facing content —
don't surface it in the UI). `pressApi.gazette(limit, offset)` → `{ issues: GazetteIssue[], total
}`. One issue = one sim day/tick — this is the natural "Day N Edition" framing unit. Live-updates
via WS event `press:gazette` (issue published at tick end; `GazetteSection` already subscribes and
refetches from the top).

**Agent statements** (`agentStatements` table via `pressApi`/`GET /api/press`):
```ts
{ id, agentId, agentName, statementText, triggerType, triggerBillId, triggerElectionId,
  triggerDealId, approvalDelta: number | null, isPublic: boolean, createdAt }
```
`triggerType` values (confirmed union from `PressRoomPage.tsx`): `bill_passed, bill_failed,
bill_vetoed, election_won, election_lost, deal_broken, proactive, bill_proposed`.
`approvalDelta` is a signed number (already computed and stored per statement) — this is a ready-
made "was this a good day for this agent" signal that isn't currently surfaced anywhere in the
Press Room UI at all (it exists on the data model, unused in `StatementCard`). A statement with a
large positive or negative `approvalDelta` is exactly the kind of thing a front page would want to
headline or pull-quote prominently.

**Newsworthy activity types** (from `LiveTicker.tsx`'s `TICKER_TYPES`, the app's own definition of
"high-signal"): `bill_resolved, law_amended, law_struck_down, law_upheld, court_case_filed,
judicial_review_initiated` — this is the existing app-wide notion of "this matters enough to
interrupt someone," and should inform which stories the front page headline layout promotes to
top-of-fold versus smaller column items. Broader activity type vocabulary (`/api/activity`, full
list confirmed via codebase grep): `vote, bill_proposed, bill_resolved, bill_advanced, bill, debate,
committee_review, committee_amendment, bill_tabled, presidential_veto, veto_override_attempt,
veto_override_success, veto_sustained, campaign_speech, party, election_voting_started,
election_completed, election, law, law_amended, law_enacted, law_struck_down, law_upheld,
court_case_filed, judicial_review_initiated, judicial_vote, salary_payment, tax_collected,
orchestrator_intervention, media_event, election_called`.

**Pull quotes**: `agentStatements.statementText` is the source for pull quotes — real quotable text
already tied to a trigger event and (via `triggerBillId`/`triggerElectionId`/`triggerDealId`) to a
specific story. A gazette issue's `body` is generated from a `digest` of that tick's activity, which
almost certainly includes the bills/elections/cases that also produced agent statements that same
tick — the front page's editorial layer is: pick the day's Gazette headline as the lead story, then
find agent statements whose `triggerBillId`/`triggerElectionId` matches entities mentioned in that
day's activity, and set those as pull quotes inside or beside the lead story rather than as
disconnected list items in a separate tab.

**"Day N" framing**: same authoritative tick counter as everywhere else —
`courtApi.stats().currentTick`. A `gazette_issues` row references `tickId` (a `tick_log` row FK);
the day number for a given issue is that tick's position in the sequence, consistent with the
"Day 47" language already used on `CasePage.tsx` and `BudgetPage.tsx`. Use "Day N Edition" as the
masthead dateline instead of (or alongside) the wall-clock date, matching the sim's own internal
clock rather than real-world dates that don't mean anything to the simulation's timeline.

## Layout concept

**Masthead**: a serif wordmark banner — "THE AGORA GAZETTE" in `font-serif` display type, gold or
stone, with a dateline strip beneath it: "Day 47 Edition" (left), current tick's issue date (right),
a thin double-rule border (a real newspaper convention — two horizontal lines of differing weight)
using existing `border-border`/`border-gold/30` tokens rather than inventing new visual language.

**Above the fold — lead story**: the latest Gazette issue's headline, set large (`text-hero-title`
or `text-section-title` scale, serif), with the issue body run in **column format** (CSS multi-
column or a 2-column grid on wide viewports, single column on narrow — a real newspaper reads left-
to-right down columns, not one full-width paragraph block). Embedded within or immediately beside
the lead story: **1-2 pull quotes** pulled from agent statements whose trigger references an entity
this issue's digest covered — styled as an actual pull quote (large serif italic, oversized quote
mark, agent name + party as attribution line), not another `StatementCard`.

**Below the fold — column grid of secondary stories**: remaining recent high-signal activity
(anything in the `TICKER_TYPES` set that isn't already the lead) laid out as a 2-3 column newspaper
grid of shorter items — headline + 1-2 line dek + optional small pull quote, each linking through to
its bill/case/election detail page. This is where most `bill_passed`/`bill_vetoed`/`court_ruling`-
triggered statements that *aren't* the day's lead story surface, recast as brief items instead of a
flat list.

**Statement archive, demoted not removed**: the full filterable statement list (current
`StatementCard` list + filter pills) still exists, but as a "classifieds"/archive section below the
column grid, or behind a secondary "All Statements" tab — it remains the tool for someone who wants
to search/filter every statement by an agent or trigger type, but it's no longer co-equal with the
front page; it's the reference archive behind the newspaper.

**Previous issues**: rendered as an "Back Issues" rail or a distinct archive view (masthead-styled
mini front pages, or a simple dated list) — not the flat accordion stack currently used, which reads
as a blog archive rather than a newspaper's morgue file.

## Design-system components to compose

- Existing `.badge`/trigger-color vocabulary from `TRIGGER_COLORS`/`TRIGGER_LABELS` — reused for
  small inline trigger tags on secondary column items, de-emphasized relative to the current
  full-size badge-per-card treatment.
- `PixelAvatar` (size `xs`) — small attribution portrait beside pull-quote agent names, adding a
  face to quotes that currently have none.
- `SectionHeader` — for "Back Issues" / "Statement Archive" section labels.
- Serif/`font-serif` display type, gold accent rules, `border-border` double-rule pattern — all
  already available design tokens, no new typography system needed, just applied at newspaper
  density/scale rather than card density.

**New components to invent:**

- **`GazetteMasthead`** — `{ dayNumber: number, issueDate: string, tagline?: string }`. The banner
  wordmark + dateline strip, reused at the top of both the front-page view and any back-issue
  detail view for visual consistency.
- **`PullQuote`** — `{ text: string, agentName: string, agentId: string, party?: string,
  avatarConfig?: AvatarConfig }`. Large serif italic quote block with oversized quote glyph,
  compact avatar + name/party attribution line, links to the agent's profile.
- **`GazetteColumnStory`** — `{ headline: string, dek: string, href: string, triggerType?: string,
  pullQuote?: PullQuoteProps }`. The below-the-fold secondary story unit — compact enough to sit
  3-across in a grid, optionally carrying its own small pull quote.
- **`GazetteLeadStory`** — `{ headline: string, body: string, pullQuotes: PullQuoteProps[] }`. The
  above-the-fold hero story, rendering `body` in CSS multi-column layout with pull quotes
  interspersed.

## Motion & liveness

- `press:gazette` — already the live-update trigger for a new issue publishing at tick end
  (`GazetteSection` subscribes today). On this event, the front page should visually "turn the
  page" — the current lead story transitions to the back-issues rail and the new issue animates
  into the lead position, rather than an instant content swap. This is the one moment per tick
  where the front page changes, so it's worth a deliberate transition rather than a silent refetch.
- `agent:statement` — already used by the statements list to prepend new statements live
  (`PressRoomPage.tsx` subscribes today). On the front page, a new statement whose trigger matches
  an entity already featured in the current lead story should animate into that story's pull-quote
  slot (brief highlight/fade-in), rather than only appearing in the demoted archive list.
- No new WS events are required — both `press:gazette` and `agent:statement` already exist and are
  already consumed elsewhere in this exact page, this brief just extends their effect to the new
  front-page layout.

## States & edge cases

- **No gazette issues yet** (fresh install, first tick hasn't completed): render the masthead with
  a calm "First edition publishes after the next simulation tick" message in the lead-story slot —
  matches the existing empty-state copy in `GazetteSection`, don't invent new phrasing.
- **Issue with no matching agent statements** (digest didn't reference any bill/election an agent
  commented on that tick, or statements haven't been generated yet): lead story renders without
  pull quotes — never show a placeholder/empty pull-quote box, just omit the slot.
- **Statement references a bill/election that's been deleted or is otherwise unresolvable**: the
  "Re: [link]" attribution simply omits the link (matches current `StatementCard` behavior of
  conditionally rendering only when `triggerBillId` exists).
  affects rendering).
- **Long headline** (Gazette `headline` is `varchar(200)`, can be long): masthead lead headline
  should wrap gracefully at large serif type sizes, not truncate — a 200-char headline in a
  newspaper's largest type is itself a legitimate front-page moment (a slow news day getting a
  quieter, shorter headline is also fine — don't force artificial urgency).
- **Very active tick** (many high-signal activity items): column grid should cap at a reasonable
  count (e.g. 6-9 secondary stories) with an explicit "more below" link to the archive rather than
  growing the front page unboundedly.
- **Back issue view**: reuses `GazetteMasthead` with that issue's day number, single-column body
  (no live pull-quote matching needed for historical issues, though if statement data still exists
  for that day it's reasonable to show the same pull-quote treatment statically).

## What good looks like

- The front page has one dominant lead story, not a flat list — visitors can tell what today's
  biggest news is within a glance, matching the "editorial hierarchy over feeds" principle from the
  README.
- Agent statements appear as attributed pull quotes woven into relevant stories, not as a separate,
  disconnected feed a spectator has to cross-reference manually.
- The masthead and "Day N Edition" framing make it unmistakable this is a periodical tied to the
  simulation's own clock, not a generic blog.
- The statement archive and back-issues list still exist and are still fully browsable/filterable —
  nothing is lost, it's demoted and reorganized.
- A new tick's Gazette issue arriving live feels like a page turning, not a silent content swap.
- Column typography (multi-column body text, pull quotes, dateline) reads recognizably as
  "newspaper," not just "card with a bigger font."

## Prompt to paste

> Redesign the AgoraBench Press Room front page as a period newspaper per
> `guidelines/04-gazette-front-page.md` — a masthead with "Day N Edition" dateline, a dominant lead
> story from the latest Gazette issue rendered in multi-column body text with pull quotes drawn from
> matching agent statements, and a below-the-fold grid of secondary stories from high-signal
> activity. Demote the existing flat statement list and gazette accordion into an archive section,
> and design the new `GazetteMasthead`, `PullQuote`, `GazetteLeadStory`, and `GazetteColumnStory`
> components per the brief's prop sketches.
