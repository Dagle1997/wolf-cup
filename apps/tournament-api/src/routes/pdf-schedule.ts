/**
 * T4-3 PDF schedule export route.
 *
 *   GET /api/events/:eventId/pdf/schedule/:token
 *
 * Generates a printable schedule PDF for any participant holding a valid
 * invite token. Trip-day paper-fallback per FR-F1 / FR-F2 / FR-H4.
 *
 * Auth: gated by `requireInviteToken` (T3-8). The :token URL param is
 * read by the middleware via `c.req.param('token')`. Defense-in-depth:
 * the handler verifies the URL :eventId matches the token's event_id;
 * mismatch → 403 event_token_mismatch.
 *
 * 422 on missing pairings (event with NO pairings rows under any
 * event_round). 404 on missing event (rare — invite cascade should
 * delete the row).
 *
 * Response: 200 + Content-Type: application/pdf + Content-Disposition:
 * attachment + Buffer body.
 */

import { Hono } from 'hono';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireInviteToken } from '../middleware/require-invite-token.js';
import { db } from '../db/index.js';
import {
  events,
  eventRounds,
  pairings,
  pairingMembers,
  players,
  groups,
  groupMembers,
  courses,
  courseRevisions,
} from '../db/schema/index.js';
import { renderEventPdf, type EventPdfInput } from '../lib/pdf-gen.js';

const TENANT_ID = 'guyan';

export const pdfScheduleRouter = new Hono();

/**
 * Slugify event name for the Content-Disposition filename. Lowercase,
 * non-alphanumeric → '-', trim leading/trailing '-'. Empty result → 'event'.
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'event';
}

/**
 * Format a player's GHIN label or null. Mirrors AC #1's input shape.
 */
function ghinLabelFor(ghin: string | null): string | null {
  return ghin === null ? null : `GHIN linked: ${ghin}`;
}

