# Spec: Press Room page — Briefing Room + Statements + Daily Gazette, real-data-first

2026-07-11. Spec derived from the owner's Claude Design mockup bundle
(`Broadcast dashboard mockup-handoff`, files `Press Room.dc.html` + `Briefing Room Layout.dc.html`).
The mockup is a design target, not code to copy — its statement text, gazette prose, agent roster, and
"issue numbers" are fabricated. This spec grafts the mockup's *layout and the two genuinely-new assets it
carries* onto the real backend, which was field-verified against `src/` on 2026-07-11 (see §2). No
fabricated press content ships to the live site.

Standing constraints inherited from project doctrine and prior decisions:
- **Real data only.** Same rule the Elections spec (`docs/specs/elections-broadcast-page.md`) was written
  under. Every mockup element is classified exists / new-frontend / new-backend / dropped (§2).
- **`approvalDelta` becomes a visual centerpiece of the Statements tab** — owner decision. The field is
  already real and already reaches the client; today it is invisible. This is a UI investment in real
  data, not new data.
- **Press Room stays one page with tabs, not split into separate pages** — owner decision. The mockup
  adds a third tab (Briefing Room); the current page has two (Statements, Gazette).

Related work this must not duplicate or contradict:
- `docs/specs/elections-broadcast-page.md` — the Elections broadcast (separate page, separate thread).
  Shares the design system and the `PixelAvatar`/`SectionHeader` component vocabulary; no data overlap.
- `docs/DIVERGENCE_EXPERIMENT.md` §1.5 — engine-is-physics-not-policy. The Briefing Room is presentation
  over a background image; it invents no engine mechanic.

---

## 1. Summary

`PressRoomPage.tsx` today is a two-tab page (Statements / Daily Gazette) that already fetches real
`agent_statements` and `gazette_issues`. This spec:

1. **Adds a third tab, "Briefing Room"** — a static reference-art view: the new `briefing-room.png`
   background with 45 hand-calibrated seat positions and a podium marker, seats occupied by real agents.
   Purely presentational; no backend (§4.1). This is the single largest new surface and it is frontend-only.
2. **Surfaces `approvalDelta` as the centerpiece of the Statements tab** — Biggest Movers strip, a
   "Backfired" callout, and a per-statement delta chip. All from data already on the wire (§4.2).
3. **Reskins the Daily Gazette tab** to the mockup's masthead/front-page treatment over the real
   `gazette_issues` body, correcting for fields the mockup invented (issue number, paragraph array) (§4.3).

The backend work is near-zero: statements and gazette are already served with everything needed. The two
optional backend items (a `pressApi.statements()` helper; a per-statement sparkline history) are called
out in §3 and both are deferrable — the page ships without either.

New assets added to the repo this session (`public/images/briefing-room/`):
- `briefing-room.png` (1264×848) — the briefing-room background, calibrated against the seat coordinates.
- `briefing-room-grid.png`, `briefing-room-grid-seats.png` — calibration overlays (dev reference, not shipped).
- `briefing-room-alt-nano-banana-2.png`, `briefing-room-alt-nano-banana-pro.png` — alternate AI renders,
  same 1264×848 frame, kept as swap candidates pending the art-style calibration rule (see §6).

---

## 2. Gap analysis — mockup element vs real backend

Verified against `src/` 2026-07-11. Effective API paths are under `/api` (`/api/press`,
`/api/press/gazette`, `/api/press/gazette/latest`).

