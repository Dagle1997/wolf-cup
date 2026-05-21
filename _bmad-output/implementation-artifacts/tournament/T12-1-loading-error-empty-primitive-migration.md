# T12-1: Loading / Error / Empty-State Primitive Migration

## Status

ready-for-dev

## Story

As a tournament-web user (organizer or player) who sees inconsistent, unstyled loading and error states across pages, I want every route's hand-rolled `<div>Loading…</div>` / ad-hoc error `<div>` / bare empty message replaced with the T11-1 primitives (`LoadingCard`, `ErrorCard`, `EmptyState`) — so the app presents one visually-consistent, accessible (`role="status"` / `role="alert"`) state-display family instead of the ~16-route patchwork T11-1 was built to retire but never got wired into.

T11-1 shipped the three primitives; T11-3 rolled out PageShell/BackLink but explicitly deferred the loading/empty migration. The primitives currently have **0 route adoption** (confirmed by grep). This story closes that gap.

## Risk Acceptance (announce up-front for the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN

Every edited file is under `apps/tournament-web/src/routes/**` (the 16 routes + their colocated `.test.tsx` siblings) plus the tournament `sprint-status.yaml`. The tournament-director allowlist bucket is the broader `apps/tournament-web/**`, but this story's ACTUAL edits never leave `src/routes/**` — in particular `apps/tournament-web/src/components/**` (the primitives) is NOT touched. No API, no engine, no Wolf Cup paths, no repo-root config, no new dependencies.

### 2. Authoritative method = per-file inspection; migrate state-DISPLAY render branches only

The grep audit (loading/error/empty patterns) is the **starting map**, not the authority — grep cannot distinguish a render branch from a control-flow check, and may miss empty states expressed without a literal `.length === 0` (e.g. `data?.rows?.length ? … : <empty>`, ternaries). **The authoritative migration is built by READING each of the 16 listed files and identifying its page-level state RENDER branches** (the JSX a route returns when its primary query is loading / errored / empty). Within each listed file, migrate ALL such page-level render branches. This is what makes the work mechanical-by-inspection rather than grep-guided guessing.

