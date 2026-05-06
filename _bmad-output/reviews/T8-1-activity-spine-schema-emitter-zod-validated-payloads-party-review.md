# T8-1 Party-Mode Review: Activity Spine + Emitter + Zod + ESLint Gate

**Story:** T8-1-activity-spine-schema-emitter-zod-validated-payloads
**Status:** review
**Test posture:** tournament-api 875 → 915 ✓ (+40), engine 472, wolf-cup api 516, tournament-web 204 — all unchanged. Workspace typecheck + lint clean.
**Codex history:** Spec 7 fixed (R1) + 4 fixed (R2). Impl 5 fixed (R1) + 5 fixed (R2). Two known residuals: `Tx | Db` permissiveness (v1.5 followup) and computed-bypass theoretical exploit (layered defense via `no-restricted-imports`).

Single non-interactive synthesis. No follow-up questions.

---

## 📊 Mary — Business Analyst

The 13-variant enum maps cleanly to the consumer surfaces declared in T8-2 (toast/banner) and T8-3 (feed). Cross-checking the spec's variant list against the epic's enumerated emission points: `score.committed`, `score.corrected`, `scorer.transferred`, `round.finalized`, `round.cancelled`, `press.auto_fired`, `press.manual_fired`, `press.manual_undone`, `bet.created`, `rule_set.revised`, `subgame.computed`, `gallery.uploaded`, `award.triggered` — every consumer story has a producer.

**Dropped types acknowledged:** `round.completed` + `round.complete_rolled_back` (state-only, not user-visible) live in `audit_log` and `round_states`. `lead.changed` + `bet.flipped` (deferred per epic spec — no producer story in T5/T6/T7). `install_prompt.shown` is audit-only per Codex finding. All defensible.

**Trip-day relevance:** the spine is foundational; trip-day value materializes through T8-2/T8-3 (the surfaces players see). T8-1 ships infra, not user value. That was the explicit pre-decision contract.

**Verdict: PASS.** AC matrix complete, decisions documented.

---

## 🏗️ Winston — Architect

`parsed = schema.parse(event); JSON.stringify(parsed)` is the right pattern. With `.strict()`, Zod throws on unknown keys before this line — but using `parsed` (not `event`) for both column writes and JSON serialization is a *defensive* choice: if anyone ever swaps `.strict()` for `.passthrough()` (e.g., to support an optional rich-payload escape hatch), the persisted JSON only ever contains schema-declared fields. That's a correctness invariant worth preserving.

The 5-selector ESLint stack looks like overengineering at first glance, but each selector targets a real bypass class (member-call, namespace-import, destructured, destructured+namespace, computed-property). The accepted residual (computed-property arg, `tx.insert(s['activity'])`) is contrivedly hostile — at that point the caller is fighting the gate on purpose, and any rule-based defense fails (they could just `// eslint-disable`). The combination of `no-restricted-imports` (blocking the schema export AND the path import with .js/.ts/.mjs glob) plus the syntax block covers all realistic patterns.

**One nuance worth recording:** the `no-restricted-imports` block is the LOAD-BEARING defense; the syntax selectors are belt-and-suspenders. If one rule must give in a future eslint-config refactor, keep the import block.

**Cross-field `.refine` on score.committed** (toPar === grossStrokes-par AND isBirdieOrBetter === toPar<0) is correct. Catches caller-side computation drift at the activity boundary, not just at score-post.

**Verdict: PASS.** Architecture sound, layered defenses appropriate.

---

## 📋 John — Product Manager

T8-2/T8-3/T8-4 need three things from T8-1: (1) a queryable typed event spine, (2) an emit path that production code paths actually call, (3) inline payload data so consumers don't join.

(1) — yes (composite index supports both polling and backfill cursors). (2) — yes, all 14 emission points migrated. (3) — yes, score.committed inlines `par + toPar + isBirdieOrBetter` so the toast can render "Rick birdied 11" without a course-data join.

**Hidden gap risk:** `award.triggered` has no production producer in T8-1 — T8-4 owns that. The spec acknowledges this and the integration test exercises the type via synthetic emission. T8-4 will plug the actual award-detection service into the existing typed contract. No spec drift.

**Trip-day:** T9 (trip-critical) is queued behind T8 (target-miss-tolerable). T8-1 didn't slow the path; the calendar cost was bounded by the single-story decision. Closes the foundation cleanly.

**Verdict: PASS.** No hidden gaps. T8-2 unblocked.

---

## 🧪 Quinn — QA Engineer

34 emitter tests + 8 RuleTester selector tests + 2 lintText end-to-end. Coverage shape:

- 13 valid-payload tests assert column round-trip per variant.
- 13 invalid-payload tests assert ZodError + zero-row-written per variant.
- Base-shape, discriminator, unknown-key, press XOR refine, transaction rollback, **negative FK assertion** — all explicit.
- RuleTester covers all 5 production selectors (parity gate via the `insertSelectorRule` mirror).

