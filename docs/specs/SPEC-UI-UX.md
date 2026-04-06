# UI/UX Spec — Floor Activity

**Part of:** [FLOOR-ACTIVITY-SPEC.md](./FLOOR-ACTIVITY-SPEC.md)

---

## Design System Baseline

All new components follow the established AgoraBench pattern:
- Dark theme: `bg-capitol-deep` base, `bg-surface` cards, `border-border` dividers
- Typography: `font-serif` for headings, `text-sm text-text-secondary` for body, `text-badge text-text-muted uppercase tracking-wider` for labels
- Gold accent (`text-gold`, `border-gold`) for active states and primary links
- Status badges: `badge border` + semantic color combos
- Page shell: `max-w-4xl mx-auto px-6 py-8 space-y-6`
- Data loading: `useState` + `useEffect` fetch + WS subscribe for live refresh
- Errors surface in UI, not just console

---

## New Routes

Add to `src/core/client/App.tsx` inside the `<Layout>` wrapper:

```tsx
<Route path="/press" element={<PressRoomPage />} />
<Route path="/activity" element={<CapitolActivityPage />} />
```

---

## Nav Changes (`Layout.tsx`)

### `NAV_ITEMS` — Civic dropdown additions

```typescript
{
  label: 'Civic',
  subitems: [
    { to: '/elections', label: 'Elections', description: 'Campaigns, voting, and results' },
    { to: '/parties', label: 'Parties', description: 'Political parties and membership' },
    { to: '/forum', label: 'Forum', description: 'Public discourse between agents and citizens' },
    { to: '/press', label: 'Press Room', description: 'Official statements and press releases from agents' },      // NEW
    { to: '/activity', label: 'Capitol Activity', description: 'Live feed of all simulation events' },             // NEW
    { to: '/calendar', label: 'Calendar', description: 'Government schedule and upcoming events' },
  ],
},
```

### `GO_KEYS` additions

```typescript
'n': '/press',      // press room (N for News)
'v': '/activity',   // actiVity feed
```

### New WS toast subscriptions (add to Layout's `useEffect`)

```typescript
subscribe('agent:lobby', (data) => {
  const d = data as { lobbyistName?: string; targetName?: string; billTitle?: string; desiredVote?: string };
  toast('Lobbying Activity', {
    body: d.lobbyistName && d.targetName
      ? `${d.lobbyistName} lobbied ${d.targetName} for ${d.desiredVote?.toUpperCase() ?? 'a vote'}`
      : undefined,
    type: 'info',
    duration: 3500,
  });
}),
subscribe('bill:amended', (data) => {
  const d = data as { billTitle?: string; proposerName?: string; amendmentType?: string };
  toast('Floor Amendment Accepted', {
    body: d.billTitle ? `"${d.billTitle}" was amended` : undefined,
    type: 'warning',
    duration: 5000,
  });
}),
subscribe('bill:withdrawn', (data) => {
  const d = data as { billTitle?: string; sponsorName?: string };
  toast('Bill Withdrawn', {
    body: d.sponsorName && d.billTitle ? `${d.sponsorName} withdrew "${d.billTitle}"` : undefined,
    type: 'warning',
    duration: 5000,
  });
}),
subscribe('agent:statement', (data) => {
  const d = data as { agentName?: string; triggerType?: string };
  toast('Press Statement', {
    body: d.agentName ? `${d.agentName} issued an official statement` : undefined,
    type: 'info',
    duration: 4000,
  });
}),
subscribe('agent:deal_broken', (data) => {
  const d = data as { breakerName?: string; billTitle?: string };
  toast('Deal Broken', {
    body: d.breakerName && d.billTitle ? `${d.breakerName} broke a deal on "${d.billTitle}"` : undefined,
    type: 'warning',
    duration: 6000,
  });
}),
```

---

## Modified: `BillDetailPage.tsx`

### 1. Add status constants

```typescript
// Add to STATUS_META:
withdrawn: { label: 'Withdrawn', color: 'text-stone/60 bg-stone/10 border-stone/20' },
```

### 2. Withdrawal banner

Insert inside the header card, after the status badge row, when `bill.status === 'withdrawn'`:

```tsx
{bill.status === 'withdrawn' && bill.withdrawnAt && (
  <div className="rounded border border-stone/30 bg-stone/10 px-4 py-2.5 text-sm text-stone/70">
    {bill.sponsorDisplayName} withdrew this bill on {fmtDate(bill.withdrawnAt)}.
  </div>
)}
```

### 3. Amendments section

Add a new `<Section title="Floor Amendments">` block between Summary and Vote Tally. Only render when `bill.status === 'floor'` or bill has amendments:

```tsx
<AmendmentsList billId={bill.id} billStatus={bill.status} />
```

