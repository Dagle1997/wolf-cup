/**
 * Seed script: inserts admin users (Jason + Josh) with bcrypt-hashed passwords.
 * Idempotent — safe to re-run.
 *
 * Usage:  pnpm seed
 * Env:    ADMIN_JASON_PASSWORD  (fallback: 'changeme-jason' for local dev)
 *         ADMIN_JOSH_PASSWORD   (fallback: 'changeme-josh' for local dev)
 */

import bcrypt from 'bcrypt';
import { db } from './index.js';
import { admins } from './schema.js';
import { eq } from 'drizzle-orm';

const BCRYPT_ROUNDS = 12;

async function upsertAdmin(username: string, password: string): Promise<void> {
  const existing = await db
    .select({ id: admins.id })
    .from(admins)
    .where(eq(admins.username, username))
    .get();

  if (existing) {
    console.log(`  ✓ Admin '${username}' already exists — skipping`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await db.insert(admins).values({
    username,
    passwordHash,
    createdAt: Date.now(),
  });
  console.log(`  ✓ Admin '${username}' created`);
}

async function main(): Promise<void> {
  console.log('Seeding Wolf Cup database...');

  const jasonPassword =
    process.env['ADMIN_JASON_PASSWORD'] ?? 'changeme-jason';
  const joshPassword = process.env['ADMIN_JOSH_PASSWORD'] ?? 'changeme-josh';

  await upsertAdmin('jason', jasonPassword);
  await upsertAdmin('josh', joshPassword);

  console.log('Done.');
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