pdfScheduleRouter.get(
  '/:eventId/pdf/schedule/:token',
  requireInviteToken,
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const urlEventId = c.req.param('eventId');
    const invite = c.get('invite')!;

    // Defense-in-depth: URL :eventId MUST match the token's event_id.
    if (urlEventId !== invite.eventId) {
      return c.json(
        { error: 'forbidden', code: 'event_token_mismatch', requestId },
        403,
      );
    }

    // Fetch event (tenant-scoped).
    const eventRows = await db
      .select({
        id: events.id,
        name: events.name,
        startDate: events.startDate,
        endDate: events.endDate,
        timezone: events.timezone,
      })
      .from(events)
      .where(and(eq(events.id, urlEventId), eq(events.tenantId, TENANT_ID)));
    if (eventRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'event_not_found', requestId },
        404,
      );
    }
    const event = eventRows[0]!;

    // Fetch event rounds + their course/tee.
    const erRows = await db
      .select({
        id: eventRounds.id,
        roundNumber: eventRounds.roundNumber,
        roundDate: eventRounds.roundDate,
        teeColor: eventRounds.teeColor,
        courseRevisionId: eventRounds.courseRevisionId,
      })
      .from(eventRounds)
      .where(
        and(
          eq(eventRounds.eventId, urlEventId),
          eq(eventRounds.tenantId, TENANT_ID),
        ),
      )
      .orderBy(asc(eventRounds.roundNumber));

    // Resolve course names via course_revisions → courses.
    const revisionIds = erRows.map((r) => r.courseRevisionId);
    const courseNameByRevId = new Map<string, string>();
    if (revisionIds.length > 0) {
      const crRows = await db
        .select({ id: courseRevisions.id, courseId: courseRevisions.courseId })
        .from(courseRevisions)
        .where(
          and(
            inArray(courseRevisions.id, revisionIds),
            eq(courseRevisions.tenantId, TENANT_ID),
          ),
        );
      const courseIds = crRows.map((c) => c.courseId);
      const cRows =
        courseIds.length > 0
          ? await db
              .select({ id: courses.id, name: courses.name })
              .from(courses)
              .where(
                and(
                  inArray(courses.id, courseIds),
                  eq(courses.tenantId, TENANT_ID),
                ),
              )
          : [];
      const courseNameById = new Map(cRows.map((c) => [c.id, c.name]));
      for (const cr of crRows) {
        const courseName = courseNameById.get(cr.courseId);
        if (courseName) courseNameByRevId.set(cr.id, courseName);
      }
    }

    // Pairings + members per round. Tenant-scoped.
    const erIds = erRows.map((r) => r.id);
    const pRows =
      erIds.length > 0
        ? await db
            .select({
              id: pairings.id,
              eventRoundId: pairings.eventRoundId,
              foursomeNumber: pairings.foursomeNumber,
            })
            .from(pairings)
            .where(
              and(
                inArray(pairings.eventRoundId, erIds),
                eq(pairings.tenantId, TENANT_ID),
              ),
            )
            .orderBy(asc(pairings.foursomeNumber))
        : [];

    if (pRows.length === 0) {
      return c.json(
        {
          error: 'pairings_missing',
          code: 'event_pairings_not_saved',
          requestId,
        },
        422,
      );
    }

    const pairingIds = pRows.map((p) => p.id);
    const memberRows = await db
      .select({
        pairingId: pairingMembers.pairingId,
        slotNumber: pairingMembers.slotNumber,
        playerId: players.id,
        name: players.name,
        manualHi: players.manualHandicapIndex,
        ghin: players.ghin,
      })
      .from(pairingMembers)
      .innerJoin(players, eq(pairingMembers.playerId, players.id))
      .where(
        and(
          inArray(pairingMembers.pairingId, pairingIds),
          eq(pairingMembers.tenantId, TENANT_ID),
          eq(players.tenantId, TENANT_ID),
        ),
      )
      .orderBy(asc(pairingMembers.slotNumber));

    // Build per-pairing member lists.
    const membersByPairingId = new Map<
      string,
      Array<{
        slotNumber: number;
        name: string;
        manualHi: number | null;
        ghin: string | null;
      }>
    >();
    for (const m of memberRows) {
      let arr = membersByPairingId.get(m.pairingId);
      if (!arr) {
        arr = [];
        membersByPairingId.set(m.pairingId, arr);
      }
      arr.push({
        slotNumber: m.slotNumber,
        name: m.name,
        manualHi: m.manualHi,
        ghin: m.ghin,
      });
    }

    // Roster: dedupe across groups.
    const groupRows = await db
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(eq(groups.eventId, urlEventId), eq(groups.tenantId, TENANT_ID)),
      );
    const groupIds = groupRows.map((g) => g.id);
    const rosterEntries: Array<{
      name: string;
      manualHi: number | null;
      ghin: string | null;
    }> = [];
    if (groupIds.length > 0) {
      const rosterRows = await db
        .select({
          playerId: players.id,
          name: players.name,
          manualHi: players.manualHandicapIndex,
          ghin: players.ghin,
        })
        .from(groupMembers)
        .innerJoin(players, eq(groupMembers.playerId, players.id))
        .where(
          and(
            inArray(groupMembers.groupId, groupIds),
            eq(groupMembers.tenantId, TENANT_ID),
            eq(players.tenantId, TENANT_ID),
          ),
        )
        .orderBy(asc(players.name));
      const seen = new Set<string>();
      for (const r of rosterRows) {
        if (!seen.has(r.playerId)) {
          seen.add(r.playerId);
          rosterEntries.push({ name: r.name, manualHi: r.manualHi, ghin: r.ghin });
        }
      }
    }

    // Build the renderer input.
    const pdfInput: EventPdfInput = {
      event: {
        name: event.name,
        startDate: event.startDate,
        endDate: event.endDate,
        timezone: event.timezone,
      },
      rounds: erRows.map((er) => {
        const courseName = courseNameByRevId.get(er.courseRevisionId) ?? 'Course';
        const roundPairings = pRows.filter((p) => p.eventRoundId === er.id);
        return {
          roundNumber: er.roundNumber,
          roundDate: er.roundDate,
          courseName,
          teeColor: er.teeColor,
          foursomes: roundPairings.map((p) => {
            const members = (membersByPairingId.get(p.id) ?? [])
              .slice()
              .sort((a, b) => a.slotNumber - b.slotNumber);
            return {
              foursomeNumber: p.foursomeNumber,
              members: members.map((m) => ({
                name: m.name,
                handicapIndex: m.manualHi,
                ghinLabel: ghinLabelFor(m.ghin),
              })),
            };
          }),
        };
      }),
      roster: rosterEntries.map((r) => ({
        name: r.name,
        handicapIndex: r.manualHi,
        ghinLabel: ghinLabelFor(r.ghin),
      })),
    };

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderEventPdf(pdfInput);
    } catch (err) {
      const e = err as { message?: unknown } | null;
      log.error({
        event: 'pdf_render_failed',
        eventId: urlEventId,
        message: e?.message ?? null,
      });
      return c.json(
        { error: 'internal', code: 'pdf_render_failed', requestId },
        500,
      );
    }

    log.info({
      event: 'pdf_schedule_generated',
      eventId: urlEventId,
      sizeBytes: pdfBuffer.length,
    });

    const filename = `${slugify(event.name)}-schedule.pdf`;
    // Copy the Buffer's bytes into a fresh ArrayBuffer so the Response
    // sees a guaranteed-non-shared ArrayBuffer. Buffer's underlying
    // .buffer is typed as ArrayBufferLike (includes SharedArrayBuffer),
    // which TS rejects for Blob/BodyInit. The copy is bounded to the
    // Buffer's actual byte range.
    const safeBuf = new ArrayBuffer(pdfBuffer.byteLength);
    new Uint8Array(safeBuf).set(pdfBuffer);
    const blob = new Blob([safeBuf], { type: 'application/pdf' });
    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Token-in-URL response: prevent intermediary caching (CDNs,
        // browser cache shared across users on multi-user devices).
        // The PDF is event-scoped + token-bound; do not let the URL
        // become cacheable evidence that an event/token combination
        // exists. (Party-codex round-1 catch.)
        'Cache-Control': 'no-store, private',
      },
    });
  },
);
