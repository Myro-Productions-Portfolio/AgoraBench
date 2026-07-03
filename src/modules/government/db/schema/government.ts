import { pgTable, uuid, varchar, text, boolean, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';
import { laws } from '@modules/legislation/db/schema/legislation';

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

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromAgentId: uuid('from_agent_id').references(() => agents.id),
    toAgentId: uuid('to_agent_id').references(() => agents.id),
    amount: varchar('amount', { length: 50 }).notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    description: text('description').notNull(),
    /* Phase 3: links appropriation rows to the spending law so per-law
       cumulative impact is a single indexed SUM. Nullable — every legacy
       row (salaries, taxes, fees) stays NULL and is simply not law-linked. */
    relatedLawId: uuid('related_law_id').references(() => laws.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    relatedLawIdx: index('transactions_related_law_id_idx').on(t.relatedLawId),
  }),
);

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
  /* Phase 3: tick number of the last budget session (Phase 9.7). NOT NULL
     DEFAULT 0 so the first post-deploy budget check fires and re-baselines. */
  lastBudgetSessionTick: integer('last_budget_session_tick').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tickLog = pgTable('tick_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/**
 * Phase 3: one row per tick, written at the end of Phase 13 tax collection.
 * Powers the budget dashboard's treasury-over-time chart — the transactions
 * ledger cannot (amounts are varchar(50), rows carry no balance-after, and
 * tax collection inserts one row per agent per tick). O(ticks) and exact.
 * All money integer M$ like every other money column.
 */
export const fiscalTickSummaries = pgTable(
  'fiscal_tick_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tickId: uuid('tick_id').references(() => tickLog.id),
    tickNumber: integer('tick_number').notNull(),
    revenue: integer('revenue').notNull(),
    spending: integer('spending').notNull(),
    treasuryEnd: integer('treasury_end').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdAtIdx: index('fiscal_tick_summaries_created_at_idx').on(t.createdAt),
  }),
);

export const aggeInterventions = pgTable('agge_interventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  action: varchar('action', { length: 10 }).notNull(), // 'add' | 'swap' | 'remove'
  previousMod: text('previous_mod'),
  newMod: text('new_mod'),
  reasoning: text('reasoning').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
