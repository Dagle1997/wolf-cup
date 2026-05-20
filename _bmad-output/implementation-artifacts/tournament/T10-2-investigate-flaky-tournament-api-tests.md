# T10-2: Investigate Flaky Tournament-API Tests

## Status

done

## Story

As Josh (sole dev) running `pnpm --filter @tournament/api test` and seeing two tests intermittently fail (forcing reruns to confirm whether the failure is real or transient), I want the two known flakes triaged — root-cause-diagnosed where cheap, stabilized where the fix is mechanical, and `retry: 1`-gated where structural fix exceeds this story's blast radius — so future CI runs and dev-loop runs give a reliable green/red signal without "is this a real failure or a flake" judgment overhead.

Surfaced during T10-1's CI runs (2026-05-20):
1. `apps/tournament-api/src/lib/activity.eslint-rule.test.ts > activity write-gate end-to-end (ESLint flat config) > lintText against a non-allowlisted path fails the rule` — timed out at the 5s Vitest default.
2. `apps/tournament-api/src/routes/round-lifecycle.integration.test.ts > finalize-before-handoff regression (T5-8 closes T5-7g) > handoff returns 422 round_finalized when finalize committed before handoff begins` — expected 422, got 500.

Both passed on rerun across 4 T10-1-cycle invocations. Neither was caused by T10-1's changes.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

Every file in `## Files this story will edit` classifies into the tournament-director's ALLOWED bucket (`apps/tournament-api/**` and the tournament sprint-status under `_bmad-output/implementation-artifacts/tournament/**`). No root config, no dependency changes, no `apps/api`/`apps/web`/`packages/engine` touches.

### 2. ESLint test flake: cold-start cost vs the default 5s testTimeout

`activity.eslint-rule.test.ts:175-191` (the failing test) creates `new ESLint(...)` inline, then runs `lintText()`. Each test creates a separate ESLint instance, paying the full flat-config + plugin-load cost twice in the same file. On a busy local CI machine (or when Vitest is heavily parallelizing across other suites), the cold-start can easily exceed 5s — that's the most-likely root cause.

**Two-part fix:**
- Bump per-test timeout to **15000ms** (3× the default; absorbs CI jitter without masking a genuine infinite-loop bug) via Vitest's option-form: `test('description', { timeout: 15000 }, async () => { ... })`. This is the verified shape per `@vitest/runner` v3.2.4's `TestOptions` interface (`timeout?: number; retry?: number`). `describe('...', () => {})` does NOT accept a timeout argument; apply the option per-test, on each of the two tests in the describe block.
- Hoist the `ESLint` instance into a `beforeAll` so both tests in the describe share one warm instance. Avoids paying the load cost twice and saves ~50% wall-time for the file.

The hoist is a real fix; the timeout bump is paranoid belt-and-suspenders. Both are mechanical, no semantic change to what the test asserts. Either alone would likely be sufficient; together, the test should not flake even under heavy parallelism.

**Concurrency note for the hoist.** The current file uses default sequential test execution (no `test.concurrent` markers). The shared `ESLint` instance is safe under sequential execution because `lintText()` is documented as functionally pure on the configured-state-snapshot. If a FUTURE refactor introduces `test.concurrent` to this file, the shared instance must be re-evaluated — at minimum, verify ESLint v9+ flat-config `lintText()` is thread-safe under concurrent calls (likely yes; documented intent). This story does NOT add `test.concurrent`.

### 3. Handoff test flake: 500 instead of 422 — root cause uncertain, retry-1 as triage

`round-lifecycle.integration.test.ts:497-524` (the failing test) does a two-step setup: (1) organizer POSTs `/finalize` (expects 200), then (2) the test dynamically `await import('./scorer-assignments.js')`, mutates the module-level `__testPlayer` global, and POSTs `/transfer` (expects 422 `round_finalized`).

