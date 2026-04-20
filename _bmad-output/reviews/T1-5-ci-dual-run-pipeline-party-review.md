# T1-5 Party-Mode Review — CI Dual-Run Pipeline

- **Generated:** 2026-04-20 (non-interactive, director-invoked)
- **Story:** `_bmad-output/implementation-artifacts/tournament/T1-5-ci-dual-run-pipeline.md`
- **Implementation:** `.github/workflows/ci.yml` (+6/-0) — inserts `Test (tournament-api)` + `Test (tournament-web)` between existing `Test (api)` and `Lint`. Zero runtime/application-code edits (only CI YAML + story artifacts + sprint-status tracking).
- **Prior codex passes:** spec ×3 rounds (1 Critical rejected as false-positive + 1H/4M/4L fixed), impl ×1 round (0 High, 0 Medium, 1 Low — story status header drift, resolved at commit time)
- **Verification:** tournament-api 19/19 ✅, tournament-web 1/1 ✅, Wolf Cup engine 468/468 ✅ (Δ0), api 429/429 ✅ (Δ0), `pnpm -r lint` green

---

## Summary

T1-5 is the smallest story of Epic T1 — a 6-line YAML insertion into an existing CI workflow. The change is surgical, additive, and scope-disciplined: no source touched, no secrets introduced, no parallel-jobs refactor. The notable caveat is that under the spec's deliberate **fails-fast design choice** (inherited from Wolf Cup's single-sequential-job shape), the new tournament test steps will not execute in CI while Wolf Cup's pre-existing `apps/web/src/routes/standings.tsx:480` typecheck failure (red on master since 2026-04-18) persists. This short-circuit is not an immutable constraint — a future CI-only refactor (e.g., `if: always()` or `continue-on-error: true` on the typecheck step, or a parallel-jobs split) would let tournament steps run independently. T1-5 deliberately chose not to do that refactor (keep diff minimal; match Wolf Cup's shape; revisit if wall-clock bites). Party verdict: **PASS-WITH-FOLLOWUPS**. The Wolf Cup typecheck dependency is the one real followup; everything else is administrative (Josh-manual branch-protection config, secrets audit).

---

## 📊 Mary — Analyst

*Scope-fit lens: does T1-5 deliver the NFR-C3 / NFR-D1 promise?*

**NFR-C3 (Wolf Cup regression protection):** the CI already enforced this for Wolf Cup before T1-5. T1-5 adds symmetric tournament coverage — now a tournament-side regression in tournament-api tests or tournament-web's smoke test ALSO fails CI. The dual-run promise is fulfilled *in wiring* (both ecosystems' test runners are declared in the same workflow) even though fails-fast means they don't run in the same CI invocation today. When Wolf Cup's typecheck is fixed, both ecosystems run in sequence on every PR. Scope: delivered.

**NFR-D1 (CI dual-run on every commit):** same story. The workflow is defined; whether every step executes depends on whether preceding steps pass. That's GitHub Actions default behavior, matches Wolf Cup's existing shape. Delivered.

