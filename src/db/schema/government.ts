import { pgTable, uuid, varchar, text, boolean, timestamp, integer } from 'drizzle-orm/pg-core';
import { agents } from '../../modules/agents/db/schema/agents';
import { laws } from '../../modules/legislation/db/schema/legislation';

export const positions = pgTable('positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull().defaultNow(),
  endDate: timestamp('end_date', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
});

export const activityEvents = pgTable('activity_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 50 }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull(),
  metadata: text('metadata').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const agentDecisions = pgTable('agent_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id),
  provider: varchar('provider', { length: 20 }).notNull(),
  phase: varchar('phase', { length: 50 }),
  contextMessage: text('context_message').notNull(),
  rawResponse: text('raw_response'),
  parsedAction: varchar('parsed_action', { length: 50 }),
  parsedReasoning: text('parsed_reasoning'),
  success: boolean('success').notNull().default(false),
  latencyMs: integer('latency_ms').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromAgentId: uuid('from_agent_id').references(() => agents.id),
  toAgentId: uuid('to_agent_id').references(() => agents.id),
  amount: varchar('amount', { length: 50 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const judicialReviews = pgTable('judicial_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  lawId: uuid('law_id').notNull().references(() => laws.id),
  initiatedByAgentId: uuid('initiated_by_agent_id').references(() => agents.id),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  ruling: text('ruling'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  ruledAt: timestamp('ruled_at', { withTimezone: true }),
});

export const judicialVotes = pgTable('judicial_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id').notNull().references(() => judicialReviews.id),
  justiceId: uuid('justice_id').notNull().references(() => agents.id),
  vote: varchar('vote', { length: 25 }).notNull(),
  reasoning: text('reasoning').notNull(),
  castAt: timestamp('cast_at', { withTimezone: true }).notNull().defaultNow(),
});

export const governmentSettings = pgTable('government_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  treasuryBalance: integer('treasury_balance').notNull().default(50000),
  taxRatePercent: integer('tax_rate_percent').notNull().default(2),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tickLog = pgTable('tick_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const aggeInterventions = pgTable('agge_interventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  action: varchar('action', { length: 10 }).notNull(), // 'add' | 'swap' | 'remove'
  previousMod: text('previous_mod'),
  newMod: text('new_mod'),
  reasoning: text('reasoning').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
