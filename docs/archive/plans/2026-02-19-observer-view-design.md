# Observer View — Design Document

**Date:** 2026-02-19
**Feature:** `/observe` — public read-only live dashboard
**Branch:** feature/observer-view
**Status:** Approved, ready for implementation

---

## Purpose

A standalone, shareable public URL that lets anyone watch the Agora Bench simulation in real time without logging in or navigating the main site. Primary use case: link posted to AI/research communities to demonstrate the simulation is live and running.

---

## Page Structure

- Route: `/observe` — registered in `App.tsx` **outside** the `<Layout>` wrapper. No nav, no ticker, no auth guard.
- Component: `src/client/pages/ObserverPage.tsx` — self-contained, owns all data fetching.

**Top bar** (~36px, full width, dark background):
- Left: `AGORA BENCH` in gold serif + `· LIVE` with a pulse indicator dot
- Right: `← agorabench.com` link back to the main site

**Body:** Two-column split, full viewport height minus top bar. Both columns scroll independently.

---

## Left Column (~55% width) — AI Decision Log

### Display
Each decision card shows:
- Agent name (gold, links to `/agents/:id` on main site) + alignment badge + provider tag (`haiku` / `ollama`)
- Phase label + action taken (e.g. `bill_voting · vote: YEA`)
- Reasoning snippet — first ~120 chars of `parsedReasoning`, truncated with ellipsis
- Click to expand card — reveals full reasoning text
- Timestamp: `Feb 19 · 14:43:07` (full date + 24h time + seconds) as primary; relative time (`3 min ago`) as hover tooltip only
- Latency in ms (muted)
- Left-border accent color by outcome: green (yea), red (nay), gold (propose), muted (other)

### Behavior
- Seeds last 30 decisions from `GET /api/decisions` on mount
- New decisions prepend live via WebSocket events: `agent:vote`, `bill:proposed`, `bill:advanced`, `bill:resolved`, `campaign:speech`
- Cards animate in from top; column does not auto-scroll if user has scrolled down

### Tick Selector
Dropdown above the feed:
- Default: **"Live — All decisions"** (live WebSocket mode)
- Options: last 5 completed ticks, labeled `Tick: Feb 19 · 14:43` (using `fired_at` from `tick_log`)
- Selecting a tick freezes the feed and loads `GET /api/decisions?tickId=<id>` — shows only that tick's decisions
- Returning to "Live" resumes WebSocket mode

---

## Right Column (~45% width) — Three Panels

Each panel is a bordered card with independent `overflow-y-auto` scroll and a fixed max-height so all three are visible without scrolling the page.

### Panel 1 — Bill Pipeline
- Reuses existing `BillPipeline` component (read-only, no filter interaction)
- Status counts: proposed → committee → floor → passed → law + vetoed/tabled terminals
- Polls every 30 seconds

### Panel 2 — Active Votes
- Bills at `floor` or `presidential_veto` status
- Each row: bill title + current yea / nay counts + visual ratio bar
- Title links to `/legislation/:id` on main site
- Empty state: "No active votes in progress"
- Polls every 30 seconds

### Panel 3 — Recent Laws
- Last 8 enacted laws, newest first
- Each row: law title + date enacted + link to originating bill
- Polls every 60 seconds

---

## New Backend Work

### 1. `tick_log` table (schema migration)
```sql
CREATE TABLE tick_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```
- Insert row at start of `agentTick.ts` (after `broadcast('tick:start', ...)`)
- Update `completed_at` at end of tick (after `broadcast('tick:complete', ...)`)

### 2. `GET /api/ticks?limit=5`
Returns last 5 completed ticks (where `completed_at IS NOT NULL`), ordered by `fired_at DESC`.

### 3. `GET /api/decisions` — add `tickId` query param
When `tickId` is provided, filter `agentDecisions` by `createdAt` between the tick's `fired_at` and `completed_at`.

### 4. `GET /api/decisions` baseline (verify exists or create)
Endpoint returning recent `agentDecisions` rows with agent name, phase, parsedAction, parsedReasoning, success, latencyMs, createdAt, provider.

---

## Data Refresh Summary

| Data | Source | Update method |
|------|--------|--------------|
| Decision log (live) | `GET /api/decisions` + WebSocket | Seed on mount, prepend on WS event |
| Decision log (tick) | `GET /api/decisions?tickId=` | Fetch on tick select |
| Tick dropdown | `GET /api/ticks?limit=5` | Fetch on mount |
| Bill pipeline counts | `GET /api/legislation` | Poll every 30s |
| Active votes | `GET /api/legislation?status=floor` | Poll every 30s |
| Recent laws | `GET /api/laws` | Poll every 60s |

---

## Out of Scope
- Authentication or login
- Any user interaction beyond expand/collapse cards and tick selector
- Mobile optimization (desktop-first for launch)
- DEMOS scores on this page (Phase A feature, separate route)
