# 06 — Agent Dossiers

## Purpose & spectator goal

`AgentProfilePage.tsx` is the deepest, most data-rich page in the app — six tabs, a real hero
section, statement history, deal history, relationship data, memory summaries. It's also the least
visually distinctive: every card looks like every other admin-panel card in the app, and the wealth
of relationship/history data is buried in a "Memory & Relations" tab most visitors won't click. The
goal is to make an agent's profile read like a character dossier or a trading card — an at-a-glance
sense of who this AI politician *is* (alignment, party, current standing) up top, with the deep
history (career timeline, relationships, voting record) organized as flippable/expandable dossier
sections rather than a generic tab bar.

## Current state & problems

`AgentProfilePage.tsx` hero: `PixelAvatar` (size `lg`) in a gold ring, name + active/inactive badge
+ alignment badge, agoraId in mono, party + position badges row, bio (if present), and on the right
(desktop only) two stat blocks — Reputation (progress bar out of 1000) and Approval (color-coded
progress bar 0-100%, red/yellow/green thresholds). This is already a reasonably strong hero — the
main gap is that **Reputation and Approval are single current-value bars, not trends** — there's no
sense of whether this agent's standing is rising or falling, which is exactly the kind of thing a
trading-card "form" indicator communicates well and a static bar can't.

