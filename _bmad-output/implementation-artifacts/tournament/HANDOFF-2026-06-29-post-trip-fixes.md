# Handoff — Tournament post-trip fixes (2026-06-29)

## TL;DR
The two trip-killing bugs are **fixed, codex-reviewed, CI-green, and DEPLOYED to
prod**. Prod HEAD `c24398d`, tournament `/api/health` = 200, version bumped.
Three more reported issues remain (claim modifiers, required putts/snake, mobile
score-entry) — none deployed, all need investigation. Start there tomorrow.

## What shipped + deployed today

| Commit | What |
|---|---|
| `c274329` | Date tz fix + group-member scoring gate (the two big bugs) |
| `f181747` | e2e T13-4 updated for the group-member gate |
| `c24398d` | codex hardening: force `hourCycle:'h23'` in tz offset helper |

Deployed via `./deploy.sh` (all 4 containers rebuilt: wolf-cup + tournament api/web).
**No DB migration** in this set — all changes are read-path logic / response fields /
web. Prod verified: tournament + wolf-cup health both 200.

### 1. Date / "day-2 tournament over" — FIXED
`admin.events.new.tsx` `dateStringToEpochMs` was encoding **UTC** midnight (stray
`Z`); the app treats event/round dates as **local** midnight in event.timezone, so
every date stored 4–5h early and "Event complete" flipped the evening before the last
round. Now tz-aware via `Intl` (`hourCycle:'h23'`), threaded `form.timezone` through
all call sites.

### 2. "Anyone in a group can score that group" — FIXED (behavior change)
`resolveScorerGate` (`require-scorer-for-round.ts`) now allows **any pairing member of
the target foursome** to write, in addition to the designated scorer. Web score-entry
gates the form on a new `canScore` flag (API: `scores.ts` GET returns
`canScore`/`viewerIsFoursomeMember`) instead of `isScorer`. Josh's rationale: a
verified, GHIN-/join-code-bound roster member is trustworthy, and every write is
audit-logged (`scores.ts:630`, `SCORE_COMMITTED`, `actorPlayerId`).

> ⚠️ **Behavior-change callout:** this **removes the single-writer guarantee for
> members.** Two members can now both enter a hole → last-write-wins, fully
> audit-logged. The old offline stale-queue 403 (a demoted scorer's queued writes get
> rejected) now applies ONLY to a non-member designated scorer (the organizer-running-
> a-group-they-aren't-in case). Handoff still re-points the designated-scorer pointer
> for that case. This is the intended trade.

## Codex review outcome (high effort, gpt-5.2)
- **Finding 1 [high] — DISMISSED with evidence.** Worried `resolveScorerGate` mishandles
  a NULL `scorerPlayerId`. But `scorer_assignments.scorerPlayerId` is `.notNull()`
  (schema `scoring.ts:236`); the "no scorer" case is row-*absence*, already handled as
  `foursome_has_no_scorer` (422). Members also return ok before reaching that code.
- **Finding 2 [medium] — FIXED** (`c24398d`): forced `hourCycle:'h23'` so midnight never
  formats as "24:00" (24h offset risk on h24 engines).
- **Finding 3 [low] — NOTED, not fixed.** `dateStringToEpochMs` fallback returns `NaN`
  on malformed input, which would stringify to `null` in the payload. Unreachable via
  `<input type=date>` (call sites guard empty strings; type=date only yields valid
  `YYYY-MM-DD`), and it matches prior behavior. If hardened later: return a sentinel
  that fails `step1Valid`/`step2Valid` instead of NaN.

## Verification posture
- typecheck + lint clean (api + web). Full suites green: api 1487 / web 447 / e2e 4.
- **Pre-existing test-infra flake (NOT from these changes):** the full tournament-api
  vitest run intermittently fails a handoff/lifecycle test from a shared
  `file::memory:?cache=shared` DB across files (each passes in isolation; observed on
  clean master too). Worth a separate fix: per-file DB or drop `cache=shared`.

## OPEN for tomorrow (reported live, NOT yet root-caused/fixed)

1. **Claim modifiers (polies/greenies/sandies) didn't show on score entry.**
   They're gated by the round's pinned config `enabledClaimTypes` (`scores.ts:275`+;
   Josh 2026-06-25 "off → don't show"). Hypothesis: the live event's pin had them off,
   or no F1 config was pinned. NEXT: reproduce against the real event's pinned config;
   confirm the setup→pin path actually carries the enabled modifiers through.

2. **Group-2 putts showed but weren't REQUIRED → snake unplayable.**
   Putts input is gated to `putting_contest` participants (`scores.ts:391`+,
   `puttsPlayerIds`) but is OPTIONAL. NEXT: add a "putts required when a putting game is
   active for that player" validation gate on save (web + API), so snake can settle.

3. **Mobile score-entry screen poorly designed (the big one).**
   Still the un-ported original T5 UI (Epic-3 ported only the leaderboard/scorecard
   *display*). Backlog: Wolf-style score-entry port (steppers, single-digit auto-advance,
   prev/next hole nav, PH/CH shown, no wasted space). This is a real story, not a quick
   fix.

4. **Pre-trip dress-rehearsal checklist** (the meta-fix Josh named). A phone-based,
   multi-day, multi-scorer run on a future-dated test event would have caught all of
   the above. Worth codifying as a pre-event gate.

## Where to start tomorrow
Recommend **#1 then #2** (both are config/gating, likely small, high user value for the
next event), then scope **#3** as a proper story. Run codex review before any push
(per Josh). Full detail in the post-mortem:
`_bmad-output/implementation-artifacts/tournament/POSTMORTEM-2026-06-28-live-trip.md`.
