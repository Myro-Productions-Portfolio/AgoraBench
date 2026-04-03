import { pgTable, uuid, text, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const agentPolicyPositions = pgTable('agent_policy_positions', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  category: text('category').notNull(),
  supportCount: integer('support_count').notNull().default(0),
  opposeCount: integer('oppose_count').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('uniq_agent_policy_position').on(table.agentId, table.category),
]);
