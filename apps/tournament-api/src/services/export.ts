/**
 * T7-5 Raw-state JSON export service.
 *
 * Pure(ish) builder for the per-event JSON payload returned by
 * GET /api/events/:eventId/export/raw. No HTTP, no auth — the route layer
 * (routes/export.ts) wraps this with auth + headers + JSON.stringify.
 *
 * **Schema closure invariant:** every FK target id appearing in any output
 * row exists in the corresponding output table (excluding auth tables which
 * are intentionally out of scope per NFR-S2). Round-trip replay against a
 * fresh `PRAGMA foreign_keys = ON` libsql instance succeeds without
 * constraint violations.
 *
 * **Type discipline:** integer-ms timestamps emit as ISO-8601 UTC strings;
 * money cents stay integers; JSON-blob columns emit as parsed objects;
 * booleans round-trip as JSON booleans.
 *
 * **auditLog filter posture:** OR-composed per-(entity_type, entity_id-list)
 * predicates ensure correct pairing without cross-type id collisions.
 * Empty-event short-circuits to `auditLog: []` without emitting malformed
 * SQL (Drizzle's `inArray([])` is `WHERE 1=0` but `or(...[])` is undefined;
 * we filter empty id lists out before composing).
 */

import { and, eq, inArray, or } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  events,
  eventRounds,
  rounds,
  roundStates,
  scorerAssignments,
  holeScores,
  scoreCorrections,
  groups,
  groupMembers,
  invites,
  ruleSets,
  ruleSetRevisions,
  pairings,
  pairingMembers,
  individualBets,
  individualBetRounds,
  individualBetPresses,
  teamPressLog,
  subGames,
  subGameParticipants,
  subGameResults,
  galleryPhotos,
  auditLog,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  players,
} from '../db/schema/index.js';
import { computeMoneyMatrix, type MoneyMatrix } from './money.js';

type Db = typeof DbType;

const SCHEMA_VERSION = 1 as const;

/**
 * The set of audit_log entity_types this export can scope to an event.
 * MUST be kept in sync with `apps/tournament-api/src/lib/audit-log.ts`'s
 * AUDIT_ENTITY_TYPES. SESSION is intentionally excluded per NFR-S2.
 *
 * Adding a new entity_type to AUDIT_ENTITY_TYPES without extending this
 * type will cause those audit rows to silently drop from exports — the
 * integration test seeds at least one row per known type and asserts each
 * appears, so the omission fails CI loudly.
 */
type ScopedAuditEntityType =
  | 'hole_score'
  | 'round'
  | 'rule_set'
  | 'bet'
  | 'sub_game'
  | 'gallery_photo';

function msToIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // Tolerate malformed legacy rows by returning the raw string. The
    // round-trip helper handles both parsed-object and raw-string inputs.
    return s;
  }
}

export type ExportPayload = {
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  warnings: string[];
  event: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  roster: Array<Record<string, unknown>>;
  players: Array<Record<string, unknown>>;
  eventRounds: Array<Record<string, unknown>>;
  rounds: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  groupMembers: Array<Record<string, unknown>>;
  invites: Array<Record<string, unknown>>;
  ruleSets: Array<Record<string, unknown>>;
  ruleSetRevisions: Array<Record<string, unknown>>;
  courses: Array<Record<string, unknown>>;
  courseRevisions: Array<Record<string, unknown>>;
  courseTees: Array<Record<string, unknown>>;
  courseHoles: Array<Record<string, unknown>>;
  pairings: Array<Record<string, unknown>>;
  pairingMembers: Array<Record<string, unknown>>;
  holeScores: Array<Record<string, unknown>>;
  scoreCorrections: Array<Record<string, unknown>>;
  roundStates: Array<Record<string, unknown>>;
  scorerAssignments: Array<Record<string, unknown>>;
  individualBets: Array<Record<string, unknown>>;
  individualBetRounds: Array<Record<string, unknown>>;
  individualBetPresses: Array<Record<string, unknown>>;
  teamPressLog: Array<Record<string, unknown>>;
  subGames: Array<Record<string, unknown>>;
  subGameParticipants: Array<Record<string, unknown>>;
  subGameResults: Array<Record<string, unknown>>;
  galleryPhotos: Array<Record<string, unknown>>;
  auditLog: Array<Record<string, unknown>>;
  activity: Array<Record<string, unknown>>;
  moneyMatrix: MoneyMatrix;
  settleUp: { perPlayerNetCents: Record<string, number>; computedAt: string };
};

