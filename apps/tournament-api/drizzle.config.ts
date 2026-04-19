import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'turso',
  schema: './src/db/schema/*',
  out: './src/db/migrations',
  dbCredentials: {
    url: `file:${process.env['DB_PATH'] ?? './data/tournament.db'}`,
  },
});
