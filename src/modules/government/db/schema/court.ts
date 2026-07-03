import { pgTable, uuid, varchar, text, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';
import { laws } from '@modules/legislation/db/schema/legislation';
import { agentDeals } from '@modules/agents/db/schema/agentDeals';
import { governmentEvents } from './governmentEvents';

/* ---- Phase 4 judicial arc — case-centric court model. -------------------
   Replaces same-tick judicial_reviews with multi-tick cases that move
   through a 5-stage arc (filed → docketed → argued → deliberating →
   decided/dismissed). Stage gates are TICK NUMBERS (filedTick/hearingTick/
   decidedTick — the fiscal enactedTick pattern), never wall-clock, so the
   arc survives tick-interval changes and restarts. judicial_reviews /
   judicial_votes stop receiving writes but stay readable (archive).       */

export type CourtCaseType = 'constitutional_challenge' | 'agent_dispute';
export type CourtCaseStatus = 'filed' | 'docketed' | 'argued' | 'deliberating' | 'decided' | 'dismissed';
export type CourtCaseOutcome = 'struck_down' | 'upheld' | 'petitioner' | 'respondent' | 'dismissed';
export type CourtCaseEventType =
  | 'filing'
  | 'docketed'
  | 'hearing_scheduled'
  | 'oral_argument'
  | 'justice_question'
  | 'deliberation'
  | 'majority_opinion'
  | 'dissent'
  | 'ruling'
  | 'dismissed'
  | 'postponed';

export const courtCases = pgTable(
  'court_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Format AB-{filedTick}-{seq}. UNIQUE backstops same-tick refiling under
    // tick re-runs: an identical re-run computes the same seq and conflicts.
    caseNumber: varchar('case_number', { length: 20 }).notNull(),
    // Challenge: "{Petitioner} v. Agora"; dispute: "{Petitioner} v. {Respondent}"
    caption: varchar('caption', { length: 200 }).notNull(),
    caseType: varchar('case_type', { length: 30 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('filed'),
    // Null for agent disputes
    lawId: uuid('law_id').references(() => laws.id),
    // Durable source of dispute facts — commitments are re-fetched from
    // agent_deals at prompt-build time (brokenDealsThisTick is per-tick memory)
    dealId: uuid('deal_id').references(() => agentDeals.id),
    petitionerId: uuid('petitioner_id').notNull().references(() => agents.id),
    respondentId: uuid('respondent_id').references(() => agents.id),
    questionPresented: text('question_presented'),
    filingText: text('filing_text'),
    // Tick-number stage gates — Day N is authoritative, never wall-clock
    filedTick: integer('filed_tick').notNull(),
    hearingTick: integer('hearing_tick'),
    decidedTick: integer('decided_tick'),
    hearingEventId: uuid('hearing_event_id').references(() => governmentEvents.id),
    outcome: varchar('outcome', { length: 20 }),
    majorityOpinion: text('majority_opinion'),
    majorityAuthorId: uuid('majority_author_id').references(() => agents.id),
    // JSON int array as text, validated against real article numbers
    majorityCitations: text('majority_citations'),
    dissentOpinion: text('dissent_opinion'),
    dissentAuthorId: uuid('dissent_author_id').references(() => agents.id),
    dissentCitations: text('dissent_citations'),
    // "For" = petitioner side (strike / petitioner-wins)
    votesFor: integer('votes_for').default(0),
    votesAgainst: integer('votes_against').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => ({
    caseNumberUnique: unique('court_cases_case_number_unique').on(t.caseNumber),
  }),
);

export const courtCaseEvents = pgTable('court_case_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => courtCases.id),
  tick: integer('tick').notNull(),
  type: varchar('type', { length: 30 }).notNull(),
  actorId: uuid('actor_id').references(() => agents.id),
  role: varchar('role', { length: 20 }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const courtCaseVotes = pgTable('court_case_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => courtCases.id),
  justiceId: uuid('justice_id').notNull().references(() => agents.id),
  // Challenge: 'strike' | 'uphold'; dispute: 'petitioner' | 'respondent'
  vote: varchar('vote', { length: 20 }).notNull(),
  reasoning: text('reasoning'),
  // JSON int array as text, validated against real article numbers
  citedArticles: text('cited_articles'),
  castAt: timestamp('cast_at', { withTimezone: true }).notNull().defaultNow(),
});
