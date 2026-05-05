# T7-4: Per-Event Photo Gallery (R2 Storage Reuse)

## Status

ready-for-dev

## Story

As any Event participant, I want a Photo Gallery on the Event home that lets me upload photos from my camera or library and view photos uploaded by other participants grouped by round, so that Pinehurst trip photos collect inside the app alongside scores/money — the same thing Wolf Cup shipped 2026-03-21 (FR-E5, FR-H7).

**Target-miss-tolerable** (epics-phase1.md line 2363): low-effort port; permissible to defer if T5/T6 are at risk. Both epics are now `done`, so the deferral guard does not apply — proceed.

## v1 Scope

Port the proven Wolf Cup pattern (`apps/api/src/routes/gallery.ts` + `apps/api/src/lib/r2-client.ts`) under the **Port Provenance Protocol** (architecture line 156, 167, 180, 200; PORTS.md). Tournament's copy diverges from Wolf Cup in three structural ways — the divergence is intentional and tracked:

1. **Event-centric schema.** Wolf Cup keys photos by `roundId` only; tournament keys by `(event_id, round_id NULLABLE)` because Events span multiple rounds and a photo uploaded outside any active round still belongs to the event gallery.
2. **R2 key prefix.** Wolf Cup writes `photos/{year}/round-{N}/{uuid}.{ext}`. Tournament writes `tournament/events/{eventId}/{uuid}.{ext}` per architecture D5-10 (line 384, 454).
3. **Signed URLs on read.** Wolf Cup returns the bucket's R2_PUBLIC_URL pre-formed at upload time (public CDN). Tournament returns short-lived presigned GETs (1h TTL) so the upload path is the only place the bucket-write credential is touched. This is forward-compatible with eventually moving tournament's prefix to a private bucket without an API contract change.

Everything else — multipart upload, multi-file sequential progress, lightbox, organizer-only delete, R2-then-DB ordering — is the same shape as Wolf Cup's 2026-03-21..2026-04-06 implementation.

### Schema (new table `gallery_photos`)

```ts
gallery_photos {
  id                        TEXT PK (UUID, FD-6)
  event_id                  TEXT FK → events.id      ON DELETE CASCADE   NOT NULL
  round_id                  TEXT FK → rounds.id      ON DELETE SET NULL  NULLABLE
  uploaded_by_player_id     TEXT FK → players.id     ON DELETE RESTRICT  NOT NULL
  r2_key                    TEXT NOT NULL UNIQUE
  content_type              TEXT NOT NULL
  uploaded_at               INTEGER NOT NULL  (ms-since-epoch UTC)
  tenant_id                 TEXT NOT NULL DEFAULT 'guyan' (ecosystemColumns)
  context_id                TEXT NOT NULL                   (ecosystemColumns: 'event:' + event_id)
}
INDEX idx_gallery_photos_event_id_uploaded_at ON (event_id, uploaded_at DESC)
INDEX idx_gallery_photos_round_id            ON (round_id)
```

**FK delete posture:**
- `event_id` **CASCADE**: deleting an event wipes its gallery (matches Wolf Cup posture; events are small populations, audit log retains the gallery.uploaded entries).
- `round_id` **SET NULL**: a round cancellation (T5.8) preserves its photos in the event gallery, matching the 2026-04-06 Wolf Cup fix ("photos outlive rounds"). The photos appear in the gallery's "unassociated" bucket after cancellation.
- `uploaded_by_player_id` **RESTRICT**: a player cannot be deleted while still owning gallery rows; same posture as `events.organizer_player_id` and `audit_log.actor_player_id`.

**No `caption`, `original_filename`, `file_size` columns** — Wolf Cup carries these but the AC does not require them, and the tournament UI does not render them in v1. Adding them later is a non-breaking ALTER TABLE.

### R2 client (new file `apps/tournament-api/src/lib/r2-client.ts`)

Provenance header (mandated by AC-1):

```
/* PORTED from apps/api/src/lib/r2-client.ts @ commit {sha-at-port-time} (dated 2026-05-05).
   R2 bucket shared with Wolf Cup; tournament uses key prefix 'tournament/events/{eventId}/'
   per arch D5-10. Scope: upload, delete, signed-GET. Wolf Cup's R2_PUBLIC_URL fast-path
   is intentionally NOT ported — tournament uses presigned GETs for all reads. */
```

Exports:
- `r2Configured: boolean` — true iff all four envs are non-empty.
- `uploadToR2(key, body, contentType): Promise<void>` — `PutObjectCommand`.
- `deleteFromR2(key): Promise<void>` — `DeleteObjectCommand`.
- `getSignedDownloadUrl(key, ttlSeconds): Promise<string>` — `GetObjectCommand` + `getSignedUrl` from `@aws-sdk/s3-request-presigner`. Default TTL 3600s.

Reads R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME via `lib/env.ts` (NOT `process.env` directly — same posture as `lib/ghin-client.ts` and `lib/audit-log.ts`).

### Env additions (`apps/tournament-api/src/lib/env.ts`)

