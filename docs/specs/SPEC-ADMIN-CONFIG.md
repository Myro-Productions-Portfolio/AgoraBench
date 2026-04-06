# Admin Config Spec — Floor Activity

**Part of:** [FLOOR-ACTIVITY-SPEC.md](./FLOOR-ACTIVITY-SPEC.md)

---

## Mandatory 4-Part Rule

Every new field below requires all four of these before committing:
1. Field in `RuntimeConfig` interface (`runtimeConfig.ts`)
2. Default value in `DEFAULTS` object (`runtimeConfig.ts`)
3. Handler branch in `POST /admin/config` (`admin.ts`) with type check + range clamp
4. UI control in `AdminPage.tsx` + entry in client `RuntimeConfig` interface

---

## New RuntimeConfig Fields

### Lobbying

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `lobbyingEnabled` | boolean | `true` | — | Master on/off for Phase 1.5 |
| `maxLobbyistsPerTick` | number | `3` | 1–10 | Max agents that lobby per tick |
| `lobbyingPositionShiftChance` | number | `0.35` | 0.0–1.0 | Base probability a target is actually persuaded (used for positionShifted tracking) |

### Floor Amendments

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `floorAmendmentsEnabled` | boolean | `true` | — | Master on/off for Phase 1.7 |
| `maxAmendmentsPerBillPerTick` | number | `2` | 1–5 | Cap on amendment proposals per bill per tick |

Note: `amendmentProposalChance` already exists — it is **reused** for floor amendments. No new field needed.

### Bill Withdrawal

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `billWithdrawalEnabled` | boolean | `true` | — | Master on/off for Phase 5.5 |

### Public Statements

| Field | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `publicStatementsEnabled` | boolean | `true` | — | Master on/off for Phase 11.5 |
| `proactiveStatementChance` | number | `0.05` | 0.0–0.20 | Probability any agent issues an unprompted statement per tick |
| `maxStatementsPerAgentPerTick` | number | `1` | 1–3 | Max statements one agent can issue per tick |

**Total new fields: 9**

---

## `runtimeConfig.ts` additions

Add to the `RuntimeConfig` interface:

```typescript
/* ---- Lobbying ---- */
lobbyingEnabled: boolean;
maxLobbyistsPerTick: number;
lobbyingPositionShiftChance: number;

/* ---- Floor Amendments ---- */
floorAmendmentsEnabled: boolean;
maxAmendmentsPerBillPerTick: number;

/* ---- Bill Withdrawal ---- */
billWithdrawalEnabled: boolean;

/* ---- Public Statements ---- */
publicStatementsEnabled: boolean;
proactiveStatementChance: number;
maxStatementsPerAgentPerTick: number;
```

Add to `DEFAULTS`:

```typescript
/* Lobbying */
lobbyingEnabled: true,
maxLobbyistsPerTick: 3,
lobbyingPositionShiftChance: 0.35,

/* Floor Amendments */
floorAmendmentsEnabled: true,
maxAmendmentsPerBillPerTick: 2,

/* Bill Withdrawal */
billWithdrawalEnabled: true,

/* Public Statements */
publicStatementsEnabled: true,
proactiveStatementChance: 0.05,
maxStatementsPerAgentPerTick: 1,
```

---

## `admin.ts` handler branches

Add to the `POST /admin/config` whitelist block, following the existing type-check + range-clamp pattern:

```typescript
// Lobbying
if (body.lobbyingEnabled !== undefined) {
  update.lobbyingEnabled = Boolean(body.lobbyingEnabled);
}
if (body.maxLobbyistsPerTick !== undefined) {
  const v = Number(body.maxLobbyistsPerTick);
  if (!isFinite(v) || v < 1 || v > 10) { res.status(400).json({ error: 'maxLobbyistsPerTick must be 1–10' }); return; }
  update.maxLobbyistsPerTick = Math.round(v);
}
if (body.lobbyingPositionShiftChance !== undefined) {
  const v = Number(body.lobbyingPositionShiftChance);
  if (!isFinite(v) || v < 0 || v > 1) { res.status(400).json({ error: 'lobbyingPositionShiftChance must be 0.0–1.0' }); return; }
  update.lobbyingPositionShiftChance = v;
}

// Floor Amendments
if (body.floorAmendmentsEnabled !== undefined) {
  update.floorAmendmentsEnabled = Boolean(body.floorAmendmentsEnabled);
}
if (body.maxAmendmentsPerBillPerTick !== undefined) {
  const v = Number(body.maxAmendmentsPerBillPerTick);
  if (!isFinite(v) || v < 1 || v > 5) { res.status(400).json({ error: 'maxAmendmentsPerBillPerTick must be 1–5' }); return; }
  update.maxAmendmentsPerBillPerTick = Math.round(v);
}

// Bill Withdrawal
if (body.billWithdrawalEnabled !== undefined) {
  update.billWithdrawalEnabled = Boolean(body.billWithdrawalEnabled);
}

// Public Statements
if (body.publicStatementsEnabled !== undefined) {
  update.publicStatementsEnabled = Boolean(body.publicStatementsEnabled);
}
if (body.proactiveStatementChance !== undefined) {
  const v = Number(body.proactiveStatementChance);
  if (!isFinite(v) || v < 0 || v > 0.20) { res.status(400).json({ error: 'proactiveStatementChance must be 0.0–0.20' }); return; }
  update.proactiveStatementChance = v;
}
if (body.maxStatementsPerAgentPerTick !== undefined) {
  const v = Number(body.maxStatementsPerAgentPerTick);
  if (!isFinite(v) || v < 1 || v > 3) { res.status(400).json({ error: 'maxStatementsPerAgentPerTick must be 1–3' }); return; }
  update.maxStatementsPerAgentPerTick = Math.round(v);
}
```

