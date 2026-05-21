# T11-3: Global Nav + PageShell + Contextual BackLink Rollout

## Status

done

## Story

As a tournament-web user (organizer or player) on an iOS standalone PWA — where there is NO browser chrome, no address bar, and often no usable back-gesture on deep-links — I want every authenticated content page to have (a) a persistent global home/account anchor and (b) a contextual back-link where a parent page exists, so I am never stranded on a dead-end page with no way to navigate. As a tournament-web contributor, I want the routes wrapped in the T11-1 `PageShell` primitive so page padding/title/max-width are consistent instead of 23 different ad-hoc `<div style={{padding:N}}>` treatments.

This is the third and final T11 foundation pass (T11-1 primitives, T11-2 auth dedup, T11-3 this rollout) and the first with end-user-visible payoff. It closes BOTH audit HIGH findings together: "admin pages are dead-ends on iOS standalone PWA" AND "no global header/nav in __root.tsx" — which the data model proves are the same problem (see Risk Acceptance §2).

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only

Every file classifies into `apps/tournament-web/**` + `_bmad-output/implementation-artifacts/tournament/**`. No SHARED, no FORBIDDEN, no deps, no API changes. The one T11-1 primitive touch (`back-link.tsx` is NOT modified; a NEW `global-nav.tsx` component is added) stays in tournament-web.

### 2. Why "global nav anchor" not just "per-route BackLinks" (the architecture decision, Josh 2026-05-21)

The audit flagged two HIGHs that are the same root cause: dead-end admin pages + no global nav. Per-route BackLinks alone CANNOT fix it, because the data model has three navigation classes:

- **Event-scoped routes** (all `events.$eventId.*`, plus admin `groups`/`event-rounds`/`pairings`): a contextual parent exists → a real `BackLink` to the event (home or admin) is correct.
- **Tenant-scoped library routes** (`admin.rule-sets.$id.edit`, `admin.courses.new`, `admin.courses.upload`): these entities are NOT children of any single event (rule_sets + courses carry `contextId: 'library:guyan…'` and are shared across events). There is NO correct event back-target to construct. Their correct "up" is an admin/home hub.
- **Top-level routes** (`index`, `me`, `profile`): already at the top; "up" is home.

`window.history.back()` is the WORST option precisely for the audited scenario: on an iOS standalone PWA opening a deep-link (notification, bookmark, shared URL), there is frequently no history entry to pop — the dead-end persists.

**Therefore: a persistent global home/account anchor in `__root.tsx` is the universal escape hatch** that works on every route regardless of how the user arrived, and contextual BackLinks are an ADDITIVE convenience on event-scoped routes. The library routes (courses/rule-sets) rely on the global anchor by design, not by punt.

### 3. New component: `global-nav.tsx`

`apps/tournament-web/src/components/global-nav.tsx` — a thin persistent top bar rendered in `__root.tsx` above `<Outlet/>`.

