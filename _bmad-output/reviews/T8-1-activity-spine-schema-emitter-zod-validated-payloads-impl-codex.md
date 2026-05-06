# Codex Review

- Generated: 2026-05-06T01:52:15.844Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/db/schema/activity.ts, apps/tournament-api/src/db/schema/index.ts, apps/tournament-api/src/db/migrations/0010_activity_spine.sql, apps/tournament-api/src/db/migrations/meta/_journal.json, apps/tournament-api/src/engine/types/activity-events.ts, apps/tournament-api/src/lib/activity.ts, apps/tournament-api/src/lib/activity.test.ts, apps/tournament-api/src/lib/activity.eslint-rule.test.ts, apps/tournament-api/eslint.config.js, apps/tournament-api/src/routes/scores.ts, apps/tournament-api/src/routes/presses.ts, apps/tournament-api/src/routes/round-lifecycle.ts

## Summary

Round-2 fixes address the original toPar underflow and add the missing tenant/event constraints in the par lookup; those are now correct per the evidence shown. Remaining concrete risks are (a) the activity write-gate is still bypassable via a few realistic AST shapes (notably computed access on the `activity` member and computed method names via identifier), and (b) the updated ESLint RuleTester unit tests no longer mirror the production selector set, so selector drift/bypass can slip through. The FK-on test change sets PRAGMA on the migration connection, but the suite still doesn’t *prove* FK enforcement on the transaction connection or validate the FK chain with a negative assertion.

Overall risk: medium

## Findings

1. [medium] `score.committed` schema allows internally inconsistent scoring fields (toPar/isBirdieOrBetter not validated against grossStrokes/par)
   - File: apps/tournament-api/src/engine/types/activity-events.ts:192-210
   - Confidence: high
   - Why it matters: You widened `toPar` to `min(-4).max(17)` (good), but the schema still treats `grossStrokes`, `par`, `toPar`, and `isBirdieOrBetter` as independent. Any caller can emit an event that passes Zod but persists contradictory values (e.g., `grossStrokes: 4`, `par: 5`, `toPar: 0`, `isBirdieOrBetter: true`). That becomes durable feed data and can break UI/award logic that assumes these fields are consistent.
   - Suggested fix: Add `.refine()` validations to `scoreCommittedSchema` enforcing `d.toPar === d.grossStrokes - d.par` and `d.isBirdieOrBetter === (d.toPar < 0)`. If you want `isBirdieOrBetter` to be derived-only, consider dropping it from the payload and computing it at read time.

2. [medium] ESLint activity write-gate still bypassable via computed access on `activity` member and computed method calls via identifier
   - File: apps/tournament-api/eslint.config.js:43-73
   - Confidence: high
   - Why it matters: The new selectors cover more shapes, but there are still realistic bypasses:
- Namespace import + computed member: `tx.insert(schema['activity'])...` is not caught because selectors #2/#4 require `computed=false` on the `MemberExpression` whose property is `activity`.
- Computed method where property is an Identifier: `tx[method](activity)` with `const method = 'insert'` is not caught because selector #5 only matches `callee.property.value` (Literal), not `callee.property.name` (Identifier).
- Computed method + namespace activity: `tx['insert'](schema.activity)` is not caught because selector #5 only matches `> Identifier[name='activity']`, not `> MemberExpression[...activity...]`.
Because `no-restricted-imports` does not prevent `import * as schema from '../db/schema/index.js'`, these computed-member variants are plausible in real code and would allow direct writes to slip past the gate.
   - Suggested fix: Extend `no-restricted-syntax` with additional selectors for:
- `> MemberExpression[computed=true][property.value='activity']` under both member-call and destructured-call.
- Computed callee with Identifier property: `CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.name=/^(insert|update|delete)$/] ...`.
- Computed callee + MemberExpression arg (`schema.activity`).
Also consider adding a restricted-imports pattern to disallow namespace imports from `*db/schema*` outside the allowlist if that’s acceptable.

