import { pgTable, uuid, text, varchar, real, timestamp, index } from 'drizzle-orm/pg-core';
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
