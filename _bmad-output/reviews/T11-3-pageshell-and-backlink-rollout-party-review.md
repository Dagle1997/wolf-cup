# Party-Mode Review — T11-3 global nav + PageShell + BackLink rollout

**Story:** `_bmad-output/implementation-artifacts/tournament/T11-3-pageshell-and-backlink-rollout.md`
**Mode:** Non-interactive written review (per tournament-director step 8)
**Date:** 2026-05-21
**Reviewed scope:** new GlobalNav + test util + __root wiring + 18 route wraps + 9 test-file updates + spec + sprint-status flip

---

## 📊 Mary (Analyst) — Does the hybrid close both audit HIGHs?

Yes — and it closes them at the cause, not the symptom. The audit named two HIGHs that the data-model analysis proved were one: "admin pages are dead-ends on iOS standalone PWA" + "no global header/nav in __root.tsx." The GlobalNav anchor fixes the second directly (there is now a persistent home link in the root layout) and the first transitively (every non-suppressed route — including the 3 tenant-scoped library routes that have no event parent — now has a guaranteed way home regardless of how the user arrived, including deep-links where history.back() would have failed). The contextual BackLinks are the additive convenience layer on the 9 event-scoped routes. The design correctly distinguished the three navigation classes (event-scoped → contextual back; tenant-scoped library → global anchor; top-level → global anchor), so courses/rule-sets don't get a wrong-target back-link — they rely on the anchor by design. Both HIGHs are genuinely resolved, not papered over. **Verdict: both audit HIGHs closed at the root.**

## 🏗️ Winston (Architect) — Design soundness