| Mockup element | Verdict | Real source / what's needed |
|---|---|---|
| Agent statement (text, author, time) | Exists | `agent_statements` (`src/modules/agents/db/schema/agentStatements.ts:4-27`): `statementText`, `agentId`, `createdAt`. Served by `GET /api/press` (`src/modules/press/server/routes/press.ts:60-135`), joins `agents.displayName` as `agentName`. |
| Statement trigger badge (bill passed, veto, etc.) | Exists | `agent_statements.triggerType` varchar(40) — values enforced in code, **not** a DB enum: `bill_passed / bill_failed / bill_vetoed / election_won / election_lost / deal_broken / proactive`. Note `bill_proposed` is defined in the type union but **never emitted** by the tick — drop it from any "all triggers" UI or it renders an always-empty bucket. |
| **`approvalDelta` on each statement** | **Exists (invisible today)** | `agent_statements.approvalDelta` real NOT NULL default 0 (`agentStatements.ts:18`). Written by tick Phase 11.5 (`agentTick.ts:4869-4948`, hardcoded per-trigger map). Already in the `GET /api/press` payload (`press.ts:90,110`) and already in the client `PressStatement` interface (`PressRoomPage.tsx:27`) — but `StatementCard` never renders it. Surfacing it is pure frontend. |
| Statement → bill link | Exists (partial) | `triggerBillId` / `triggerElectionId` / `triggerDealId` nullable uuids (`agentStatements.ts:14-16`). **Bare uuid columns, no enforced FK.** The current UI already renders a "View Bill" link off `triggerBillId`. The mockup's rich "Re: MG-061 — <full bill title>" needs a bill-title join the current payload does not include — either join `bills.title` server-side or resolve client-side. Flag as a small backend add if the full title is wanted (§3.2). |
| Per-statement approval sparkline (mini line chart) | New / partly droppable | The mockup draws a sparkline per statement. There is **no per-statement approval time-series**; `approvalDelta` is a single scalar per statement. Options: (a) drop the sparkline, show the scalar chip only — honest, thin; (b) build a small sparkline from the agent's *recent statement deltas* (a real series: the last N `approvalDelta` values for that agent, already queryable). Recommend (a) for slice 1, (b) as a follow-on (§3.3). Do NOT fabricate a smooth curve. |
| "Biggest Movers this cycle" | Exists (derivable) | Rank agents by summed/most-recent `approvalDelta` over a recent window — pure client-side aggregation of the `GET /api/press` feed, or a small server aggregate (§3.3). No new data. |
| "Backfired" callout (negative-delta statement) | Exists (derivable) | The most-negative recent `approvalDelta` statement. Pure client-side pick from the feed. |
| Daily Gazette issue (headline, body) | Exists | `gazette_issues` (`src/modules/press/db/schema/gazette.ts:11-25`): `headline` varchar(200), `body` text. Actively written once per tick, gated on `rc.gazetteEnabled` (default true, `runtimeConfig.ts:131,322`), writer at `agentTick.ts:6404-6470`. Served by `GET /api/press/gazette` + `/gazette/latest` (`press.ts:9-57`). |
| Gazette "Issue No. 58" | Dropped (fabricated) | **No issue-number column.** Order/identity is `createdAt` only. Use a date/tick label, or a derived ordinal ("latest", "N issues ago") — never a stored issue number. |
| Gazette paragraph array + drop-cap per para | Reframed | `body` is a single `text` blob; the current UI splits on newlines into paragraphs. The mockup's multi-paragraph front-page/drop-cap layout works fine over that split — just source paragraphs from `body.split('\n')`, not a fabricated `paragraphs[]`. |
| Gazette `tickId` / "published each tick" | Exists | `gazette_issues.tickId` nullable FK → `tickLog.id` (`gazette.ts:15`); the "published each simulation tick" masthead line is true. |
| **Briefing Room tab (podium, seated press, live beats)** | **New frontend, zero backend** | No `press_secretary`, `podium`, briefing "beat/round", or live-briefing concept exists. `press_briefing` is a `governmentEvents` enum value (`governmentEvents.ts:8`) that is **never inserted** — vestigial. The tab is presentation over `briefing-room.png` + the calibrated seat layout (§4.1). Any "live beat"/press-secretary-speaking narration is either dropped or driven by a *client-side rotation over real recent statements*, clearly framed as reference art (the mockup already labels it "Reference art · occupancy is simulated"). |
| Calibrated press-seat coordinates (45 seats) | New (static asset) | Hand-calibrated `CALIBRATED_PRESS` (45 seats, viewBox 1000×671) + `PODIUM_POSITION {x:500,y:346}` from the mockup, calibrated against `briefing-room.png`. Ship as a static layout constant (§4.1) — there is nothing to persist; it is art registration data. |
| Party name / abbreviation / color | Exists (color derived) | Real seeded parties (`seedFn.ts:106-110`) are exactly the mockup's set: Progressive Alliance/PA, Moderate Coalition/MC, Constitutional Order Party/COP, Liberty First Party/LFP, Technocratic Union/TU. **No color or logo column** — color is derived from `alignment` client-side (`PartyDetailPage.tsx:41-47`). Reuse that alignment→color map; do not hardcode the mockup's hex per fake-party. |
| Party logo asset per statement/agent | Exists (partial) | Convention `/images/parties/${abbr.toLowerCase()}.webp` (`AgentProfilePage.tsx:1366`). **Only 3 of 5 exist**: `cop.webp`, `pa.webp`, `tu.webp`. Missing `mc.webp`, `lfp.webp`. If the Press Room shows party logos, either generate the two missing logos (art task, subject to the calibration rule) or fall back to the alignment-color dot. Flag, don't silently 404. |

