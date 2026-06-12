# Tournament — Full E2E Run-Through Script (T14-5)

**Purpose.** A structured manual walk of the complete organizer→scorer→player lifecycle against a real instance (prod or a staging copy), so a single sitting exercises every seam and logs every defect as a new story. The automated suites (T14-1/2/3) now guard the happy path in CI; this run-through is where NEW gaps surface. Run it after each significant change and before any real event.

**How to use.** Work top-to-bottom as the named role. For each step, record PASS / FAIL + notes in the Bug Log at the bottom. A FAIL becomes a new `T13-x` (prod defect) or `T14-x` (test gap) story.

---

## Pre-flight
- [ ] Decide target: **prod** (`tournament.dagle.cloud`) or a **local seeded copy** (`apps/tournament-web` Playwright harness boots one — `pnpm --filter @tournament/web e2e` leaves a seeded api on :3000 / web on :5173 while debugging).
- [ ] Two devices ready if possible: organizer's phone + a second phone (a "player").
- [ ] Note the build/deploy timestamp (PWA stale-bundle check — a hard refresh per device before starting).

## A. Organizer — event setup (browser or phone)
1. [ ] Sign in with Google → land on home (not a 403 dead-end — regression guard for T13-1).
2. [ ] Create an event (name, dates, timezone, one round w/ course + tee).
3. [ ] Open the event admin → confirm the auto-created group + event_round + invite link exist.
4. [ ] Build the roster: add ≥4 players — mix of **manual** (name + handicap) and **GHIN** lookup. Confirm each lands in the roster.
5. [ ] Open Pairings → set at least one foursome → **lock** it.

## B. Player — invite claim (second device / incognito)
6. [ ] Open the invite link anonymously → see the event + roster.
7. [ ] Tap your name → "Welcome" + device registered (device binding). 
8. [ ] (If testing SSO consolidation) sign in with Google on that device → confirm you're not bounced to the conflict page and the same identity is retained.

## C. Organizer — start the round
9. [ ] Open **Start round** → pick a **scorer per foursome**.
   - ⚠️ **Known gap T13-3:** designating the *organizer* (who is NOT a pairing member) as scorer lets the round start but the scorer then CANNOT score (score-entry shows "This round isn't available to you"). Until fixed, **designate a logged-in foursome MEMBER as scorer.**
10. [ ] Start → you're routed to score-entry for the new round.

## D. Scorer — score entry (the installed-PWA path)
11. [ ] On the scorer's device, confirm the app is **installed** (Add to Home Screen) — score entry requires standalone (FR-E9). In a plain tab you'll correctly see "Install to score."
12. [ ] Enter all players' gross for hole 1 → Save → "All synced".
13. [ ] **Offline drill:** enable Airplane Mode → score the next hole → Save → confirm it shows "queued" (not an error). Re-enable network → confirm it drains to "All synced".
14. [ ] Scorer **handoff:** hand off to another foursome member → confirm they can now score and you go read-only.
15. [ ] Score through 18 (or enough to complete).

## E. Money / bets / presses (during play)
16. [ ] File a **manual press** (teamA/teamB) while holes remain → confirm it fires + can be undone before the hole completes.
17. [ ] Open **Money** (H2H matrix / settle-up) → confirm it reflects play (winners positive, losers negative, anti-symmetric).
18. [ ] Create an **individual bet** between two players → confirm it appears with live per-round standing.

## F. Player experience (read-only device)
19. [ ] Leaderboard updates as scores land.
20. [ ] Schedule, course preview, activity feed, photo gallery all load (no dead-ends / 403s).

## G. Organizer — close out
21. [ ] Make a **score correction** on a finalized-soon hole → confirm audit/history records it.
22. [ ] **Complete** the round (blocks on missing cells — confirm the missing-cell list if any) → **Finalize**.
23. [ ] Confirm sub-games computed + the round reads finalized everywhere.

---

## Automated driver

`apps/tournament-api/src/db/e2e-runthrough.ts` is the executable API-side
run-through (run via `node --import tsx` with placeholder env + a temp
`DB_PATH`). It builds a realistic event (4-player foursome, real tees + 18
holes, a rule set, a cross-player bet), scores all 18 holes over real HTTP,
then dumps + sanity-checks every read surface (leaderboard, money split,
my-money, foursome-results), exercises the scorer policy, and finalizes —
flagging any reconciliation break inline (`!!`).

## Run log

- **2026-06-12 (automated API run-through, all of this session's work):** CLEAN
  — no bugs. Verified end to end: money `team + individual = combined` for all
  4 players; My Money loss-less and == each player's combined total; foursome
  results per-hole money sums to the team total and each player's half-share
  flows correctly; scorer policy GET/PUT + stranger-designee 400; press-after-
  full-round 422; complete → finalize → `finalized`. The browser half (PWA
  install, on-phone scoring, offline at the course) remains Josh's manual pass.

## Bug Log

| # | Step | Role | Expected | Actual | Severity | New story |
|---|------|------|----------|--------|----------|-----------|
| 1 | C-9 | Organizer/Scorer | Organizer designated as scorer can score the foursome | 404 "not available to you" — organizer-scorer cannot score (score-entry resolves foursome by membership only) | High | **T13-3** (fixed) |
|   |      |      |          |        |          |           |

> Add a row per finding. After the run, convert each FAIL into a `T13-x`/`T14-x` entry in `sprint-status.yaml`.
