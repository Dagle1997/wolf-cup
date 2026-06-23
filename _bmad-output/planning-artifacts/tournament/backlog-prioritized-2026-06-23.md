# Tournament — Prioritized Backlog (2026-06-23)

Consolidates everything surfaced in the 2026-06-23 F1/brochure session + the
standing deferred items. Companion to `event-setup-ux-backlog.md` (older list)
and the per-topic memory notes. **Trip: Pete Dye Invitational, Jun 26–27.**

> **The one decision that re-ranks the top:** *Will the app be used to SCORE and
> run REAL F1 Guyan money at Pete Dye, or is the trip paper/best-ball-pot only?*
> If the app runs real money → P0 (net basis + score-entry) is the most important
> work before the trip. If not → everything below is P1 or lower.

---

## P0 — Trip-critical (only if the app runs real money/scoring at Pete Dye)

1. **Net basis: off-the-low vs full course-handicap (MONEY CORRECTNESS).** The F1
   engine settles net off each player's FULL course handicap. The group plays
   **off the low** (like the Wolf Cup bets). If they diverge, real money is wrong.
   Decide + likely add a config option (off-the-low) before any real F1 money.
   *(Flagged pre-F1-launch in memory; affects skin gate + net-skins levels; claims
   unaffected.)*
2. **Organizer can reach score-entry.** After the PWA install gate, there's no
   obvious path back to the live round's score entry; a started-but-future-dated
   round shows "starts in N days." Surface a "Score the live round" entry on the
   event/home; show "Live now" when the round is `in_progress`.
   *(memory: organizer-score-entry-path)*
3. **Score-entry save lag (~20 s).** The offline-sync round-trip blocks the Save
   button / hole advance; painful for phone scoring at the course ("Wolf is
   seamless"). Investigate the T5-3 IndexedDB queue / sync path.

---

## P1 — High (the UX/IA Josh reacted to most)

4. **Games & money setup IA rework** *(design + build, a small epic).* Three money
   systems overlap confusingly (F1 Guyan rules / Bets / legacy sub-games):
   - Build **Story 2.7**: Guyan setup with the rule-option pills — polie =
     bogey-or-better, sandie = up-and-down, greenie carryover, "don't pay nets"
     (display/config even where money is count-based). *Never built.*
   - **Move polie/sandie OUT of the sub-games admin** (they're Guyan rules), and
     gut sub-games down to maybe skins (putting → Bets?).
   - **Fix the missing admin Bets entry** (the route exists; the nav link/access
     is absent — "as an individual it says admin can add"). *(memory: games_money_setup_ia_rework)*
5. **Score-entry functional: auto-advance on Save + working prev/next hole nav**
   (the top dots look like a carousel but do nothing; Save doesn't advance).
   *(memory: score_entry_ux_overhaul_feedback)*

---

## P2 — Medium (polish / quick wins)

6. **Blank PWA icon (quick win).** `apps/tournament-web/public/icon-192.png`
   (593 b) + `icon-512.png` are blank placeholders → blank home-screen tile.
   Generate a real icon (dark tile + golf flag / "PD" monogram) or use a logo.
7. **Show PH/CH on score-entry** (currently shows HI; surfacing the pinned course
   handicap needs the round-detail API to return per-player CH).
8. **Leaderboard expanded-card To-Par/$ scroll-off.** When a per-player card is
   expanded, the wide hole-grid pushes the row's To-Par/$ columns off-screen
   (collapsed view is fine). Constrain the expanded grid width. *(3-4a minor)*
9. **Global favorite players / saved roster.** Stop rebuilding rosters every event
   — reuse an existing admin group, "import from prior event," or a "my regulars"
   list. *(memory: feature_request_global_favorite_players — check the existing
   admin-groups reuse path first)*
10. **Future-date banner on a started round** → "Live now" when `in_progress`
    (folds into #2).

---

## P3 — Engine / correctness / completeness (deferred, lower urgency)

11. **Story 3-5** — weekend standings, sortable Total Money / Net-to-Par /
    Individual (the scoreboard-rework View 2). The leaderboard now has the data
    (netToPar + moneyCents from 3-4a).
12. **3-4a test-debt** — an F1-pin `netToPar` out-of-play service test (harness
    lacks F1 seeding) + a route-level `moneyCents` HTTP test.
13. **money-detail `computeF1FoursomeResults` + My-Money per-hole fills** (3-3
    deferred — same `Ledger.perHole` primitive; currently show correct round-level
    money, just no per-hole breakdown).
14. **F1 Epic 2 remainder** — 2-5 (birdie net/gross variant), 2-6 (payout cap),
    2-8 (Wolf-Cup cross-validation golden). *(2-7 rules-page is pulled into #4.)*
15. **lockState null-default exposure policy** — decide whether an F1 event with
    an unset `lock_state` defaults to money-mode ('locked', today) or scores-only;
    cross-cutting (leaderboard / matrix / chokepoint / write path all agree today).

---

## Suggested sequencing

- **If the app runs at Pete Dye:** P0 #1 (net basis decision) → #2 (score-entry
  access) → #3 (save lag), this week.
- **Otherwise / after the trip:** the IA rework (#4) is the highest-leverage
  single effort (it's what frustrated Josh most), with the quick wins (#6, #10)
  picked off alongside. Then #5, then P2/P3 as capacity allows.
