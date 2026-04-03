# 16 — Search & Discovery

## Status: Planned | Priority: High

---

## Problem Statement

As the simulation runs and accumulates data — hundreds of agents, bills, parties, elections, activity events — users have no way to find specific things. Scrolling and pagination are not sufficient. Search is a critical missing feature.

---

## 1. Global Search (Cmd+K Modal)

A command-palette style search accessible from anywhere in the app.

### Trigger
- Keyboard: `Cmd+K` (Mac) / `Ctrl+K` (Windows)
- Click: Search icon in the nav bar (top right, before the auth button)

### Behavior
- Modal overlay with backdrop blur
- Auto-focus input on open
- `Escape` to close
- Results appear as you type (debounced 250ms, min 2 chars)
- Keyboard navigate results with arrow keys, `Enter` to select
- Categories grouped: Agents, Legislation, Parties, Elections

### New component: `src/client/components/GlobalSearch.tsx`

```tsx
interface SearchResult {
  type: 'agent' | 'bill' | 'party' | 'election';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}
```

### API endpoint: `GET /api/search`

```
GET /api/search?q=reform&types=agent,bill,party,election&limit=5
```

Response:
```json
{
  "success": true,
  "data": {
    "agents": [...],
    "bills": [...],
    "parties": [...],
    "elections": [...]
  }
}
```

Server-side: runs parallel queries with `ilike` on relevant text fields:
- Agents: `displayName`, `name`, `bio`, `alignment`
- Bills: `title`, `summary`, `fullText`
- Parties: `name`, `abbreviation`, `description`, `platform`
- Elections: `positionType`

New route file: `src/server/routes/search.ts`

---

## 2. Per-Page Search

### LegislationPage
- Search bar above the bill list/grid
- Filters: status (all/proposed/committee/floor/passed/law/vetoed), committee, sponsor
- Client-side filter on loaded data (fast), server-side fallback for large datasets
- Debounced input, results update instantly

### PartiesPage
- Search by party name, alignment, description
- Filter by alignment: progressive / conservative / moderate / technocrat / libertarian

### ElectionsPage
- Filter by status: upcoming / active / closed / certified
- Filter by position type: president / senator / representative / judge

### AgentProfilePage (activity tab)
- Filter agent's activity by type: vote, bill, campaign, party

---

## 3. Activity Feed Search (Dashboard + Activity pages)

Search within the visible activity feed:
- Input above the feed: "Filter activity..."
- Client-side match on `title + description`
- Type filter chips: All | Votes | Bills | Campaigns | Parties | Elections

---

## 4. Implementation Plan

### Phase A — Global Search (highest value)
1. `src/server/routes/search.ts` — parallel ilike queries
2. `src/server/routes/index.ts` — register search route
3. `src/client/components/GlobalSearch.tsx` — modal UI
4. `src/client/components/Layout.tsx` — add Cmd+K listener + search icon

### Phase B — Page-level filters
1. `LegislationPage.tsx` — search + status/committee filters
2. `PartiesPage.tsx` — search + alignment filter
3. `ElectionsPage.tsx` — status + position filters

### Phase C — Activity filter
1. Dashboard `ActivityFeed` — type chip filters + text search

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/server/routes/search.ts` | **New** — global search endpoint |
| `src/server/routes/index.ts` | Register search route |
| `src/client/components/GlobalSearch.tsx` | **New** — Cmd+K modal |
| `src/client/components/Layout.tsx` | Add Cmd+K listener, search icon trigger |
| `src/client/lib/api.ts` | Add `searchApi.global(q, types)` |
| `src/client/pages/LegislationPage.tsx` | Add search + filters |
| `src/client/pages/PartiesPage.tsx` | Add search + filters |
| `src/client/pages/ElectionsPage.tsx` | Add status + position filters |

---

## Acceptance Criteria

- [ ] Cmd+K opens search modal from any page
- [ ] Results appear within 300ms of typing (250ms debounce + fast query)
- [ ] Grouped results: Agents / Bills / Parties / Elections, max 5 per group
- [ ] Clicking a result navigates to the correct page and closes modal
- [ ] Legislation page has working text search + status filter
- [ ] `Escape` always closes the modal
- [ ] No flicker or layout shift when results load
