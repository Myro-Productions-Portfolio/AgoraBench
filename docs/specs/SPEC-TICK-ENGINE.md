# Tick Engine Spec — Floor Activity Phases

**Part of:** [FLOOR-ACTIVITY-SPEC.md](./FLOOR-ACTIVITY-SPEC.md)

---

## Phase Insertion Map

All new phases insert into `agentTick.ts` inside the existing `agentTickQueue.process()` block. Follow the exact same `try/catch` and `console.warn('[PHASE N])` logging pattern used by all existing phases.

```
Phase 1    — Party Whip Signal         (existing)
Phase 1.5  — Pre-Vote Lobbying         [NEW — insert after Phase 1 block]
Phase 1.7  — Floor Amendments          [NEW — insert after Phase 1.5 block]
Phase 2    — Bill Voting               (existing — inject lobby + deals context here)
Phase 2b   — Relationship & Policy     (existing)
Phase 2c   — Deal Honor Check          [NEW — append to end of Phase 2b block]
Phase 3    — Committee Review          (existing)
Phase 4    — Bill Advancement          (existing)
Phase 5    — Bill Resolution           (existing)
Phase 5.5  — Bill Withdrawal           [NEW — insert after Phase 5 block]
Phase 6    — Presidential Review       (existing)
...
Phase 11   — Agent Bill Proposal       (existing)
Phase 11.5 — Public Statements         [NEW — insert after Phase 11 block]
Phase 12+  — existing phases unchanged
```

---

## Phase 1.5: Pre-Vote Lobbying

**Gate:** `rc.lobbyingEnabled === true && floorBills.length > 0`

**Purpose:** Agents attempt to persuade each other before votes are cast. The argument is injected into the target's vote prompt in Phase 2.

### Agent selection

```typescript
// Select up to rc.maxLobbyistsPerTick agents from activeAgents pool
// Weight: position holders (leader, committee_chair, president) get 2x probability
// Each selected lobbyist picks one target: the active agent with greatest
// alignmentDistance from themselves who has no lobbyingEvent yet for this bill+tick
const maxLobbyists = rc.maxLobbyistsPerTick ?? 3;
```

### LLM call

```typescript
const contextMessage =
  `Bill "${bill.title}" is on the floor. Summary: ${bill.summary}. ` +
  `You want ${targetAgent.displayName} to vote ${desiredVote.toUpperCase()}. ` +
  `Your current vote alignment with them is ${Math.round(currentAlignment * 100)}%. ` +
  `Party whip signal for their party on this bill: ${whipSignal ?? 'none issued'}. ` +
  `Make a direct, politically grounded argument for your position in 1-2 sentences. ` +
  `Respond with exactly this JSON: ` +
  `{"action":"lobby","reasoning":"your persuasive argument","data":{"desiredVote":"${desiredVote}","targetId":"${targetAgent.id}"}}`;
```

Action: `lobby` — add to `PHASE_ACTION_MAP` in `ai.ts`.

### Output processing

1. Insert `lobbyingEvents` row: `{ lobbyistId, targetId, billId, argument: decision.reasoning, desiredVote, sentimentDelta: 0.03, tickId }`
2. Apply `+0.03` sentiment to `agentRelationships` between target → lobbyist immediately (the approach was noted)
3. Store `lobbyNotesMap: Map<agentId, string[]>` in the tick scope — keyed by target agent ID, values are argument strings. Phase 2 reads this map.

### Phase 2 injection

In Phase 2's per-agent context build loop, before calling `generateAgentDecision`:

```typescript
const lobbyNotes = lobbyNotesMap.get(agent.id) ?? [];
const lobbyNote = lobbyNotes.length > 0
  ? `\n\n## Lobbying\nBefore this vote, the following agents personally appealed to you:\n` +
    lobbyNotes.map(n => `  - ${n}`).join('\n')
  : '';
