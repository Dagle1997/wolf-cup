import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Migrations folder is copied to dist/db/migrations/ in the Dockerfile
// runtime stage. Local dev + tests resolve to apps/tournament-api/src/db/
// migrations/ through the same relative path since tsc preserves the shape.
const migrationsFolder = join(__dirname, './migrations');

await migrate(db, { migrationsFolder });
console.log('Tournament API: migrations applied.');
process.exit(0);
