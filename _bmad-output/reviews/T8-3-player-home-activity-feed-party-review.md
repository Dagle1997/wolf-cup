# T8-3 Party-Mode Review: Player-Home Activity Feed

**Story:** T8-3-player-home-activity-feed
**Status:** review
**Test posture:** tournament-web 222 → 263 ✓ (+41); tournament-api 943, engine 472, wolf-cup-api 516 untouched. Workspace tc + lint clean.
**Codex history:** Spec 11 fixed (R1: 2 H + 4 M + 1 L; R2: 1 H + 2 M + 1 L). Impl 2 fixed (R1: 1 H + 1 M). No remaining findings.

Single non-interactive synthesis. No follow-up questions.

---

## 📊 Mary — Business Analyst

The 11-AC matrix is complete and cleanly cross-references T8-1's typed payloads. Specifically, AC #6 (score-correction inline `priorGross + newGross + actor`) consumes T8-1's renamed payload fields directly — no joining required. AC #1 (no own poll) honors T8-2's singleton invariant. All twelve route mappings resolve against routes that exist today in `apps/tournament-web/src/routes/` (verified by grep — leaderboard, money, bets, gallery, score-entry).

**Does T8-4 (Award Trigger Surfaces) build cleanly on top?** Yes. T8-4 needs three things from T8-3:
1. `award.triggered` rendered in the feed → ✓ (icon 🏆, headline "First {birdie|eagle} of the trip — hole {N}!", route to leaderboard).
2. `award.triggered` visible in the toast → ✓ (T8-2 + T8-3 helper migration both already cover this).
3. The actual production emit path → that's T8-4's own scope (awards service inside the score-commit transaction).

**One subtlety worth recording:** T8-3 already has `award.triggered` in the route-mapping table + headline helper, but T8-1 confirmed there's no production producer yet. The integration test stubs an award row into the feed; production rows materialize when T8-4 wires up the awards service. T8-3 is therefore "ready for award visibility on day-1 of T8-4 ship".

**Verdict: PASS.** AC matrix complete; T8-4 unblocked.

---

## 🏗️ Winston — Architect

The headline-helper consolidation during T8-3 was the right time. Two existing inline copies (Toast, Banner) plus one new copy (Feed) hit the rule-of-three threshold for extraction; deferring would have produced four inline copies by T8-4 (which adds award-specific surfaces). The migration was *mechanical* — externally observable copy preserved, T8-2 component tests pass without modification — confirming the abstraction was tight, not premature.

The two-stage Load more (local slice → backfill) is sound design, not a footgun. Local-first is battery-friendly + spotty-cell-friendly: tap Load more, see 20 more rows instantly from cache; only when cache exhausts does the network fire. The `loadingMoreRef` synchronous guard plus `loadingMore` state for UI is the standard React pattern for double-click-resistant async handlers — correctly applied.

**`safeNumber` + missing-roundId guard:** both impl-codex round-1 fixes are defense-in-depth that COSTS nothing in normal operation (T8-1 Zod validates everything). They guard against a future schema relaxation or a bypass-the-emitter regression. Right posture.

**One nuance:** the `nowMs = Date.now()` computed at render time means relative-time labels stale until the provider's 5s tick triggers a re-render. For "30s ago" → "1m ago" transitions, that's invisible to users; for "59s ago" lingering as "59s ago" past 60s, it's a sub-second-late label. Acceptable for trip 1.

**Verdict: PASS.** Architecture sound, abstractions appropriately timed.

---

## 📋 John — Product Manager

T8-3 closes the user-visible engagement loop. A trip player pulls their phone out between shots, opens the Event home page, and sees:
- The countdown (existing T7-1).
- The four entry cards (existing T7-1).
- **NEW: "What's Happening" feed showing the latest 20 events with icons, headlines, and relative time.**

Plus the live tickler from T8-2's Toast/Banner that fire when scoring lands. The feed is the historical record; toast/banner are the immediate awareness. Pull-not-push fully satisfied (FD-5).

**Trip-day risk: LOW.** The feed renders an empty-state card before scoring begins, so trip-day-morning visitors see "Activity will show here once scoring starts." rather than a confusing blank. Once scoring lands, the feed populates within 5s.

