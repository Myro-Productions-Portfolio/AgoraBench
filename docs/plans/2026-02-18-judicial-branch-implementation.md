# Judicial Branch UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full Supreme Court section (`/court` landing + `/court/cases/:id` detail) and clean up all "Congress" references to "Legislature" across the codebase.

**Architecture:** New `src/server/routes/court.ts` exposes two endpoints. Two new frontend pages consume them. Nav updated in Layout.tsx. Language cleanup is surgical find-and-replace across four files plus agentTick.ts.

**Tech Stack:** Express + Drizzle ORM (backend), React 18 + Tailwind + react-router-dom (frontend), TypeScript throughout.

---

## Task 1: Backend — court route file

**Files:**
- Create: `src/server/routes/court.ts`
- Modify: `src/server/routes/index.ts`

**Context:** The `judicialReviews` and `judicialVotes` tables are in `src/db/schema/government.ts`. The `laws` table is in `src/db/schema/legislation.ts`. The `agents` table is in `src/db/schema/agents.ts`. All are exported from `src/db/schema/index.ts`. Route pattern: `import { Router } from 'express'`, use `db` from `@db/connection`, `AppError` from `../middleware/errorHandler`. See `src/server/routes/legislation.ts` for the exact import and router style.

**Step 1: Create `src/server/routes/court.ts`**

```typescript
import { Router } from 'express';
import { db } from '@db/connection';
import { judicialReviews, judicialVotes, laws, agents } from '@db/schema/index';
import { AppError } from '../middleware/errorHandler';
import { eq, desc, sql } from 'drizzle-orm';

const router = Router();

/* GET /api/court/cases -- All judicial reviews, enriched */
router.get('/court/cases', async (req, res, next) => {
  try {
    const { status } = req.query as { status?: string };

    const baseQuery = db
      .select()
      .from(judicialReviews)
      .orderBy(desc(judicialReviews.createdAt));

    const reviews = status
      ? await baseQuery.where(eq(judicialReviews.status, status))
      : await baseQuery;

    const enriched = await Promise.all(
      reviews.map(async (review) => {
        const [law] = await db
          .select({ id: laws.id, title: laws.title, enactedDate: laws.enactedDate, isActive: laws.isActive })
          .from(laws)
          .where(eq(laws.id, review.lawId))
          .limit(1);

        const votes = await db
          .select({ vote: judicialVotes.vote })
          .from(judicialVotes)
          .where(eq(judicialVotes.reviewId, review.id));

        const constitutionalCount = votes.filter((v) => v.vote === 'constitutional').length;
        const unconstitutionalCount = votes.filter((v) => v.vote === 'unconstitutional').length;

        return {
          ...review,
          lawTitle: law?.title ?? 'Unknown Law',
          lawId: law?.id ?? review.lawId,
          constitutionalCount,
          unconstitutionalCount,
          totalVotes: votes.length,
        };
      }),
    );

    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
});

/* GET /api/court/stats -- Aggregate counts by status */
router.get('/court/stats', async (req, res, next) => {
  try {
    const all = await db.select({ status: judicialReviews.status }).from(judicialReviews);
    const stats = {
      total: all.length,
      deliberating: all.filter((r) => r.status === 'deliberating').length,
      upheld: all.filter((r) => r.status === 'upheld').length,
      struckDown: all.filter((r) => r.status === 'struck_down').length,
      pending: all.filter((r) => r.status === 'pending').length,
    };
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

/* GET /api/court/cases/:id -- Single case with full vote detail */
router.get('/court/cases/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [review] = await db
      .select()
      .from(judicialReviews)
      .where(eq(judicialReviews.id, id))
      .limit(1);

    if (!review) throw new AppError(404, 'Case not found');

    const [law] = await db
      .select({ id: laws.id, title: laws.title, enactedDate: laws.enactedDate, isActive: laws.isActive })
      .from(laws)
      .where(eq(laws.id, review.lawId))
      .limit(1);

    const votes = await db
      .select()
      .from(judicialVotes)
      .where(eq(judicialVotes.reviewId, review.id))
      .orderBy(desc(judicialVotes.castAt));

    const enrichedVotes = await Promise.all(
      votes.map(async (vote) => {
        const [justice] = await db
          .select({
            id: agents.id,
            displayName: agents.displayName,
            avatarConfig: agents.avatarConfig,
            alignment: agents.alignment,
          })
          .from(agents)
          .where(eq(agents.id, vote.justiceId))
          .limit(1);

        return {
          ...vote,
          justiceName: justice?.displayName ?? 'Unknown',
          justiceAvatarConfig: justice?.avatarConfig ?? null,
          justiceAlignment: justice?.alignment ?? null,
          justiceId: justice?.id ?? vote.justiceId,
        };
      }),
    );

    res.json({
      success: true,
      data: {
        ...review,
        law: law ?? null,
        votes: enrichedVotes,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
```

