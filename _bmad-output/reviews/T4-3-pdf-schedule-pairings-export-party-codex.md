# Codex Review

- Generated: 2026-04-28T12:12:03.732Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T4-3-pdf-schedule-pairings-export-party-review.md, apps/tournament-api/src/routes/pdf-schedule.ts, apps/tournament-api/src/lib/pdf-gen.ts, apps/tournament-api/PORTS.md

## Summary

From the provided files, the 4 “NOT blockers” look correctly categorized (none are hidden blockers). Tenant scoping in pdf-schedule.ts appears comprehensive across all SELECTs shown, and the Buffer→Blob path copies bytes safely (no pooled-buffer adjacency leak). One concrete correctness risk exists in pdf-gen.ts: listeners for the terminal 'end' event are attached after doc.end(), which can (in some stream implementations) miss the event and hang forever. Also consider adding Cache-Control headers for a token-in-URL export endpoint to reduce unintended intermediary caching risk.

Overall risk: medium

## Findings

1. [medium] Potential race: 'end' listener attached after doc.end() could miss end event and hang renderEventPdf()
   - File: apps/tournament-api/src/lib/pdf-gen.ts:159-165
   - Confidence: medium
   - Why it matters: renderEventPdf resolves only when the PDFDocument emits 'end'. The code calls doc.end() before registering the 'end'/'error' listeners. If pdfkit (or future versions) emits 'end' synchronously/immediately upon doc.end() while in flowing mode, the listener could miss it and the Promise would never resolve (request hangs, tests may flake). Even if current pdfkit behavior is async, this is a fragile ordering dependency.
   - Suggested fix: Attach 'end' and 'error' listeners before calling doc.end() (or use once() to avoid leaks). Example: create the Promise first, register listeners, then call doc.end() as the last step.

2. [medium] PDF export response lacks explicit cache-control; token-in-URL responses are safer as no-store/private
   - File: apps/tournament-api/src/routes/pdf-schedule.ts:334-340
   - Confidence: medium
   - Why it matters: This endpoint returns potentially sensitive participant/handicap data and is authorized via an invite token in the URL path. Without Cache-Control headers, intermediaries/browsers may cache the PDF. While caches are usually keyed by full URL (including token), accidental storage in shared proxies or device caches is still a common leakage vector for tokenized downloads.
   - Suggested fix: Add headers such as `Cache-Control: private, no-store` (and optionally `Pragma: no-cache`) on the PDF response.

## Strengths

- Tenant scoping in pdf-schedule.ts is applied on every SELECT shown (events, eventRounds, courseRevisions, courses, pairings, pairingMembers+players, groups, groupMembers+players).
- Defense-in-depth check `urlEventId !== invite.eventId` correctly blocks cross-event token reuse (403 event_token_mismatch).
- Filename slugification constrains output to `[a-z0-9-]` plus a fixed suffix, making header injection via CR/LF in event.name implausible as implemented.
- Buffer → ArrayBuffer → Blob copy is bounded to the Buffer view’s byte length, avoiding pooled-buffer adjacent-byte leakage.
- PDF determinism is intentionally supported via `info.CreationDate = new Date(0)`.

## Warnings

None.
