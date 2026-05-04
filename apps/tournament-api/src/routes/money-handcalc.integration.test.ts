/**
 * T6-9 — Hand-calc Pinehurst money fixture, HTTP roundtrip.
 *
 * Seeds the fixture's full entity graph (courses, events, rounds, groups,
 * pairings, players, rule sets, sub-games, individual bets), commits
 * scores via the real POST /api/rounds/:roundId/holes/:holeNumber/scores
 * route under the assigned scorer's session, finalizes each round via
 * POST /api/rounds/:roundId/finalize, then asserts GET /api/events/
 * :eventId/money returns the hand-derived money matrix byte-for-byte.
 *
 * Pending-state pattern (per spec AC-4, AC-6):
 *   - Suite is wrapped in describe.skip until fixture.expected.verifiedBy
 *     is set + verifiedDate matches /^\d{4}-\d{2}-\d{2}$/.
 *   - All `vi.mock`, DB seeding, and app construction lives INSIDE the
 *     describe block — module scope is read-only-ish (codex re-run #2).
 *
 * DB connection sharing: vi.mock('../db/index.js') with file::memory:?
 * cache=shared injects one client across seed + routes (codex finding #7).
 */

import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import fixture from '../engine/__fixtures__/pinehurst-hand-calc.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Verification predicate (mirrors engine-level test for consistency).
// ---------------------------------------------------------------------------

interface PendingExpected {
  verifiedBy: string | null;
  verifiedDate: string | null;
  matrixCents: Record<string, Record<string, number>> | null;
  totalsCents: Record<string, number> | null;
  skinsResults: unknown;
  betResults: unknown;
}

function isVerified(expected: PendingExpected): boolean {
  const v = expected.verifiedBy;
  const d = expected.verifiedDate;
  return (
    typeof v === 'string' &&
    v.trim().length > 0 &&
    typeof d === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(d)
  );
}

function assertFixtureExpectedShape(expected: PendingExpected): void {
  const required = ['matrixCents', 'totalsCents', 'skinsResults', 'betResults'] as const;
  for (const field of required) {
    if (expected[field] === null || expected[field] === undefined) {
      throw new Error(
        `T6-9 fixture verifiedBy is set but expected.${field} is null/undefined; complete the hand-calc before activating the gate.`,
      );
    }
  }
}

const verified = isVerified(fixture.expected as PendingExpected);
const suiteTitle = verified
  ? 'T6-9 Pinehurst hand-calc money fixture (HTTP roundtrip)'
  : 'T6-9 Pinehurst hand-calc money fixture (HTTP roundtrip) [SKIPPED — AWAITING JOSH HAND-CALC VERIFICATION; fill in fixture.expected.* and set verifiedBy + verifiedDate (YYYY-MM-DD)]';
const describeFn = verified ? describe : describe.skip;

if (!verified) {
  // eslint-disable-next-line no-console
  console.warn(
    '[T6-9] Pinehurst hand-calc fixture is UNVERIFIED; release-gate HTTP roundtrip test is SKIPPED. See _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md',
  );
}

// ---------------------------------------------------------------------------
// All side-effectful setup lives inside describeFn(...). Module scope
// performs only fixture parse + isVerified eval (codex re-run #2).
// ---------------------------------------------------------------------------

