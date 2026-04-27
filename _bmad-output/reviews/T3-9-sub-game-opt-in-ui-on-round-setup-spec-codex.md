# Codex Review

- Generated: 2026-04-27T19:10:10.454Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md, apps/tournament-api/src/db/schema/subgames.ts, apps/tournament-api/src/db/schema/events.ts, apps/tournament-api/src/db/schema/groups.ts, apps/tournament-api/src/routes/admin-groups.ts, apps/tournament-api/src/routes/admin-rule-sets.ts, apps/tournament-api/src/app.ts

## Summary

Spec is mostly concrete and testable, but a few ACs are internally ambiguous (participantPlayerIds “non-empty” vs expected UX), and the “backend accepts non-skins while UI disables them” creates a real risk of un-removable inert config. Also, the story asserts post‑T3‑7 tenant scoping “on every SELECT/UPDATE/DELETE”, but the provided baseline routers still omit tenant filters, so the requirement is inconsistent with the current codebase posture unless this story’s new router is uniquely hardened.

Direct answers to your 7 review prompts:
1) ACs are mostly unambiguous/testable, but error-code precedence is unspecified (what if multiple invalid conditions apply), and participantPlayerIds non-empty is likely to fight the intended incremental setup flow.
2) Backend accepting non-skins is not purely harmless: it can create “stuck” config the organizer UI cannot clear/edit (because UI disables those sections). It’s also a future-compat footgun if downstream code later assumes “if row exists, feature is live.”
3) DELETE-then-INSERT in a transaction is reasonable for replace semantics and avoids participant-diff complexity; the biggest concern is future data-loss coupling (if later tables FK to sub_games) and concurrent-save behavior, not the composite PK itself.
4) Path allowlist: can’t be confirmed from this workspace snapshot because the new files/diff aren’t provided. The story’s intended footprint is sane.
5) UI-disabled-only is weaker than backend defense-in-depth. Given you already did this defense-in-depth pattern in admin-groups (v1-only guard), rejecting non-skins in POST in v1 would be more consistent and prevents stuck/inert config.
6) Test plan is strong, but you should add a decision + test for “participantPlayerIds: []” (either allowed or 400). Also add a test for “smuggled non-skins exists in DB → UI POST (skins only) does/doesn’t preserve them” depending on intended semantics.
7) Save-disabled-when-idle is defensible, but only if ‘idle’ is computed against the full payload the POST will send. If POST includes non-skins (even disabled), you can get subtle mismatches.


Overall risk: medium

## Findings

1. [high] Spec requires tenant-scoped queries everywhere, but baseline admin routers shown are not tenant-scoped (requirement inconsistency / potential security gap)
   - File: apps/tournament-api/src/routes/admin-groups.ts:100-123
   - Confidence: high
   - Why it matters: The story’s key design decision says “Tenant-scoped (post‑T3‑7 hardening) on every SELECT/UPDATE/DELETE” (story lines 235-236). However, the provided existing admin router queries do not filter on tenant_id (e.g., group lookup and member join are by id only). If T3-9 introduces tenant scoping only in the new router while other admin routers remain unscoped, you’ll have an inconsistent security model and unclear expectations for tests (cross-tenant 404 behavior is asserted in the new ACs).
   - Suggested fix: Either (a) adjust the story to acknowledge the current posture (like admin-rule-sets does in its header comment) and scope only the new endpoints, or (b) broaden scope to harden existing routers too (likely not desired here). At minimum, make the ACs explicit that only the new endpoints are tenant-hardened, and align “cross-tenant → 404” behavior with how other routers currently behave.

2. [high] UI disables non-skins but backend accepts them: can create ‘stuck’ inert config that organizers cannot clear/edit via UI
   - File: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md:42-45
   - Confidence: high
   - Why it matters: Spec explicitly allows cURL-smuggled `ctp/sandies/putting_contest` to be persisted (lines 42-45) while the UI renders those sections disabled (lines 132-134). If such rows exist, GET will return them (AC #2 includes all 4 types), but the organizer cannot remove or modify them through the disabled UI. Worse, depending on how the UI constructs the POST payload, a “skins-only save” might silently delete those rows due to replace semantics, or might preserve them—either behavior is surprising unless specified.
   - Suggested fix: Pick one of: (1) defense-in-depth reject non-`skins` types in POST for v1 (mirrors admin-groups’ v1-only server guard at lines 179-191), or (2) if you intentionally allow them, require the UI to include them unchanged in the POST payload (despite disabled controls) and explicitly add ACs/tests for that behavior; also add an explicit “Clear all” control that sends `subGames: []` to let an organizer purge inert data.

3. [medium] AC ambiguity: participantPlayerIds is specified as “non-empty”, but expected setup flow likely needs empty allowed (and you call out this exact question)
   - File: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md:100-108
   - Confidence: high
   - Why it matters: AC #3 says each subGame entry has `participantPlayerIds: string[] // non-empty` (line 106), while also positioning the page as a configuration UI where an organizer might want to set buy-in now and opt-ins later, or temporarily have zero opt-ins. If empty arrays are rejected, the UI must either omit the subGame entry entirely when no participants are selected (which interacts with replace semantics and the “4 sections always render” requirement) or force at least one participant to save buy-in changes.
   - Suggested fix: Make an explicit decision: either allow empty arrays (`z.array(z.string().uuid()).default([])` / no `.min(1)`) and add a test for it, or keep non-empty but then update the frontend ACs to specify that a sub-game type is only included in the POST when at least one participant is selected (and that buy-in cannot be saved independently).

4. [medium] Error-code precedence is underspecified when multiple validation failures exist (can cause flaky/arguable tests)
   - File: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md:110-114
   - Confidence: medium
   - Why it matters: AC #3 defines distinct 400 codes (`player_not_in_event`, `duplicate_sub_game_type`, `duplicate_participant`, else `invalid_body`). If a request violates more than one rule, the spec doesn’t say which code wins. That can make tests brittle and can surprise clients if the error they see varies with implementation order.
   - Suggested fix: Specify precedence (e.g., Zod parse first → duplicate checks → player_not_in_event, or vice versa) and codify it in tests. Alternatively, return a structured list of validation errors (but that’s a bigger contract).

## Strengths

- ACs define concrete endpoint shapes, status codes, and explicit upsert semantics (DELETE-then-INSERT inside tx) which are straightforward to implement and test.
- Good callout of FK limitations (player_id RESTRICT not event-scoped) and the need for app-level roster membership validation.
- Integer-cents discipline is explicitly documented at both schema and API layers; aligns with existing money posture patterns in the repo.
- Test plan coverage is broad (auth gating, cross-tenant behavior, replace semantics, schema validation, and cascade clear).

## Warnings

None.
