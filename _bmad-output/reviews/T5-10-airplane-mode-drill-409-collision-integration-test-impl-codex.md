# Codex Review

- Generated: 2026-05-02T13:12:54.573Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scores.integration.test.ts, apps/tournament-web/src/scripts/drill-offline-scorer.md, _bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md

## Summary

The strengthened 409 integration test assertions are logically sound and should be deterministic given the per-test truncation of `auditLog`/`holeScores`. The drill checklist is largely complete vs AC-4/5/6/7 and the drill-record block is fillable and unambiguous. The main concrete issues are in the drill markdown: (1) a Step-3 troubleshooting line appears logically inverted/misleading for offline verification, (2) the Step-7 `score_corrections` SQL cannot be validated from the provided schema/migrations and may be wrong, and (3) the doc embeds a specific VPS username/IP which is an avoidable security footgun if this repo is ever shared.

Overall risk: medium

## Findings

1. [medium] Drill Step 3 offline verification includes misleading/inverted troubleshooting guidance
   - File: apps/tournament-web/src/scripts/drill-offline-scorer.md:45-52
   - Confidence: high
   - Why it matters: Step 3 is the load-bearing gate for confirming the device is truly offline. The current text says: "if the page won't load at all, wifi is still active". A page failing to load after turning on Airplane Mode is more consistent with (a) truly offline + cache miss/service-worker issue, not "wifi still active". This can cause drill operators to take the wrong corrective action and can lead to false pass/fail outcomes.
   - Suggested fix: Adjust Step 3 troubleshooting to distinguish cases:
- If the page loads normally and the offline indicator is NOT shown, you may still be online (e.g., Wi‑Fi re-enabled).
- If the page does NOT load, treat it as a cache/service-worker failure (Step 2 didn’t cache correctly, or SW not installed) and fail the drill / return to Step 2.
Optionally suggest checking iOS Control Center Wi‑Fi status while in Airplane Mode.

2. [medium] Step 7 SQL references `score_corrections(round_id)` but table/column names are not evidenced in this diff
   - File: apps/tournament-web/src/scripts/drill-offline-scorer.md:115-123
   - Confidence: medium
   - Why it matters: AC focus explicitly calls out correctness of the audit-verify SQL. From the provided API test file/schema imports, we can confirm `audit_log`, `event_type`, `entity_id`, `hole_scores`, and `round_id` are consistent with the Drizzle naming patterns, but there’s no provided evidence that `score_corrections` exists as a table name (vs a different name) or that it has a `round_id` column. If wrong, the drill will fail at the exact moment it’s meant to be a fast operational gate.
   - Suggested fix: Validate against the actual production schema/migrations and update the command accordingly. If the corrections table is named differently or keyed differently (e.g., `roundId`/`round_id`, `hole_score_id`, etc.), provide the correct query. Consider adding a short fallback query to list tables/columns (e.g., `.tables` / `PRAGMA table_info(score_corrections);`) so the operator can self-diagnose quickly.

3. [low] Drill doc embeds specific VPS username and IP address
   - File: apps/tournament-web/src/scripts/drill-offline-scorer.md:102-107
   - Confidence: high
   - Why it matters: Even without passwords, hardcoding a production IP/username in a repo document increases the blast radius if the repo is ever shared beyond the intended audience. It also makes infrastructure changes (new host/IP/container name) require code changes and redeploys rather than updating an ops/runbook.
   - Suggested fix: Replace with a neutral reference (e.g., “Production VPS (see internal ops runbook)” or an environment variable/1Password item name). If you need the exact command in-repo, omit the username/IP and keep just `docker exec ...` assuming the operator is already on the box.

4. [low] 409 test ‘round-total’ audit assertion is not actually round-scoped and may be brittle if this test later adds more commits
   - File: apps/tournament-api/src/routes/scores.integration.test.ts:386-409
   - Confidence: high
   - Why it matters: The comment claims a round-total check, but the query counts *all* `score.committed` rows in the database. It’s deterministic today because `beforeEach` truncates `auditLog` and this test only writes one score, but it can become an accidental tripwire if the test is extended (or if setup begins creating committed audit rows).
   - Suggested fix: To match the intent and improve future robustness, scope the total count to the round’s hole scores, mirroring the drill SQL pattern:
`WHERE event_type='score.committed' AND entity_id IN (SELECT id FROM hole_scores WHERE round_id=...)` (or the Drizzle equivalent using a subquery).

## Strengths

- 409 test additions correctly prove first-writer-wins identity by checking `clientEventId === 'evt-A'` in the persisted `hole_scores` row (not just gross strokes).
- Audit assertions are defense-in-depth: entity-scoped count plus a total `score.committed` count to catch audits emitted under any entityId on the 409 path.
- The drill markdown is largely self-contained and matches AC-4/5/6/7: clear preamble, explicit prod environment, iOS Safari-only constraint, two-path drain verification, and a structured drill-record block with pass/fail states and metrics.
- Allowlist boundary is respected by only adding `apps/tournament-web/src/scripts/drill-offline-scorer.md` and modifying the existing test file under `apps/tournament-api/`.

## Warnings

None.
