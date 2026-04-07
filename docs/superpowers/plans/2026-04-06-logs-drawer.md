# Logs Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible live-log drawer to the admin panel, split into Simulation and Full streams, with JSON/CSV export.

**Architecture:** The server intercepts `console.warn` at startup, classifies log entries by tag into simulation vs full streams, and broadcasts them over the existing WebSocket as `log:entry` events. The client buffers the last 500 entries per stream and renders them in a 300px drawer that slides up from the bottom of the admin content area.

**Tech Stack:** TypeScript, React, Tailwind CSS, WebSocket (existing `/ws` singleton), client-side file download (no new server endpoints for export)

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `src/core/shared/constants.ts` | Modify | Add `LOG_ENTRY: 'log:entry'` to `WS_EVENTS` |
| `src/core/server/websocket.ts` | Modify | Add `broadcastLog()`, patch `console.warn` at module level |
| `src/modules/admin/client/pages/AdminPage.tsx` | Modify | Add `LogEntry` type, state, `LogsDrawer` component, Logs sidebar button |

---

## Task 1: Add `log:entry` to WS_EVENTS

**Files:**
- Modify: `src/core/shared/constants.ts`

- [ ] **Step 1: Add the constant**

Open `src/core/shared/constants.ts`. Find the `WS_EVENTS` object (ends at `BENCHMARK_FAILED`). Add one line:

```ts
export const WS_EVENTS = {
  // ... existing entries ...
  BENCHMARK_FAILED: 'benchmark:failed',
  LOG_ENTRY: 'log:entry',              // add this
} as const;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/shared/constants.ts
git commit -m "feat(logs): add LOG_ENTRY to WS_EVENTS"
```

---

## Task 2: Server — `broadcastLog()` and `console.warn` intercept

**Files:**
- Modify: `src/core/server/websocket.ts`

The server uses `console.warn` for all structured logging. We intercept it at module load time, parse the `[TAG]` prefix, classify the stream, and broadcast.

Simulation stream tags: `SIMULATION`, `TICK`, `PHASE`, `AGGE`, `ELECTION`, `ECONOMY`
All other tags: full stream only. Simulation entries appear in both streams on the client.

- [ ] **Step 1: Add `broadcastLog` and the intercept to `websocket.ts`**

Add the following block at the **bottom** of `src/core/server/websocket.ts`, after the existing `broadcast()` function:

```ts
/* ── Log broadcasting ──────────────────────────────────────────────────── */

const SIM_TAG_RE = /^\[(SIMULATION|TICK|PHASE|AGGE|ELECTION|ECONOMY)/i;
const TAG_RE = /^\[([^\]]+)\]\s*/;

export function broadcastLog(tag: string, message: string): void {
  if (!wss || wss.clients.size === 0) return;
  const stream: 'simulation' | 'full' = SIM_TAG_RE.test(`[${tag}]`) ? 'simulation' : 'full';
  broadcast(WS_EVENTS.LOG_ENTRY, {
    tag: `[${tag}]`,
    message,
    stream,
    timestamp: new Date().toISOString(),
  });
}

/* Intercept console.warn (the project's logging convention) once at startup */
const _originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  _originalWarn(...args);
  const raw = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  const match = TAG_RE.exec(raw);
  if (match) {
    const tag = match[1];
    const msg = raw.slice(match[0].length);
    broadcastLog(tag, msg);
  }
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/server/websocket.ts
git commit -m "feat(logs): add broadcastLog and console.warn intercept"
```

---

## Task 3: Client — `LogEntry` type, state, and WS subscription

**Files:**
- Modify: `src/modules/admin/client/pages/AdminPage.tsx`

- [ ] **Step 1: Add `LogEntry` type and buffer constant near top of file**

Find the existing type declarations near the top of `AdminPage.tsx` (around line 8–170). Add after the last type block:

```ts
type LogEntry = {
  tag: string;        // e.g. "[PHASE 3]"
  message: string;
  stream: 'simulation' | 'full';
  timestamp: string;  // ISO string
};

const LOG_BUFFER_MAX = 500;
```

- [ ] **Step 2: Add state inside `AdminPage` component**

Find where `useState` declarations live (around line 388–430). Add:

```ts
const [logsDrawerOpen, setLogsDrawerOpen] = useState(false);
const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
const [activeLogTab, setActiveLogTab] = useState<'simulation' | 'full'>('simulation');
```

- [ ] **Step 3: Subscribe to `log:entry` WS events**

