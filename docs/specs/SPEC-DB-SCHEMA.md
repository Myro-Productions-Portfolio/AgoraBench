# DB Schema Spec — Floor Activity

**Part of:** [FLOOR-ACTIVITY-SPEC.md](./FLOOR-ACTIVITY-SPEC.md)

---

## New Tables Overview

| Table | File | Purpose |
|-------|------|---------|
| `bill_amendments` | `src/modules/legislation/db/schema/amendments.ts` | Floor amendment proposals per bill |
| `lobbying_events` | `src/modules/legislation/db/schema/lobbying.ts` | Pre-vote lobbying interactions |
| `agent_deals` | `src/modules/agents/db/schema/agentDeals.ts` | Vote-trade deals between agents |
| `agent_statements` | `src/modules/agents/db/schema/agentStatements.ts` | Public press statements |

Plus one column addition to the existing `bills` table.

All new tables are exported from `src/core/db/schema/index.ts`.

---

## 1. `bill_amendments`

```typescript
// src/modules/legislation/db/schema/amendments.ts
import { pgTable, uuid, text, varchar, integer, real, timestamp, index } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';
import { bills } from './legislation';

export const billAmendments = pgTable(
  'bill_amendments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billId: uuid('bill_id').notNull().references(() => bills.id),
    proposerId: uuid('proposer_id').notNull().references(() => agents.id),
    // Full text of the amendment — what the bill text becomes (substitute)
    // or the clause text being added/removed (addition/strike)
    amendmentText: text('amendment_text').notNull(),
    // 'substitute' | 'addition' | 'strike'
    type: varchar('type', { length: 20 }).notNull(),
    // 'pending' | 'accepted' | 'rejected' | 'withdrawn'
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // LLM-generated reasoning for the proposal
    reasoning: text('reasoning'),
    // Weighted vote tally — computed from supporter alignment, not individual LLM votes
    votesFor: real('votes_for').notNull().default(0),
    votesAgainst: real('votes_against').notNull().default(0),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    billIdx: index('bill_amendments_bill_id_idx').on(t.billId),
    statusIdx: index('bill_amendments_status_idx').on(t.status),
    proposerIdx: index('bill_amendments_proposer_id_idx').on(t.proposerId),
  }),
);
```

### Design notes
- `type` is app-layer validated (varchar, not pg enum) — matches existing codebase pattern
- `votesFor` / `votesAgainst` are `real` not integer — computed as weighted alignment sums, not head counts
- `status: 'withdrawn'` is distinct from `'rejected'` — lets UI show sponsor-initiated vs. vote-failed
- One row per proposal. Multiple pending amendments per bill are allowed up to `rc.maxAmendmentsPerBillPerTick`
- No separate `amendment_votes` table — individual amendment vote records are v2

---

## 2. `lobbying_events`

```typescript
// src/modules/legislation/db/schema/lobbying.ts
import { pgTable, uuid, text, varchar, boolean, real, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';
import { bills } from './legislation';

export const lobbyingEvents = pgTable(
  'lobbying_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lobbyistId: uuid('lobbyist_id').notNull().references(() => agents.id),
    targetId: uuid('target_id').notNull().references(() => agents.id),
    billId: uuid('bill_id').notNull().references(() => bills.id),
    // LLM-generated persuasion argument
    argument: text('argument').notNull(),
    // What vote the lobbyist wanted
    desiredVote: varchar('desired_vote', { length: 10 }).notNull(), // 'yea' | 'nay'
    // Set after Phase 2 voting: did the target vote as requested?
    positionShifted: boolean('position_shifted').notNull().default(false),
    // Relationship delta applied to agentRelationships.sentiment after this event
    sentimentDelta: real('sentiment_delta').notNull().default(0.03),
    // Integer tick counter from tickLog for dedup and history
    tickId: integer('tick_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    billIdx: index('lobbying_events_bill_id_idx').on(t.billId),
    lobbyistIdx: index('lobbying_events_lobbyist_id_idx').on(t.lobbyistId),
    targetIdx: index('lobbying_events_target_id_idx').on(t.targetId),
    tickIdx: index('lobbying_events_tick_id_idx').on(t.tickId),
  }),
);
```

### Design notes
- `positionShifted` is updated in Phase 2b after votes are cast — retroactively marks whether the lobby worked
- `sentimentDelta` is stored per-event (not hardcoded) to allow Bob/AGGE to influence it via intervention
- Dedup guard in Phase 1.5: skip if a `lobbyingEvents` row already exists for `(billId, targetId, tickId)`

---

## 3. `agent_deals`

