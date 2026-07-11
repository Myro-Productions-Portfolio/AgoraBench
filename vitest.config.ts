import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@modules': path.resolve(__dirname, 'src/modules'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@shared': path.resolve(__dirname, 'src/core/shared'),
      '@db': path.resolve(__dirname, 'src/core/db'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    /* Unit tests import pure helpers from route modules that transitively load
       src/core/db/connection.ts, which now hard-fails when DATABASE_URL is unset
       (no more hardcoded dev-password fallback). Provide a dummy URL so imports
       resolve — no test opens a real connection. */
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    },
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.{ts,tsx}'],
    },
    setupFiles: ['tests/setup.ts'],
  },
});
