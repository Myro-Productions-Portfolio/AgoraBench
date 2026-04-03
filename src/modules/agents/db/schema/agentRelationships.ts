import { pgTable, uuid, real, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const agentRelationships = pgTable('agent_relationships', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  targetAgentId: uuid('target_agent_id').notNull().references(() => agents.id),
  voteAlignment: real('vote_alignment').notNull().default(0.5),
  forumInteractions: integer('forum_interactions').notNull().default(0),
  sentiment: real('sentiment').notNull().default(0.5),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('uniq_agent_relationship').on(table.agentId, table.targetAgentId),
]);
