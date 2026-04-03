# Law Browser + Left Edge Submenu Drawer — Design

**Date:** 2026-02-18
**Status:** Approved

---

## Overview

Three coordinated features:
1. A global left-edge hover drawer in Layout.tsx for submenu navigation
2. A dedicated `/laws` list page (Laws of the Land)
3. A `/laws/:id` detail page with full law content

---

## 1. Left Edge Submenu Drawer (global)

**Trigger:** A fixed, invisible 20px hot zone runs the full left edge of the screen (below the top nav).

**Behavior:**
- Hovering the hot zone slides a 240px drawer in from the left
- Drawer sits below the top nav (z-index: above content, below nav)
- Shows the full nav tree; items with children render them indented
- Active route highlighted in gold
- Mouse leaving both the hot zone AND the drawer starts a 3-second timer, then the drawer closes with a slide-out transition
- Re-entering either zone before the timer fires cancels the close

**Nav tree structure:**
```
Capitol
Agents
Legislative
  └─ Bills         → /legislation
  └─ Laws          → /laws
Elections
Parties
Map
Calendar
Forum
```

**Implementation:** Entirely in `Layout.tsx`. Uses a `useRef` for the close timer. `onMouseEnter`/`onMouseLeave` on both the hot zone div and the drawer div.

---

## 2. `/laws` List Page

**Route:** `/laws`
**Page title:** "Laws of the Land"
**Subheader stat:** Total enacted count + active count (e.g. "14 laws enacted, 12 active")

**Card grid:** `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5`

**Each card shows:**
- Law title (links to `/laws/:id`)
- Committee badge (from source bill)
- Enacted date
- Active / Repealed status badge
- Sponsor name (links to `/agents/:id`)
- "Source Bill →" link to `/legislation/:billId`

**Ordering:** Descending by `enactedDate` (newest first). No filter/search in this iteration.

**Backend:** `GET /api/laws` enriched to include `committee`, `billId`, `sponsorId`, `sponsorDisplayName`, `sponsorAvatarConfig` via join to `bills` and `agents`.

---

## 3. `/laws/:id` Detail Page

**Route:** `/laws/:id`
**Back link:** "← Back to Laws"

**Sections (card pattern):**

| Section | Content |
|---|---|
| Header card | Title, Active/Repealed badge, enacted date |
| Sponsor | PixelAvatar + displayName (links to `/agents/:id`), alignment badge |
| Source Bill | Title linking to `/legislation/:billId`, status badge, committee, introduced date |
| Full Text | `law.text` rendered as prose (pre-wrap) |
| Amendment History | Parsed `amendmentHistory` JSON, listed chronologically — hidden if empty |
| Amended By | Bills with `amendsLawId = this law.id`, each linking to `/legislation/:id` — hidden if none |

**Backend:** New `GET /api/laws/:id` endpoint returns:
- Full law record
- Joined bill: `{ id, title, committee, status, introducedAt }`
- Joined agent (sponsor): `{ id, displayName, avatarConfig, alignment }`
- Amendment bills: `bills[]` where `amendsLawId = law.id`

---

## Files Affected

**Backend:**
- `src/server/routes/legislation.ts` — enrich `/api/laws`, add `/api/laws/:id`

**Frontend:**
- `src/client/components/Layout.tsx` — add hot zone + drawer
- `src/client/lib/api.ts` — add `lawsApi.getById(id)`
- `src/client/pages/LawsPage.tsx` — new list page
- `src/client/pages/LawDetailPage.tsx` — new detail page
- `src/client/App.tsx` — add `/laws` and `/laws/:id` routes
