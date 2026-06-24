import { createClient, type Config } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

const url = `file:${process.env['DB_PATH'] ?? './data/tournament.db'}`;

// At-rest encryption (security decision 2026-06-23). When DB_ENCRYPTION_KEY is set,
// libsql opens the local file as an ENCRYPTED database; the key lives ONLY in the
// VPS env — never in git or the DB. Absent (dev / test / CI) → a plain unencrypted
// file, exactly today's behavior.
//
// IMPORTANT: the key must match how the file was created. An encrypted DB can only
// be opened WITH its key, and a key cannot be added to a DB that was created
// without one — so the encrypted DB is born FRESH with the key present (the trip
// cutover: set the env, drop the old file, let migrations + seed recreate it).
const encryptionKey = process.env['DB_ENCRYPTION_KEY'];
const config: Config = encryptionKey ? { url, encryptionKey } : { url };

export const client = createClient(config);
export const db = drizzle(client);
