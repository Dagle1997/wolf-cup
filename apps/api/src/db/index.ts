import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema.js';

const dbPath = process.env['DB_PATH'] ?? './data/wolf-cup.db';

// Ensure the parent directory exists before opening the database
mkdirSync(dirname(dbPath), { recursive: true });

const client = createClient({ url: `file:${dbPath}` });

export const db = drizzle(client, { schema });
