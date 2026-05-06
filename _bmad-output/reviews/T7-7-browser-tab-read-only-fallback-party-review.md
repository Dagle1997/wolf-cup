# T7-7 Party-Mode Review: Browser-Tab Read-Only Fallback (FR-E9)

**Story:** T7-7-browser-tab-read-only-fallback
**Epic:** T7 (Player Experience) — closing story
**Status:** review
**Test posture:** 204/204 tournament-web tests green; engine 472, @wolf-cup/api 516, @tournament/api 875+2-skipped all unchanged. Typecheck + lint clean across the workspace.
**Codex history:** spec round-1 PASS-after-fixes (2 H + 5 M mechanically fixed), spec round-2 (2 M + 1 L mechanically fixed); impl round-1 (3 M mechanically fixed), impl round-2 (3 M + 2 L — applied Med #1 + Med #3 + both Lows; Med #2 accepted as residual risk in followups).

This is a **single non-interactive synthesis** of the perspectives the director asked for. No follow-up questions; disagreements are flagged in the synthesis section.

---

## 📊 Mary — Business Analyst

The 4-branch install × scorer matrix is the cleanest expression of FR-E9 we have shipped. Decision matrix:

| Install | Scorer | Branch                                                | Source-of-truth                                       |
|---------|--------|-------------------------------------------------------|-------------------------------------------------------|
| ✓       | ✓      | `score-entry-form` (T5-2 unchanged)                   | existing                                              |
| ✓       | ✗      | `read-only` (T5-2 placeholder + StaleQueueBanner)     | existing                                              |
| ✗       | ✓      | `install-required` (NEW T7-7 surface)                 | `score-entry.tsx:457` insertion                       |
| ✗       | ✗      | `read-only` (Codex-gated — no install prompt)         | `score-entry.tsx:436` short-circuit before T7-7 gate  |

The gate ordering (lines 436–478) places `!isScorer` BEFORE `!isInstalled` — that **is** the load-bearing decision the Codex Medium gating asked for. Inverting it would re-introduce the misleading-prompt-for-non-scorers bug.

### Edge cases I want on record

The spec covers the 4 explicit branches but I see additional combinations that flow through the existing short-circuits and silently land on the right surface — calling them out so future readers don't think they were missed:

1. **Scorer + finalized round + non-installed** → renders `round-closed` (finalized), NOT install-required. Correct: the round is no longer mutable, so prompting install is pointless. Verified at `score-entry.tsx:434` (state check fires before scorer check fires before install check).
2. **Scorer + scorerPlayerId=null + non-installed** → `no-scorer` placeholder. Correct: organizer hasn't assigned a scorer; install prompt would be premature.
3. **Scorer + non-installed + eventId=null** → install-required renders WITHOUT the "View leaderboard instead" link. The conditional `data.eventId !== null` at score-entry.tsx:493 silently omits the link. This is fine for v1 (legacy non-event rounds may not have leaderboards), but `data.eventId` *should* always be populated for tournament rounds in production — if a tournament round ever has `eventId=null`, that's a backend bug, not a UX bug.
4. **Organizer-spectator** (organizer who isn't in any foursome): with no `myFoursome` data this route would already return one of the existing error/no-scorer paths. T7-7 doesn't change that flow. Correct.

### What I would not block on

The "View leaderboard instead" link uses string interpolation `/events/${data.eventId}/leaderboard`. The `eventId` comes from a server response and is treated as opaque, so an XSS payload would have to clear server-side validation first — out of scope for this story. **Pattern: trust internal API responses; validate at boundaries.**

**Verdict:** Decision matrix is complete. Ship.

---

## 🏗️ Winston — Architect

### `useIsInstalledPWA` as the abstraction

Right call. The choice between (a) a hook + getter pair vs (b) lifting install state into QueryClient or a Context comes down to one question: *does install state need to be shared across components that don't share a parent?* Here it does not — `__root.tsx` and `score-entry.tsx` both consume it independently, and the underlying `matchMedia` MQL is browser-singleton anyway, so two listeners is a non-issue (one per consumer; both observe the same backing MQL). Adding a Context provider would force a synthetic dependency on root mount order without a real benefit.

**Specifically I want to call out**: the spec acknowledged the "duplicate listener" concern in Risk Acceptance and the implementation kept the dual-consumer shape. That was the right call — lifting to context costs more in coupling than the redundancy costs in CPU.

### `createAppRouter` factory pattern

Sound. The pattern solves a real problem (the AC #6 wiring test couldn't otherwise prove `main.tsx` uses `defaultNotFoundComponent`). The post-Med#1 type inference change at `router.ts:21` (no `: AnyRouter` annotation, return type inferred from `createRouter`) preserves the precise route-tree typing that flows into `Register['router']` — that's a non-trivial detail and the comment block at `router.ts:9-15` documents the *why*.

The branch in `createAppRouter` (`if (history) { ... } else { ... }` with full options objects in each branch) is more verbose than a spread would be, but it preserves the strict object-property typing that TanStack Router's overloaded signatures need to discriminate. Acceptable.

### Med #2 (main.tsx → createAppRouter wiring)

Codex round-2 Med #2 noted the test still doesn't *prove* main.tsx calls `createAppRouter`. I agree with the residual-risk acceptance. The minimum change to close that gap (importing main.tsx in a test) is incompatible with main.tsx's bootstrap side effects (`createRoot(...).render(...)`); the alternatives (string-grep main.tsx for `createAppRouter`, snapshot the router instance) are worse than the residual risk. Live with it.

### What I'd flag for v1.5

The `score-entry.tsx` component now has 3 sibling `useEffect` blocks for browser-API lifecycles (matchMedia via the hook, beforeinstallprompt at lines 294–308, terminal-error registration at 369–393). None of them depend on each other and they all run unconditionally on mount. If this file grows further, extracting "browser hookups" into a single `useBrowserHooks(roundId)` helper would reduce mount-time noise. Not blocking T7-7.

**Verdict:** Architecture is sound. Ship.

---

## 📋 John — Product Manager

WHY do we have this story? FR-E9 says the scorer flow needs the installed PWA for offline-queue reliability, AND non-scorer browser-tab usage must render read-only without error. T7-7 is the literal, observable closure of that requirement.

### Does this close FR-E9 cleanly?

Yes. The acceptance criteria map 1:1 to FR-E9's two halves:
- "non-installed browser tab... read-only without error" → AC #2 (read-only routes untouched, gate-less).
- "scorer flow requires PWA install for offline-queue reliability... 'install to score' prompt" → AC #3.
- The Codex Medium gating (no prompt for non-scorers) → AC #4.

### Trip-day risk

Real and acknowledged. Worst case: a designated scorer pulls up the round URL on Saturday morning in a Safari tab they accidentally cleared from home screen, sees "Install to score", *doesn't follow the iOS Add-to-Home-Screen instructions*, and stalls scoring for the foursome.

Mitigations already in the system that reduce this risk:
1. **T9.4 pre-trip device gate** (in the backlog): every designated scorer's device gets validated as installed-PWA before the trip. T7-7 turns the trip-day discovery into a prevention measure.
2. **T7-6 install prompt** fires at first-mutation dopamine moment in a normal install path — most scorers will already be installed before T7-7's surface ever fires.
3. The "View leaderboard instead" link gives the user a non-blocking exit so they're not stuck on a dead-end screen.

### Card copy

"Install to score" + 2-sentence iOS/Android instructions is correct minimum-viable copy. **I'd want to see a screenshot or animation of the iOS share-sheet → "Add to Home Screen" sequence on a v1.5 polish pass** — that's the moment scorers actually fail in the wild — but text-only is shippable for trip 1. Adding this to the existing v1.5 followups list is sufficient.

**Verdict:** Closes FR-E9. Ship. Trip-day risk acknowledged and reasonably mitigated.

---

## 🧪 Quinn — QA Engineer

### Coverage of the 4-branch matrix

All four branches covered with explicit `it(...)` blocks at `rounds.$roundId.score-entry.test.tsx:954+`. Each test asserts both the positive (the expected branch renders) AND the negative (the OTHER branches do NOT render via `queryByTestId(...)` returning null). That's the right shape — without the negative assertions, an inverted gate wouldn't fail the test.

### Does case (c) catch a gate-order inversion?

Walking through: if the gate-ordering inverts (install-required fires BEFORE !isScorer), case (d) — non-installed + non-scorer — would render `install-required` instead of `read-only`. The test asserts `getByTestId('read-only')` and `queryByTestId('install-required')` is null. **Case (d) fails on inversion. Good.**

What about the inverse: gate ordering correct but the !isScorer branch fails to short-circuit? That's case (b) — installed + non-scorer — which should render read-only. With matchMedia=true and isScorer=false, the gate ordering is irrelevant (install is true so the install check passes). The case (b) test would still pass. So case (b) does NOT catch a !isScorer logic bug independently — but it doesn't need to; existing T5-2 coverage protects that path.

**Net:** test (d) is the ordering canary. The matrix is sufficient.

### iOS-vs-Android render branch coverage

Case (c) tests the Android/Chromium-with-deferred-event branch only (mocks `__deferredInstallPrompt` + non-iOS UA). The iOS branch (no deferred event + iOS UA → instructions card) is NOT tested in `score-entry.test.tsx`. **This is acceptable** — iOS branch behavior is exhaustively covered in `install-prompt.test.tsx`, and we don't need to redo install-prompt's matrix in score-entry's surface.

If anyone wants belt-and-suspenders coverage, an additional `it('(c-ios) non-installed + scorer + iOS UA → install-required wraps iOS instructions card')` would assert `getByText(/Add to Home Screen/i)` is present. Not blocking — paranoid.

### Hook listener tests

The 4 added `useIsInstalledPWA` tests at `display-mode.test.ts:81+` cover initial value, addEventListener registration, change-handler re-render, and listener-reference removal-on-unmount. Together with the 4 sync-getter tests, that's 8 assertions for ~30 lines of source — appropriate density for a load-bearing hook.

### Test-environment hygiene

Codex round-2 Med #3 (userAgent teardown) was applied with module-level `ORIGINAL_USER_AGENT` capture + explicit defineProperty restore. This is the right pattern (the prior `Reflect.deleteProperty + try/catch` swallowed errors). Verified at `score-entry.test.tsx:937-952`.

**Verdict:** Test coverage is sufficient. Ship.

---

## 💻 Amelia — Developer Agent

### Code smells

`score-entry.tsx:288-308` duplicates the `beforeinstallprompt` listener pattern already in `__root.tsx:100-114`. Spec acknowledged this. Two consumers, one global slot — listeners are idempotent (both store the same event in `window.__deferredInstallPrompt`), no leak under React 18 StrictMode (cleanup registered).

**Should the host's listener be lifted to context?** Not yet. Lifting now means:
- A new `<InstallEventProvider>` mount in `__root.tsx`'s tree.
- A `useInstallEvent()` hook for consumers.
- The score-entry route gives up its own listener and consumes context.

That's net 3 new things (provider, hook, refactor across two consumers) to remove ~14 lines of effect code. **Not worth it for a 2-consumer shape.** If a 3rd consumer lands, lift then.

### Maintenance burden

- `display-mode.ts` is 50 lines. Trivial.
- `not-found.tsx` is 12 lines. Trivial.
- `router.ts` is 35 lines. Trivial.
- `__root.tsx` net change: -10 lines (deleted inline useEffect, added 1-line hook call).
- `score-entry.tsx` net change: +50 lines (new gate branch + listener useEffect).
- `main.tsx` net change: -3 lines (delegates to factory).

Total: +1 file (router.ts), +2 NEW components (NotFound, display-mode lib), +50 lines on the route, +30 lines of tests. Maintainable.

### Spec drift check

Every `## Files this story will edit` entry is touched. One file added beyond the spec list: `apps/tournament-web/src/router.ts` — added during impl-codex round-1 Med #1 fix. Documented in commit body and party-codex review will see it.

### Required follow-ups from impl review

- `not-found.tsx:1-5` doc comment updated to reflect router.ts wiring (Low #2 fix applied).
- `router.ts` return type inference (Med #1 fix applied).
- userAgent teardown via defineProperty restore (Med #3 fix applied).
- Hook cleanup test verifies same callback reference removed (Low #1 fix applied).
- Med #2 (main.tsx wiring proof) accepted as residual risk; documented in followups.

**Verdict:** No blocking smells. Ship.

---

## 🎨 Sally — UX Designer

The install-required surface is the *exact* moment the FD-14 scorer-trip-day failure mode fires. Let me walk the user story:

> Saturday 7:54 AM, Pinehurst No. 2 first tee. Foursome 3's designated scorer Mike pulls his phone out, taps the URL Josh texted last night, and Safari opens it as a tab — not as the home-screen app. He's never installed it. The screen says "Install to score" with iOS instructions.

What does Mike do?
- **Best case:** he taps Share → Add to Home Screen, app icon appears, taps it, lands on the score-entry surface as a standalone PWA. Total: ~15 seconds.
- **Realistic case:** Mike isn't sure what "Add to Home Screen" means in iOS Share, hunts around, eventually finds it. ~45 seconds.
- **Worst case:** Mike taps "View leaderboard instead", scores in his head, and tells someone else to enter scores 30 minutes later. The foursome accumulates a phantom-scoring debt.

### Copy quality

"Score entry requires the installed app for offline reliability." — clear *what*; not as clear on *why* it matters. **Why** is the load-bearing word for a frustrated trip-day user. Suggested addendum: "...because Pinehurst's signal goes in and out, and only the installed app keeps your scores safe." Trip-specific framing converts compliance into self-interest.

"On iOS: Share → Add to Home Screen." — the arrow notation is fine for tech-fluent users but is opaque-ish for older players. Adding a tiny share-icon glyph and home-icon glyph next to the labels would help. v1.5 polish — not blocking.

### "View leaderboard instead" link

Currently a plain `<a>` tag. Visually subordinate to the install button. **That's the right hierarchy** — we WANT the install button to be the primary action. The link is the escape hatch, not the recommendation.

**Slight concern:** there's no visible separator between the install card and the link, so a frustrated user might miss the link entirely. A 1-line suggestion: wrap the link in a `<p>` with `marginTop: '1rem'` or similar so it visually sits below the install card with breathing room. Trivial polish, not blocking.

### iOS Add-to-Home-Screen visual aid

PM already flagged this for v1.5. Agree. A 4-frame illustration (Safari → Share icon → "Add to Home Screen" row → home-screen icon) would convert the "what's that mean?" cohort into the best-case path. **For v1: text instructions are sufficient.** Plenty of apps ship iOS install instructions as text-only.

### Disagreement note (UX vs Architecture)

Winston wants to leave the dual-consumer matchMedia listener as-is. I have no objection from a UX angle — install-state propagation is invisible to users. Lifting state to Context would not change UX surface. Architecture call wins by default.

**Verdict:** UX is good for trip 1. Ship. Polish backlog: install-button visual hierarchy, iOS add-to-home-screen visual aid, "why install" copy.

---

## 🤝 Synthesis & Recommendations

### Verdict: **PASS — ship to commit.**

All six personas converge on PASS. Test coverage is appropriate, architecture is sound, the AC matrix is complete, the trip-day failure mode is acknowledged and mitigated, and code smells are at acceptable density.

### Required changes

**None.** No persona requested a blocking change.

### Optional polish (logged for v1.5+ followup, NOT for this story)

1. **iOS Add-to-Home-Screen visual aid** (PM, UX) — text-only is sufficient for trip 1; a 4-frame illustration would help the "what does that mean?" cohort.
2. **"View leaderboard instead" link visual breathing room** (UX) — a 1-line `marginTop` adjustment so the link doesn't visually snuggle against the install card.
3. **Trip-specific "why install" copy** (UX) — "...because Pinehurst's signal goes in and out, and only the installed app keeps your scores safe."
4. **Install-required audit type `install_required.surfaced`** (already in story followups, restated here) — observability of route-level surface frequency. Not needed for trip 1.
5. **Belt-and-suspenders iOS-branch test in score-entry.test.tsx** (QA) — paranoid coverage; install-prompt.test.tsx already covers iOS exhaustively.
6. **`useBrowserHooks(roundId)` extraction** (Architect) — only if score-entry.tsx grows further; not warranted today.
7. **Lift install-event to context** (Dev) — only if a 3rd consumer lands; not warranted today.

### Disagreements between personas

**Architect vs. Dev vs. UX on the dual matchMedia listener:** all three agree it's acceptable for v1. Architect frames it as "Context provider would force a synthetic dependency"; Dev frames it as "not worth net 3 new things to remove ~14 lines"; UX has no concern (invisible to users). **No actual disagreement** — same conclusion via three different reasoning paths. Logged here only because the director's prompt explicitly asked.

**No other disagreements surfaced.**

### Director: proceed to step 9 (codex-review the party output) and then step 10 (commit).
