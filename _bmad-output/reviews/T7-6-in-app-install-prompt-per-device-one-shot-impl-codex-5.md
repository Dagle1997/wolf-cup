# Codex Review

- Generated: 2026-05-05T19:57:43.674Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/__root.tsx

## Summary

The new URL-shape tightening is close, but `extractEventIdFromLocation()` can still accept *prefixes* of an invalid eventId segment due to the non-anchored regex. That can still produce a backend 400, which you explicitly treat as “success” and will keep the host stamp guard locked for the SPA session—recreating the lockup path you were trying to eliminate.

Overall risk: high

## Findings

1. [high] EventId extractor can accept a valid prefix of an invalid segment (regex not boundary-anchored), re-enabling 400-as-success lockup
   - File: apps/tournament-web/src/routes/__root.tsx:195-207
   - Confidence: high
   - Why it matters: `extractEventIdFromLocation()` uses `pathname.match(/\/events\/([A-Za-z0-9_-]+)/)` (lines 203-207). This regex will match the longest run of allowed chars after `/events/`, but it does **not** ensure the entire path segment is valid. Example: `/events/aaaaaaaaaaaaaaaa$` (16 'a's followed by `$`) will match and return `aaaaaaaaaaaaaaaa` (length 16, passes the length check), even though the actual segment contains an invalid character. The POST then hits `/api/events/<prefix>/...` with an eventId that doesn’t correspond to the real route segment; backend will likely respond 4xx (invalid_event_id / not found). Because `onShown` treats any 4xx as `succeeded = true` (lines 169-173), `hostStampedRef` remains true and the prompt can be effectively locked out for the remainder of the SPA session without actually stamping the device row—i.e., the round-4 lockup class can still occur.
   - Suggested fix: Parse path segments and validate the **entire** segment, or anchor the regex to a segment boundary. For example:
- Segment approach: `const segs = window.location.pathname.split('/').filter(Boolean); const i = segs.indexOf('events'); const candidate = i >= 0 ? segs[i+1] : null; if (!candidate || !/^[A-Za-z0-9_-]{16,128}$/.test(candidate)) return null;`
- Regex approach: `const m = pathname.match(/\/events\/([A-Za-z0-9_-]{16,128})(?:\/|$)/);`
Also consider ensuring the matched group equals the full segment (no partial-prefix acceptance). Add a regression test case for an invalid character after 16+ valid chars.

## Strengths

- Good defensive parsing of `/api/auth/status` response avoids trusting unknown JSON shapes (lines 39-69).
- The host-level `hostStampedRef` correctly mitigates StrictMode remount/double-invoke issues and prevents double POSTs within a mounted host instance (lines 82-89, 144-150).
- Re-checking eventId inside `onShown` before POSTing is a solid guard against navigation races (lines 151-161).

## Warnings

None.
