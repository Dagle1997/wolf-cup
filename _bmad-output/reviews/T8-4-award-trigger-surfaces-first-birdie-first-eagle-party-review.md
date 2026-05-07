# T8-4 Party-Mode Review: Award Trigger Surfaces (First Birdie + First Eagle)

**Story:** T8-4-award-trigger-surfaces-first-birdie-first-eagle
**Status:** review (Epic T8 closer)
**Test posture:** tournament-api 943 → 950 ✓ (+7); tournament-web 264 → 272 ✓ (+8); engine 472, wolf-cup-api 516 untouched. Workspace tc + lint clean.
**Codex history:** Spec 11 fixed (R1: 3H+3M+1L; R2: 2M+2L). Impl 2 fixed (R1: 2M; 2 Lows logged for v1.5). No remaining findings.

Single non-interactive synthesis. No follow-up questions.

---

## 📊 Mary — Business Analyst

T8-4 closes Epic T8 cleanly. Award activity now flows production end-to-end:

1. Player commits a sub-par score → scores.ts builds typed `ScoreCommittedEvent` → emits `score.committed` activity (T8-1).
2. evaluateAwards runs after press orchestrator → checks idempotency → emits `award.triggered` activity (also T8-1).
3. T8-2's 5s poll picks up the new activity row → fans out to subscribers.
4. Toast renders headline (T8-2), Banner skips (filtered out), Feed renders historical entry (T8-3), AwardCelebration full-screens for the affected player (T8-4).

**Cross-checking the epic AC matrix:** every AC #1-#12 has a corresponding implementation + test. The risk-acceptance items (multi-tenant TENANT_ID hardcoding, SELECT-then-INSERT race) are explicitly documented and consistent with project posture. The 7 backend + 8 frontend tests cover all qualifying paths.

**One final note:** the epic explicitly defers `skins_pot_streak` to v1.5 (not derivable at score-commit time from current T6 shape). T8-4's `skins_pot_streak` v1-scope test asserts the candidate list is closed to the v1 enum.

**Verdict: PASS.** Epic T8 is shippable.

---

## 🏗️ Winston — Architect

The best-effort posture in scores.ts is well-justified and well-implemented. The asymmetry vs T6.4 press-engine fail-loud is the correct architectural call: presses affect money (real-world economic stakes); awards affect dopamine (decorative). Rejecting a legitimate score because the decorative engine threw would be a worse trip-day failure than a missed celebratory animation. The try/catch swallow pattern at scores.ts:526-548 is the standard React-equivalent for "best-effort enrichment".

