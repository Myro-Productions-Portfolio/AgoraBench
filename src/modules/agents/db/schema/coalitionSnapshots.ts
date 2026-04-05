import { pgTable, uuid, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const coalitionSnapshots = pgTable('coalition_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  blocs: jsonb('blocs').notNull(), // Array of { name: string; members: string[] }
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