Headline: **the Statements and Gazette tabs are backed by real, already-served data; the only truly new
surface is the Briefing Room tab, which is frontend-only presentation over a background image. The
highest-value change (`approvalDelta` centerpiece) is surfacing data that already reaches the client.**

---

## 3. Backend spec

Near-zero. Statements and gazette are already served with all fields the page needs. Everything below is
optional; the page ships without any of it. Any actual new field or route keeps the existing public,
spectator-data posture of the press routes (no auth change) and whitelists its response shape explicitly.

### 3.0 What already exists (do not rebuild)
- `GET /api/press` — statements feed, `?agent=`, `?triggerType=`, `?limit=` (≤100), `?offset=`; returns
  `approvalDelta`, `triggerType`, `triggerBillId`, `agentName`, `statementText`, `createdAt`
  (`press.ts:60-135`).
- `GET /api/press/gazette` + `GET /api/press/gazette/latest` — gazette list + latest (`press.ts:9-57`),
  return `id, tickId, headline, body, createdAt` (deliberately omit `digest`).
- WS events `agent:statement` (`agentTick.ts:4962-4968`) and `press:gazette` (`:6459`) — already
  subscribed by the current page for live prepend.

### 3.1 `pressApi.statements()` helper (optional, tidy-up)
The Statements tab currently uses a raw `fetch('/api/press?...')` (`PressRoomPage.tsx:367`); `pressApi`
only defines `gazette`/`gazetteLatest` (`api.ts:110-114`). Adding `pressApi.statements({agent, triggerType,
limit, offset})` is a small consistency improvement, not required. Do it in the frontend slice, not as
separate backend work.

### 3.2 Bill-title on statements (optional, small)
To render the mockup's "Re: <full bill title>" instead of a bare "View Bill", join `bills.title` for
`triggerBillId` in `GET /api/press` (left join, title nullable when the link is dangling — recall these are
unenforced uuid columns, so guard for a missing bill row). Additive to the response shape; whitelist the
new `triggerBillTitle` field explicitly. Skip if the bare link is acceptable.

### 3.3 Recent-delta aggregation for Biggest Movers / sparkline (optional)
Biggest Movers and the per-agent delta sparkline can both be computed client-side from the existing feed.
If the window needs to exceed the fetched page, add a small aggregate read (e.g.
`GET /api/press/movers?window=<ticks>` returning per-agent summed `approvalDelta` + the recent delta
series). Pure read over `agent_statements`, no new writes, no new column. Deferred by default; the
scalar-chip version (§4.2) needs none of it.

### 3.4 New RuntimeConfig fields
None. If a future slice adds a toggle (e.g. a "live briefing rotation" on/off), it gets the full
four-things treatment in the same commit per CLAUDE.md rule #1.

### 3.5 What explicitly does NOT exist (do not assume)
- No press-secretary agent, podium, live-briefing session, or briefing "beats/rounds" anywhere in schema
  or code. `press_briefing` is a never-written `governmentEvents` enum value.
- No gazette issue-number column; no gazette paragraph array (single `body` blob).
- No per-statement approval time-series (only a scalar `approvalDelta` per statement).
- No party color or logo column; color derives from `alignment`, and only 3 of 5 party logos exist.
- `bill_proposed` triggerType is defined but never emitted.

---

## 4. Frontend spec

`PressRoomPage.tsx` gains a third tab and a reskin of the two existing tabs. Tab model becomes
`'briefing' | 'statements' | 'gazette'` (currently `'statements' | 'gazette'` at `:329`).

### 4.1 Briefing Room tab (new, frontend-only)
- Background: `public/images/briefing-room/briefing-room.png`, `aspect-ratio:1264/848`, in a rounded
  bordered frame (mockup markup, `Press Room.dc.html:86-114`).
- Seat overlay: an SVG `viewBox="0 0 1000 671"` layered over the image. Seats from the static
  `CALIBRATED_PRESS` constant (45 entries, below); podium avatar at `PODIUM_POSITION {x:500, y:346}`.
  Ship the constant in a small module, e.g. `src/modules/press/client/briefingSeats.ts`:

