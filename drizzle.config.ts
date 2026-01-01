import { defineConfig } from 'drizzle-kit';
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/shared/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'better-sqlite3',
  dbCredentials: {
    url: './data/astrolabe.db',
  },
} satisfies Config;
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/astrolabe.db',
  },
  verbose: true,
  strict: true,
});
