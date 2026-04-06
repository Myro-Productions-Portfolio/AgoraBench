# Nav Redesign + Wiki Drawer — Design Spec

**Date:** 2026-04-05
**Status:** Approved

---

## Overview

Two related changes to the main layout:

1. **Right-side nav consolidation** — collapse the flat Benchmark / Researcher / Admin / Profile links into a single dropdown card to reclaim horizontal space and handle narrow viewports cleanly.
2. **Wiki drawer** — replace the `?` keyboard shortcuts button with a wiki trigger that opens a 35vw right-side drawer with a file-tree index and full scrollable articles.

---

## Part 1 — Right Nav Dropdown

### Problem

The right side of the nav bar has 5–6 flat links (Search, ?, Benchmark, Researcher, Admin, Profile, UserButton). Below ~1100px they wrap or overflow.

### Solution

Replace Benchmark, Researcher, Admin, and Profile with a single **"Tools & Profile"** dropdown trigger. On hover/click, a card drops down using the identical pattern as the existing left nav menus (same background gradient, border, shadow, item structure).

### Dropdown card contents

| Icon | Label | Description | Visibility |
|------|-------|-------------|------------|
| ⚡ | Benchmark | Run agent performance tests | researcher + owner |
| 🔬 | Researcher | Deep analysis & data tools | researcher + owner |
| ⚙️ | Admin | Simulation controls & config | owner only |
| — | *(divider)* | | |
| 👤 | Profile | Your settings & preferences | signed in |

Items respect the same role-gating as the current flat links (`userRole === 'researcher'`, `userRole === 'owner'`). Items the user cannot access are not rendered (not grayed out).

### Wiki icon

Replaces the `?` button. Uses a lines/document SVG icon. Same sizing and border style as the current `?` button. Gold border tint to distinguish it as a primary action.

Keyboard shortcut `?` is removed or reassigned — keyboard shortcuts modal is now accessible via the dropdown or a `?` key binding that opens the wiki instead. (To be decided at implementation — see open question below.)

### Right nav item order (after change)

```
[dot] Online  |  [Search ⌘K]  |  [wiki icon]  |  [Tools & Profile ▾]  |  [Avatar]
```

### Open question

Should `?` still open a keyboard shortcuts modal, or does it now open the wiki? Recommend: `?` opens the wiki, keyboard shortcuts are listed as a wiki article under Reference.

---

## Part 2 — Wiki Drawer

### Trigger & layout

- Triggered by the wiki icon in the nav
- Slides in from the right — `35vw` wide, full height below the nav (top: 64px, bottom: 0)
- Semi-transparent backdrop covers the rest of the page (no content reflow)
- Closed by clicking ✕, clicking the backdrop, or pressing Escape

### Drawer structure

```
┌─────────────────────────────────────────────────┐
│  WIKI   / Simulation / Agents & Alignment  [A−][13px][A+]  [✕] │  ← header (52px)
├──────────────┬──────────────────────────────────┤
│  file tree   │  article pane                    │
│  (200px)     │  (flex: 1, scrollable)            │
│              │                                  │
│  [search]    │  eyebrow                         │
│              │  Title                           │
│  Getting     │  Subtitle                        │
│  Started     │                                  │
│  ▶ Simulation│  body text...                    │
│    ▸ Agents  │                                  │
│    ▸ ...     │  [← Prev]           [Next →]     │
└──────────────┴──────────────────────────────────┘
```

### File tree

- Left column, 200px wide, dark background (`#1e2124`)
- Search input at top — filters visible tree items in real time (client-side, no server call)
- Section headers (non-clickable labels): Getting Started, Simulation, Configuration, Orchestration, Reference
- **Folders** — collapsible, chevron rotates on open/close, click to toggle
- **Leaves** — click to navigate to that article; active leaf highlighted gold with left border accent
- Scroll tracking — as user scrolls the article pane, the active leaf updates to reflect the current visible section heading

### Article pane

- Scrollable, padding 24px/28px
- Structure per article: eyebrow (section path), title (22px), subtitle (13px), body
- Body uses `<h3>` section headings with `id` anchors — these are the scroll-tracked targets
- Code blocks styled with dark background, monospace font
- Prev/Next article navigation at the bottom

### Font scaling

- Default: **15px** body text
- Range: 13px → 14px → **15px** → 16px → 17px (5 steps)
- A− and A+ buttons in the drawer header, grayed out at limits
- Label shows current size (e.g. "15px")
- Preference persisted in `localStorage` under key `wiki-font-size`
- All wiki text scales proportionally (tree items, article body, code blocks, nav buttons)
- Drawer header text (title, breadcrumb) does not scale — fixed at 16px/16px

### Content sources

Wiki content is sourced from existing markdown files in `docs/` plus new wiki-specific pages:

| Tree section | Source |
|---|---|
| Getting Started / Overview | new |
| Getting Started / Key Concepts | new |
| Simulation / Agents | new (based on codebase) |
| Simulation / Legislature | new |
| Simulation / Elections | new |
| Simulation / Economy | new |
| Configuration / Runtime Config | derived from `docs/AGORABENCH.md` |
| Configuration / Weight Engines | derived from `docs/DYNAMIC_WEIGHT_ENGINE.md` |
| Orchestration / AGGE & Bob | derived from `docs/AGORABENCH.md` |
| Reference / Keyboard Shortcuts | migrated from KeyboardShortcutsModal |
| Reference / DB Schema | derived from `CLAUDE.md` schema section |
| Reference / Changelog | new |

Markdown files are parsed at build time (or server-side) into a structured content tree. No runtime markdown fetching — content is bundled.

### Full-text search

- Search input in the tree filters **tree items** (leaf labels) in real time
- A second search mode (triggered by focusing the input and typing) searches **across all article content** and shows matching results as a flat list replacing the tree
- No inference required — pure string matching against pre-indexed content
- Results show: article title + matched excerpt

### No chatbot

Explicitly out of scope. The DGX Spark is saturated with simulation agents. The Linux box runs the production server and DB. No local inference for the wiki.

---

## Files to create / modify

**New files:**
- `src/core/client/components/WikiDrawer.tsx` — drawer shell, tree, article pane
- `src/core/client/components/WikiTree.tsx` — file tree with search + scroll tracking
- `src/core/client/components/WikiArticle.tsx` — article renderer
- `src/core/client/lib/wikiContent.ts` — parsed content tree + search index
- `src/core/client/lib/wikiPrefs.ts` — localStorage font size preference
- `docs/wiki/` — markdown source files for wiki articles

**Modified files:**
- `src/core/client/components/Layout.tsx` — add WikiDrawer, replace `?` button with wiki icon, replace flat right-nav links with Tools & Profile dropdown

---

## Out of scope

- Chatbot / AI assistant
- Wiki editing UI (read-only)
- User annotations or bookmarks
- Server-side search API
- Pagination (long scroll is the pattern)
