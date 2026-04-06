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
