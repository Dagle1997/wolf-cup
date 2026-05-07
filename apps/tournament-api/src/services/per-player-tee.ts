/**
 * Resolves per-player tee overrides for a round. Returns a map keyed by
 * playerId → TeeShape ({ slope, ratingTimes10, coursePar }) for every
 * member of the round's pairings whose `pairing_members.tee_color` is
 * non-null AND whose tee_color resolves to a valid `course_tees` row for
 * the round's `event_rounds.course_revision_id`.
 *
 * Players with `tee_color = NULL` are NOT included — the engine's
 * fall-back (`teeByPlayer?.[playerId] ?? course.tee`) handles them
 * naturally. Callers can always pass the result to the engine; missing
 * keys are a no-op.
 *
 * Returns `{}` (empty map) when no member has an override OR the round
 * has no pairings yet — engine treats this identically to `undefined`.
 *
 * v1 invariant: `course_revisions.courseTotal` is the par for every tee
 * on that revision (USGA per-tee par variance is rare enough that it's
 * deferred). The helper reads coursePar from `course_revisions` once.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  courseRevisions,
  courseTees,
  eventRounds,
  pairingMembers,
  pairings,
  rounds,
} from '../db/schema/index.js';
import type { TeeShape } from '../engine/handicap-strokes.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function buildTeeByPlayer(
  tx: Tx | typeof db,
  roundId: string,
  tenantId: string,
): Promise<Record<string, TeeShape>> {
  // Fetch all member rows + tee_color for this round's pairings, plus the
  // round's course_revision_id so we know which course_tees to join.
  const memberRows = await tx
    .select({
      playerId: pairingMembers.playerId,
      teeColor: pairingMembers.teeColor,
      courseRevisionId: eventRounds.courseRevisionId,
    })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairings.id, pairingMembers.pairingId))
    .innerJoin(eventRounds, eq(eventRounds.id, pairings.eventRoundId))
    .innerJoin(rounds, eq(rounds.eventRoundId, eventRounds.id))
    .where(
      and(
        eq(rounds.id, roundId),
        eq(pairingMembers.tenantId, tenantId),
        eq(pairings.tenantId, tenantId),
        eq(eventRounds.tenantId, tenantId),
        eq(rounds.tenantId, tenantId),
      ),
    );

  const overrides = memberRows.filter(
    (r): r is typeof r & { teeColor: string } => r.teeColor !== null,
  );
  if (overrides.length === 0) return {};

  // Single course revision per round (FK), so we can grab coursePar once
  // and assume it applies to every tee on this round.
  const courseRevisionId = overrides[0]!.courseRevisionId;
  const revRows = await tx
    .select({ coursePar: courseRevisions.courseTotal })
    .from(courseRevisions)
    .where(
      and(
        eq(courseRevisions.id, courseRevisionId),
        eq(courseRevisions.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (revRows.length === 0) return {};
  const coursePar = revRows[0]!.coursePar;

  // Look up slope + rating for each distinct tee_color used in overrides.
  const distinctTees = [...new Set(overrides.map((r) => r.teeColor))];
  const teeRows = await tx
    .select({
      teeColor: courseTees.teeColor,
      slope: courseTees.slope,
      rating: courseTees.rating,
    })
    .from(courseTees)
    .where(
      and(
        eq(courseTees.courseRevisionId, courseRevisionId),
        eq(courseTees.tenantId, tenantId),
      ),
    );
  const teeByColor = new Map<string, { slope: number; ratingTimes10: number }>();
  for (const t of teeRows) {
    if (distinctTees.includes(t.teeColor)) {
      teeByColor.set(t.teeColor, { slope: t.slope, ratingTimes10: t.rating });
    }
  }

  const out: Record<string, TeeShape> = {};
  for (const r of overrides) {
    const tee = teeByColor.get(r.teeColor);
    if (!tee) continue; // Guarded against orphan tee_color (shouldn't happen post-API-validation).
    out[r.playerId] = { ...tee, coursePar };
  }
  return out;
}