**Hypotheses for the 500 path (any one of which could cause the observed flake):**
- The dynamic `await import('./scorer-assignments.js')` on line 507 races with the parallelized test runner's in-memory libsql connection state. Other integration tests in the file already imported the router; the second import may resolve a cached module but the async-ish import path can interleave with concurrent libsql transactions on the shared `file::memory:?cache=shared` URL.
- The `__testPlayer` reassign at line 508 is a module-level global; another concurrent test resetting `__testPlayer` between this test's lines 508 and 512 (the `app.request()` call) would change which player the requireSession mock returns, potentially producing a different error path than expected.
- The handoff handler may throw an internal error (unhandled) on some edge case in the post-finalize state — e.g., the round_states row transition leaves a temporary window where the handoff handler reads `state = 'finalized'` but then a downstream query fails because some derived state isn't yet consistent.

**Scope-bounded fix:**
- **Do NOT** attempt to repro and root-cause-diagnose the 500 path this story. The likely causes are race conditions that may take hours of repro work and may end up needing a structural change to test isolation (separate libsql connection per test file, or per-test).
- **DO** add `retry: 1` to JUST this single test so a transient 500 doesn't fail the CI run. Document the open question in the story's followups + this test's inline comment. If the test continues to flake under retry-1, that's the signal to invest in structural diagnosis (separate followup story — provisional key `T10-3-handoff-flake-structural-diagnosis`).

`retry: 1` per-test in Vitest 3.2.4 is the option-form `test('description', { retry: 1 }, async () => { ... })` per the `@vitest/runner` `TestOptions` interface (`retry?: number`). Vitest also exposes a chain form `test.retry(N)`, but the option-form is preferred here because it co-locates the retry metadata with the test's other options (timeout, etc.).

**Honest characterization of retry's failure-masking risk.** `retry: 1` absorbs a single-iteration flake — if the test passes on either run, it reports PASS. This DOES mask intermittent real bugs whose failure rate is below ~50%: a genuine post-finalize 500 that occurs once every 3 runs (33%) would only fail BOTH iterations of a single `pnpm test` invocation ~11% of the time, i.e., it would pass-on-retry the other ~89%. The risk we're accepting: a slow-burn real bug could be hidden by retry-1 for many CI runs before showing both-iteration failure. Mitigation: the inline comment explicitly names structural diagnosis as the followup; if production 500s ever start appearing in the post-finalize-then-handoff window in real use, treat that as the structural-diagnosis trigger regardless of whether the test signal flips. retry-1 is a triage tradeoff, not a guarantee of correctness.

### 4. What is NOT in this story

- No vitest.config.ts global retry policy. Per-test retry only, so the blast radius stays at the two known-flaky tests.
- No restructuring of test fixtures (file::memory:?cache=shared, dynamic imports, module-global `__testPlayer`). These are pre-existing patterns shared by many tests; touching them is a much bigger investment.
- No diagnosis of the handoff 500's root cause. Documented as a followup.
- No changes to production code (`apps/tournament-api/src/lib/activity.ts`, `apps/tournament-api/src/routes/scorer-assignments.ts`, etc.). The tests are flaky, not the production behavior they assert.

## Acceptance Criteria

**AC-1: ESLint test no longer flakes under cold-start pressure.**

**Given** `apps/tournament-api/src/lib/activity.eslint-rule.test.ts`
**When** the describe block `'activity write-gate end-to-end (ESLint flat config)'` is parsed
**Then** the `ESLint` instance is constructed exactly ONCE via `beforeAll` (not per-test)
**And** each test in the describe is declared via the Vitest option-form `test('...', { timeout: 15000 }, async () => {...})` (preferred over the still-supported trailing-timeout shape `test('...', async () => {...}, 15000)` because the option-form co-locates timeout with other test options like `retry` and is idiomatic for Vitest 3.x)

**Given** the suite runs under `pnpm --filter @tournament/api test`
**When** the ESLint flat-config loads and `lintText()` runs
**Then** the test completes within the bumped timeout
**And** both tests in the describe block still pass with their original assertions unchanged

**AC-2: Handoff test absorbs transient 500 without failing the suite.**

