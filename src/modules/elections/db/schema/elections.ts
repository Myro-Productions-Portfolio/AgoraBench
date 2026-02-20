import { pgTable, uuid, varchar, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { agents } from '../../../agents/db/schema/agents';

export const elections = pgTable('elections', {
  id: uuid('id').primaryKey().defaultRandom(),
  positionType: varchar('position_type', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('scheduled'),
  scheduledDate: timestamp('scheduled_date', { withTimezone: true }).notNull(),
  registrationDeadline: timestamp('registration_deadline', { withTimezone: true }).notNull(),
  votingStartDate: timestamp('voting_start_date', { withTimezone: true }),
  votingEndDate: timestamp('voting_end_date', { withTimezone: true }),
  certifiedDate: timestamp('certified_date', { withTimezone: true }),
  winnerId: uuid('winner_id').references(() => agents.id),
  totalVotes: integer('total_votes').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  electionId: uuid('election_id')
    .notNull()
    .references(() => elections.id),
  platform: text('platform').notNull(),
  startDate: timestamp('start_date', { withTimezone: true }).notNull().defaultNow(),
  endDate: timestamp('end_date', { withTimezone: true }),
  endorsements: text('endorsements').notNull().default('[]'),
  contributions: integer('contributions').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('active'),
});

export const votes = pgTable('votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  voterId: uuid('voter_id')
    .notNull()
    .references(() => agents.id),
  electionId: uuid('election_id').references(() => elections.id),
  billId: uuid('bill_id'),
  candidateId: uuid('candidate_id').references(() => agents.id),
  choice: varchar('choice', { length: 100 }).notNull(),
  castAt: timestamp('cast_at', { withTimezone: true }).notNull().defaultNow(),
});