**Player-name hydration deferred to v1.5** (consistent with T8-2's posture). Feed shows raw `playerId` strings — small foursome, organizer-mappable mentally. **First polish item if trip player count grows past 12.**

**Verdict: PASS.** End-to-end value delivered.

---

## 🧪 Quinn — QA Engineer

41 new tests is appropriate for the surface. Specific shape:
- 30 headline helper unit tests (toPar mapping × per-surface copy × score-correction × bet/subgame dollars × scorer-transferred shape × uniform-copy types).
- 11 ActivityFeed component tests covering all 10 AC #10 cases plus the "empty-state precedes cursorBefore" edge case.

**On the relative-time test's no-fake-timers approach:** I flagged this as a concern. `vi.useFakeTimers()` blocks TanStack Router's async route mount → `findByTestId` hangs → 5s timeout. The fix uses `Date.now()` arithmetic (timestamp = `now - 5_000` etc.) so the gap between fixture creation and component render is microseconds. **Slightly brittle if test machine is heavily loaded** — a 200ms render delay would push "5s ago" → "5s ago" still passing, but a 30s delay (impossible in practice) would flip "5s ago" → "30s ago". Trip-day CI machines aren't anywhere near that loaded. Acceptable.

**The mock-useActivityFeed pattern in events.$eventId.index.test.tsx** is also a slight test-isolation concession. It tests that the feed surface mounts (empty state visible) without testing the feed's internals. Sufficient for the wiring AC; the feed's own test file owns the internals.

**Mild logged followup:** if the "renders the right label for each fixture-time bucket" test ever flakes in CI, switch to a render-time mock of `Date.now` instead of timestamp-arithmetic. Not blocking.

**Verdict: PASS** with one logged followup.

---

## 💻 Amelia — Developer Agent

Code smells minimal. The route-mapping + icon tables are pure data, lightweight, and live next to the only consumer (FeedRow). Extracting to a separate `activity-routes.ts` would be premature — they don't have other consumers and the inline form is grep-able.

**The 3-step Load more handler** is 18 lines of `useCallback`. Reads cleanly. The synchronous-ref-plus-state double-guard is the load-bearing complexity; without it, rapid double-clicks fire two simultaneous loadMore() calls (codex impl-codex round-1 High #1 from T8-2 was a similar issue).

**Migration of Toast + Banner to the helper** was painless — 4 edits across 2 files, same externally-observable copy. Existing T8-2 tests passed without modification. That's the cleanest possible refactor signal.

**Maintenance burden:** new files = 4 (helper + helper test + feed + feed test). Modified = 4 (toast + banner + index.tsx + index.test.tsx). One yaml + one spec md. Total scope ~10 files; smaller than T8-2's 22 and T8-1's 28. The cycle gets faster as the spine matures.

**Verdict: PASS.** Healthy maintenance posture.

---

## 🎨 Sally — UX Designer

Walking the trip-day surfaces:

- **Empty state**: "Activity will show here once scoring starts." — clear and reassuring. Sets expectation without being condescending. ✓
- **Live event prepend**: a birdie commits → row appears at top with 🏌️ icon + "{playerId} scored 3 on hole 11 — birdie" + "just now". 5 seconds later: "5s ago". 1 minute later: "1m ago". Natural rhythm.
- **Score-correction inline**: "Corrected by p-organizer: p-rick hole 7, 5 → 4". The arrow `→` is a nice clarity beat. The literal `p-organizer` and `p-rick` UUIDs are the awkward part — same v1.5 player-name-hydration concern as Toast/Banner. **Readable for trip-1 mentally-mappable foursome; needs hydration past 12 players.**
- **Tap routing**: tapping a press row → navigates to /money. Tapping a score row → /leaderboard. Intuitive surface routing.
- **Load more button**: simple "Load more" / "Loading…" toggle. Clear affordance. Hidden when end-of-history. ✓

**One UX call I want flagged for v1.5:** the icon column emoji are a touch dense (13 distinct emoji across types). On a small screen with many rows, they read OK but could use slightly more spacing or a faded-color treatment. Trip 1 acceptable; v1.5 polish.

**Verdict: PASS** with the player-name hydration on the v1.5 priority list (now 4th time logged across T8-2/T8-3 — should bubble up).

---

## 🤝 Synthesis & Recommendation

### Verdict: **PASS — proceed to commit.**

All 6 personas land on PASS. Test coverage is appropriate; architecture honors the existing T8-2 contracts; PM/architect agree T8-4 is unblocked; UX confirms trip-day surfaces are coherent (with player-name hydration the recurring polish item).

### Required changes

**None.** No blocking findings from any persona.

### Optional polish (logged for v1.5+, NOT for this story)

1. **Player-name hydration in Toast/Banner/Feed** (UX, repeated 3rd time) — should be the v1.5 #1 priority.
2. **Icon column visual treatment** (UX) — slightly more spacing or color treatment if many rows render simultaneously.
3. **Time-tick re-render** (Architect) — relative time labels stale until next provider poll. v1.5 could add 30s tick if "1m ago" lingering as "59s ago" becomes annoying.
4. **Render-time `Date.now` mock for relative-time test** (QA) — if CI flakes ever appear, swap timestamp-arithmetic for a `vi.spyOn(Date, 'now')` approach.

### Disagreements between personas

**No substantive disagreements.** All persona concerns surface as v1.5 polish items, not blockers. Player-name hydration is the recurring theme — repeated 3 times now (T8-2, T8-2 codex round-3, T8-3) — strong signal it should be prioritized in v1.5.

### Director: proceed to step 9 (codex-review the party output) and then step 10 (commit).