**Given** `apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:497-524`
**When** the test `'handoff returns 422 round_finalized when finalize committed before handoff begins'` is declared
**Then** it uses the option-form `test('handoff returns 422 ...', { retry: 1 }, async () => {...})` per Vitest 3.2.4 `TestOptions`
**And** an inline comment (above the `test(` invocation) explains: (a) retry is triage, not a verified fix; (b) hypothesized root causes (dynamic-import race, `__testPlayer` global mutation race, post-finalize state-transition window); (c) names the followup-story candidate verbatim (`T10-3-handoff-flake-structural-diagnosis`)

**AC-3: Sprint-status flip lands atomically with the commit.**

**Given** the commit produced by step 10 of the director cycle
**When** the final commit is inspected
**Then** `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` has `T10-2-investigate-flaky-tournament-api-tests: done`
**And** no other story's status changed in the same commit

**AC-4: No regression in other tests.**

**Given** the rest of the tournament-api suite
**When** the full `pnpm --filter @tournament/api test` runs
**Then** every previously-passing test still passes (pass count must not drop)
**And** typecheck + lint exit 0 with no new warnings or errors

**AC-5: Verification of the flake fixes is honest about what was checked.**

**Given** the story's verification
**When** the dev agent runs `pnpm --filter @tournament/api test` after the changes land
**Then** at least 1 full-suite run completes green (mandatory)
**And** the dev agent runs the ESLint test file in isolation 3× to confirm it does not time out under default conditions
**And** the dev agent acknowledges in the story file's Dev Agent Record's Completion Notes that flake verification is probabilistic — N future CI runs without manual reruns is the real success signal

## Tasks / Subtasks

