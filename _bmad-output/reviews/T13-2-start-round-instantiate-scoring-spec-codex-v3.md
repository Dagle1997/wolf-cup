# Codex Review

- Generated: 2026-05-22T21:47:15.407Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md

## Summary

The prior High (partial UNIQUE on rounds.event_round_id failing on existing duplicate non-null data) is **mitigated for prod** by the documented fact that prod has 0 rounds and by documenting a required pre-check. However, as written, the “pre-check then STOP” is a **process requirement**, not an **enforceable/automated guard**, so the same class of failure can still occur in non-prod or any future environment where duplicates exist and migrations run automatically.

No other clearly-supported High issues are present in this spec file, but there are a couple remaining risks worth tightening (mainly around ensuring the UNIQUE-violation recovery path is actually exercised and around a spec inconsistency about whether a migration exists).

Overall risk: medium

## Findings

1. [high] Migration safety still relies on a manual/process pre-check; not enforceable by the migration itself
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:41-44
   - Confidence: high
   - Why it matters: The core failure mode is real: creating a UNIQUE (even partial) index will fail if duplicate non-null event_round_id rows already exist. The spec’s mitigation (prod has 0 rounds; dev MUST pre-check and STOP) reduces risk, but the STOP requirement is not technically enforced. In many deploy setups, migrations are applied automatically; the first time this runs in an environment with duplicates, it can still fail mid-deploy (the exact original High), causing downtime/rollback work.
   - Suggested fix: Make the duplicate pre-check an enforceable gate, not just a note. Options: (1) add a dedicated “preflight” step in the deploy pipeline that runs the duplicate query and fails the deployment before migrations; (2) if your migration framework supports programmatic migrations, implement the check and throw with a clear message before attempting CREATE UNIQUE INDEX; (3) at minimum, add an explicit runbook/deploy checklist item that is required in CI/CD (not just in prose). Also consider adding a one-time cleanup migration strategy if duplicates are ever found (e.g., manual remediation steps documented).

2. [medium] Spec inconsistency: claims “no schema migration” but later requires adding a migration + unique index
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:36-44
   - Confidence: high
   - Why it matters: Line 37 says “no schema migration”, but the design explicitly adds a partial UNIQUE index via a new migration (lines 41–43) and the file list includes a new migration (lines 132–133). This can cause confusion/incorrect scoping during implementation and review (e.g., someone assuming DB changes are forbidden).
   - Suggested fix: Update Risk Acceptance §1 to acknowledge that a schema migration *is* included (index-only hardening), or reword to “no new tables/columns; index-only migration allowed.” Ensure the story constraints match the actual tasks/file list.

3. [medium] UNIQUE-violation recovery path is required but may not be meaningfully covered by the stated idempotency test
   - File: _bmad-output/implementation-artifacts/tournament/T13-2-start-round-instantiate-scoring.md:41-89
   - Confidence: medium
   - Why it matters: The spec correctly calls out the libsql “aborted transaction handle” gotcha (line 43). But AC-4’s proposed test (“assert exactly one rounds row after a duplicate start”, line 88) may pass without ever exercising the UNIQUE-violation catch/re-SELECT path (e.g., if requests serialize). If that recovery path is wrong, real concurrent starts could still 500 even though the idempotency test passes.
   - Suggested fix: Add (or refine) a test that forces the constraint-violation path and asserts both callers get a successful response with the same roundId (one 201, one 200—or both 200 depending on design), and that the second request specifically went through the recovery logic. Practical approaches: fire two requests truly concurrently (Promise.all) while using separate DB connections, or introduce a controllable delay between “existence check” and “insert” in test-only mode to widen the race window.

## Strengths

- Atomicity is explicitly required: rounds + round_states + scorer_assignments created all-or-nothing in one transaction (lines 39–41, 63–67).
- Correctly identifies the UNIQUE index as the real concurrency guard, not just an existence check (lines 41–42, 84–89).
- Validation matrix is detailed and test-backed, with clean 4xx codes and strict body-shape requirements (lines 45–83).
- Round-state initial value risk is explicitly called out and bound to a behavioral acceptance test (AC-2) rather than a fragile literal (lines 52–54, 69–73).
- 409 round_state_corrupt includes remediation guidance rather than a dead-end error (line 42).

## Warnings

None.
