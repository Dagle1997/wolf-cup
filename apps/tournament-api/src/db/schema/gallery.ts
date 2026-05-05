/**
 * T7-4 gallery_photos schema.
 *
 * One row per photo uploaded to a tournament event. Photos are R2-backed;
 * the `r2_key` column stores the bucket key, never the bytes. Reads return
 * presigned GETs (1h TTL) — the R2 access credentials never leave
 * tournament-api.
 *
 * **FK delete posture (intentional asymmetry with rounds):**
 *   - `event_id → events.id` **CASCADE**: deleting an event wipes its
 *     gallery; matches Wolf Cup posture and audit_log retains the
 *     gallery.uploaded entries.
 *   - `round_id → rounds.id` **SET NULL**: a round cancellation (T5.8)
 *     preserves its photos in the event gallery. Mirrors Wolf Cup's
 *     2026-04-06 fix — photos outlive rounds. After cancellation the
 *     photos appear in the gallery's "unassociated" bucket.
 *   - `uploaded_by_player_id → players.id` **RESTRICT**: a player cannot
 *     be deleted while still owning gallery rows; same posture as
 *     `events.organizer_player_id` and `audit_log.actor_player_id`.
 *
 * **`r2_key` UNIQUE:** the upload route mints `tournament/events/{eventId}/{uuid}.{ext}`
 * — UUID collisions are theoretically possible but cosmologically unlikely;
 * the UNIQUE constraint surfaces the bug if it ever happens rather than
 * silently overwriting.
 *
 * **`tenant_id` defaults to 'guyan'; `context_id` is required.** The
 * upload route stamps `context_id = 'event:' + event_id` at insert,
 * matching the events.context_id pattern (FD-6 ecosystem).
 *
 * Greenfield-shaped (event-centric) but the upload + list + lightbox +
 * multi-file flow patterns are PORTED from
 * `apps/api/src/routes/gallery.ts`. See `apps/tournament-api/PORTS.md`.
 */

import {
  integer,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { desc } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { events } from './events.js';
import { rounds } from './scoring.js';
import { players } from './players.js';

export const galleryPhotos = sqliteTable(
  'gallery_photos',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    roundId: text('round_id').references(() => rounds.id, {
      onDelete: 'set null',
    }),
    uploadedByPlayerId: text('uploaded_by_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    r2Key: text('r2_key').notNull(),
    contentType: text('content_type').notNull(),
    uploadedAt: integer('uploaded_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    eventUploadedAtIdx: index('idx_gallery_photos_event_id_uploaded_at').on(
      t.eventId,
      desc(t.uploadedAt),
    ),
    roundIdx: index('idx_gallery_photos_round_id').on(t.roundId),
    r2KeyUniq: uniqueIndex('uniq_gallery_photos_r2_key').on(t.r2Key),
  }),
);

export type GalleryPhoto = typeof galleryPhotos.$inferSelect;