A "page-level state render branch" = a branch that returns the route's whole-page (or whole-section) fallback UI for loading/error/empty. It is NOT any of: a value-returning helper, an early `return null`/`return value` inside a `.map`/handler, or an inline hint nested inside a live control. The following enumerated sites are confirmed LOGIC (not render branches) and MUST stay untouched:
- `events.$eventId.index.tsx:76` `if (trimmed.length === 0) return 'friend'` — name helper.
- `events.$eventId.index.tsx:109` `if (rounds.length === 0) return 'No rounds scheduled'` — returns a STRING for a summary line, not an empty-state render.
- `admin.events.$eventId.pairings.tsx:168` `if (filled.length === 0) return null` — render guard inside a map.
- `events.$eventId.gallery.tsx:137` `if (!files || files.length === 0) return` — early return in an upload handler.
- `rounds.$roundId.score-entry.tsx:924` (`matches.length === 0 || dismissed …`) and `:1009` (`if (members.length === 0) return filled`) — both logic, not state UI.
- `admin.groups.$groupId.edit.tsx:408` ghin-search `results.length === 0` — inline "no results" hint inside a live search dropdown; KEEP as-is (it is not a page-level empty state and EmptyState's card framing would be wrong inside a dropdown). Documented exclusion.

### 3. Tests may assert old literal copy — update them to a STABLE primitive contract

Several routes have colocated `.test.tsx` that may assert the OLD text (e.g., `'Loading…'`, `"Couldn't load pairings."`) or the old DOM shape. Migrating changes the rendered markup. Any test that breaks is updated in the SAME story to the following **stable assertion contract** (chosen to avoid brittleness against the primitives' default copy):
- Loading → `getByRole('status')` (LoadingCard renders `role="status"`). Assert the message text only when the route passes a non-default `message`.
- Error → `getByRole('alert')` (ErrorCard renders `role="alert"`). Assert the message text only when the route passes a fixed copy string (not the extracted error).
- Empty → query by the `EmptyState` `title` text the route supplies (it is route-authored, hence stable).
Tests are NOT deleted to make them pass; they are re-pointed. Where a route previously had NO test for a state branch, do not invent broad new tests — at most add one role-based assertion if it strengthens coverage cheaply.

### 4. Preserve behavior + context (concrete copy rule — no invention)

Primitive contracts VERIFIED against source (`components/{loading-card,error-card,empty-state}.tsx`): `LoadingCard({message?})` → `role="status"`, default "Loading…"; `ErrorCard({error,title?,onRetry?})` → `role="alert"`, safe `extractMessage` with **string passthrough at step 2** + optional Retry button; `EmptyState({title,body?,action?})` → required `title`. The story consumes these as-is (no primitive edits — §5).

The deterministic copy + shell rule (eliminates subjectivity):
- **Shell normalization:** render each migrated state branch as `<PageShell title="<the route's title>"><Primitive …/></PageShell>`, matching the success path's shell. Many routes currently render state branches in a bare `<div><h1>Title</h1>…</div>` while the success path uses PageShell; normalizing them is the consistency win this story exists for (and gives every state the global nav, per T11-3's no-dead-end principle). Where the success path includes a `<BackLink>` AND its target params come from route params/props (not from the not-yet-loaded data), include the same `<BackLink>` in the state branch. Where the success path itself does NOT use PageShell, keep its existing wrapper and replace only the inner node.
- **Loading:** if the old branch's only text is a generic "Loading…"/"Loading", use `<LoadingCard />` (default). If it carries route-specific text (e.g. "Loading pairings…"), pass that exact text as `message`.
- **Error:** pass `error={query.error}` so `ErrorCard` extracts. If the old code rendered a FIXED user sentence (e.g. "Couldn't load pairings.") instead of the raw error, pass that exact sentence as the `error` string (step-2 passthrough) so the copy is byte-preserved. Wire `onRetry={query.refetch}` ONLY where a TanStack `refetch` is in scope; otherwise omit (no fabricated retry).
- **Empty:** carry the old empty message verbatim into `title` (or split into `title`+`body` only if the old message was clearly a heading+detail). Do not genericize.
The rule is "preserve the existing words; only the container changes" — never invent or drop copy.

### 5. What is NOT in this story

- No changes to the primitives themselves (`loading-card.tsx` / `error-card.tsx` / `empty-state.tsx`) — they are consumed as-is.
- No mobile/@media work (that is T12-2).
- No PageShell/BackLink changes (shipped in T11-3).
- No migration of the `score-entry.tsx` logic-level length checks or the in-dropdown ghin "no results" hint (§2 exclusions).

## Acceptance Criteria

For all three ACs below, the scope is fixed: the 16 route files in "Files this story will edit". Within each file, EVERY page-level state render branch (per §2's definition, found by reading the file) is migrated. The §2-enumerated logic checks are NOT migrated. There is no per-branch guessing in the spec — the implementation reads each file and migrates its actual render branches.

**AC-1: Every page-level loading render branch uses `LoadingCard`.**
**Given** any of the 16 routes that returns a whole-page/section loading fallback for its primary query
**When** that branch renders
**Then** it renders `<LoadingCard />` (or `<LoadingCard message=… />` per §4's copy rule), replacing the hand-rolled `<div>Loading…</div>` / `<p>Loading…</p>`.

**AC-2: Every page-level error render branch uses `ErrorCard`.**
**Given** any of the 16 routes that returns a whole-page/section error fallback for its primary query
**When** that branch renders
**Then** it renders `<ErrorCard error={…} onRetry={…} />` per §4 (error passthrough rule; onRetry only where a refetch is in scope), replacing the ad-hoc error `<div>` / `role="alert"` markup.

**AC-3: Every page-level empty render branch uses `EmptyState`.**
**Given** any of the 16 routes that returns a whole-page/section empty fallback (no rows/items)
**When** that branch renders
**Then** it renders `<EmptyState title=… body?=… />` carrying the existing copy verbatim per §4, replacing the bare empty message. The §2-excluded logic/length checks and the in-dropdown ghin "no results" hint are untouched.

**AC-4: No behavior or copy regression; tests re-pointed at the new contract.**
**Given** the full tournament-web suite + typecheck + lint
**When** they run after the migration
**Then** every previously-passing test passes (tests that asserted old loading/error/empty markup are updated to assert the primitive output via role/text), typecheck and lint are clean, and the passing count is ≥ the start-of-story baseline.

**AC-5: Primitive adoption is real (anti-regression check).**
**Given** the final diff
**When** grepped
**Then** `LoadingCard` / `ErrorCard` / `EmptyState` adoption is > 0 route files each (up from 0), and no migrated route still contains a hand-rolled `<div>Loading…</div>` or ad-hoc page-level error/empty `<div>` for its primary query.

**AC-6: Sprint-status flip lands atomically with the commit** (`T12-1…` → `done`, per director step 10).

## Tasks / Subtasks

1. **Baseline.** Capture start-of-story passing counts (tournament-web especially) for the AC-4 comparison.
2. **Migrate loading states (AC-1).** Per site, replace the loading branch with `<LoadingCard />`; keep PageShell wrapping.
3. **Migrate error states (AC-2).** Per site, replace with `<ErrorCard error={…} onRetry={…} />`; preserve fixed copy via string passthrough; wire onRetry only where refetch exists.
4. **Migrate empty states (AC-3).** Per included site, replace with `<EmptyState title=… />`; carry informative copy. Leave §2 exclusions untouched.
5. **Update colocated tests** that assert old markup → assert new primitive output (role + text). Add an assertion for at least one role-based query where it strengthens coverage.
6. **Verify.** `pnpm --filter @tournament/web test`, `pnpm -r typecheck`, `pnpm -r lint`, plus the other suites (engine, wolf-cup-api, tournament-api) for no-regression. Grep-confirm AC-5.

## Dev Notes

### Architectural alignment
Pure consumption of the T11-1 primitives; the design system was built for exactly this. No new abstractions. Distinguishing state-UI from logic-level length checks (§2) is the one place that needs care — it is enumerated above so the migration is mechanical, not interpretive.

### Key references
- Primitives: `apps/tournament-web/src/components/{loading-card,error-card,empty-state}.tsx`.
- T11-1 story (primitive contracts) + T11-3 (PageShell rollout that deferred this).
- ErrorCard does safe message extraction from `unknown` — pass it the raw query error.

### Risks / Followups
- **Copy drift risk:** generic primitive defaults could flatten informative messages. Mitigated by AC-3's "informative copy" rule + §4.
- **Test churn:** expected; tests are re-pointed, not deleted (§3).

## Files this story will edit

- apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.index.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx
- apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx
- apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx
- apps/tournament-web/src/routes/events.$eventId.bets.tsx
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx
- apps/tournament-web/src/routes/events.$eventId.gallery.tsx
- apps/tournament-web/src/routes/events.$eventId.index.tsx
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx
- apps/tournament-web/src/routes/events.$eventId.money.tsx
- apps/tournament-web/src/routes/events.$eventId.schedule.tsx
- apps/tournament-web/src/routes/events.$eventId.settle-up.tsx
- apps/tournament-web/src/routes/index.tsx
- apps/tournament-web/src/routes/invite.$token.tsx
- apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

Plus, for any route above whose colocated test breaks, its same-basename sibling `apps/tournament-web/src/routes/<that-route>.test.tsx` (a bounded, deterministic set — one possible test file per listed route, nothing else; every one is under `apps/tournament-web/src/routes/` = ALLOWED). Each test file actually touched is enumerated in the Dev Agent Record File List before commit. Plus `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` (status flip at step 10). **No file outside `apps/tournament-web/src/routes/**` + the tournament sprint-status is edited** — in particular the primitives in `apps/tournament-web/src/components/**` are NOT modified.

## Dev Agent Record

### Agent Model Used
claude-opus-4-7[1m] (acting as tournament-director).

### Debug Log References
- Baseline (start of story): tournament-web 325 ✓ (43 files); engine 472 ✓; wolf-cup-api 517 ✓; tournament-api 965 ✓+2 skip.
- Post-migration: tournament-web **325 ✓** (= baseline, no regression, no test deletions), typecheck PASS, lint PASS (all packages), engine/wolf-cup-api/tournament-api unchanged.
- AC-5 adoption grep: LoadingCard 0→**16**, ErrorCard 0→**15**, EmptyState 0→**9** route files; "no leftover `<p>Loading…</p>`/`>Loading…<`" grep returned empty.
- Spec codex: FIXED 6 (2 rounds; round-2 "High" sprint-status path was a verified false positive). Impl codex: FIXED 3 copy/title regressions (index "Refresh to retry."; bets em-dash/caps → verbatim single title; courses state-branch title="Course"); rerun's 2 Mediums (ErrorCard `unknown` error type) were false positives — `ErrorCardProps.error: unknown` by design + typecheck passes. Party codex: FIXED 1 High + Mediums (review-wording overclaim corrected to scope-accurate + honest-residuals).

### Completion Notes List
- Migrated 16 routes' page-level loading/error/empty render branches to LoadingCard/ErrorCard/EmptyState. State branches normalized into the route's PageShell where the success path has one (gives global nav on every state — the T11-3 no-dead-end principle); routes without a shell (index.tsx, invite.$token.tsx) kept their bare wrapper.
- Copy preserved verbatim (the words don't change, only the container). onRetry={query.refetch} wired only where a refetch is in scope and meaningful. BackLink included in state branches only where its params come from route params/props, not unloaded data.
- §2 exclusions honored (not migrated): name helper / render-guard / handler `.length===0` logic, the in-dropdown ghin "no results" hint, the admin roster `<li>` warning card, and score-entry's specialized offline/state error placeholders (loading branch only — testid `loading` preserved).
- Primitives in `components/**` were NOT modified; no API/engine/Wolf-Cup/repo-root changes; no new deps.

### File List
- apps/tournament-web/src/routes/events.$eventId.money.tsx (modified)
- apps/tournament-web/src/routes/events.$eventId.settle-up.tsx (modified)
- apps/tournament-web/src/routes/events.$eventId.bets.tsx (modified)
- apps/tournament-web/src/routes/events.$eventId.schedule.tsx (modified)
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx (modified)
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx (modified)
- apps/tournament-web/src/routes/events.$eventId.index.tsx (modified)
- apps/tournament-web/src/routes/events.$eventId.gallery.tsx (modified)
- apps/tournament-web/src/routes/index.tsx (modified)
- apps/tournament-web/src/routes/invite.$token.tsx (modified)
- apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx (modified)
- apps/tournament-web/src/routes/admin.events.$eventId.index.tsx (modified)
- apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx (modified)
- apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx (modified)
- apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx (modified)
- apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx (modified — loading branch only)
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml (status flip → done at step 10)
- _bmad-output/reviews/T12-1-*-{spec,impl,party}-codex*.md + -party-review.md (review artifacts)
- No colocated `.test.tsx` required changes (all 325 tests passed unmodified).
