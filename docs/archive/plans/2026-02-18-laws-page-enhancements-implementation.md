# Laws Page Enhancements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add filtering, sorting, and per-card judicial review status to the existing `/laws` page.

**Architecture:** One backend change enriches `GET /api/laws` with a bulk `judicialReviews` join (single extra query, not N). All filtering and sorting happen client-side in `LawsPage.tsx` — no new API calls needed.

**Tech Stack:** Express + Drizzle ORM (backend), React 18 + Tailwind (frontend), TypeScript throughout.

---

## Task 1: Backend — enrich GET /api/laws with judicial review status

**Files:**
- Modify: `src/server/routes/legislation.ts` (around lines 245–285)

**Context:** `GET /api/laws` already imports `judicialReviews` from `@db/schema/index` and uses `eq, and, desc` from `drizzle-orm`. The endpoint fetches all laws and enriches each with sponsor data via N queries. We need to add a single bulk query for judicial reviews and add two new fields to each item.

### Step 1: Read the file

Read `src/server/routes/legislation.ts` lines 1–10 and 245–285 to understand the current imports and handler shape.

### Step 2: Add `inArray` to the drizzle-orm import

Current import (line 6):
```typescript
import { eq, and, desc } from 'drizzle-orm';
```

Change to:
```typescript
import { eq, and, desc, inArray } from 'drizzle-orm';
```

### Step 3: Add the bulk review lookup

Inside the `GET /api/laws` handler (`router.get('/laws', ...)`), after `rawLaws` is fetched and before the `Promise.all` enrichment loop, add:

```typescript
const lawIds = rawLaws.map((l) => l.id);
const reviewRows = lawIds.length > 0
  ? await db
      .select({
        lawId: judicialReviews.lawId,
        id: judicialReviews.id,
        status: judicialReviews.status,
      })
      .from(judicialReviews)
      .where(inArray(judicialReviews.lawId, lawIds))
  : [];
const reviewMap = new Map(reviewRows.map((r) => [r.lawId, { id: r.id, status: r.status }]));
```

### Step 4: Add review fields to the enriched return object

In the `enriched` Promise.all map callback, at the end of the return object (after `sponsorAlignment`), add:

```typescript
const review = reviewMap.get(law.id) ?? null;
```

And in the returned object:
```typescript
reviewStatus: review?.status ?? null,
reviewId: review?.id ?? null,
```

The full return object should now look like:
```typescript
return {
  ...law,
  committee: bill?.committee ?? null,
  sourceBillId: bill?.id ?? null,
  sponsorId: bill?.sponsorId ?? null,
  sponsorDisplayName: sponsor?.displayName ?? null,
  sponsorAvatarConfig: sponsor?.avatarConfig ?? null,
  sponsorAlignment: sponsor?.alignment ?? null,
  reviewStatus: review?.status ?? null,
  reviewId: review?.id ?? null,
};
```

### Step 5: Type-check

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors.

### Step 6: Commit

```bash
git add src/server/routes/legislation.ts
git commit -m "feat(laws): enrich GET /api/laws with judicial review status"
```

---

## Task 2: Frontend — stats bar + filter/sort + court badge on LawsPage

**Files:**
- Modify: `src/client/pages/LawsPage.tsx`

**Context:** The full current file is at `src/client/pages/LawsPage.tsx`. Read it before editing. It imports `legislationApi`, `PixelAvatar`, and `AvatarConfig`. It renders a card grid. The existing `LawItem` interface needs two new fields. Design tokens and patterns to follow are in CLAUDE.md — use `badge border`, `text-badge`, `uppercase tracking-widest`, button pattern from CourtPage's filter buttons.

### Step 1: Read the file

Read `src/client/pages/LawsPage.tsx` in full.

### Step 2: Rewrite `src/client/pages/LawsPage.tsx` with the full updated implementation

Replace the entire file with the following:

```typescript
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { legislationApi } from '../lib/api';
import { PixelAvatar } from '../components/PixelAvatar';
import type { AvatarConfig } from '../components/PixelAvatar';

interface LawItem {
  id: string;
  title: string;
  enactedDate: string;
  isActive: boolean;
  committee: string | null;
  sourceBillId: string | null;
  sponsorId: string | null;
  sponsorDisplayName: string | null;
  sponsorAvatarConfig: string | null;
  sponsorAlignment: string | null;
  reviewStatus: string | null;
  reviewId: string | null;
}

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const REVIEW_BADGES: Record<string, { label: string; color: string }> = {
  pending:      { label: 'Under Review', color: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30' },
  deliberating: { label: 'Under Review', color: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30' },
  upheld:       { label: 'Upheld',       color: 'text-green-400 bg-green-900/20 border-green-700/30' },
  struck_down:  { label: 'Struck Down',  color: 'text-red-400 bg-red-900/20 border-red-700/30' },
};

type StatusFilter = '' | 'active' | 'repealed';
type CourtFilter  = '' | 'under_review' | 'upheld' | 'struck_down';
type SortKey      = 'newest' | 'oldest' | 'az';

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-badge px-3 py-1.5 rounded border transition-colors uppercase tracking-widest ${
        active
          ? 'border-gold/40 text-gold bg-gold/5'
          : 'border-border/40 text-text-muted hover:text-text-primary hover:border-border'
      }`}
    >
      {children}
    </button>
  );
}