// Append lobbyNote to the bill's baseContext string
```

### DB writes
- `lobbyingEvents` (insert)
- `agentRelationships` (sentiment upsert, same pattern as Phase 2b)
- `activityEvents` (type: `'lobby'`, title: `"${lobbyist.displayName} lobbied ${target.displayName}"`)

### WS event
```typescript
broadcast('agent:lobby', {
  lobbyistId, lobbyistName, targetId, targetName,
  billId, billTitle, desiredVote, argument
});
```

---

## Phase 1.7: Floor Amendments

**Gate:** `rc.floorAmendmentsEnabled === true && floorBills.length > 0`

**Purpose:** Agents propose modifications to floor bills before voting. Accepted amendments update `bills.fullText` so Phase 2 agents vote on the final text. This is **Option B** — amendments before votes.

### Who can propose

- Eligible: any active agent who is NOT the bill's sponsor (sponsors can't amend their own bill on the floor — they should have written it correctly)
- Per-bill cap: `rc.maxAmendmentsPerBillPerTick` (default: 2). Once cap is hit, skip remaining proposers for that bill
- Per-agent chance: `rc.amendmentProposalChance` (existing field, reused)
- Priority bonus: committee chairs for the bill's committee get `+0.15` probability

### LLM call

```typescript
const contextMessage =
  `Bill "${bill.title}" is on the floor for a vote. ` +
  `Full text: ${bill.fullText.slice(0, 800)}. ` +
  `Summary: ${bill.summary}. ` +
  `You may propose a floor amendment to refine this legislation before the vote. ` +
  `Choose type: 'addition' (add a new clause), 'strike' (remove a clause), or 'substitute' (rewrite a section). ` +
  `Keep the amendment under 150 words. Be specific — reference actual content from the bill. ` +
  `Respond with exactly this JSON: ` +
  `{"action":"propose_amendment","reasoning":"one sentence explaining your change","data":{"type":"addition","amendmentText":"The amendment text"}}`;
```

Action: `propose_amendment` — add to `PHASE_ACTION_MAP` in `ai.ts`.

### Amendment voting (no extra LLM calls)

Use weighted alignment scoring against bill supporters:

```typescript
// Get all agents who voted yea on this bill in the existing billVotes (from prior ticks)
// or use whip signal alignment as a proxy for first-tick proposals
const supporters = await db.select().from(billVotes)
  .where(and(eq(billVotes.billId, bill.id), eq(billVotes.choice, 'yea')));

const supporterIds = supporters.map(v => v.voterId);

// For each supporter, check alignment distance from proposer
// votesFor += agentRelationship.voteAlignment for each aligned supporter
// votesAgainst += (1 - voteAlignment) for each
let votesFor = 0;
let votesAgainst = 0;
for (const supporterId of supporterIds) {
  const rel = relationshipMap.get(`${proposer.id}:${supporterId}`);
  const alignment = rel?.voteAlignment ?? 0.5;
  votesFor += alignment;
  votesAgainst += (1 - alignment);
}

const amendmentPasses = (votesFor / (votesFor + votesAgainst)) >= rc.billPassagePercentage;
```

### If amendment accepted

```typescript
// Update bill text
await db.update(bills)
  .set({ fullText: decision.data.amendmentText, lastActionAt: new Date() })
  .where(eq(bills.id, bill.id));

// Mark amendment
await db.update(billAmendments)
  .set({ status: 'accepted', resolvedAt: new Date(), votesFor, votesAgainst })
  .where(eq(billAmendments.id, amendment.id));

// Approval bonus
await insertApprovalEvent(proposer.id, +5, 'amendment_accepted');

broadcast('bill:amended', { billId, billTitle, amendmentId, proposerName, amendmentType });
```

### If amendment rejected

```typescript
await db.update(billAmendments)
  .set({ status: 'rejected', resolvedAt: new Date(), votesFor, votesAgainst })
  .where(eq(billAmendments.id, amendment.id));

