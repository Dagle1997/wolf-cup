# Codex Review

- Generated: 2026-05-02T13:15:56.649Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T5-10-airplane-mode-drill-409-collision-integration-test-impl-codex-rerun.md, apps/tournament-web/src/scripts/drill-offline-scorer.md, apps/tournament-api/src/routes/scores.integration.test.ts

## Summary

The strengthened 409 integration test does match the party review’s description: it now asserts the conflicting entry’s clientEventId, verifies the surviving DB row’s identity via clientEventId (not just grossStrokes), and checks “no audit on 409” using both entity-scoped and global score.committed counts. The offline drill Step 3 “return to PWA” ambiguity has been fixed (it now explicitly says to switch back to the PWA and confirm the in-app offline indicator). However, the “VPS host removal” claim is only partially true: credentials/host details are removed, but the doc still explicitly names “Hostinger” as the VPS provider. I also see a similar minor ambiguity in Step 6 after leaving Settings in Step 5.

Overall risk: low

## Findings

1. [medium] Manual drill: Step 6 assumes the operator is back in the PWA after Step 5 (Settings), but doesn’t explicitly say so
   - File: apps/tournament-web/src/scripts/drill-offline-scorer.md:69-97
   - Confidence: high
   - Why it matters: Step 5 explicitly sends the operator into iOS Settings to disable Airplane Mode. Step 6 then asks them to observe the in-app queued indicator draining and/or check the leaderboard, but does not explicitly instruct switching back to the tournament PWA first. This can cause confusion during execution and inconsistent drill results (similar failure mode to the previously-fixed Step 3 ambiguity).
   - Suggested fix: Add an explicit first instruction in Step 6 like: “Return to the tournament PWA (score-entry page) immediately after disabling Airplane Mode, then start the 30s timer and observe the queue drain / check leaderboard.”

2. [low] Rerun claim mismatch: doc still names the VPS host/provider (“Hostinger”) despite removing credentials/host details
   - File: apps/tournament-web/src/scripts/drill-offline-scorer.md:102-107
   - Confidence: high
   - Why it matters: Your rerun focus mentions “VPS host removal.” While the checklist no longer embeds host + SSH credentials (good), it still hardcodes the provider name (“Hostinger”). If the intent was to remove host/provider coupling from a public-eligible checklist (to avoid stale guidance or accidental disclosure of infrastructure vendor), this hasn’t fully landed.
   - Suggested fix: Replace “Hostinger” with a provider-agnostic phrase (e.g., “the production VPS”) and keep the SOP reference for details.

3. [low] 409 integration test: first POST response is not asserted (setup failure becomes less direct to diagnose)
   - File: apps/tournament-api/src/routes/scores.integration.test.ts:341-349
   - Confidence: high
   - Why it matters: The 409 test relies on the first POST successfully creating the original row. If that insert ever fails unexpectedly, later assertions will fail but with less targeted diagnostics than an explicit `expect(first.status).toBe(201)`.
   - Suggested fix: Capture the first response and assert status 201 (and optionally parse/verify `deduped === false`).

## Strengths

- 409 path is now defended against a silent overwrite by asserting the surviving hole_scores row’s clientEventId is still the original value (apps/tournament-api/src/routes/scores.integration.test.ts:367-385).
- “No audit on 409” is tested with defense-in-depth: entity-scoped audit count and global score.committed count (apps/tournament-api/src/routes/scores.integration.test.ts:386-409).
- Offline drill Step 3 now explicitly instructs switching back to the PWA and uses Safari/example.com only as an optional independent network check, reducing false positives from PWA cache behavior (apps/tournament-web/src/scripts/drill-offline-scorer.md:45-53).
- Drill checklist no longer embeds SSH host/credentials directly and pushes those to an internal SOP (apps/tournament-web/src/scripts/drill-offline-scorer.md:104-107).

## Warnings

- Requested path was not found: _bmad-output/reviews/T5-10-airplane-mode-drill-409-collision-integration-test-party-review.md
