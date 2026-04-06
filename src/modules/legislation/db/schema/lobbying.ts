import { pgTable, uuid, text, varchar, boolean, real, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';
import { bills } from './legislation';

export const lobbyingEvents = pgTable(
  'lobbying_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lobbyistId: uuid('lobbyist_id').notNull().references(() => agents.id),
    targetId: uuid('target_id').notNull().references(() => agents.id),
    billId: uuid('bill_id').notNull().references(() => bills.id),
    // LLM-generated persuasion argument
    argument: text('argument').notNull(),
    // What vote the lobbyist wanted
    desiredVote: varchar('desired_vote', { length: 10 }).notNull(), // 'yea' | 'nay'
    // Set after Phase 2 voting: did the target vote as requested?
    positionShifted: boolean('position_shifted').notNull().default(false),
    // Relationship delta applied to agentRelationships.sentiment after this event
    sentimentDelta: real('sentiment_delta').notNull().default(0.03),
    // Integer tick counter from tickLog for dedup and history
    tickId: integer('tick_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    billIdx: index('lobbying_events_bill_id_idx').on(t.billId),
    lobbyistIdx: index('lobbying_events_lobbyist_id_idx').on(t.lobbyistId),
    targetIdx: index('lobbying_events_target_id_idx').on(t.targetId),
    tickIdx: index('lobbying_events_tick_id_idx').on(t.tickId),
  }),
);