/**
 * Build the export payload for a given event. Returns null if the event
 * doesn't exist (the route layer maps that to 404).
 */
export async function buildEventExport(
  dbInstance: Db,
  eventId: string,
  tenantId: string,
): Promise<ExportPayload | null> {
  // ── (1) Fetch the event row. Null → 404 at the route layer. ──
  const eventRows = await dbInstance
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.tenantId, tenantId)))
    .limit(1);
  if (eventRows.length === 0) return null;
  const eventRow = eventRows[0]!;

  const warnings: string[] = [];

  // ── (2) Fetch event-scoped raw tables in dependency order. ──
  // Every query carries a `tenantId` filter as a defense-in-depth guard
  // against cross-tenant id reuse — a future multi-tenant deployment that
  // happens to mint an identical UUID across two tenants would otherwise
  // pull a foreign-tenant row through an event-id filter alone (codex
  // impl-round-1 Med #2). v1 single-tenant means this is a no-op in
  // practice; the structural posture matches the participant middleware's
  // tenant-scoped joins.
  const eventRoundRows = await dbInstance
    .select()
    .from(eventRounds)
    .where(and(eq(eventRounds.eventId, eventId), eq(eventRounds.tenantId, tenantId)));
  const eventRoundIds = eventRoundRows.map((r) => r.id);

  const roundRows = await dbInstance
    .select()
    .from(rounds)
    .where(and(eq(rounds.eventId, eventId), eq(rounds.tenantId, tenantId)));
  const roundIds = roundRows.map((r) => r.id);

  const groupRows = await dbInstance
    .select()
    .from(groups)
    .where(and(eq(groups.eventId, eventId), eq(groups.tenantId, tenantId)));
  const groupIds = groupRows.map((g) => g.id);

  // Detect self_only visibility — emit a warning so the export consumer knows
  // moneyMatrix may be truncated under that mode (codex spec round-1 Med #4).
  if (groupRows.some((g) => g.moneyVisibilityMode === 'self_only')) {
    warnings.push('self_only_visibility_may_truncate_money_matrix');
  }

  const groupMemberRows = groupIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(groupMembers)
        .where(
          and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.tenantId, tenantId)),
        );

  const inviteRows = await dbInstance
    .select()
    .from(invites)
    .where(and(eq(invites.eventId, eventId), eq(invites.tenantId, tenantId)));

  // ── (3) Course closure: revisions referenced by event_rounds → courses. ──
  const courseRevisionIds = Array.from(
    new Set(eventRoundRows.map((r) => r.courseRevisionId)),
  );
  const courseRevisionRows = courseRevisionIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(courseRevisions)
        .where(
          and(
            inArray(courseRevisions.id, courseRevisionIds),
            eq(courseRevisions.tenantId, tenantId),
          ),
        );
  const courseIds = Array.from(
    new Set(courseRevisionRows.map((cr) => cr.courseId)),
  );
  const courseRows = courseIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(courses)
        .where(and(inArray(courses.id, courseIds), eq(courses.tenantId, tenantId)));
  const courseTeeRows = courseRevisionIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(courseTees)
        .where(
          and(
            inArray(courseTees.courseRevisionId, courseRevisionIds),
            eq(courseTees.tenantId, tenantId),
          ),
        );
  const courseHoleRows = courseRevisionIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(courseHoles)
        .where(
          and(
            inArray(courseHoles.courseRevisionId, courseRevisionIds),
            eq(courseHoles.tenantId, tenantId),
          ),
        );

  // ── (4) Rule sets — revisions whose effective_from_round_id IS in the
  //        event's eventRounds set. Then the parent rule_sets via union. ──
  const ruleSetRevisionRows = eventRoundIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(ruleSetRevisions)
        .where(
          and(
            inArray(ruleSetRevisions.effectiveFromRoundId, eventRoundIds),
            eq(ruleSetRevisions.tenantId, tenantId),
          ),
        );
  const ruleSetIds = Array.from(
    new Set(ruleSetRevisionRows.map((r) => r.ruleSetId)),
  );
  const ruleSetRows = ruleSetIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(ruleSets)
        .where(and(inArray(ruleSets.id, ruleSetIds), eq(ruleSets.tenantId, tenantId)));

  // ── (5) Pairings (event-round-scoped) + members. ──
  const pairingRows = eventRoundIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(pairings)
        .where(
          and(inArray(pairings.eventRoundId, eventRoundIds), eq(pairings.tenantId, tenantId)),
        );
  const pairingIds = pairingRows.map((p) => p.id);
  const pairingMemberRows = pairingIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(pairingMembers)
        .where(
          and(
            inArray(pairingMembers.pairingId, pairingIds),
            eq(pairingMembers.tenantId, tenantId),
          ),
        );

  // ── (6) Hole scores + corrections + states + scorer assignments. ──
  const holeScoreRows = roundIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(holeScores)
        .where(
          and(inArray(holeScores.roundId, roundIds), eq(holeScores.tenantId, tenantId)),
        );
  const scoreCorrectionRows = roundIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(scoreCorrections)
        .where(
          and(
            inArray(scoreCorrections.roundId, roundIds),
            eq(scoreCorrections.tenantId, tenantId),
          ),
        );
  const roundStateRows = roundIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(roundStates)
        .where(
          and(inArray(roundStates.roundId, roundIds), eq(roundStates.tenantId, tenantId)),
        );
  const scorerAssignmentRows = roundIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(scorerAssignments)
        .where(
          and(
            inArray(scorerAssignments.roundId, roundIds),
            eq(scorerAssignments.tenantId, tenantId),
          ),
        );

  // ── (7) Bets (event-scoped). ──
  const individualBetRows = await dbInstance
    .select()
    .from(individualBets)
    .where(
      and(eq(individualBets.eventId, eventId), eq(individualBets.tenantId, tenantId)),
    );
  const betIds = individualBetRows.map((b) => b.id);
  const individualBetRoundRows = betIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(individualBetRounds)
        .where(
          and(
            inArray(individualBetRounds.betId, betIds),
            eq(individualBetRounds.tenantId, tenantId),
          ),
        );
  const individualBetPressRows = betIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(individualBetPresses)
        .where(
          and(
            inArray(individualBetPresses.betId, betIds),
            eq(individualBetPresses.tenantId, tenantId),
          ),
        );

  // ── (8) Team press log (round-scoped). ──
  const teamPressLogRows = roundIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(teamPressLog)
        .where(
          and(inArray(teamPressLog.roundId, roundIds), eq(teamPressLog.tenantId, tenantId)),
        );

  // ── (9) Sub-games (event-round-scoped). ──
  const subGameRows = eventRoundIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(subGames)
        .where(
          and(inArray(subGames.eventRoundId, eventRoundIds), eq(subGames.tenantId, tenantId)),
        );
  const subGameIds = subGameRows.map((sg) => sg.id);
  const subGameParticipantRows = subGameIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(subGameParticipants)
        .where(
          and(
            inArray(subGameParticipants.subGameId, subGameIds),
            eq(subGameParticipants.tenantId, tenantId),
          ),
        );
  const subGameResultRows = subGameIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(subGameResults)
        .where(
          and(
            inArray(subGameResults.subGameId, subGameIds),
            eq(subGameResults.tenantId, tenantId),
          ),
        );

  // ── (10) Gallery photos (event-scoped, T7-4). ──
  const galleryPhotoRows = await dbInstance
    .select()
    .from(galleryPhotos)
    .where(
      and(eq(galleryPhotos.eventId, eventId), eq(galleryPhotos.tenantId, tenantId)),
    );
  const galleryPhotoIds = galleryPhotoRows.map((p) => p.id);

  // ── (11) Audit log — OR-composed per-type predicates, empty-safe. ──
  const auditPairs: Array<[ScopedAuditEntityType, string[]]> = [
    ['hole_score', holeScoreRows.map((r) => r.id)],
    ['round', roundIds],
    ['rule_set', ruleSetRevisionRows.map((r) => r.id)],
    ['bet', betIds],
    ['sub_game', subGameIds],
    ['gallery_photo', galleryPhotoIds],
  ];
  const auditPredicates = auditPairs
    .filter(([, ids]) => ids.length > 0)
    .map(([type, ids]) =>
      and(eq(auditLog.entityType, type), inArray(auditLog.entityId, ids)),
    );
  const auditRows = auditPredicates.length === 0
    ? []
    : await dbInstance
        .select()
        .from(auditLog)
        .where(and(or(...auditPredicates), eq(auditLog.tenantId, tenantId)));

  // ── (12) Players closure — superset of every player_id referenced. ──
  const playerIdSet = new Set<string>();
  playerIdSet.add(eventRow.organizerPlayerId);
  for (const m of groupMemberRows) playerIdSet.add(m.playerId);
  for (const i of inviteRows) playerIdSet.add(i.createdByPlayerId);
  for (const r of ruleSetRevisionRows) playerIdSet.add(r.createdByPlayerId);
  for (const r of roundRows) {
    if (r.openedByPlayerId) playerIdSet.add(r.openedByPlayerId);
  }
  for (const rs of roundStateRows) {
    if (rs.enteredByPlayerId) playerIdSet.add(rs.enteredByPlayerId);
  }
  for (const sa of scorerAssignmentRows) {
    playerIdSet.add(sa.scorerPlayerId);
    playerIdSet.add(sa.assignedByPlayerId);
  }
  for (const hs of holeScoreRows) {
    playerIdSet.add(hs.playerId);
    playerIdSet.add(hs.scorerPlayerId);
  }
  for (const sc of scoreCorrectionRows) {
    playerIdSet.add(sc.playerId);
    playerIdSet.add(sc.actorPlayerId);
  }
  for (const b of individualBetRows) {
    playerIdSet.add(b.playerAId);
    playerIdSet.add(b.playerBId);
    playerIdSet.add(b.createdByPlayerId);
  }
  for (const sgp of subGameParticipantRows) playerIdSet.add(sgp.playerId);
  for (const sgr of subGameResultRows) {
    if (sgr.createdByPlayerId) playerIdSet.add(sgr.createdByPlayerId);
  }
  for (const tp of teamPressLogRows) {
    if (tp.firedByPlayerId) playerIdSet.add(tp.firedByPlayerId);
  }
  for (const pm of pairingMemberRows) playerIdSet.add(pm.playerId);
  for (const gp of galleryPhotoRows) playerIdSet.add(gp.uploadedByPlayerId);
  for (const al of auditRows) {
    if (al.actorPlayerId) playerIdSet.add(al.actorPlayerId);
  }
  const playerIds = [...playerIdSet];
  const playerRows = playerIds.length === 0
    ? []
    : await dbInstance
        .select()
        .from(players)
        .where(and(inArray(players.id, playerIds), eq(players.tenantId, tenantId)));

  // ── (13) Roster = group_members players, deduped. ──
  const rosterIdSet = new Set(groupMemberRows.map((m) => m.playerId));
  const rosterRows = playerRows.filter((p) => rosterIdSet.has(p.id));

  // ── (14) Money matrix + settleUp. ──
  const matrix = await computeMoneyMatrix(
    dbInstance,
    eventId,
    eventRow.organizerPlayerId,
    tenantId,
  );
  const settleUp = {
    perPlayerNetCents: matrix.totals,
    computedAt: matrix.computedAt,
  };

  // ── (15) Serialize to the export shape. ──
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    warnings,
    event: {
      id: eventRow.id,
      name: eventRow.name,
      startDate: msToIso(eventRow.startDate),
      endDate: msToIso(eventRow.endDate),
      timezone: eventRow.timezone,
      organizerPlayerId: eventRow.organizerPlayerId,
      createdAt: msToIso(eventRow.createdAt),
      tenantId: eventRow.tenantId,
      contextId: eventRow.contextId,
    },
    events: [
      {
        id: eventRow.id,
        name: eventRow.name,
        startDate: msToIso(eventRow.startDate),
        endDate: msToIso(eventRow.endDate),
        timezone: eventRow.timezone,
        organizerPlayerId: eventRow.organizerPlayerId,
        createdAt: msToIso(eventRow.createdAt),
        tenantId: eventRow.tenantId,
        contextId: eventRow.contextId,
      },
    ],
    roster: rosterRows.map((p) => ({
      id: p.id,
      isOrganizer: p.isOrganizer,
      createdAt: msToIso(p.createdAt),
      name: p.name,
      ghin: p.ghin,
      manualHandicapIndex: p.manualHandicapIndex,
      preferredTeeColor: p.preferredTeeColor,
      tenantId: p.tenantId,
      contextId: p.contextId,
    })),
    players: playerRows.map((p) => ({
      id: p.id,
      isOrganizer: p.isOrganizer,
      createdAt: msToIso(p.createdAt),
      name: p.name,
      ghin: p.ghin,
      manualHandicapIndex: p.manualHandicapIndex,
      preferredTeeColor: p.preferredTeeColor,
      tenantId: p.tenantId,
      contextId: p.contextId,
    })),
    eventRounds: eventRoundRows.map((er) => ({
      id: er.id,
      eventId: er.eventId,
      roundNumber: er.roundNumber,
      roundDate: msToIso(er.roundDate),
      courseRevisionId: er.courseRevisionId,
      teeColor: er.teeColor,
      holesToPlay: er.holesToPlay,
      createdAt: msToIso(er.createdAt),
      tenantId: er.tenantId,
      contextId: er.contextId,
    })),
    rounds: roundRows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      eventRoundId: r.eventRoundId,
      holesToPlay: r.holesToPlay,
      openedAt: msToIso(r.openedAt),
      openedByPlayerId: r.openedByPlayerId,
      createdAt: msToIso(r.createdAt),
      tenantId: r.tenantId,
      contextId: r.contextId,
    })),
    groups: groupRows.map((g) => ({
      id: g.id,
      eventId: g.eventId,
      name: g.name,
      moneyVisibilityMode: g.moneyVisibilityMode,
      createdAt: msToIso(g.createdAt),
      tenantId: g.tenantId,
      contextId: g.contextId,
    })),
    groupMembers: groupMemberRows.map((m) => ({
      groupId: m.groupId,
      playerId: m.playerId,
      tenantId: m.tenantId,
      contextId: m.contextId,
    })),
    invites: inviteRows.map((i) => ({
      id: i.id,
      eventId: i.eventId,
      token: i.token,
      expiresAt: msToIso(i.expiresAt),
      createdByPlayerId: i.createdByPlayerId,
      createdAt: msToIso(i.createdAt),
      tenantId: i.tenantId,
      contextId: i.contextId,
    })),
    ruleSets: ruleSetRows.map((rs) => ({
      id: rs.id,
      name: rs.name,
      createdAt: msToIso(rs.createdAt),
      tenantId: rs.tenantId,
      contextId: rs.contextId,
    })),
    ruleSetRevisions: ruleSetRevisionRows.map((rsr) => ({
      id: rsr.id,
      ruleSetId: rsr.ruleSetId,
      revisionNumber: rsr.revisionNumber,
      configJson: tryParseJson(rsr.configJson),
      effectiveFromRoundId: rsr.effectiveFromRoundId,
      effectiveFromHole: rsr.effectiveFromHole,
      createdByPlayerId: rsr.createdByPlayerId,
      reason: rsr.reason,
      createdAt: msToIso(rsr.createdAt),
      tenantId: rsr.tenantId,
      contextId: rsr.contextId,
    })),
    courses: courseRows.map((c) => ({
      id: c.id,
      name: c.name,
      clubName: c.clubName,
      createdAt: msToIso(c.createdAt),
      tenantId: c.tenantId,
      contextId: c.contextId,
    })),
    courseRevisions: courseRevisionRows.map((cr) => ({
      id: cr.id,
      courseId: cr.courseId,
      revisionNumber: cr.revisionNumber,
      sourceUrl: cr.sourceUrl,
      extractionDate: msToIso(cr.extractionDate),
      verified: cr.verified,
      outTotal: cr.outTotal,
      inTotal: cr.inTotal,
      courseTotal: cr.courseTotal,
      createdAt: msToIso(cr.createdAt),
      tenantId: cr.tenantId,
      contextId: cr.contextId,
    })),
    courseTees: courseTeeRows.map((ct) => ({
      id: ct.id,
      courseRevisionId: ct.courseRevisionId,
      teeColor: ct.teeColor,
      rating: ct.rating,
      slope: ct.slope,
      tenantId: ct.tenantId,
      contextId: ct.contextId,
    })),
    courseHoles: courseHoleRows.map((ch) => ({
      id: ch.id,
      courseRevisionId: ch.courseRevisionId,
      holeNumber: ch.holeNumber,
      par: ch.par,
      si: ch.si,
      yardagePerTeeJson: tryParseJson(ch.yardagePerTeeJson),
      tenantId: ch.tenantId,
      contextId: ch.contextId,
    })),
    pairings: pairingRows.map((p) => ({
      id: p.id,
      eventRoundId: p.eventRoundId,
      foursomeNumber: p.foursomeNumber,
      locked: p.locked,
      createdAt: msToIso(p.createdAt),
      tenantId: p.tenantId,
      contextId: p.contextId,
    })),
    pairingMembers: pairingMemberRows.map((pm) => ({
      pairingId: pm.pairingId,
      playerId: pm.playerId,
      slotNumber: pm.slotNumber,
      tenantId: pm.tenantId,
      contextId: pm.contextId,
    })),
    holeScores: holeScoreRows.map((hs) => ({
      id: hs.id,
      roundId: hs.roundId,
      playerId: hs.playerId,
      holeNumber: hs.holeNumber,
      grossStrokes: hs.grossStrokes,
      putts: hs.putts,
      scorerPlayerId: hs.scorerPlayerId,
      clientEventId: hs.clientEventId,
      createdAt: msToIso(hs.createdAt),
      updatedAt: msToIso(hs.updatedAt),
      tenantId: hs.tenantId,
      contextId: hs.contextId,
    })),
    scoreCorrections: scoreCorrectionRows.map((sc) => ({
      id: sc.id,
      roundId: sc.roundId,
      playerId: sc.playerId,
      holeNumber: sc.holeNumber,
      actorPlayerId: sc.actorPlayerId,
      priorValueJson: tryParseJson(sc.priorValueJson),
      newValueJson: tryParseJson(sc.newValueJson),
      requestId: sc.requestId,
      reason: sc.reason,
      createdAt: msToIso(sc.createdAt),
      tenantId: sc.tenantId,
      contextId: sc.contextId,
    })),
    roundStates: roundStateRows.map((rs) => ({
      roundId: rs.roundId,
      state: rs.state,
      enteredAt: msToIso(rs.enteredAt),
      enteredByPlayerId: rs.enteredByPlayerId,
      tenantId: rs.tenantId,
      contextId: rs.contextId,
    })),
    scorerAssignments: scorerAssignmentRows.map((sa) => ({
      roundId: sa.roundId,
      foursomeNumber: sa.foursomeNumber,
      scorerPlayerId: sa.scorerPlayerId,
      assignedAt: msToIso(sa.assignedAt),
      assignedByPlayerId: sa.assignedByPlayerId,
      tenantId: sa.tenantId,
      contextId: sa.contextId,
    })),
    individualBets: individualBetRows.map((b) => ({
      id: b.id,
      eventId: b.eventId,
      playerAId: b.playerAId,
      playerBId: b.playerBId,
      betType: b.betType,
      stakePerHoleCents: b.stakePerHoleCents,
      configJson: tryParseJson(b.configJson),
      createdByPlayerId: b.createdByPlayerId,
      createdAt: msToIso(b.createdAt),
      tenantId: b.tenantId,
      contextId: b.contextId,
    })),
    individualBetRounds: individualBetRoundRows.map((br) => ({
      betId: br.betId,
      eventRoundId: br.eventRoundId,
      tenantId: br.tenantId,
      contextId: br.contextId,
    })),
    individualBetPresses: individualBetPressRows.map((bp) => ({
      id: bp.id,
      betId: bp.betId,
      firedAtRoundId: bp.firedAtRoundId,
      firedAtHole: bp.firedAtHole,
      triggerType: bp.triggerType,
      multiplier: bp.multiplier,
      firedAt: msToIso(bp.firedAt),
      tenantId: bp.tenantId,
      contextId: bp.contextId,
    })),
    teamPressLog: teamPressLogRows.map((tp) => ({
      id: tp.id,
      roundId: tp.roundId,
      team: tp.team,
      startHole: tp.startHole,
      triggerType: tp.triggerType,
      trigger: tp.trigger,
      multiplier: tp.multiplier,
      firedAt: msToIso(tp.firedAt),
      firedByPlayerId: tp.firedByPlayerId,
      tenantId: tp.tenantId,
      contextId: tp.contextId,
    })),
    subGames: subGameRows.map((sg) => ({
      id: sg.id,
      eventRoundId: sg.eventRoundId,
      type: sg.type,
      configJson: tryParseJson(sg.configJson),
      buyInPerParticipant: sg.buyInPerParticipant,
      createdAt: msToIso(sg.createdAt),
      tenantId: sg.tenantId,
      contextId: sg.contextId,
    })),
    subGameParticipants: subGameParticipantRows.map((sgp) => ({
      subGameId: sgp.subGameId,
      playerId: sgp.playerId,
      optedInAt: msToIso(sgp.optedInAt),
      tenantId: sgp.tenantId,
      contextId: sgp.contextId,
    })),
    subGameResults: subGameResultRows.map((sgr) => ({
      id: sgr.id,
      subGameId: sgr.subGameId,
      computedAt: msToIso(sgr.computedAt),
      configSnapshotJson: tryParseJson(sgr.configSnapshotJson),
      resultsJson: tryParseJson(sgr.resultsJson),
      totalPotCents: sgr.totalPotCents,
      createdByPlayerId: sgr.createdByPlayerId,
      tenantId: sgr.tenantId,
      contextId: sgr.contextId,
    })),
    galleryPhotos: galleryPhotoRows.map((gp) => ({
      id: gp.id,
      eventId: gp.eventId,
      roundId: gp.roundId,
      uploadedByPlayerId: gp.uploadedByPlayerId,
      r2Key: gp.r2Key,
      contentType: gp.contentType,
      uploadedAt: msToIso(gp.uploadedAt),
      tenantId: gp.tenantId,
      contextId: gp.contextId,
    })),
    auditLog: auditRows.map((a) => ({
      id: a.id,
      eventType: a.eventType,
      entityType: a.entityType,
      entityId: a.entityId,
      actorPlayerId: a.actorPlayerId,
      payloadJson: tryParseJson(a.payloadJson),
      createdAt: msToIso(a.createdAt),
      tenantId: a.tenantId,
      contextId: a.contextId,
    })),
    activity: [],
    moneyMatrix: matrix,
    settleUp,
  };
}

/**
 * Slugify an event name for use in the export filename. Lowercase, ASCII
 * alphanumerics + hyphens only; collapses runs of non-alphanumerics into a
 * single hyphen; strips leading/trailing hyphens; truncates to 60 chars; an
 * empty result falls back to 'event'.
 */
export function eventNameSlug(name: string): string {
  const slugged = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/g, '');
  return slugged.length === 0 ? 'event' : slugged;
}

/**
 * Format `now` as YYYYMMDD localized to `timezone`. `Intl.DateTimeFormat`
 * with the `en-CA` locale yields the canonical `YYYY-MM-DD` shape; we strip
 * the hyphens for filename use.
 */
export function exportYmd(timezone: string, nowMs = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(nowMs)
    .replace(/-/g, '');
}

export function exportFilename(name: string, timezone: string, nowMs = Date.now()): string {
  return `${eventNameSlug(name)}-${exportYmd(timezone, nowMs)}.raw.json`;
}
