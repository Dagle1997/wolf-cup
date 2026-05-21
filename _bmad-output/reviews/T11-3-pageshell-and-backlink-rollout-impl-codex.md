# Codex Review

- Generated: 2026-05-21T15:42:47.941Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/components/global-nav.tsx, apps/tournament-web/src/components/global-nav.test.tsx, apps/tournament-web/src/routes/__root.tsx, apps/tournament-web/src/test-utils/render-in-router.tsx, apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx, apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx, apps/tournament-web/src/routes/events.$eventId.gallery.tsx, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/admin.events.$eventId.index.tsx, apps/tournament-web/src/routes/admin.events.new.tsx, apps/tournament-web/src/routes/events.$eventId.money.test.tsx

## Summary

Implementation largely matches the described rollout: GlobalNav is rendered at root and gated by a pure `isNavSuppressed` helper (with good unit coverage), and the reviewed routes’ success branches are wrapped in `PageShell` with contextual `BackLink`s using the threaded `eventId` sources shown in response types.

Main concerns are around the new `renderInRouter` test harness being too permissive (it doesn’t register any of the `to="/events/$eventId"`-style routes), which can allow tests to pass without exercising real TanStack Router link resolution, and a couple of edge-case mismatches (suppression for `/auth` or `/invite` without trailing slash; overlay z-index ties with the new sticky nav).

Overall risk: low

## Findings

1. [medium] renderInRouter route tree is too minimal to validate BackLink/Link destinations (can mask broken `to`/params in tests)
   - File: apps/tournament-web/src/test-utils/render-in-router.tsx:24-31
   - Confidence: medium
   - Why it matters: `renderInRouter` creates a router with only a root route and no children. Components under test that render TanStack `<Link>` with route-template paths (e.g. `to="/events/$eventId"` plus `params`) are not being exercised against a route tree that actually contains those paths. This can let page tests pass even if a `to` string is mistyped or points at a non-existent route (the test won’t fail unless it asserts the resolved `href` or Link throws in this configuration). In other words, the new helper provides router context but weakens detection of broken navigation wiring—precisely the kind of regression this rollout is about.
   - Suggested fix: Consider enhancing `renderInRouter` to register a minimal set of route stubs for the commonly-used BackLink destinations (e.g. `/events/$eventId`, `/events/$eventId/schedule`, `/admin/events/$eventId`, etc.), or make `renderInRouter` accept a `routeTree`/routes parameter so each test file can supply the relevant route templates. Also add at least one assertion-based test that the BackLink renders the expected `href` for a representative page.

2. [low] GlobalNav suppression does not cover exact `/auth` or `/invite` (no trailing slash)
   - File: apps/tournament-web/src/components/global-nav.tsx:32-36
   - Confidence: high
   - Why it matters: `isNavSuppressed` only suppresses when `pathname.startsWith('/auth/')` or `pathname.startsWith('/invite/')`. If a future route (or redirect landing) uses `/auth` or `/invite` without a trailing slash, the global nav would render when the spec intent appears to be “auth/invite section = suppressed”. This is an edge case, but suppression helpers tend to be copied forward and the mismatch is subtle.
   - Suggested fix: If you want “section suppression” semantics, widen to `pathname === '/auth' || pathname.startsWith('/auth/')` and similarly for `/invite`. Keep the existing near-miss test for `/authx/...`.

3. [low] Gallery lightbox z-index ties GlobalNav z-index (possible layering edge cases)
   - File: apps/tournament-web/src/routes/events.$eventId.gallery.tsx:371-384
   - Confidence: low
   - Why it matters: After adding a sticky GlobalNav with `zIndex: 1000` (global-nav.tsx:46-58), the gallery lightbox overlay also uses `zIndex: 1000`. Depending on stacking contexts created by `PageShell` (not shown here) or browser paint-order nuances, this can lead to the nav appearing above the lightbox in some cases, which would be a UX regression for full-screen viewing.
   - Suggested fix: Bump the lightbox overlay z-index above the nav (e.g. 1300) or centralize z-index tokens so overlays consistently sit above global chrome.

## Strengths

- GlobalNav logic is testable and reactive (uses TanStack `useLocation()` instead of `window.location`) and the suppression predicate is pure with solid unit coverage (including near-miss and suffix behavior).
- Account link rendering is correctly gated on `player !== null` per the stated rule, and the home link is always present on non-suppressed routes.
- EventId threading shown in the reviewed admin pages is directly sourced from typed API responses (`group.eventId`, `data.eventRound.eventId`), reducing wrong-target risk.
- PageShell wrapping appears confined to success branches in the reviewed data-fetching pages; pending/error/forbidden branches remain div-based as described.

## Warnings

None.