describeFn(suiteTitle, () => {
  test('GET /money returns matrix matching hand-calculated expected (deep equality)', async () => {
    // Defense-in-depth: fixture-shape guard (codex impl finding #3).
    assertFixtureExpectedShape(fixture.expected as PendingExpected);

    // ── Lazy imports — only loaded when suite is active. ──────────────
    const { createClient } = await import('@libsql/client');
    const { drizzle } = await import('drizzle-orm/libsql');
    const { migrate } = await import('drizzle-orm/libsql/migrator');
    const { Hono } = await import('hono');
    const { vi } = await import('vitest');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const migrationsFolder = resolve(__dirname, '../db/migrations');

    let __testPlayer: { id: string; isOrganizer: boolean } | null = null;
    let __testClient: ReturnType<typeof createClient> | null = null;

    // Reset module cache BEFORE doMock so prior test files' imports of
    // db/index.js don't leak through (codex re-run #2 — order-dependence
    // mitigation). Without this, a prior test that imported db/index.js
    // could cause our doMock to silently no-op.
    vi.resetModules();

    vi.doMock('../db/index.js', async () => {
      const client = createClient({ url: 'file::memory:?cache=shared' });
      __testClient = client;
      const db = drizzle(client);
      await client.execute('PRAGMA foreign_keys = ON');
      return { client, db };
    });
    vi.doMock('../middleware/require-session.js', () => ({
      requireSession: async (
        c: import('hono').Context,
        next: () => Promise<void>,
      ) => {
        if (!__testPlayer) {
          return c.json({ error: 'unauthorized', code: 'no_test_player' }, 401);
        }
        c.set('player', __testPlayer);
        c.set('session', { sessionId: 'test', playerId: __testPlayer.id });
        await next();
      },
    }));

    // Wrap the entire body — including seed + roundtrip + assertions — in
    // try/finally so resource cleanup runs even on early failure (codex
    // re-run #1 HIGH).
    try {

    const { db } = await import('../db/index.js');
    const schema = await import('../db/schema/index.js');
    const { scoresRouter } = await import('./scores.js');
    const { roundLifecycleRouter } = await import('./round-lifecycle.js');
    const { moneyRouter } = await import('./money.js');
    const { requestIdMiddleware } = await import('../middleware/request-id.js');

    await migrate(db, { migrationsFolder });

    const TENANT_ID = 'guyan';
    const now = Date.now();

    // ── Mint UUIDs for fixture's stable IDs (P1..P4, R1..R4, BET1, BET2)
    const playerUuid: Record<string, string> = {};
    for (const p of fixture.players) playerUuid[p.id] = randomUUID();
    const roundUuid: Record<string, { roundId: string; eventRoundId: string }> = {};
    for (const r of fixture.rounds) {
      roundUuid[`R${r.roundNumber}`] = {
        roundId: randomUUID(),
        eventRoundId: randomUUID(),
      };
    }
    const betUuid: Record<string, string> = {};
    for (const b of fixture.bets) betUuid[b.id] = randomUUID();

    const organizerId = randomUUID();
    const eventId = randomUUID();
    const courseId = randomUUID();
    const courseRevId = randomUUID();
    const ruleSetId = randomUUID();
    const revisionId = randomUUID();
    const ctx = `event:${eventId}`;

    // ── Seed players (organizer + 4 fixture players) ──────────────────
    // Note: route auth uses isEventOrganizer(events.organizerPlayerId), not
    // players.isOrganizer; setting the flag here matches the mocked
    // session for any future route that consults the DB column (codex
    // re-run #5 LOW).
    await db.insert(schema.players).values({
      id: organizerId, isOrganizer: true, createdAt: now,
      name: 'Organizer', manualHandicapIndex: 0,
      tenantId: TENANT_ID, contextId: ctx,
    });
    for (const p of fixture.players) {
      await db.insert(schema.players).values({
        id: playerUuid[p.id]!, isOrganizer: false, createdAt: now,
        name: p.name, manualHandicapIndex: p.handicapIndex,
        tenantId: TENANT_ID, contextId: ctx,
      });
    }

    // ── Seed course/revision/tee/holes ─────────────────────────────────
    await db.insert(schema.courses).values({
      id: courseId, name: 'Pinehurst Hand-Calc Test', clubName: 'T6-9 CC',
      createdAt: now, tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
    });
    await db.insert(schema.courseRevisions).values({
      id: courseRevId, courseId, revisionNumber: 1,
      sourceUrl: null, extractionDate: null, verified: true,
      outTotal: fixture.course.holes.slice(0, 9).reduce((s, h) => s + h.par, 0),
      inTotal:  fixture.course.holes.slice(9).reduce((s, h) => s + h.par, 0),
      courseTotal: fixture.course.tee.coursePar,
      createdAt: now, tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
    });
    await db.insert(schema.courseTees).values({
      id: randomUUID(), courseRevisionId: courseRevId, teeColor: 'blue',
      rating: fixture.course.tee.ratingTimes10, slope: fixture.course.tee.slope,
      tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
    });
    for (const h of fixture.course.holes) {
      await db.insert(schema.courseHoles).values({
        id: randomUUID(), courseRevisionId: courseRevId,
        holeNumber: h.holeNumber, par: h.par, si: h.strokeIndex,
        yardagePerTeeJson: '{}',
        tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
      });
    }

    // ── Seed event, ruleSet ────────────────────────────────────────────
    await db.insert(schema.events).values({
      id: eventId, name: 'T6-9 Hand-Calc', startDate: now, endDate: now + 4 * 86400000,
      timezone: 'America/New_York', organizerPlayerId: organizerId,
      createdAt: now, tenantId: TENANT_ID, contextId: ctx,
    });
    await db.insert(schema.ruleSets).values({
      id: ruleSetId, name: 'T6-9', createdAt: now,
      tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
    });
    await db.insert(schema.ruleSetRevisions).values({
      id: revisionId, ruleSetId, revisionNumber: 1,
      configJson: JSON.stringify({
        ...fixture.bestBallConfig,
        autoPressTriggerAtNDown: null,
        pressMultiplier: 2,
      }),
      effectiveFromRoundId: null, effectiveFromHole: 1,
      createdByPlayerId: organizerId, reason: null, createdAt: now,
      tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
    });

    // ── Per-round seeding (eventRound, round, group, members, pairing,
    //     pairingMembers, scorerAssignment, roundState, sub-game) ─────
    for (const r of fixture.rounds) {
      const ru = roundUuid[`R${r.roundNumber}`]!;
      await db.insert(schema.eventRounds).values({
        id: ru.eventRoundId, eventId, roundNumber: r.roundNumber, roundDate: now + r.roundNumber * 86400000,
        courseRevisionId: courseRevId, teeColor: 'blue', holesToPlay: 18,
        createdAt: now, tenantId: TENANT_ID, contextId: ctx,
      });
      await db.insert(schema.rounds).values({
        id: ru.roundId, eventId, eventRoundId: ru.eventRoundId,
        holesToPlay: 18, createdAt: now,
        tenantId: TENANT_ID, contextId: ctx,
      });
      await db.insert(schema.roundStates).values({
        roundId: ru.roundId, state: 'in_progress', enteredAt: now,
        tenantId: TENANT_ID, contextId: ctx,
      });
      const groupId = randomUUID();
      await db.insert(schema.groups).values({
        id: groupId, eventId, name: `R${r.roundNumber}-G1`,
        moneyVisibilityMode: 'open', createdAt: now,
        tenantId: TENANT_ID, contextId: ctx,
      });
      for (const p of fixture.players) {
        await db.insert(schema.groupMembers).values({
          groupId, playerId: playerUuid[p.id]!,
          tenantId: TENANT_ID, contextId: ctx,
        });
      }
      const pairingId = randomUUID();
      await db.insert(schema.pairings).values({
        id: pairingId, eventRoundId: ru.eventRoundId, foursomeNumber: 1,
        createdAt: now, tenantId: TENANT_ID, contextId: ctx,
      });
      const slotOrder = [...r.pairings.teamA, ...r.pairings.teamB];
      for (let i = 0; i < 4; i++) {
        await db.insert(schema.pairingMembers).values({
          pairingId, playerId: playerUuid[slotOrder[i]!]!, slotNumber: i + 1,
          tenantId: TENANT_ID, contextId: ctx,
        });
      }
      // Designate P1 as the scorer for the foursome.
      await db.insert(schema.scorerAssignments).values({
        roundId: ru.roundId, foursomeNumber: 1,
        scorerPlayerId: playerUuid['P1']!,
        assignedAt: now, assignedByPlayerId: organizerId,
        tenantId: TENANT_ID, contextId: ctx,
      });

      // Sub-game: skins, gross mode, all 4 players.
      const skinsSubGameId = randomUUID();
      await db.insert(schema.subGames).values({
        id: skinsSubGameId, eventRoundId: ru.eventRoundId, type: 'skins',
        configJson: JSON.stringify({
          mode: fixture.skinsConfig.mode,
          lastHoleUnclaimedResolution: fixture.skinsConfig.lastHoleUnclaimedResolution,
        }),
        buyInPerParticipant: fixture.skinsConfig.buyInPerParticipantCents,
        createdAt: now, tenantId: TENANT_ID, contextId: ctx,
      });
      for (const p of fixture.players) {
        await db.insert(schema.subGameParticipants).values({
          subGameId: skinsSubGameId, playerId: playerUuid[p.id]!,
          optedInAt: now, tenantId: TENANT_ID, contextId: ctx,
        });
      }
    }

    // ── Individual bets + bet-rounds ───────────────────────────────────
    for (const b of fixture.bets) {
      await db.insert(schema.individualBets).values({
        id: betUuid[b.id]!, eventId,
        playerAId: playerUuid[b.playerAId]!,
        playerBId: playerUuid[b.playerBId]!,
        betType: b.betType, configJson: JSON.stringify(b.config),
        stakePerHoleCents: b.stakePerHoleCents,
        createdByPlayerId: organizerId, createdAt: now,
        tenantId: TENANT_ID, contextId: ctx,
      });
      for (const rn of b.applicableRounds) {
        const ru = roundUuid[`R${rn}`]!;
        await db.insert(schema.individualBetRounds).values({
          betId: betUuid[b.id]!, eventRoundId: ru.eventRoundId,
          tenantId: TENANT_ID, contextId: ctx,
        });
      }
    }

    // ── (AC-4a) Seed sanity check — read back the event row. ──────────
    const seededEvents = await db
      .select()
      .from(schema.events);
    expect(seededEvents.length).toBe(1);
    expect(seededEvents[0]!.id).toBe(eventId);

    // ── Build app + request helpers ────────────────────────────────────
    function buildApp(asPlayerId: string, isOrganizer = false): import('hono').Hono {
      __testPlayer = { id: asPlayerId, isOrganizer };
      const app = new Hono();
      app.use('*', requestIdMiddleware);
      app.route('/api/rounds', scoresRouter);
      app.route('/api/rounds', roundLifecycleRouter);
      app.route('/api/events', moneyRouter);
      return app;
    }

    // ── Per-round: POST scores via real route, complete, finalize ─────
    for (const r of fixture.rounds) {
      const ru = roundUuid[`R${r.roundNumber}`]!;
      const scorerApp = buildApp(playerUuid['P1']!);
      for (const s of r.holeScores) {
        const res = await scorerApp.request(
          `/api/rounds/${ru.roundId}/holes/${s.holeNumber}/scores`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              playerId: playerUuid[s.playerId]!,
              grossStrokes: s.grossStrokes,
              putts: s.putts ?? null,
              clientEventId: `t69-r${r.roundNumber}-${s.playerId}-h${s.holeNumber}`,
            }),
          },
        );
        if (res.status !== 200 && res.status !== 201) {
          const body = await res.text();
          throw new Error(
            `T6-9 score POST failed for R${r.roundNumber} ${s.playerId} h${s.holeNumber}: ${res.status} ${body}`,
          );
        }
      }

      // Complete (scorer-or-organizer can do this).
      const completeRes = await scorerApp.request(
        `/api/rounds/${ru.roundId}/complete`,
        { method: 'POST' },
      );
      if (completeRes.status !== 200) {
        const body = await completeRes.text();
        throw new Error(`T6-9 /complete failed for R${r.roundNumber}: ${completeRes.status} ${body}`);
      }

      // Finalize (organizer only).
      const orgApp = buildApp(organizerId, true);
      const finalRes = await orgApp.request(
        `/api/rounds/${ru.roundId}/finalize`,
        { method: 'POST' },
      );
      if (finalRes.status !== 200) {
        const body = await finalRes.text();
        throw new Error(`T6-9 /finalize failed for R${r.roundNumber}: ${finalRes.status} ${body}`);
      }
    }

    // ── GET /money ─────────────────────────────────────────────────────
    const viewerApp = buildApp(playerUuid['P1']!);
    const moneyRes = await viewerApp.request(`/api/events/${eventId}/money`);
    expect(moneyRes.status).toBe(200);
    const body = (await moneyRes.json()) as {
      players: Array<{ id: string; name: string }>;
      matrix: Record<string, Record<string, number>>;
      totals: Record<string, number>;
    };

    // ── Map fixture's logical IDs (P1..P4) → minted UUIDs for assertion
    const expected = fixture.expected as PendingExpected;
    const expectedMatrix = expected.matrixCents!;
    const expectedTotals = expected.totalsCents!;

    function remapMatrix(m: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
      const out: Record<string, Record<string, number>> = {};
      for (const [a, byB] of Object.entries(m)) {
        const aUuid = playerUuid[a] ?? a;
        out[aUuid] = {};
        for (const [b, cents] of Object.entries(byB)) {
          const bUuid = playerUuid[b] ?? b;
          out[aUuid][bUuid] = cents;
        }
      }
      return out;
    }
    function remapTotals(t: Record<string, number>): Record<string, number> {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(t)) {
        out[playerUuid[k] ?? k] = v;
      }
      return out;
    }

    expect(body.matrix).toEqual(remapMatrix(expectedMatrix));
    expect(body.totals).toEqual(remapTotals(expectedTotals));

    } finally {
      // Resource cleanup runs even on early failure (codex re-run #1).
      // Covers seed errors, score-POST errors, /complete or /finalize
      // failures, and assertion failures — all of which would previously
      // leak the libsql handle and risk hanging Vitest.
      if (__testClient !== null) {
        try {
          (__testClient as { close?: () => void }).close?.();
        } catch {
          /* libsql memory client may not have close(); ignore */
        }
      }
      vi.doUnmock('../db/index.js');
      vi.doUnmock('../middleware/require-session.js');
    }
  }, 60_000); // 60s timeout — 4 × (72 score POSTs + complete + finalize) is non-trivial.
});
