# Tournament App — Live-Trip Post-Mortem (2026-06-28)

The Pete Dye / Guyan trip is over. The app was live but could not be used correctly
during play. This captures what broke, the root causes (verified vs. not-yet), what
was fixed today, and what's still open. Evidence-first: every "verified" item cites
a file:line.

## Meta-lesson (Josh's own words)

> "It was close to being good. I just tried to get too many features in last minute
> and didn't run a good real live test."

The single highest-leverage fix for next time is **a phone-based, multi-day,
multi-scorer dress rehearsal** on a future-dated test event before the trip. Every
issue below would have surfaced in one.

---

## Issues reported (live) and status

### 1. Date wrong / "tournament over" on day 2 / date rolled at midnight — ✅ FIXED
**Root cause (verified):** the event-creation wizard encoded each date as **UTC
midnight** via a stray `Z`:
`apps/tournament-web/src/routes/admin.events.new.tsx` — `new Date(\`${s}T00:00:00Z\`)`.
The rest of the app treats event/round timestamps as **local midnight in the event's
timezone** (time-semantics comment in `events.$eventId.index.tsx:14`). So every date
was stored 4–5h early for US zones, and the "Event complete" countdown
(`events.$eventId.index.tsx:126`, `now >= lastRound.roundDate + ONE_DAY_MS`) flipped
at UTC-midnight ≈ 7–8pm ET the evening before the last round.
**Fix:** `dateStringToEpochMs(s, timeZone)` now resolves the real zone offset via
`Intl` and lands on true local midnight; threaded `form.timezone` through all call
sites. Degrades to UTC on an unparseable zone.

### 2. Verification too strict — a join-code holder couldn't score their own group — ✅ FIXED
**Root cause (verified):** the score-write gate (`resolveScorerGate` in
`apps/tournament-api/src/middleware/require-scorer-for-round.ts`) allowed **only the
one designated scorer** per foursome (`scorer_assignments`). A foursome *member* who
wasn't the designee got 403; the web hid the entry form unless `isScorer` and offered
a "Claim scoring" handoff dance.
**Decision (Josh 2026-06-28):** a verified player is attached to a GHIN and bound to
the roster (+handicap) by their join code → trust them. Any member of a foursome may
write for that foursome. Every score write is already audit-logged with the actor
(`scores.ts:630`, `SCORE_COMMITTED`, `actorPlayerId`), so concurrent/contested entry
is fully recoverable.
**Fix:** `resolveScorerGate` now allows any pairing member of the target foursome
(additive — the designated-scorer fallback is retained ONLY for the organizer-as-
scorer non-member case). API GET exposes `canScore`/`viewerIsFoursomeMember`; the
web score-entry screen renders the entry form on `canScore` instead of `isScorer`.
Last-write-wins per (round, player, hole) cell.

### 3. Organizer couldn't score their own group — ✅ ADDRESSED by #2 (+ prior June 26 fix)
If the organizer was *also a player* in a group, #2 now lets them score it (they're a
member). The organizer-who-isn't-playing case was already handled June 26 (`1e867ea`:
pick a foursome via `?foursome=N` + claim).