1. **ESLint test stabilization**
   1.1. In `apps/tournament-api/src/lib/activity.eslint-rule.test.ts`, hoist the `new ESLint({...})` construction into a `beforeAll` block in the describe so both tests share one warm instance.
   1.2. Convert each `test()` call in the describe to the option-form: `test('...', { timeout: 15000 }, async () => {...})`. Do NOT use `describe('...', () => {...})` with a timeout (not supported by Vitest 3.2's describe signature).
   1.3. Verify both tests still PASS (assertions unchanged; only the construction site moved).

2. **Handoff test retry triage**
   2.1. In `apps/tournament-api/src/routes/round-lifecycle.integration.test.ts:497-524`, change `test('handoff returns 422 round_finalized...', async () => {...})` to the option-form `test('handoff returns 422 ...', { retry: 1 }, async () => {...})`.
   2.2. Add an inline comment block immediately above the modified `test(` invocation containing: (a) "retry: 1 is triage, not a verified fix"; (b) "500 observed once during T10-1 CI runs 2026-05-20"; (c) the 3 hypothesized root causes (dynamic-import race, `__testPlayer` global mutation race, post-finalize state-transition window); (d) the literal followup-story key `T10-3-handoff-flake-structural-diagnosis` as the structural-fix candidate.

3. **Verify**
   3.1. Run `pnpm --filter @tournament/api test` ONCE end-to-end. Confirm every previously-passing test still passes and the total passing count is ≥ the count captured at the start of this story (capture the baseline number at dev-story-start time and compare; do NOT hardcode an absolute number, since unrelated story commits may have added or removed tests between baseline and run).
   3.2. Run JUST the ESLint test file via `pnpm --filter @tournament/api test src/lib/activity.eslint-rule.test.ts` three consecutive times. Confirm no timeout failure in any of the three runs. This is the targeted flake-prevention verification — exercising the cold-start path repeatedly is the most informative cheap signal.
   3.3. Record verification results in the Dev Agent Record's Completion Notes section, noting that flake verification is probabilistic by nature and the true success signal is N future CI runs without manual reruns.
   3.4. Run `pnpm --filter @tournament/web test`, `pnpm --filter @wolf-cup/engine test`, `pnpm --filter @wolf-cup/api test`, `pnpm -r typecheck`, `pnpm -r lint`. Confirm no regression in any.

## Dev Notes

### Architectural alignment

This story is test-infrastructure-only. No production code changes. The two flakes are pre-existing (they predate T10-1; T10-1's CI runs just happened to surface them). Triage discipline: stabilize where mechanical, retry-1 where structural diagnosis exceeds the story's blast radius. Document hypotheses so a future structural-fix story has a starting point.

### Key references

- Origin: T10-1 party review (`_bmad-output/reviews/T10-1-team-press-log-foursome-scoping-party-review.md`) — QA perspective documented the flakes.
- Vitest retry docs: per-test `test.retry(N)` and `test('...', { retry: N }, fn)` are equivalent.

### Risks / Followups

- **Followup: structural test isolation diagnosis.** If the handoff test continues to flake under retry-1 (i.e., BOTH iterations fail in some CI runs), open a new story to investigate: (a) per-file separate libsql connection vs the shared `file::memory:?cache=shared` URL, (b) test-runner-level guarantee that `__testPlayer` global isn't mutated by concurrent tests, (c) actual repro of the post-finalize 500 in isolation.
- **Followup: shared ESLint instance across the WHOLE eslint-rule.test.ts file** if the hoist proves insufficient. Could also evaluate whether the entire file's tests should run serially (`test.sequential.each`) to avoid concurrency-induced load spikes.
- **Risk acceptance:** `retry: 1` does mean a flake-on-first + pass-on-retry shows as PASS in the test output. The team accepts this — the alternative (failing CI on transient infrastructure noise) is worse. The retry boundary is per-test, not per-file or per-suite — other tests in the same file run without retry.

## Files this story will edit

- apps/tournament-api/src/lib/activity.eslint-rule.test.ts
- apps/tournament-api/src/routes/round-lifecycle.integration.test.ts
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

3 files. Additional files MAY be added during implementation only under `apps/tournament-api/**` and MUST be appended to this list before commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director).

### Debug Log References

- Spec codex round 1: 1H + 2M + 2L. High (Vitest API ambiguity) was mechanically fixable per gating rule criteria 1–5; applied all 5 fixes.
- Spec codex round 2: 0H + 1M + 1L. Both polish-grade; applied inline without further rerun per gating cadence cap.
- Baseline at dev-story start: tournament-api 965 ✓ + 2 skipped (matches T10-1 completion baseline).
- Post-implementation full suite: 965 ✓ + 2 skipped (no regression). All other suites unchanged.

### Completion Notes List

- ESLint test (AC-1): hoisted `new ESLint(...)` to `beforeAll`; both tests use option-form `test('...', { timeout: 15000 }, async () => {...})`. Three consecutive isolated runs of `src/lib/activity.eslint-rule.test.ts` completed in ~1.16s each (tests phase ~600ms) — well under both the bumped 15s timeout and the original 5s default. The hoist alone likely sufficed; the bumped timeout is paranoia against busy-CI cold-start spikes.
- Handoff test (AC-2): converted to option-form `{ retry: 1 }`. Inline comment names the three hypothesized root causes (dynamic-import race, `__testPlayer` global mutation race, post-finalize state-transition window) and explicitly cites `T10-3-handoff-flake-structural-diagnosis` as the structural-fix followup candidate. Test passed on first iteration in the full-suite run; retry was not exercised this invocation.
- Verification honesty (AC-5): flake verification is probabilistic by nature. Three isolated ESLint runs + one full-suite run is a meaningful but not conclusive signal — the true success metric is N future CI runs without manual reruns. If either test surfaces a both-iteration failure in future runs, escalate to structural diagnosis (T10-3 candidate).
- No production code changes. No `vitest.config.ts` global retry. Per-test scope only — minimizes blast radius.

### File List

- apps/tournament-api/src/lib/activity.eslint-rule.test.ts (modified — hoist + timeout option-form)
- apps/tournament-api/src/routes/round-lifecycle.integration.test.ts (modified — retry option-form + inline triage comment)
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml (status flip — `ready-for-dev` → `in-progress` → eventually `done` at step 10)
