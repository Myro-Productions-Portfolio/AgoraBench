import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const agentMemorySummaries = pgTable('agent_memory_summaries', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  summary: text('summary').notNull(),
  decisionsFrom: timestamp('decisions_from').notNull(),
  decisionsTo: timestamp('decisions_to').notNull(),
  decisionCount: integer('decision_count').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