**Scope discipline.** Five things T1-5 deliberately did NOT do, each defensible:
1. No parallel-jobs refactor. Current CI wall-clock is ~38s; D5-3 tripwire is 5 min. Refactoring for zero-second benefit at this workload is premature.
2. No fix for Wolf Cup's standings.tsx typecheck (FORBIDDEN path).
3. No branch-protection config changes (repo-admin scope, AC #2).
4. No secrets audit automation (GitHub UI inspection, AC #4).
5. No new environment variables or secrets references — the guard for AC #3 (future OAuth stubs) is *absence*, deliberately so.

**Scope gap I'd flag: zero material.** The AC #6 short-circuit is a real thing but not a T1-5 scope issue — it's a Wolf Cup bug that T1-5 correctly inherits-without-fixing.

**Unblocks:**
- **T1-6 auth realm** — will land with OAuth/magic-link integration tests that use Arctic + Resend stubs. T1-5's CI is the runner those tests will execute in. Delivered.
- **T1-7 structured log sink** — needs CI to exercise the logger emission path. Delivered.
- **Any tournament story shipped after T1-5** — now has CI pass/fail signal on tournament-specific tests (pending Wolf Cup typecheck fix).

**Verdict:** Meets the story's NFR contract. ✅

---

## 🏗️ Winston — Architect

*CI topology lens: is the shape right, is the cost well-spent, is the future-work path clear?*

**Sequential-steps-in-one-job vs parallel-jobs.** The minimal-diff choice. Trade-offs:
- **Sequential (chosen):** simpler YAML, one runner, one pnpm install, fails-fast is automatic. Current wall-clock ~38s end-to-end is fine.
- **Parallel jobs:** ecosystem-level isolation (Wolf Cup failure doesn't short-circuit tournament), but duplicate installs (~20-30s each of 3 jobs) would push total wall-clock UP, not down. Not worth it at this scale.

The spec's Dev Notes correctly captures the "revisit if CI > 2-3 min" threshold. Keeping the monorepo assumption (single job) is aligned with the architecture's monorepo posture until the 5-min tripwire fires.

**Action version inheritance (@v6).** `actions/checkout@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v4` are pre-existing. T1-5 inherits them verbatim. Codex's training-cutoff-based "these versions don't exist" claim is empirically refuted by the CI run logs (the `Download action repository 'actions/checkout@v6' (SHA:...)` line is in the most recent failure log). The spec correctly records this evidence so future codex passes don't re-flag it. Action-version maintenance is a separate CI hygiene concern, not T1-5's responsibility.

**FD checkpoint:**
- **FD-1 (Wolf Cup isolation):** ✅ ci.yml diff is purely additive; zero Wolf Cup service mutation.
- **FD-2 (no Wolf Cup rename):** ✅ N/A at CI layer.
- **NFR-C3 + NFR-D1:** wired per Mary's section above.

**Layering concerns: zero.** CI is declarative; no layering to violate.

**One architectural note I'll make for the record:** the `pnpm -r typecheck` step (existing, not modified by T1-5) is a lowest-common-denominator aggregator. When Wolf Cup's typecheck is eventually fixed and the workflow goes fully green, `pnpm -r typecheck` will handle all 5 workspaces' typecheck in one step. This is a deliberate choice — simpler than 5 explicit filter steps, at the cost of slightly worse step-level diagnostics. That trade-off is appropriate at this workload.

**Architecture verdict:** ✅ Clean, minimal, future-proofed. The parallel-jobs refactor remains on the table when/if wall-clock bites.

---

## 📋 John — Product Manager

*Story value + downstream unblocking + Josh-manual items.*

**Story value.** T1-5 is pure plumbing, but it's load-bearing plumbing:
- Without T1-5, every commit that touches tournament code can ship regressions that Wolf Cup's existing CI didn't notice.
- With T1-5, tournament-specific tests become first-class CI citizens. When T1-6 adds OAuth integration tests, T2.1 adds schema tests, T5 adds scorer tests, etc. — each slots into the existing `Test (tournament-*)` step pattern without further CI edits.

**AC quality.** 9 ACs, distributed as:
- 4 code-verifiable ACs (1, 7, 8, 9) — all pass.
- 1 observability AC (#5 baseline) — 11.56s / ~38s recorded.
- 1 known-state-documented AC (#6 Wolf Cup short-circuit) — honest documentation of a transient limitation.
- 2 Josh-manual ACs (#2 branch protection, #4 secrets audit) — documented as post-commit manual steps.
- 1 forward-contract AC (#3 OAuth stubs reserved for T1-6) — no code at T1-5.

Offloading AC #2 and AC #4 to Josh is acceptable because they're genuinely outside code scope — no amount of CI YAML can configure branch-protection rules, and no amount of CI YAML can audit existing secrets. Both are one-time repo-admin actions.

**Unblocks:**
- **T1-6 auth realm** — its integration tests need a CI path to land in. ✅ Delivered.
- **All post-T1 tournament work** — gets tournament-test-suite regression coverage. ✅ Delivered.

**PM footgun I'll flag:** the AC #6 short-circuit is a footgun for *Josh's mental model of CI health*. If he looks at the CI dashboard tomorrow and sees red, he might reasonably assume T1-5 broke something — when in fact T1-5's steps never ran, because the pre-existing Wolf Cup typecheck failure is the root cause. Mitigation: the story Followups make this explicit, and the post-T1-5 CI failure log will show the same `standings.tsx:480` error as the last 5 runs — easy to diagnose. Still worth calling out in the commit message + retrospective.

**PM verdict:** Delivers story value. ✅

---

## 🧪 Quinn — QA

*Ship-it-and-iterate lens: what's tested, what's not, and what's at risk?*

**What IS verified locally:**
- The new CI steps run the exact commands the ACs require (`pnpm --filter @tournament/api test`, `pnpm --filter @tournament/web test`).
- Those commands pass cleanly in the current workspace state (19 + 1 tests).
- Wolf Cup workspaces still pass (engine 468/468, api 429/429) — zero delta.
- `pnpm -r lint` is green across all 5 workspaces.
- ci.yml diff is additive-only (`git diff --stat` → `+6 -0`).
- Insertion point is exactly between `Test (api)` and `Lint` as specified.

**What is NOT verified (and how it'd be verified):**
1. **The new CI steps actually run and pass in GitHub Actions.** This requires: (a) commit + push to a branch, (b) CI run executes, (c) the new steps enter the "passed" state. But currently blocked by AC #6's pre-existing Wolf Cup typecheck failure short-circuiting all steps after `pnpm -r typecheck`. The authoritative signal that T1-5 is working will be the first CI run where Wolf Cup's standings.tsx is fixed AND T1-5's steps run and pass — potentially days or weeks away from today.
2. **Branch-protection rules block merging on CI red.** AC #2. Not code — Josh checks Repo Settings.
3. **Secrets in Actions contain no prod values.** AC #4. Not code — Josh checks Repo Settings.

**Is AC #6's short-circuit acceptable?** Yes, because:
- It's documented honestly in the story (not swept under the rug).
- The short-circuit is GitHub Actions default behavior, not a T1-5 design choice.
- Fixing the root cause is FORBIDDEN (Wolf Cup path).
- When the root cause is fixed, T1-5's steps run automatically with no further intervention.
- The commit message explicitly surfaces this caveat.

**Test gaps I'd name but not escalate:**
- No test of "CI actually fails when a tournament test fails." Practically: someone has to deliberately break a tournament test, push, confirm CI is red. T1-5 ships the wiring; the negative-path validation is operational folklore (nobody does it on scaffold stories).
- No test that `pnpm --filter @tournament/api test` exits 0 specifically in Ubuntu 24.04 runner image (local dev is Windows/Git Bash). Practically: if Node 22 + pnpm 9.15.9 runs the same tests, exit code parity is an extremely safe bet.

**QA verdict:** Adequate for a scaffold story of this size. Remaining gaps are named, deferred, and don't block the commit. ✅

---

## 💻 Amelia — Dev

`.github/workflows/ci.yml:35-44` — the exact +6 line insertion, placed immediately after `Test (api)` (line 34-35) and immediately before `Lint` (line 46-47):
```yaml
      - name: Test (tournament-api)
        run: pnpm --filter @tournament/api test

      - name: Test (tournament-web)
        run: pnpm --filter @tournament/web test
```
Insertion point correctness: ✅ as spec Subtask 1.1 required.

`pnpm --filter` parity with existing Wolf Cup steps: ✅. Line 29 uses `pnpm --filter @wolf-cup/engine test`; line 35 uses `pnpm --filter @wolf-cup/api test`. The new lines use the same long-form for visual consistency (the spec's AC literals use `-F` as shorthand but note the YAML form is identical semantic).

Step naming: `Test (tournament-api)` and `Test (tournament-web)` follow the existing `Test (engine)` / `Test (api)` convention — parenthesized workspace identifier. ✅

`git diff --stat`: `+6 -0`. ✅ AC #7.

Local verification: both new commands exit 0.
- `pnpm -F @tournament/api test`: 2 files, 19 tests, 472ms.
- `pnpm -F @tournament/web test`: 1 file, 1 test, 473ms.

Wolf Cup regression: zero delta.
- `pnpm -F @wolf-cup/engine test`: 11 files, 468 tests, 723ms.
- `pnpm -F @wolf-cup/api test`: 21 files, 429 tests, 3.60s.

Commit scope clean:
```
 M  .github/workflows/ci.yml                                                  SHARED (user-approved)
 M  _bmad-output/implementation-artifacts/tournament/sprint-status.yaml       ALLOWED
 ?? _bmad-output/implementation-artifacts/tournament/T1-5-*.md                ALLOWED
 ?? _bmad-output/reviews/T1-5-*-codex*.md                                     ALLOWED (×3 spec + ×1 impl)
```
Zero FORBIDDEN writes. Zero unapproved SHARED writes.

**Footguns codex did not catch:** none material. The `+6 -0` shape and the Wolf Cup action-version inheritance are both spec-documented and inspected.

**Dev verdict:** Ship. ✅

---

## Consolidated findings

| # | Severity | Agent(s) | Concern | Suggested action |
|---|----------|----------|---------|------------------|
| 1 | Info | Analyst, QA | Under T1-5's chosen fails-fast design (single-sequential-job, inherited from Wolf Cup), the new tournament CI steps will not execute while Wolf Cup's pre-existing typecheck at `apps/web/src/routes/standings.tsx:480` is red. This is a **design choice**, not a protocol constraint — a CI-only refactor (`if: always()` on the typecheck step, or parallel jobs per ecosystem) could make tournament steps execute independently. T1-5 deliberately chose not to do that refactor. | Documented in story AC #6 + Followups + Dev Notes "Why NOT gate behind `if: always()`". When Wolf Cup ships the fix to `standings.tsx` (separate Wolf Cup backlog item, FORBIDDEN path for tournament director), tournament steps run automatically. If the short-circuit becomes operationally painful before Wolf Cup ships its fix, revisit the parallel-jobs refactor as a separate tournament CI story. Do NOT block T1-5. |
| 2 | Info | PM | AC #2 (CI blocks PR merging until green) is a GitHub Repo Settings → Branches → Branch protection rules configuration, not CI code. **Operational caveat:** if branch-protection is already configured to require CI green, and CI is currently red on master due to the pre-existing Wolf Cup typecheck, a PR-based merge of T1-5 would be blocked until that is fixed. Josh's deploy workflow is **direct push to master** (per deploy convention + memory), so branch-protection is effectively moot for this commit — but worth knowing if Josh switches to PR-gated merges in the future. | Noted as Josh-manual post-commit item + deploy-workflow context. No code required at T1-5. Do NOT block T1-5. |
| 3 | Info | PM, QA | AC #4 (no production secrets in GitHub Actions) is a Repo Settings → Secrets UI audit, not automatable in director scope. | Noted as Josh-manual post-commit item. Do NOT block T1-5. |
| 4 | Info | Architect | CI uses sequential steps in a single job; a parallel-jobs refactor would isolate tournament from Wolf Cup failures but adds orchestration overhead. Deferred until CI wall-clock exceeds 2-3 min. | Noted in story Dev Notes + Followups as deferred future work. Current wall-clock ~38s is far from the 5-min D5-3 tripwire. Do NOT block T1-5. |
| 5 | Low (from impl-codex) | QA | Story Status header read `ready-for-dev` during impl while sprint-status.yaml was `in-progress`. | Acknowledged; matches T1-3/T1-4 pattern. Header updates to `done` at commit time in sync with sprint-status. Do NOT block T1-5. |
| 6 | Info | Architect | Actions used (`actions/checkout@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v4`) are inherited from Wolf Cup's existing ci.yml; T1-5 does not change any action version. Codex-review tooling with older training data may flag `@v6` as non-existent; empirically confirmed resolving in CI. Evidence (quoted from `gh run view 24673043289 --log-failed`): `Download action repository 'actions/checkout@v6' (SHA:de0fac2e4500dabe0009e67214ff5f5447ce83dd)` and equivalent line for `actions/setup-node@v6`. | Documented in story Dev Notes with citation from recent CI log. Do NOT re-litigate. |

**Zero High findings. Zero user-decision-required findings. Zero open questions to the user on technical scope.** Two procedural gates were cleared mid-story: spec-approval and SHARED-edit-approval for ci.yml.

---

## Verdict: PASS-WITH-FOLLOWUPS

T1-5 is ready to commit. Remaining work to green-light:
1. Final commit with director message.
2. Status flip to `done` in both sprint-status.yaml and story header.

Post-commit, post-push (Josh actions):
1. Manual audit: Repo Settings → Secrets and variables → Actions. Confirm no production credentials present.
2. Manual verify: Repo Settings → Branches. Confirm branch-protection requires CI green before merge.
3. Separate Wolf Cup backlog work: fix `apps/web/src/routes/standings.tsx:480` typecheck error so ALL CI steps including new tournament ones actually execute on master.

None block the T1-5 commit.

Party out. 🎉
