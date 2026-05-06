/* PORTED from apps/api/src/routes/gallery.ts @ commit 935f37e774448c6782b2660b2b037419e498fda7 (dated 2026-05-05).
   R2 bucket shared with Wolf Cup; tournament uses key prefix 'tournament/events/{eventId}/'
   per arch D5-10. Scope: upload, list, delete, multi-file sequential.
   Deltas vs source: event-centric schema (WC keys by roundId only); auto-link active round
   via round_states IN ('in_progress','complete_editable') instead of rounds.status; signed
   GET URLs replace WC's R2_PUBLIC_URL fast-path; auth uses requireSession +
   requireEventParticipant (no entry_code header — Wolf Cup's anonymous-upload model
   doesn't apply once SSO is in play). */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  galleryPhotos,
  rounds,
  roundStates,
  eventRounds,
  players,
} from '../db/schema/index.js';
import {
  r2Configured,
  uploadToR2,
  deleteFromR2,
  getSignedDownloadUrl,
} from '../lib/r2-client.js';
import {
  writeAudit,
  AUDIT_EVENT_TYPES,
  AUDIT_ENTITY_TYPES,
} from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import { requireOrganizer } from '../middleware/require-organizer.js';

const TENANT_ID = 'guyan';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB per-photo cap
const MAX_REQUEST_BYTES = 12 * 1024 * 1024; // 12 MB request cap (multipart slop)
const SIGNED_URL_TTL_SECONDS = 3600;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[mime] ?? 'bin';
}

/**
 * Defense-in-depth key-safety guard. Tournament event IDs are UUID-shaped
 * per FD-6 (`events.id` is a `text` PK; `randomUUID()` is the sole minting
 * path), but path-traversal characters in a key prefix would escape the
 * intended `tournament/events/{eventId}/` partition. Reject any input
 * outside `[A-Za-z0-9_-]` so a future schema-validation lapse cannot
 * produce a malicious bucket key.
 */