broadcast('bill:floor_amendment_proposed', { billId, billTitle, amendmentId, proposerName, amendmentType, status: 'rejected' });
```

### DB writes
- `billAmendments` (insert, then update with resolution)
- `bills` (fullText + lastActionAt, only if accepted)
- `activityEvents` (type: `'floor_amendment'`)
- `approvalEvents` (proposer +5, only if accepted)

---

## Phase 2c: Deal Honor Check

**Placement:** Appended to end of existing Phase 2b block. Runs after relationship deltas are applied.

**Gate:** `rc.dealMakingEnabled === true` (new field — also gates deal *creation* in Phase 1.5)

**Purpose:** After votes are cast, check whether agents honored their deal commitments. Apply relationship deltas for honoring or breaking.

```typescript
async function dealHonorCheck(floorBillIds: string[], activeAgents: AgentRow[]): Promise<void> {
  if (floorBillIds.length === 0) return;

  // Find all accepted, non-expired deals for this tick's floor bills
  const pendingDeals = await db.select().from(agentDeals)
    .where(and(
      inArray(agentDeals.billId, floorBillIds),
      eq(agentDeals.status, 'accepted'),
      gt(agentDeals.expiresAt, new Date()),
    ));

  for (const deal of pendingDeals) {
    // Check initiator's vote
    const [initiatorVote] = await db.select().from(billVotes)
      .where(and(eq(billVotes.billId, deal.billId), eq(billVotes.voterId, deal.initiatorId)))
      .limit(1);

    // Check target's vote
    const [targetVote] = await db.select().from(billVotes)
      .where(and(eq(billVotes.billId, deal.billId), eq(billVotes.voterId, deal.targetId)))
      .limit(1);

    // Parse commitment text for 'yea'/'nay' signal
    const initiatorPromisedYea = deal.initiatorCommitment.toLowerCase().includes('yea');
    const targetPromisedYea = deal.targetCommitment.toLowerCase().includes('yea');

    const initiatorHonored = initiatorVote
      ? (initiatorPromisedYea ? initiatorVote.choice === 'yea' : initiatorVote.choice === 'nay')
      : false;
    const targetHonored = targetVote
      ? (targetPromisedYea ? targetVote.choice === 'yea' : targetVote.choice === 'nay')
      : false;

    const bothHonored = initiatorHonored && targetHonored;
    const anyBroken = !initiatorHonored || !targetHonored;
    const newStatus = bothHonored ? 'honored' : anyBroken ? 'broken' : 'proposed';

    await db.update(agentDeals).set({
      status: newStatus,
      initiatorHonored,
      targetHonored,
      resolvedAt: new Date(),
    }).where(eq(agentDeals.id, deal.id));

    // Relationship deltas
    if (bothHonored) {
      // Both honored: mutual alignment boost
      await upsertRelationshipDelta(deal.initiatorId, deal.targetId, { voteAlignmentDelta: +0.08 });
      await upsertRelationshipDelta(deal.targetId, deal.initiatorId, { voteAlignmentDelta: +0.08 });
      broadcast('agent:deal_honored', { dealId: deal.id, initiatorName, targetName, billTitle });
    } else {
      // Someone broke: penalty to breaker's relationships
      if (!initiatorHonored) {
        await upsertRelationshipDelta(deal.targetId, deal.initiatorId, { voteAlignmentDelta: -0.15, sentimentDelta: -0.12 });
        broadcast('agent:deal_broken', { dealId: deal.id, breakerId: deal.initiatorId, breakerName, billTitle });
      }
      if (!targetHonored) {
        await upsertRelationshipDelta(deal.initiatorId, deal.targetId, { voteAlignmentDelta: -0.15, sentimentDelta: -0.12 });
        broadcast('agent:deal_broken', { dealId: deal.id, breakerId: deal.targetId, breakerName, billTitle });
      }
    }
  }
}
```

---

## Phase 5.5: Bill Withdrawal

**Gate:** `rc.billWithdrawalEnabled === true`

**Trigger:** Bills that failed the floor vote this tick (`status` was just set to `'vetoed'` by Phase 5, meaning Legislature voted it down — distinct from presidential veto). Pass `failedBillIds` from Phase 5's scope.

**Important naming distinction:** In the current schema `status = 'vetoed'` means "Legislature voted it down". Presidential vetoes are `status = 'presidential_veto'`. Phase 5.5 targets Legislature-failed bills only.

### LLM call (one per failed bill's sponsor, if sponsor is active)

```typescript
const contextMessage =
  `Your bill "${bill.title}" just failed the floor vote (${bill.yeaCount} yea, ${bill.nayCount} nay, ` +
  `needed ${Math.ceil(activeAgents.length * rc.billPassagePercentage)} to pass). ` +
  `You may formally withdraw it now to revise and reintroduce a stronger version next session. ` +
  `If you do not withdraw, it dies here. ` +
  `Your current approval rating: ${sponsor.approvalRating}%. ` +
  `Respond with exactly this JSON: ` +
  `{"action":"bill_withdrawal","reasoning":"one sentence","data":{"withdraw":true}}`;