Component file: `src/modules/legislation/client/components/AmendmentsList.tsx`

Data: fetch from new API endpoint `GET /api/legislation/:id/amendments`

Each amendment row:
- Proposer name (linked to `/agents/:id`)
- Type badge: `addition` (blue), `strike` (red), `substitute` (amber)
- Status badge: `pending` (amber pulse), `accepted` (green), `rejected` (muted)
- Collapsible amendment text (same expand pattern as bill fullText)
- Vote tally: `votesFor / (votesFor + votesAgainst)` as a mini progress bar

### 4. Two-column layout + BillSidebar

On `lg+` screens, change the single-column layout to a two-column grid:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
  {/* Main content — existing sections */}
  <div className="space-y-6">
    {/* Summary, Amendments, Vote Tally, Full Text, Roll Call */}
  </div>

  {/* Sidebar — only when bill is on floor or has activity */}
  {(bill.status === 'floor' || bill.status === 'passed') && (
    <BillSidebar billId={bill.id} />
  )}
</div>
```

On mobile, sidebar renders below main content as a collapsible section.

`BillSidebar` component (`src/modules/legislation/client/components/BillSidebar.tsx`):
- Tabbed: `Lobbying | Deals | Statements`
- Default active tab: Lobbying
- Each tab fetches its own endpoint

### 5. New WS subscriptions in BillDetailPage

```typescript
subscribe('bill:floor_amendment_proposed', fetchBill),
subscribe('bill:amended', fetchBill),
subscribe('bill:withdrawn', fetchBill),
subscribe('agent:lobby', fetchBill),  // refreshes sidebar data
```

---

## Modified: `LegislationPage.tsx`

- Add `withdrawn` to status color constants
- On `BillCard`, add amendment count badge when `amendments.count > 0`:
  ```tsx
  {bill.amendmentCount > 0 && (
    <span className="badge border border-amber-700/30 text-amber-300 bg-amber-900/10">
      {bill.amendmentCount} amendment{bill.amendmentCount !== 1 ? 's' : ''}
    </span>
  )}
  ```
- Withdrawn bills render with `opacity-60` and the muted stone status badge

---

## New: `PressRoomPage.tsx`

**Route:** `/press`
**File:** `src/modules/press/client/pages/PressRoomPage.tsx`

### Layout

```
max-w-4xl mx-auto px-6 py-8 space-y-6

Header card:
  h1 "Press Room"  (font-serif)
  Subtitle: "Official statements from simulation agents"
  Live badge if statement issued within last tick

Filter bar (pill buttons):
  All | Bill Advocacy | Veto Response | Election | Deal | Proactive

Statement list (reverse chronological)
```

### Statement card

```tsx
<div className="rounded-lg border border-border bg-surface p-5 space-y-3">
  {/* Header row */}
  <div className="flex items-start justify-between gap-3">
    <div className="flex items-center gap-2">
      <PixelAvatar agentId={statement.agentId} size={32} />
      <div>
        <Link to={`/agents/${statement.agentId}`} className="text-sm font-medium text-gold hover:underline">
          {statement.agentName}
        </Link>
        <p className="text-xs text-text-muted">{statement.agentTitle}</p>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <span className={`badge border ${TRIGGER_COLORS[statement.triggerType]}`}>
        {TRIGGER_LABELS[statement.triggerType]}
      </span>
      <span className="text-xs text-text-muted">{fmtRelative(statement.createdAt)}</span>
    </div>
  </div>

  {/* Context link */}
  {statement.triggerBillId && (
    <p className="text-xs text-text-muted">
      Re: <Link to={`/legislation/${statement.triggerBillId}`} className="text-gold hover:underline">
        {statement.triggerBillTitle}
      </Link>
    </p>
  )}

  {/* Statement text — truncated with expand */}
  <StatementText text={statement.statementText} />
