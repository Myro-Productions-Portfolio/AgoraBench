# design-sync NOTES — AgoraBench

Repo-specific gotchas for the claude.ai/design sync. One bullet per item; append as learned.

## Build / converter

- **App, not a library.** `agora-bench` has no `main`/`module`/`exports`. The bundle entry is the
  hand-written barrel `.design-sync/ds-entry.ts` (cfg.entry) re-exporting the 21 curated components.
  Keep it in lockstep with `cfg.componentSrcMap`. Do NOT point cfg.entry at `src/core/client/main.tsx` —
  that bundles the whole app bootstrap (Clerk import throws `Missing VITE_CLERK_PUBLISHABLE_KEY` in
  every preview and nothing is exported).
- **Compiled CSS**: `cfg.cssEntry` = `.design-sync/app-compiled.css`, which is
  `dist/client/assets/index-<hash>.css` (from `pnpm run build`) with one line prepended:
  the Google Fonts `@import url(...)` for Playfair Display / Inter / JetBrains Mono (same URL as
  `index.html`). **Re-copy step on every re-sync where styles changed**: run `pnpm run build`, then
  `printf '<the @import line>\n' > .design-sync/app-compiled.css && cat dist/client/assets/index-*.css >> .design-sync/app-compiled.css`.
  The @import gives `[FONT_REMOTE]` (fonts load at runtime in cards and in claude.ai/design).
- **Tailwind purge**: the compiled CSS only contains classes the APP uses. Preview `.tsx` files must
  stick to utility classes/patterns the app already uses (or the `@layer components` classes
  `.btn-gold`, `.btn-secondary`, `.card`, `.badge-*`, `.hero-grid-overlay`). A class the app never
  emits will silently not exist.
- **source-kit.mjs fork** (`.design-sync/overrides/source-kit.mjs`, declared in cfg.libOverrides):
  extends GENERIC_DIR with this repo's structural dir names (client/map/icons/core/modules + module
  names) so every component's dir-derived group collapses to `general` and the docsMap **category
  stubs** in `.design-sync/groups/*.md` set the curated groups (primitives/cards/data-display/
  overlays/capitol-map). The fork needs the gitignored symlink
  `ln -sfn ../.ds-sync/node_modules .design-sync/node_modules` (recreate on fresh clone).
