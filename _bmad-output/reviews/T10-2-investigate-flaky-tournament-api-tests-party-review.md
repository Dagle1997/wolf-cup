# Party-Mode Review — T10-2 investigate flaky tournament-api tests

**Story:** `_bmad-output/implementation-artifacts/tournament/T10-2-investigate-flaky-tournament-api-tests.md`
**Mode:** Non-interactive written review (per tournament-director step 8)
**Date:** 2026-05-20
**Reviewed scope:** 2 test-only files + spec + sprint-status flip

---

## 📊 Mary (Analyst) — Does triage close the right problem?

The original problem was a developer-experience tax: every `pnpm --filter @tournament/api test` run risked a sub-1% chance of either flake firing, which forced a manual rerun and an "is this real?" judgment call. T10-2 attacks both flakes with the right level of effort. The ESLint test gets a real structural fix (one warm ESLint instance shared via `beforeAll`, kept under the option-form 15s timeout as belt-and-suspenders) — that's a true root-cause-class fix because cold-start latency was the most plausible single source. The handoff test gets `retry: 1` plus a documented hypothesis trail + an explicit followup-story key (`T10-3-handoff-flake-structural-diagnosis`) — that's honest triage, not pretend-fix. The risk acceptance for retry-1 is now mathematically correct (1 - p² formula with examples across the bug-rate spectrum), so future readers cannot be misled about how much signal retry is suppressing. **Verdict: right problem, right level of effort.**

## 🏗️ Winston (Architect) — Any architectural debt added?

Zero production code changed. The two patterns introduced — `beforeAll`-hoisted ESLint singleton + option-form Vitest test config — are both idiomatic and minimally coupled. The shared ESLint instance does load-bear on the file's default sequential execution; that's documented in code (lines 175-181 of `activity.eslint-rule.test.ts`) and in the spec's concurrency caveat. Codex correctly flagged this as a future-maintainer trap if anyone adds `test.concurrent` later — the spec acknowledges this and explicitly out-of-scopes the in-code enforcement (`describe.sequential()` would be the fix but would reduce future flexibility for zero current gain since Vitest's default IS sequential within a file). The `retry: 1` option is per-test, NOT global via `vitest.config.ts` — keeps blast radius minimal. The triage-comment-with-followup-key pattern is a healthy artifact: future maintainers see the hypotheses and a tracked path forward, not just a "fix me later" stub. **Verdict: no debt added.**

## 📋 John (PM) — Right scope or over/under?

Right scope, slightly small but appropriately so. Under-deliver risk would be: someone reads "triage" as "make the flake go away" and then is disappointed the handoff test still has unverified root cause — but the spec is explicit that retry-1 is triage, not a verified fix, and the structural-diagnosis followup is named. Over-deliver risk would be: a structural fix for the handoff race attempted in this story (per spec, that's hours of repro work and likely requires a test-isolation rewrite; punted correctly). What's NOT in this story (vitest.config.ts global retry, structural test-isolation rewrites, production-code changes) is correctly excluded — those each have separate blast radii and should land separately. The story-as-scoped clears the dev-experience tax today, opens T10-3 with a primed context (hypotheses + followup-key cited), and keeps the door open for proper diagnosis if the handoff signal continues to misbehave. **Verdict: scoped correctly.**

## 🧪 Quinn (QA) — Is the verification strategy honest given retry-1's masking risks?

Honest. The spec's AC-5 explicitly mandates that the Completion Notes acknowledge flake verification is probabilistic, and the dev agent did so. The 3× isolated ESLint test runs (~1.16s each) are a meaningful signal for the ESLint test — that test's whole failure mode was cold-start latency, and 3× back-to-back exercises the cold path repeatedly. For the handoff test, the verification is necessarily weaker: it passed on first iteration of the full-suite run, and retry wasn't exercised this invocation. **This is fine** — the test only flaked once across multiple T10-1-cycle runs and that's the dataset, you can't manufacture more signal short of running the suite hundreds of times. The honest characterization: "N future CI runs without manual reruns is the real success signal" is correct and is the right metric to track. The math-honesty fix on the retry comment is important — pre-fix, a future reader might have looked at `retry: 1` and concluded "this only masks bugs with >50% failure rate"; post-fix, they'll correctly understand that low-rate intermittent bugs (10-30% failure rate, the most insidious kind) are masked WORSE not better. **Verdict: verification is honest about its limits; no gap to close.**

## 💻 Amelia (Dev) — Code-level concerns?

`activity.eslint-rule.test.ts:175-188`: `beforeAll` correctly hoists construction; the `let eslint!: ESLint;` non-null-assertion pattern is the standard Vitest idiom for late-bound test fixtures (TypeScript can't statically prove `beforeAll` runs before tests, but Vitest's contract guarantees it). The shared instance is read-only across tests (`lintText()` doesn't mutate ESLint state per docs). Pattern is idiomatic.

`activity.eslint-rule.test.ts:193,207`: option-form `test('...', { timeout: 15000 }, async () => {...})` matches Vitest 3.2.4's `TestOptions` interface exactly.

`round-lifecycle.integration.test.ts:497-528`: triage comment is unusually long (~30 lines) but every line earns its place — the three hypotheses, the masking-math examples, and the followup-key are all citation-worthy for a future structural-fix author. The `{ retry: 1 }` option is the only behavioral change to the test itself; the underlying test logic is unchanged.

`round-lifecycle.integration.test.ts:511`: corrected line reference now reads "set in buildApp() ~line 208, reassigned mid-test below" — accurate (verified: `__testPlayer = ...` occurs at line 208 inside `buildApp` and line 535 inside the test body).

**One small nit (not blocking):** the triage comment could note that `__testPlayer` is currently never restored after a test mutates it — that's the structural concern that T10-3 should triage as part of its scope (a single test's `__testPlayer = X` reassign leaks to subsequent tests in the file until `buildApp()` is called again). Worth noting but not blocking; T10-3's scope will surface this naturally during root-cause investigation. **Verdict: code is idiomatic, citation-friendly, ready to ship.**

---

## Open Questions for User

**None.** All three open questions raised at T10-1's party-mode review surfaced LOW-priority items; T10-2 has zero. The triage discipline is clear, the math is honest, the followup-story key is named, and the test code is idiomatic. If any concern exists, it's the "should we name the T10-3 followup more eagerly than just-in-comment?" question, which is itself answerable by Josh's normal sprint-status discipline (he can add T10-3 backlog now or later — neither blocks T10-2).

---

## Summary verdict

**GO** — code-complete, full suite passes 965 ✓ + 2 skipped (no regression), ESLint test 3× isolated runs all green, typecheck + lint clean.

**Main risks:**
1. retry: 1 on the handoff test could mask a low-rate (10-30%) real intermittent bug — accepted-and-documented tradeoff per the in-code math.
2. If a future refactor adds `test.concurrent` to `activity.eslint-rule.test.ts`, the shared ESLint instance must be re-evaluated (documented as code comment + spec caveat).
3. `__testPlayer` global never resets between tests in `round-lifecycle.integration.test.ts` — likely contributes to the handoff flake; T10-3's scope will surface this. Not addressed here by design.
4. T10-3 followup story key is referenced in the comment but is not yet a backlog row in sprint-status.yaml. Low risk (key serves as TODO marker); Josh can add the backlog row whenever appropriate.
5. No production code touched. If presses, scoring, or any user-facing path regress in production, this story's changes are not implicated.