3. [medium] RuleTester unit tests no longer mirror production selectors (new namespace/computed selectors untested)
   - File: apps/tournament-api/src/lib/activity.eslint-rule.test.ts:30-50
   - Confidence: high
   - Why it matters: The file comment says it “Mirror[s] the production selectors”, but `insertSelectorRule` only implements two selectors (member-call + Identifier arg and destructured-call + Identifier arg). It does not test the newly-added selectors in `eslint.config.js` for namespace-member arguments or computed-property calls. This means regressions or non-matching selectors can ship while the unit tests still pass, and the end-to-end `lintText` test only covers one call shape (`tx.insert(activity)`).
   - Suggested fix: Update `insertSelectorRule` to include all five production selectors, and add invalid cases for at least:
- `tx.insert(schema.activity).values({})`
- `const insert = tx.insert; insert(schema.activity).values({})`
- `tx['insert'](activity).values({})`
- `tx.insert(schema['activity']).values({})` (this should fail once you add the missing selector)
Additionally, add an end-to-end `lintText` case that uses a namespace import and a computed-property call shape so the flat-config is exercised for the new selectors too.

4. [medium] FK enforcement in activity emitter tests is not actually verified; PRAGMA may not apply to transaction connection and there’s no negative FK assertion
   - File: apps/tournament-api/src/lib/activity.test.ts:30-132
   - Confidence: medium
   - Why it matters: You enable `PRAGMA foreign_keys = ON` on the mocked client (line ~36-42), but the suite does not demonstrate that the setting is enabled for the connection used by `db.transaction(...)` (SQLite PRAGMAs are per-connection). Also, the test data only inserts valid FK references, so the suite would pass even if FKs were accidentally off. This leaves the stated goal (“test now exercises the schema with FKs enforced”) unproven by the evidence in the diff.
   - Suggested fix: Add at least one negative test that *must* fail when FKs are on, e.g. attempt `emitActivity` with a nonexistent `eventId` (or insert directly into `activity` in a tx) and assert it throws a FK constraint error. If drizzle uses multiple connections for transactions, explicitly execute `PRAGMA foreign_keys=ON` within the transaction connection (e.g. `await tx.run(sql
a``PRAGMA foreign_keys = ON`
)` depending on your driver capabilities) or ensure the driver reuses the same connection.

5. [low] `no-restricted-imports` direct-path block does not cover `.ts`/`.mjs` variants; potential bypass in TS sources
   - File: apps/tournament-api/eslint.config.js:34-40
   - Confidence: medium
   - Why it matters: The pattern blocks `**/db/schema/activity` and `**/db/schema/activity.js`, but not `**/db/schema/activity.ts` (or `.mjs`). In this repo most imports appear to use `.js` (TS compiled to ESM), so this may be low-likelihood, but it’s a concrete gap if any code can import the TS file directly.
   - Suggested fix: Include `**/db/schema/activity.ts` (and any other used extensions) in the restricted-imports patterns, or widen to `**/db/schema/activity.*` if that won’t overmatch.

## Strengths

- `toPar` range is now mathematically correct for the declared `grossStrokes` (1..20) and `par` (3..5): min -4 (1-5) and max 17 (20-3) (apps/tournament-api/src/engine/types/activity-events.ts:200-206).
- Par lookup in `scores.ts` now adds tenant + event constraints on `eventRounds`, reducing cross-event/tenant corruption risk (apps/tournament-api/src/routes/scores.ts:462-477).
- Emitter persists the parsed schema output (not the raw input) and uses `.strict()` schemas, which is a solid posture against payload drift (apps/tournament-api/src/lib/activity.ts:46-65).
- Integration tests now cover all 13 activity types and verify that invalid payloads do not insert rows (apps/tournament-api/src/lib/activity.test.ts:262-303).

## Warnings

None.