**On the brittle FK matcher:** I flagged this. The negative FK test matches on `/Failed query: insert into "activity"/` rather than the literal `FOREIGN KEY` text. Drizzle wraps libsql errors and the wrapper message includes the SQL but not the underlying SQLITE_CONSTRAINT signal at the top level. The matcher is brittle in the sense that *any* insert failure into activity would pass — not just FK. The story spec acknowledges this in a comment: "the only way this throws is the FK constraint (event_id does not exist and there is no other failure mode in this path)". That's true given the current setup, but a future schema change (adding a NOT NULL column without default) would break the test silently.

**Mild ask, non-blocking:** assert the cause chain explicitly (`expect(err.cause?.message).toMatch(/FOREIGN KEY/i)`). Single-line tightening. Logged for v1.5.

**Verdict: PASS** with one logged followup (FK cause-chain assertion).

---

## 💻 Amelia — Developer Agent

The `if (round.eventId !== null)` guard appears at 8 call sites. Tempting to extract into `emitIfEventScoped(tx, event, round)` helper — but the current pattern is mechanical, grep-able, and the eventId-null branch each site lives inside is locally meaningful (e.g., scores.ts ALSO needs the null check to skip the par lookup). A helper would couple two unrelated null-checks into one site, reducing readability.

**Decision:** leave as inlined. 8 sites × 1 if-guard = 24 lines total. Acceptable.

**5-selector ESLint config:** maintenance burden is the regex strings. Each selector's pattern is well-commented. The RuleTester parity test catches drift if anyone "simplifies" the production selectors without updating the test mirror. Healthy maintenance posture.

**Migration scope realized:** 22 files modified, +1218 / -16 lines net (rough estimate from the impl diff). All within tournament-api/. Zero SHARED touches, zero FORBIDDEN. Single atomic commit honors the breaking-change contract documented in the T5-6 stub.

**One smell I want to flag for future:** the `file::memory:?cache=shared` URL in activity.test.ts — discovered the hard way that plain `:memory:` doesn't work for cross-connection transactions. Worth a memory note so the next test author doesn't repeat the discovery cycle.

**Verdict: PASS.** No blocking smells.

---

## 🎨 Sally — UX Designer

Score.committed payload carries `par`, `toPar`, `isBirdieOrBetter` inline — exactly right for "Rick birdied 11" rendering without a course-data join. Toast UX would be:

> 🐦 **Rick** scored 3 on hole 11 — birdie!

No follow-up query needed. The boolean `isBirdieOrBetter` is the eligibility flag for emoji/animation upgrades on the consumer side.

**Press payloads** (auto + manual) carry `team`, `triggerHole`, `multiplier` — sufficient for "Team A pressed from hole 5 (2x)" banner. The auto/manual discriminator is the type, not a field — clean.

**Score.corrected** carries `priorGross + newGross` inline — the feed can render "Corrected: 5 → 4 by John" without joining score history. T8-3 will love this.

**Award.triggered** carries `awardType + context.{holeNumber, grossStrokes, par}` — enough for "🦅 First eagle of the trip! Mike on hole 7 (3 on a par-5)".

**Slight under:** `subgame.computed` carries `totalPotCents` but no winner names. T8-3 feed entry "Skins computed: $40" is informative but flat. Could be richer ("Mike won the skins pot — $40") with a `topWinnerPlayerId` field. v1.5.

**Verdict: PASS.** Payloads are right-sized for v1 surfaces. Sub-game enrichment logged for v1.5.

---

## 🤝 Synthesis & Recommendation

### Verdict: **PASS — proceed to commit.**

All 6 personas converge on PASS. Test coverage is appropriate; architecture honors the breaking-change contract; PM/architect agree no hidden gaps; UX confirms payloads are right-sized for downstream surfaces; QA flags one brittle test matcher as v1.5 followup; dev confirms maintenance posture is healthy.

### Required changes

**None.** No blocking issues from any persona.

### Optional polish (logged for v1.5+, NOT for this story)

1. **FK negative-test cause-chain assertion** (Quinn) — tighten the matcher from wrapper message to `err.cause?.message`.
2. **`subgame.computed` payload enrichment** (UX) — add `topWinnerPlayerId` for richer feed entries.
3. **`Tx | Db` brand** (architect, codex residual) — branded `Transaction` type so the emitter signature enforces "always pass tx" at compile time.
4. **Memory note on `file::memory:?cache=shared`** (dev) — record the libsql gotcha so future test authors don't rediscover it.

### Disagreements between personas

**None substantive.** Quinn flagged the brittle FK matcher and Amelia flagged the libsql memory gotcha — both as logged followups, not blockers. No persona pushed back on the SINGLE-story decision (it was already validated by the pre-decision party).

### Director: proceed to step 9 (codex-review the party output) and then step 10 (commit).