### 4. Polies / greenies / sandies didn't show on the score-entry screen — ⚠️ NOT YET ROOT-CAUSED
The claim modifiers are gated by the round's pinned config: only modifiers that are
**ON** appear (`scores.ts:275`+, `enabledClaimTypes`; Josh 2026-06-25 "if they're off
they don't show up"). Hypothesis: the live event's pinned config had them off, or
no F1 config was pinned. Needs reproduction with the actual event's pin.

### 5. Group 2 putts appeared but weren't required (snake unplayable) — ⚠️ NOT YET ROOT-CAUSED
Putts input is gated to players in an active `putting_contest` sub-game
(`scores.ts:391`+, `puttsPlayerIds`) but is **optional** — there's no "required when a
putting game is active" rule, so snake couldn't settle in-app. Needs a gating rule.

### 6. Many screens not designed for mobile entry — ✅ LARGELY RESOLVED (audited 2026-06-30)
**Update (2026-06-30 source audit):** the standing "un-ported T5 UI" claim is now
**STALE.** A re-read of `rounds.$roundId.score-entry.tsx` (modified 2026-06-29) shows
the Wolf-style entry rework already shipped — the items listed here as missing are
present:
- Single-digit type → **auto-advance** to next player (L1367–1369).
- **± steppers** for 10–20, no advance (L1374–1391 / L1889–1930).
- **Prev/Next hole nav** + auto-advance to next unscored hole (save bar L2068–2101).
- **Optimistic offline queue** (drains async — not a ~20s sync block) (L1505–1609).
- **Required putts** before Save for putting-game players (L1419–1433).
- **HI always shown; CH shown when the round is pinned** (L1881–1884; pin source
  `scores.ts:254–280, 338`).
- A **way back out of scoring** (← Event / Leaderboard →) + organizer group switcher
  (L1751–1797).

**Only genuinely-open item:** *vertical density* — with putts + snake + bonuses all on,
4 player cards + sticky header + nav + sticky save bar will scroll on a 390×844 phone.
Not a bug; inherent to the feature richness. Worth a device/viewport eyeball, and a
small denser-card follow-up only if it feels cramped. This is NOT the "big port" — that
work is done. (Item 9 / missing-handicap fail-closed decision below is unaffected and
still open.)

### 7. Group-code text entry + Google auth — 👍 worked once auth was fixed (per Josh)

---

## Changes shipped today (LOCAL — not yet committed/deployed)

| File | Change |
|---|---|
| `tournament-web/.../admin.events.new.tsx` | tz-aware `dateStringToEpochMs` (#1) |
| `tournament-api/.../require-scorer-for-round.ts` | group-member gate in `resolveScorerGate` (#2) |
| `tournament-api/.../routes/scores.ts` | GET exposes `canScore`/`viewerIsFoursomeMember` (#2) |
| `tournament-web/.../rounds.$roundId.score-entry.tsx` | entry form gates on `canScore`; handoff control scorer-only (#2) |
| `tournament-api/.../routes/claims.test.ts` | old single-writer test → member-allowed + non-member-rejected |
| `tournament-api/.../scorer-assignments.integration.test.ts` | (i) stale-queue 403 → member-can-still-score 201 |

## Verification
- `@tournament/api` typecheck: clean. `@tournament/web` typecheck: clean.
- Targeted suites green: api scorer/scores/claims (61), scorer-assignments (15),
  web score-entry + admin.events.new (50).
- Full suites green: api 1487 passed / web 447 passed.
- **Test-infra note:** the full api suite has a *pre-existing intermittent flake* from
  a shared `file::memory:?cache=shared` DB across files (a different handoff/lifecycle
  test occasionally fails, each passing in isolation). Observed on both clean master
  and with these changes; not introduced here. Worth a future fix (per-file DB or
  `:memory:` without shared cache).

## Behavior-change callout (for review before deploy)
The group-member gate **removes the single-writer guarantee for foursome members**.
The old offline stale-queue rejection (a demoted scorer's queued writes got 403'd so
their client showed a "your scores were rejected" banner) no longer applies to
members — their writes now succeed (last-write-wins, audit-logged). This is the
intended trade per Josh's "trust verified players + rely on the audit log." The
designated-scorer/handoff concept still governs the organizer-non-member case.

## Still open / recommended next
- [ ] #4 reproduce claim-modifier visibility against the real event's pinned config.
- [ ] #5 add "putts required when a putting game is active" gate (snake).
- [ ] #6 Wolf-style mobile score-entry port (the big one).
- [ ] Commit + deploy these fixes (not done — awaiting Josh).
- [ ] Pre-trip dress-rehearsal checklist (multi-day, multi-scorer, on phones).
