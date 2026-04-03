# Law Browser + Left Edge Submenu Drawer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/laws` list page, `/laws/:id` detail page, and a left-edge hover drawer for submenu navigation — starting from the `feature/law-browser-submenu-drawer` branch.

**Architecture:** Backend enriches `/api/laws` with joined bill+sponsor data and adds a new `/api/laws/:id` endpoint. Frontend adds two new pages and wires a fixed-position hover zone + slide-out drawer into the existing Layout component.

**Tech Stack:** Express + Drizzle ORM (backend), React 18 + React Router + Tailwind CSS (frontend), TypeScript throughout.

---

## Task 1: Enrich GET /api/laws

**Files:**
- Modify: `src/server/routes/legislation.ts:246-257`

Currently returns raw law rows. Replace with a version that joins `bills` (for `committee`, `billId`) and `agents` (for `sponsorDisplayName`, `sponsorAvatarConfig`, `sponsorAlignment`).

**Step 1: Replace the /api/laws handler**

Open `src/server/routes/legislation.ts`. Find the `GET /api/laws` handler at line ~246 and replace the entire route with:

```typescript
/* GET /api/laws -- List all enacted laws (enriched) */
router.get('/laws', async (_req, res, next) => {
  try {
    const rawLaws = await db
      .select()
      .from(laws)
      .orderBy(desc(laws.enactedDate));

    const enriched = await Promise.all(
      rawLaws.map(async (law) => {
        const [bill] = await db
          .select({ id: bills.id, committee: bills.committee, sponsorId: bills.sponsorId, introducedAt: bills.introducedAt })
          .from(bills)
          .where(eq(bills.id, law.billId))
          .limit(1);

        const [sponsor] = bill
          ? await db
              .select({ displayName: agents.displayName, avatarConfig: agents.avatarConfig, alignment: agents.alignment })
              .from(agents)
              .where(eq(agents.id, bill.sponsorId))
              .limit(1)
          : [null];

        return {
          ...law,
          committee: bill?.committee ?? null,
          sourceBillId: bill?.id ?? null,
          sponsorId: bill?.sponsorId ?? null,
          sponsorDisplayName: sponsor?.displayName ?? null,
          sponsorAvatarConfig: sponsor?.avatarConfig ?? null,
          sponsorAlignment: sponsor?.alignment ?? null,
        };
      }),
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
});
```

**Step 2: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment
npx tsc --noEmit
```

Expected: zero errors (or only pre-existing unrelated errors).

**Step 3: Commit**

```bash
git add src/server/routes/legislation.ts
git commit -m "feat(laws): enrich GET /api/laws with bill + sponsor join"
```

---

## Task 2: Add GET /api/laws/:id

**Files:**
- Modify: `src/server/routes/legislation.ts` — add new route after `/api/laws`

**Step 1: Add the /api/laws/:id handler**

Insert this route immediately after the `/api/laws` handler (before the `/api/legislation/:id/judicial-reviews` handler):

```typescript
/* GET /api/laws/:id -- Get a single law with full enrichment */
router.get('/laws/:id', async (req, res, next) => {
  try {
    const [law] = await db
      .select()
      .from(laws)
      .where(eq(laws.id, req.params.id))
      .limit(1);

    if (!law) {
      throw new AppError(404, 'Law not found');
    }

    /* Parallel: source bill + amendment bills */
    const [[bill], amendmentBills] = await Promise.all([
      db
        .select({ id: bills.id, title: bills.title, committee: bills.committee, status: bills.status, introducedAt: bills.introducedAt, sponsorId: bills.sponsorId })
        .from(bills)
        .where(eq(bills.id, law.billId))
        .limit(1),
      db
        .select({ id: bills.id, title: bills.title, status: bills.status, introducedAt: bills.introducedAt })
        .from(bills)
        .where(eq(bills.amendsLawId, law.id)),
    ]);

    const [sponsor] = bill
      ? await db
          .select({ id: agents.id, displayName: agents.displayName, avatarConfig: agents.avatarConfig, alignment: agents.alignment })
          .from(agents)
          .where(eq(agents.id, bill.sponsorId))
          .limit(1)
      : [null];

    res.json({
      success: true,
      data: {
        ...law,
        sourceBill: bill
          ? { id: bill.id, title: bill.title, committee: bill.committee, status: bill.status, introducedAt: bill.introducedAt }
          : null,
        sponsor: sponsor
          ? { id: sponsor.id, displayName: sponsor.displayName, avatarConfig: sponsor.avatarConfig, alignment: sponsor.alignment }
          : null,
        amendmentBills,
      },
    });
  } catch (error) {
    next(error);
  }
});
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/server/routes/legislation.ts
git commit -m "feat(laws): add GET /api/laws/:id endpoint"
```

---

## Task 3: Update api.ts

**Files:**
- Modify: `src/client/lib/api.ts:81`

**Step 1: Add getById to the laws section**

Find line 81 in `src/client/lib/api.ts`:
```typescript
  laws: () => request('/laws'),
