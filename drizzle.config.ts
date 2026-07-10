import { defineConfig } from 'drizzle-kit'

// Migration generation only (`pnpm db:generate`); the app runs migrations itself
// at boot (src/main/db/index.ts). dbCredentials here point at a scratch path —
// drizzle-kit never touches the real workspace.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
})
