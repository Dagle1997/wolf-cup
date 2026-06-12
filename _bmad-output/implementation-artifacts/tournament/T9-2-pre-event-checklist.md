# T9-2 — Pre-Event Checklist (resurrected by T14-5)

Operational walkthrough to run the day/hour before a real event. Deferred from the BMAD cycle 2026-05-07 as procedural prep; resurrected here as a fill-in artifact so the on-course drill is structured, not ad-hoc. Tick each box; record anything that fails as a new `T13-x` story.

## 24h before
- [ ] Latest build deployed to `tournament.dagle.cloud`; note the deploy timestamp.
- [ ] `/api/health` (or `/api/auth/status`) returns 200 on the VPS.
- [ ] Event created, dates/timezone correct, course + tee set on each round.
- [ ] Full roster entered (manual + GHIN); handicaps sane.
- [ ] Pairings set and **locked** for round 1.
- [ ] Invite link tested anonymously (claims a test name, then remove that binding).
- [ ] Press feature flag intended state confirmed (`TOURNAMENT_PRESSES_DISABLED` — presses ON unless decided otherwise).

## Morning-of
- [ ] Each scorer's phone has the app **installed** (Add to Home Screen) and opens in standalone.
- [ ] Each scorer hard-refreshes once (drops any stale service-worker bundle).
- [ ] Each scorer can sign in and reach their foursome's score-entry (NOT "not available to you" — see T13-3; scorer must be a foursome member).
- [ ] Organizer can reach Start Round and sees every locked foursome.
- [ ] One end-to-end smoke on a throwaway round: start → score a hole → leaderboard updates → cancel/clean up.

## First tee
- [ ] Round started; correct scorer designated per foursome.
- [ ] Confirm hole 1 scores save + sync on each scorer device.
- [ ] Offline drill on at least one device (Airplane Mode → score → reconnect → drains).

## Escape hatches (know before you need them)
- Stale bundle: swipe-down hard refresh, then it sticks.
- Scorer can't score: confirm they're a foursome member (T13-3) and the round is started.
- Wrong scorer: organizer/scorer can hand off via the score-entry handoff control.
- Bad score: organizer can correct via the correction endpoint (audit-logged), even after finalize.
