import { defineConfig } from 'drizzle-kit';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Refusing to fall back to a hardcoded dev connection string. ' +
      'Set DATABASE_URL in .env (see .env.example).',
  );
}

export default defineConfig({
  schema: './src/core/db/schema/index.ts',
  out: './src/core/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