Add four OPTIONAL string fields (mirrors GHIN pattern):

```ts
R2_ACCOUNT_ID: z.string().optional(),
R2_ACCESS_KEY_ID: z.string().optional(),
R2_SECRET_ACCESS_KEY: z.string().optional(),
R2_BUCKET_NAME: z.string().optional(),
```

`r2Configured` evaluates as `Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME)`. When any is missing/empty, the upload route returns 503 `STORAGE_NOT_CONFIGURED` and the list route returns 200 with `{ groups: [] }` (graceful read, fail-loud write — matches Wolf Cup gallery line 40-42).

Production deploy notes: the four R2_* envs already live on the VPS for Wolf Cup (see `_columns.ts` MEMORY entry "Hostinger VPS"). No docker-compose surgery is required to expose them to tournament-api — the existing compose file passes `${R2_ACCOUNT_ID}` etc. through to wolf-cup-api; this story extends the same env block to the tournament-api service. **That extension is a docker-compose.yml edit and IS SHARED** — see "Shared-path approval requested" below.

### Routes (new file `apps/tournament-api/src/routes/gallery.ts`)

Provenance header (mandated by AC-1):

```
/* PORTED from apps/api/src/routes/gallery.ts @ commit {sha-at-port-time} (dated 2026-05-05).
   R2 bucket shared with Wolf Cup; tournament uses key prefix 'tournament/events/{eventId}/'
   per arch D5-10. Scope: upload, list, delete, multi-file sequential.
   Deltas vs source: event-centric schema (WC keys by roundId only); auto-link active round
   via round_states IN ('in_progress','complete_editable') instead of rounds.status; signed
   GET URLs replace WC's R2_PUBLIC_URL fast-path; auth uses requireSession +
   requireEventParticipant (no entry_code header — Wolf Cup's anonymous-upload model
   doesn't apply once SSO is in play). */
```

Mounted as `app.route('/api/events', galleryRouter)` in `apps/tournament-api/src/app.ts`. Effective URLs:

```
POST   /api/events/:eventId/gallery
GET    /api/events/:eventId/gallery
DELETE /api/events/:eventId/gallery/:photoId
```

Auth chain on all three:
- All routes: `requireSession` → `requireEventParticipant`.
- DELETE additionally requires `requireOrganizer` (chain order: session → participant → organizer; the participant gate runs first so non-participants get the same 403 shape as the read paths — no soft-leak).

#### POST `/api/events/:eventId/gallery` — upload

Accepts `multipart/form-data` with field `photo` (single file). Multi-file uploads are issued by the client as N independent POSTs (Wolf Cup's pattern — sequential per AC-5).

Request body validation (in this order — each layer is a hard reject):

1. **Streaming body-size cap (sole request-level guard).** Mount Hono's `bodyLimit({ maxSize: MAX_REQUEST_BYTES })` middleware where `MAX_REQUEST_BYTES = 12 * 1024 * 1024` (12 MB — 10 MB photo cap + 2 MB multipart slop), on the POST upload route ONLY (not the whole router; DELETE has no body, GET has no body, and a global cap could break unrelated routes). `bodyLimit` reads the request stream and aborts with 413 the moment the cumulative byte count exceeds `maxSize`; it does NOT depend on the `Content-Length` header, so chunked-transfer and proxied uploads work correctly. This is the authoritative guard against memory/CPU DoS — no separate Content-Length check is added in the handler (codex round-3 finding: post-`bodyLimit` Content-Length checks are tautological for over-cap requests and add no defense for under-cap requests). **Implementation note:** verify via a unit test that `bodyLimit` actually rejects mid-stream (Hono v4's behavior is documented as streaming, but the test is the contract). If the runtime turns out to buffer-then-check, escalate to a followup that adds an explicit pre-parse byte-counter wrapper.

2. **`r2Configured` MUST be true** → else 503 `{ error: 'storage_not_configured', requestId }`.

3. **`photo` MUST be a `File` instance** → else 400 `missing_photo`.

4. **`photo.type` MUST be one of** `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif` → else 400 `invalid_file_type` (`allowed` array in body for client display).

5. **`photo.size` MUST be ≤ 10 MB** (10485760 bytes — per-photo file-level cap, distinct from the 12 MB request-level cap) → else 400 `file_too_large` with `maxBytes: 10485760`. The streaming bodyLimit at step 1 already capped total request bytes; this layer catches the case where multipart framing happens to be small but the file itself is over the per-photo cap.

Active-round resolution (AC-3):
- The `round_states` table and its state enum ship in T5-1 (already `done`; see `apps/tournament-api/src/db/schema/scoring.ts:195-216` — `chk_round_states_state` constrains `state IN ('not_started','in_progress','complete_editable','finalized','cancelled')`). No new schema/migration needed for this story to read it; gallery_photos' new migration only adds the gallery_photos table itself.
- Query `rounds JOIN round_states ON round_states.round_id = rounds.id` where `rounds.event_id = :eventId` AND `round_states.state IN ('in_progress', 'complete_editable')`, ORDER BY `round_states.entered_at DESC`, LIMIT 1.
- If found: photo's `round_id` = that round.
- If none: photo's `round_id` = NULL (uploaded outside any active round).
- The client MAY pass `formData.get('roundId')` to override; if provided AND non-empty, validate that the round exists, belongs to `:eventId`, and the caller is a participant of the event (already enforced by `requireEventParticipant`); if not, 400 `invalid_round_id` (or 404 if it doesn't belong to the event — the route returns 400 because the participant middleware already proved entitlement to `:eventId`'s scope).

