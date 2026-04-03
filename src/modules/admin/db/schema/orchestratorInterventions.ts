import { pgTable, uuid, varchar, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const orchestratorInterventions = pgTable('orchestrator_interventions', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: varchar('type', { length: 50 }).notNull(),
  payload: jsonb('payload').notNull(),
  result: jsonb('result'),
  reasoning: text('reasoning'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
