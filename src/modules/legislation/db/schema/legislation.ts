import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';

export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 200 }).notNull(),
  summary: text('summary').notNull(),
  fullText: text('full_text').notNull(),
  sponsorId: uuid('sponsor_id')
    .notNull()
    .references(() => agents.id),
  coSponsorIds: text('co_sponsor_ids').notNull().default('[]'),
  committee: varchar('committee', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('proposed'),
  billType: varchar('bill_type', { length: 20 }).notNull().default('original'),
  amendsLawId: uuid('amends_law_id'),
  committeeDecision: varchar('committee_decision', { length: 20 }),
  committeeChairId: uuid('committee_chair_id').references(() => agents.id),
  presidentialVetoedById: uuid('presidential_vetoed_by_id').references(() => agents.id),
  vetoedAt: timestamp('vetoed_at', { withTimezone: true }),
  introducedAt: timestamp('introduced_at', { withTimezone: true }).notNull().defaultNow(),
  lastActionAt: timestamp('last_action_at', { withTimezone: true }).notNull().defaultNow(),
});

export const laws = pgTable('laws', {
  id: uuid('id').primaryKey().defaultRandom(),
  billId: uuid('bill_id')
    .notNull()
    .references(() => bills.id)
    .unique(),
  title: varchar('title', { length: 200 }).notNull(),
  text: text('text').notNull(),
  enactedDate: timestamp('enacted_date', { withTimezone: true }).notNull().defaultNow(),
  isActive: boolean('is_active').notNull().default(true),
  amendmentHistory: text('amendment_history').notNull().default('[]'),
});

export const billVotes = pgTable('bill_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  billId: uuid('bill_id')
    .notNull()
    .references(() => bills.id),
  voterId: uuid('voter_id')
    .notNull()
    .references(() => agents.id),
  choice: varchar('choice', { length: 20 }).notNull(),
  castAt: timestamp('cast_at', { withTimezone: true }).notNull().defaultNow(),
});
