# T7-7: Browser-Tab Read-Only Fallback (Scorer-Gated Install-Required State, FR-E9)

## Status

ready-for-dev

## Story

As a non-installed browser-tab user, I want read-only surfaces (leaderboard / standings / pairings / schedule / course preview / money / settle-up) to render without error, AND I want the score-entry route to show an "Install to score" state ONLY if I'm actually the assigned scorer (non-scorers see the standard read-only placeholder instead), so that the app degrades gracefully without misleading non-scorers into thinking they need to install (FR-E9).

## v1 Scope

The story closes Epic T7 by introducing two pieces:

1. A single source of truth for PWA-install detection — `apps/tournament-web/src/lib/display-mode.ts` exporting `isInstalledPWA()`. T7-6's `__root.tsx` host already inlines `window.matchMedia('(display-mode: standalone)').matches` plus the iOS Safari fallback `(navigator as any).standalone === true`; this story extracts that into the lib (no behavior change at __root.tsx, just a refactor) so T7-7's score-entry gate consumes the same predicate.
2. A scorer-gated install-required state on the score-entry route. When a non-installed browser tab opens `/rounds/:roundId/score-entry` AND the viewer is the assigned scorer, render a small "Install to score" card with an inline install button (reuses T7-6's `<InstallPrompt>` component) plus a "View leaderboard instead" link. When the viewer is NOT the scorer, render the existing T5-2 read-only placeholder unchanged — no install prompt — per the Codex Medium concern that motivated this story (the install-required surface was previously misleading when shown to non-scorers).

A standard 404 component is also added to the TanStack Router so unknown routes render deterministically (not 500, not silent redirect).

### Decision: gate ordering vs. existing route

The existing route already short-circuits in this order at `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:409-439`:
1. `data.state === 'finalized' | 'cancelled'` → round-closed placeholder
2. `data.myFoursome.scorerPlayerId === null` → no-scorer placeholder
3. `!data.myFoursome.isScorer` → read-only placeholder

The new install-required gate is inserted ONLY when both of the following hold:
- `data.myFoursome.isScorer === true` (the viewer would otherwise be served the score-entry form)
- `!isInstalledPWA()`

This ordering is load-bearing — placing the install-required check above the `isScorer` check would re-introduce the bug that prompted this story (non-scorers seeing "install required" when they could not score regardless).

### Front-end additions

**1. `apps/tournament-web/src/lib/display-mode.ts` (NEW):**

```ts
// Single source of truth for PWA-install detection. Consumed by T7-6's
// install-prompt host (refactored from inline matchMedia useEffect) and
// by T7-7's scorer-gated install-required state on the score-entry route.

export function isInstalledPWA(): boolean {
  if (typeof window === 'undefined') return false;
  // Modern: display-mode media query (supported on iOS 16+ Safari, all
  // Chromium-based browsers, modern Firefox).
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  }
  // iOS Safari fallback: navigator.standalone is iOS-specific and was
  // never standardized; some older iOS versions report standalone here
  // even when display-mode does not yet match. Cast through unknown to
  // avoid an `any` lint hit while preserving runtime semantics.
  const nav = navigator as unknown as { standalone?: boolean };
  if (nav.standalone === true) return true;
  return false;
}

// React hook for components that need to react to display-mode changes
// at runtime (rare — usually only triggered when the user adds the page
// to home screen mid-session, but listening matches __root.tsx's
// existing T7-6 behavior so the predicates stay aligned).
//
// Implementation contract (codex spec round-1 Med #1):
//   - Initial state: useState(() => isInstalledPWA()).
//   - Effect: typeof window === 'undefined' early return (SSR safe).
//     If matchMedia is unavailable (older jsdom or test stubs), return
//     without registering a listener.
//   - Listener wiring uses optional-chaining `mql.addEventListener?.('change', onChange)`
//     and matching `mql.removeEventListener?.('change', onChange)` on cleanup,
//     mirroring __root.tsx:116-125. The optional-chaining is load-bearing
//     for older Safari (pre-14) where MediaQueryList only had the
//     deprecated addListener/removeListener API. v1 does NOT bridge to
//     the deprecated API — pre-14 Safari users render with the initial
//     read only and miss the rare mid-session flip; acceptable per the
//     existing __root.tsx posture.
//   - Listener handler reads `e.matches` (the MQL change event payload),
//     OR re-calls `isInstalledPWA()` to also catch the iOS
//     navigator.standalone path. Use `isInstalledPWA()` so the hook
//     stays consistent with the synchronous getter.
export function useIsInstalledPWA(): boolean { /* matchMedia listener */ }
```

The synchronous `isInstalledPWA()` getter is testable without React. The `useIsInstalledPWA()` hook adds a `matchMedia('change')` listener so a mid-session display-mode flip (e.g. user installs the PWA, app gets relaunched, display-mode flips to standalone — uncommon but possible on a desktop install) re-renders. Mirrors the existing `useEffect`-with-listener pattern at `__root.tsx:116-125`.

**2. `apps/tournament-web/src/routes/__root.tsx` (REFACTOR):**

Replace the inline standalone detection at `__root.tsx:116-125` with a `useIsInstalledPWA()` hook call. The `isStandalone` state is dropped in favor of the hook's return value. T7-6 behavior is unchanged — the hook is bug-for-bug compatible with the existing useEffect (initial-read + change listener + cleanup). No other change to the install-prompt host.

This refactor is required by the AC ("Single source of truth for install-detection; consumed by T7.6 + T7.7"). It is intentionally minimal — only the standalone-detection useEffect moves.

**3. `apps/tournament-web/src/components/not-found.tsx` (NEW) + `apps/tournament-web/src/main.tsx` (WIRE):**

Codex spec round-2 Med #1 noted that an inline `defaultNotFoundComponent` baked into `main.tsx` cannot be unit-tested against `main.tsx`'s wiring without exporting either the component or the router. Resolution: extract the NotFound component to its own file so both `main.tsx` and the AC #6 test import the same symbol.

`apps/tournament-web/src/components/not-found.tsx`:
```tsx
export function NotFound() {
  return (
    <div role="main" data-testid="not-found">
      <h1>Page not found</h1>
      <p>The link you followed isn't valid.</p>
    </div>
  );
}
```

`apps/tournament-web/src/main.tsx` change:
```ts
import { NotFound } from './components/not-found';
// ...
const router = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFound,
});
```

This satisfies AC #6 — unknown routes render deterministically. Without this, TanStack Router's behavior on an unmatched URL is to render a minimal default that may not be styled nor have a stable testid; the explicit registration gives the test suite a known anchor. Crucially, by exporting `NotFound` as a named symbol, AC #7's 404 test can import the SAME symbol and assert that:
- Rendering `<NotFound />` directly produces the expected content (component-level guarantee).
- Constructing a fresh `createRouter({ routeTree, defaultNotFoundComponent: NotFound, history: createMemoryHistory({ initialEntries: ['/this-route-does-not-exist'] }) })` and rendering it via `<RouterProvider>` ALSO produces the same content (wiring guarantee). The two assertions together prove main.tsx's wiring is correct AND the component itself renders correctly.

**4. `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx` (NEW gate):**

Insert the install-required branch immediately after the existing `if (!data.myFoursome.isScorer)` block, BEFORE the existing entry-form return:

```tsx
const isInstalled = useIsInstalledPWA();

// ...existing short-circuits unchanged...

if (!isInstalled) {
  // Reach here means: data.myFoursome.isScorer === true AND we're NOT in
  // a PWA. Render the install-required card; non-scorers fall through the
  // earlier `!isScorer` short-circuit so they never see this surface.
  return (
    <div data-testid="install-required" role="main">
      <h1>Install to score</h1>
      <p>
        Score entry requires the installed app for offline reliability.
        On iOS: Share &rarr; Add to Home Screen. On Android: tap Install
        below.
      </p>
      <InstallPrompt
        installPromptShownAt={null}
        hasMutatedThisSession={true}
        isStandalone={false}
        beforeInstallEvent={beforeInstallEvent}
        userAgent={typeof navigator !== 'undefined' ? navigator.userAgent : ''}
        onShown={() => { /* no-op — host route is the install-required card; no audit emit here */ }}
      />
      {data.eventId !== null && (
        <a
          data-testid="view-leaderboard-link"
          href={`/events/${data.eventId}/leaderboard`}
        >
          View leaderboard instead
        </a>
      )}
    </div>
  );
}
```

**Inline-component vs. host-prompt rationale:** the existing T7-6 `<InstallPrompt>` component already encodes the iOS / Android branching, the stamp-on-shown invariant, and the suppression rules. We pass `installPromptShownAt: null` and `hasMutatedThisSession: true` to force-render the prompt regardless of the per-device one-shot state — the install-required card is a route-level surface, not an event-driven dopamine prompt, so it should always show the install affordance when the viewer is on this route. Passing `onShown: () => {}` (no-op) means clicking install does NOT stamp `device_bindings.install_prompt_shown_at` from this surface — the audit-stamp belongs to T7-6's first-mutation flow only. Two reasons:
- **Avoid double-stamping**: a scorer who installs from this card and then completes a first mutation should still be eligible for the (suppressed-to-them after install, but still tracked) device-bindings stamp via T7-6's flow.
- **Audit semantics**: the install-prompt audit row is keyed off "first successful mutation in session" (T7-6 contract) — this surface fires on PAGE LOAD, not on a mutation, so emitting an audit here would corrupt the meaning of `install_prompt.shown` rows.

The `beforeInstallEvent` is read via the same `window.__deferredInstallPrompt` global that __root.tsx populates (we wire it through a small useEffect inside the score-entry component, copying the listener pattern from __root.tsx:100-114 — about 8 lines, no helper extraction needed for one consumer).

**Existing global typing (codex spec round-1 Med #2 — no new typing required).** Both `BeforeInstallPromptEvent` and `Window.__deferredInstallPrompt` are already declared in `apps/tournament-web/src/types/install-prompt.d.ts` from T7-6. The score-entry component reads from these existing globals without any module augmentation in this story. Concretely the existing `.d.ts` provides:

- `interface BeforeInstallPromptEvent extends Event { readonly platforms: ReadonlyArray<string>; prompt(): Promise<void>; readonly userChoice: Promise<...> }`
- `interface Window { __deferredInstallPrompt?: BeforeInstallPromptEvent | undefined }`

No additions to that file are part of T7-7's scope.

**5. Test coverage — `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx` (NEW cases):**

Four new render-path tests covering AC #7's matrix (installed × scorer):

- **(a) installed + scorer** → score-entry form (`data-testid="score-entry-form"`); MUST verify install-required card is NOT in the DOM.
- **(b) installed + non-scorer** → existing T5-2 read-only placeholder (`data-testid="read-only"`); MUST verify install-required card is NOT in the DOM.
- **(c) non-installed + scorer** → install-required card (`data-testid="install-required"`); MUST verify the score-entry form is NOT in the DOM AND the read-only placeholder is NOT in the DOM. The install button (Android shape with mocked `beforeInstallEvent`) and "View leaderboard instead" link MUST both be present.
- **(d) non-installed + non-scorer** → existing T5-2 read-only placeholder (`data-testid="read-only"`); MUST verify install-required card is NOT in the DOM. This is the Codex-gated path — non-scorers in browser tabs see read-only, never install-required.

Plus one test for the `display-mode.ts` lib at `apps/tournament-web/src/lib/display-mode.test.ts`:

- `isInstalledPWA()` returns `true` when `matchMedia('(display-mode: standalone)').matches === true`.
- Returns `true` when `matchMedia` does NOT match BUT `navigator.standalone === true` (iOS fallback path).
- Returns `false` when both signals are false.
- Returns `false` when `window` is undefined (SSR safety).

`window.matchMedia` is not native in jsdom; tests stub it via the standard `Object.defineProperty(window, 'matchMedia', { value: vi.fn(...) })` pattern used elsewhere in this repo (verified existing usage at `apps/tournament-web/src/components/install-prompt.test.tsx`).

### What this story does NOT change

- The read-only routes (leaderboard, standings, pairings, schedule, course preview, gallery, money, settle-up) are already gateless w.r.t. install state and will continue to render in browser tabs. No code change to those files. The AC for "they render fully without error" is satisfied by code inspection (none of those routes call `isInstalledPWA` or check `display-mode` today) plus the existing test suites for each route. We do not add redundant browser-tab tests to all of them — the regression budget is on the score-entry matrix where the new logic actually lives.
- T7-6's install-prompt audit POST flow is unchanged. The score-entry install-required card's "Install" button does NOT call `/api/events/:eventId/devices/me/install-prompt-shown`. Per the rationale above, the audit row is reserved for the first-mutation-driven prompt, not the route-level install-required surface.
- No backend changes. No new env vars. No new dependencies. No SHARED-path edits.

## Acceptance Criteria

**AC #1 — `display-mode.ts` exists and is the single source of truth.**

**Given** `apps/tournament-web/src/lib/display-mode.ts`
**When** inspected
**Then** it exports `isInstalledPWA(): boolean` implemented via `window.matchMedia('(display-mode: standalone)').matches` PLUS the iOS Safari fallback `(navigator as { standalone?: boolean }).standalone === true`. Both branches are present. Function is SSR-safe (`typeof window === 'undefined'` short-circuits to false).

**Given** `apps/tournament-web/src/routes/__root.tsx`
**When** inspected
**Then** the inline `useEffect` at line ~116-125 that called `window.matchMedia('(display-mode: standalone)')` directly is replaced with a call to `useIsInstalledPWA()` (or equivalent named export from `display-mode.ts`). No other behavioral change to the install-prompt host.

**AC #2 — Read-only routes render without error in non-installed browser tabs.**

**Given** a non-installed browser tab (`isInstalledPWA() === false`)
**When** the viewer navigates to leaderboard / standings / pairings / schedule / course preview / money (organizer) / settle-up (organizer)
**Then** all these routes render fully without error; no "install required" banner (they are read-only by design). Verified by code inspection — no route in this list reads `isInstalledPWA` or gates on display-mode.

**AC #3 — Install-required state for the assigned scorer.**

**Given** a non-installed browser tab AND the viewer IS the assigned scorer for the round (`data.myFoursome.isScorer === true`)
**When** the viewer navigates to `/rounds/:roundId/score-entry`
**Then** instead of the score-entry form, an "Install to score" card renders with: (a) the heading "Install to score", (b) instructional copy mentioning iOS Add-to-Home-Screen and Android Install, (c) an inline install button (reuses `<InstallPrompt>`), (d) a "View leaderboard instead" link pointing to `/events/:eventId/leaderboard` when `data.eventId` is non-null. The score-entry form is NOT mounted.

**AC #4 — Read-only placeholder for non-scorers, regardless of install state.**

**Given** a non-installed browser tab AND the viewer is NOT the assigned scorer (`data.myFoursome.isScorer === false`)
**When** they navigate to `/rounds/:roundId/score-entry`
**Then** the existing T5-2 read-only placeholder renders (`data-testid="read-only"`, content: "{scorer name} is currently scoring foursome {N}"). NO install-required card. NO install prompt component. This is the Codex Medium fix — non-scorers were never able to score, so showing them an install prompt is misleading.

**AC #5 — Installed-PWA scorer gets the score-entry form unchanged.**

**Given** the same scorer in an installed PWA (`isInstalledPWA() === true`)
**When** they navigate to the same route
**Then** the score-entry form renders normally; T5-2 / T6-7a / T7-6 behavior unchanged. The install-required card is NOT mounted.

**AC #6 — Unknown routes render a deterministic 404.**

**Given** a non-installed browser tab opening a URL that doesn't match any TanStack route (e.g., `/this-route-does-not-exist`)
**When** the router's `defaultNotFoundComponent` fires
**Then** a standard 404 component renders with `data-testid="not-found"` and a "Page not found" heading. The router does NOT silently redirect to `/` and does NOT throw an unhandled exception (no 500). This holds regardless of install state.

**AC #7 — Component test matrix.**

**Given** `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx`
**When** the new tests run
**Then** four render paths are verified, each in its own `it(...)` block:

- **(a) installed + scorer** → assert `getByTestId('score-entry-form')` is present; assert `queryByTestId('install-required')` is null and `queryByTestId('read-only')` is null. Mock `window.matchMedia('(display-mode: standalone)')` → `matches: true`.
- **(b) installed + non-scorer** → assert `getByTestId('read-only')` is present; assert `queryByTestId('install-required')` is null and `queryByTestId('score-entry-form')` is null. Mock `window.matchMedia('(display-mode: standalone)')` → `matches: true`. Fixture sets `myFoursome.isScorer: false`.
- **(c) non-installed + scorer** → assert `getByTestId('install-required')` is present AND inside it both: (i) a `getByRole('dialog', { name: 'Install app' })` from the inner `<InstallPrompt>` (this anchor is stable — install-prompt.tsx wraps both Android and iOS card branches with `role="dialog"` + `aria-label="Install app"`, see `apps/tournament-web/src/components/install-prompt.tsx:122-137,193-207`), and (ii) `getByTestId('view-leaderboard-link')` whose `href` ends with `/events/${eventId}/leaderboard`. Assert `queryByTestId('score-entry-form')` is null and `queryByTestId('read-only')` is null. Inside install-prompt.tsx, the Chromium-with-deferred-event branch is selected by `beforeInstallEvent !== null && !isIos` (see install-prompt.tsx:84-97 — the in-code label "Android-shape" is misleading; the gate is non-iOS UA + deferred event, which includes desktop Chrome and Android Chrome alike, codex spec round-2 Med #2). The test seeds `window.__deferredInstallPrompt` with a mocked `BeforeInstallPromptEvent` (`prompt: vi.fn()`, `userChoice: Promise.resolve(...)`) AND stubs `navigator.userAgent` to ANY non-iOS UA (a generic Chrome UA suffices — Android-vs-desktop distinction is irrelevant to install-prompt.tsx's branching). The combination makes the `role="dialog"` wrapper render reliably regardless of jsdom's default UA.
- **(d) non-installed + non-scorer** → assert `getByTestId('read-only')` is present; assert `queryByTestId('install-required')` is null. Mock `window.matchMedia` with `matches: false`. Fixture sets `myFoursome.isScorer: false`. This is the Codex-gated path — non-scorers in browser tabs see read-only, never install-required.

Each test mocks `window.matchMedia` per-test (the standard `Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue({ matches, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })` pattern, mirroring the existing `apps/tournament-web/src/components/install-prompt.test.tsx:64-75` setup). Tests stub `fetch` for `/api/rounds/:id` (returns `RoundDetail`) and `/api/events/:eventId/rounds/:id/course` (returns `RoundCourse`) using the existing fixture helper pattern from the same test file.

**Given** `apps/tournament-web/src/main.test.tsx` OR a `__root.test.tsx` companion (whichever is more naturally hosted — pick the one consistent with existing tournament-web test layout; if neither exists, create the test alongside `main.tsx` as `apps/tournament-web/src/main.test.tsx`)
**When** the router renders an unknown URL (a path that does NOT match any registered route, e.g., `/this-route-does-not-exist`)
**Then** the rendered tree contains an element with `data-testid="not-found"` AND a heading with text matching `/Page not found/i`. The router does NOT throw, does NOT redirect to `/`, and does NOT render any other route's content. The test uses TanStack Router's `createMemoryHistory({ initialEntries: ['/this-route-does-not-exist'] })` + `createRouter({ routeTree, defaultNotFoundComponent, history })` so it is hermetic and does not depend on `window.location`. (Reference pattern: `apps/tournament-web/src/routes/auth.conflict.test.tsx:16-50` already uses `createRouter` inside a test.)

**Given** `apps/tournament-web/src/lib/display-mode.test.ts`
**When** the unit tests run
**Then** four assertions hold: matchMedia-true → true; matchMedia-false + navigator.standalone-true → true; both-false → false; SSR (no window) → false. The SSR-no-window case can be exercised by either (a) putting that single test in a sibling file with the `// @vitest-environment node` directive at the top of the file (genuine `typeof window === 'undefined'`), or (b) using `vi.stubGlobal('window', undefined)` with explicit teardown in `afterEach` (codex spec round-2 Low #1: stubGlobal is brittle if not torn down). Either approach is acceptable; dev-story picks based on jsdom version stability in CI.

## Tasks / Subtasks

- [ ] **Task 1 — `display-mode.ts` lib (AC #1).**
  - [ ] Create `apps/tournament-web/src/lib/display-mode.ts` with `isInstalledPWA()` (synchronous getter) and `useIsInstalledPWA()` (React hook with matchMedia-change listener).
  - [ ] Create `apps/tournament-web/src/lib/display-mode.test.ts` with the four assertions in AC #7's lib block.

- [ ] **Task 2 — `__root.tsx` refactor (AC #1).**
  - [ ] Replace the inline `useEffect` standalone-detection at `__root.tsx:116-125` with a `useIsInstalledPWA()` call. Drop the `isStandalone` `useState`. Pass the hook return value into `<InstallPrompt>` as the `isStandalone` prop unchanged.
  - [ ] Verify T7-6 install-prompt host tests still pass without modification. Add NO new tests in `__root.tsx`'s test surface (none yet exists; would be out of scope).

- [ ] **Task 3 — `NotFound` component + `defaultNotFoundComponent` wiring (AC #6).**
  - [ ] Create `apps/tournament-web/src/components/not-found.tsx` exporting a named `NotFound` function component that renders `<div role="main" data-testid="not-found">` with `<h1>Page not found</h1>` + a paragraph.
  - [ ] In `apps/tournament-web/src/main.tsx`, import `NotFound` from `./components/not-found` and pass it as `defaultNotFoundComponent` to `createRouter`. Do not inline the JSX in main.tsx — the named export is required for the AC #6 wiring test (codex spec round-2 Med #1).
  - [ ] Add `apps/tournament-web/src/components/not-found.test.tsx` with a single component-level test rendering `<NotFound />` and asserting `data-testid="not-found"` + the heading text.

- [ ] **Task 4 — Score-entry install-required gate (AC #3, #4, #5).**
  - [ ] In `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx`, add `useIsInstalledPWA()` near the top of `ScoreEntryRoute`. Capture `beforeInstallEvent` via a small `useEffect` mirroring `__root.tsx:100-114` (under 10 lines).
  - [ ] After the existing `if (!data.myFoursome.isScorer)` short-circuit, insert: `if (!isInstalled) { return <InstallRequiredCard /> }`. Inline the `InstallRequiredCard` in this same file (no separate component file — single consumer, < 30 lines of JSX).
  - [ ] The card MUST: render `<InstallPrompt>` with `installPromptShownAt={null}` + `hasMutatedThisSession={true}` + `isStandalone={false}` + `beforeInstallEvent={...}` + `onShown={noop}` (rationale: route-level surface, not first-mutation hook; preserves T7-6 audit semantics). Render the "View leaderboard instead" link only when `data.eventId !== null`.

- [ ] **Task 5 — Score-entry test matrix (AC #7).**
  - [ ] In `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx`, add four `it(...)` blocks for the install × scorer matrix. Mock `window.matchMedia` per-test (some tests need standalone=true, others standalone=false). Stub `fetch` for `/api/rounds/:id` and `/api/events/:id/rounds/:id/course` with a fixed RoundDetail / RoundCourse fixture; vary `isScorer` to flip cases.
  - [ ] Case (c) MUST assert: `getByTestId('install-required')` present; `getByRole('dialog', { name: 'Install app' })` present (the inner `<InstallPrompt>` wrapper); `getByTestId('view-leaderboard-link')` href ends with `/events/${eventId}/leaderboard`. Seed `window.__deferredInstallPrompt` with a mocked `BeforeInstallPromptEvent` and stub a Chrome desktop UA so the install-prompt's Android branch renders (otherwise it falls through to "render null" and case-(c) loses the dialog anchor).
  - [ ] All tests use `vi.fn()` and `cleanup()` per the existing test patterns in this file.

- [ ] **Task 5b — 404 route test (AC #6, AC #7).**
  - [ ] Add a `apps/tournament-web/src/main.test.tsx` (or `__root.test.tsx` companion if more natural) that builds a hermetic router via `createRouter({ routeTree, defaultNotFoundComponent, history: createMemoryHistory({ initialEntries: ['/this-route-does-not-exist'] }) })`, renders it inside `<RouterProvider>`, and asserts: (a) `getByTestId('not-found')` present; (b) heading text matches `/Page not found/i`; (c) NO redirect happens; (d) NO unhandled exception. Reference pattern: `apps/tournament-web/src/routes/auth.conflict.test.tsx:16-50` already builds an in-test router.

- [ ] **Task 6 — Regression sweep.**
  - [ ] Run `pnpm --filter @tournament/web test` — every previously passing test still passes (T7-6 install-prompt host, score-entry route, gallery, leaderboard, schedule, etc.).
  - [ ] Run `pnpm -r typecheck` and `pnpm -r lint` — clean.
  - [ ] No engine / api / tournament-api test changes; this is a tournament-web-only story.

## Files this story will edit

- apps/tournament-web/src/lib/display-mode.ts
- apps/tournament-web/src/lib/display-mode.test.ts
- apps/tournament-web/src/components/not-found.tsx
- apps/tournament-web/src/components/not-found.test.tsx
- apps/tournament-web/src/routes/__root.tsx
- apps/tournament-web/src/main.tsx
- apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
- apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Dev Notes

### Key references

- **T7-6 install-prompt component**: `apps/tournament-web/src/components/install-prompt.tsx` — the JSX used inside the install-required card. Re-used as a pure component; T7-7 does NOT modify this file.
- **T7-6 host (standalone detection in flight)**: `apps/tournament-web/src/routes/__root.tsx:116-125`, the inline `useEffect` that this story refactors into `useIsInstalledPWA()`.
- **Score-entry route shape**: `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx` — the route file where the new gate inserts. Existing short-circuit branches at lines 409-439 are the insertion-point landmark.
- **API gating signal**: `RoundDetail.myFoursome.isScorer` is computed server-side as `session.userId === scorer_assignments.scorer_player_id`, matching the AC literal text.

### Architectural alignment

- **FR-E9** (PRD line 365): "Browser-tab (non-installed) usage shall render read-only leaderboard / standings / pairings / schedule without error. Scorer flow requires PWA install for offline-queue reliability; UI surfaces a clear 'install to score' prompt when a non-installed user opens a scorer surface." — T7-7 is the closing story for this requirement.
- **FD-14** (frozen decision): scorer must be on installed PWA for offline-queue reliability; spectators / non-scorers can browse read-only.
- **Codex Medium gating** (epic file line 2501): "the install prompt was misleading when shown to non-scorers." T7-7 explicitly fixes this by ordering the gate AFTER the `isScorer` short-circuit.
- **No SHARED touches**. All seven listed files fall under `apps/tournament-web/**` or the tournament sprint-status — both ALLOWED.

### Risk acceptance

- **`useIsInstalledPWA()` re-render cadence**: the hook adds a `matchMedia('change')` listener identical in shape to the one __root.tsx already runs. Two listeners on the same MQL is harmless (different consumer states). Listener is removed on unmount; no leak.
- **`beforeInstallEvent` capture in score-entry**: the route runs INSIDE the `<RootComponent>` tree and the `__root.tsx` host already populates `window.__deferredInstallPrompt`. Score-entry reads from the same global, so a second listener is technically redundant but harmless. Keeping the second listener for symmetry rather than coupling to __root's mount order — both routes are siblings under the StrictMode-wrapped router and could in principle mount independently in tests.
- **`<InstallPrompt onShown={noop}>`**: passing a no-op intentionally drops the audit-emit signal. T7-6's audit contract says `install_prompt.shown` rows correspond to the first-mutation prompt, not the route-level install-required surface. Codex may flag this as "missing audit emit" — the rationale above (avoid double-stamping; preserve audit semantics) is the answer; adding an emit would require a new audit type which is out of scope for T7-7. If the codex review insists on emitting, the appropriate response is to defer to a followup story rather than expand this one.

### Followups

- **404 component styling**: the `defaultNotFoundComponent` here is minimal (heading + paragraph). A nicer styled 404 with branding could be a v1.5 polish story. Not blocking trip-day.
- **Mid-session install detection**: if a user installs the PWA mid-session and the page is open in the standalone window, `useIsInstalledPWA()`'s matchMedia listener will fire and the gate flips to "installed" without a reload. Verified by the listener — no test for this path (low value; no real user lives in this state).
- **Route-level install-required surface is intentionally NOT audited** (codex spec round-1 Med #3). T7-6's `install_prompt.shown` audit type is reserved for the first-mutation-driven prompt. T7-7's install-required card fires on PAGE LOAD (a navigation, not a mutation), so emitting an audit row from this surface would corrupt the meaning of `install_prompt.shown` rows and over-count "prompts shown" by the number of times a non-installed scorer hit the score-entry route. **Accepted observability gap for v1**: we will not know from the audit log how often the install-required card was rendered. If observability of route-level exposure becomes a real need (e.g., to measure how many scorers Cassidied around the install requirement on trip day), a separate `install_required.surfaced` audit type can be added in a v1.5 polish story without changing T7-7's behavior — the new audit emit would attach to the same route-level branch this story creates.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Opus 4.7, 1M context)

### Debug Log References

### Completion Notes List

### File List