---

## `AdminPage.tsx` additions

### Client `RuntimeConfig` interface additions

```typescript
// Add to the RuntimeConfig interface in AdminPage.tsx:
lobbyingEnabled: boolean;
maxLobbyistsPerTick: number;
lobbyingPositionShiftChance: number;
floorAmendmentsEnabled: boolean;
maxAmendmentsPerBillPerTick: number;
billWithdrawalEnabled: boolean;
publicStatementsEnabled: boolean;
proactiveStatementChance: number;
maxStatementsPerAgentPerTick: number;
```

### Tab placement

These controls belong in the **Behavior** tab (currently the second tab), under a new collapsible sub-section header "Floor Activity & Negotiation". The Behavior tab already has `billProposalChance`, `amendmentProposalChance`, etc. — these are the same category.

If the Behavior tab is already crowded, use the existing `CollapsibleSection` pattern (already used elsewhere in AdminPage) to keep it manageable — the section defaults to collapsed.

### UI controls

```tsx
{/* Floor Activity & Negotiation section */}
<CollapsibleSection title="Floor Activity & Negotiation" defaultOpen={false}>

  {/* Lobbying */}
  <div className="space-y-3">
    <h4 className="text-badge text-text-muted uppercase tracking-wider">Lobbying</h4>

    <label className="flex items-center justify-between">
      <span className="text-sm text-text-secondary">Lobbying Enabled</span>
      <input type="checkbox"
        checked={simConfig.lobbyingEnabled}
        onChange={e => setSimConfig(c => ({ ...c, lobbyingEnabled: e.target.checked }))}
      />
    </label>

    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-text-secondary">Max Lobbyists / Tick</span>
      <input type="number" min={1} max={10} step={1}
        className="input-sm w-20 text-right"
        value={simConfig.maxLobbyistsPerTick}
        onChange={e => setSimConfig(c => ({ ...c, maxLobbyistsPerTick: Number(e.target.value) }))}
      />
    </label>

    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-text-secondary">Position Shift Chance</span>
      <input type="number" min={0} max={1} step={0.01}
        className="input-sm w-24 text-right"
        value={simConfig.lobbyingPositionShiftChance}
        onChange={e => setSimConfig(c => ({ ...c, lobbyingPositionShiftChance: Number(e.target.value) }))}
      />
    </label>
  </div>

  {/* Floor Amendments */}
  <div className="space-y-3 pt-4 border-t border-border/40">
    <h4 className="text-badge text-text-muted uppercase tracking-wider">Floor Amendments</h4>

    <label className="flex items-center justify-between">
      <span className="text-sm text-text-secondary">Floor Amendments Enabled</span>
      <input type="checkbox"
        checked={simConfig.floorAmendmentsEnabled}
        onChange={e => setSimConfig(c => ({ ...c, floorAmendmentsEnabled: e.target.checked }))}
      />
    </label>

    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-text-secondary">Max Amendments / Bill / Tick</span>
      <input type="number" min={1} max={5} step={1}
        className="input-sm w-20 text-right"
        value={simConfig.maxAmendmentsPerBillPerTick}
        onChange={e => setSimConfig(c => ({ ...c, maxAmendmentsPerBillPerTick: Number(e.target.value) }))}
      />
    </label>
  </div>

  {/* Bill Withdrawal */}
  <div className="space-y-3 pt-4 border-t border-border/40">
    <h4 className="text-badge text-text-muted uppercase tracking-wider">Bill Withdrawal</h4>

    <label className="flex items-center justify-between">
      <span className="text-sm text-text-secondary">Bill Withdrawal Enabled</span>
      <input type="checkbox"
        checked={simConfig.billWithdrawalEnabled}
        onChange={e => setSimConfig(c => ({ ...c, billWithdrawalEnabled: e.target.checked }))}
      />
    </label>
  </div>

  {/* Public Statements */}
  <div className="space-y-3 pt-4 border-t border-border/40">
    <h4 className="text-badge text-text-muted uppercase tracking-wider">Public Statements</h4>

    <label className="flex items-center justify-between">
      <span className="text-sm text-text-secondary">Public Statements Enabled</span>
      <input type="checkbox"
        checked={simConfig.publicStatementsEnabled}
        onChange={e => setSimConfig(c => ({ ...c, publicStatementsEnabled: e.target.checked }))}
      />
    </label>

    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-text-secondary">Proactive Statement Chance</span>
      <input type="number" min={0} max={0.20} step={0.01}
        className="input-sm w-24 text-right"
        value={simConfig.proactiveStatementChance}
        onChange={e => setSimConfig(c => ({ ...c, proactiveStatementChance: Number(e.target.value) }))}
      />
    </label>

    <label className="flex items-center justify-between gap-4">
      <span className="text-sm text-text-secondary">Max Statements / Agent / Tick</span>
      <input type="number" min={1} max={3} step={1}
        className="input-sm w-20 text-right"
        value={simConfig.maxStatementsPerAgentPerTick}
        onChange={e => setSimConfig(c => ({ ...c, maxStatementsPerAgentPerTick: Number(e.target.value) }))}
      />
    </label>
  </div>

</CollapsibleSection>
```
