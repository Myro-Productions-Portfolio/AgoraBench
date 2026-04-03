# Laws Page Enhancements — Design

**Date:** 2026-02-18
**Status:** Approved

---

## Overview

Enhance the existing `/laws` page with client-side filtering, sorting, and per-card court review status badges. One backend change to enrich the laws list response with judicial review data.

---

## Backend

### `GET /api/laws` enrichment

Add a bulk judicial review lookup to the existing laws list endpoint (`src/server/routes/legislation.ts`).

After fetching all laws, query `judicialReviews` once for all matching `lawId`s. Build a map `lawId → review`. Add two new fields to each law item:

- `reviewStatus: 'pending' | 'deliberating' | 'upheld' | 'struck_down' | null`
- `reviewId: string | null`

Use `inArray(judicialReviews.lawId, lawIds)` for a single bulk query rather than N queries.

---

## Frontend (`src/client/pages/LawsPage.tsx`)

### Stats bar

Four stat tiles above the controls:
- **Total** — all enacted laws
- **Active** — `isActive === true`
- **Repealed** — `isActive === false`
- **Under Review** — `reviewStatus === 'pending' || reviewStatus === 'deliberating'`

### Filter controls

Two independent filter rows, both applied client-side:

**Status filter** (button group): All | Active | Repealed

**Court filter** (button group): All | Under Review | Upheld | Struck Down

**Sort** (button group): Newest | Oldest | A→Z

All three are independent — they compose (AND logic). Defaults: All / All / Newest.

### Court status badge on cards

When `reviewStatus` is non-null, show a colored badge on the card below the Active/Repealed badge:

| `reviewStatus` | Badge label | Color |
|---|---|---|
| `pending` | Under Review | yellow |
| `deliberating` | Under Review | yellow |
| `upheld` | Upheld | green (distinct from Active) |
| `struck_down` | Struck Down | red (distinct from Repealed) |

Badge is a `<Link to={/court/cases/:reviewId}>` so clicking navigates to the case.

---

## Files to Touch

- `src/server/routes/legislation.ts` — add bulk `judicialReviews` join to `GET /api/laws`
- `src/client/pages/LawsPage.tsx` — add stats bar, filter/sort controls, court badge on cards