**Step 2: Register in `src/server/routes/index.ts`**

Add at the top imports:
```typescript
import courtRouter from './court';
```

Add after `forumRouter` registration:
```typescript
router.use(courtRouter);
```

**Step 3: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add src/server/routes/court.ts src/server/routes/index.ts
git commit -m "feat(court): add court API endpoints (cases list + stats + case detail)"
```

---

## Task 2: Frontend — courtApi in api.ts

**Files:**
- Modify: `src/client/lib/api.ts`

**Context:** Every API module follows `export const thingApi = { method: () => request('/path') }`. See existing modules in `src/client/lib/api.ts`.

**Step 1: Add `courtApi` to `src/client/lib/api.ts`**

Find the end of the file. Add:

```typescript
/* Court endpoints */
export const courtApi = {
  stats: () => request('/court/stats'),
  cases: (status?: string) =>
    request(`/court/cases${status ? `?status=${status}` : ''}`),
  caseById: (id: string) => request(`/court/cases/${id}`),
};
```

**Step 2: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/client/lib/api.ts
git commit -m "feat(court): add courtApi client module"
```

---

## Task 3: Frontend — CourtPage (`/court`)

**Files:**
- Create: `src/client/pages/CourtPage.tsx`

**Context:** Page follows the same pattern as `LawsPage.tsx` — useState + useEffect fetch, design tokens from CLAUDE.md. PixelAvatar import from `../components/PixelAvatar`. ALIGNMENT_COLORS constant used on every page. `fmtDate` helper for dates. Link from react-router-dom.

