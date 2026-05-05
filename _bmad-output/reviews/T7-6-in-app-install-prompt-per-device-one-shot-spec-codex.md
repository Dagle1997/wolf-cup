# Codex Review

- Generated: 2026-05-05T15:59:55.788Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md

## Summary

Spec is coherent and additive, but a few details are currently load-bearing and under-specified: (1) how idempotency + “no duplicate audit row” is enforced under concurrent POSTs, (2) timestamp units/source-of-truth for install_prompt_shown_at, (3) whether audit_log entity_type accepts the new value without a DB/schema change, (4) eventId being “informational only” but still unvalidated and persisted, and (5) AC-8/AC-9 claim route-level/integration coverage that isn’t reflected in the listed test file changes.

Overall risk: high

## Findings

1. [high] Idempotency + audit uniqueness is not guaranteed under cross-tab/concurrent POSTs unless UPDATE+audit insert is atomic/conditional
   - File: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md:40-41
   - Confidence: high
   - Why it matters: AC-3 requires: preserve the original timestamp AND write NO duplicate audit rows when already stamped. The spec also calls out cross-tab race (two tabs POSTing) as acceptable because the endpoint is “idempotent” (lines 301-302). However, if the implementation does a read-then-update + separate audit insert, two concurrent requests can both observe NULL, both update (or one overwrites), and/or both insert audit rows—violating AC-3 in real-world concurrency even if single-thread tests pass. React StrictMode + the “onShown on unmount” defense (line 93) increases the likelihood of multiple POSTs happening close together.
   - Suggested fix: Require an atomic pattern: e.g., `UPDATE device_bindings SET install_prompt_shown_at = ? WHERE id=? AND player_id=? AND tenant_id=? AND install_prompt_shown_at IS NULL` and only insert the audit row if `rowsAffected === 1` (ideally inside a transaction). Consider also a uniqueness guard for the audit row (e.g., dedupe by `(event_type, entity_id)` or store a “first_shown” fact in device_bindings only). Add a concurrency-focused test (two parallel POSTs starting from NULL) to assert exactly one audit row and an unchanged timestamp thereafter.

2. [medium] Timestamp unit/source-of-truth ambiguity: schema says “ms-since-epoch” but backend text mixes DB now() and Date.now() semantics
   - File: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md:31-41
   - Confidence: high
   - Why it matters: The Drizzle column comment says “ms-since-epoch” (line 31-32) and AC-2 says set `install_prompt_shown_at = Date.now()` (line 210), but the earlier endpoint behavior says “set it to now()” (line 40). Depending on DB/dialect, `now()` may not exist, may return seconds, or may return a formatted string. A unit mismatch will break suppression logic (frontend treats it as a number) and make debugging/auditing confusing.
   - Suggested fix: Specify explicitly that the server writes a millisecond epoch integer computed in application code (e.g., `Date.now()`), not a DB function, and that it is UTC epoch ms. Mirror this in the migration comment/README and tests by asserting a plausible ms range (>= 1e12).

3. [medium] Audit entity_type allowlist/enum risk: spec adds DEVICE_BINDING constant but does not confirm DB constraints accept 'device_binding'
   - File: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md:47-52
   - Confidence: medium
   - Why it matters: The spec proposes adding `AUDIT_ENTITY_TYPES: add DEVICE_BINDING = 'device_binding'` (lines 49-52). If T7-5 (or existing schema) enforces an enum / CHECK constraint / Zod allowlist on `audit_log.entity_type`, inserting this new value could fail at runtime. The review prompt explicitly flags this as a potential layering error.
   - Suggested fix: Confirm (in code) where entity types are validated: DB constraint, Drizzle enum, runtime schema, or app-level constants. If constrained, include the necessary migration/schema update and expand tests to assert the audit insert succeeds with `entity_type='device_binding'`. If unconstrained, still ensure any TS/validation layer is updated consistently.

