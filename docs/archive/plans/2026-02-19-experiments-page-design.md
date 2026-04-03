# Experiments Page Design

**Date:** 2026-02-19
**Status:** Approved

---

## Goal

Add a functional Experiments tab to the admin panel that lets researchers and developers download raw simulation data as CSV files. Covers both research/analysis use cases (notebooks, spreadsheets) and debugging use cases (inspect raw agent behavior).

## Architecture

- **No new route** — implemented entirely within `AdminPage.tsx` as a new tab panel
- **7 export endpoints** added to `src/server/routes/admin.ts`
- **1 counts endpoint** (`GET /admin/export/counts`) returns row counts for all datasets in one round-trip
- CSV generation is done server-side with manual string building (no library)
- Downloads triggered by setting `Content-Disposition: attachment` header

## UI Design

The experiments tab panel contains:
- Header: "Experiments" + subtext "Export raw simulation data as CSV"
- 2-column responsive grid of export cards (1-col on narrow)
- Each card: dataset name, short description, row count badge, Download CSV button
- Button shows spinner + disables while download is in progress

## Datasets (7 cards)

| Card | Tables | Filename | Key columns |
|---|---|---|---|
| Agent Decisions | `agent_decisions` + `agents` | `agent-decisions.csv` | timestamp, agentName, phase, action, reasoning, provider, success, latencyMs |
| Approval Events | `approval_events` + `agents` | `approval-events.csv` | timestamp, agentName, delta, eventType, reason, newTotal |
| Bills | `bills` + `agents` (sponsor) | `bills.csv` | title, sponsorName, status, committee, introducedAt, resolvedAt |
| Bill Votes | `bill_votes` + `agents` + `bills` | `bill-votes.csv` | timestamp, agentName, billTitle, vote |
| Laws | `laws` + `bills` | `laws.csv` | title, enactedAt, isActive, vetoOverridden |
| Elections & Campaigns | `elections` + `campaigns` + `agents` | `elections.csv` | electionTitle, type, status, agentName, votes, result |
| Agent Snapshot | `agents` | `agents-snapshot.csv` | displayName, alignment, modelProvider, model, reputation, balance, approvalRating, isActive |

## Backend

New routes added to `src/server/routes/admin.ts`:

```
GET /admin/export/counts      → { agentDecisions: N, approvalEvents: N, bills: N, ... }
GET /admin/export/agent-decisions  → CSV download
GET /admin/export/approval-events  → CSV download
GET /admin/export/bills            → CSV download
GET /admin/export/bill-votes       → CSV download
GET /admin/export/laws             → CSV download
GET /admin/export/elections        → CSV download
GET /admin/export/agents           → CSV download
```

CSV format: UTF-8, comma-separated, quoted fields for any value that may contain commas/newlines, header row always present, no BOM.

## Client

New `adminApi.exportCounts()` and `adminApi.downloadExport(dataset)` methods in `src/client/lib/api.ts`.

`downloadExport` uses `fetch` + `Blob` + a temporary `<a>` element to trigger browser download (same pattern used across the web for fetch-based downloads).

## Enabling the tab

Remove `isDisabled` guard on the experiments sidebar entry.

## Future (not this session)

- Overview dashboard graphs (approval trends, decision distribution by provider, tick activity) — tracked in backlog
- In-page paginated table preview per dataset