Find the `useEffect` block that sets up WS subscriptions (the one containing `subscribe('tick:phase', ...)`). Add a new subscription to the same array:

```ts
subscribe('log:entry', (data: unknown) => {
  const entry = data as LogEntry;
  setLogEntries((prev) => {
    const next = [...prev, entry];
    return next.length > LOG_BUFFER_MAX ? next.slice(next.length - LOG_BUFFER_MAX) : next;
  });
}),
```

The existing cleanup (`unsubs.forEach((fn) => fn())`) handles unsubscription automatically.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/client/pages/AdminPage.tsx
git commit -m "feat(logs): add LogEntry type, state, and WS subscription"
```

---

## Task 4: Client — `LogsDrawer` component

**Files:**
- Modify: `src/modules/admin/client/pages/AdminPage.tsx`

Add this component just before the `export default function AdminPage()` line.

- [ ] **Step 1: Add the `LogsDrawer` component**

```tsx
function LogsDrawer({
  entries,
  activeTab,
  onTabChange,
  onClose,
}: {
  entries: LogEntry[];
  activeTab: 'simulation' | 'full';
  onTabChange: (tab: 'simulation' | 'full') => void;
  onClose: () => void;
}) {
  const simRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLDivElement>(null);
  const simAutoScroll = useRef(true);
  const fullAutoScroll = useRef(true);

  const simEntries = entries.filter((e) => e.stream === 'simulation');
  const fullEntries = entries;

  useEffect(() => {
    if (simAutoScroll.current && simRef.current) {
      simRef.current.scrollTop = simRef.current.scrollHeight;
    }
  }, [simEntries.length]);

  useEffect(() => {
    if (fullAutoScroll.current && fullRef.current) {
      fullRef.current.scrollTop = fullRef.current.scrollHeight;
    }
  }, [fullEntries.length]);

  function handleScroll(
    ref: React.RefObject<HTMLDivElement>,
    autoRef: React.MutableRefObject<boolean>,
  ) {
    const el = ref.current;
    if (!el) return;
    autoRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  }

  function exportLogs(format: 'json' | 'csv') {
    const data = activeTab === 'simulation' ? simEntries : fullEntries;
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `agorabench-logs-${activeTab}-${dateStr}`;
    const rows = data.map(({ tag, message, timestamp }) => ({ timestamp, tag, message }));

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.json`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const header = 'timestamp,tag,message';
      const lines = rows.map((r) => `${r.timestamp},${r.tag},${r.message.replace(/,/g, ' ')}`);
      const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.csv`; a.click();
      URL.revokeObjectURL(url);
    }
  }

  const lineClass = (i: number) =>
    i % 2 === 0 ? 'text-text-primary' : 'text-gold';

  const renderPane = (
    paneEntries: LogEntry[],
    label: string,
    ref: React.RefObject<HTMLDivElement>,
    autoRef: React.MutableRefObject<boolean>,
  ) => (
    <div
      ref={ref}
      onScroll={() => handleScroll(ref, autoRef)}
      className="flex-1 overflow-y-auto py-2 min-w-0"
    >
      <div className="px-3 pb-1.5 text-[10px] uppercase tracking-widest text-text-muted/60">
        {label}
      </div>
      {paneEntries.map((entry, i) => (
        <div
          key={i}
          className={`px-3 py-0.5 text-xs font-mono leading-relaxed whitespace-nowrap overflow-hidden text-ellipsis ${lineClass(i)}`}
        >
          <span className="text-[#7a8fa3] text-[10px] mr-2">
            {entry.timestamp.slice(11, 19)}
          </span>
          <span className="mr-1.5 opacity-80">{entry.tag}</span>
          {entry.message}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex-shrink-0 h-[300px] flex flex-col border-t-2 border-border bg-capitol-deep shadow-[0_-8px_32px_rgba(0,0,0,0.5)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 h-[38px] border-b border-border flex-shrink-0">
        <span className="text-badge text-text-muted uppercase tracking-widest flex-1">
          📋 Logs
        </span>

        <div className="flex gap-1">
          {(['simulation', 'full'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={`px-2.5 py-0.5 text-badge uppercase tracking-wider rounded border transition-colors ${
                activeTab === tab
                  ? 'bg-gold/10 border-gold/40 text-gold'
                  : 'border-border text-text-muted hover:text-text-primary'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {(['json', 'csv'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => exportLogs(fmt)}
              className="px-2.5 py-0.5 text-badge uppercase tracking-wider rounded border border-border text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
            >
              ↓ {fmt.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Split panes */}
      <div className="flex flex-1 overflow-hidden">
        {renderPane(simEntries, 'Simulation', simRef, simAutoScroll)}
        <div className="w-1 flex-shrink-0 bg-[#1a2330]" />
        {renderPane(fullEntries, 'Full', fullRef, fullAutoScroll)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/admin/client/pages/AdminPage.tsx
git commit -m "feat(logs): add LogsDrawer component"
```

---

## Task 5: Wire drawer into AdminPage layout

**Files:**
- Modify: `src/modules/admin/client/pages/AdminPage.tsx`

- [ ] **Step 1: Add Logs button to sidebar bottom**

Find the closing `</div>` of the sidebar element — the one wrapping the nav items list. Just before that closing tag, add:

```tsx
{/* Logs toggle */}
<div className="border-t border-border">
  <button
    onClick={() => setLogsDrawerOpen((v) => !v)}
    title={sidebarOpen ? undefined : 'Logs'}
    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
      logsDrawerOpen
        ? 'text-gold bg-gold/5'
        : 'text-text-muted hover:text-text-primary'
    }`}
  >
    <span className="text-base flex-shrink-0">📋</span>
    {sidebarOpen && <span className="flex-1 text-left">Logs</span>}
  </button>
</div>
```

- [ ] **Step 2: Render `LogsDrawer` in the main content column**

Find the main content flex column — the `<div>` that wraps all the `{activeTab === '...' && ...}` tab panels. It is a `flex flex-col` container. Add `LogsDrawer` as the **last child** of that container, after all the tab panels:

```tsx
{logsDrawerOpen && (
  <LogsDrawer
    entries={logEntries}
    activeTab={activeLogTab}
    onTabChange={setActiveLogTab}
    onClose={() => setLogsDrawerOpen(false)}
  />
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Build**

```bash
pnpm build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/client/pages/AdminPage.tsx
git commit -m "feat(logs): wire LogsDrawer into AdminPage sidebar and layout"
```

---

## Task 6: Smoke test and deploy

- [ ] **Step 1: Restart server on Linux box**

```bash
ssh myroproductions@10.0.0.10 "kill \$(lsof -ti:3001) 2>/dev/null; kill \$(lsof -ti:5173) 2>/dev/null; sleep 2; cd /home/myroproductions/Projects/Molt-Government && git pull && nohup pnpm dev:local > /tmp/molt-gov.log 2>&1 &"
```

- [ ] **Step 2: Open admin panel at agorabench.com/admin, click Logs**

Verify:
- Logs button appears at bottom of left sidebar with 📋 icon
- Button collapses to icon-only when sidebar is collapsed
- Clicking opens 300px drawer from bottom
- Two panes visible with divider between them

- [ ] **Step 3: Trigger a tick and watch logs appear**

Admin → Simulation tab → Tick button. Watch the Full pane — `[HTTP]`, `[AI]`, `[SIMULATION]` entries should appear live with alternating tan/gold line colors. The Simulation pane shows only sim-tagged entries.

- [ ] **Step 4: Test export**

Click `↓ JSON` — JSON file should download. Click `↓ CSV` — CSV file should download. Both should contain the currently buffered entries for the active tab.

- [ ] **Step 5: Deploy to production**

```bash
ssh myroproductions@10.0.0.10 "cd /home/myroproductions/Projects/Molt-Government && pnpm run deploy > /tmp/molt-gov-deploy.log 2>&1 &"
```

Check after 30s:
```bash
ssh myroproductions@10.0.0.10 "tail -20 /tmp/molt-gov-deploy.log"
```

- [ ] **Step 6: Mark Forge task done**

```bash
forge add "Add logs drawer to admin panel" --tag feat
forge done "Add logs drawer"
```

---

## Self-Review

- Spec: tabs switch export target → implemented via `activeTab` picking `simEntries` vs `fullEntries`
- Spec: auto-scroll pauses on manual scroll, resumes at bottom → implemented via `handleScroll` + `< 8px` threshold
- Spec: simulation entries appear in both panes → `fullEntries = entries` (all), `simEntries = entries.filter(e => e.stream === 'simulation')`
- Spec: 4px separator → `w-1` (4px) `bg-[#1a2330]`
- Spec: timestamp color `#7a8fa3` → matches approved mockup v2
- Spec: button works in collapsed sidebar → `title` prop for tooltip, icon-only when `!sidebarOpen`
