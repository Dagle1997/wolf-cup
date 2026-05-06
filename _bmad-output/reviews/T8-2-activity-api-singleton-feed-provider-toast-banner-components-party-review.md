# T8-2 Party-Mode Review: Activity API + Singleton Provider + Toast/Banner

**Story:** T8-2-activity-api-singleton-feed-provider-toast-banner-components
**Status:** review
**Test posture:** tournament-api 915 → 943 ✓ (+28); tournament-web 204 → 222 ✓ (+18); engine 472 + wolf-cup-api 516 untouched. Workspace tc + lint clean.
**Codex history:** Spec 14 fixed (R1: 2C+2H+2M+1L; R2: 3H+2M+2L). Impl 5 fixed (R1: 1C+1H+2M+1L − 1 v1.5 deferral; R2: 1M). No remaining findings.

Single non-interactive synthesis. No follow-up questions.

---

## 📊 Mary — Business Analyst

The 12-AC matrix is complete and the spine is genuinely usable for T8-3. Cross-checking T8-3's stated needs (player-home feed reading from `useActivityFeed()`, "Load more" via `?before=`):

- T8-3 reads `rows` from context — present, newest-first DESC.
- T8-3 calls `loadMore()` — present (stub-implemented; provider invokes the same `?before=` URL pattern as the spec demands).
- T8-3 needs `cursorBefore` non-null when there's history to scroll back into — codex round-1 Med #3 caught the empty-bootstrap edge case; round-2 fix uses `(prev) => prev !== null ? prev : finalBeforeCursor` so the first non-null capture sticks. Cleanly unblocks T8-3.

**One AC subtlety worth recording:** the spec's AC #1 says "404 when eventId does not exist" but the route's middleware ordering means callers get 403 (no-existence-leak). Codex flagged + fixed; the test name and route comment now both document the observed 403 behavior. The "404" in the AC text is technically aspirational — the security posture wins. Acceptable; logged in the route comment.

**Verdict: PASS.** Ready for T8-3 to build on.

---

## 🏗️ Winston — Architect

The `queryKey: ['activity', eventId]` + cursor-in-refs pattern is the right answer. Putting the cursor in `useState` and including it in the queryKey would create one TanStack Query subscription per cursor advance — the singleton invariant fails. Refs-with-stable-key is a documented TanStack pattern for stateful queryFn closures, and the test verifies the cache shape directly.

The corrupt-row + cursor-advance design is correct under realistic operational scenarios. I sanity-checked the 50%-corrupt case: if 50 of 100 SQL rows fail Zod parse, `decodedRows` has 50 entries but the cursor advances past row 100 (the LAST PHYSICAL row). Next poll's cursor is past all 100 — corrupt rows don't get re-fetched per cycle. The Drizzle test seed for the corrupt-row test exercises this path (1 corrupt mixed with 10 valid; cursor advanced past).

**Architectural concern I want to record but don't think blocks ship:** the `OR (created_at = X AND id > Y)` WHERE pattern is functionally correct but SQLite's planner may not always use the composite `(event_id, created_at DESC, id DESC)` index optimally — tuple comparison `(created_at, id) > (X, Y)` would be friendlier. Codex round-1 flagged Low #5 with a v1.5 deferral. At Pinehurst-scale (low hundreds of rows per event), the difference is unmeasurable. Logged.

**Verdict: PASS.** Architecture sound.

---

## 📋 John — Product Manager

The toast/banner pair lands user-visible value end-to-end on trip day:
- A scorer's birdie commits → emitter writes activity → 5s poll picks it up → Toast renders "🐦 {playerId} scored 3 on hole 11 — birdie!" for 6 seconds. That's the dopamine hit FD-5 was designed for.
- An auto-press fires → both Toast (immediate awareness) AND Banner (persist-until-ack money review) fire. Overlap intentional per Josh call 5.
- Storm-collapse handles the offline-drain replay scenario when a backgrounded scorer reconnects with 3+ queued events.

**Trip-day risk:** the Toast renders `playerId` raw ("rick-uuid-1234..." instead of "Rick"). Acknowledged in the spec followups. T8-3 will hydrate via player-name lookup. For trip 1 the foursome is small enough to mentally map the ID to a name — acceptable. **Worth flagging if the trip player count grows >12.**

**T8-3 unblock:** YES. Provider context exposes `rows`, `cursorBefore`, `loadMore` — exactly the surface T8-3 is specced to consume.

**Verdict: PASS.**

---

## 🧪 Quinn — QA Engineer

34 new tests is appropriate for the surface. Specific shape:
- Backend: 9 cursor unit + 18 route integration. The 250-row burst-drop test is the load-bearing one — it actually proves no events are skipped under burst conditions. The same-timestamp id-tiebreaker test catches the cursor-stability invariant. Corrupt-row test verifies the cursor-advance-past invariant. Good coverage.
- Frontend: 3 provider + 6 toast + 7 banner + 2 hooks-throw-outside-provider = 18. The provider's burst-drop test asserts `fetch` was called exactly 3 times AND rows accumulated to 250 — that's the right assertion shape.

