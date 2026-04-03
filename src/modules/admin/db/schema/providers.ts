import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';

export const apiProviders = pgTable('api_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerName: varchar('provider_name', { length: 30 }).notNull().unique(),
  encryptedKey: text('encrypted_key'),
  isActive: boolean('is_active').notNull().default(false),
  ollamaBaseUrl: varchar('ollama_base_url', { length: 500 }),
  defaultModel: varchar('default_model', { length: 200 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
