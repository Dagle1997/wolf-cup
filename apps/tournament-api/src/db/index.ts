import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

const url = `file:${process.env['DB_PATH'] ?? './data/tournament.db'}`;

export const client = createClient({ url });
export const db = drizzle(client);