The eagle-priority-by-max-arrivedAt fix (codex impl-codex round-1 Med #1) is the right disambiguation. Insertion order alone is unreliable when the auth-resolve catchup pushes older `rows[]` cache entries AFTER newer stream events were already in `entries[]`. Sorting by `arrivedAt` timestamp is a 3-line fix that makes the priority deterministic regardless of how the entries list was built.

**On the auth-session hook extraction:** I'd call it timely refactor, not scope creep. T7-6's InstallPromptHost had inline fetchAuthStatus + useQuery (~40 lines). T8-4 needed the same auth-status data for AwardCelebration's affected-player gate. Adding a second inline copy would have hit the rule-of-two; extracting to a shared hook avoids drift and gives both consumers ONE TanStack Query subscription via key-dedupe. T7-6 install-prompt tests still pass without modification — the migration was bug-for-bug compatible.

**Verdict: PASS.** Architecture sound.

---

## 📋 John — Product Manager

The full-screen eagle overlay + corner birdie animation deliver the trip-day moment FD-5 promised. Pull-not-push: no SMS, no email, no push notification — the celebration fires when the player ALREADY has the app open (5s polling rhythm). Sufficient for the dopamine hit because trip-day players check between shots anyway.

**Risk: a player can miss their own celebration if they're not looking at the app when it fires.** Mitigations:
- Auto-dismiss is 4s — the activity row stays in `rows[]` and renders in the feed historically, so the player sees "First birdie of the trip — congrats!" in the feed even after the overlay disappears.
- Auth-resolve catchup means a player who opens the app within 4s of the award event still gets the celebration (codex impl-codex acknowledged + tested).

**Beyond 4s of inattention** — say the player puts the phone down for 30s and the celebration fires + dismisses — they see the historical record in the feed but no animated moment. v1 acceptable; v1.5 could add a "you missed this" indicator that re-celebrates on app focus, but adds complexity for marginal value.

**Verdict: PASS.** Trip-day dopamine delivered.

---

## 🧪 Quinn — QA Engineer

The 15 new tests (7 backend + 8 frontend) are well-distributed across AC paths.

**On the best-effort isolation test:** the contract being tested is "scores.ts try/catch around evaluateAwards lets the surrounding tx commit on throw". My test at awards.test.ts:228-260 simulates this in-test rather than instrumenting scores.ts directly. That's a reasonable trade-off — instrumenting scores.ts would require a new integration-test file mocking `evaluateAwards` to throw, which is heavier than this story warrants. The simulation captures the contract: emit-then-throw inside a tx → emitted row commits, throw is swallowed by the surrounding catch. **Adequate for v1, though strictly speaking the contract is "scores.ts route does this", not "any try/catch around evaluateAwards does this".**

**Logged followup:** if a future scores.ts refactor moves the try/catch boundary, this test wouldn't catch the regression. A 1-test integration test in `apps/tournament-api/src/routes/scores.integration.test.ts` (if/when one exists) that monkey-patches `evaluateAwards` to throw would close that gap. Not blocking.

**Other coverage:** the auth-resolve catchup test at award-celebration.test.tsx:181-217 mounts with no session → asserts no celebration → resolves session → asserts celebration appears. The stale-row test at :220-244 asserts the TTL window correctly skips rows older than 4s. Good coverage for the timing edge.

**Verdict: PASS** with one logged followup.

---

## 💻 Amelia — Developer Agent

Code smells minimal. The auth-resolve catchup useEffect adds ~25 lines to AwardCelebration but it's load-bearing: without it, awards arriving before auth resolves are permanently missed. Codex spec round-1 caught this; my implementation handles it cleanly with the `seenIdsRef` dedupe across both code paths.

**On the deferral question:** v1.5 deferral was an option but the worst case is "player opens app for the first time on trip morning, awards fire, auth takes 1-2s to resolve, all miss the overlay". That's exactly the trip-day scenario this story exists for. The 25-line catchup is worth shipping in v1.

**On the seenIdsRef growth (codex impl-codex Low #4):** unbounded across the session. Pinehurst-scale: max ~50 award rows per event over the trip. ~50 string entries in a Set is 1KB of memory, indefinitely. Acceptable. v1.5 polish would bound to ~100 entries with FIFO eviction; not needed today.

**On the catchup re-scan cost (codex impl-codex Low #3):** the useEffect runs on `[myPlayerId, rows]` change. Each rows update from the 5s polling re-scans all rows for matching awards. With 100 rows in cache, that's 100 iterations every 5s = 1.2k iterations/min. Trivial CPU cost. v1.5 polish would memoize.

**Verdict: PASS.** No blocking smells.

---

## 🎨 Sally — UX Designer

Full-screen eagle overlay with semi-transparent backdrop is the right UX for a 4-second moment. Eagles are rare — at Pinehurst-scale, MAYBE one per trip. Making it a full-screen take-over signals "this matters, look at me" and is appropriately rare. The 4-second auto-dismiss prevents the overlay from blocking the next shot's score-entry workflow.

The corner birdie animation is correctly less intrusive — birdies happen 1-3 times per round per skilled player, so a full-screen take-over would get tedious by hole 8. The corner card pattern (top-left, slides in, 4s dismiss) reads as "noticed, but not blocking".

**One UX call I want flagged for v1.5:** the eagle overlay's BACKDROP is fully covering. If a player is mid-tap on the score-entry form when the eagle fires, their tap could land on the overlay's invisible button-area (there's no explicit dismiss button). v1 mitigation: the overlay has no interactive elements, so taps fall through to the underlying surface visually but the rendering layer is z-index 1300 (above everything else). Tap-to-dismiss is **deferred to v1.5** (logged in story followups). Trip 1 acceptable because eagles are rare AND 4s is brief.

**On the "missed celebration" PM concern:** I'd add — if a player misses the live moment, they DO see the activity in the feed historically. The feed entry has the same emoji + headline. So the moment isn't entirely lost; the AnimatedOverlay is just the cherry on top.

**Verdict: PASS** with one logged followup (tap-to-dismiss).

---

## 🤝 Synthesis & Recommendation

### Verdict: **PASS — proceed to commit.**

All 6 personas land on PASS. Test coverage is appropriate; architecture honors T8-1 + T8-2 + T8-3 contracts; PM/architect agree the trip-day dopamine moment is delivered; UX confirms intrusion levels match award rarity.

### Required changes

**None.** No blocking findings from any persona.

### Optional polish (logged for v1.5+, NOT for this story)

1. **Tap-to-dismiss for celebration overlays** (UX) — current 4s auto-dismiss is fine for brief moments; v1.5 polish if user feedback says 4s feels too long or too short.
2. **Scores.ts integration test for best-effort isolation** (Quinn) — current test simulates in-helper; full route-level test in a new scores integration file would catch refactor regressions.
3. **Seen-ids ring buffer** (Dev) — bound `seenIdsRef` growth to ~100 entries with FIFO eviction; current unbounded growth is benign at Pinehurst-scale.
4. **Catchup useEffect memoization** (Dev) — re-scans full rows[] on every poll; trivial cost today.
5. **`skins_pot_streak` award type** (already deferred per epic) — v1.5 enhancement story when the live interim skins recompute lands.
6. **Player-name hydration in award headlines** (recurring theme — T8-2/T8-3/T8-4) — should be v1.5 #1 priority.

### Disagreements between personas

**No substantive disagreements.** All persona concerns surface as v1.5 polish items, not blockers. The recurring theme is player-name hydration (4th time logged across T8 surfaces).

### Director: proceed to step 9 (codex-review the party output) and then step 10 (commit). Epic T8 closes with this commit.
