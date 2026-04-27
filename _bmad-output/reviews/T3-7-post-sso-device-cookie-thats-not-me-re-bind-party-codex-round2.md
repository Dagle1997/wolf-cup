# Codex Review

- Generated: 2026-04-27T18:28:03.611Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/invites.ts, apps/tournament-api/src/routes/invites.test.ts, _bmad-output/reviews/T3-7-post-sso-device-cookie-thats-not-me-re-bind-party-review.md

## Summary

1) The round‑1 fix in `invites.ts` fully addresses the reported blocker: the cookie-row SELECT is now tenant-scoped (`id`+`tenant_id`) and the UPDATE branch is now gated on both same-event (`contextId === expectedContextId`) and `sessionId === null`, so a post‑T3‑7 consolidated row will not be re-mutated on re-claim; the UPDATE WHERE is also tenant-scoped for defense-in-depth.

2) Within the provided diff/file contents, no other obvious cross T3‑6/T3‑7 interaction hazards are visible in this route beyond the exact consolidated-row re-claim case you fixed.

3) Test count drift: the party review doc shows API +17, but the added Vitest here makes it +18. That’s just documentation drift, not a code issue.

4) The fix preserves T3‑6’s existing protections and happy path: same-event UPDATE still triggers when `sessionId` is NULL (your existing UPDATE-branch test row has `sessionId` NULL), and cross-event protection remains intact (falls through to INSERT when `contextId` differs). The new test correctly pins the post‑T3‑7 consolidated-row behavior (INSERT new row; original untouched).

Overall risk: low

## Findings

1. [low] New test inserts an unused player row with missing fields; may violate NOT NULL constraints / adds brittleness
   - File: apps/tournament-api/src/routes/invites.test.ts:356-362
   - Confidence: medium
   - Why it matters: In the new test, `db.insert(players).values({ id: 'consolidator', ... })` is not referenced by any later insert/update/select in the test, and unlike every other `players` insert in this file it omits `name` (and any other potentially required columns). If `players.name` is NOT NULL (likely, given every other insert sets it), this test can fail for reasons unrelated to the behavior under test; even if nullable today, it’s dead setup that can break with schema tightening.
   - Suggested fix: Delete the unused `consolidator` insert entirely, or populate all required `players` columns (e.g., add `name: 'Consolidator'`). Prefer removal since it’s not used.

## Strengths

- `invites.ts` now correctly prevents identity drift by refusing to UPDATE device_bindings rows once `session_id` is set (post-SSO consolidation).
- Tenant scoping is applied on both SELECT and UPDATE, closing the original cross-tenant mutation avenue.
- The added test exercises the exact post‑T3‑7 consolidated-row re-claim state and asserts the consolidated row remains untouched (pins the original Med blocker).

## Warnings

None.