export function LawsPage() {
  const [lawItems, setLawItems] = useState<LawItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [courtFilter, setCourtFilter] = useState<CourtFilter>('');
  const [sort, setSort] = useState<SortKey>('newest');

  useEffect(() => {
    legislationApi.laws()
      .then((res) => {
        if (res.data && Array.isArray(res.data)) {
          setLawItems(res.data as LawItem[]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* Stats (computed from all laws, not filtered view) */
  const stats = useMemo(() => ({
    total:       lawItems.length,
    active:      lawItems.filter((l) => l.isActive).length,
    repealed:    lawItems.filter((l) => !l.isActive).length,
    underReview: lawItems.filter((l) =>
      l.reviewStatus === 'pending' || l.reviewStatus === 'deliberating'
    ).length,
  }), [lawItems]);

  /* Filter + sort */
  const displayed = useMemo(() => {
    let list = [...lawItems];

    if (statusFilter === 'active')   list = list.filter((l) => l.isActive);
    if (statusFilter === 'repealed') list = list.filter((l) => !l.isActive);

    if (courtFilter === 'under_review') {
      list = list.filter((l) => l.reviewStatus === 'pending' || l.reviewStatus === 'deliberating');
    }
    if (courtFilter === 'upheld')      list = list.filter((l) => l.reviewStatus === 'upheld');
    if (courtFilter === 'struck_down') list = list.filter((l) => l.reviewStatus === 'struck_down');

    if (sort === 'newest') list.sort((a, b) => new Date(b.enactedDate).getTime() - new Date(a.enactedDate).getTime());
    if (sort === 'oldest') list.sort((a, b) => new Date(a.enactedDate).getTime() - new Date(b.enactedDate).getTime());
    if (sort === 'az')     list.sort((a, b) => a.title.localeCompare(b.title));

    return list;
  }, [lawItems, statusFilter, courtFilter, sort]);

  return (
    <div className="max-w-screen-2xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-serif text-3xl font-semibold text-stone">Laws of the Land</h1>
        <p className="text-text-muted text-sm">Enacted legislation currently in force.</p>
      </div>

      {/* Stats bar */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Enacted', value: stats.total },
            { label: 'Active',        value: stats.active,      color: 'text-green-400' },
            { label: 'Repealed',      value: stats.repealed,    color: 'text-red-400' },
            { label: 'Under Review',  value: stats.underReview, color: 'text-yellow-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-surface p-4">
              <div className="text-badge text-text-muted uppercase tracking-widest mb-1">{s.label}</div>
              <div className={`font-mono text-2xl font-bold ${s.color ?? 'text-stone'}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      {!loading && lawItems.length > 0 && (
        <div className="flex flex-wrap gap-4 items-center">
          {/* Status filter */}
          <div className="flex gap-1">
            <FilterBtn active={statusFilter === ''} onClick={() => setStatusFilter('')}>All</FilterBtn>
            <FilterBtn active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>Active</FilterBtn>
            <FilterBtn active={statusFilter === 'repealed'} onClick={() => setStatusFilter('repealed')}>Repealed</FilterBtn>
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-border/40 hidden sm:block" />

          {/* Court filter */}
          <div className="flex gap-1">
            <FilterBtn active={courtFilter === ''} onClick={() => setCourtFilter('')}>All Court</FilterBtn>
            <FilterBtn active={courtFilter === 'under_review'} onClick={() => setCourtFilter('under_review')}>Under Review</FilterBtn>
            <FilterBtn active={courtFilter === 'upheld'} onClick={() => setCourtFilter('upheld')}>Upheld</FilterBtn>
            <FilterBtn active={courtFilter === 'struck_down'} onClick={() => setCourtFilter('struck_down')}>Struck Down</FilterBtn>
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-border/40 hidden sm:block" />

          {/* Sort */}
          <div className="flex gap-1">
            <FilterBtn active={sort === 'newest'} onClick={() => setSort('newest')}>Newest</FilterBtn>
            <FilterBtn active={sort === 'oldest'} onClick={() => setSort('oldest')}>Oldest</FilterBtn>
            <FilterBtn active={sort === 'az'} onClick={() => setSort('az')}>A→Z</FilterBtn>
          </div>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <p className="text-text-muted py-16 text-center">Loading...</p>
      ) : displayed.length === 0 ? (
        <p className="text-text-muted py-16 text-center">
          {lawItems.length === 0 ? 'No laws have been enacted yet.' : 'No laws match the current filters.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {displayed.map((law) => {
            const avatarConfig = law.sponsorAvatarConfig
              ? (JSON.parse(law.sponsorAvatarConfig) as AvatarConfig)
              : undefined;
            const alignKey = law.sponsorAlignment?.toLowerCase() ?? '';
            const alignColor = ALIGNMENT_COLORS[alignKey] ?? 'text-text-muted bg-border/10 border-border/30';
            const reviewBadge = law.reviewStatus ? REVIEW_BADGES[law.reviewStatus] ?? null : null;

            return (
              <article
                key={law.id}
                className="rounded-lg border border-border bg-surface p-4 space-y-3 flex flex-col hover:border-gold/30 transition-colors"
              >
                {/* Title */}
                <Link
                  to={`/laws/${law.id}`}
                  className="font-serif text-sm font-semibold text-stone hover:text-gold transition-colors leading-snug line-clamp-3"
                >
                  {law.title}
                </Link>

                {/* Badges row */}
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`badge border text-badge uppercase tracking-widest ${
                      law.isActive
                        ? 'text-green-400 bg-green-900/20 border-green-700/30'
                        : 'text-red-400 bg-red-900/20 border-red-700/30'
                    }`}
                  >
                    {law.isActive ? 'Active' : 'Repealed'}
                  </span>
                  {law.committee && (
                    <span className="badge border border-border/40 text-text-muted bg-border/10">
                      {law.committee}
                    </span>
                  )}
                  {reviewBadge && law.reviewId && (
                    <Link
                      to={`/court/cases/${law.reviewId}`}
                      className={`badge border text-badge uppercase tracking-widest ${reviewBadge.color} hover:opacity-80 transition-opacity`}
                    >
                      {reviewBadge.label}
                    </Link>
                  )}
                </div>

                {/* Enacted date */}
                <p className="text-text-muted text-xs">{fmtDate(law.enactedDate)}</p>

                {/* Sponsor */}
                {law.sponsorDisplayName && law.sponsorId && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                    <PixelAvatar config={avatarConfig} seed={law.sponsorDisplayName} size="xs" />
                    <div className="flex flex-col min-w-0">
                      <Link
                        to={`/agents/${law.sponsorId}`}
                        className="text-gold hover:underline text-xs truncate"
                      >
                        {law.sponsorDisplayName}
                      </Link>
                      {alignKey && (
                        <span className={`badge border text-badge uppercase tracking-widest ${alignColor} mt-0.5 self-start`}>
                          {alignKey}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Source bill link */}
                {law.sourceBillId && (
                  <Link
                    to={`/legislation/${law.sourceBillId}`}
                    className="text-text-muted hover:text-gold transition-colors text-xs mt-auto pt-1"
                  >
                    Source Bill →
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

### Step 3: Type-check

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors.

### Step 4: Commit

```bash
git add src/client/pages/LawsPage.tsx
git commit -m "feat(laws): add stats bar, filter/sort controls, and court status badges"
```

---

## Task 3: Final check + build + PR cycle

**Step 1: Full type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Zero errors required.

**Step 2: Production build**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npm run build
```

**Step 3: Restart PM2 + Vite**

```bash
pm2 restart agora-bench
kill $(lsof -ti :5173) && nohup pnpm run dev:client > /tmp/vite.log 2>&1 &
sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
```

Expected: `200`

**Step 4: Rebase + push**

```bash
git fetch origin dev
git rebase origin/dev
git push -u origin feature/laws-page-enhancements
```

**Step 5: PR feature → dev**

```bash
cat > /tmp/pr_laws.json <<'EOF'
{
  "title": "feat(laws): filter/sort + court status badges on Laws page",
  "body": "## Summary\n- Stats bar: Total Enacted / Active / Repealed / Under Review\n- Client-side filters: status (All/Active/Repealed) + court status (All/Under Review/Upheld/Struck Down)\n- Sort: Newest / Oldest / A→Z\n- Per-card court review badge linking to `/court/cases/:id`\n- Backend: `GET /api/laws` enriched with `reviewStatus` + `reviewId` via bulk `judicialReviews` join\n\n## Test plan\n- [ ] Stats bar shows correct counts\n- [ ] Status filter narrows cards correctly\n- [ ] Court filter shows only laws with matching review status\n- [ ] Sort buttons reorder the grid\n- [ ] Laws under review show yellow badge linking to the court case\n- [ ] Upheld/struck down laws show matching badge\n- [ ] Laws with no review show no court badge\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  "head": "feature/laws-page-enhancements",
  "base": "dev"
}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr_laws.json | python3 -m json.tool | grep '"number"'
```

**Step 6: Merge feature → dev**

```bash
# Replace PR_NUM with number from step 5
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/PR_NUM/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d '{"Do":"merge","merge_message_field":"Merge feat(laws): filter/sort + court status badges"}'
```

**Step 7: PR dev → main + merge**

```bash
cat > /tmp/pr_laws_main.json <<'EOF'
{
  "title": "chore: sync dev → main (laws page enhancements)",
  "body": "Syncing dev into main after laws page enhancements merge.",
  "head": "dev",
  "base": "main"
}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr_laws_main.json | python3 -m json.tool | grep '"number"'
# Then merge with the returned PR number
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/PR_NUM/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d '{"Do":"merge","merge_message_field":"Merge chore: sync dev → main (laws page enhancements)"}'
```

**Step 8: Rebuild production**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npm run build && pm2 restart agora-bench
kill $(lsof -ti :5173) && nohup pnpm run dev:client > /tmp/vite.log 2>&1 &
```
