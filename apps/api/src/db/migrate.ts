import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Migrations folder is copied to dist/db/migrations/ in the Dockerfile
const migrationsFolder = join(__dirname, './migrations');

await migrate(db, { migrationsFolder });
console.log('Wolf Cup: migrations applied.');
process.exit(0);
