# T7-4 Party-Mode Review — Per-Event Photo Gallery (R2 Storage Reuse)

**Format:** single-pass written review covering analyst, architect, pm, qa, dev, and ux-designer perspectives. Non-interactive; no questions for the user. The director ran party-mode after impl-codex round 3 (0H + 2M + 1L, all addressed inline) on a clean tree at branch master.

**Test status at review time:** tournament-api 848 + 2 skipped (Δ +36 from 812 + 2); tournament-web 172 (Δ +8); Wolf Cup engine 472 unchanged; Wolf Cup api 516 unchanged. Typecheck + lint clean across all 6 workspaces.

---

## Analyst (Mary)

**AC compliance scan (AC-1 → AC-13):**

- **AC-1 — Provenance headers + PORTS.md.** PASS. `r2-client.ts:1-4` and `gallery.ts:1-8` carry the source path + commit SHA + arch D5-10 reference. `PORTS.md` adds two rows with deltas spelled out. The deltas are accurate ("WC keys by roundId only" → tournament event-centric; "R2_PUBLIC_URL fast-path NOT ported" → presigned reads).
- **AC-2 — Schema + migration.** PASS. `gallery.ts:42-77` defines the table with the FK posture the AC mandates (event CASCADE / round SET NULL / player RESTRICT, r2_key UNIQUE). Migration `0008_gallery_photos.sql` separates every CREATE with `--> statement-breakpoint` (the 2026-05-01 libsql gotcha is honored).
- **AC-3 — POST happy path.** PASS. `gallery.ts:107-266` lays out the full sequence and the integration test asserts DB row + audit + signed URL in one go.
- **AC-4 — Upload validation + storage-not-configured.** PASS. The 6-step validation list from the spec (bodyLimit / r2Configured / missing photo / type / size) is implemented in the documented order and each branch has a test.
- **AC-5 — Multi-file sequential.** PASS. `events.$eventId.gallery.tsx:155-181` issues N independent POSTs in series; per-file failures accumulate into a summary banner without aborting siblings; "Uploading N of M…" progress fires between requests. Web test asserts the failure-banner path with a deliberately-failing second file.
- **AC-6 — GET grouping.** PASS. The grouping/ordering test now keeps both rounds intact and asserts `roundNumber === 2` first, `roundNumber === 1` second, unassociated last (codex impl round-1 Med #4 was the original false-positive — addressed in round 2).
- **AC-7 — DELETE organizer-only.** PASS. Auth chain enforces this at the middleware boundary; impl + tests cover 204 / 403 / 404 / R2-fail-but-DB-OK / new tx-fail-but-no-R2-call paths.
- **AC-8 — Auth chain (no soft-leak).** PASS. 401 anonymous → 403 non-participant → 403 not-organizer (DELETE only). Tests cover the first two; the participant middleware re-uses the no-existence-leak posture from T7-1/2/3.
- **AC-9 — Round cancel preserves photos.** PASS. Schema test exercises a real `DELETE FROM rounds` and verifies the photo row's `round_id` flips to NULL with `event_id` intact. Integration test "FK SET NULL on round deletion" reproduces it through the route.
- **AC-10 — Web gallery renders.** PASS. Header + count + grid + lightbox + organizer-only delete. 8 web tests cover the render paths.
- **AC-11 — Event home links to gallery.** PASS. Card added at index 5; web test asserts `href === '/events/$eventId/gallery'`.
- **AC-12 — Tests.** PASS. Schema test (6), r2-client test (7), gallery integration test (22), web component test (8) — 43 new tests all passing. The cleanup-on-tx-fail and DELETE-tx-fail paths both have explicit coverage with load-bearing spy assertions.
- **AC-13 — Wolf Cup unmodified.** PASS. `git diff master -- apps/api apps/web packages/engine` is empty.

**Verdict:** Every AC is satisfied with concrete evidence. No deferred AC.

---

## Architect (Winston)

**Boundary review (FD-1 / FD-2):**

The port respects the engine boundary: tournament's `gallery.ts` does NOT import from Wolf Cup. The two ported files carry provenance headers + PORTS.md entries citing source SHA, dated 2026-05-05. Deltas are honest ("event-centric schema", "signed-GET replaces R2_PUBLIC_URL", "auth chain replaces entry-code bcrypt"). When Wolf Cup's gallery evolves, the `Last-checked-for-updates` column is the trigger to re-evaluate.

**Schema posture:**

The asymmetric FK posture (event CASCADE, round SET NULL, player RESTRICT) is well-considered:
- Event CASCADE keeps gallery_photos consistent with the event lifecycle without an orphan-photo population.
- Round SET NULL mirrors the Wolf Cup 2026-04-06 fix ("photos outlive rounds") and means a T5-8 cancel doesn't lose the photos. The "unassociated bucket" naturally absorbs them.
- Player RESTRICT prevents a player deletion from leaving a gallery row with a dangling FK; players are shared infrastructure and pruning them is an exceptional admin op.

**Storage-prefix decision:**

Same R2 bucket as Wolf Cup with `tournament/events/{eventId}/{uuid}.{ext}` is correct per arch D5-10 (line 384, 454). The `isSafeEventId` regex guard at `gallery.ts:75-77` is defense-in-depth — UUIDs from `randomUUID()` cannot contain `/`, `\`, or `..`, but a future schema-validation lapse or a non-UUID id minting path would be caught at the bucket-key construction site. This is the kind of guard that costs nothing and pays out in 1 line of code.

**Presign-before-tx ordering:**

Codex impl-round-1 caught a real hazard (presign-after-commit returns 500 for a successfully persisted row → client retry → duplicate). The fix moves presign before the tx; if presign fails, R2 is cleaned up and 502 is returned. The remaining concern is that getSignedUrl is local SigV4 math — it's astronomically unlikely to fail when uploadToR2 just succeeded. But the cleanup path covers the case anyway. Sound architecture.

**DELETE race-safety:**

The `.returning({ id })` change at `gallery.ts:421-435` plus the `actuallyDeleted` flag converts a write-then-decide pattern into a write-and-decide one. Two concurrent organizer DELETEs cannot both produce a `gallery.deleted` audit row for the same photo. This is a meaningful integrity guarantee for the audit trail.

**aws-sdk version-divergence cast:**

`r2-client.ts:71-87` casts S3Client through `unknown` to satisfy the presigner's type. This is a real risk surface (private `handlers` field diverges across minor versions). The mitigation is the manual real-R2 smoke item on the DOD. **Architect recommendation:** longer term, this monorepo should have aws-sdk subpackages aligned via a workspace catalog or a `pnpm.overrides` clause. For T7-4 it's an accepted risk; for any future tournament-api story that adds a third aws-sdk subpackage, this needs a real fix.

**Concerns:**
- **None blocking.** One thought for a future story: the bucket prefix `tournament/events/{eventId}/` is shared with Wolf Cup's `photos/{year}/round-{N}/`. There's no collision risk today (different prefixes), but the bucket-level access policy (if any) covers both prefixes. If tournament ever needs different IAM scoping than Wolf Cup, that's a separate-bucket migration story, not this one.

---

## PM (John)

**Scope discipline:**

The story trims optional richness (caption, EXIF rotation, original filename, file size) per the spec's "v1 simplicity" call. Every dropped field has a followup. Caption in particular has a Wolf Cup precedent — the v1 trimming saves migration churn now, adds a 3-line ALTER TABLE later when Josh asks for it.

**Velocity vs. risk:**

T7-4 was tagged "target-miss-tolerable, low-effort port" in the epic. The actual implementation honored that posture: minimal new schema (1 table), proven external dependency (R2 same bucket as Wolf Cup), no new auth surface. The follow-on stories T7-4a..T7-4f capture the v1-deferred work without inflating this PR.

**Operational readiness:**

- Production envs: the four R2_* env vars are already set on the VPS for Wolf Cup; the docker-compose.yml change just passes them through to tournament-api. No new secrets to provision.
- The graceful-degradation paths (503 on storage_not_configured for upload; `{ groups: [] }` for list when r2Configured=false) mean a misconfigured first deploy renders an empty gallery rather than a hard error page. Good operational posture.
- Deploy ordering: pnpm-lock.yaml + package.json + docker-compose.yml all land in one commit so the build succeeds on first deploy.

**User-facing surface:**

The Photo Gallery card on the event home is the discoverability surface; without it, players would have to know the URL. The card lands as the 5th entry, after Settle Up — reasonable IA: scoring/money primary, photos secondary.

**Concerns:**
- **None blocking.** One thought: the spec's "manual real-R2 smoke" item on DOD is load-bearing. Recommend Josh runs it before pushing, since the presigner SDK call shape is the only path Wolf Cup doesn't smoke daily. The smoke checklist in the spec is concrete (3 steps).

---

## QA (Murat)

**Test inventory:**

| Suite | New | Detail |
|---|---|---|
| `gallery.test.ts` (schema) | 6 | round-trip, event CASCADE, round SET NULL, player RESTRICT, r2_key UNIQUE, round_id NULL allowed |
| `r2-client.test.ts` | 7 | r2Configured false on each missing env, true on all set, throw when not configured, upload/delete/sign mocked SDK calls, custom TTL |
| `gallery.integration.test.ts` | 22 | upload (happy / round_id auto / explicit roundId / invalid roundId / 503 / missing / invalid type / file too large / 413 too big / R2-fail / cleanup-on-DB-fail / 401 / 403), GET (grouping + ordering + cache header / empty / 503 / 403), DELETE (204 organizer / 403 participant / 404 cross-event / 204 even if R2-fails / 500 on tx-fail with no R2 attempt), FK SET NULL |
| `events.$eventId.gallery.test.tsx` (web) | 8 | header + count + grid, empty state, 403, lightbox open + close, organizer delete buttons, FAB triggers picker, sequential progress + per-file failure |
| `events.$eventId.index.test.tsx` (web) | +1 assertion | Photo Gallery card present + href correct |

**Coverage gaps surfaced + addressed:**
- Codex impl-round-1 Med #2 ("no test for R2 PUT success → DB insert fail → cleanup") — addressed; load-bearing spy assertion (`toHaveBeenCalledTimes(1)`) prevents false-positive pass.
- Codex impl-round-1 Med #4 ("grouping test didn't actually validate multi-round ordering") — addressed; rounds intact, ordering asserted by round_number.
- Codex impl-round-3 Med #2 ("no test for the new DELETE tx-failure path") — addressed; mirror of the upload-tx-fail test, asserts no R2 delete attempted.

**Untested-but-acceptable:**
- The `getSignedDownloadUrl` SDK call shape against the actual R2 bucket. Mitigation: manual real-R2 smoke on DOD. Wolf Cup smokes Put/Delete daily; presigner is the delta.
- HEIC display fidelity in non-iOS browsers. Wolf Cup carries the same hazard. Followup T7-4b covers transcode.
- Signed-URL TTL boundary (tab open > 1h with no focus events). Mitigation `staleTime: 0 + refetchOnWindowFocus: true`. Followup T7-4c covers TTL extension.

**Concerns:**
- **None blocking.**

---

## Dev (Amelia)

**Code shape:**

`gallery.ts` reads cleanly: route handler does input validation → round resolution → R2 PUT → presign → DB tx with insert/audit/activity → return. Each error path has its own log event name (`r2_upload_failed`, `gallery_presign_failed`, `gallery_db_insert_failed`, `gallery_orphan_cleanup_failed`, `gallery_delete_failed`, `r2_delete_failed`). No magic; every branch has a structured response body.

**Mock fidelity:**

The test stub for r2-client at `gallery.integration.test.ts:53-77` is a faithful surface — `r2Configured` is mutable per-test, `uploadCalls` / `deleteCalls` / `signCalls` arrays let assertions verify call shape, `failUpload` / `failDelete` flags exercise error branches. The `getSignedDownloadUrl` stub returns a URL containing `X-Amz-Signature` so downstream assertions work without real signing math.

**TypeScript ergonomics:**

The S3Client cast at `r2-client.ts:71-87` is documented and bounded. The spec note about why aws-sdk subpackage version divergence is the cause is preserved in the inline comment. The cast is a smell, but a documented one.

**Reusability:**

The `extFromMime` map and `ALLOWED_TYPES` set are tournament-scoped. If a future story (e.g., admin-uploads to course gallery) needs the same content-type allowlist, it'll be a 3-line copy. Not worth a shared util at this volume.

**Concerns:**
- **None blocking.** Nit: the `Buffer.from(await file.arrayBuffer())` at `gallery.ts:180` allocates the full 10 MB in memory before R2 PUT. For tournament's 4-day trip + ≤500 photos lifetime scope this is fine; for bigger workloads, pipe the stream directly to S3Client via `Body: file.stream()`. v1 acceptable.

---

## UX Designer (Sally)

**Gallery page anatomy:**

- **Header.** Photo count is good (sets expectations on load); "No photos yet" + camera-button hint is good empty-state copy.
- **FAB.** 56×56 circle, bottom-right, visible-when-scrolled. Standard Material/iOS pattern. The 📷 emoji works as a placeholder; if the league wants brand polish, a future T7-4-a-icon ticket can swap it for an SVG. Not blocking.
- **Sequential upload progress.** "Uploading 3 of 5…" pill is the right cadence for honest feedback; the failure banner is dismissible and lists per-file reasons. Wolf Cup learned this in 2026-03-22 — don't re-discover.
- **Photo grid.** `repeat(auto-fill, minmax(120px, 1fr))` is mobile-first; on desktop it'll go to 4-6 columns naturally. Square aspect ratio + `object-fit: cover` keeps the grid orderly even when sources are mixed portrait/landscape.
- **Lightbox.** Native `<img>` with `max-width: 95vw / max-height: 95vh` — pinch-zoom on iOS Safari and double-tap-zoom on Android Chrome handle the interaction without a custom widget. Click-outside dismisses.
- **Delete confirmation.** Modal with explicit "This cannot be undone" copy + Cancel + Delete (red) buttons. Good destructive-action posture.

**Group label UX:**

The current label format is "Round 1" + a `<span>` with the formatted date next to it. The web test caught a subtle thing: the heading's accessible name reads as `"Round 1May 8"` (no space because the span and the round-number text-node are children of the same h2). Functionally fine for screen readers, but visually a non-breaking space or " — " separator would be cleaner. **Non-blocking nit:** consider `Round {n} · {date}` in a future polish pass.

**Lightbox on iOS keyboard scenarios:**

Not a concern here (no input fields in the lightbox). But the upload picker's `capture="environment"` hint should surface iOS's "Photo Library / Take Photo" sheet. Worth confirming on the manual smoke when Josh or a player runs it on an iPhone.

**Organizer-only trash icon:**

The 🗑 emoji in a `position: absolute` button overlay on each photo card is fine for v1. The organizer-only render path means non-organizers don't see it at all (verified by the web test). Tap target is small (~16px); acceptable for desktop, marginal for mobile thumbs. **Non-blocking nit:** bump tap target to 32×32 with a transparent extension if Josh hears a complaint.

**Concerns:**
- **None blocking.**

---

## Cross-cutting verdict

**Pass.** Every AC is satisfied. The codex review chain (3 spec rounds + 3 impl rounds) addressed the High findings inline; the residual Mediums (presigner SDK cast, manual-smoke-only verification of the presigner shape, signed-URL TTL vs cache, isSafeEventId guard scope) are documented in the spec's Risks + DOD smoke and have followup tickets. No party-mode-only findings emerged that codex missed.

**Recommended next steps (none gate this commit):**
1. Run the manual real-R2 smoke from DOD before Josh pushes (3-step checklist in the spec). This is the only verification of the presigner SDK shape against the live bucket.
2. Future hygiene: align aws-sdk subpackage versions via pnpm catalog or pnpm.overrides to remove the type-cast smell at `r2-client.ts:71-87`.
3. Followups T7-4a..T7-4f remain captured in the spec's Followups section; none are urgent for v1.

**Implemented changes from this party review:** none required. All recommendations are non-blocking nits or already-captured followups.
