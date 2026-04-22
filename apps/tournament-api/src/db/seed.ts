/**
 * Idempotent placeholder seed runner.
 *
 * T1-6a deliberately creates zero rows — the real Pinehurst roster seed
 * lands in T2.2. This script exists so the Dockerfile's runtime CMD can
 * chain `... && node dist/db/seed.js && ...` without failing, and so the
 * seed-on-every-container-start pattern (shared with Wolf Cup) is already
 * wired before T2.2 fills it in.
 */
async function seed(): Promise<void> {
  console.log('Tournament seed: no data at T1.6a — T2.2 adds roster.');
}

await seed();
process.exit(0);