function isSafeEventId(eventId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(eventId);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const galleryRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /api/events/:eventId/gallery — upload (single file per request)
// ---------------------------------------------------------------------------

galleryRouter.post(
  '/:eventId/gallery',
  requireSession,
  requireEventParticipant,
  bodyLimit({
    maxSize: MAX_REQUEST_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        {
          error: 'request_too_large',
          maxBytes: MAX_REQUEST_BYTES,
          requestId,
        },
        413,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const player = c.get('player')!;
    const eventId = c.req.param('eventId')!;

    if (!isSafeEventId(eventId)) {
      return c.json({ error: 'invalid_event_id', requestId }, 400);
    }

    if (!r2Configured) {
      return c.json({ error: 'storage_not_configured', requestId }, 503);
    }

    const formData = await c.req.formData();
    const file = formData.get('photo');
    const roundIdField = formData.get('roundId');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'missing_photo', requestId }, 400);
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return c.json(
        {
          error: 'invalid_file_type',
          allowed: [...ALLOWED_TYPES],
          requestId,
        },
        400,
      );
    }

    if (file.size > MAX_PHOTO_BYTES) {
      return c.json(
        { error: 'file_too_large', maxBytes: MAX_PHOTO_BYTES, requestId },
        400,
      );
    }

    // Round resolution. Three branches:
    //   (1) Caller passed a non-empty roundId — validate it belongs to :eventId.
    //   (2) Caller omitted roundId — auto-link to the active round if one exists.
    //   (3) Neither — round_id stays NULL.
    let resolvedRoundId: string | null = null;

    if (typeof roundIdField === 'string' && roundIdField.trim().length > 0) {
      const claimed = roundIdField.trim();
      const matches = await db
        .select({ id: rounds.id })
        .from(rounds)
        .where(and(eq(rounds.id, claimed), eq(rounds.eventId, eventId)))
        .limit(1);
      if (matches.length === 0) {
        return c.json({ error: 'invalid_round_id', requestId }, 400);
      }
      resolvedRoundId = claimed;
    } else {
      const active = await db
        .select({ id: rounds.id })
        .from(rounds)
        .innerJoin(roundStates, eq(roundStates.roundId, rounds.id))
        .where(
          and(
            eq(rounds.eventId, eventId),
            inArray(roundStates.state, ['in_progress', 'complete_editable']),
          ),
        )
        .orderBy(desc(roundStates.enteredAt))
        .limit(1);
      resolvedRoundId = active[0]?.id ?? null;
    }

    const r2Key = `tournament/events/${eventId}/${randomUUID()}.${extFromMime(file.type)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const log = c.get('logger');

    // Sequence: R2 PUT → presign → DB tx. Presign happens BEFORE the tx so a
    // post-commit failure can't leave a successful row whose response is 500
    // (clients would retry and create duplicates). Presign is local SigV4
    // math — extremely unlikely to fail when the SDK config is valid — but
    // wrapping it before the commit means any failure cleans up cleanly.
    try {
      await uploadToR2(r2Key, buffer, file.type);
    } catch (err) {
      log.error({ event: 'r2_upload_failed', err: String(err), r2Key });
      return c.json({ error: 'r2_upload_failed', requestId }, 502);
    }

    let signedUrl: string;
    try {
      signedUrl = await getSignedDownloadUrl(r2Key, SIGNED_URL_TTL_SECONDS);
    } catch (err) {
      log.error({ event: 'gallery_presign_failed', err: String(err), r2Key });
      try {
        await deleteFromR2(r2Key);
      } catch (cleanupErr) {
        log.error({
          event: 'gallery_orphan_cleanup_failed',
          err: String(cleanupErr),
          r2Key,
        });
      }
      return c.json({ error: 'presign_failed', requestId }, 502);
    }

    const photoId = randomUUID();
    const uploadedAt = Date.now();

    try {
      await db.transaction(async (tx) => {
        await tx.insert(galleryPhotos).values({
          id: photoId,
          eventId,
          roundId: resolvedRoundId,
          uploadedByPlayerId: player.id,
          r2Key,
          contentType: file.type,
          uploadedAt,
          tenantId: TENANT_ID,
          contextId: `event:${eventId}`,
        });
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.GALLERY_UPLOADED,
          entityType: AUDIT_ENTITY_TYPES.GALLERY_PHOTO,
          entityId: photoId,
          actorPlayerId: player.id,
          payload: { eventId, roundId: resolvedRoundId, r2Key, contentType: file.type },
        });
        await emitActivity(tx, {
          type: 'gallery.uploaded',
          eventId,
          actorPlayerId: player.id,
          photoId,
          ...(resolvedRoundId !== null ? { roundId: resolvedRoundId } : {}),
        });
      });
    } catch (err) {
      // DB write failed AFTER R2 PUT succeeded — best-effort cleanup so the
      // bucket doesn't accumulate orphans. Failure here is logged and
      // swallowed; the orphan is acceptable vs. a confusing double-error.
      log.error({ event: 'gallery_db_insert_failed', err: String(err), r2Key });
      try {
        await deleteFromR2(r2Key);
      } catch (cleanupErr) {
        log.error({
          event: 'gallery_orphan_cleanup_failed',
          err: String(cleanupErr),
          r2Key,
        });
      }
      return c.json({ error: 'internal', requestId }, 500);
    }

    return c.json({
      id: photoId,
      roundId: resolvedRoundId,
      signedUrl,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /api/events/:eventId/gallery — list grouped by round
// ---------------------------------------------------------------------------

galleryRouter.get(
  '/:eventId/gallery',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const eventId = c.req.param('eventId')!;

    c.header('Cache-Control', 'no-store');

    if (!r2Configured) {
      // Graceful degradation — page renders an empty state during ops outages.
      return c.json({ groups: [] });
    }

    const rows = await db
      .select({
        photoId: galleryPhotos.id,
        roundId: galleryPhotos.roundId,
        r2Key: galleryPhotos.r2Key,
        contentType: galleryPhotos.contentType,
        uploadedAt: galleryPhotos.uploadedAt,
        uploaderName: players.name,
        roundDate: eventRounds.roundDate,
        roundNumber: eventRounds.roundNumber,
      })
      .from(galleryPhotos)
      .leftJoin(players, eq(players.id, galleryPhotos.uploadedByPlayerId))
      .leftJoin(rounds, eq(rounds.id, galleryPhotos.roundId))
      .leftJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
      .where(eq(galleryPhotos.eventId, eventId))
      .orderBy(desc(galleryPhotos.uploadedAt));

    type GroupKey = string; // round id, or '__unassociated'
    const order: GroupKey[] = [];
    const groupMap = new Map<
      GroupKey,
      {
        roundId: string | null;
        roundDate: number | null;
        roundNumber: number | null;
        photos: Array<{
          id: string;
          r2Key: string;
          contentType: string;
          uploadedAt: number;
          uploaderName: string | null;
        }>;
      }
    >();

    for (const row of rows) {
      const key: GroupKey = row.roundId ?? '__unassociated';
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          roundId: row.roundId ?? null,
          roundDate: row.roundDate ?? null,
          roundNumber: row.roundNumber ?? null,
          photos: [],
        });
        order.push(key);
      }
      groupMap.get(key)!.photos.push({
        id: row.photoId,
        r2Key: row.r2Key,
        contentType: row.contentType,
        uploadedAt: row.uploadedAt,
        uploaderName: row.uploaderName ?? null,
      });
    }

    // Order groups by roundDate DESC; the unassociated bucket sorts LAST.
    order.sort((a, b) => {
      if (a === '__unassociated') return 1;
      if (b === '__unassociated') return -1;
      const dateA = groupMap.get(a)!.roundDate ?? 0;
      const dateB = groupMap.get(b)!.roundDate ?? 0;
      return dateB - dateA;
    });

    // Sign URLs in parallel (no DB writes, just signing math).
    const groups = await Promise.all(
      order.map(async (key) => {
        const g = groupMap.get(key)!;
        const photosSigned = await Promise.all(
          g.photos.map(async (p) => ({
            id: p.id,
            signedUrl: await getSignedDownloadUrl(p.r2Key, SIGNED_URL_TTL_SECONDS),
            contentType: p.contentType,
            uploadedAt: p.uploadedAt,
            uploaderName: p.uploaderName,
          })),
        );
        return {
          roundId: g.roundId,
          roundDate: g.roundDate,
          roundNumber: g.roundNumber,
          photos: photosSigned,
        };
      }),
    );

    return c.json({ groups });
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/events/:eventId/gallery/:photoId — organizer-only
// ---------------------------------------------------------------------------

galleryRouter.delete(
  '/:eventId/gallery/:photoId',
  requireSession,
  requireEventParticipant,
  requireOrganizer,
  async (c) => {
    const requestId = c.get('requestId');
    const player = c.get('player')!;
    const eventId = c.req.param('eventId')!;
    const photoId = c.req.param('photoId')!;

    const rows = await db
      .select({ r2Key: galleryPhotos.r2Key })
      .from(galleryPhotos)
      .where(
        and(eq(galleryPhotos.id, photoId), eq(galleryPhotos.eventId, eventId)),
      )
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: 'photo_not_found', requestId }, 404);
    }

    const r2Key = rows[0]!.r2Key;
    const log = c.get('logger');

    // Sequence: DB delete (+ audit) FIRST, then best-effort R2 delete. If
    // the DB tx fails, neither side mutates and the photo still renders
    // as expected. If the DB succeeds and R2 fails, the bucket has an
    // orphan but the UI no longer renders the row — preferable to the
    // reverse, which would 404 the signed URL while the row still exists.
    //
    // Race-safe variant: use `.returning(id)` to detect a no-op delete (a
    // concurrent organizer DELETE that won the race). If the delete
    // affected zero rows, skip the audit and return 404 — auditing
    // `gallery.deleted` for a row this request didn't actually delete
    // would corrupt the audit trail.
    let actuallyDeleted = false;
    try {
      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(galleryPhotos)
          .where(eq(galleryPhotos.id, photoId))
          .returning({ id: galleryPhotos.id });
        if (deleted.length === 0) return;
        actuallyDeleted = true;
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.GALLERY_DELETED,
          entityType: AUDIT_ENTITY_TYPES.GALLERY_PHOTO,
          entityId: photoId,
          actorPlayerId: player.id,
          payload: { eventId, r2Key },
        });
      });
    } catch (err) {
      log.error({ event: 'gallery_delete_failed', err: String(err), photoId });
      return c.json({ error: 'internal', requestId }, 500);
    }

    if (!actuallyDeleted) {
      return c.json({ error: 'photo_not_found', requestId }, 404);
    }

    if (r2Configured) {
      try {
        await deleteFromR2(r2Key);
      } catch (err) {
        log.error({ event: 'r2_delete_failed', err: String(err), r2Key });
      }
    }

    return c.body(null, 204);
  },
);
