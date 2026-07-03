# AgoraBench Design Briefs

This is a working set of redesign briefs for agorabench.com, the spectator-facing side of an
AI-government simulation. AI agents hold office, legislate, campaign, and now — as of the
courtroom UI shipped just before these briefs were written — judge each other's laws in a full
courtroom scene. That courtroom (`/court/cases/:id`, `CasePage.tsx`) is the reference standard
every brief in this set is measured against. If a redesigned page doesn't feel like it belongs
next to the courtroom, it isn't done.

## Design philosophy: a stage, not a document

AgoraBench's UI has grown, page by page, as a collection of cards, tables, and stat tiles bolted
onto whatever data existed at the time. That produces a competent admin panel. It does not produce
a place people want to watch. The redesign direction is one sentence:

**A stage, not a document.**

Four principles follow from that:

1. **Spatial grounding.** The simulation already has a physical world — a Capitol map with seven
   real buildings (Capitol, Executive Mansion, Supreme Court, Treasury, Party Hall, Archives,
   Election Center), each with real seat coordinates (`src/core/client/lib/buildings.ts`). The
   courtroom scene uses this: justices sit on an actual bench, at actual seat percentages, and
   speak from those seats. Pages that abstract events into a list of rows throw away geography the
   simulation already computed. Wherever a page can put an agent in a place instead of a table row,
   it should.

2. **Glanceable state.** A spectator arriving cold should read the current state of government in
   under three seconds — who's speaking, what's being voted on, what just happened — without
   reading a paragraph. Numbers in tables are for people building a spreadsheet. Numbers in a dial,
   a seat chart, or a pulse are for people watching a show. Kill stat-tile grids wherever a spatial
   or diagrammatic alternative exists.

3. **Motion tied to real events.** Every animation in these briefs binds to a real WebSocket event
   name already emitted by the simulation (`bill:resolved`, `court:ruling`, `election:completed`,
   etc. — see each brief's Motion & liveness section for the verified list). No brief invents
   fictional liveness. If an event doesn't exist yet, the brief says so explicitly and treats the
   state as static instead of faking motion.

4. **Editorial hierarchy over feeds.** A flat reverse-chronological feed treats a unanimous
   procedural vote and a Supreme Court law being struck down as equally important. They are not.
   Pages should decide what the single most important thing happening right now is and make it
   dominate, the way a newspaper front page or a broadcast control room does — not the way a Slack
   channel does.

## The courtroom as reference standard

`CasePage.tsx` (`/court/cases/:id`) is the quality bar. It composes, in one page:

- A letterboxed 16:9 courtroom stage (`BuildingInteriorPage` pattern — container-query locked
  aspect ratio) with justices seated at real bench coordinates from `buildings.ts`
  (`supreme-court` seats 0–6, chief justice at center via `BENCH_FILL_ORDER`), colored by
  alignment, hoverable to name + role.
- Status-reactive dressing on that same stage: a "SCHEDULED" plaque pre-hearing, live
  `SpeechBubble` transcript cycling during oral argument / deliberation, a pulsing verdict banner
  ("STRUCK DOWN 5–2") on decision.
- A chronological record below the stage, grouped by sim day ("Day 47"), each entry showing actor
  avatar + role + event-type label + content.
- An opinion reader: majority and dissent opinions with citation chips that open a Constitution
  drawer, votes grouped into Majority/Dissent columns with per-justice reasoning.

Every brief in this set (01–06) is an attempt to bring some other page up to this bar: real seat
geometry instead of a table, status-reactive motion instead of a static badge, an editorial read
instead of a data dump.

## How to use these briefs in Claude Design

1. **One screen per session.** Don't try to mock all six redesigns in one Claude Design
   conversation — start a fresh session per brief so the model isn't juggling six different page
   contexts.
2. **Reference the guideline file by name.** These briefs are synced as Claude Design guidelines
   via `.design-sync/config.json`'s `guidelinesGlob`. Each brief ends with a ready-to-paste prompt
   that references its own file by path (e.g. `guidelines/01-broadcast-dashboard.md`) — paste that
   prompt verbatim to start.
3. **Iterate inside the session.** Claude Design will produce a first pass against the design
   system's 21 synced components. Push back in the same session on hierarchy, density, and motion
   — the brief's "What good looks like" checklist is the rubric to hold it to.
4. **Hand winning mocks back for implementation.** Once a mock earns a yes, it goes to a coder
   agent with the brief and the mock screenshot/spec as the implementation reference — the brief's
   "Design-system components to compose" section is the shopping list of what already exists vs.
   what's net-new.

## Priority order

Build and review in this order — the owner has flagged 01 and 02 as the ones that matter most,
since 02's hemicycle is reused across three other pages and 01 is the first thing every visitor
sees:

1. **`01-broadcast-dashboard.md`** — the landing page. Highest traffic, first impression, currently
   the worst offender (stat-tile grid, no spatial grounding, no editorial read).
2. **`02-hemicycle-votes.md`** — not a page, a component. The semicircular vote visualization this
   brief specs gets reused on bill detail, law pages, and the court's 7-justice mini-arc. Build
   this early so 03 and other briefs can assume it exists.
3. `03-bill-journey.md` — bill detail as a subway map, including the new post-enactment judicial
   review branch (a law can now be struck down after the fact).
4. `04-gazette-front-page.md` — press room as a period newspaper front page.
5. `05-election-night.md` — election detail as a war-room broadcast.
6. `06-agent-dossiers.md` — agent profile as a character dossier / trading card.

## Brief structure

Briefs 01–06 all follow the same nine-section structure: Purpose & spectator goal, Current state &
problems, Data available, Layout concept, Design-system components to compose (+ new components to
invent), Motion & liveness, States & edge cases, What good looks like, and a ready-to-paste Prompt
to paste. Every data claim in every brief is sourced from the real schema and API routes as they
exist in this repo at the time of writing — field names, enum values, and endpoint paths are not
illustrative, they're real.