```typescript
// src/modules/agents/db/schema/agentDeals.ts
import { pgTable, uuid, text, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { bills } from '@modules/legislation/db/schema/legislation';

export const agentDeals = pgTable(
  'agent_deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    initiatorId: uuid('initiator_id').notNull().references(() => agents.id),
    targetId: uuid('target_id').notNull().references(() => agents.id),
    // The primary bill this deal is anchored to
    billId: uuid('bill_id').notNull().references(() => bills.id),
    // LLM-authored natural language commitment strings
    initiatorCommitment: text('initiator_commitment').notNull(),
    targetCommitment: text('target_commitment').notNull(),
    // 'proposed' | 'accepted' | 'rejected' | 'honored' | 'broken'
    status: varchar('status', { length: 20 }).notNull().default('proposed'),
    // Set in Phase 2c after voting
    initiatorHonored: boolean('initiator_honored'),
    targetHonored: boolean('target_honored'),
    // Deals expire after 2 ticks to prevent stale commitments
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    initiatorIdx: index('agent_deals_initiator_id_idx').on(t.initiatorId),
    targetIdx: index('agent_deals_target_id_idx').on(t.targetId),
    billIdx: index('agent_deals_bill_id_idx').on(t.billId),
    statusIdx: index('agent_deals_status_idx').on(t.status),
  }),
);
```

### Design notes
- `initiatorCommitment` / `targetCommitment` are natural language — e.g. "I will vote YEA on the Healthcare Reform Act"
- `expiresAt` is set to `NOW() + (rc.tickIntervalMs * 2)` at insert time — prevents stale deal obligations
- `initiatorHonored` / `targetHonored` nullable booleans, set in Phase 2c
- Relationship deltas on honor/breach: see [SPEC-TICK-ENGINE.md](./SPEC-TICK-ENGINE.md) Phase 2c section

---

## 4. `agent_statements`

```typescript
// src/modules/agents/db/schema/agentStatements.ts
import { pgTable, uuid, text, varchar, real, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const agentStatements = pgTable(
  'agent_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    statementText: text('statement_text').notNull(),
    // 'bill_proposed' | 'bill_passed' | 'bill_failed' | 'bill_vetoed' |
    // 'election_won' | 'election_lost' | 'deal_broken' | 'proactive'
    triggerType: varchar('trigger_type', { length: 40 }).notNull(),
    // Optional FKs — polymorphic via triggerType. Null for proactive statements
    triggerBillId: uuid('trigger_bill_id'),
    triggerElectionId: uuid('trigger_election_id'),
    triggerDealId: uuid('trigger_deal_id'),
    // Approval delta applied when the statement was issued
    approvalDelta: real('approval_delta').notNull().default(0),
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    agentIdx: index('agent_statements_agent_id_idx').on(t.agentId),
    triggerTypeIdx: index('agent_statements_trigger_type_idx').on(t.triggerType),
    createdAtIdx: index('agent_statements_created_at_idx').on(t.createdAt),
  }),
);
```

### Design notes
- **Not** `agentMessages` — statements have no `threadId`, don't go through `computeForumRouting`, don't appear in forum UI
- Three optional trigger FK columns instead of a JSONB blob — allows efficient filtering by trigger type on the UI
- `isPublic` reserved for future private/internal statements (e.g. Bob intervention logs)

---

## 5. Column addition to `bills`

Add one nullable timestamp column to the existing `bills` table:

```sql
-- src/core/db/migrations/0025_bills_withdrawn_at.sql
ALTER TABLE bills ADD COLUMN withdrawn_at TIMESTAMPTZ;
```

In `src/modules/legislation/db/schema/legislation.ts`, add to the `bills` table definition:

```typescript
withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
```

### Why a column instead of a status
`status = 'withdrawn'` is already sufficient to gate behavior. The `withdrawnAt` timestamp is added for:
- Display: "Withdrawn on [date]" in the bill detail withdrawal banner
- Sorting/filtering: bills withdrawn in this session vs. all time
- Audit trail: distinct from `lastActionAt` which changes on every status transition

---

## Migration Files

Create these in order. Never edit existing migrations.

```
src/core/db/migrations/0021_bill_amendments.sql
src/core/db/migrations/0022_lobbying_events.sql
src/core/db/migrations/0023_agent_deals.sql
src/core/db/migrations/0024_agent_statements.sql
src/core/db/migrations/0025_bills_withdrawn_at.sql
```

After applying all migrations:
```bash
pnpm drizzle-kit generate  # if using schema-first
pnpm drizzle-kit migrate   # apply to target DB
```

On fresh DBs: use `pnpm drizzle-kit push --force` (same pattern as current setup).

---

## `schema/index.ts` additions

```typescript
// Add to src/core/db/schema/index.ts
export { billAmendments } from '@modules/legislation/db/schema/amendments';
export { lobbyingEvents } from '@modules/legislation/db/schema/lobbying';
export { agentDeals } from '@modules/agents/db/schema/agentDeals';
export { agentStatements } from '@modules/agents/db/schema/agentStatements';
```
