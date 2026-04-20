# Story T1.5: CI Dual-Run Pipeline

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want CI to run engine + Wolf Cup + tournament test suites on every push and PR,
so that tournament work cannot regress Wolf Cup tests (or vice versa) undetected and the tournament workspaces get visible pass/fail signal on every commit (NFR-C3, NFR-D1).

## Acceptance Criteria

1. **Given** a push or pull_request to GitHub
   **When** the CI workflow at `.github/workflows/ci.yml` runs
   **Then** each of the following commands is **wired into the pipeline and must pass WHEN IT EXECUTES** (the AC does not require that every step actually runs on every CI run — fails-fast semantics mean a failure in an earlier step can short-circuit later steps; see AC #6 for the known current-state short-circuit). *Note on command form:* the AC literals below use `pnpm -F` (the short flag alias for `--filter`). The ci.yml step `run:` lines use the long-form `pnpm --filter ...` for parity with Wolf Cup's existing steps at `.github/workflows/ci.yml:29` (`pnpm --filter @wolf-cup/engine test` etc.). Both forms are semantically identical per pnpm's CLI docs; AC literals are the command-identity anchor, YAML step `run:` lines are the concrete invocation.
   - `pnpm -F @wolf-cup/engine test` — existing CI step, unchanged.
   - `pnpm -F @wolf-cup/api test` — existing CI step, unchanged.
   - `pnpm -F @wolf-cup/web typecheck` — covered by the existing `pnpm -r typecheck` step (AC #1 command LITERAL is the filtered form; the `-r` recursive variant exercises the exact same workspace `typecheck` script — verified by inspection: each of the 5 workspaces declares a `typecheck` script in its `package.json`).
   - `pnpm -F @tournament/api test` — **NEW CI step added by this story**, inserted directly after the `Test (api)` step (mirrors Wolf Cup-api test placement for ordering symmetry).
   - `pnpm -F @tournament/web typecheck` — covered by the existing `pnpm -r typecheck` step (same reasoning as `@wolf-cup/web typecheck`).
   Additionally (beyond the AC-required minimum, but cheap): **`pnpm -F @tournament/web test`** is added as a second new CI step. The epic AC for tournament-web lists *typecheck* only (typecheck is the authoritative AC); adding a *test* step gives tournament-web symmetry with tournament-api and catches any breakage in the query-client smoke without adding meaningful wall-clock time (<1s). The new test step is NOT a substitute for the AC'd typecheck (typecheck is already covered above) — it is ADDITIVE.
2. **Given** any required step fails (test, typecheck, lint, or docker build smoke)
   **When** the PR is checked
   **Then** the overall CI run is marked as failed and GitHub's branch-protection/PR-status shows the PR as blocked from green. (Branch-protection rules that literally "block merging until green" are a GitHub repo-settings configuration, not a CI code change; T1-5 does NOT touch those settings — Josh confirms/configures them manually. CI itself just reports pass/fail per step; GitHub's merge-block wiring is repo-admin scope.)
3. **Given** integration tests that will require OAuth in the future (T1.6+)
   **When** those tests are added
   **Then** they MUST use stubbed Arctic state/exchange and a stubbed Resend SDK per architecture validation gap #5; zero production credentials are required in CI. **At T1.5, no such tests exist yet.** This AC is a forward contract: T1-5 ships the CI shell; when T1-6 lands auth-integration tests, they land with stubs. T1-5's CI does NOT need to reference OAuth secrets; the absence of secret-wiring is the T1-5 guard.
4. **Given** GitHub Actions secrets for this repo
   **When** inspected via the GitHub repo Settings UI
   **Then** only test-grade values are stored: no production OAuth client secret, no production Resend API key, no production database URL, no production R2 credentials. **T1-5's code change does NOT add any secret reference to `.github/workflows/ci.yml`.** Josh inspects Repo Settings → Secrets and variables → Actions after this story's commit lands, confirms the absence of prod secrets, and records the result in this story's Completion Notes. If the inspection surfaces any prod secret, it's a followup to rotate/remove — separate from T1-5's code contribution.
5. **Given** a local measurement of test wall-clock
   **When** `time pnpm -r test` runs on a clean local checkout (post-install, all deps resolved, all 5 workspaces)
   **Then** the wall-clock duration is recorded in this story's Completion Notes as a **test-runner baseline** (NOT an equivalent of full CI wall-clock; see note below). **Pre-measured at implementation start: 11.56 seconds for `pnpm -r test`** (exit 0; runs the `test` script in each of the 4 workspaces that declare one — `@wolf-cup/engine`, `@wolf-cup/api`, `@tournament/api`, `@tournament/web`; `apps/web` (`@wolf-cup/web`) has no `test` script at this time so `pnpm -r test` skips it). Total passing test count across the 4 runnable workspaces: 917 (468 engine + 429 api + 19 tournament-api + 1 tournament-web). Portability note: `time` is the bash builtin available under Josh's shell environment (`bash` per project setup). On PowerShell/cmd the equivalent is `Measure-Command { pnpm -r test }`; either produces the same workload. **Full CI wall-clock** (install + typecheck + test + build + lint + docker compose build) on GitHub Actions `ubuntu-latest` runs at ~38 seconds per the most recent 5 attempts (`gh run list --branch master` run_id 24673043289 and 4 prior — each 32-38s duration, failing at the Wolf Cup typecheck step). **Both the test-runner baseline (11.56s) AND the full CI wall-clock (~38s) are far under the architecture D5-3 tripwire ("CI > 5 min → split monorepo").** The baseline is informational — AC does not fail even if the number is large; it is a forward-looking data point for a future monorepo-split decision. The D5-3 tripwire explicitly measures full CI wall-clock (not test-runner-only), so the ~38s figure is the authoritative one; 11.56s is supplementary context.
6. **Given** the pre-existing CI failure on `master` at `apps/web/src/routes/standings.tsx:480` (`TS2322: Type 'StandingsPlayer | null | undefined' is not assignable to type 'StandingsPlayer | null'`, pushed with commit 50e93f7 on 2026-04-18 and unresolved across 5 subsequent pushes per `gh run list`)
   **When** T1-5's CI change lands
   **Then** T1-5 does NOT fix the Wolf Cup typecheck failure — `apps/web/**` is FORBIDDEN per director allowlist (FD-1/FD-2). The Wolf Cup web typecheck failure is a pre-existing defect in Wolf Cup's code that T1-5 inherits but does NOT cause. **Consequence: the first CI run after T1-5's commit lands will fail at the `Typecheck` step (which runs `pnpm -r typecheck`). Because the CI job is a single sequential `steps:` list with GitHub Actions default fails-fast behavior, ALL subsequent steps skip — not just the two new tournament test steps.** That includes the existing `Test (engine)`, `Build engine`, `Test (api)`, `Lint`, and `Docker build smoke test` steps, which have been skipping on master since 2026-04-18. The new tournament steps inherit the same skip behavior. The new tournament steps are wired into the workflow file and will run automatically once Wolf Cup's standings.tsx typecheck is fixed (separate Wolf Cup backlog item). This is documented in Followups as the expected post-commit CI state — not a T1-5 defect.
7. **Given** `.github/workflows/ci.yml`
   **When** diffed post-T1-5
   **Then** the diff is **additive only** except the insertion of new test steps; zero existing steps are deleted, no existing step's command string is modified, and no new environment variables or secrets references are introduced. Verifiable via `git diff --stat .github/workflows/ci.yml` showing `+N -0`.
8. **Given** local execution
   **When** `pnpm -F @tournament/api test` and `pnpm -F @tournament/web test` are run locally from the repo root
   **Then** both exit `0`. Tournament-api runs 19 tests (2 files: `app.test.ts`, `port.test.ts`) per T1-2. Tournament-web runs 1 test (`query-client.test.ts`) per T1-3. This is the same command the new CI steps will execute; local pass = CI steps will pass (assuming Wolf Cup's prerequisite typecheck also passes, per AC #6).
9. **Given** Wolf Cup workspaces (engine + api)
   **When** `pnpm -F @wolf-cup/engine test` and `pnpm -F @wolf-cup/api test` are run locally post-T1-5-edit
   **Then** both continue to pass with zero net-negative test count change. (T1-5 doesn't touch any TS source; regression is trivially expected.)

## Tasks / Subtasks

- [ ] Task 1: Edit `.github/workflows/ci.yml` (AC: #1, #7) — **SHARED PATH, HARD STOP FOR USER APPROVAL**
  - [ ] Subtask 1.1: Announce the intended edit: insert **exactly two new steps** after the existing `Test (api)` step:
    ```yaml
          - name: Test (tournament-api)
            run: pnpm --filter @tournament/api test

          - name: Test (tournament-web)
            run: pnpm --filter @tournament/web test
    ```
    Preserve all existing step order/content: checkout, pnpm/action-setup, setup-node, Install, Typecheck (`pnpm -r typecheck`), Test (engine), Build engine, Test (api), [NEW INSERT HERE], Lint, Docker build smoke test.
  - [ ] Subtask 1.2: Wait for explicit user approval on the SHARED edit. Do NOT edit until approved.
  - [ ] Subtask 1.3: Apply the edit. Verify `git diff --stat .github/workflows/ci.yml` shows `+N -0` (additive only).
- [ ] Task 2: Local verification (AC: #8, #9)
  - [ ] Subtask 2.1: Run `pnpm -F @tournament/api test` — expect exit 0, 19 tests pass.
  - [ ] Subtask 2.2: Run `pnpm -F @tournament/web test` — expect exit 0, 1 test passes.
  - [ ] Subtask 2.3: Run `pnpm -F @wolf-cup/engine test` — expect exit 0, 468 tests pass (zero delta).
  - [ ] Subtask 2.4: Run `pnpm -F @wolf-cup/api test` — expect exit 0, 429 tests pass (zero delta).
  - [ ] Subtask 2.5: Run `pnpm -r lint` — expect exit 0.
- [ ] Task 3: Baseline record (AC: #5)
  - [ ] Subtask 3.1: Record `time pnpm -r test` wall-clock in this story's Completion Notes. **Pre-measured at spec authoring: 11.56 seconds, exit 0.** Subtask 3.1 re-runs post-edit to confirm the number hasn't shifted.
- [ ] Task 4: Post-commit Josh-verification items (AC: #4)
  - [ ] Subtask 4.1: Document in this story's Completion Notes that Josh will — after the commit lands on master and is pushed — inspect Repo Settings → Secrets and variables → Actions on the GitHub UI, and confirm the absence of any production OAuth client secret, production Resend API key, production database URL, production R2 credentials, or production GHIN credentials. This is a one-time manual audit, not automatable in this story.
- [ ] Task 5: Nothing else for T1-5
  - [ ] Subtask 5.1: Explicitly do NOT touch: `apps/api/**`, `apps/web/**`, `packages/engine/**` (FORBIDDEN), root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docker-compose.yml`, `deploy.sh`, `.env.example`, `eslint.config.js` (all SHARED, not needed at T1-5). If any cross-cutting cleanup is tempting, note it in Followups — do not do it.

## Dev Notes

- **T1-5 is a minimal-scope CI story.** The entire code change is a 5-6-line YAML insertion in `.github/workflows/ci.yml`. No source edits, no new packages, no schema, no Dockerfile changes.
- **Existing `pnpm -r typecheck` CI step covers AC #1 items 3 and 5 (`@wolf-cup/web typecheck` and `@tournament/web typecheck`) implicitly** via pnpm's recursive-filter semantics. Each of the 5 workspaces has a `typecheck` script declared in its `package.json` (verified by inspection at spec time):
  - `packages/engine`: `tsc --noEmit && tsc --noEmit -p tsconfig.node.json`
  - `apps/api`: `tsc --noEmit`
  - `apps/web`: `tsr generate && tsc --noEmit -p tsconfig.app.json`
  - `apps/tournament-api`: `tsc --noEmit`
  - `apps/tournament-web`: `tsr generate && tsc --noEmit -p tsconfig.app.json`
  Splitting `pnpm -r typecheck` into 5 explicit filter steps was considered and rejected for T1-5 scope: the AC is satisfied either way, and the minimal-diff approach to a SHARED file (`.github/workflows/ci.yml`) reduces commit surface area. A future CI-refactor story could split into parallel jobs if build duration becomes a concern.
- **Why NOT split CI into parallel jobs (one per ecosystem)?** The architecture target is "CI < 5 min" (D5-3). Current full CI wall-clock is ~38 seconds (per `gh run list` recent runs). Parallel jobs add orchestration surface (cache-sharing, install duplication) for a trivial wall-clock gain at this workload. If CI wall-clock ever exceeds 2-3 minutes, revisit — but not this story.
- **Why NOT add `depends_on` / matrix / explicit needs chain?** Single `ci` job with sequential steps mirrors Wolf Cup's proven pattern (running continuously since before tournament scaffold). Mirror Wolf Cup; evolve when needed.
- **Why NOT gate tournament test steps behind `if: always()`?** The design intent IS fails-fast. If Wolf Cup tests fail, the PR is red; running tournament tests after a Wolf Cup failure doesn't change the PR outcome and just burns runner minutes. Accept the default fails-fast semantics. (If tournament-specific red signal is needed despite Wolf Cup being red, that's when the parallel-jobs refactor becomes worth doing — not yet.)
- **Pre-existing Wolf Cup web typecheck failure is a known blocker for this story's CI to go green.** Confirmed via `gh run list --limit 5 --branch master` showing 5 consecutive CI failures since 2026-04-18 (commit `50e93f7`), all with the same root cause at `apps/web/src/routes/standings.tsx:480`. T1-5 cannot fix this (FORBIDDEN path). Expected state after T1-5 commits land: CI remains red on master on the Wolf Cup typecheck step, tournament test steps don't execute until Wolf Cup is fixed. This is documented as a followup for Wolf Cup's backlog — explicitly NOT T1-5's responsibility.
- **AC #3 (OAuth stubs) is a forward contract, not code.** T1-5 ships the CI runner; T1-6 introduces OAuth + integration tests with stubs. The guard at T1-5 is *not adding any secret reference to ci.yml*. AC #3 is satisfied by absence — inspection of ci.yml post-T1-5 shows zero `secrets.*` references.
- **AC #4 (no prod secrets) is a Josh-in-GitHub-UI audit, not code.** GitHub Actions secrets are repo-admin scope; the CLI can list secret names via `gh api repos/:owner/:repo/actions/secrets` but that requires admin permission and is better done via the web UI. Document as a post-commit Josh action in Completion Notes.
- **Branch protection rules** (AC #2 "PR is blocked from merging until green") are a GitHub repo Settings → Branches → Branch protection rules configuration, not CI code. T1-5 does NOT touch repo settings — the existing repo protection rules (if any) continue to apply. If no branch protection is configured today, that's a Josh-decides-policy question, not a T1-5 implementation question.
- **Wolf Cup isolation (FD-1/FD-2):** T1-5 modifies exactly ONE SHARED file (`.github/workflows/ci.yml`, additive) and zero other files. Zero writes to Wolf Cup paths. The new CI steps RUN tournament commands; they don't modify Wolf Cup test surface.
- **GitHub Action version notes (inherited, not changed).** The existing `ci.yml` uses `actions/checkout@v6`, `pnpm/action-setup@v4`, `actions/setup-node@v6`. Codex-review tooling trained before 2026 may flag `@v6` as "non-existent", but empirically these majors resolve and run on the current GitHub Actions registry — confirmed via `gh run view 24673043289 --log-failed` which shows `Download action repository 'actions/checkout@v6' (SHA:de0fac2e4500dabe0009e67214ff5f5447ce83dd)` and the equivalent line for `actions/setup-node@v6`. T1-5 does NOT change these versions; any action-version bump is a separate Wolf Cup CI maintenance concern. If a future CI run breaks because of an action deprecation, address in a separate story.
- **Commit scope:** 1 SHARED file (ci.yml), 1 ALLOWED story file, 1 ALLOWED sprint-status update, 2-3 ALLOWED codex review files. Small commit.

### Project Structure Notes

- Target change: `.github/workflows/ci.yml` — insert 2 new steps (6 YAML lines + 2 blank-line separators).
- No new files anywhere.
- Shape after this story:
  ```
  .github/
    workflows/
      ci.yml       # MODIFIED: +6 YAML lines (+2 new test steps) after existing 'Test (api)' step
  ```

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 458-484 (Story T1.5 ACs).
- Architecture D5-3 (CI < 5 min tripwire): `_bmad-output/planning-artifacts/tournament/architecture.md` — the monorepo-split decision is gated on CI wall-clock.
- Architecture validation gap #5 (OAuth stub pattern): `_bmad-output/planning-artifacts/tournament/architecture.md` — pattern reserved for T1.6+.
- NFR-C3 (Wolf Cup regression guard), NFR-D1 (CI dual-run): `_bmad-output/planning-artifacts/tournament/prd.md`.
- T1-3 story Followups (pre-existing Wolf Cup web typecheck failure): `_bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md` § Followups.
- T1-2 tournament-api test count evidence (19 tests): `_bmad-output/implementation-artifacts/tournament/T1-2-scaffold-tournament-api.md` § File List / Debug Log.
- T1-3 tournament-web test count evidence (1 test): `_bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md` § File List / Debug Log.
- CI failure evidence: `gh run list --limit 5 --branch master` run_id 24673043289 log tail shows `##[error]apps/web typecheck: src/routes/standings.tsx(480,17): error TS2322`.
- Wolf Cup-parity references (READ only — do not edit):
  - `.github/workflows/ci.yml` (current state, 42 lines) — the file being modified.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Claude Opus 4.7, 1M context), running as the Tournament Director orchestrator.

### Debug Log References

Spec-review rounds (2026-04-20):
- Round 1: 1 Critical (rejected — false positive; `actions/checkout@v6` empirically resolves per recent CI logs) + 1 High + 2 Medium + 1 Low. High + 2M + 1L fixed.
- Round 2: 2 Medium + 1 Low — all fixed.
- Round 3: 2 Low — tightened.

Implementation verification (2026-04-20):

```
# Edit: .github/workflows/ci.yml additive (+6 -0)
- Test (tournament-api): pnpm --filter @tournament/api test
- Test (tournament-web): pnpm --filter @tournament/web test
Inserted between existing `Test (api)` and `Lint` steps. Existing 12 steps byte-unchanged.

# AC #8: Local verification of new steps
pnpm -F @tournament/api test → 2 files, 19 tests passed (472ms)
pnpm -F @tournament/web test → 1 file, 1 test passed (473ms)

# AC #9: Wolf Cup regression
pnpm -F @wolf-cup/engine test → 11 files, 468 tests passed (723ms) — Δ = 0
pnpm -F @wolf-cup/api    test → 21 files, 429 tests passed (3.60s) — Δ = 0

# Lint sweep (beyond ACs, sanity)
pnpm -r lint → all 5 workspaces green

# AC #5 baseline: test-runner + full CI wall-clock
pnpm -r test (local) → 11.56s, 917 tests across 4 workspaces (engine 468 + api 429 + tournament-api 19 + tournament-web 1)
Full CI wall-clock on ubuntu-latest (from gh run list, recent 5 runs) → ~38s (currently failing at Wolf Cup typecheck step)
Both well under D5-3 5-min tripwire.
```

### Completion Notes List

- **Scope discipline held.** T1-5 modified exactly 1 SHARED file (`.github/workflows/ci.yml`, additive +6/-0 diff, Josh approved mid-story). Zero ALLOWED-file creations beyond the story doc + reviews. Zero FORBIDDEN writes. Zero source code touched.
- **AC compliance:** 9 ACs covered locally. AC #2 (branch-protection configuration) and AC #4 (inspect Actions secrets via GitHub UI) are Josh-only manual steps documented as post-commit items in Followups — not automatable in director scope.
- **`.github/workflows/ci.yml` diff is purely additive** — verified via `git diff --stat .github/workflows/ci.yml` → `+6 -0`. Insertion is strictly between existing `Test (api)` and `Lint` steps; no existing step's run command or step name is mutated.
- **New tournament test steps run locally clean** but will NOT execute in CI on master until the pre-existing Wolf Cup web typecheck failure at `apps/web/src/routes/standings.tsx:480` is fixed (FORBIDDEN path for tournament director — separate Wolf Cup backlog item). This is the documented AC #6 state: fails-fast at `pnpm -r typecheck` short-circuits the remaining steps. Tournament steps are wired and will run automatically once standings.tsx is fixed.
- **Full CI wall-clock baseline recorded.** Recent 5 runs on master averaged ~38 seconds before failing at typecheck. `pnpm -r test` (test-runner only) is 11.56 seconds locally. Both are far under the D5-3 5-minute monorepo-split tripwire.
- **Wolf Cup isolation (FD-1/FD-2) held:** `git status` shows zero modifications under `apps/api/**`, `apps/web/**`, `packages/engine/**`, or any other Wolf Cup path. The only SHARED edit is `.github/workflows/ci.yml`.

### Followups

- **[Josh manual audit, post-commit — AC #4]** Inspect Repo Settings → Secrets and variables → Actions on GitHub. Confirm the absence of any production OAuth client secret (Google/Arctic), production Resend API key, production database URL, production R2 credentials, or production GHIN credentials. If any prod secret is present, rotate/remove as a separate hygiene item. T1-5's code change does NOT add any `secrets.*` reference to `ci.yml`, so this audit is a defensive confirmation, not a consequence of T1-5.
- **[Josh manual config, post-commit — AC #2]** Confirm GitHub repo branch-protection rules on `master`: require CI to pass before merging PRs. T1-5 does NOT modify Repo Settings → Branches; existing protection rules (if any) continue to apply. If no branch protection is configured today, that's a policy call for Josh to make — orthogonal to T1-5's CI work.
- **[Pre-existing Wolf Cup CI red — FORBIDDEN for this story]** `gh run list --branch master` shows 5 consecutive CI failures since 2026-04-18, all on `apps/web/src/routes/standings.tsx:480` typecheck. Wolf Cup's backlog item. When Wolf Cup fixes standings.tsx, the T1-5-added tournament test steps will start running in CI automatically (no additional ci.yml change needed). T1-5 did NOT attempt a fix (FORBIDDEN path).
- **[Future CI refactor, deferred]** If CI wall-clock ever exceeds 2-3 minutes OR if Wolf Cup's typecheck remains red long enough that tournament test isolation becomes valuable, a parallel-jobs refactor (separate Wolf Cup / tournament / engine jobs) is the next logical step. Explicitly out of scope for T1-5 — minimal-diff approach chosen deliberately.

### File List

- `.github/workflows/ci.yml` (modified — SHARED path, user-approved; +6 -0 additive diff adding Test (tournament-api) + Test (tournament-web) steps after existing Test (api))
- `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` (modified — T1-5 status transitions across the cycle)
