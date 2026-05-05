# Codex Review

- Generated: 2026-05-05T11:56:21.497Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md

## Summary

Spec is mostly concrete and ports a proven Wolf Cup pattern while keeping tournament-only boundaries. Main gaps are around (1) missing/unclear final ACs due to truncation, (2) safety/correctness details for multipart size limiting and signed-URL caching/TTL behavior, (3) key-prefix safety if eventId isn’t strictly constrained, and (4) lack of a real-R2 smoke test on tournament side (though upstream Wolf Cup usage partially de-risks SDK call shapes).

Overall risk: medium

## Findings

1. [medium] Spec claims AC-1 through AC-13 but provided content is truncated mid-AC-12; AC-13 cannot be reviewed/implemented confidently
   - File: _bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md:288-407
   - Confidence: high
   - Why it matters: Implementation gates and tests depend on complete, reviewable acceptance criteria. As provided, the reviewer/dev cannot confirm what AC-13 requires (or whether AC-12 has additional constraints past the truncation), creating a high chance of “done but not accepted” or missing a required constraint.
   - Suggested fix: Re-provide the full spec content (especially AC-12 remainder and AC-13). If AC-13 was removed, update the header text that says “AC-1 through AC-13” to avoid contradiction.

2. [high] Multipart upload size/type validation is specified post-parse; missing an explicit server-side body size limit risks memory/CPU DoS
   - File: _bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md:113-118
   - Confidence: medium
   - Why it matters: Checking `photo.size <= 10MB` after parsing `multipart/form-data` does not prevent the server from reading a much larger request into memory first (depending on Hono adapter/body parser defaults). Even with auth, a malicious participant could attempt oversized bodies that exhaust memory or degrade performance.
   - Suggested fix: Add an AC-level requirement for a request body limit at the framework/server layer (e.g., Hono body limit middleware / adapter limit) for the upload route (and ideally global). Clarify whether file buffering is in-memory vs streamed and ensure the limit is enforced before buffering.

3. [medium] R2 key construction uses raw `eventId` in the key prefix; if event IDs can contain '/', it can escape the intended prefix partitioning
   - File: _bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md:18-19
   - Confidence: medium
   - Why it matters: S3/R2 object keys are opaque strings—there’s no path traversal—but allowing `/` in `eventId` would let callers create objects under unintended prefixes (e.g., `tournament/events/{eventIdWithSlash}/...`) which complicates lifecycle rules, analytics, cleanup scripts, and any prefix-based access assumptions (D5-10). It also increases risk of collisions or violating the “tournament-only prefix” intent.
   - Suggested fix: Explicitly constrain `eventId` format at the route layer (e.g., UUID regex) or sanitize/encode it before concatenating into the key. Add a test/AC that eventId must be a UUID and that generated keys always match `^tournament/events/[a-f0-9-]{36}/` (or your canonical ID format).

4. [medium] Signed-URL TTL + caching: only the API response is `cache-control: no-store`; object responses may still be cached and served past URL expiry
   - File: _bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md:147-161
   - Confidence: medium
   - Why it matters: Presigned URLs expiring in 1h does not guarantee the image won’t be served after expiry if an intermediary/browser caches the *image response* for that presigned URL. Setting `cache-control: no-store` on the JSON list response doesn’t control caching of the subsequent GET to R2. This can weaken the intended “short-lived access” posture and create confusing client behavior (stale images) or longer-than-expected access.
   - Suggested fix: Decide and specify object-level caching behavior: either set `CacheControl` metadata on `PutObject` (e.g., `private, max-age=3600` or `no-store`) and/or ensure the R2/public endpoint/CDN is configured not to cache presigned URL responses. Add an AC/test expectation for `PutObjectCommand` including a `CacheControl` value aligned to the TTL if that’s the chosen solution.

5. [medium] Active-round resolution depends on `round_states.state IN ('in_progress','complete_editable')` and `entered_at`; spec doesn’t state this schema/enum is already present in tournament-api
   - File: _bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md:90-122
   - Confidence: medium
   - Why it matters: If tournament-api’s DB does not yet have `round_states` (or uses different state names/column names), the upload route’s auto-link behavior (AC-3) will either fail at runtime or silently fail to associate rounds, producing inconsistent UX and breaking acceptance tests.
   - Suggested fix: Add an explicit dependency note/AC that the `round_states` table and the referenced enum values/columns exist (from T7-3 or earlier) in tournament-api migrations. If not guaranteed, define a fallback heuristic (e.g., based on `event_rounds` or `rounds.status`) and test it.

6. [medium] No tournament-side real-R2 smoke test is specified; only mocked vi.mock tests are planned (lesson 2026-04-26)
   - File: _bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md:387-400
   - Confidence: high
   - Why it matters: Mocked tests can validate call shapes but won’t catch real integration issues (endpoint/region quirks for Cloudflare R2, auth/env wiring in the tournament-api service, subtle presigner requirements). Wolf Cup’s daily live usage does indirectly validate the shared bucket + basic SDK shapes, but it does not validate tournament-api’s env plumbing, prefix, or presigned GET behavior from its runtime.
   - Suggested fix: Add a minimal opt-in smoke test plan: e.g., a separate CI job/manual script guarded by env vars that performs Put→Presign GET→(optional HEAD)→Delete under a disposable key prefix `tournament/events/smoke/{uuid}`. If you decide it’s not warranted because Wolf Cup already exercises the same bucket, document that explicit rationale in the spec to satisfy the 2026-04-26 lesson requirement.

## Strengths

- Clear tournament-only path footprint with explicit SHARED hard-stop (pnpm-lock.yaml, docker-compose.yml) and no prescribed edits to FORBIDDEN Wolf Cup paths (lines 219-287).
- Good data safety posture: R2-then-DB with best-effort cleanup on DB failure; delete is best-effort on R2 but always cleans DB to avoid ghost rendering (lines 125-134, 168-173).
- Explicit no-existence-leak/auth chain requirements and consistent 401/403 expectations across routes (lines 105-108, 351-364).
- Schema FK semantics are thoughtfully chosen for event delete cascade and round delete SET NULL to preserve photos (lines 41-45, 365-370).
- Strong test plan coverage across schema constraints, route behaviors, and web UX (AC-12; lines 387-404), assuming the truncated remainder doesn’t add more requirements.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T7-4-per-event-photo-gallery-r2-storage-reuse.md