- **docsMap enumerates all 21 components** deliberately — no real per-component docs exist; every
  entry is a frontmatter-only regroup stub (the skill's regroup mechanism). Prompt bodies are
  synthesized from `.d.ts` + previews.
- `guidelinesGlob: []` — the default glob swept backend/dev docs (`docs/TODO.md`,
  `docs/BEST_PRACTICES.md`, …) into `guidelines/`; those are not design guidelines.
- **Playwright**: repo has no playwright dep; `.ds-sync` installs its own (chromium build must match
  `~/.cache/ms-playwright` — 1228 installed for playwright 1.61).

## Previews

- `cfg.provider` = `PreviewShell` (`.design-sync/preview-shell.tsx`, shipped via cfg.extraEntries):
  MemoryRouter (CampaignCard/BillCard render react-router `<Link>`) + AnimatePresence (map
  components) + a `bg-capitol-deep text-text-primary font-sans antialiased p-4` div replicating the
  app's `<body>` chrome — the palette is dark-first; without it cards render on white.
- Scroll-pane components (WikiArticle: `flex-1 overflow-y-auto`) need an explicit fixed-height flex
  wrapper in the preview or they collapse.
- Realistic sim content sources: agent names from `src/core/db/seed.ts` (vera-okonkwo, dax-nguyen,
  sam-ritter, leila-farsi, garrett-voss, nora-callahan, finn-kalani, zara-moss, arjun-mehta,
  sable-chen); parties (Progressive Alliance, Moderate Coalition, Constitutional Order Party,
  Liberty First Party, Technocratic Union); bill numbers `MG-###`; currency `M$`;
  statuses proposed/committee/floor/passed/failed/vetoed/tabled/presidential_veto/law.
- Overlay components (KeyboardShortcutsModal, EventDetailModal, AgentDrawer) are `position:fixed` —
  `cfg.overrides` gives them `cardMode: "single"`, `viewport: "900x640"`.

## Fan-out wave learnings (folded 2026-07-03)

- **Capture viewport is 900x700 with ~860px usable width** (body 24px x2 + PreviewShell p-4).
  Composition wrappers in previews must stay ≤ ~840px — use `maxWidth`, not fixed `width`
  (fixed 920/1100px wrappers produced scrollbar strips / clipped right columns).
- **[GENERAL] `position: fixed` overlays** (KeyboardShortcutsModal, EventDetailModal, AgentDrawer):
  the harness story roots carry `transform: translateZ(0)`, making them the containing block for
  `fixed` — `inset-0` covers only the in-flow content box. Preview-level fix (intended harness
  design): wrap overlay exports in an in-flow full-height stage,
  `<div style={{ height: 'calc(100vh - 80px)' }}>`. No config change needed beyond
  cardMode single + viewport 900x640 (already set).
- **[GENERAL] framer-motion WAAPI + frozen capture clock**: `page.clock.setFixedTime` freezes
  `document.timeline`, so WAAPI-accelerated opacity tweens (`initial={{ opacity: 0 }}`) capture
  stuck at opacity 0 (SpeechBubble was invisible; AgentDrawer backdrop dim frozen — cosmetic).
  Committed fix lives in `.design-sync/previews/SpeechBubble.tsx`: module-scope
  `delete Element.prototype.animate` forces framer-motion's JS driver (renders identically).
  Apply the same one-liner to any future preview whose motion component fades in from opacity 0.
- **BranchCard hardcodes `<img src="/images/branches/*.webp">`** (app `public/` assets, absolute
  paths). Bundle/designs can't serve them → the preview swaps srcs to data-URI copies
  (`.design-sync/previews/branchIcons.ts`, generated from `public/images/branches/*.webp` —
  regenerate if the webps change). Real designs built in claude.ai/design will show broken icon
  chips unless the design serves those paths — noted in conventions.md. Candidate product fix:
  accept an icon prop or import the assets. Also: `judicial.webp` is low-contrast slate-on-
  transparent with alpha compression noise — reads as a gray square at 28px in the app too
  (asset fix candidate).
- **SpeechBubble app quirk**: anchored to the app's 40px AgentSeat wrapper, CSS shrink-to-fit
  collapses it to a ~84px one-word-per-line column, defeating its `max-w-[180px]` design.
  Previews anchor at 360px so the intended wrap shows. Candidate product fix (seat anchor width).
- **BuildingPulseRing** is a one-shot 1.4s pulse — previews re-key `pulse.triggeredAt` on a 400ms
  interval (mirrors the app's re-pulse-per-event), so the ring is always mid-animation.
- **LiveTicker cannot render injected items** (internal `/api/activity` fetch + WS only, no data
  prop). Its single cell shows the component's own designed no-data fallback marquee; the
  minimized gold-tab state is unreachable via props. Honest limitation, recorded in its grade note.
- **ElectionBanner countdown ticks from wall clock** even with fixed targetDate (recomputes from
  `new Date()`): captures visually stable (large day count, far-future 2031 target) but not
  byte-deterministic in SEC/MIN tiles — expect capture-hash churn on re-syncs, grades unaffected.
- **CapitolIcon SVG strokes are hardcoded hex** (#C9B99B/#B8956A) — `text-*` classes don't recolor
  it; only size classes (w-5…w-16) matter.
- **EventDetailModal `locationBuildingId`** renders capitalize+dash-to-space — use real building
  ids from `src/core/client/lib/buildings.ts` (capitol, executive, supreme-court, treasury,
  party-hall, archives, election-center).
- **LegislationCarousel** grid is viewport-breakpoint driven (md:2/xl:3) — capture viewport always
  gets 2 columns; 7+ bills triggers dots/arrows. **BillPipeline** wraps terminal buttons to a
  second row ≤840px — real app behavior (flex-wrap), not a defect.
- **PixelAvatar**: `seed` sweep over the 10 canonical agent names yields visibly distinct avatars.

## Known render warns

- `[RENDER_THIN] variants render identically` may fire on LiveTicker (single fallback-marquee
  cell — one look by design). Triaged legitimate.
- ElectionBanner SEC/MIN tiles differ between captures (wall-clock countdown) — cosmetic
  nondeterminism, see wave learnings.

## Re-sync risks

- **`.design-sync/app-compiled.css` goes stale silently** when Tailwind theme/global CSS or app
  markup changes — re-run `pnpm run build` and re-copy (with the font @import line prepended,
  see Build section) before any re-sync that follows styling changes.
- **`.design-sync/previews/branchIcons.ts` duplicates `public/images/branches/*.webp`** — if the
  app swaps those assets, regenerate the data-URI module (base64 of each file).
- **`.design-sync/ds-entry.ts` + `componentSrcMap` are a hand-maintained pair** — adding/removing
  curated components requires editing both (plus a `.design-sync/groups/<Name>.md` category stub
  and a docsMap entry).
- **source-kit.mjs fork** must be diffed against the bundled `lib/source-kit.mjs` on re-sync and
  its GENERIC_DIR extension re-applied if upstream changed; fresh clones need
  `ln -sfn ../.ds-sync/node_modules .design-sync/node_modules`.
- **Owned previews are tied to component APIs**: BranchCard (IconFix wrapper), SpeechBubble
  (WAAPI disable + 360px anchor), AgentDrawer/EventDetailModal/KeyboardShortcutsModal (100vh
  stage divs), BuildingPulseRing (re-key interval) — prop/API changes upstream require manual
  preview updates; grades re-key automatically via source hashes.
- **Build assumptions**: node 22 / pnpm 9, playwright 1.61 + chromium build 1228 in
  ~/.cache/ms-playwright, Google Fonts reachable at capture time ([FONT_REMOTE]).
- Verified partially: LiveTicker only in fallback state (no API); modals only in open state.