```

Action: `bill_withdrawal` — add to `PHASE_ACTION_MAP`.

### Processing

```typescript
if (decision.data.withdraw === true) {
  await db.update(bills).set({
    status: 'withdrawn',
    withdrawnAt: new Date(),
    lastActionAt: new Date(),
  }).where(eq(bills.id, bill.id));

  await db.insert(activityEvents).values({
    type: 'bill_withdrawn',
    agentId: sponsor.id,
    title: `${sponsor.displayName} withdrew "${bill.title}"`,
    description: decision.reasoning,
  });

  // Approval: withdrawal costs -3 (less than the -6 for a public failed vote)
  await insertApprovalEvent(sponsor.id, -3, 'bill_withdrawn');

  broadcast('bill:withdrawn', { billId, billTitle, sponsorId, sponsorName, reasoning: decision.reasoning });
}
// If withdraw: false — bill stays 'vetoed' (failed), no action
```

---

## Phase 11.5: Public Statements

**Gate:** `rc.publicStatementsEnabled === true`

**Purpose:** Agents issue press statements in response to simulation events that occurred during this tick. Fires after Phase 11 so bill proposals from this tick are eligible triggers.

### Trigger collection

Collect triggers from this tick's event log (variables in scope from prior phases):

```typescript
type StatementTrigger = {
  agentId: string;
  triggerType: string;
  triggerBillId?: string;
  triggerElectionId?: string;
  triggerDealId?: string;
};

const triggers: StatementTrigger[] = [];

// bill_passed — sponsors of bills that passed Phase 5 this tick
for (const bill of passedBillsThisTick) {
  triggers.push({ agentId: bill.sponsorId, triggerType: 'bill_passed', triggerBillId: bill.id });
}

// bill_failed — sponsors of bills that failed AND were not withdrawn
for (const bill of failedBillsThisTick) {
  if (bill.status !== 'withdrawn') {
    triggers.push({ agentId: bill.sponsorId, triggerType: 'bill_failed', triggerBillId: bill.id });
  }
}

// bill_vetoed — sponsor + president
for (const bill of vetoedByPresidentThisTick) {
  triggers.push({ agentId: bill.sponsorId, triggerType: 'bill_vetoed', triggerBillId: bill.id });
  if (president) triggers.push({ agentId: president.id, triggerType: 'bill_vetoed', triggerBillId: bill.id });
}

// election_won / election_lost — from Phase 14 certified elections
for (const result of electionResultsThisTick) {
  triggers.push({ agentId: result.winnerId, triggerType: 'election_won', triggerElectionId: result.electionId });
  for (const loserId of result.loserIds) {
    triggers.push({ agentId: loserId, triggerType: 'election_lost', triggerElectionId: result.electionId });
  }
}

// deal_broken — from Phase 2c
for (const broken of brokenDealsThisTick) {
  triggers.push({ agentId: broken.wrongedPartyId, triggerType: 'deal_broken', triggerDealId: broken.dealId });
}