```

Replace with:
```typescript
  laws: () => request('/laws'),
  lawById: (id: string) => request(`/laws/${id}`),
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat(laws): add legislationApi.lawById"
```

---

## Task 4: Build LawsPage.tsx

**Files:**
- Create: `src/client/pages/LawsPage.tsx`

**Step 1: Create the file**

```tsx
import { useState, useEffect } from 'react';
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
}

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function LawsPage() {
  const [lawItems, setLawItems] = useState<LawItem[]>([]);
  const [loading, setLoading] = useState(true);

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

  const activeCount = lawItems.filter((l) => l.isActive).length;

  return (
    <div className="max-w-screen-2xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-serif text-3xl font-semibold text-stone">Laws of the Land</h1>
        {!loading && (
          <p className="text-text-muted text-sm">
            {lawItems.length} law{lawItems.length !== 1 ? 's' : ''} enacted
            {activeCount !== lawItems.length && `, ${activeCount} active`}
          </p>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <p className="text-text-muted py-16 text-center">Loading...</p>
      ) : lawItems.length === 0 ? (
        <p className="text-text-muted py-16 text-center">No laws have been enacted yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {lawItems.map((law) => {
            const avatarConfig = law.sponsorAvatarConfig
              ? (JSON.parse(law.sponsorAvatarConfig) as AvatarConfig)
              : undefined;
            const alignKey = law.sponsorAlignment?.toLowerCase() ?? '';
            const alignColor = ALIGNMENT_COLORS[alignKey] ?? 'text-text-muted bg-border/10 border-border/30';

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

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Fix any errors before proceeding.

**Step 3: Commit**

```bash
git add src/client/pages/LawsPage.tsx
git commit -m "feat(laws): add LawsPage list page"
```

---

## Task 5: Build LawDetailPage.tsx

**Files:**
- Create: `src/client/pages/LawDetailPage.tsx`

**Step 1: Create the file**

```tsx
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { legislationApi } from '../lib/api';
import { PixelAvatar } from '../components/PixelAvatar';
import type { AvatarConfig } from '../components/PixelAvatar';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface AmendmentBill {
  id: string;
  title: string;
  status: string;
  introducedAt: string;
}

interface LawDetail {
  id: string;
  title: string;
  text: string;
  enactedDate: string;
  isActive: boolean;
  amendmentHistory: string; // JSON string
  sourceBill: {
    id: string;
    title: string;
    committee: string;
    status: string;
    introducedAt: string;
  } | null;
  sponsor: {
    id: string;
    displayName: string;
    avatarConfig: string | null;
    alignment: string | null;
  } | null;
  amendmentBills: AmendmentBill[];
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const BILL_STATUS_META: Record<string, { label: string; color: string }> = {
  proposed:          { label: 'Proposed',          color: 'text-blue-300 bg-blue-900/20 border-blue-700/30' },
  committee:         { label: 'In Committee',       color: 'text-yellow-300 bg-yellow-900/20 border-yellow-700/30' },
  floor:             { label: 'On the Floor',       color: 'text-orange-300 bg-orange-900/20 border-orange-700/30' },
  passed:            { label: 'Passed',             color: 'text-green-300 bg-green-900/20 border-green-700/30' },
  presidential_veto: { label: 'Presidential Veto', color: 'text-red-300 bg-red-900/20 border-red-700/30' },
  vetoed:            { label: 'Vetoed',             color: 'text-red-400 bg-red-900/30 border-red-700/40' },
  law:               { label: 'Enacted',            color: 'text-emerald-300 bg-emerald-900/20 border-emerald-700/30' },
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
      <h2 className="font-serif text-lg font-semibold text-stone">{title}</h2>
      {children}
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function LawDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [law, setLaw] = useState<LawDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    legislationApi.lawById(id)
      .then((res) => {
        if (res.data) {
          setLaw(res.data as LawDetail);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="max-w-4xl mx-auto px-6 py-8 text-text-muted">Loading...</div>;
  }
  if (notFound || !law) {
    return <div className="max-w-4xl mx-auto px-6 py-8 text-text-muted">Law not found.</div>;
  }

  const sponsorAvatarConfig = law.sponsor?.avatarConfig
    ? (JSON.parse(law.sponsor.avatarConfig) as AvatarConfig)
    : undefined;
  const alignKey = law.sponsor?.alignment?.toLowerCase() ?? '';
  const alignColor = ALIGNMENT_COLORS[alignKey] ?? 'text-text-muted bg-border/10 border-border/30';

  /* Parse amendment history */
  let amendmentHistory: string[] = [];
  try {
    const parsed = JSON.parse(law.amendmentHistory);
    if (Array.isArray(parsed)) amendmentHistory = parsed as string[];
  } catch { /* leave empty */ }

  const billStatus = law.sourceBill ? (BILL_STATUS_META[law.sourceBill.status] ?? { label: law.sourceBill.status, color: 'text-text-muted bg-border/10 border-border/30' }) : null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Back */}
      <Link to="/laws" className="text-badge text-text-muted hover:text-gold transition-colors">
        ← Back to Laws
      </Link>

      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="font-serif text-2xl font-semibold text-stone flex-1">{law.title}</h1>
          <span
            className={`badge border text-badge uppercase tracking-widest shrink-0 ${
              law.isActive
                ? 'text-green-400 bg-green-900/20 border-green-700/30'
                : 'text-red-400 bg-red-900/20 border-red-700/30'
            }`}
          >
            {law.isActive ? 'Active' : 'Repealed'}
          </span>
        </div>
        <p className="text-text-muted text-sm">Enacted {fmtDate(law.enactedDate)}</p>
      </div>

      {/* Sponsor */}
      {law.sponsor && (
        <Section title="Sponsor">
          <div className="flex items-center gap-3">
            <PixelAvatar config={sponsorAvatarConfig} seed={law.sponsor.displayName} size="md" />
            <div className="space-y-1">
              <Link
                to={`/agents/${law.sponsor.id}`}
                className="text-gold hover:underline font-medium"
              >
                {law.sponsor.displayName}
              </Link>
              {alignKey && (
                <div>
                  <span className={`badge border text-badge uppercase tracking-widest ${alignColor}`}>
                    {alignKey}
                  </span>
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* Source bill */}
      {law.sourceBill && (
        <Section title="Source Bill">
          <div className="space-y-2">
            <Link
              to={`/legislation/${law.sourceBill.id}`}
              className="text-gold hover:underline font-medium leading-snug block"
            >
              {law.sourceBill.title}
            </Link>
            <div className="flex flex-wrap gap-2">
              {billStatus && (
                <span className={`badge border text-badge uppercase tracking-widest ${billStatus.color}`}>
                  {billStatus.label}
                </span>
              )}
              <span className="badge border border-border/40 text-text-muted bg-border/10">
                {law.sourceBill.committee}
              </span>
            </div>
            <p className="text-text-muted text-xs">Introduced {fmtDate(law.sourceBill.introducedAt)}</p>
          </div>
        </Section>
      )}

      {/* Full text */}
      <Section title="Full Text">
        <pre className="text-text-secondary text-sm whitespace-pre-wrap leading-relaxed font-sans">
          {law.text}
        </pre>
      </Section>

      {/* Amendment history — only if non-empty */}
      {amendmentHistory.length > 0 && (
        <Section title="Amendment History">
          <ol className="space-y-2 list-decimal list-inside">
            {amendmentHistory.map((entry, i) => (
              <li key={i} className="text-text-secondary text-sm">{entry}</li>
            ))}
          </ol>
        </Section>
      )}

      {/* Amended by — bills that reference this law */}
      {law.amendmentBills.length > 0 && (
        <Section title="Amended By">
          <div className="space-y-2">
            {law.amendmentBills.map((b) => {
              const s = BILL_STATUS_META[b.status] ?? { label: b.status, color: 'text-text-muted bg-border/10 border-border/30' };
              return (
                <div key={b.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border/30 last:border-0">
                  <Link to={`/legislation/${b.id}`} className="text-gold hover:underline text-sm">
                    {b.title}
                  </Link>
                  <span className={`badge border text-badge uppercase tracking-widest shrink-0 ${s.color}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

Fix any errors before proceeding.

**Step 3: Commit**

```bash
git add src/client/pages/LawDetailPage.tsx
git commit -m "feat(laws): add LawDetailPage detail page"
```

---

## Task 6: Wire routes in App.tsx

**Files:**
- Modify: `src/client/App.tsx`

**Step 1: Add imports and routes**

Add these two imports after the `ElectionDetailPage` import:
```typescript
import { LawsPage } from './pages/LawsPage';
import { LawDetailPage } from './pages/LawDetailPage';
```

Add these two routes inside the `<Route element={<Layout />}>` block, after the `/legislation/:id` route:
```tsx
<Route path="/laws" element={<LawsPage />} />
<Route path="/laws/:id" element={<LawDetailPage />} />
```

**Step 2: Type-check**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/client/App.tsx
git commit -m "feat(laws): wire /laws and /laws/:id routes"
```

---

## Task 7: Left-edge hover drawer in Layout.tsx

**Files:**
- Modify: `src/client/components/Layout.tsx`

This is the most involved change. The nav structure stays identical. We add:
1. Two new state values + one ref
2. An invisible hot zone fixed to the left edge
3. A sliding drawer rendered conditionally

**Step 1: Add state and ref**

At the top of the `Layout` function, after the existing `useRef` declarations (around line 42), add:

```typescript
const [drawerOpen, setDrawerOpen] = useState(false);
const drawerCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const [drawerLocation, setDrawerLocation] = useState('/');
```

Wait — actually we don't need `drawerLocation`. The drawer shows the full nav tree with the active route highlighted via `NavLink`'s active class. We just need `drawerOpen`.

```typescript
const [drawerOpen, setDrawerOpen] = useState(false);
const drawerCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

**Step 2: Add handler functions**

Add these two functions inside the `Layout` function, before the `return` statement:

```typescript
function handleDrawerEnter() {
  if (drawerCloseTimerRef.current) {
    clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = null;
  }
  setDrawerOpen(true);
}

function handleDrawerLeave() {
  drawerCloseTimerRef.current = setTimeout(() => {
    setDrawerOpen(false);
  }, 3000);
}
```

**Step 3: Add the hot zone and drawer to the JSX**

Inside the `return`, just before the closing `</div>` of the outermost `<div className="min-h-screen flex flex-col bg-capitol-deep">`, add:

```tsx
{/* Left-edge hot zone — invisible trigger strip */}
<div
  className="fixed left-0 top-[64px] bottom-0 w-5 z-40"
  onMouseEnter={handleDrawerEnter}
  onMouseLeave={handleDrawerLeave}
  aria-hidden="true"
/>

{/* Left-edge submenu drawer */}
<div
  className={`fixed left-0 top-[64px] bottom-0 z-40 w-60 flex flex-col border-r border-border shadow-xl transition-transform duration-200 ${
    drawerOpen ? 'translate-x-0' : '-translate-x-full'
  }`}
  style={{ background: 'linear-gradient(180deg, #3A3D42 0%, #2F3136 100%)' }}
  onMouseEnter={handleDrawerEnter}
  onMouseLeave={handleDrawerLeave}
  role="navigation"
  aria-label="Section navigation"
>
  <nav className="flex flex-col py-4 gap-0.5 overflow-y-auto">
    {/* Capitol */}
    <NavLink
      to="/"
      end
      className={({ isActive }) =>
        `px-5 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors ${
          isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
        }`
      }
      onClick={() => setDrawerOpen(false)}
    >
      Capitol
    </NavLink>

    {/* Agents */}
    <NavLink
      to="/agents"
      className={({ isActive }) =>
        `px-5 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors ${
          isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
        }`
      }
      onClick={() => setDrawerOpen(false)}
    >
      Agents
    </NavLink>

    {/* Legislative (with children) */}
    <div>
      <span className="px-5 py-2 text-xs font-semibold uppercase tracking-widest text-text-muted block mt-2">
        Legislative
      </span>
      <NavLink
        to="/legislation"
        className={({ isActive }) =>
          `pl-8 pr-5 py-2 text-sm transition-colors block ${
            isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
          }`
        }
        onClick={() => setDrawerOpen(false)}
      >
        Bills
      </NavLink>
      <NavLink
        to="/laws"
        className={({ isActive }) =>
          `pl-8 pr-5 py-2 text-sm transition-colors block ${
            isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
          }`
        }
        onClick={() => setDrawerOpen(false)}
      >
        Laws
      </NavLink>
    </div>

    {/* Elections */}
    <NavLink
      to="/elections"
      className={({ isActive }) =>
        `px-5 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors ${
          isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
        }`
      }
      onClick={() => setDrawerOpen(false)}
    >
      Elections
    </NavLink>

    {/* Parties */}
    <NavLink
      to="/parties"
      className={({ isActive }) =>
        `px-5 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors ${
          isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
        }`
      }
      onClick={() => setDrawerOpen(false)}
    >
      Parties
    </NavLink>

    {/* Map */}
    <NavLink
      to="/capitol-map"
      className={({ isActive }) =>
        `px-5 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors ${
          isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
        }`
      }
      onClick={() => setDrawerOpen(false)}
    >
      Map
    </NavLink>

    {/* Calendar */}
    <NavLink
      to="/calendar"
      className={({ isActive }) =>
        `px-5 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors ${
          isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
        }`
      }
      onClick={() => setDrawerOpen(false)}
    >
      Calendar
    </NavLink>

    {/* Forum */}
    <NavLink
      to="/forum"
      className={({ isActive }) =>
        `px-5 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors ${
          isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
        }`
      }
      onClick={() => setDrawerOpen(false)}
    >
      Forum
    </NavLink>
  </nav>
</div>
```

**Step 4: Type-check**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/client/components/Layout.tsx
git commit -m "feat(nav): left-edge hover drawer with submenu support"
```

---

## Task 8: Final check + PR cycle

**Step 1: Full type-check**

```bash
npx tsc --noEmit
```

Must be clean before pushing.

**Step 2: Rebase on latest dev**

```bash
git fetch origin dev
git rebase origin/dev
```

**Step 3: Push branch**

```bash
git push -u origin feature/law-browser-submenu-drawer
```

**Step 4: PR feature → dev**

```bash
cat > /tmp/pr_laws.json <<'EOF'
{
  "title": "feat(laws): law browser + left-edge submenu drawer",
  "body": "## Summary\n- Enriches `GET /api/laws` with bill + sponsor join data\n- Adds `GET /api/laws/:id` endpoint with full law details\n- Adds `/laws` list page (1→2→3→4→5 column grid at 2K)\n- Adds `/laws/:id` detail page (sponsor, source bill, full text, amendment history, amended-by bills)\n- Adds left-edge hover drawer in Layout for submenu navigation (3-second close delay)\n\n## Test plan\n- [ ] Hover left edge of screen — drawer slides in\n- [ ] Mouse leaves — drawer closes after 3 seconds\n- [ ] Navigate to /laws — all laws listed with correct data\n- [ ] Click a law card — navigates to /laws/:id with full detail\n- [ ] Sponsor name links to /agents/:id\n- [ ] Source Bill link goes to /legislation/:id\n- [ ] Laws link in drawer navigates correctly\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  "head": "feature/law-browser-submenu-drawer",
  "base": "dev"
}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr_laws.json | python3 -m json.tool | grep '"number"'
```

**Step 5: Merge PR feature → dev**

```bash
# Replace N with the PR number from step 4
cat > /tmp/merge_laws.json <<'EOF'
{"Do":"merge","merge_message_field":"Merge feat(laws): law browser + left-edge submenu drawer"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/N/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/merge_laws.json
```

**Step 6: PR dev → main**

```bash
cat > /tmp/pr_laws_main.json <<'EOF'
{
  "title": "chore: sync dev → main (law browser + submenu drawer)",
  "body": "Syncing dev into main after law browser feature merge.",
  "head": "dev",
  "base": "main"
}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr_laws_main.json | python3 -m json.tool | grep '"number"'
```

**Step 7: Merge dev → main**

Same merge curl as step 5, using the dev→main PR number.

**Step 8: Update CLAUDE.md backlog**

Remove the "Law browser page" item from the `## Backlog` section in `CLAUDE.md` since it is now shipped.
