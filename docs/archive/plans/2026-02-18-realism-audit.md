# Realism Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace raw DB position-type strings with human-readable labels throughout the UI and remove dead icon map entries.

**Architecture:** Pure frontend display change. Add a shared `POSITION_LABELS` map to two pages, fix one icon map, and correct one sentence in buildings.ts. No backend changes, no schema changes, no new components.

**Tech Stack:** React 18 + TypeScript (Vite). Edit tool only — no new files.

---

## Context

Position types in the DB are snake_case strings: `president`, `congress_member`, `committee_chair`, `supreme_justice`, `lower_justice`, `cabinet_secretary`. Two pages render them raw.

**Branch:** Create `feature/realism-audit` from `dev` before starting.

```bash
git checkout dev && git pull origin dev
git checkout -b feature/realism-audit
```

---

### Task 1: Fix AgentProfilePage.tsx — POSITION_LABELS + subtitle + office

**File:** `src/client/pages/AgentProfilePage.tsx`

**Problem:**
- Line 486: `subtitle: p.type` stores the raw DB string in the career timeline entry (e.g. `congress_member`).
- Line 498: `office: c.positionType` renders as `"Ran for congress_member"` on the Career tab.

**Step 1: Add POSITION_LABELS constant**

Insert after the closing `};` of `ACTIVITY_DOT` (currently ends at line 161), before the `/* ── Helpers */` comment.

Add this block:

```typescript
const POSITION_LABELS: Record<string, string> = {
  president:         'President',
  congress_member:   'Member of the Legislature',
  committee_chair:   'Committee Chair',
  supreme_justice:   'Supreme Court Justice',
  lower_justice:     'Court Justice',
  cabinet_secretary: 'Cabinet Secretary',
};
```

**Step 2: Fix subtitle (line 486)**

Current:
```typescript
      subtitle: p.type,
```

Replace with:
```typescript
      subtitle: POSITION_LABELS[p.type] ?? p.type,
```

**Step 3: Fix office (line 498)**

Current:
```typescript
        office: c.positionType,
```

Replace with:
```typescript
        office: POSITION_LABELS[c.positionType] ?? c.positionType,
```

**Step 4: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors.

**Step 5: Commit**

```bash
git add src/client/pages/AgentProfilePage.tsx
git commit -m "fix(profile): translate raw position types to human labels in career tab"
```

---

### Task 2: Fix AgentsDirectoryPage.tsx — POSITION_LABELS + filter labels + POSITION_ICON

**File:** `src/client/pages/AgentsDirectoryPage.tsx`

**Problems:**
1. `POSITION_ICON` (lines 48–54) has dead entries: `senator`, `representative`, `justice`. Real types are `congress_member`, `supreme_justice`, `lower_justice`, `cabinet_secretary`.
2. Position filter dropdown labels (lines 254–256) use a generic `replace(/_/g, ' ').replace(/\b\w/g, …)` transform, producing "Congress Member" (wrong) and "Supreme Justice" (wrong).

**Step 1: Add POSITION_LABELS constant**

Insert after the closing `};` of `ALIGNMENT_COLORS` (currently line 46), before `const POSITION_ICON`:

```typescript
const POSITION_LABELS: Record<string, string> = {
  president:         'President',
  congress_member:   'Member of the Legislature',
  committee_chair:   'Committee Chair',
  supreme_justice:   'Supreme Court Justice',
  lower_justice:     'Court Justice',
  cabinet_secretary: 'Cabinet Secretary',
};
```

**Step 2: Replace POSITION_ICON (lines 48–54)**

Current:
```typescript
const POSITION_ICON: Record<string, string> = {
  president: '★',
  senator: '◈',
  representative: '◆',
  justice: '§',
  committee_chair: '⊕',
};
```

Replace with:
```typescript
const POSITION_ICON: Record<string, string> = {
  president:         '★',
  congress_member:   '◆',
  committee_chair:   '⊕',
  supreme_justice:   '§',
  lower_justice:     '§',
  cabinet_secretary: '◈',
};
```

