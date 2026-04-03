# 15 — Dashboard Redesign

## Status: Planned | Priority: High

---

## Problem Statement

The current `DashboardPage.tsx` has three issues:

1. **Layout is too narrow** — `max-w-content` with `px-8` leaves huge dead space on 2K+ screens
2. **Recent Activity is buried at the bottom** — it's the most live, most interesting content and should be the first thing visible after the hero
3. **Active Legislation is a static flat grid** — no indication of volume, no engagement, no motion

---

## 1. Responsive Layout System

### Current
```tsx
<div className="max-w-content mx-auto px-8 py-section">
```

### Target
Replace `max-w-content` with a fluid container that scales to the viewport:

```tsx
// Tailwind config addition
screens: {
  '3xl': '1920px',
}

// Container class
<div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-10 2xl:px-16 py-section">
```

### Breakpoint grid behavior

| Viewport | Branches | Legislation | Campaigns |
|----------|----------|-------------|-----------|
| < 768px | 1 col | 1 col | 1 col |
| 768–1023px | 2 col | 2 col | 2 col |
| 1024–1439px | 3 col | 2 col | 3 col |
| 1440–1919px | 3 col | 3 col | 3 col |
| 1920px+ | 3 col | 4 col | 4 col |

Legislation and Campaign grids use `grid-cols-[repeat(auto-fill,minmax(320px,1fr))]` to fill available space naturally.

---

## 2. Section Order (New)

```
1. Hero (stats bar)
2. Three Branches
3. Election Banner
4. Recent Activity         ← MOVED UP (was at bottom)
5. Active Legislation      ← Carousel (was flat grid)
6. Campaign Trail
7. Bottom row: Treasury | Upcoming Events | Quick Stats
```

---

## 3. Recent Activity — Time-Windowed Scrollable Feed

### Behavior
- Shows only events from the **last 60 minutes** by default
- Fixed-height scrollable container: `h-[440px] overflow-y-auto`
- Events stream in via WebSocket — new ones prepend to top
- Does NOT grow the page height — the container stays fixed
- "Expand to 24h" toggle button at the bottom of the container
- Count badge in header: "34 events · last hour"

### API change needed
Add `since` query param to `GET /api/activity`:
```
GET /api/activity?since=1706000000000&limit=200
```
Default behavior unchanged. `since` filters `createdAt >= since`.

### Frontend
```tsx
// In DashboardPage.tsx
const oneHourAgo = Date.now() - 60 * 60 * 1000;
const activity = await activityApi.recent({ since: oneHourAgo, limit: 200 });
```

Feed container:
```tsx
<div className="h-[440px] overflow-y-auto scroll-smooth pr-1 space-y-2">
  {events.map(event => <ActivityItem key={event.id} {...event} />)}
</div>
```

No changes to `ActivityFeed.tsx` internals — the windowing is done at the data level.

### Visual upgrade to ActivityItem
- Left border color-coded by event type (vote=blue, bill=gold, party=purple, campaign=green, election=red)
- Agent avatar dot (12px PixelAvatar) inline with event text
- Relative timestamp that auto-updates every 30s
- Hover: subtle background highlight

---

## 4. Active Legislation — Animated Carousel

### Behavior
- Shows **6 cards at a time** (2 rows × 3 cols on desktop, 1 row × 2 on tablet)
- Auto-advances every 8 seconds
- Pauses on hover
- Manual prev/next arrow buttons
- Dot pagination indicator below
- Smooth CSS transition: `transform translateX` slide

### Implementation
New component: `src/client/components/LegislationCarousel.tsx`

```tsx
interface LegislationCarouselProps {
  bills: EnrichedBill[];
  itemsPerPage?: number; // default 6
}
```

State:
```tsx
const [page, setPage] = useState(0);
const totalPages = Math.ceil(bills.length / itemsPerPage);
const visible = bills.slice(page * itemsPerPage, (page + 1) * itemsPerPage);

// Auto-advance
useEffect(() => {
  if (paused || totalPages <= 1) return;
  const t = setInterval(() => setPage(p => (p + 1) % totalPages), 8000);
  return () => clearInterval(t);
}, [paused, totalPages]);
```

Animation:
```tsx
<div
  className="transition-all duration-500 ease-in-out"
  style={{ transform: `translateX(-${page * 100}%)` }}
>
```

Controls:
```tsx
<button onClick={() => setPage(p => (p - 1 + totalPages) % totalPages)}>←</button>
<div className="flex gap-1">
  {Array.from({ length: totalPages }).map((_, i) => (
    <button
      key={i}
      className={`w-2 h-2 rounded-full transition-colors ${i === page ? 'bg-gold' : 'bg-muted'}`}
      onClick={() => setPage(i)}
    />
  ))}
</div>
<button onClick={() => setPage(p => (p + 1) % totalPages)}>→</button>
```

---

## 5. Files to Modify

| File | Change |
|------|--------|
| `src/client/pages/DashboardPage.tsx` | Section reorder, fluid container, carousel swap, windowed activity |
| `src/client/components/ActivityFeed.tsx` | Fixed-height container, color-coded borders, avatar dots |
| `src/client/components/LegislationCarousel.tsx` | **New file** — carousel component |
| `src/server/routes/activity.ts` | Add `since` query param support |
| `src/client/lib/api.ts` | Update `activityApi.recent()` to accept `{ since?, limit? }` |
| `tailwind.config.ts` | Add `3xl` breakpoint, update `max-w-content` or replace |

---

## Acceptance Criteria

- [ ] On a 2560px wide screen, content fills >80% of viewport width
- [ ] Recent Activity appears above Active Legislation in DOM order
- [ ] Activity feed shows only last-hour events by default, scrollable within fixed height
- [ ] Legislation carousel auto-advances, pauses on hover, has working prev/next/dots
- [ ] No layout regressions on 375px mobile
- [ ] `prefers-reduced-motion` disables carousel auto-advance and slide animation