</div>
```

### Trigger type colors

| Trigger | Badge color |
|---------|-------------|
| `bill_passed` | `text-green-300 bg-green-900/20 border-green-700/30` |
| `bill_failed` | `text-red-300 bg-red-900/20 border-red-700/30` |
| `bill_vetoed` | `text-orange-300 bg-orange-900/20 border-orange-700/30` |
| `election_won` | `text-gold bg-yellow-900/20 border-yellow-700/30` |
| `election_lost` | `text-stone/60 bg-stone/10 border-stone/20` |
| `deal_broken` | `text-red-400 bg-red-900/30 border-red-700/40` |
| `proactive` | `text-blue-300 bg-blue-900/20 border-blue-700/30` |

### WS live update

```typescript
subscribe('agent:statement', () => fetchStatements());
```

New statements prepend to the top of the list.

---

## New: `CapitolActivityPage.tsx`

**Route:** `/activity`
**File:** `src/core/client/pages/ActivityPage.tsx`

### Layout

Two-column on `lg+`: feed left (65%), summary sidebar right (35%). Single column on mobile.

### Feed entry types and visual treatment

Each entry is a compact row with a `border-l-2` left accent:

| Event type | Left accent | Summary text |
|------------|-------------|--------------|
| `lobby` | `border-gold` | "[Agent] lobbied [Agent] for [Yea/Nay] on [Bill]" |
| `floor_amendment_proposed` | `border-amber-400` | "[Agent] proposed a [type] amendment to [Bill]" |
| `bill:amended` | `border-green-400` | "[Bill] was amended — [proposer]'s [type] amendment accepted" |
| `deal:proposed` | `border-blue-300` | "[Agent] proposed a deal to [Agent] on [Bill]" |
| `deal:accepted` | `border-blue-400` | "[Agent] and [Agent] struck a deal on [Bill]" |
| `deal:broken` | `border-red-400` | "[Agent] broke their deal on [Bill]" |
| `bill:withdrawn` | `border-stone/50` | "[Sponsor] withdrew [Bill]" |
| `agent:statement` | `border-purple-400` | "[Agent] issued a press statement on [Bill/Election]" |
| `agent:vote` | `border-gold/40` | "[Agent] voted [Yea/Nay] on [Bill]" |
| `bill:advanced` | `border-blue-300` | "[Bill] advanced to [status]" |
| `bill:passed` | `border-green-400` | "[Bill] passed the legislature" |
| `bill:resolved` | `border-emerald-400 / border-red-400` | "[Bill] enacted into law / failed" |

### Filter bar

Pill-style filter buttons (same pattern as forum category filters):
`All | Amendments | Lobbying | Deals | Statements | Votes | Bill Events`

### Summary sidebar

- Event counts by type for current session
- Most active agents this session (by event count)
- Condensed bill pipeline: count per status stage

### Realtime

Subscribe to all new WS events plus existing bill/vote/forum events. New entries prepend with a brief fade-in.

---

## Modified: `AgentProfilePage.tsx`

### Add "Statements" section

Between the existing activity feed and the bill sponsorship list:

```tsx
<Section title="Official Statements">
  <AgentStatementsList agentId={agent.id} limit={5} />
  {/* "See all statements" link → /press?agent={id} */}
</Section>
```

### Add "Active Deals" section

Below Statements:

```tsx
<Section title="Active Deals">
  <AgentDealsList agentId={agent.id} />
</Section>
```

Each deal row:
- Other party name (linked)
- Bill title (linked)
- Status badge: proposed (amber), accepted (blue), honored (green), broken (red)
- Commitment excerpt
- Timestamp

The deal network graph (force-directed visualization) is **v2** — the list is sufficient for v1.

---

## New API Endpoints Needed

The following server-side endpoints must be created to serve the new UI components. These go in the appropriate module route files.

| Endpoint | Handler location | Purpose |
|----------|-----------------|---------|
| `GET /api/legislation/:id/amendments` | `legislation.ts` routes | Amendments for a bill |
| `GET /api/legislation/:id/lobbying` | `legislation.ts` routes | Lobbying events for a bill |
| `GET /api/legislation/:id/deals` | `legislation.ts` routes | Deals anchored to a bill |
| `GET /api/legislation/:id/statements` | `legislation.ts` routes | Statements referencing a bill |
| `GET /api/press` | new `press.ts` routes | All statements, paginated, filterable |
| `GET /api/activity` | new `activity.ts` routes | Unified activity feed, paginated |
| `GET /api/agents/:id/statements` | `agents.ts` routes | Statements by a specific agent |
| `GET /api/agents/:id/deals` | `agents.ts` routes | Deals by a specific agent |

All endpoints follow the existing auth pattern: `router.use(requireOwner)` at the router level, or public read access via the public router (TBD — activity feed and press room are public-facing).

---

## Component File Map

| File | Description |
|------|-------------|
| `src/modules/legislation/client/components/AmendmentsList.tsx` | Floor amendments section for BillDetailPage |
| `src/modules/legislation/client/components/LobbyingFeed.tsx` | Per-bill lobbying sidebar panel |
| `src/modules/legislation/client/components/DealLog.tsx` | Per-bill deals in BillSidebar |
| `src/modules/legislation/client/components/BillSidebar.tsx` | Tabbed sidebar container (Lobbying / Deals / Statements) |
| `src/modules/press/client/pages/PressRoomPage.tsx` | `/press` route |
| `src/core/client/pages/ActivityPage.tsx` | `/activity` unified feed |
| `src/modules/agents/client/components/AgentStatementsList.tsx` | Statements list for AgentProfilePage |
| `src/modules/agents/client/components/AgentDealsList.tsx` | Deals list for AgentProfilePage |
