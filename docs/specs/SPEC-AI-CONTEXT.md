# AI Context Spec — Floor Activity

**Part of:** [FLOOR-ACTIVITY-SPEC.md](./FLOOR-ACTIVITY-SPEC.md)

---

## Changes to `src/core/server/services/ai.ts`

### 1. New entries in `PHASE_ACTION_MAP`

```typescript
// Add to PHASE_ACTION_MAP
lobby:             'lobby',
propose_amendment: 'propose_amendment',
bill_withdrawal:   'bill_withdrawal',
public_statement:  'public_statement',
```

### 2. New entries in `ACTION_ALIASES`

```typescript
// Add to ACTION_ALIASES
lobby: [
  'lobbying', 'persuade', 'appeal', 'advocate', 'negotiate',
  'make_argument', 'argue', 'approach', 'convince',
],
propose_amendment: [
  'amendment', 'amend', 'floor_amendment', 'modify_bill',
  'change_bill', 'revise_bill', 'propose_change',
],
bill_withdrawal: [
  'withdraw', 'withdraw_bill', 'pull_bill', 'retract',
  'revise_and_reintroduce', 'table_bill',
],
public_statement: [
  'statement', 'press_statement', 'press_release', 'announce',
  'address', 'public_address', 'respond', 'issue_statement',
],
```

---

### 3. New context block: `buildActiveDealsBlock`

Add this function alongside the existing `buildRelationshipBlock`, `buildMemoryBlock`, etc.

```typescript
async function buildActiveDealsBlock(agentId: string): Promise<string> {
  const rows = await db
    .select({
      id: agentDeals.id,
      initiatorId: agentDeals.initiatorId,
      targetId: agentDeals.targetId,
      initiatorCommitment: agentDeals.initiatorCommitment,
      targetCommitment: agentDeals.targetCommitment,
      expiresAt: agentDeals.expiresAt,
      // Need names — join agents table for both sides
    })
    .from(agentDeals)
    .where(
      and(
        or(
          eq(agentDeals.initiatorId, agentId),
          eq(agentDeals.targetId, agentId),
        ),
        eq(agentDeals.status, 'accepted'),
        gt(agentDeals.expiresAt, new Date()),
      )
    )
    .limit(5);

  if (rows.length === 0) return '';

  const lines = rows.map((d) => {
    const isInitiator = d.initiatorId === agentId;
    const myCommitment = isInitiator ? d.initiatorCommitment : d.targetCommitment;
    return `  - You committed: "${myCommitment}"`;
  });

  return [
    '## Active Vote Commitments',
    'You have made the following commitments. Breaking them will damage your relationships and reputation:',
    ...lines,
  ].join('\n');
}
```

**Import requirement:** Add `agentDeals` to the imports at the top of `ai.ts` from `@db/schema/index`.

---

### 4. `buildSystemPrompt` signature change

Add `dealsContext` as the ninth optional parameter:

```typescript
function buildSystemPrompt(
  agent: AgentRecord,
  memory?: string,
  forumContext?: string,
  congressContext?: string,
  relationshipContext?: string,
  policyContext?: string,
  electionContext?: string,
  economyContext?: string,
  dealsContext?: string,       // NEW
): string {
  // ... existing sections ...

  // Append after economyContext block:
  if (dealsContext) {
    parts.push(dealsContext);
  }

  return parts.join('\n\n');
}
```

---

### 5. `generateAgentDecision` — pass `dealsContext` for vote-sensitive phases

In `generateAgentDecision`, before calling `buildSystemPrompt`, add:

```typescript
// Only fetch deals context for phases where vote commitments are relevant
const dealPhases = ['vote', 'lobby', 'propose_amendment', 'override_vote'];
const dealsContext = dealPhases.includes(phase)
  ? await buildActiveDealsBlock(agent.id)
  : undefined;
```

Pass `dealsContext` as the ninth argument to `buildSystemPrompt`.

---

### 6. Context block injection summary

| Phase | Memory | Forum | Relations | Policy | Election | Economy | Deals |
|-------|--------|-------|-----------|--------|----------|---------|-------|
| vote | yes | yes | yes | yes | yes | yes | **yes** |
| lobby | yes | no | yes | yes | no | no | **yes** |
| propose_amendment | yes | no | yes | yes | no | no | **yes** |
| bill_withdrawal | yes | no | no | yes | no | yes | no |
| public_statement | yes | no | no | no | yes | no | no |
| override_vote | yes | no | yes | yes | no | no | **yes** |

For `lobby` and `propose_amendment`, forum context is skipped (not relevant, saves tokens). For `bill_withdrawal` and `public_statement`, minimal context is needed — the event itself provides all the relevant information.

---

## Prompt Quality Notes

### Lobby prompts
- Include the whip signal so the lobbyist knows what they're fighting against or reinforcing
- Include current vote alignment % so the agent calibrates the strength of its argument
- Keep the ask at one action: vote yea OR vote nay. No multi-ask lobbying

### Amendment prompts
- Slice `bill.fullText` to 800 chars max — amendments should be grounded in actual bill content but we can't feed 4000 chars per proposal
- Require type declaration upfront (`addition`/`strike`/`substitute`) — the LLM tends to write better amendments when it picks a mode first

### Withdrawal prompts
- Always include yea/nay counts — the agent needs to know how badly it failed
- Include needed threshold — "needed X votes, got Y" is more actionable than a percentage
- Include current approval so risk-averse low-approval agents have context to decide

### Statement prompts
- Require specificity — "reference actual names and bill titles" reduces generic output
- Keep to 2-3 sentences max — statements are punchy, not essays
- The `triggerLine` should be built with real names: `"Your bill 'Healthcare Reform Act' just passed the Legislature (28 yea, 12 nay)"` not `"a bill passed"`

---

## Token budget impact

Each new phase adds LLM calls. Conservative estimates per tick with 30 active agents:

| Phase | Max calls/tick | Avg tokens/call | Tokens/tick |
|-------|----------------|-----------------|-------------|
| 1.5 Lobbying | `maxLobbyistsPerTick` = 3 | ~600 | ~1,800 |
| 1.7 Amendments | ~4 (2 bills × 2 amendments) | ~800 | ~3,200 |
| 5.5 Withdrawal | ~2 (failed bills with active sponsors) | ~500 | ~1,000 |
| 11.5 Statements | `maxStatementsPerTick` = 3 | ~600 | ~1,800 |
| **Total new** | **~12** | | **~7,800** |

Existing phases already consume ~40,000 tokens/tick (Phase 2 alone is ~20,000). The new phases add roughly 20% overhead. Acceptable. If needed, `lobbyingEnabled` and `publicStatementsEnabled` can be toggled independently.
