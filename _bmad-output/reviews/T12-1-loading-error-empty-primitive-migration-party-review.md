# T12-1 Party-Mode Review — Loading/Error/Empty Primitive Migration

Single non-interactive written review (analyst, architect, pm, qa, dev). No open
questions — see "Verdict."

**Subject:** 16 tournament-web routes migrated from hand-rolled loading/error/empty
states to the T11-1 primitives (LoadingCard / ErrorCard / EmptyState) — every in-scope
page-level state branch, with score-entry's specialized error placeholders intentionally
excluded (loading branch only) per spec §5. State branches
normalized into the route's PageShell where one exists; copy preserved verbatim;
onRetry wired to query.refetch where in scope. Tests: tournament-web 325 ✓ (= baseline),
engine 472 ✓, wolf-cup-api 517 ✓, tournament-api 965 ✓+2 skip; typecheck + lint clean.
Adoption 0→16 (LoadingCard) / 0→15 (ErrorCard) / 0→9 (EmptyState).

---

## Analyst
The story's intent — retire the ~16-route patchwork of hand-rolled state UI in favor of
the design-system primitives T11-1 built for exactly this — is met for all IN-SCOPE
branches. The migration was driven by per-file inspection (not grep alone), and the §2
logic-vs-render-branch distinction held: confirmed-logic checks (name helper, render
guards, in-dropdown ghin hint, the admin roster `<li>` warning) were correctly left
untouched. **Intentional exclusion (per spec §5):** score-entry's specialized offline/
state error placeholders (`offline-no-cache`, `not-in-round`, `round_state_missing`, …)
were NOT migrated — only its loading branch was — because they are testid-coupled, copy-
specific, and outside AC-2's listed sites. So the accurate claim is "every in-scope page-
level state branch migrated," NOT "every branch in every file." Evidence basis: the
post-migration adoption grep (0→16/15/9) and the "no leftover `<p>Loading…</p>`" grep
returning empty, both run during implementation (Debug Log in the story file).

## Architect
Pure consumption of the primitives; zero changes to `components/**`. The shell-
normalization decision (wrap state branches in the route's PageShell) is architecturally
sound — it gives every state the global nav, closing the iOS-PWA dead-end class T11-3
targeted, and unifies the visual frame. The data-dependency nuance (omit BackLink / use a
static title where the success path's title/params come from not-yet-loaded data) is
handled correctly per-file rather than forced uniformly. Routes without a shell
(index.tsx, invite.$token.tsx) correctly kept their bare wrapper.

## PM
Scope held exactly: 16 routes, no sibling-file creep, primitives untouched, no API/engine
/Wolf-Cup changes. The two minor copy regressions surfaced by codex (index "Refresh to
retry."; bets em-dash/caps) were corrected to verbatim, and the courses heading was
restored — so the "preserve the words, change only the container" rule is satisfied with
no user-visible copy loss.

## QA
Strong outcome: the entire suite stayed green at the baseline count with no test deletions
— the preserved copy + additive ARIA roles (status/alert) meant existing assertions still
hold, and the role-based contract is now available for future tests. The ErrorCard
`error={query.error}` pattern is type-safe (ErrorCard's prop is `error: unknown` by
design; extractMessage never throws and falls through to a literal for null/undefined),
and typecheck passes — so codex's "unknown error type" flag is a non-issue here. score-
entry's risk was correctly bounded to its loading branch only (data-testid preserved),
leaving its specialized offline/state placeholders and their tests untouched.

## Dev
Edits are uniform and readable; imports are all consumed (no unused-import lint hits).
The one inherent asymmetry — player routes carry a contextual BackLink in state branches
while some admin routes don't — is justified by data-availability and documented. Line-
level copy was preserved including apostrophes (rendered as plain `'` inside JSX string
props, which is correct — the old `&apos;` was only needed in JSX text nodes).

---

## Verdict
**PASS — no open questions, no required changes.** The migration meets all ACs:
every in-scope page-level state branch across the 16 routes now renders via the T11-1
primitives (score-entry error placeholders intentionally excluded per spec §5), copy is
preserved verbatim (post-fix), the scope guard held (no sibling files, primitives
untouched), and the full regression suite is green at baseline. Proceed to commit with
status `done`.

Honest residuals (accepted, not papered over):
- **Intentional behavior change, not purely cosmetic:** state branches now render inside
  PageShell, so loading/error/empty states gain the global nav frame they previously
  lacked. This is the deliberate consistency/no-dead-end improvement (T11-3 principle),
  not a no-op — but it changes no data flow, route contract, or query behavior.
- **BackLink asymmetry:** player routes carry a contextual BackLink in state branches;
  some admin routes omit it because their BackLink params derive from not-yet-loaded data.
  Justified by data availability; global nav still covers up-navigation in those states.
- **score-entry partial scope:** only its loading branch migrated; its error placeholders
  remain hand-rolled by design.
- **ErrorCard error-type:** `error={query.error}` is type-safe — ErrorCard's prop is
  `error: unknown` (component source) and `extractMessage` never throws; the full repo
  typecheck passes, so this is verified, not assumed.