```ts
// Hand-calibrated against briefing-room.png (1264px wide → 1000-wide viewBox, /1.264).
// Not a smooth formula — matches the actual art. Podium at viewBox (500, 346).
export const PODIUM_POSITION = { viewBoxWidth: 1000, viewBoxHeight: 671, x: 500, y: 346 };
export const CALIBRATED_PRESS = [
  { r:0,c:0,x:337,y:404 },{ r:0,c:1,x:391,y:404 },{ r:0,c:3,x:461,y:404 },{ r:0,c:4,x:500,y:404 },
  { r:0,c:5,x:556,y:405 },{ r:0,c:6,x:609,y:404 },{ r:0,c:7,x:664,y:405 },{ r:0,c:8,x:718,y:405 },
  { r:1,c:0,x:283,y:405 },{ r:1,c:1,x:376,y:416 },{ r:1,c:3,x:454,y:419 },{ r:1,c:4,x:500,y:419 },
  { r:1,c:5,x:546,y:419 },{ r:1,c:8,x:686,y:419 },{ r:2,c:0,x:254,y:417 },{ r:2,c:1,x:315,y:417 },
  { r:2,c:3,x:445,y:433 },{ r:2,c:4,x:500,y:433 },{ r:2,c:5,x:555,y:433 },{ r:2,c:6,x:610,y:433 },
  { r:2,c:8,x:748,y:419 },{ r:3,c:0,x:212,y:433 },{ r:3,c:1,x:285,y:434 },{ r:3,c:2,x:357,y:434 },
  { r:3,c:3,x:436,y:451 },{ r:3,c:4,x:500,y:451 },{ r:3,c:5,x:564,y:451 },{ r:3,c:6,x:628,y:451 },
  { r:3,c:7,x:715,y:434 },{ r:3,c:8,x:789,y:434 },{ r:4,c:0,x:159,y:456 },{ r:4,c:1,x:245,y:456 },
  { r:4,c:2,x:330,y:456 },{ r:4,c:3,x:424,y:476 },{ r:4,c:4,x:500,y:476 },{ r:4,c:5,x:576,y:476 },
  { r:4,c:6,x:652,y:476 },{ r:4,c:7,x:757,y:457 },{ r:4,c:8,x:842,y:456 },{ r:5,c:0,x:85,y:486 },
  { r:5,c:1,x:189,y:487 },{ r:5,c:2,x:293,y:487 },{ r:5,c:6,x:684,y:510 },{ r:5,c:7,x:811,y:488 },
  { r:5,c:8,x:916,y:488 },
];
```
- Occupancy: seat the front rows with **real recent agents** (from the statements feed or an agents
  query), `PixelAvatar` by `seed=agentId`. Empty seats render as a faint dot. Keep the mockup's honest
  "Reference art · occupancy is simulated" label.
- "At podium" avatar: the currently-relevant speaker — a real recent statement author (e.g. latest
  `proactive` or `election_won` statement), NOT a fabricated press secretary. If nothing sensible is
  available, show the capitol icon or an empty podium — never invent an agent.
- Live beat / caption strip: optional. If kept, rotate through the *real* recent statements
  (`GET /api/press`), one at a time — a client-side ticker, clearly reference-art. Drop the mockup's
  scripted press-secretary "beats" entirely (no backing data).
- **Explicitly dropped from the mockup's Briefing Room**: the standalone `Briefing Room Layout.dc.html`
  drag-to-calibrate tool (that was authoring tooling to *produce* the coordinates above; the coordinates
  are now captured, so the tool is not shipped), the "Speaker"/"Guest" marker roles (6 + 3 markers that
  belong to the calibration tool, not the page), the localStorage lock/snapshot machinery, and the
  three-node "stage tracker" (no briefing-stage backend).

### 4.2 Statements tab — `approvalDelta` as centerpiece (the owner-priority change)
Reuse the current data path (`GET /api/press`, WS `agent:statement`); add the delta-driven UI, all from
data already on the wire:
- **Biggest Movers** strip (`Press Room.dc.html:131-146`): top agents by recent `approvalDelta`
  (client-side aggregate, §3.3). `PixelAvatar` + name + delta chip. Sparkline: per §2, either drop it
  (slice 1) or build it from the agent's recent real deltas (follow-on) — never a fabricated curve.
- **Backfired callout** (`:149-161`): the most-negative recent-delta statement, red-accented.
- **Per-statement delta chip** on each `StatementCard`: `▲ +2.9` / `▼ −3.6` colored by sign, labeled
  "approval impact". This is the specific field that is real today and invisible in the UI — the whole
  point of the change. Color via the alignment/party color for the author's party ring, delta color by
  sign.
- Trigger badge: from real `triggerType` (7 live values; omit `bill_proposed`). Bill link from
  `triggerBillId` (bare "Re: bill" unless §3.2 adds the title).