// proactive — random chance for any agent not already triggered
const triggeredAgentIds = new Set(triggers.map(t => t.agentId));
for (const agent of activeAgents) {
  if (!triggeredAgentIds.has(agent.id) && Math.random() < (rc.proactiveStatementChance ?? 0.05)) {
    triggers.push({ agentId: agent.id, triggerType: 'proactive' });
  }
}
```

### Priority dedup

One statement per agent per tick. Priority order (highest first):
`deal_broken > bill_vetoed > bill_passed > bill_failed > election_won > election_lost > bill_proposed > proactive`

```typescript
// Deduplicate: keep highest-priority trigger per agent
const PRIORITY = ['deal_broken','bill_vetoed','bill_passed','bill_failed','election_won','election_lost','bill_proposed','proactive'];
const finalTriggers = new Map<string, StatementTrigger>();
for (const trigger of triggers) {
  const existing = finalTriggers.get(trigger.agentId);
  if (!existing || PRIORITY.indexOf(trigger.triggerType) < PRIORITY.indexOf(existing.triggerType)) {
    finalTriggers.set(trigger.agentId, trigger);
  }
}

// Apply per-tick cap
const cappedTriggers = [...finalTriggers.values()].slice(0, rc.maxStatementsPerAgentPerTick ?? 1);
```

### LLM call (parallel, same pattern as Phase 15/16)

```typescript
const triggerLine = buildTriggerLine(trigger, bill, election); // e.g. "Your bill 'Healthcare Act' just passed the Legislature"

const contextMessage =
  `${triggerLine}. ` +
  `Issue a brief public press statement responding to this event. ` +
  `Be specific — reference actual names, bill titles, and what happened. ` +
  `Keep it to 2-3 sentences. Do not be generic. ` +
  `Respond with exactly this JSON: ` +
  `{"action":"public_statement","reasoning":"your statement text","data":{"triggerType":"${trigger.triggerType}"}}`;
```

Action: `public_statement` — add to `PHASE_ACTION_MAP`.

### Processing

```typescript
await db.insert(agentStatements).values({
  agentId: agent.id,
  statementText: decision.reasoning,
  triggerType: trigger.triggerType,
  triggerBillId: trigger.triggerBillId ?? null,
  triggerElectionId: trigger.triggerElectionId ?? null,
  triggerDealId: trigger.triggerDealId ?? null,
  approvalDelta: approvalDeltaByTrigger[trigger.triggerType] ?? 0,
});

await db.insert(activityEvents).values({
  type: 'public_statement',
  agentId: agent.id,
  title: `${agent.displayName} issued a statement`,
  description: decision.reasoning,
  metadata: JSON.stringify({ triggerType: trigger.triggerType }),
});

await insertApprovalEvent(agent.id, approvalDelta, 'public_statement');

broadcast('agent:statement', {
  agentId: agent.id,
  agentName: agent.displayName,
  statementText: decision.reasoning,
  triggerType: trigger.triggerType,
  triggerBillId: trigger.triggerBillId,
});
```

### Approval deltas by trigger type

| Trigger type | Approval delta |
|---|---|
| `bill_passed` | +2 |
| `bill_failed` | 0 |
| `bill_vetoed` (sponsor) | -1 |
| `bill_vetoed` (president) | +1 |
| `election_won` | +3 |
| `election_lost` | 0 |
| `deal_broken` | +1 |
| `proactive` | 0 |

---

## Scope variables needed across phases

The following variables must be declared in the outer tick scope and populated by the relevant phase, so later phases can read them without extra DB queries:

```typescript
// Declare at top of agentTickQueue.process(async () => {
let lobbyNotesMap: Map<string, string[]> = new Map();   // Phase 1.5 → Phase 2
let passedBillsThisTick: typeof bills.$inferSelect[] = [];   // Phase 5 → Phase 11.5
let failedBillsThisTick: typeof bills.$inferSelect[] = [];   // Phase 5 → Phase 5.5, 11.5
let vetoedByPresidentThisTick: typeof bills.$inferSelect[] = []; // Phase 6 → Phase 11.5
let electionResultsThisTick: ElectionResult[] = [];     // Phase 14 → Phase 11.5
let brokenDealsThisTick: BrokenDealRecord[] = [];       // Phase 2c → Phase 11.5
```

These follow the existing pattern of `whipSignals` and `forumRoutingMap` which are already scoped this way.
