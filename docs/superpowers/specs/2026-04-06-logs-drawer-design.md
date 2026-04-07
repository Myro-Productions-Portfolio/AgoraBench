# Logs Drawer — Design Spec
**Date:** 2026-04-06
**Status:** Approved

---

## Overview

A collapsible log viewer drawer anchored to the bottom of the admin content area, accessible via a "Logs" button at the bottom of the left sidebar. Displays two live log streams side-by-side with export support.

---

## Trigger / Entry Point

- A new `Logs` nav button is added to the **bottom** of the sidebar, below all existing tabs, separated by a top border
- Icon: `📋` (consistent with sidebar icon style)
- Clicking toggles the drawer open/closed
- When open, the button gets the gold active state (`text-gold bg-gold/5`)
- The button is always visible regardless of sidebar collapsed/expanded state (shows icon only when collapsed)

---

## Drawer Layout

- **Position:** Absolute, bottom of the main content area (inside the flex layout — not a full-page overlay)
- **Height:** 300px fixed
- **Effect:** Content area above compresses upward as drawer opens (flex column)
- **Background:** `#111820` (matches sidebar, `bg-capitol-deep`)
- **Top border:** 2px solid border (`border-border`) with drop shadow above

### Header bar (38px)
Left to right:
- `📋 Logs` title (small uppercase, muted)
- Tab switcher: `Simulation` | `Full` (gold active style)
- Export buttons: `⬇ JSON` and `⬇ CSV` (small, bordered, muted)
- `✕` close button

### Log panes
- Split 50/50 horizontally
- Separator: `4px` solid `#1a2330` (visible but not a harsh line)
- Each pane has a small `SIMULATION` / `FULL` label at the top
- Each pane scrolls independently
- Newest entries scroll into view automatically (auto-scroll, pauses on manual scroll)

---

## Log Streams

### Stream 1 — Simulation
Filtered to `[SIMULATION]`, `[TICK]`, `[PHASE *]`, `[AGGE]`, `[ELECTION]`, `[ECONOMY]` prefixed lines only. These are the meaningful sim events — agent decisions, phase completions, election outcomes, economic shifts.

### Stream 2 — Full
All server output: `[HTTP]`, `[DB]`, `[AI]`, `[CONFIG]`, `[QUEUE]`, `[WS]`, `[AUTH]`, plus everything in the simulation stream. Unfiltered firehose for deep debugging.

### Log Line Format
```
[HH:MM:SS]  [TAG]  message text
```
- Timestamp: `#7a8fa3` (medium blue-gray, readable)
- Tag: same color as line, opacity 0.85
- **Alternating line colors:** even = `#c9c5b4` (tan-white), odd = `#c9a84c` (gold)
- Font: monospace, 12px, line-height 1.6

---

## Real-Time Delivery

The server already has a WebSocket at `/ws` with a `broadcast()` function used throughout `agentTick.ts`. Log delivery uses the same WebSocket:

1. **Server:** Intercept `console.warn` (the project's logging convention) and broadcast a new `log:entry` WS event with `{ level, tag, message, timestamp, stream: 'simulation' | 'full' }`
2. **Client:** Subscribe to `log:entry` events on the existing WS connection used by the rest of the admin UI
3. **Buffering:** Keep last 500 entries per stream in memory on the client (ring buffer). No persistence — logs are live only.
4. **Auto-scroll:** Scroll to bottom on new entry unless user has scrolled up manually. Resume auto-scroll when user scrolls back to bottom.

---

## Export

When the user clicks `⬇ JSON` or `⬇ CSV`:
- Export the **currently visible stream** (whichever tab is active: Simulation or Full)
- Include all buffered entries (up to 500)
- **JSON:** Array of `{ timestamp, tag, message }` objects, downloaded as `agorabench-logs-simulation-<date>.json`
- **CSV:** Columns: `timestamp, tag, message`, downloaded as `agorabench-logs-simulation-<date>.csv`
- Export is client-side only (no server endpoint needed)

---

## State

```ts
type LogEntry = {
  timestamp: string;   // ISO
  tag: string;         // e.g. "[PHASE 3]"
  message: string;
  stream: 'simulation' | 'full';
};

// Client state
logEntries: LogEntry[]          // ring buffer, max 500
activeLogTab: 'simulation' | 'full'
logsDrawerOpen: boolean
```

---

## Server Changes

- Add a `broadcastLog(tag: string, message: string)` helper in `websocket.ts` that broadcasts a `log:entry` event
- Patch `console.warn` at server startup to intercept all output, parse the `[TAG]` prefix, classify as simulation vs full, and call `broadcastLog`
- Simulation tags: `SIMULATION`, `TICK`, `PHASE`, `AGGE`, `ELECTION`, `ECONOMY`
- All other tags: full only

---

## Files to Change

| File | Change |
|------|--------|
| `src/core/server/websocket.ts` | Add `broadcastLog()`, patch `console.warn` |
| `src/modules/admin/server/routes/admin.ts` | No change needed |
| `src/modules/admin/client/pages/AdminPage.tsx` | Add `logsDrawerOpen` state, Logs sidebar button, LogsDrawer component |
| `src/shared/constants.ts` | Add `log:entry` to WS_EVENTS |

The drawer UI lives in `AdminPage.tsx` as a local component (`LogsDrawer`) — no separate file needed given the existing pattern of the file.

---

## Out of Scope

- Log persistence to DB
- Log filtering/search UI (future)
- Log level indicators (future)
- Resizable drawer height (future)