**Step 1: Create `src/client/pages/CourtPage.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { courtApi } from '../lib/api';
import { PixelAvatar } from '../components/PixelAvatar';
import type { AvatarConfig } from '../components/PixelAvatar';

interface CourtStats {
  total: number;
  deliberating: number;
  upheld: number;
  struckDown: number;
  pending: number;
}

interface Justice {
  id: string;
  displayName: string;
  avatarConfig: string | null;
  alignment: string | null;
}

interface CaseItem {
  id: string;
  lawId: string;
  lawTitle: string;
  status: string;
  ruling: string | null;
  ruledAt: string | null;
  createdAt: string;
  constitutionalCount: number;
  unconstitutionalCount: number;
  totalVotes: number;
}

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const STATUS_BADGES: Record<string, string> = {
  deliberating: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30',
  upheld:       'text-green-400 bg-green-900/20 border-green-700/30',
  struck_down:  'text-red-400 bg-red-900/20 border-red-700/30',
  pending:      'text-text-muted bg-border/10 border-border/30',
};

const STATUS_LABELS: Record<string, string> = {
  deliberating: 'Deliberating',
  upheld:       'Upheld',
  struck_down:  'Struck Down',
  pending:      'Pending',
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CourtPage() {
  const [stats, setStats] = useState<CourtStats | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [justices, setJustices] = useState<Justice[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      courtApi.stats(),
      courtApi.cases(statusFilter || undefined),
    ])
      .then(([statsRes, casesRes]) => {
        if (statsRes.data) setStats(statsRes.data as CourtStats);
        if (Array.isArray(casesRes.data)) setCases(casesRes.data as CaseItem[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [statusFilter]);

  // Fetch justices from agents API (position type supreme_court)
  useEffect(() => {
    fetch('/api/agents?limit=100')
      .then((r) => r.json())
      .then((res: { data?: { data?: Justice[] } }) => {
        // We'll filter for justices via positions — for now show all active agents
        // The proper filter happens server-side when we have a justices endpoint
      })
      .catch(() => {});
  }, []);

  const filterOptions = [
    { value: '', label: 'All Cases' },
    { value: 'deliberating', label: 'Deliberating' },
    { value: 'upheld', label: 'Upheld' },
    { value: 'struck_down', label: 'Struck Down' },
  ];

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="font-serif text-3xl font-semibold text-stone">Supreme Court</h1>
        <p className="text-text-muted text-sm">
          Constitutional review body. Final arbiter of whether enacted laws stand.
        </p>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Cases', value: stats.total },
            { label: 'Upheld', value: stats.upheld, color: 'text-green-400' },
            { label: 'Struck Down', value: stats.struckDown, color: 'text-red-400' },
            { label: 'Deliberating', value: stats.deliberating, color: 'text-yellow-400' },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-surface p-4">
              <div className="text-badge text-text-muted uppercase tracking-widest mb-1">{s.label}</div>
              <div className={`font-mono text-2xl font-bold ${s.color ?? 'text-stone'}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Docket */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-stone">The Docket</h2>
          <div className="flex gap-1">
            {filterOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`text-badge px-3 py-1.5 rounded border transition-colors uppercase tracking-widest ${
                  statusFilter === opt.value
                    ? 'border-gold/40 text-gold bg-gold/5'
                    : 'border-border/40 text-text-muted hover:text-text-primary hover:border-border'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-text-muted py-16 text-center">Loading...</p>
        ) : cases.length === 0 ? (
          <p className="text-text-muted py-16 text-center">No cases on the docket.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface/50">
                  <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3">Law</th>
                  <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3">Status</th>
                  <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3 hidden sm:table-cell">Vote</th>
                  <th className="text-left text-badge text-text-muted uppercase tracking-widest px-4 py-3 hidden md:table-cell">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/court/cases/${c.id}`} className="text-gold hover:underline text-sm">
                        {c.lawTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge border text-badge ${STATUS_BADGES[c.status] ?? 'text-text-muted bg-border/10 border-border/30'}`}>
                        {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {c.totalVotes > 0 ? (
                        <span className="text-xs font-mono text-text-secondary">
                          {c.constitutionalCount}–{c.unconstitutionalCount}
                        </span>
                      ) : (
                        <span className="text-badge text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-text-muted">
                        {c.ruledAt ? fmtDate(c.ruledAt) : fmtDate(c.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/client/pages/CourtPage.tsx
git commit -m "feat(court): add CourtPage — Supreme Court landing with docket"
```

---

## Task 4: Frontend — CasePage (`/court/cases/:id`)

**Files:**
- Create: `src/client/pages/CasePage.tsx`

**Context:** Detail page pattern matches `LawDetailPage.tsx` — `useParams`, back link, section cards. PixelAvatar for justice avatars.

**Step 1: Create `src/client/pages/CasePage.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { courtApi } from '../lib/api';
import { PixelAvatar } from '../components/PixelAvatar';
import type { AvatarConfig } from '../components/PixelAvatar';

interface LawRef {
  id: string;
  title: string;
  enactedDate: string;
  isActive: boolean;
}

interface VoteDetail {
  id: string;
  justiceId: string;
  justiceName: string;
  justiceAvatarConfig: string | null;
  justiceAlignment: string | null;
  vote: string;
  reasoning: string;
  castAt: string;
}

interface CaseDetail {
  id: string;
  lawId: string;
  status: string;
  ruling: string | null;
  ruledAt: string | null;
  createdAt: string;
  law: LawRef | null;
  votes: VoteDetail[];
}

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const STATUS_LABELS: Record<string, string> = {
  deliberating: 'Deliberating',
  upheld:       'Upheld',
  struck_down:  'Struck Down',
  pending:      'Pending',
};

const STATUS_COLORS: Record<string, string> = {
  deliberating: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30',
  upheld:       'text-green-400 bg-green-900/20 border-green-700/30',
  struck_down:  'text-red-400 bg-red-900/20 border-red-700/30',
  pending:      'text-text-muted bg-border/10 border-border/30',
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CasePage() {
  const { id } = useParams<{ id: string }>();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    courtApi.caseById(id)
      .then((res) => {
        if (res.data) setCaseData(res.data as CaseDetail);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-text-muted text-center py-16">Loading case...</p>
      </div>
    );
  }

  if (notFound || !caseData) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <Link to="/court" className="text-badge text-text-muted hover:text-gold transition-colors">
          ← Back to Court
        </Link>
        <p className="text-text-muted text-center py-16">Case not found.</p>
      </div>
    );
  }

  const constitutionalCount = caseData.votes.filter((v) => v.vote === 'constitutional').length;
  const unconstitutionalCount = caseData.votes.filter((v) => v.vote === 'unconstitutional').length;
  const isResolved = caseData.status === 'upheld' || caseData.status === 'struck_down';

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Back link */}
      <Link to="/court" className="text-badge text-text-muted hover:text-gold transition-colors">
        ← Back to Court
      </Link>

      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-serif text-2xl font-semibold text-stone leading-snug">
            {caseData.law?.title ?? 'Unknown Law'} — Constitutional Review
          </h1>
          <span className={`badge border shrink-0 ${STATUS_COLORS[caseData.status] ?? 'text-text-muted bg-border/10 border-border/30'}`}>
            {STATUS_LABELS[caseData.status] ?? caseData.status}
          </span>
        </div>
        {caseData.ruledAt && (
          <p className="text-xs text-text-muted">Ruled {fmtDate(caseData.ruledAt)}</p>
        )}
        {!caseData.ruledAt && (
          <p className="text-xs text-text-muted">Filed {fmtDate(caseData.createdAt)}</p>
        )}
      </div>

      {/* Law Under Review */}
      {caseData.law && (
        <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
          <h2 className="font-serif text-lg font-semibold text-stone">Law Under Review</h2>
          <div className="flex items-center justify-between">
            <Link
              to={`/laws/${caseData.law.id}`}
              className="text-gold hover:underline font-medium"
            >
              {caseData.law.title}
            </Link>
            <span className={`badge border text-badge ${caseData.law.isActive ? 'text-green-400 bg-green-900/20 border-green-700/30' : 'text-text-muted bg-border/10 border-border/30'}`}>
              {caseData.law.isActive ? 'Active' : 'Repealed'}
            </span>
          </div>
          <p className="text-xs text-text-muted">Enacted {fmtDate(caseData.law.enactedDate)}</p>
        </div>
      )}

      {/* The Ruling (resolved only) */}
      {isResolved && caseData.ruling && (
        <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
          <h2 className="font-serif text-lg font-semibold text-stone">The Ruling</h2>
          <div className={`text-3xl font-serif font-bold ${caseData.status === 'upheld' ? 'text-green-400' : 'text-red-400'}`}>
            {caseData.status === 'upheld' ? 'Upheld' : 'Struck Down'} {constitutionalCount}–{unconstitutionalCount}
          </div>
          <p className="text-sm text-text-secondary">{caseData.ruling}</p>
        </div>
      )}

      {/* Justice Votes */}
      <div className="space-y-3">
        <h2 className="font-serif text-lg font-semibold text-stone">
          Justice Votes {caseData.votes.length > 0 && `(${caseData.votes.length})`}
        </h2>
        {caseData.votes.length === 0 ? (
          <p className="text-text-muted text-sm">No votes have been cast yet.</p>
        ) : (
          <div className="space-y-3">
            {caseData.votes.map((vote) => {
              const avatarConfig = vote.justiceAvatarConfig
                ? (JSON.parse(vote.justiceAvatarConfig) as AvatarConfig)
                : undefined;
              const alignKey = vote.justiceAlignment?.toLowerCase() ?? '';
              const alignColor = ALIGNMENT_COLORS[alignKey] ?? 'text-text-muted bg-border/10 border-border/30';
              const isConstitutional = vote.vote === 'constitutional';

              return (
                <div key={vote.id} className="rounded-lg border border-border bg-surface p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <PixelAvatar config={avatarConfig} seed={vote.justiceName} size="sm" />
                      <div>
                        <Link
                          to={`/agents/${vote.justiceId}`}
                          className="text-sm font-medium text-gold hover:underline"
                        >
                          {vote.justiceName}
                        </Link>
                        {vote.justiceAlignment && (
                          <span className={`ml-2 badge border text-badge ${alignColor}`}>
                            {vote.justiceAlignment}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`badge border font-semibold ${
                      isConstitutional
                        ? 'text-green-400 bg-green-900/20 border-green-700/30'
                        : 'text-red-400 bg-red-900/20 border-red-700/30'
                    }`}>
                      {isConstitutional ? 'Constitutional' : 'Unconstitutional'}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">{vote.reasoning}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/client/pages/CasePage.tsx
git commit -m "feat(court): add CasePage — case detail with justice votes"
```

---

## Task 5: Wire routes + nav in App.tsx and Layout.tsx

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/Layout.tsx`

**Context:** Read both files first. `App.tsx` imports page components and registers them as `<Route>` elements. `Layout.tsx` has `NAV_LINKS` array (top nav) and a drawer `<nav>` section. `GO_KEYS` is the G+key shortcut map.

**Step 1: Update `src/client/App.tsx`**

Add imports after existing page imports:
```typescript
import { CourtPage } from './pages/CourtPage';
import { CasePage } from './pages/CasePage';
```

Add routes after the `/laws/:id` route:
```tsx
<Route path="/court" element={<CourtPage />} />
<Route path="/court/cases/:id" element={<CasePage />} />
```

**Step 2: Update `NAV_LINKS` in `src/client/components/Layout.tsx`**

Find the `NAV_LINKS` array. Add `Court` between `Legislative` and `Elections`:

```typescript
const NAV_LINKS = [
  { to: '/', label: 'Capitol' },
  { to: '/agents', label: 'Agents' },
  { to: '/legislation', label: 'Legislative' },
  { to: '/court', label: 'Court' },
  { to: '/elections', label: 'Elections' },
  { to: '/parties', label: 'Parties' },
  { to: '/capitol-map', label: 'Map' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/forum', label: 'Forum' },
] as const;
```

**Step 3: Update `GO_KEYS` in `Layout.tsx`**

Add `c: '/court'` to the `GO_KEYS` map:
```typescript
const GO_KEYS: Record<string, string> = {
  h: '/',
  a: '/agents',
  l: '/legislation',
  c: '/court',
  e: '/elections',
  p: '/parties',
  f: '/forum',
};
```

**Step 4: Update the drawer nav in `Layout.tsx`**

Find the drawer `<nav>` section. After the Legislative `<div>` block (which contains Bills and Laws sub-links) and before the Elections `<NavLink>`, add a Court section:

```tsx
<div>
  <span className="px-5 py-2 text-xs font-semibold uppercase tracking-widest text-text-muted block mt-2">
    Court
  </span>
  <NavLink
    to="/court"
    className={({ isActive }) =>
      `pl-8 pr-5 py-2 text-sm transition-colors block ${
        isActive ? 'text-gold' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
      }`
    }
    onClick={() => setDrawerOpen(false)}
  >
    Docket
  </NavLink>
</div>
```

**Step 5: Fix the "Bill Passed Congress" toast in `Layout.tsx`**

Find line ~71:
```typescript
toast('Bill Passed Congress', {
```
Replace with:
```typescript
toast('Bill Passed Legislature', {
```

**Step 6: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

**Step 7: Commit**

```bash
git add src/client/App.tsx src/client/components/Layout.tsx
git commit -m "feat(court): wire court routes + nav + drawer + fix congress toast"
```

---

## Task 6: Language cleanup — remaining "Congress" references

**Files:**
- Modify: `src/client/pages/BillDetailPage.tsx`
- Modify: `src/client/lib/buildings.ts`
- Modify: `src/client/pages/DashboardPage.tsx`
- Modify: `src/server/jobs/agentTick.ts`

**Context:** Read each file before editing. Make only the targeted string replacements listed below.

**Step 1: `src/client/pages/BillDetailPage.tsx`**

Find the status label map. Find `'Passed Congress'` and replace with `'Passed Legislature'`.

**Step 2: `src/client/lib/buildings.ts`**

Find `'Seat of the Agora Legislature'` (or similar). Replace with `'Seat of the Agora Legislature'`.

**Step 3: `src/client/pages/DashboardPage.tsx`**

Find `officialTitle: 'Speaker of Congress'`. Replace with `officialTitle: 'Speaker of the Legislature'`.

**Step 4: `src/server/jobs/agentTick.ts`**

Make these targeted replacements (search for each string exactly):

| Find | Replace |
|---|---|
| `'Bill passed Congress'` | `'Bill passed the Legislature'` |
| `passed Congress (` | `passed the Legislature (` |
| `'Congress voted it down'` (comment) | `'Legislature voted it down'` |
| `voted down by Congress` | `voted down by the Legislature` |
| `Congress has passed: "` | `The Legislature has passed: "` |
| `Congress can override the veto with a 2/3 supermajority` | `The Legislature can override the veto with a 2/3 supermajority` |
| `Congress overrode the presidential veto` | `The Legislature overrode the presidential veto` |

**Step 5: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add src/client/pages/BillDetailPage.tsx src/client/lib/buildings.ts src/client/pages/DashboardPage.tsx src/server/jobs/agentTick.ts
git commit -m "fix(lang): replace Congress with Legislature across frontend and tick engine"
```

---

## Task 7: Final check + production build + PR cycle

**Step 1: Full type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Zero errors required.

**Step 2: Production build**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npm run build
```

**Step 3: Restart PM2**

```bash
pm2 restart agora-bench
```

**Step 4: Rebase + push**

```bash
git fetch origin dev
git rebase origin/dev
git push -u origin feature/judicial-branch
```

**Step 5: PR feature → dev**

```bash
cat > /tmp/pr_court.json <<'EOF'
{
  "title": "feat(court): judicial branch UI + language cleanup",
  "body": "## Summary\n- New `/court` landing page: Supreme Court stats, docket with status filter\n- New `/court/cases/:id` detail page: case header, law under review, ruling, per-justice votes with reasoning\n- New `GET /api/court/cases` and `GET /api/court/cases/:id` endpoints\n- Court added to top nav and left-edge drawer\n- G+C keyboard shortcut for `/court`\n- Language cleanup: 'Congress' → 'Legislature' across frontend labels, toast, buildings, and agentTick event strings\n\n## Test plan\n- [ ] `/court` loads with stats bar and docket table\n- [ ] Filter buttons narrow the docket by status\n- [ ] Clicking a case row navigates to `/court/cases/:id`\n- [ ] Case detail shows law title, status, ruling (if resolved), and all justice votes with reasoning\n- [ ] Court appears in top nav and drawer\n- [ ] G+C navigates to `/court`\n- [ ] Bill status label reads 'Passed Legislature' not 'Passed Congress'\n- [ ] Dashboard shows 'Speaker of the Legislature'\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  "head": "feature/judicial-branch",
  "base": "dev"
}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr_court.json | python3 -m json.tool | grep '"number"'
```

**Step 6: Merge feature → dev**

```bash
# Replace PR_NUM with number from step 5
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/PR_NUM/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d '{"Do":"merge","merge_message_field":"Merge feat(court): judicial branch UI + language cleanup"}'
```

**Step 7: PR dev → main + merge**

```bash
cat > /tmp/pr_court_main.json <<'EOF'
{
  "title": "chore: sync dev → main (judicial branch UI)",
  "body": "Syncing dev into main after judicial branch UI merge.",
  "head": "dev",
  "base": "main"
}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr_court_main.json | python3 -m json.tool | grep '"number"'
# Then merge with same curl pattern using new PR number
```

**Step 8: Rebuild production**

```bash
npm run build && pm2 restart agora-bench
```