Upload sequence (R2-then-DB, matches Wolf Cup line 113-136):
1. Generate `r2Key = 'tournament/events/' + assertSafeEventId(eventId) + '/' + randomUUID() + '.' + extFromMime(file.type)`. **`assertSafeEventId` rejects any `eventId` containing `/`, `\`, `..`, or any character outside `[A-Za-z0-9_-]`** — a defense-in-depth guard against bucket-key path-traversal even though tournament event IDs are UUID-shaped per FD-6 (the schema's `events.id` is a `text` PK and `randomUUID()` is the sole minting path). Reject with 400 `invalid_event_id`. The `requireEventParticipant` middleware already enforces existence-via-membership; this guard is purely a key-safety check, not an existence check.
2. `await uploadToR2(r2Key, buffer, file.type)`.
3. Insert `gallery_photos` row with `id = randomUUID()`, `event_id`, `round_id` (resolved above), `uploaded_by_player_id = player.id`, `r2_key`, `content_type = file.type`, `uploaded_at = Date.now()`, `tenant_id = 'guyan'`, `context_id = 'event:' + eventId`.
4. `writeAudit({ eventType: 'gallery.uploaded', entityType: 'gallery_photo', entityId: photoId, actorPlayerId: player.id, payload: { eventId, roundId, r2Key, contentType } })`.
5. `emitActivity(db, { type: 'gallery.uploaded', actorPlayerId: player.id, payload: { photoId }, scope: { eventId, roundId: roundId ?? undefined } })` — v1 no-op per `lib/activity.ts`; T8 backfills.
6. Return 200 `{ id, roundId, signedUrl }` where `signedUrl = await getSignedDownloadUrl(r2Key)` so the client can render the just-uploaded photo without an extra GET roundtrip.

If step 2 throws (R2 unreachable / 5xx / credentials wrong), no DB row is written; route returns 502 `r2_upload_failed`. If step 3 throws after step 2 succeeded, the route attempts a best-effort `deleteFromR2(r2Key)` to avoid orphaned bucket objects (matches Wolf Cup pattern; failure is logged and swallowed — orphan is acceptable).

#### GET `/api/events/:eventId/gallery` — list

Query params: none. Returns 200:

```ts
{
  groups: Array<{
    roundId: string | null;          // null bucket appears LAST when present
    roundDate: number | null;        // event_rounds.round_date for non-null roundId; null for the unassociated bucket
    roundNumber: number | null;      // event_rounds.round_number for non-null roundId; null for the unassociated bucket
    photos: Array<{
      id: string;
      signedUrl: string;             // presigned GET URL, 1h TTL
      contentType: string;
      uploadedAt: number;            // ms-since-epoch UTC
      uploaderName: string | null;   // players.name; null if uploader was deleted (RESTRICT prevents this in v1; defensive)
    }>
  }>
}
```

Implementation:
- Single SELECT joining `gallery_photos` LEFT JOIN `players` ON `uploaders.id = uploaded_by_player_id` LEFT JOIN `rounds` ON `gallery_photos.round_id = rounds.id` LEFT JOIN `event_rounds` ON `rounds.event_round_id = event_rounds.id`, WHERE `gallery_photos.event_id = :eventId`, ORDER BY `gallery_photos.uploaded_at DESC`.
- Group rows in JS by `round_id` (preserving round-date order: highest `round_date` first, NULL last).
- For each photo, call `getSignedDownloadUrl(r2_key, 3600)`. The presign calls run in parallel via `Promise.all` (no DB writes; only AWS SDK signing math).
- `cache-control: no-store` — signed URLs expire; clients should re-fetch.

If `r2Configured === false`, return `{ groups: [] }` with 200 — graceful read so the gallery page renders an empty state during ops outages.

#### DELETE `/api/events/:eventId/gallery/:photoId` — delete (organizer-only)

Auth: session + participant + organizer (chain in that order). Non-organizer participant → 403 `not_organizer` (same shape as `requireOrganizer` middleware).

Logic:
1. Look up `gallery_photos` row by `:photoId`. If not found OR `event_id !== :eventId` → 404 `photo_not_found` (the participant middleware already proved entitlement to `:eventId`'s scope, so a 404 here doesn't leak cross-event existence).
2. `await deleteFromR2(r2_key)`. If this throws, log + continue with DB delete (object already gone is OK; storage outage is logged and the DB row is still cleaned up so the photo doesn't ghost-render via a stale signed URL after TTL expiry).
3. Delete the `gallery_photos` row.
4. `writeAudit({ eventType: 'gallery.deleted', entityType: 'gallery_photo', entityId: photoId, actorPlayerId: player.id, payload: { eventId, r2Key } })`.
5. Return 204.

### Audit constant additions (`apps/tournament-api/src/lib/audit-log.ts`)

Extend the existing constant maps (no breaking change; additive):

```ts
AUDIT_EVENT_TYPES: add GALLERY_UPLOADED = 'gallery.uploaded', GALLERY_DELETED = 'gallery.deleted'.
AUDIT_ENTITY_TYPES: add GALLERY_PHOTO = 'gallery_photo'.
```

### Web — gallery page (new file `apps/tournament-web/src/routes/events.$eventId.gallery.tsx`)

Route: `/events/$eventId/gallery`. Same auth-then-data pattern as `events.$eventId.index.tsx` (T7-1) — `beforeLoad` redirects anonymous to `/api/auth/google`; data fetch maps 403 to a forbidden card.

Components:
- **Header.** "Gallery" title + photo count.
- **Upload FAB.** Floating circle button bottom-right with camera glyph. On tap, opens a hidden `<input type="file" accept="image/*" capture="environment" multiple />`. Mobile Safari/Chrome surface the camera-or-library picker; the `capture` hint is advisory (browsers may show both options anyway).
- **Sequential upload progress.** When N files are selected, render a "Uploading 3 of 5..." pill above the grid. Each file POSTs in series; per-file failure does NOT abort siblings — failures accumulate into a per-file summary banner ("2 of 5 photos failed: photo3.heic — file too large; photo5.png — network error"). The banner is dismissible.
- **Photo grid grouped by round.** Each round group has a label ("Round 1 — Pine Needles, May 8") and a square-thumbnail grid (CSS grid, `grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))`). The unassociated bucket renders LAST under the label "Other photos".
- **Lightbox.** Tap a photo → fullscreen overlay with the signed URL `<img>`. Native browser zoom (pinch on iOS Safari, double-tap on Android Chrome) handles zoom; no custom zoom widget. Close button top-right; tap outside the image also closes.
- **Organizer-only delete.** When `auth.player.isOrganizer === true`, each photo card shows a small trash icon button. Tap → confirmation `<dialog>` "Delete this photo? This cannot be undone." → DELETE → optimistic remove + invalidate `['gallery', eventId]`.

Data fetching: `useQuery({ queryKey: ['gallery', eventId], queryFn: () => fetch(...).then(...) , refetchOnWindowFocus: true })`. After upload-success or delete-success, `queryClient.invalidateQueries({ queryKey: ['gallery', eventId] })`.

### Web — event home update (modify `apps/tournament-web/src/routes/events.$eventId.index.tsx`)

Add a fifth entry to `ENTRY_CARDS`:

```ts
{ to: '/events/$eventId/gallery' as const, title: 'Photo Gallery', desc: 'Trip photos' },
```

The existing test `events.$eventId.index.test.tsx` will need a new assertion — see "Tests" below.

### PORTS.md additions

Append two rows:

| Target file | Source file | Source commit | Ported-on date | Deltas | Last-checked-for-updates |
|---|---|---|---|---|---|
| `apps/tournament-api/src/lib/r2-client.ts` | `apps/api/src/lib/r2-client.ts` | `{sha-at-port-time}` | 2026-05-05 | env reads via `src/lib/env.ts`; added `getSignedDownloadUrl` (presigner); dropped `R2_PUBLIC_URL` fast-path. | 2026-05-05 |
| `apps/tournament-api/src/routes/gallery.ts` | `apps/api/src/routes/gallery.ts` | `{sha-at-port-time}` | 2026-05-05 | event-centric schema (event_id + round_id NULLABLE); R2 key prefix `tournament/events/{eventId}/`; signed-GET URLs replace `publicUrl` field; auth chain `requireSession + requireEventParticipant + (requireOrganizer for DELETE)` replaces Wolf Cup's `x-entry-code` bcrypt-compare; active-round resolved from `round_states.state IN ('in_progress','complete_editable')` instead of `rounds.status`. | 2026-05-05 |

The `{sha-at-port-time}` placeholder will be filled at implementation time with `git rev-parse HEAD` of the wolf-cup branch at the moment the port is performed (to give future re-syncs a comparable baseline).

## Path footprint

### ALLOWED — Tournament-scoped (write freely)

```
apps/tournament-api/src/lib/r2-client.ts                                     [NEW]
apps/tournament-api/src/lib/r2-client.test.ts                                [NEW]
apps/tournament-api/src/routes/gallery.ts                                    [NEW]
apps/tournament-api/src/routes/gallery.integration.test.ts                   [NEW]
apps/tournament-api/src/db/schema/gallery.ts                                 [NEW]
apps/tournament-api/src/db/schema/gallery.test.ts                            [NEW]
apps/tournament-api/src/db/schema/index.ts                                   [MODIFIED — add export]
apps/tournament-api/src/db/migrations/0008_gallery_photos.sql                [NEW]
apps/tournament-api/src/db/migrations/meta/_journal.json                     [MODIFIED — drizzle-kit appends entry]
apps/tournament-api/src/db/migrations/meta/0008_snapshot.json                [NEW — drizzle-kit emits]
apps/tournament-api/src/lib/audit-log.ts                                     [MODIFIED — add GALLERY_UPLOADED/DELETED + GALLERY_PHOTO]
apps/tournament-api/src/lib/env.ts                                           [MODIFIED — add R2_* OPTIONAL fields]
apps/tournament-api/src/test-setup.ts                                        [MODIFIED — leave R2_* unset so r2Configured is false in tests by default; tests that exercise R2 stub via vi.mock]
apps/tournament-api/src/app.ts                                               [MODIFIED — mount galleryRouter]
apps/tournament-api/package.json                                             [MODIFIED — add @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner]
apps/tournament-api/PORTS.md                                                 [MODIFIED — two entries]
apps/tournament-web/src/routes/events.$eventId.gallery.tsx                   [NEW]
apps/tournament-web/src/routes/events.$eventId.gallery.test.tsx              [NEW]
apps/tournament-web/src/routes/events.$eventId.index.tsx                     [MODIFIED — add Photo Gallery entry card]
apps/tournament-web/src/routes/events.$eventId.index.test.tsx                [MODIFIED — assert gallery card present]
_bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md  [THIS FILE]
```

### Files this story will edit

```
apps/tournament-api/src/lib/r2-client.ts
apps/tournament-api/src/lib/r2-client.test.ts
apps/tournament-api/src/routes/gallery.ts
apps/tournament-api/src/routes/gallery.integration.test.ts
apps/tournament-api/src/db/schema/gallery.ts
apps/tournament-api/src/db/schema/gallery.test.ts
apps/tournament-api/src/db/schema/index.ts
apps/tournament-api/src/db/migrations/0008_gallery_photos.sql
apps/tournament-api/src/db/migrations/meta/_journal.json
apps/tournament-api/src/db/migrations/meta/0008_snapshot.json
apps/tournament-api/src/lib/audit-log.ts
apps/tournament-api/src/lib/env.ts
apps/tournament-api/src/test-setup.ts
apps/tournament-api/src/app.ts
apps/tournament-api/package.json
apps/tournament-api/PORTS.md
apps/tournament-web/src/routes/events.$eventId.gallery.tsx
apps/tournament-web/src/routes/events.$eventId.gallery.test.tsx
apps/tournament-web/src/routes/events.$eventId.index.tsx
apps/tournament-web/src/routes/events.$eventId.index.test.tsx
_bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md
pnpm-lock.yaml
docker-compose.yml
```

### SHARED — requires explicit user approval (HARD STOP this story)

```
pnpm-lock.yaml         [MODIFIED — adding @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner to apps/tournament-api/package.json forces a lockfile update]
docker-compose.yml     [MODIFIED — add R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME to the tournament-api service's environment block, mirroring the wolf-cup-api block already there]
```

The director's path classification gate at step 5b WILL flag both. The implementation MUST stop and request user approval before staging either. **Auto-approve is therefore disabled for this story** — the spec's `auto_approve_clean_specs` config check fails on "every listed path must classify into ALLOWED" and falls back to manual gate.

### FORBIDDEN

None. Wolf Cup files are read-only references (provenance), not modified.

## Acceptance Criteria

**AC-1 — Provenance headers + PORTS.md.**

**Given** `apps/tournament-api/src/routes/gallery.ts` and `apps/tournament-api/src/lib/r2-client.ts`
**When** inspected
**Then** each file begins with a provenance header citing the Wolf Cup source path + commit SHA at port time and the architecture key (D5-10) for the prefix decision. **And** `apps/tournament-api/PORTS.md` has a row for each ported file with source path, source commit, ported-on date, and deltas — matching the format of the existing `ghin-client.ts` / `pdf-gen.ts` / `holeScores` rows.

**AC-2 — Schema + migration.**

**Given** `apps/tournament-api/src/db/schema/gallery.ts`
**When** inspected
**Then** the `galleryPhotos` table is defined with columns `id` (text PK), `event_id` (text NOT NULL FK → events.id ON DELETE CASCADE), `round_id` (text NULLABLE FK → rounds.id ON DELETE SET NULL), `uploaded_by_player_id` (text NOT NULL FK → players.id ON DELETE RESTRICT), `r2_key` (text NOT NULL UNIQUE), `content_type` (text NOT NULL), `uploaded_at` (integer NOT NULL), `tenant_id` (default 'guyan'), `context_id` (NOT NULL). Indexes `idx_gallery_photos_event_id_uploaded_at` on `(event_id, uploaded_at desc)` and `idx_gallery_photos_round_id` on `(round_id)`.

**Given** `apps/tournament-api/src/db/migrations/0008_gallery_photos.sql`
**When** inspected
**Then** every CREATE TABLE / CREATE INDEX statement is separated by `--> statement-breakpoint`. (Reference: 2026-05-01 Wolf Cup MEMORY entry — drizzle/libsql multi-statement migrations need explicit breakpoints or only the first runs.)

**AC-3 — POST /api/events/:eventId/gallery (upload).**

**Given** session player is a participant of `:eventId` AND `r2Configured === true` AND `multipart/form-data` body has `photo` field with a JPEG ≤ 10 MB
**When** invoked
**Then** the file uploads to R2 under `tournament/events/{eventId}/{uuid}.jpg`, a `gallery_photos` row is inserted with `event_id = :eventId`, `round_id` resolved from the event's active round (state IN 'in_progress' / 'complete_editable'; LIMIT 1 by `round_states.entered_at DESC`) or NULL when no active round exists, `uploaded_by_player_id = session.player.id`, `r2_key`, `content_type = 'image/jpeg'`, `uploaded_at = Date.now()`. Returns 200 `{ id, roundId, signedUrl }`. An `audit_log` row with `event_type = 'gallery.uploaded'`, `entity_type = 'gallery_photo'`, `entity_id = photoId`, `actor_player_id = session.player.id`, `payload_json` containing `{ eventId, roundId, r2Key, contentType }` is written in the same request.

**AC-4 — Upload validation + storage-not-configured.**

**Given** session player is a participant
- `r2Configured === false` → 503 `{ error: 'storage_not_configured', requestId }`.
- `photo` field missing or not a `File` → 400 `missing_photo`.
- `photo.type` not in {jpeg, png, webp, heic, heif} → 400 `invalid_file_type` (`allowed` array on the response).
- `photo.size > 10 MB` → 400 `file_too_large` with `maxBytes: 10485760`.
- `roundId` form field present, non-empty, but doesn't refer to a round of `:eventId` → 400 `invalid_round_id`.

**AC-5 — Multi-file upload (sequential, isolated failures).**

**Given** the web client picks 5 files via the file input
**When** the upload sequence runs
**Then** the client issues 5 sequential POSTs (not parallel) and shows "Uploading N of 5..." progress between requests. **And** if file 3 fails (e.g., 400 file_too_large), files 4 and 5 are still attempted. **And** at the end, a summary banner lists per-file failure reasons; successful files appear in the grid immediately via the cache invalidation. (Wolf Cup 2026-03-22 sequential-progress pattern.)

**AC-6 — GET /api/events/:eventId/gallery (list).**

**Given** session player is a participant AND the event has 5 photos: 3 in round 1, 1 in round 2, 1 unassociated
**When** invoked
**Then** returns 200 with `groups` ordered by `round_date DESC` and the unassociated bucket LAST. Each photo has a `signedUrl` (presigned GET, 1h TTL) — the URL contains `X-Amz-Signature` and `X-Amz-Expires` query params. Photos within a group are ordered by `uploaded_at DESC`. `uploaderName` is the player's name from a LEFT JOIN. `cache-control: no-store`.

**Given** session player is a participant AND `r2Configured === false`
**When** invoked
**Then** returns 200 with `{ groups: [] }` (graceful degradation; the gallery page renders an empty state).

**AC-7 — DELETE /api/events/:eventId/gallery/:photoId (organizer-only).**

**Given** session player is an organizer AND a participant of `:eventId` AND `:photoId` is a row in `gallery_photos` with `event_id = :eventId`
**When** invoked
**Then** the R2 object is deleted (best-effort — failure logged, DB delete still proceeds), the `gallery_photos` row is deleted, an `audit_log` row with `event_type = 'gallery.deleted'`, `entity_type = 'gallery_photo'`, `entity_id = photoId`, `payload_json` containing `{ eventId, r2Key }` is written. Returns 204.

**Given** session player is a participant but NOT an organizer
**When** invoked
**Then** 403 `{ error: 'forbidden', code: 'not_organizer', requestId }` (from `requireOrganizer` middleware).

**Given** session player is an organizer AND `:photoId` does not exist OR exists but `event_id !== :eventId`
**When** invoked
**Then** 404 `{ error: 'photo_not_found', requestId }`.

**AC-8 — Auth chain (no soft-leak).**

**Given** anonymous caller
**When** invoking any of the three routes
**Then** 401 from `requireSession`.

**Given** authenticated non-participant of `:eventId`
**When** invoking any of the three routes
**Then** 403 `not_event_participant` from `requireEventParticipant`.

**Given** malformed `:eventId` (e.g., empty string after URL decode, or random bytes)
**When** invoking any of the three routes
**Then** 403 `not_event_participant` (uniform with the participant middleware's no-existence-leak posture; matches T7-1/T7-2/T7-3 AC).

**AC-9 — Round-cancellation preserves photos (FK SET NULL).**

**Given** round R has 2 gallery photos
**When** R is deleted from `rounds` (e.g., T5.8 cancel admin path) — equivalent to `DELETE FROM rounds WHERE id = R`
**Then** the 2 `gallery_photos` rows have `round_id` set to NULL (NOT deleted). Subsequent GET on the event's gallery places those photos in the unassociated bucket. Matches Wolf Cup 2026-04-06 fix posture; verified by an integration test that exercises the FK directly.

**AC-10 — Web /events/$eventId/gallery renders.**

**Given** the API returns 200 with at least one photo
**When** `/events/{eventId}/gallery` loads
**Then** the page renders: (a) a header with "Gallery" + photo count; (b) a camera-icon FAB bottom-right; (c) a photo grid grouped by round with section labels; (d) tapping a photo opens a fullscreen lightbox (signed URL renders); (e) the FAB opens a multi-file-capable picker.

**Given** session player is an organizer
**When** the page renders a photo
**Then** a trash icon appears on each photo card; tap → confirmation dialog → DELETE → photo removed from grid + cache invalidated.

**AC-11 — Web event home links to gallery.**

**Given** the event home page (`/events/$eventId`)
**When** rendered
**Then** the entry-card list includes a "Photo Gallery" card linking to `/events/$eventId/gallery`. The existing T7-1 entry-card test asserts the card is present with the correct destination.

**AC-12 — Tests.**

**Given** `apps/tournament-api/src/db/schema/gallery.test.ts`
**When** run
**Then** asserts: (a) inserting a gallery_photos row with valid FKs succeeds; (b) deleting the parent event cascades photos; (c) deleting the parent round nulls `round_id` on photos (NOT cascade); (d) attempting to delete a player that owns a photo fails with FK constraint (RESTRICT); (e) duplicate `r2_key` insert fails with UNIQUE constraint; (f) ecosystem columns default to 'guyan' / are required.

**Given** `apps/tournament-api/src/lib/r2-client.test.ts`
**When** run
**Then** asserts: (a) `r2Configured === false` when any of the four envs is empty; (b) `uploadToR2` calls `S3Client.send` with `PutObjectCommand` shape `{ Bucket, Key, Body, ContentType }` (mock `S3Client`); (c) `getSignedDownloadUrl` returns a string containing `X-Amz-Signature` (mock the presigner); (d) `deleteFromR2` calls `S3Client.send` with `DeleteObjectCommand`.

**Given** `apps/tournament-api/src/routes/gallery.integration.test.ts`
**When** run
**Then** covers: (a) POST happy path (multipart form, 200, DB row written, audit row written, signed URL returned) — R2 client mocked via `vi.mock`; (b) POST 503 when r2Configured=false; (c) POST 400 each validation failure (missing/invalid type/too large/invalid roundId); (d) GET happy path (groups ordered by round_date DESC, unassociated last, signed URLs present); (e) GET empty when no photos; (f) GET `{ groups: [] }` when r2Configured=false; (g) DELETE 204 by organizer, 403 by non-organizer participant, 404 cross-event, 401 anonymous; (h) Round-deletion-nulls-photo (direct DB DELETE on rounds, then verify `round_id` is NULL); (i) Cross-event delete attempt → 404; (j) `cache-control: no-store` on GET.

**Given** `apps/tournament-web/src/routes/events.$eventId.gallery.test.tsx`
**When** run
**Then** covers: (a) renders header + grid with mocked API response; (b) FAB triggers file input; (c) sequential upload progress text "Uploading 2 of 3..." appears between requests; (d) per-file failure surfaces in summary banner; (e) lightbox opens on photo tap; (f) organizer sees delete button; non-organizer does not; (g) delete confirmation dialog → DELETE call → optimistic remove.

**Given** `apps/tournament-web/src/routes/events.$eventId.index.test.tsx`
**When** run after this story modifies it
**Then** asserts the "Photo Gallery" entry card is present with `to = '/events/$eventId/gallery'`.

**AC-13 — Wolf Cup is unmodified.**

**Given** this story's commit
**When** `git diff master -- apps/api apps/web packages/engine` is inspected
**Then** the diff is empty. Wolf Cup files are read-only references (provenance via PORTS.md).

## Shared-path approval requested (this story only)

Two SHARED files MUST be modified in this story to deliver the AC. **The director MUST stop at step 5b and present this list to the user before staging either**:

1. `pnpm-lock.yaml` — adding `@aws-sdk/client-s3` (matching Wolf Cup's `^3.1014.0`) and `@aws-sdk/s3-request-presigner` (sibling package, same major version family) to `apps/tournament-api/package.json` forces a lockfile update. Pinning to Wolf Cup's existing major minimizes the lockfile surface (the SDK's transitive dep tree is already resolved against Wolf Cup's identical version family).

2. `docker-compose.yml` — the tournament-api service's `environment:` block currently does not pass through the four R2 envs. The wolf-cup-api block already does. The change is four added lines (`R2_ACCOUNT_ID: ${R2_ACCOUNT_ID}` etc.) under the tournament-api service.

If approval is denied, the story is reverted and the followup is "negotiate dep / env scope before retry."

## Risks

- **Active-round resolution is heuristic.** Multi-round-in-flight at the same event (e.g., a 27-hole day with two simultaneous open rounds) would attach the photo to the most-recently-opened, not necessarily the one the photographer is on the course for. v1 mitigation: the client MAY pass `roundId` explicitly. Followup T7-4a: surface a "round picker" in the upload UI when ≥ 2 rounds are simultaneously in_progress.
- **HEIC content-type acceptance.** iOS Safari uploads are usually `image/heic`; some Android browsers send the same content as `image/jpeg`. The validator allowlist accepts both; the underlying file may not actually display in non-iOS browsers. Wolf Cup has the same issue and never resolved it. Followup T7-4b: server-side EXIF-based transcode (sharp.js) if HEIC display becomes a real complaint.
- **Signed-URL TTL mismatch with cache (TWO independent caches).** Two cache surfaces extend the URL's effective lifetime past the 1h presign TTL: (1) **TanStack Query in-memory cache** of the GET response (the API response is `cache-control: no-store` for the browser HTTP cache, but Query's in-memory cache is independent of HTTP cache headers). (2) **Browser `<img>` HTTP cache for the R2 object response** — once an `<img src={signedUrl}>` is rendered and the browser caches the response, refreshing the page within the cache window serves the same bytes regardless of whether the URL itself has expired. This is FINE for the user (image still renders) but means the "URL expired" failure mode only manifests on a forced reload past the cache TTL. Mitigation in v1: gallery page sets `staleTime: 0` + `refetchOnWindowFocus: true` so re-focusing re-fetches the API → re-presigns. Followup T7-4c remains the long-term play: extend presign TTL to 12h, or pre-sign just-in-time on viewport-enter (intersection observer). The risk of stale URLs surfacing as broken images in v1 is ONLY in the narrow case of a tab open > 1h with no focus events AND the user pulling to refresh past the browser image cache.
- **R2 outage on upload.** A 5xx from R2 returns 502 to the client and writes no DB row. Multi-file flows continue with the next file (per AC-5) and the failed photo is reported in the summary banner. No queue / retry — Wolf Cup doesn't have one either; the offline-queue layer (T5-3) does NOT cover this surface in v1.
- **Gallery quota / abuse.** No per-event byte cap, no rate limit. Wolf Cup has no quota either; the trip-scope (≤ 4 days, ≤ 12 players, ≤ ~500 photos at most) makes this an acceptable v1 risk. Followup T7-4d: hourly upload count guard on the audit_log if abuse appears.

## Followups (out of scope, capture only)

- **T7-4a** — round-picker UI for simultaneous-round upload disambiguation.
- **T7-4b** — server-side HEIC → JPEG transcode for cross-browser display.
- **T7-4c** — signed-URL TTL extension or just-in-time presigning.
- **T7-4d** — abuse guard (hourly upload count check on audit_log).
- **T7-4e** — bulk-download zip endpoint for organizers (post-trip archive).
- **T7-4f** — caption / EXIF rotation surface (Wolf Cup carries `caption`; tournament dropped it for v1 simplicity).
- **T8 wiring** — once `lib/activity.ts` is non-no-op, gallery.uploaded events should drive a real-time toast on other participants' devices ("Matt uploaded 3 photos to Round 1"). The emitter call site already exists; T8's body change picks it up.

## Definition of done

- All AC pass (AC-1 through AC-13).
- `pnpm --filter @tournament/api test` green; new schema test + r2-client test + gallery integration test included.
- `pnpm --filter @tournament/web test` green; new gallery route test + updated event-home test included.
- `pnpm -r typecheck` clean.
- `pnpm -r lint` clean.
- Wolf Cup test counts unchanged (engine 468, api 429+).
- `apps/tournament-api/PORTS.md` updated with two new entries.
- `0008_gallery_photos.sql` migration with explicit `--> statement-breakpoint` separators.
- `docker-compose.yml` tournament-api block has the four R2 env passthroughs (after SHARED approval).
- `pnpm-lock.yaml` reflects the two new tournament-api deps (after SHARED approval).
- Spec + impl + party codex reviews each PASS or FIXED-N (no STOP-on-High user decisions outstanding).
- Provenance headers in `r2-client.ts` and `gallery.ts` cite the wolf-cup commit SHA captured at port time (substituted into the placeholder).
- **Manual real-R2 smoke (Josh, before commit).** Per the 2026-04-26 lesson (codex/party/mocked tests missed an Anthropic strict-mode subset bug; only real-API smoke caught it), tournament's first call to `getSignedDownloadUrl` against the actual R2 bucket exercises a code path Wolf Cup does NOT (Wolf Cup uses `R2_PUBLIC_URL` only — it never calls the presigner). Smoke checklist: (a) `pnpm -F @tournament/api dev` locally with the four R2_* envs from Josh's `.env`; (b) POST a 1 KB JPEG to `/api/events/:eventId/gallery` against an existing event; (c) GET the gallery and assert the returned `signedUrl` is fetchable with 200 + correct Content-Type. If the presigner produces a malformed URL or the credential scope rejects the GET, this catches it before commit. Wolf Cup's daily PUTs against the same bucket already smoke-test the `PutObjectCommand` and `DeleteObjectCommand` shapes; they do NOT smoke-test the presigner — that's the delta this story introduces.
