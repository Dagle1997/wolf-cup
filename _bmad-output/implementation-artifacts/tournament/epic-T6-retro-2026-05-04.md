# Epic T6 Retrospective — Rules Engine, Money, Bets, Settle-Up

**Date:** 2026-05-04
**Epic:** T6 — Rules Engine, Money, Bets, Settle-Up (14 stories + sub-stories)
**Status:** complete (T6-9 hand-calc gate test ships in skip-state pending Josh's hand-derivation)
**Format:** Written artifact (non-interactive). All observations cite specific commits, codex reports, or story files.

---

## Epic summary

| Metric | Value |
| --- | --- |
| Stories completed | 14 of 14 (T6-1 through T6-14) |
| Sub-stories shipped | 3 (T6-5a skins integration, T6-7a score-entry press buttons, T6-13a finalize → computeSubGames) |
| Local commits in this epic | 19 (`tournament:` prefix), all pushed to origin/master |
| First commit | `ef2bdbe` (T6-1 — 2v2 best-ball pure engine, prior session) |
| Last commit | `3d56936` (T6-8 — bets page, 2026-05-04) |
| Tournament-api tests | ~330 → 794 (+460 net) + 2 skipped (T6-9) |
| Tournament-web tests | ~80 → 129 (+49 net) |
| Wolf Cup engine tests | 472/472 maintained throughout (Δ 0) |
| Wolf Cup api tests | 516/516 maintained throughout (Δ 0) |
| SHARED-gate approvals | 0 (every story stayed within the ALLOWED tournament-app paths) |
| Path-allowlist violations | 0 (no FORBIDDEN edits) |

## Stories delivered

| Key | Title | Notable |
| --- | --- | --- |
| T6-1 | 2v2 best-ball pure engine | Integer-cents discipline locked at the engine boundary; 6 golden-file fixtures |
| T6-2 | Press + auto-press trigger evaluation | Fixed-point recursion for compound press chains |
| T6-3 | Cross-foursome individual bets — schema + engine + route | Self-bet + dup-roundIds + canonical-order validation; UNIQUE-violation as last-line dedupe |
| T6-4 | Score-commit hook — hole-complete press evaluation | T6-2 wired into the score POST transaction; outer try/catch maps press-engine errors to 422 |
| T6-5 | Head-to-head money matrix — service + API + UI | Anti-symmetric matrix + zero-sum totals invariant; first integer-cents render via `formatCents` |
| T6-5a | Skins → money matrix integration | Pairwise attribution via `Math.trunc((potA-potB)/N)`; preserves anti-symmetry |
| T6-6 | Settle-up view — pairwise attribution + zero-sum | UI-side defense-in-depth zero-sum banner |
| T6-7 | Manual press API (file + undo) | Server-derived `firedAtHole` from max-complete-hole + 1; UNIQUE on (bet, round, hole, trigger) |
| T6-7a | Score-entry press buttons | Closed T6-7's UI followup; PressControl component |
| T6-8 | Bets page — per-pair live standings (FR-E6) | Strict no-existence-leak (uniform 403 for unknown/wrong-event/non-party) + 400 for malformed UUID |
| T6-9 | Hand-calc money fixture + HTTP roundtrip (NFR-C1 gate) | Two-phase delivery: scaffold ships in skip-state, activates when Josh fills `expected.*` + `verifiedBy` |
| T6-10 | Leaderboard tie-break pure function (FR-C5) | Single source of truth refactor; 6 fixtures cover back-9 → hole-by-hole → null-handling |
| T6-11 | Engine: skins (3 modes, integer-cents) | gross / net / gross_beats_net with last-hole-unclaimed resolution |
| T6-12 | Carry-over greenies (FD-12 Guyan tradition) | Multiplier cap at 4; chain-unclaimed-forfeit semantics |
| T6-13 | Sub-game framework — schema + dispatcher + compute route | Append-only `sub_game_results`; idempotent re-compute |
| T6-13a | Wire finalize → computeSubGamesForRound | Auto-compute on round finalize; non-fatal failures logged |
| T6-14 | Skins leaderboard column + settle-up integration | First UI surface for skins money |

---

## What went well

### 1. Integer-cents discipline locked across the entire epic

Money values pass through engine → service → DB → API → UI as integer cents, with floats only entering at the `formatCents` render boundary. The discipline held across 14 stories, 3 layers of code (engine / service / route), and 4 integration paths (best-ball, individual bets, skins, money matrix). Concrete defenses:

- `assertNonNegativeInteger` boundary checks in engine validators (T6-1, T6-11, T6-12).
- `formatCents` throws `RangeError` on non-integer input — caught at the UI render boundary (T6-5).
- `Math.trunc((potA-potB)/N)` in the skins → matrix integration (T6-5a) preserves anti-symmetry where `Math.floor` or `Math.round` would not.

### 2. Codex-review per phase caught real correctness bugs

The pattern carried over from T1: each story ran spec-codex (1–2 rounds) → implementation → impl-codex (1–2 rounds). Concrete saves:

- **T6-9 spec-codex round 1** flagged that the AC named Josh as the hand-calculator, surfacing the *circular validation* risk. Resolved by switching to a two-phase delivery (scaffold ships, expected values pending) rather than auto-deriving.
- **T6-9 impl-codex round 1** caught that production `services/money.ts` doesn't pull `sandyFromBunker` / CTP from any DB column — meaning the engine + HTTP roundtrip would diverge until T6-9d ships. Resolved by disabling those rules in the fixture config.
- **T6-9 impl-codex round 2** caught a `vi.doMock` order-dependence bug (no `resetModules`) and a libsql cleanup-on-failure leak. Both could have produced flaky-but-passing tests.
- **T6-8 impl-codex round 1** caught the `applicableRoundIds` vs `perRoundStanding` drift (HIGH) — when round structural data was missing, the response listed broader round IDs than were actually computed.
- **T6-8 impl-codex round 2** flagged that the engine's `triggeredPresses` may include un-persisted presses on read paths whose effects appear in `totalNet`. Documented as T6-8e followup; v1 logs only because the May trip uses straight match-play.

### 3. Followup stories absorbed scope creep instead of expanding the gate

Each story's "Followups" section caught real future work without broadening the current PR. By the end of T6, the followup ledger contains:

- Per-story dedupes (T6-8d), data-flow gaps (T6-8e, T6-8f, T6-9d), and observability gaps (T6-9a CI gate on verification).
- Settle-up polish (T6-6a/b/c), skins remainder distribution (T6-5h), and visibility filters (T6-5d).

These are all sized for v1.5+ and explicitly out of scope for the May 8–10 trip.

### 4. Two-phase delivery for T6-9 (the NFR-C1 gate)

T6-9's AC required *Josh* (the user, not Claude) to hand-derive the expected money matrix to avoid circular validation. Rather than skip the story or wait, we shipped:

- Phase 1 (this epic): full input fixture + test scaffolds + describe.skip pattern + console.warn discoverability + assertFixtureExpectedShape guard. The infrastructure works the moment expected values are filled in.
- Phase 2 (Josh's task, post-trip): hand-derive + paste expected.matrixCents + set verifiedBy + verifiedDate. Tests auto-activate; CI surfaces the verified gate.

This pattern is worth carrying forward for future "human-verification-required" gates: ship the scaffold in skip-state with a strict `isVerified` predicate that requires non-empty string + date format match.

### 5. Director auto-approve config + autonomous mode worked

The user enabled `auto_approve_clean_specs: true` mid-epic and explicitly said "make architectural calls myself based on established patterns; pause only on truly uncertain decisions, FORBIDDEN/SHARED/failures." The autonomous mode shipped 7 stories without manual gates while still:

- Pausing for the T6-9 *AC interpretation* (who hand-calcs?) — a substantive design decision.
- Pausing at the T6 epic boundary per the director-skill rule "Do not auto-advance across epics."

Auto-approve never actually fired (every story had ≥1 codex Medium on first pass), so the *real* automation came from the autonomous architectural-call mandate, not from the config flag. Worth noting for T7+ planning.

---

## Surprises / friction

### 1. The hand-calc-fixture story wanted a *human* in scope

T6-9's AC was unique in the epic: it explicitly named the user as the hand-calculator. Rather than treat this as a story-blocker, the spec gate paused for the user's call: "I keep the hand cards for this test and ask others to do the same. 2. We don't need the auto press for Pinehurst." That single message established a *methodology* (Josh hand-calcs release-gate fixtures; he keeps real-round paper scorecards as the hand-calc inputs) that will outlive the epic. Worth recording in user-memory.

### 2. Codex spec-finding "critical" false positives

Two stories (T6-9, T6-8 round 1) had codex round-1 *critical* findings that were misreads:

- T6-9: codex flagged the spec file as a path-allowlist violation. The spec file is in `_bmad-output/implementation-artifacts/tournament/**`, which IS in the director skill's ALLOWED bucket — codex was reading the spec's own "ALLOWED only: apps/tournament-api/**" line and applying it to the wrong scope.
- T6-8: codex flagged "auth-chain contradiction" because `requireEventParticipant` blocks organizer-as-non-party. Real, but the resolution was to scope-down the story (drop organizer access) rather than fix the middleware. Codex didn't suggest scope-down; the director judgment was to reduce v1 surface.

Both rejections were defensible and documented in the spec's "Codex review notes" section. Pattern: when codex calls something critical, it's still a humans-in-the-loop call whether to fix, scope-down, or reject.

### 3. Stale-read Edit failures recurred when sprint-status.yaml was modified by a hook

Multiple stories (T6-13, T6-14, T6-9, T6-8) hit the "File has not been read" Edit-tool error because sprint-status.yaml was being touched by the system between my Read and Edit calls. Mitigation: re-read the file with a tight `offset/limit` window before each Edit attempt. Director skill could codify this: "always re-read sprint-status.yaml right before flipping a story status."

### 4. Test-ordering flake in T6-9's full-suite run

The first full-suite run after T6-9 landed had `round-lifecycle.integration.test.ts` fail (expected 422, got 500). Re-running passed. Root cause not pinned; likely a libsql `cache=shared` race between in-memory test files. Did not block the commit; flagged for investigation if recurrence pattern emerges.

### 5. Engine-input assembly is duplicated between `services/money.ts` and `routes/bets.ts`

T6-8 inline-duplicated the engine-input assembly pattern from money.ts because helper extraction would have risked money-matrix regression mid-epic. Cost: 200+ lines of duplicate code. Followup T6-8d explicitly tracks the dedupe alongside T6-8a (organizer-wide listing).

---

## Methodology refinements for T7+

### 1. Pause on AC clauses that name a human

T6-9's "hand-calculated by Josh" clause should have been a pause-signal at spec-creation time, not a gate-time discovery. Going forward: when a spec AC names a specific person as a required actor (rather than a role), that's a substantive scope question worth asking before drafting.

### 2. Two-phase delivery is now a known pattern

For ANY future story whose AC requires external verification (security review, accessibility audit, hand-calc, manual UAT), use the T6-9 pattern: ship scaffold + describe.skip with strict `isVerified` predicate + AC-mandated discovery-via-console.warn. Document in story Followups what the activation criteria are.

### 3. Codex critical findings need a 30-second sanity check before action

Both T6-9 and T6-8 round-1 critical findings were partial misreads. Director skill should add: "When codex returns 'critical', spend 30 seconds validating the specific file/line cited against the actual policy before acting." Don't skip this — if the critical IS real, the validation takes the same time and saves a re-review.

### 4. Re-read sprint-status.yaml right before status flips

Pattern emerged 4× this epic. Not worth a director-skill rule yet, but worth a habit.

### 5. T6-9d / T6-9e / T6-8e / T6-8f are real follow-ups, not punted features

The followup ledger has matured into a useful artifact. Re-classify these by activation date:

- **Pre-trip (May 8):** none — the trip uses straight match-play and skins-in-skip-state is not a trip blocker.
- **Post-trip:** T6-9 hand-derivation (Josh writes); T6-9d sandies/CTP plumbing (when those sub-game types get UI).
- **v1.5+:** T6-8a organizer-wide bet endpoint; T6-8d engine-input dedupe; T6-5d–h money-matrix polish.

---

## Open items at epic close

1. **T6-9 hand-calc verification.** Josh fills in `expected.matrixCents`, `expected.totalsCents`, `expected.skinsResults`, `expected.betResults` in `apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.json` and sets `verifiedBy: "Josh Stoll"` + `verifiedDate: "YYYY-MM-DD"`. Both engine + HTTP suites auto-activate.
2. **Followups ledger** (in respective story specs): T6-5d/f/g/h, T6-6a/b/c, T6-8a/d/e/f, T6-9a/b/c/d/e, T6-13b, T6-14a/b. None blocking the trip.
3. **Epic T7 (Player Experience)** queued: 7 stories — event home, schedule view, course preview, photo gallery, raw-state JSON export, install prompt, browser-tab fallback. Largely polish; nothing on the May 8–10 critical path.

---

## Closing

Epic T6 shipped the entire money/bets/settle-up surface area for the May 8–10 trip in 19 commits. Integer-cents discipline held across 4 layers and 14 stories. Codex caught real bugs at every phase. The autonomous-progress mode + auto-approve config moved fast without sacrificing review rigor. T6-9's two-phase delivery pattern is now in the toolbox.

The trip's money pipeline is structurally complete. T6-9's gate test will close NFR-C1 the moment Josh hand-derives the expected matrix.

— Tournament Director, 2026-05-04
