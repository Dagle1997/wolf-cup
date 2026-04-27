# Codex Review

- Generated: 2026-04-27T19:39:56.203Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T3-9-sub-game-opt-in-ui-on-round-setup-party-review.md, apps/tournament-api/src/routes/admin-event-rounds.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx

## Summary

1) The 5 “NOT blockers” don’t look like blockers *from the provided code alone*. The only one that could become a real blocker is the “no clear skins” limitation **if** downstream scoring treats presence of a `sub_games` row as “enabled” regardless of empty participants; that dependency isn’t in the provided diff, so can’t prove. The “page unreachable” is UX/scope, not correctness/security.

2) Party recs vs impl drift: the key recs called out in the party synthesis are present in the shown code (serverHadSkins gate, tenant scoping on players join, v1 type allowlist, deterministic error precedence). No obvious drift in the files provided.

3) Path-allowlist: based on the files shown, changes are confined to the described new router + mount + new page. I can’t verify against the story allowlist file since it wasn’t provided, but the footprint matches your enumerated implementation list.

4) Test-count drift: cannot verify. The new test files aren’t included in the provided contents, and no test runner output is shown. Your claimed totals (392 backend, 43 frontend) match the party doc text, but I can’t independently confirm.

5) “SHIP” vs disciplinary findings: with the evidence here, there are no critical/high blockers. One medium risk is noted below (non-enabled sub-game types returned by GET but not clearable in UI). Overall “SHIP” is consistent.

Overall risk: medium

## Findings

1. [medium] GET can return disabled sub-game types that the UI cannot clear, potentially creating a persistent dead-end config
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:147-179
   - Confidence: high
   - Why it matters: Backend GET returns all existing `sub_games` rows for the round without filtering to v1-enabled types. The frontend renders non-v1 types in disabled fieldsets (so they can’t be edited/removed). If any non-skins rows exist (e.g., legacy/manual inserts, future partial rollouts, or data corruption), organizers may be unable to clear them via UI, contradicting the backend’s stated goal of avoiding “inert config rows the UI couldn’t clear.”
   - Suggested fix: Either (a) filter GET output to only v1-enabled types (and optionally log/alert if others exist), or (b) allow clearing/deleting disabled types via a separate control, or (c) allow POST to include non-enabled types *only for deletion/clearing* semantics.

2. [low] Hardcoded TENANT_ID makes the route environment-specific and easy to mis-deploy
   - File: apps/tournament-api/src/routes/admin-event-rounds.ts:63-65
   - Confidence: high
   - Why it matters: `TENANT_ID = 'guyan'` hardwires tenant scoping. If this service is run for another tenant (or in tests/preview envs), the endpoints will 404/behave incorrectly even for valid data. The party review flags broader tenant retrofit as follow-up, but this constant is still a correctness footgun in isolation.
   - Suggested fix: Resolve tenantId from session/request context (or env) rather than a literal. If that’s deferred intentionally, add an explicit assertion/comment tying it to the deployment model and a test that would fail loudly if TENANT_ID is misconfigured.

## Strengths

- Backend POST validation is ordered/deterministic and matches the documented precedence (invalid_body → not_found → not_enabled → dup type → dup participant → player_not_in_event).
- POST upsert is transactional (delete-then-insert in a single tx), reducing partial-write/data-loss risk on mid-insert failures.
- Frontend `serverHadSkins` gate + `isDirty` being pure content-equality avoids the prior “save clears empty row” footgun described in the party review.
- Cross-tenant defense-in-depth is present in the roster join (`eq(players.tenantId, TENANT_ID)`), not just groupMembers scoping.

## Warnings

None.
