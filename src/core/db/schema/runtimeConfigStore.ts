import { pgTable, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const runtimeConfigStore = pgTable('runtime_config', {
  id: integer('id').primaryKey().default(1),
  config: jsonb('config').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
