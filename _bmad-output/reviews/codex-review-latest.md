# Codex Review

- Generated: 2026-06-01T20:15:26.153Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/api/src/lib/pairing-capture.ts, apps/api/src/routes/admin/pairing.ts, apps/api/src/routes/admin/rounds.ts, apps/api/src/db/schema.ts, apps/api/src/db/migrations/0029_generated_pairing.sql, apps/web/src/routes/admin/pairing-audit.tsx, apps/web/src/routes/admin/rounds.tsx, apps/web/src/routes/admin/index.tsx, apps/api/src/lib/pairing-capture.test.ts, apps/api/src/routes/admin/pairing.test.ts, apps/api/src/routes/admin/pairing.auth.test.ts, apps/api/src/scripts/_audit_pairing_balance.ts

## Summary

The feature mostly matches the clarified design: capture happens only in the from-attendance transaction via the tx handle, and the audit UI is isolated at /admin/pairing-audit. However, the “set-once + never 500 on corrupt snapshot” goals aren’t fully met: capture is not atomic (race can overwrite), and the pairing-diff endpoint can still throw/500 on parseable-but-invalid JSON. There’s also an unguarded assumption that (roundId, groupNumber) is unique; if it’s not, serialization/diff will silently merge groups and misreport changes.

Overall risk: medium

## Findings

1. [high] captureGeneratedPairingIfAbsent is not atomic set-once (select-then-update race can overwrite baseline)
   - File: apps/api/src/lib/pairing-capture.ts:84-103
   - Confidence: high
   - Why it matters: The function is intended to be “set-once” and idempotent, but it performs a read (`select ... generatedPairing`) followed by a separate unconditional `update` when null. Two concurrent callers can both observe NULL and then both write—meaning the second write can overwrite the original baseline snapshot. If group membership changes between the two snapshots (or one call is mistakenly made after manual edits), the audit trail becomes incorrect and non-reproducible.
   - Suggested fix: Make the write conditional at the DB level: `UPDATE rounds SET generated_pairing=? WHERE id=? AND generated_pairing IS NULL` and check affected rows (or use `.returning()` to detect success). Consider removing the default `dbx=db` to force passing `tx` in transactional contexts, or at least provide a separate `capture...InTx` wrapper to reduce accidental misuse.

2. [high] pairing-diff treats only JSON.parse failures as “untracked”; parseable but wrong-shaped JSON can still crash and 500
   - File: apps/api/src/routes/admin/pairing.ts:225-275
   - Confidence: high
   - Why it matters: The endpoint’s comment promises “corrupt/unparseable treated as not tracked (never throws)”, but the current guard only checks `Array.isArray(parsed)`. If the stored value is parseable JSON but not an array of `{groupNumber:number, playerIds:number[]}` (e.g. `[{}]`, `[{playerIds:null}]`, or `[{groupNumber:"1", playerIds:[...]}]`), the subsequent loops (`for (const id of g.playerIds)`) and `withNames()` will throw TypeError, and the outer try/catch returns a 500. That defeats the “audit page never errors for bad historical data” requirement and can take down the whole audit view for a round.
   - Suggested fix: Validate the parsed value structurally before using it (zod or manual checks). If any group fails validation, set `generated=null` (tracked:false) rather than proceeding. Add a test case where `round.generatedPairing` is `'[{}]'` (parseable) to ensure the endpoint returns tracked:false instead of 500.

3. [medium] serializeGroups implicitly assumes groupNumber is unique per round; duplicates would merge groups and corrupt snapshot/diff
   - File: apps/api/src/lib/pairing-capture.ts:43-74
   - Confidence: high
   - Why it matters: `serializeGroups` groups rows into a `Map<number, number[]>` keyed solely on `groups.groupNumber` (lines 61–69). If a round ever has two `groups` rows with the same `group_number`, members from both DB groups will be merged into a single serialized group. The audit diff then becomes incorrect (players appear together when they weren’t). This is not prevented by schema: `groups` has no unique constraint on `(round_id, group_number)` (apps/api/src/db/schema.ts lines ~188–204), and the create-group endpoint (not shown here) would need to enforce it explicitly.
   - Suggested fix: Enforce uniqueness in the DB with a unique index on `(round_id, group_number)` and/or validate in the group-creation endpoint. Alternatively, serialize by `groupId` (stable primary key) and include `groupNumber` only for display.

4. [low] Audit balance script can print NaN/Infinity if there are no co-attendance>=2 pairs
   - File: apps/api/src/scripts/_audit_pairing_balance.ts:146-214
   - Confidence: high
   - Why it matters: `repeatCapable.length` is used as the denominator for a percentage at line 213. On small datasets (e.g., 0–1 finalized rounds), `repeatCapable.length` can be 0, resulting in `NaN%`/`Infinity%` output. This doesn’t affect production, but it makes the script less robust for reuse on partial snapshots.
   - Suggested fix: Guard the denominator: if `repeatCapable.length===0`, print “n/a” (or 0.0%) and skip the percentage computation.

5. [medium] Tests don’t cover malformed-but-parseable snapshot and don’t exercise atomic set-once behavior under concurrency
   - File: apps/api/src/routes/admin/pairing.test.ts:108-217
   - Confidence: high
   - Why it matters: Current integration tests cover: capture happened, idempotent sequential call, and moved player diff. They do not cover (a) parseable malformed snapshot causing 500 (currently possible), nor (b) the non-atomic set-once race (select-then-update). These are the two biggest “actively try to break” areas called out in the review request.
   - Suggested fix: Add a pairing-diff test that manually sets `rounds.generatedPairing` to `'[{}]'` (or another wrong shape) and asserts 200 + tracked:false. For set-once, either refactor to an atomic update (preferred) and assert affected-row semantics, or add a stress test that triggers two captures in parallel (Promise.all) and asserts no overwrite when one snapshot differs.

## Strengths

- Capturing via `tx` inside from-attendance is the correct approach to see uncommitted `round_players` inserts (apps/api/src/routes/admin/rounds.ts around line 1329).
- Diff logic is pure and unit-tested with good invariants (apps/api/src/lib/pairing-capture.test.ts).
- pairing-diff endpoint has solid input validation for roundId and correctly guards the route with adminAuthMiddleware.
- UI confirm guard matches the clarified requirement (only blocks re-apply when the round already has players assigned).

## Warnings

- Truncated file content for review: apps/api/src/routes/admin/rounds.ts
- Truncated file content for review: apps/web/src/routes/admin/rounds.tsx
