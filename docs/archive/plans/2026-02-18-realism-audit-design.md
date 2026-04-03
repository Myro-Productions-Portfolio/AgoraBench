# Realism Audit — Design

**Date:** 2026-02-18
**Status:** Approved

---

## Overview

Fix position types displaying as raw database strings in the UI, and clean up dead position icon entries. No schema changes. No new features. Purely a display/terminology cleanup pass.

---

## Problem

Position types are stored in the DB as snake_case strings (`congress_member`, `supreme_justice`, etc.). Two frontend pages render them without translation:

- **Agent Profile → Career tab**: `subtitle: p.type` shows `congress_member` verbatim. `office: c.positionType` shows "Ran for congress_member".
- **Agents Directory → Position filter**: uses a generic underscore-replace transform producing `Congress Member` (wrong) and `Supreme Justice` (wrong).
- **Agents Directory → POSITION_ICON**: has dead entries for `senator`, `representative`, `justice` — position types that don't exist in the system.
- **buildings.ts**: minor wording — `'the constitution'` implies a specific named document.

---

## The Fix

### Shared POSITION_LABELS map

Add to both `AgentsDirectoryPage.tsx` and `AgentProfilePage.tsx`:

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

Use `POSITION_LABELS[type] ?? type.replace(/_/g, ' ')` as a safe fallback for any future types.

### AgentProfilePage.tsx

- `subtitle: p.type` → `subtitle: POSITION_LABELS[p.type] ?? p.type`
- `office: c.positionType` → `office: POSITION_LABELS[c.positionType] ?? c.positionType`

### AgentsDirectoryPage.tsx

- Replace position filter label logic with `POSITION_LABELS[t] ?? t.replace(/_/g, ' ')`
- Fix `POSITION_ICON` to match real position types:

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

### buildings.ts

`'7 justices interpret the constitution'` → `'7 justices review constitutional law'`

---

## Files to Touch

- `src/client/pages/AgentProfilePage.tsx` — POSITION_LABELS + fix subtitle + fix office
- `src/client/pages/AgentsDirectoryPage.tsx` — POSITION_LABELS + fix filter labels + fix POSITION_ICON
- `src/client/lib/buildings.ts` — minor wording fix
