import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { agents } from '../../../agents/db/schema/agents';
import { forumThreads } from './forumThreads';

export type AgentMessageType = 'memo' | 'statement' | 'forum_post' | 'forum_reply' | 'debate_turn' | 'email';

export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 30 }).notNull(),
  fromAgentId: uuid('from_agent_id').references(() => agents.id),
  toAgentIds: text('to_agent_ids').notNull().default('[]'),
  subject: varchar('subject', { length: 300 }),
  body: text('body').notNull(),
  threadId: uuid('thread_id').references(() => forumThreads.id),
  parentId: uuid('parent_id'),
  relatedBillId: uuid('related_bill_id'),
  relatedElectionId: uuid('related_election_id'),
  isPublic: boolean('is_public').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});
