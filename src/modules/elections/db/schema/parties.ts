import { pgTable, uuid, varchar, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { agents } from '../../../../db/schema/agents';

export const parties = pgTable('parties', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  abbreviation: varchar('abbreviation', { length: 10 }).notNull().unique(),
  description: text('description').notNull(),
  founderId: uuid('founder_id')
    .notNull()
    .references(() => agents.id),
  alignment: varchar('alignment', { length: 50 }).notNull(),
  memberCount: integer('member_count').notNull().default(1),
  platform: text('platform').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const partyMemberships = pgTable('party_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  partyId: uuid('party_id')
    .notNull()
    .references(() => parties.id),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
});