4. [medium] eventId is “informational only” but is unvalidated user-controlled input persisted to audit payload
   - File: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md:34-45
   - Confidence: high
   - Why it matters: The endpoint intentionally does not validate `:eventId` against session membership (line 36), and uses it only in audit payload (line 43). But because `eventId` is in the URL, any authenticated user can POST with arbitrary strings; those values get persisted into audit logs. This can cause audit/log pollution, oversized payloads, and complicate audit analysis. If any downstream tooling assumes eventId shape, this becomes a latent injection/robustness issue (even if not a direct permission bug).
   - Suggested fix: At minimum, validate `eventId` shape/length (e.g., UUID-ish or `[A-Za-z0-9_-]{1,64}`) before writing to audit payload; reject/404 on malformed. Optionally store only `deviceBindingId` in payload and omit eventId entirely if it is truly informational, or truncate/sanitize before persistence.

5. [medium] AC-8/AC-9 claim route-level/integration test coverage, but the planned file changes don’t include any such tests
   - File: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md:266-283
   - Confidence: high
   - Why it matters: AC-8 says the mutation-site wiring is “Tested at the route-test level” (lines 276-277). AC-9 describes an end-to-end flow assertion through a render harness (lines 278-283). However, the path footprint/test list includes only: `install-prompt.integration.test.ts` (API), `auth.test.ts` (API), `install-prompt.test.tsx` (component), and `use-first-mutation.test.tsx` (hook). No route-level tests for `rounds.$roundId.score-entry` or `events.$eventId.gallery`, and no `InstallPromptHost` integration test is listed. This is a spec contradiction unless those tests are embedded elsewhere (not indicated).
   - Suggested fix: Either (a) add/modify explicit route-level test files and list them in the path footprint, or (b) downgrade AC-8/AC-9 to what’s actually covered (unit tests only), or (c) implement AC-8/AC-9 via new tests (e.g., `rounds...test.tsx`, `gallery...test.tsx`, or an `__root`/InstallPromptHost integration test) and ensure they assert `markMutation()` is called and prompt suppression after POST+status invalidation.

6. [low] beforeinstallprompt deferred event lifecycle not specified (clearing/staleness)
   - File: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md:115-118
   - Confidence: medium
   - Why it matters: The spec stores the captured `beforeinstallprompt` event globally on `window.__deferredInstallPrompt` (lines 115-118). After calling `prompt()` and awaiting `userChoice`, the event is typically single-use; keeping it around can lead to UI showing an Install button that calls `prompt()` on an already-used event (runtime error/ignored) until `installPromptShownAt` suppresses it. This is most noticeable if onShown POST fails and the UI remains mounted.
   - Suggested fix: After handling `userChoice`, clear the stored event (set to null/undefined) and/or store a local “promptAttempted” flag so the button can disable/hide immediately even if the backend stamp hasn’t completed yet.

7. [low] Forward-compat claim for /api/auth/status is asserted but not evidenced; risk if any consumer uses strict response validation
   - File: _bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md:54-69
   - Confidence: medium
   - Why it matters: The spec states existing consumers “ignore unknown keys” (line 68) and AC-10 relies on destructuring `{ player }` (lines 284-288). If any client uses an exact Zod schema or `satisfies` checks that forbid unknown keys, adding `device` could break them. The spec says it was verified at spec-time, but no concrete reference is provided here.
   - Suggested fix: In implementation, confirm by grepping consumers for schema validation of `/api/auth/status`. If any strict validation exists, update schemas to allow passthrough/unknown keys. Keep the planned `auth.test.ts` coverage that demonstrates destructuring continues to work, but also ensure typed client decoders (if any) are updated.

## Strengths

- Clear per-(player, device) invariant and explicit cross-player guard using `(device_binding.id, session.player.id, tenant_id)` (lines 38-39).
- Good explicit idempotency requirements (preserve timestamp, no duplicate audit row) and explicit 204/404/401 behaviors (lines 39-42, AC-2/3/4).
- Defense-in-depth approach (onShown on unmount) acknowledges real UX failure modes; risks are documented with followups (lines 93, 296-307).
- Auth-status extension is additive and provides the minimal device state needed for frontend suppression (lines 54-66).
- Path footprint is constrained to tournament apps and explicitly avoids shared/forbidden areas, consistent with FD-1/FD-2 expectations (lines 138-196).

## Warnings

None.
