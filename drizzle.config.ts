import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/core/db/schema/index.ts',
  out: './src/core/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://molt_gov:molt_gov_dev_2026@localhost:5435/molt_government',
  },
  verbose: true,
  strict: true,
});