**On the singleton verification approach:** asserting `qc.getQueryCache().getAll().filter(q => q.queryKey[0] === 'activity').length === 1` is the cleanest direct assertion possible. Three consumers, one cache entry — the invariant is the cache shape. Adequate.

**Mild concern (logged, not blocking):** the singleton test only mounts 3 consumers (FeedReader + ConsumerB + ConsumerC). A future regression where 4+ consumers DO produce 4 queries would still pass IF the test never grows. The regression is unlikely (provider design is structural, not count-dependent), but a "10 simultaneous consumers" stress test would tighten the safety net. v1.5 polish.

**Verdict: PASS** with one logged followup.

---

## 💻 Amelia — Developer Agent

Code smells are minimal. The 14-file scope is bounded; the sub-components (cursor, feed service, route, provider, hooks, two components) all have one responsibility each.

**On the popstate + 1s polling fallback for eventId detection:** I'd prefer TanStack Router's `useLocation`/`useParams` for purity, but pulling that into the provider couples the provider to a specific router and forces every test to mount a router. The current popstate + 1s fallback keeps the provider router-agnostic at the cost of ≤1s navigation-detection latency. The toast/banner can wait 1s on event entry without anyone noticing. **Acceptable trade-off; logged for v1.5 if the latency becomes user-perceptible.**

The `setCursorBefore((prev) => prev !== null ? prev : finalBeforeCursor)` pattern (Med #3 fix) is idiomatic — captures-on-first-non-null without churn. Clean.

The ESLint config split (two override blocks for activity-feed.ts vs emitter+tests) is the right level of granularity. I confirmed manually: adding `tx.insert(activity).values({})` to activity-feed.ts fails lint (write-gate stays armed). The fix preserves the safety net.

**Verdict: PASS.** No blocking smells.

---

## 🎨 Sally — UX Designer

Walking the trip-day scenarios:
- **Birdie toast** → "🐦 rick-uuid-... scored 3 on hole 11 — birdie!" — the emoji + verbal phrasing reads natural; the raw playerId is the only friction. Workaround: organizers can just match the UUID prefix to a foursome roster mentally on trip 1.
- **Press banner** → "Auto-press fired (hole 5, teamA 2x)" — clear enough, but the literal "teamA" and "2x" feel a touch programmer-y for a pulled-out-of-pocket glance. v1.5 polish: "Team A pressed (2× stakes)". Not blocking.
- **Storm-collapse summary** → "3 updates (press ×2, rule-edit ×1) — tap to review" — readable. The "×N" notation is dense but acceptable for a glance-and-decide surface. Modal expansion shows full headlines on tap. Good.

**Sub-threshold case (1-2 banner-eligible events in 5s):** falls through to individual banners. Verified by the test "renders an individual banner after the storm window closes" — the timer flushes the pendingBatch as individual entries, not as a 1-event "summary". That's correct UX (no need to collapse a single event into a "1 update" summary).

**Disagreement:** I'd push for player-name hydration in T8-2 itself rather than deferring to T8-3 — raw UUIDs in toasts is the worst part of the user surface. PM accepts the deferral because the foursome size is small enough to mentally map. We disagree but agree the trip can ship without it. **Logged as a v1.5 priority polish item.**

**Verdict: PASS for trip 1.**

---

## 🤝 Synthesis & Recommendation

### Verdict: **PASS — proceed to commit.**

All 6 personas land on PASS. Test coverage is appropriate; architecture honors the singleton + cursor-stability invariants; PM/architect agree T8-3 is unblocked; UX confirms trip-day surfaces are coherent (with one polish item flagged).

### Required changes

**None.** No blocking findings from any persona.

### Optional polish (logged for v1.5+, NOT for this story)

1. **Player-name hydration in Toast/Banner** (UX, PM-aware) — currently renders raw `playerId`. T8-3 will hydrate via `players` lookup; v1.5 could pull this into T8-2 for cleaner trip-day surfaces.
2. **Tuple-comparison WHERE** (Architect, codex Low #5) — `(created_at, id) > (X, Y)` is more index-friendly than the OR-disjunction at scale. Pinehurst-scale doesn't warrant the rewrite.
3. **TanStack Router `useLocation`** for eventId detection (Dev) — drops the 1s polling fallback latency in favor of router coupling. Trade-off, not a clear win.
4. **N-consumer stress test** (QA) — current singleton test mounts 3 consumers; a 10-consumer variant would tighten the invariant safety net.
5. **Banner copy polish** (UX) — "teamA 2x" → "Team A pressed (2× stakes)" reads less programmer-y.

### Disagreements between personas

**UX vs PM on player-name hydration timing:** UX wants it in T8-2; PM accepts deferral to T8-3 given small trip-1 foursome. Synthesis sides with PM (smaller story scope, trip 1 ships) but logs UX's concern as a v1.5 priority item.

**No other disagreements.**

### Director: proceed to step 9 (codex-review the party output) and then step 10 (commit).