- Reads `useAuthSession()` (the SHARED `['auth-status']` query — already consumed by InstallPromptHost, zero extra network).
- **Render rule (clarified per codex H#1):** on any NON-suppressed route the nav ALWAYS renders the left-aligned "🏌️ Tournament" home link (`<Link to="/">`), regardless of auth state. The right-aligned account link (`<Link to="/me">` with a generic "Account" label — NOT the player name, which the shared auth-status doesn't carry) renders ONLY when `player !== null`. So: anonymous on a non-suppressed route → home link only (no account link). Authenticated → home + account. There is no "render nothing at all because anonymous" case — anonymous still gets the home anchor. The ONLY full-`null` case is the suppression gate below.
- **Suppression gate (clarified per codex H#2):** the nav returns `null` (renders nothing) when `window.location.pathname` matches ANY of these — matched precisely, not loosely:
  - **prefix match** `pathname.startsWith('/auth/')` → covers `auth.conflict`, `auth.declined`
  - **prefix match** `pathname.startsWith('/invite/')` → covers `invite.$token`
  - **regex match** `/^\/rounds\/[^/]+\/score-entry\/?$/.test(pathname)` → covers `rounds.$roundId.score-entry` (score-entry is a SUFFIX after a dynamic roundId, NOT a prefix — a plain startsWith won't work; the regex anchors both ends with an optional trailing slash)
  - **Pathname source (revised per codex rerun M#2):** GlobalNav reads the pathname from TanStack Router's `useLocation()` hook (`const { pathname } = useLocation()`), NOT `window.location.pathname`. Rationale: (a) GlobalNav is rendered INSIDE the router context (in `__root.tsx`), so the router hook is available; (b) it's REACTIVE — the nav re-evaluates suppression on every client-side route change (a raw `window.location.pathname` read at render is NOT reactive to SPA navigation and could leave the nav showing on a route it should suppress until an unrelated re-render); (c) it's deterministically testable — the test harness's `createMemoryHistory({ initialEntries: [path] })` drives `useLocation()`, whereas it does NOT update jsdom's `window.location.pathname`. This diverges from InstallPromptHost's `window.location` approach deliberately: InstallPromptHost is a fire-on-mount effect, GlobalNav is a persistent reactive surface.
  - A helper `function isNavSuppressed(pathname: string): boolean` encapsulates the three checks as a PURE function (takes the pathname string, no hook/window dependency) and is unit-tested directly with literal strings incl. a near-miss (`/rounds/abc/score-entry/extra` must NOT suppress). The component calls `isNavSuppressed(useLocation().pathname)`.
- Uses T11-1 tokens (`--color-border-subtle` bottom border, `--color-text-primary` link, `--font-sm`, `--page-padding` horizontal).
- Sticky-top via `position: sticky; top: 0; z-index: 1000` (BELOW the install prompt's 1200 + toast's 1100, so those overlays still cover the nav).

### 4. PageShell rollout per-route table

| Route | PageShell? | title | BackLink target | Notes |
|---|---|---|---|---|
| `index.tsx` | No | — | — | The home landing itself; global nav's home link points here. Leave layout as-is. |
| `me.tsx` | Yes | `Your account` | — (global nav) | Top-level; no contextual parent. |
| `profile.tsx` | Yes | `Your profile` | — (global nav) | T11-2 left its auth loader local; T11-3 wraps JSX only — independent concern. |
| `events.$eventId.index.tsx` | Yes | event name (loaded) | — (global nav) | Event home; "up" is global home. Async title — see §6a. |
| `events.$eventId.leaderboard.tsx` | Yes | `Leaderboard` | `/events/$eventId` | Event-scoped → back to event home. |
| `events.$eventId.money.tsx` | Yes | `Money` | `/events/$eventId` | |
| `events.$eventId.settle-up.tsx` | Yes | `Settle Up` | `/events/$eventId` | |
| `events.$eventId.bets.tsx` | Yes | `Bets` | `/events/$eventId` | |
| `events.$eventId.gallery.tsx` | Yes | `Gallery` | `/events/$eventId` | |
| `events.$eventId.schedule.tsx` | Yes | `Schedule` | `/events/$eventId` | |
| `events.$eventId.courses.$courseId.tsx` | Yes | `Course` (or course name) | `/events/$eventId/schedule` | Reached from schedule; back there. |
| `admin.events.$eventId.index.tsx` | Yes | `Admin — {event name}` | `/events/$eventId` | Already had an inline back link; formalize via BackLink. |
| `admin.events.$eventId.pairings.tsx` | Yes | `Pairings — {event name}` | `/admin/events/$eventId` | Back to event admin. |
| `admin.events.new.tsx` | Yes | `New event` (wizard) → `Event created!` (after the create mutation succeeds, gated on the same success-state flag the component already uses to swap its body) | — (global nav) | Wizard; no eventId until created. Success screen keeps its existing links. Title switches on the component's existing post-create success state, not a new flag. |
| `admin.groups.$groupId.edit.tsx` | Yes | group name | `/admin/events/$eventId` (threaded) | eventId derived from admin-context (see §5). |
| `admin.event-rounds.$eventRoundId.sub-games.tsx` | Yes | `Sub-game setup — Round N` | `/admin/events/$eventId` (threaded) | eventId derived from admin-context (see §5). |
| `admin.rule-sets.$id.edit.tsx` | Yes | rule-set name | — (global nav; library entity) | Tenant-scoped, no event parent. |
| `admin.courses.new.tsx` | Yes | `New course` | — (global nav; library entity) | Tenant-scoped. |
| `admin.courses.upload.tsx` | Yes | `Upload course PDF` | — (global nav; library entity) | Tenant-scoped. |
| `auth.conflict.tsx` | No | — | — | Pre-auth standalone; global nav suppressed. Leave as-is. |
| `auth.declined.tsx` | No | — | — | Pre-auth standalone. Leave as-is. |
| `invite.$token.tsx` | No | — | — | Standalone invite-claim flow. Leave as-is. |
| `rounds.$roundId.score-entry.tsx` | No | — | — | Full-screen scorer UI; global nav suppressed; do NOT wrap. |

Net: 18 routes get PageShell; 9 get contextual BackLinks (7 event-scoped player pages + 2 admin event-scoped); 2 admin routes get threaded-eventId BackLinks; 3 library routes + 3 top-level rely on global nav; 4 standalone/special routes untouched.

### 5. Threading eventId into the 2 sub-entity admin routes

`admin.groups.$groupId.edit` and `admin.event-rounds.$eventRoundId.sub-games` already fetch an admin-context for their entity. The spec requires VERIFYING (subtask) that each fetch's response includes the parent `eventId` (or an `event.id`). If present, thread it into the loaded data and construct `BackLink to="/admin/events/$eventId" params={{eventId}}`. If a route's API does NOT return the parent eventId, that route falls back to the library-route treatment (PageShell, no BackLink, rely on global nav) and a followup is logged to add eventId to that endpoint. Do NOT fabricate or guess the eventId.

### 6. PageShell wrap mechanics

Each wrapped route replaces its outermost content `<div style={{padding:N}}>` (or equivalent) with `<PageShell title={...} actions={...}>`. The route's existing top-level `<h1>` is REMOVED (PageShell renders the title as its `<h1>`). BackLink renders INSIDE PageShell as the first child (above the header), so it sits at the top of the page content.

**Loading/error states are OUT OF SCOPE for T11-3 (tightened per codex M#5).** Do NOT migrate any `<div>Loading…</div>` or hand-rolled error card to LoadingCard/ErrorCard in this story — that migration is deferred wholesale to a future story (a followup is logged). T11-3's load-bearing change is global nav + PageShell + BackLink ONLY. This removes the subjective "low-risk and obvious" judgment entirely: leave every existing loading/empty/error state exactly as-is.

### 6a. Dynamic (async-loaded) titles

Several routes title on data that loads async (event name, group name, "Round N", course name). Every such route ALREADY gates its render on `query.isPending` / `isError` (they show a loading state before the data resolves). The PageShell wrap goes in the SAME place as the existing loaded-content render — i.e., PageShell with the dynamic title is rendered ONLY in the success branch where the data is already available. The pending/error branches keep their existing (un-wrapped, un-migrated per §6) treatment. Therefore PageShell's `title` is ALWAYS a resolved string at render time — no placeholder/undefined-title case exists. For routes with a STATIC title (`me`, `profile`, `Leaderboard`, `Money`, etc.), the title is a literal and PageShell wraps the whole component body.

### 7. What is NOT in this story

- No changes to the T11-1 primitives themselves (PageShell/BackLink/LoadingCard/EmptyState/ErrorCard are consumed as-is; a NEW global-nav.tsx is added).
- No API changes. If a sub-entity endpoint lacks the parent eventId, that's a followup, not an API edit this story.
- NO migration of ANY loading/empty/error state to the T11-1 primitives (deferred wholesale per §6 + codex M#5). Existing states stay byte-for-byte.
- No dark-mode, no mobile `@media` (separate future sweep).
- No re-litigation of T11-2's profile.tsx auth-loader exception (T11-3 wraps profile's JSX in PageShell, which is independent of its auth loader).
- score-entry, auth.*, invite stay untouched (§3 visibility gate + §4 table).

## Acceptance Criteria

**AC-1: global-nav.tsx exists with the documented behavior.**

**Given** `apps/tournament-web/src/components/global-nav.tsx`
**When** rendered with an authenticated session (`useAuthSession` → player non-null) on an event route path
**Then** it renders a home link (`<Link to="/">`) AND a right-aligned account link (`<Link to="/me">`)
**And** when player is null, it renders the home link but NO account link
**And** when the current pathname matches a suppressed prefix (`/auth/`, `/invite/`, or a `/rounds/{id}/score-entry` path), it renders `null`

**AC-2: __root.tsx renders GlobalNav above the Outlet.**

**Given** `apps/tournament-web/src/routes/__root.tsx`
**When** parsed
**Then** `<GlobalNav />` is rendered inside RootComponent's tree, before `<Outlet />`
**And** the existing InstallPromptHost / TournamentToast / TournamentBanner / AwardCelebration hosts are unchanged

**AC-3: The 18 PageShell-wrapped routes use the primitive, titled by the verbatim-h1 rule.**

**Title rule (simplification per codex rerun L#3, removes all per-route title ambiguity):** `PageShell title` = the EXACT string the route's removed top-level `<h1>` was rendering in its loaded/success branch. The §4 table's title column is informative (it documents what that h1 currently says); the normative rule is "use the route's existing h1 text." For `events.$eventId.courses.$courseId`, that means whatever the route's current h1 renders (e.g. the course name if it interpolates one, else the literal "Course").

**Given** each route in the §4 table marked "PageShell? Yes"
**When** parsed
**Then** the route's loaded/success-branch content is wrapped in `<PageShell title={...}>` (title = the former h1's string per the rule above)
**And** in that success branch, the route no longer has a standalone outer `<div style={{padding:N}}>` for the main content (PageShell owns padding)
**And** the route's former top-level `<h1>` is removed from that branch (PageShell renders it)
**And** (per §6a + codex rerun M#1) the route's PENDING and ERROR branches are LEFT UNCHANGED — they keep their existing outer div / h1 / loading text byte-for-byte; only the success/loaded branch is wrapped. AC-3's "no outer padding div" + "h1 removed" assertions apply ONLY to the success branch, not the pending/error branches.

**AC-4: The 9 event-scoped routes render a contextual BackLink to the correct parent.**

**Given** the event-scoped routes in the §4 table with a BackLink target
**When** parsed
**Then** each renders `<BackLink to={...} params={...}>` with the table's target
**And** the 2 sub-entity admin routes (groups, event-rounds) thread the parent eventId from their admin-context fetch (or fall back to no-BackLink + followup per §5 if the API lacks it)

**AC-5: Library + top-level + standalone routes are handled per the table.**

**Given** `admin.rule-sets.$id.edit`, `admin.courses.new`, `admin.courses.upload` (library) and `index`, `me`, `profile` (top-level)
**When** parsed
**Then** none renders a contextual BackLink (they rely on global nav)
**And** `auth.conflict`, `auth.declined`, `invite.$token`, `rounds.$roundId.score-entry` are UNCHANGED by this story (no PageShell, no BackLink, no nav — global nav suppresses itself on their paths)

**AC-6: global-nav.tsx has a test covering render + suppression + auth states.**

**Given** `apps/tournament-web/src/components/global-nav.test.tsx` (NEW)
**When** `pnpm --filter @tournament/web test` runs
**Then** tests cover: authenticated render (home + account links), anonymous render (home only, NO account link), suppression on `/auth/...` + `/invite/...` + `/rounds/{id}/score-entry` paths (renders null), AND a non-suppressed event path (renders the nav). The component test drives the path via `createMemoryHistory({ initialEntries: [path] })` (which feeds `useLocation()` — NOT jsdom's window.location) + a `useAuthSession` mock (vi.mock the hook to return `{player: ...}` / `{player: null}`). The `isNavSuppressed(pathname)` PURE helper is ALSO unit-tested directly with literal path strings incl. a near-miss like `/rounds/abc/score-entry/extra` that must NOT suppress (and `/authx/...` that must NOT match the `/auth/` prefix).

**AC-6a: GlobalNav styling is asserted (per codex L#6).**

**Given** the rendered GlobalNav on a non-suppressed authenticated route
**When** the root element is inspected in the test
**Then** it has `position: sticky`, `top: 0`, and `z-index: 1000` (below the install-prompt 1200 + toast 1100 overlays)
**And** consumes T11-1 tokens (the test asserts at least one token-consumption point — e.g. the bar's `borderBottom` references `var(--color-border-subtle)` OR the home link's `color` references `var(--color-text-primary)` — to lock the design-token dependency).

**Implementation note (per codex rerun L#5):** GlobalNav applies its styling via inline `style={{}}` props (consistent with the T11-1 PageShell/BackLink/LoadingCard/EmptyState/ErrorCard primitives, which all use inline styles). This makes the AC-6a assertions readable via `element.style.position` / `element.style.zIndex` / `element.style.borderBottom` in the test — no computed-style/CSS-file resolution needed.

**AC-7: No regression + typecheck + lint clean.**

**Given** the full regression set
**When** all suites + `pnpm -r typecheck` + `pnpm -r lint` run
**Then** every previously-passing test still passes (no count drop in any suite)
**And** tournament-web's count increases by the new global-nav tests
**And** typecheck + lint exit 0
**And** any route whose existing test asserted on its old `<h1>` / padding structure is updated to match the PageShell structure (these test updates are part of this story; enumerate them in Completion Notes)

**AC-8: Sprint-status flip lands atomically with the commit.**

**Given** the commit produced by step 10
**When** inspected
**Then** `sprint-status.yaml` has `T11-3-pageshell-and-backlink-rollout: done` and no other story's status changed.

## Tasks / Subtasks

1. **GlobalNav component + test**
   1.1. Create `apps/tournament-web/src/components/global-nav.tsx` per §3.
   1.2. Create `apps/tournament-web/src/components/global-nav.test.tsx` per AC-6.

2. **Wire GlobalNav into __root.tsx**
   2.1. Render `<GlobalNav />` before `<Outlet />` in RootComponent.

3. **Event-scoped player routes (7 + event home)**
   3.1–3.8. Wrap each `events.$eventId.*` route in PageShell + add BackLink to event home (or schedule for courses.$courseId). Event home (`events.$eventId.index`) gets PageShell, no BackLink.

4. **Admin event-scoped routes**
   4.1. `admin.events.$eventId.index`: PageShell + BackLink to `/events/$eventId` (replace the existing inline back link).
   4.2. `admin.events.$eventId.pairings`: PageShell + BackLink to `/admin/events/$eventId`.
   4.3. `admin.events.new`: PageShell, no BackLink.

5. **Admin sub-entity routes (thread eventId)**
   5.1. Verify `admin.groups.$groupId.edit`'s admin-context fetch returns the parent eventId; if so, BackLink to `/admin/events/$eventId`; else PageShell-only + followup.
   5.2. Same for `admin.event-rounds.$eventRoundId.sub-games`.

6. **Admin library routes (PageShell, no BackLink)**
   6.1. `admin.rule-sets.$id.edit`, `admin.courses.new`, `admin.courses.upload`: PageShell wrap, rely on global nav.

7. **Top-level routes**
   7.1. `me`, `profile`: PageShell wrap, no BackLink.

8. **Test updates**
   8.1. Run the tournament-web suite; any route test that asserts on the old `<h1>`/padding structure gets updated to the PageShell structure. Enumerate in Completion Notes.

9. **Verify**
   9.1. Full regression set + typecheck + lint per AC-7. Record counts + per-route test updates in Completion Notes.

## Dev Notes

### Architectural alignment

T11-3 closes both audit HIGHs (dead-ends + no global nav) with the hybrid: a universal global anchor + additive contextual BackLinks. The data-model split (event-scoped vs tenant-scoped library vs top-level) is the load-bearing reasoning — library routes (courses/rule-sets) intentionally have NO contextual back-link because they have no single parent event; the global nav is their correct "up". This was an explicit Josh decision (2026-05-21).

### Key references

- T11-1 primitives: `components/{page-shell,back-link,loading-card,empty-state,error-card}.tsx`.
- `__root.tsx` InstallPromptHost: the pathname-matching pattern (`extractEventIdFromLocation`) the GlobalNav suppression mirrors.
- back-link.test.tsx: the TanStack Router test harness GlobalNav's test reuses.
- use-auth-session.ts: `useAuthSession()` the GlobalNav reads (shared cache).

### Risks / Followups

- **Followup: sub-entity endpoints lacking parent eventId.** If §5 verification finds `admin.groups.$groupId.edit` or `admin.event-rounds.$eventRoundId.sub-games`'s API doesn't return the parent eventId, those routes ship PageShell-only and a followup logs adding eventId to the endpoint (tournament-api change, separate story).
- **Followup: loading/empty/error state migration (deferred wholesale).** T11-3 migrates ZERO loading/empty/error states to LoadingCard/EmptyState/ErrorCard (per §6 + codex M#5 — removed the subjective "low-risk obvious" judgment). A dedicated future story migrates them across all routes once the PageShell rollout has settled. **Note (party-codex sharpening):** because only the success branch is PageShell-wrapped, a route transitioning pending→success changes its outer padding/max-width — this is a LAYOUT SHIFT (content reflows), not merely a static visual inconsistency. The deferred migration should wrap pending/error in PageShell too (with the same title) to eliminate the shift.
- **Impl-codex findings (all non-blocking, accepted):**
  - (M) `render-in-router.tsx` registers only a root route, so the page-component tests get router CONTEXT but do NOT validate BackLink `to`/`params` resolution. Intentional: those tests assert page CONTENT; `back-link.test.tsx` + `global-nav.test.tsx` register real routes and validate Link behavior. A future enhancement could register the common `to` targets in the shared harness for stronger link-resolution coverage.
  - (L) GlobalNav suppression doesn't match a bare `/auth` or `/invite` (no trailing slash). Non-issue: the real routes are `/auth/conflict`, `/auth/declined`, `/invite/$token` — all carry a trailing segment, so the `/auth/` + `/invite/` prefix matches always fire.
  - (L) Gallery FAB z-index (1000) ties GlobalNav (1000). No spatial overlap (FAB is fixed bottom-right; nav is sticky top), so no visual bug; the gallery lightbox (1100) correctly layers above the nav. Could bump the FAB to 1050 in a future tidy if any overlap edge case surfaces.
- **Risk acceptance:** large diff (~20 route files + __root + new component + test updates). Each route change is small but the aggregate is big. Codex impl review should sample several route diffs + focus on global-nav.tsx + __root.tsx (the substantive new code).
- **Risk acceptance:** GlobalNav uses pathname-matching for suppression (not router context) to stay a pure leaf in the root layout. If a future route uses a path shape that accidentally matches a suppression prefix, the nav would wrongly hide — the suppression prefixes are specific enough (`/auth/`, `/invite/`, score-entry) that this is low-risk, but documented.

## Files this story will edit

- apps/tournament-web/src/components/global-nav.tsx
- apps/tournament-web/src/components/global-nav.test.tsx
- apps/tournament-web/src/routes/__root.tsx
- apps/tournament-web/src/routes/me.tsx
- apps/tournament-web/src/routes/profile.tsx
- apps/tournament-web/src/routes/events.$eventId.index.tsx
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx
- apps/tournament-web/src/routes/events.$eventId.money.tsx
- apps/tournament-web/src/routes/events.$eventId.settle-up.tsx
- apps/tournament-web/src/routes/events.$eventId.bets.tsx
- apps/tournament-web/src/routes/events.$eventId.gallery.tsx
- apps/tournament-web/src/routes/events.$eventId.schedule.tsx
- apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.index.tsx
- apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx
- apps/tournament-web/src/routes/admin.events.new.tsx
- apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx
- apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx
- apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx
- apps/tournament-web/src/routes/admin.courses.new.tsx
- apps/tournament-web/src/routes/admin.courses.upload.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

22 files (1 new component + 1 new test + __root + 18 route wraps + sprint-status). Plus route-test files updated per AC-7 step 8 (count TBD during dev; appended before commit). Additional files only under `apps/tournament-web/**`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director).

### Debug Log References

(to be populated during dev-story + codex passes)

### Completion Notes List

(to be populated during dev-story)

### File List

(to be populated during dev-story)
