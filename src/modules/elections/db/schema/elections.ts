import { pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { agents } from '@modules/agents/db/schema/agents';

/** Persisted EC summary (migration 0036) — exactly the electoralResultNote
    shape finalizeElection builds. NULL unless the EC path decided the race. */
export interface ElectionElectoralVotes {
  winnerId: string | null;
  totalEvAllocated: number;
  evByCandidate: Record<string, number>;
  reachedMajority: boolean;
}

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
  /* Tick anchors (migration 0034) — the authoritative phase schedule for
     rows created after the election-cycles slice; the timestamp columns
     above become display-only derived dates on such rows. NULL on legacy
     rows, which keep wall-clock gating until they drain. */
  createdTick: integer('created_tick'),
  registrationEndsTick: integer('registration_ends_tick'),
  votingStartTick: integer('voting_start_tick'),
  votingEndTick: integer('voting_end_tick'),
  certifiedTick: integer('certified_tick'),
  /* Electoral College results (migration 0036) — written by finalizeElection
     in the certified update, presidential EC path only; NULL otherwise.
     state_results: { [stateAbbr]: winnerAgentId }, decided states only. */
  stateResults: jsonb('state_results').$type<Record<string, string>>(),
  electoralVotes: jsonb('electoral_votes').$type<ElectionElectoralVotes>(),
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

export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    voterId: uuid('voter_id')
      .notNull()
      .references(() => agents.id),
    electionId: uuid('election_id').references(() => elections.id),
    billId: uuid('bill_id'),
    candidateId: uuid('candidate_id').references(() => agents.id),
    choice: varchar('choice', { length: 100 }).notNull(),
    castAt: timestamp('cast_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* One ballot per voter per election (E3 slice A). Partial: `votes` is a
       shared table; bill votes carry election_id = NULL and are not
       constrained (Postgres treats each NULL as distinct anyway). Mirrors
       migration 0030. */
    uniqueIndex('votes_election_voter_unique')
      .on(t.electionId, t.voterId)
      .where(sql`${t.electionId} IS NOT NULL`),
  ],
);
