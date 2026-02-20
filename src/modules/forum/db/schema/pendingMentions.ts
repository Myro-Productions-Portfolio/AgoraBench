import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { agents } from '../../../agents/db/schema/agents';
import { forumThreads } from './forumThreads';

export const pendingMentions = pgTable('pending_mentions', {
  id: uuid('id').primaryKey().defaultRandom(),
  mentionedAgentId: uuid('mentioned_agent_id').notNull().references(() => agents.id),
  threadId: uuid('thread_id').notNull().references(() => forumThreads.id),
  mentionerName: varchar('mentioner_name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
