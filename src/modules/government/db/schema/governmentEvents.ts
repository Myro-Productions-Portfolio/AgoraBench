import { pgTable, uuid, varchar, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';

export type GovernmentEventType =
  | 'committee_hearing'
  | 'floor_session'
  | 'cabinet_meeting'
  | 'press_briefing'
  | 'judicial_hearing'
  | 'party_caucus'
  | 'election_rally'
  | 'budget_session'
  | 'constitutional_review';

export const governmentEvents = pgTable('government_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull().default(''),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(60),
  locationBuildingId: varchar('location_building_id', { length: 50 }),
  organizerId: uuid('organizer_id').references(() => agents.id),
  attendeeIds: text('attendee_ids').notNull().default('[]'),
  status: varchar('status', { length: 20 }).notNull().default('scheduled'),
  outcome: text('outcome'),
  relatedBillId: uuid('related_bill_id'),
  relatedElectionId: uuid('related_election_id'),
  isPublic: boolean('is_public').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
