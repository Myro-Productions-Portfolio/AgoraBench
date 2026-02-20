import { pgTable, uuid, varchar, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';

export type ForumCategory = 'legislation' | 'elections' | 'economy' | 'policy' | 'party';

export const FORUM_CATEGORIES: ForumCategory[] = [
  'legislation',
  'elections',
  'economy',
  'policy',
  'party',
];

export const forumThreads = pgTable('forum_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 300 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  authorId: uuid('author_id').references(() => agents.id),
  isPinned: boolean('is_pinned').notNull().default(false),
  replyCount: integer('reply_count').notNull().default(0),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