Three architecturally-right calls. (1) GlobalNav reads `useLocation()` not `window.location.pathname` — this was a mid-spec correction and it's correct: the nav is rendered inside the router context (in __root), so the hook is available, and it makes suppression REACTIVE to client-side navigation (a raw window.location read at render wouldn't re-evaluate on SPA route changes) AND deterministically testable via memory-history. (2) The `isNavSuppressed(pathname)` pure helper is the right factoring — testable in isolation, no hook/window coupling, exact-match semantics (prefix for /auth//invite/, anchored regex for the score-entry suffix). (3) Success-branch-only PageShell wrapping is a deliberate scope-control decision: pending/error branches stay byte-for-byte, which avoids touching transient states and keeps the diff bounded. The one architectural debt this introduces — pending/error branches render WITHOUT PageShell padding while success renders WITH it — is a known, documented inconsistency (the loading/error→primitive migration is deferred wholesale to a future story). The `renderInRouter` test-util tradeoff (root-route-only, doesn't validate link destinations) is sound for page-content tests; link-resolution coverage lives in the dedicated back-link/global-nav tests. **Verdict: design is sound; the documented pending/error inconsistency is the only debt, and it's intentional + tracked.**

## 📋 John (PM) — Right scope for the largest T11 story?

Scope held despite the size. This was the biggest T11 diff (new component + __root + 18 route wraps + 2 eventId-threaded admin routes + 9 test-file updates) and it stayed disciplined: loading/error migration deferred wholesale (removed a subjective judgment call), library routes intentionally left without contextual back-links (data-model-correct, not a punt), and the 4 standalone/special routes (auth.*, invite, score-entry) untouched + suppressed. The mid-implementation discoveries were handled correctly: the back-target ambiguity was escalated to Josh (who chose the hybrid), the courses sub-component eventId-threading was a clean fix, and the unexpected apps/web/attendance.tsx change was correctly identified as a SEPARATE Wolf Cup edit (Josh committed it on its own commits 025d17b/d2c8488 — never entangled with T11-3). The 2 eventId-threaded admin routes verified the parent eventId was actually in their response types before threading (group.eventId / data.eventRound.eventId) rather than fabricating. **Verdict: large but correctly scoped; escalations + discoveries handled with discipline.**

## 🧪 Quinn (QA) — Test coverage adequacy

Coverage is solid for the change shape. GlobalNav's 12 tests cover the matrix that matters: authenticated render (home + account), anonymous (home only), suppression on all three path classes (/auth/, /invite/, score-entry), a non-suppressed event path, the AC-6a styling assertions (sticky/top/z-index/token-border), AND the `isNavSuppressed` pure helper with the critical near-misses (`/rounds/abc/score-entry/extra` must NOT suppress; `/authx/` must NOT match). The `renderInRouter` fix for the 39 broken tests is the right call — those tests broke because BackLink's `<Link>` needs router context, and the util provides exactly that without forcing 9 files to each build a router harness; the sentinel-await pattern (from the global-nav test) handles the router's async render. The honest coverage gap: the success-branch-only wrap means there's no test asserting the pending/error branches stayed un-wrapped (they just keep passing their existing assertions), and the page-content tests don't validate the BackLink's resolved href (intentional — that's back-link.test's job). Neither gap is load-bearing. The full suite is green (325) with no regressions across engine/wolf-api/tournament-api. **Verdict: adequate; the two gaps are intentional and documented.**

## 💻 Amelia (Dev) — Mechanical correctness across 18 routes

Wraps are correct. The uniform pattern (open `<div>`/`<header>`+`<h1>` → `<PageShell title>`+`<BackLink>`; close matching `</div>` → `</PageShell>`) held across the simple event-scoped pages. The non-uniform ones were handled with care: (1) courses.$courseId — the success render lives in the `CoursePreviewView` sub-component which didn't receive eventId; threading it as a prop (`CoursePreviewView({ data, eventId })` + caller passes it) was the correct fix, caught by typecheck. (2) gallery — the tricky one: a paddingBottom:96 outer div (FAB clearance) + a `<header>` with h1+count; the wrap kept the paddingBottom as an inner div inside PageShell and preserved the count subtitle while removing the header/h1 — close tags balance (verified: extra inner `</div>` before `</PageShell>`). (3) admin.events.new — two renders (success "Event created!" + wizard "New Event") both wrapped. (4) the eventId-threaded admin routes use the verified response-type fields. z-index: nav 1000 sits below toast 1100 + install 1200 (correct); the gallery FAB tie at 1000 has no spatial overlap. typecheck + lint clean confirms no dead imports / broken JSX across all 18. **One nit (non-blocking, documented):** pending/error branches now render without PageShell padding — visually inconsistent with success until the deferred migration. **Verdict: mechanically correct; the tricky wraps (courses sub-component, gallery FAB) were handled right.**

---

## Open Questions for User

**None.** The one design decision that needed input (back-target strategy → hybrid) was escalated and resolved by Josh during spec authoring. The execution-scope decision (push through all 18 vs descope) was also Josh's call. The apps/web/attendance.tsx tree-state question was resolved (Josh committed it separately). No open questions remain at review time.

---

## Summary verdict

**GO** — both audit HIGHs closed at the root (global nav anchor + contextual back-links), 18 routes wrapped, all suites green (engine 472, wolf-cup-api 517, tournament-api 965+2sk, tournament-web 313→325), typecheck + lint clean root-wide.

**Main risks:**
1. Pending/error branches render without PageShell padding (success-branch-only wrap) — documented visual inconsistency; loading/error→primitive migration deferred wholesale to a future story.
2. `renderInRouter` test util doesn't validate BackLink href resolution (page-content tests only) — intentional; link behavior covered by back-link.test/global-nav.test.
3. GlobalNav suppression is pathname-prefix based — a future route under `/auth/`, `/invite/`, or matching the score-entry regex would be auto-suppressed; prefixes are specific enough that this is low-risk + documented.
4. Gallery FAB z-index ties the nav (1000) — no spatial overlap today; bump to 1050 if an overlap edge case ever surfaces.
5. T11-3 is the third pass over these same routes (T11-2 auth, T11-3 nav) — kept mechanically separable so a bisect can isolate either; future loading/error migration will be a fourth pass.