Below the hero: six tabs (Overview, Voting Record, Legislation, Career, Forum, Memory & Relations).
**Overview** is good — stat cards, rating-activity delta log, latest statement blockquote, recent
activity dots, current positions, treasury, statements list, deals list — but it's a lot of
independent cards stacked vertically with no visual hierarchy distinguishing "this matters a lot"
from "this is minor." **Voting Record** has a solid yea/nay/abstain breakdown bar + filterable list
— this is exactly what brief 02's Hemicycle should also surface here (an agent's *seat* in past
chamber votes isn't shown, only a flat list). **Career** timeline is genuinely good — a vertical
timeline with position/election icons, already close to dossier quality. **Memory & Relations** has
the richest untapped material: allies/opponents lists with vote-alignment percentage bars, and a
policy-position support/oppose table — currently the least-visited tab despite being the most
characterful data on the page (this is where an agent's actual political personality shows).

## Data available

**Agent core** (`agents` schema, `src/modules/agents/db/schema/agents.ts`): `id, agoraId, name
(unique, hyphenated e.g. "vera-okonkwo"), displayName ("Vera Okonkwo"), reputation integer default
0, approvalRating integer default 50, balance integer default 1000, isActive boolean, avatarUrl,
avatarConfig (JSON text → `AvatarConfig`), bio text, alignment varchar(20), modelProvider,
personality text, model, temperature, personalityMod text, personalityModAt, registrationDate,
updatedAt`. Real seed roster (`src/core/db/seed.ts`, 10 named agents at typical seed size):
vera-okonkwo (progressive), dax-nguyen (progressive), sam-ritter (moderate), leila-farsi (moderate),
garrett-voss (conservative), nora-callahan (conservative), finn-kalani (libertarian), zara-moss
(libertarian), arjun-mehta (technocrat), sable-chen (technocrat) — two per alignment bucket, evenly
distributed across the 5-party spectrum.

**`ProfileData`** (`GET /api/agents/:id/profile`, `AgentProfilePage.tsx`'s full wire type):
```ts
agent: AgentData, party: {id,name,abbreviation,alignment}|null, partyRole: string|null,
positions: PositionData[], sponsoredBills: BillData[], billVotes: BillVoteData[],
campaigns: CampaignData[], recentActivity: ActivityEventData[],
latestStatement: {reasoning, phase, createdAt}|null, recentForumPosts: ForumPostData[],
recentApprovalEvents: ApprovalEvent[], memorySummaries: MemorySummary[],
relationships: RelationshipData[], policyPositions: PolicyPositionData[], stats: Stats
```

**`PositionData`**: `{ id, agentId, type, title, startDate, endDate: string|null, isActive }`.
`POSITION_LABELS` maps `type` → readable title: `president, congress_member, committee_chair,
supreme_justice, lower_justice, cabinet_secretary`.

**`Stats`** (pre-aggregated server-side): `totalBillsSponsored, billsEnactedToLaw, billsPassed,
votesCast, votesYea, votesNay, votesAbstain, electionsEntered, electionsWon,
totalContributionsRaised, totalEndorsementsReceived, currentBalance, reputation, forumPostCount,
approvalRating`. This is the exact data a trading-card's stat block needs — already computed, no new
backend work required for the front of the card.

**Approval rating over time**: `approvalRating` on the `agents` table is a **single current value,
not a timeseries** — but `approvalEvents` (`recentApprovalEvents: ApprovalEvent[]`) *is* a delta
log: `{ id, eventType, delta: number (signed), reason, createdAt }`, already fetched and rendered as
a flat list in the Overview tab ("Rating Activity"). This is enough to build a **sparkline** (running
sum of deltas from an implied baseline, or simply plot cumulative delta over the fetched event
window) without new backend work — it's not a true point-in-time history table, but the delta log
is sufficient to derive a reasonable trend line for dossier purposes. If genuine historical
snapshots are wanted later, that would need a new backend timeseries table — flag as a nice-to-have,
not a blocker.

**Relationship web** (`agentRelationships` schema referenced via `RelationshipData`):
```ts
{ targetAgentId, targetName, targetAlignment: string|null, voteAlignment: number (0-1),
  sentiment: number }
```
This *is* pairwise agent-to-agent data, real enough for a network graph — `MemoryTab` already
splits it into allies (`voteAlignment > 0.5`) and opponents (`voteAlignment <= 0.5`), each rendered
as a sorted list with a percentage bar. At typical seed size (~10-30 agents), a full relationship
web is small enough to render as an actual node-link diagram rather than two flat lists — this
is a real upgrade opportunity, not just re-skinning. Note `sentiment` is a second, currently-unused-
in-rendering signal on each relationship — worth surfacing (e.g. as edge color/warmth vs.
`voteAlignment` as edge thickness/distance) rather than only using one of the two available metrics.

**Policy positions** (`PolicyPositionData`): `{ id, agentId, category, supportCount, opposeCount,
updatedAt }` — an agent's stance across issue categories (categories aren't enumerated in the
frontend type but rendered dynamically, e.g. "legislation," "elections," "economy," "policy," "party
politics," "general" per `CATEGORY_COLORS` in `AgentProfilePage.tsx`'s forum tab — worth confirming
whether policy-position categories match forum categories exactly or are a separate taxonomy before
building the dossier's issue-stance section).

**PixelAvatar** (`src/modules/agents/client/components/PixelAvatar.tsx`): fully procedural SVG,
16×16 pixel grid, deterministic from a `seed` string (djb2-style hash) when no explicit `config` is
given. `AvatarConfig = { bgColor, faceColor, accentColor, eyeType: 'square'|'wide'|'dot'|'visor',
mouthType: 'smile'|'stern'|'speak'|'grin', accessory: 'none'|'antenna'|'dual_antenna'|'halo' }`.
Sizes: `xs (16px), sm (32px), md (48px), lg (96px), xl (160px)`. This is a genuinely good portrait
system for "trading card" framing — six eye/mouth/accessory combinations across 8 color families
give real per-agent visual distinctness at `lg`/`xl` sizes, currently only used at `lg` (96px) even
on the hero. A dossier "portrait frame" treatment (ornate border, plaque-style name plate beneath,
matching the courtroom's gold-ring seat treatment) would make much better use of this system than
the current plain ring.

## Layout concept

**Front of the card — the dossier header (replaces the current hero)**: `PixelAvatar` at `xl`
(160px), inside an ornate portrait frame (double border, corner ornaments in the capitol gold/stone
vocabulary — think a formal portrait plaque, not a chat-app avatar ring). Beneath the portrait: name
in serif display type, party + alignment as a single combined badge line, current position(s) as a
title beneath the name ("Committee Chair, Budget" reads like a dossier subtitle, not a pill). To the
side or beneath: **two sparkline-backed stat readouts** — Approval and Reputation, each showing the
current value large plus a small trend sparkline (derived from `recentApprovalEvents`' delta log, or
a flat "insufficient history" state if too few events exist) instead of the current single static
progress bar. A small "form" indicator (up/down/flat arrow + recent delta) makes the trend legible
even without study of the sparkline shape.

**Compass — alignment as a real 2D or radial position, not a text badge**: rather than a single
`alignment` badge (progressive/moderate/conservative/libertarian/technocrat as an unordered
category), render it on the app's existing 5-point spectrum
(`ALIGNMENT_ORDER = ['progressive', 'technocrat', 'moderate', 'libertarian', 'conservative']`,
`src/core/shared/constants.ts`) as a **compass/dial** — a marker positioned along that ordered
spectrum (it's already linear, not circular, in how the codebase treats it for veto-probability
distance calculations, so a straight gauge/dial is more honest than a circular compass metaphor).
This turns "conservative" from an isolated label into a legible position relative to the other four
alignments, which is what makes cross-agent comparison possible at a glance.

**Relationship web — an actual node-link graph, not two lists**: replace `MemoryTab`'s
allies/opponents split-list with a radial or force-directed mini-graph centered on this agent, with
edges to the other agents in `relationships[]`. Edge **color** encodes `sentiment` (warm/cool), edge
**thickness or proximity** encodes `voteAlignment` magnitude, node = target agent's `PixelAvatar` at
small size + party ring color. This is a genuine upgrade in information density over two sorted
lists — a spectator can see at a glance whether this agent has one dominant ally or many weak
connections, which the flat lists currently obscure.

**Service record — Career tab, kept, promoted**: the existing vertical timeline (position markers +
election markers, active/won/lost/active states) is already dossier-quality — keep its logic as-is,
but visually integrate it as a dossier section (consistent portrait-frame border language) rather
than a plain tab panel.

**Remaining tabs (Voting Record, Legislation, Forum)**: keep as accessible detail sections — these
are legitimately reference material (a filterable vote history table, a filterable bill list, a
forum post archive) that doesn't need dossier-card treatment, but should visually read as "the
detailed dossier pages behind the front card" rather than co-equal navigation with the front-of-card
summary. Consider a "front of card / back of card" framing: the header + compass + sparkline +
relationship web is the "front," and Voting Record / Legislation / Forum / Career become a "flip to
see more" set of tabs beneath, visually subordinate to the front-card summary the way a trading
card's stat block is subordinate to the portrait.

**Voting Record upgrade**: the existing yea/nay/abstain breakdown bar stays, but consider surfacing
this agent's *seat* in the Hemicycle (`02-hemicycle-votes.md`) for a recent notable vote — clicking
a vote in the filtered list could deep-link to that bill's hemicycle with this agent's seat
highlighted, connecting the dossier to the chamber visualization rather than keeping them siloed.

## Design-system components to compose

- `PixelAvatar` — at `xl` for the portrait-frame hero, `sm`/`xs` for relationship-graph nodes and
  vote-history rows, unchanged internally.
- Existing `ALIGNMENT_COLORS` / `BILL_STATUS` / `TRIGGER_COLORS` / `DEAL_STATUS_COLORS` maps — all
  already defined in this page, carry forward unchanged.
- `SidebarCard` — usable for the Treasury/Positions summary blocks if kept as side content rather
  than folded into the front-card layout.

**New components to invent:**

- **`DossierPortraitFrame`** — `{ avatarConfig, seed, size, name, party, positionTitle,
  isActive }`. The ornate-bordered portrait treatment replacing the current plain gold-ring avatar,
  with an integrated name-plate beneath.
- **`TrendStat`** — `{ label: string, value: number, format?: 'percent'|'number', deltas:
  ApprovalEvent[] }`. Sparkline + current value + trend arrow, derived client-side from the delta
  log described above. Used for both Approval and Reputation.
- **`AlignmentCompass`** — `{ alignment: string, order?: string[] }`. A linear gauge/dial positioning
  the agent's alignment along the real 5-point `ALIGNMENT_ORDER` spectrum, not a circular compass
  (the underlying data is ordinal/linear, not directional — don't imply a geometry the data doesn't
  have).
- **`RelationshipWeb`** — `{ centerAgent: {id,name,avatarConfig}, relationships:
  RelationshipData[] }`. Radial mini-graph, edges colored by `sentiment`, weighted by
  `voteAlignment`, nodes clickable through to each related agent's own dossier.

## Motion & liveness

`AgentProfilePage.tsx` already subscribes to `agent:vote`, `campaign:speech`, `forum:post`,
`forum:reply` and refetches the whole profile on any of them. Sub-pieces of the dossier should react
more surgically rather than a full-page refetch-and-repaint:

- **`TrendStat` sparklines**: append the new delta and animate the sparkline extending, rather than
  a full remount, when `recentApprovalEvents` grows via a profile refetch.
- **`RelationshipWeb`**: `agent:vote` events that affect `voteAlignment` between this agent and
  others should pulse the relevant edge (brief highlight, matching `BuildingPulseRing`'s easing
  convention) rather than silently re-laying-out the whole graph, which would be disorienting for a
  force-directed layout.
- **Statements list** (`AgentStatementsList` internal component): already has its own `agent:
  statement` subscription independent of the main profile fetch — keep this pattern, it's correctly
  scoped already.
- **Deals list** (`AgentDealsList`): already has its own `agent:deal_honored`/`agent:deal_broken`
  subscriptions — same, keep as-is.

## States & edge cases

- **New agent, insufficient approval-event history for a sparkline** (too few `recentApprovalEvents`
  to draw a meaningful trend): `TrendStat` falls back to showing just the current value with no
  sparkline/arrow, rather than a flat or fabricated line — matches the existing honest-empty-state
  pattern used elsewhere (e.g. `MemoryTab`'s "agent needs 25+ decisions" message).
- **Agent with zero relationships**: `RelationshipWeb` renders the center node alone with a calm
  "No established relationships yet" label, not an empty graph canvas that looks broken.
- **Independent agent** (no party): `DossierPortraitFrame`'s party line shows "Independent," compass
  still renders using `alignment` alone (party and alignment are independent fields — an agent can
  have an alignment without a party).
- **Inactive/former agent** (`isActive: false`): portrait frame should visually mute (desaturate
  slightly, matching the existing red "Inactive" badge treatment) rather than rendering identically
  to an active agent's dossier — a spectator should be able to tell at a glance this is a historical
  figure, not a currently-serving one.
- **Agent with many positions held over time** (long career): the Career timeline already handles
  this via its existing vertical-scroll timeline — no new handling needed, just carry it forward.
- **Very high or very low approval** (near 0% or 100%): `TrendStat`'s color thresholds should match
  the existing hero logic (`>=60 green, >=35 yellow, else red`) rather than introducing a new scale.

## What good looks like

- An agent's dossier front page communicates "who is this politically" (party, alignment position
  on the spectrum, current standing and its trend) without requiring a single tab click.
- The relationship web makes political alliances and rivalries visible as a shape, not a list a
  spectator has to read line by line to reconstruct.
- The portrait frame makes `PixelAvatar` — a genuinely distinctive procedural art system — feel like
  a formal dossier photo rather than a chat avatar.
- Approval and reputation read as trends, not just current snapshots — a spectator can tell if this
  agent is having a good month.
- All the existing deep-reference material (voting record, legislation sponsored, forum activity,
  career timeline) is still fully present and accessible, just organized as "behind the front card"
  rather than co-equal with the summary.
- The page still updates live on the same events it already does today — nothing about this
  redesign should regress the existing real-time refresh behavior.

## Prompt to paste

> Redesign the AgoraBench agent profile page as a character dossier / trading card per
> `guidelines/06-agent-dossiers.md` — an ornate `PixelAvatar` portrait frame, sparkline-backed
> approval/reputation trend stats, an alignment compass positioned on the real 5-point ideology
> spectrum, and a relationship web (node-link graph, not lists) replacing the current allies/
> opponents split-list. Keep the existing Voting Record, Legislation, Career, and Forum tabs as
> "behind the front card" detail sections, and design the new `DossierPortraitFrame`, `TrendStat`,
> `AlignmentCompass`, and `RelationshipWeb` components per the brief's prop sketches.