- Keep the existing filter pills, but map them to the 7 emitted `triggerType` values only.
- Layout options from the mockup (`Briefing Feed` chronological vs `Category Board` by trigger) are both
  fine over the same data; pick one as default (recommend Briefing Feed — matches the current
  chronological UX and the WS prepend model).

### 4.3 Daily Gazette tab — masthead reskin over real body
Reuse `pressApi.gazette(...)` / `gazetteLatest` and the `press:gazette` WS. Apply the mockup's masthead +
front-page/timeline treatment (`Press Room.dc.html:232-330`) with these corrections:
- **No issue number.** Masthead shows the real `createdAt` date and/or `tickId`, or a derived ordinal
  ("Current edition", "3 editions ago"). Remove every `Issue No. N` binding.
- Paragraphs come from `body.split('\n')` (real), not a `paragraphs[]` array. Drop-cap on the first
  paragraph is fine; it's pure CSS over the real first block.
- Back-issues / archive list: real gazette list ordered by `createdAt` desc (the API already paginates).
- Keep "Published each simulation tick" — it is literally true.

### 4.4 Shared / component notes
- Party color: reuse the alignment→color map (`PartyDetailPage.tsx:41-47`) — do not port the mockup's
  per-fake-party hex. Party abbreviations are real (PA/MC/COP/LFP/TU).
- Party logos: only `pa/cop/tu` exist; guard `mc`/`lfp` with an alignment-color-dot fallback, or generate
  the two missing logos as an art task (§6). No silent 404s.
- `PixelAvatar` by `seed=agentId`; `SectionHeader {title, badge?}` for the strip headers — both confirmed
  present in the design system.

---

## 5. Phased implementation plan

Thin slices, each independently shippable; frontend-heavy since the data already exists.

- **Slice 1 — Statements `approvalDelta` centerpiece (frontend-only).** Render the delta chip on
  `StatementCard`; add Biggest Movers + Backfired from client-side aggregation of the existing feed; add
  the `pressApi.statements()` helper (§3.1) while in there. No backend, no migration. This is the
  owner-priority change and the fastest win — the data is already on the client. Verify: `/verify` the
  Statements tab on a run with real statements; confirm deltas render and match the payload. Small (~half
  to one day).

- **Slice 2 — Briefing Room tab (frontend-only).** New tab + `briefingSeats.ts` constant + SVG overlay
  over `briefing-room.png`, seated with real recent agents, honest reference-art label. Drop the
  calibration tool / speaker+guest roles / stage tracker (§4.1). Verify: `/verify` the tab renders seats
  aligned to the art at multiple widths (aspect-ratio locked). Small-to-medium (~1 day). Independent of
  Slice 1.

- **Slice 3 — Gazette masthead reskin (frontend-only).** Apply the masthead/front-page/timeline layout
  over real `gazette_issues`; strip all issue-number bindings; paragraphs from `body.split('\n')`. Verify:
  `/verify` against a run with ≥2 gazette issues (and the empty-state, which is expected early). Small (~half
  day). Independent.

- **Slice 4 (optional) — bill titles + delta sparklines (backend + frontend).** Add `bills.title` join
  (§3.2) and/or the recent-delta aggregate (§3.3) with real per-agent delta series; wire the "Re: <title>"
  link and the sparklines. Only if the scalar chip + bare link prove insufficient. Medium (~1 day).

Sequence: Slices 1, 2, 3 are mutually independent and can run concurrently in isolated worktrees. Slice 4
is a follow-on to 1. None is gated on a backend deploy for the core experience.

---

## 6. Open questions / owner decisions

1. **Missing party logos** — generate `mc.webp` and `lfp.webp` (art task, subject to the standing
   art-style-calibration rule: 3–4 approved samples before bulk), or ship the alignment-color-dot fallback
   and skip logos in the Press Room? Recommend the fallback now, logos as a separate art pass.
2. **Briefing Room "at podium" / live beat** — is a client-side rotation over real recent statements the
   right read, or should the Briefing Room be static reference art with no rotating caption at all?
   Recommend the rotation, clearly labeled as reference art; it adds motion without inventing data.
3. **Delta sparklines** — drop them (scalar chip only, slice 1) or build the real per-agent recent-delta
   series (slice 4)? Recommend shipping the chip first and treating the sparkline as a proven-need follow-on.
4. **Background art** — `briefing-room.png` is the calibrated frame; two alternate renders
   (`-alt-nano-banana-*`) are in the folder. Keep the calibrated one (seats already match it), or
   recalibrate against an alternate? Recommend keeping the calibrated frame — the 45 coordinates are
   registered to it; swapping the art invalidates the calibration.