**Step 3: Fix position filter label (lines 254–256)**

Current:
```typescript
            ...positionTypes.map((t) => ({
              value: t,
              label: t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            })),
```

Replace with:
```typescript
            ...positionTypes.map((t) => ({
              value: t,
              label: POSITION_LABELS[t] ?? t.replace(/_/g, ' '),
            })),
```

**Step 4: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors.

**Step 5: Commit**

```bash
git add src/client/pages/AgentsDirectoryPage.tsx
git commit -m "fix(directory): correct position filter labels and icon map to real position types"
```

---

### Task 3: Fix buildings.ts + full PR cycle

**Files:**
- `src/client/lib/buildings.ts` — wording fix
- Then: TypeScript check, push branch, PR to dev, merge, PR dev to main, merge, restart servers

**Step 1: Fix wording in buildings.ts (line 78)**

Current:
```typescript
    description: 'The highest court of Agora Bench. 7 justices interpret the constitution.',
```

Replace with:
```typescript
    description: 'The highest court of Agora Bench. 7 justices review constitutional law.',
```

**Step 2: Type-check**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx tsc --noEmit
```

Expected: zero errors.

**Step 3: Commit**

```bash
git add src/client/lib/buildings.ts
git commit -m "fix(buildings): replace vague constitution wording with specific language"
```

**Step 4: Rebase on dev and push**

```bash
git fetch origin dev
git rebase origin/dev
git push -u origin feature/realism-audit
```

**Step 5: PR feature → dev**

```bash
cat > /tmp/pr-realism.json <<'EOF'
{"title":"fix(ui): realism audit — position labels, icon map, buildings wording","body":"Fixes raw DB position-type strings showing in UI.\n\n- Add POSITION_LABELS map to AgentProfilePage + AgentsDirectoryPage\n- Fix career tab subtitle + office to use human-readable labels\n- Remove dead icon entries (senator, representative, justice); add real types\n- Fix position filter dropdown labels\n- Update Supreme Court building description wording","head":"feature/realism-audit","base":"dev"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr-realism.json | python3 -m json.tool | grep '"number"'
```

Note the PR number (call it N).

**Step 6: Merge PR to dev**

```bash
cat > /tmp/merge-realism.json <<'EOF'
{"Do":"merge","merge_message_field":"Merge fix(ui): realism audit — position labels, icon map, buildings wording"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/N/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/merge-realism.json
```

**Step 7: PR dev → main**

```bash
cat > /tmp/pr-dev-main-realism.json <<'EOF'
{"title":"chore: sync dev to main (realism audit)","body":"Syncing dev into main after realism audit display fix.","head":"dev","base":"main"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/pr-dev-main-realism.json | python3 -m json.tool | grep '"number"'
```

Note the new PR number (call it M).

**Step 8: Merge dev → main**

```bash
cat > /tmp/merge-dev-main-realism.json <<'EOF'
{"Do":"merge","merge_message_field":"Merge chore: sync dev to main (realism audit)"}
EOF
curl -s -X POST http://10.0.0.223:3000/api/v1/repos/MyroProductions/Molt-Goverment/pulls/M/merge \
  -H "Content-Type: application/json" \
  -u "MyroProductions:MmisnomerGod_743915" \
  -d @/tmp/merge-dev-main-realism.json
```

**Step 9: Restart servers**

```bash
# Restart Express API via PM2
pm2 restart agora-bench

# Kill and restart Vite dev server
kill $(lsof -ti :5173) 2>/dev/null || true
nohup pnpm run dev:client > /tmp/vite.log 2>&1 &

# Wait a moment, then verify Vite is up
sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
```

Expected: `200`

**Step 10: Verify in browser**

Check:
1. `/agents` directory — position filter dropdown should show "Member of the Legislature", "Supreme Court Justice", etc. (not raw strings)
2. Any agent card with a position — icon should show correctly (◆ for legislature, § for justices, etc.)
3. Any agent profile → Career tab — "Ran for Member of the Legislature" (not "Ran for congress_member")
4. Map → Supreme Court building tooltip — "7 justices review constitutional law"
