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
import { admins, players, seasons, seasonStandings } from './schema.js';
import { eq } from 'drizzle-orm';
import { HISTORICAL_CHAMPIONS, HISTORICAL_STANDINGS, HISTORICAL_PLAYERS } from './history-data.js';

const BCRYPT_ROUNDS = 12;

async function upsertAdmin(username: string, password: string): Promise<void> {
  const existing = await db
    .select({ id: admins.id })
    .from(admins)
    .where(eq(admins.username, username))
    .get();

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  if (existing) {
    await db.update(admins).set({ passwordHash }).where(eq(admins.username, username));
    console.log(`  ✓ Admin '${username}' password updated`);
    return;
  }

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

  await seedHistory();

  console.log('Done.');
}

// ---------------------------------------------------------------------------
// Historical data seeding
// ---------------------------------------------------------------------------

async function ensurePlayer(name: string, isActive: number): Promise<number> {
  const existing = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.name, name))
    .get();

  if (existing) return existing.id;

  const [inserted] = await db
    .insert(players)
    .values({ name, ghinNumber: null, isActive, isGuest: 0, createdAt: Date.now() })
    .returning({ id: players.id });
  console.log(`  ✓ Player '${name}' created (isActive=${isActive})`);
  return inserted!.id;
}

async function seedHistory(): Promise<void> {
  console.log('Seeding historical data...');

  // 1. Ensure historical-only players exist
  for (const name of HISTORICAL_PLAYERS) {
    await ensurePlayer(name, 0);
  }

  // 2. Collect all unique years from champions + standings
  const allYears = new Set<number>();
  for (const c of HISTORICAL_CHAMPIONS) allYears.add(c.year);
  for (const s of HISTORICAL_STANDINGS) allYears.add(s.year);
  // Also add years that have neither champion nor standings (2017, 2021, 2024)
  for (let y = 2015; y <= 2025; y++) allYears.add(y);

  // 3. For each year, ensure season exists
  for (const year of [...allYears].sort()) {
    const existing = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.year, year))
      .get();

    let seasonId: number;
    if (existing) {
      seasonId = existing.id;
    } else {
      const [inserted] = await db
        .insert(seasons)
        .values({
          name: `${year} Season`,
          year,
          startDate: `${year}-04-01`,
          endDate: `${year}-09-30`,
          totalRounds: 0,
          playoffFormat: 'top8',
          harveyLiveEnabled: 0,
          createdAt: Date.now(),
        })
        .returning({ id: seasons.id });
      seasonId = inserted!.id;
      console.log(`  ✓ Season ${year} created`);
    }

    // 4. Set champion if known
    const champ = HISTORICAL_CHAMPIONS.find((c) => c.year === year);
    if (champ) {
      const champPlayerId = await ensurePlayer(champ.playerName, 0);
      await db
        .update(seasons)
        .set({ championPlayerId: champPlayerId })
        .where(eq(seasons.id, seasonId));
    }

    // 5. Upsert standings
    const standingsData = HISTORICAL_STANDINGS.find((s) => s.year === year);
    if (standingsData) {
      for (const entry of standingsData.standings) {
        const playerId = await ensurePlayer(entry.name, 0);
        await db
          .insert(seasonStandings)
          .values({
            seasonId,
            playerId,
            rank: entry.rank,
            points: entry.points ?? null,
            createdAt: Date.now(),
          })
          .onConflictDoUpdate({
            target: [seasonStandings.seasonId, seasonStandings.playerId],
            set: { rank: entry.rank, points: entry.points ?? null },
          });
      }
      console.log(`  ✓ Season ${year}: ${standingsData.standings.length} standings upserted`);
    }
  }
}

main().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
