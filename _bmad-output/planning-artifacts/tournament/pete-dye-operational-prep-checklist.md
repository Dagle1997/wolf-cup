# Pete Dye Invitational — Operational Prep Checklist

**Event dates:** Jun 26–27, 2026 (member-guest, 12 players / 6 two-man teams).
**Authored:** 2026-06-18 (inspect-only session; data entry to be done later, closer to the date).
**Decisions (Josh, 2026-06-18):** create a FRESH event for the real trip; archive/cancel the test event; handicap lock **as-of 6/24/2026**.

---

## Prod state observed 2026-06-18 (read-only, tournament.db on VPS)

Two events exist:

| Event | Dates | Status | Lock |
|-------|-------|--------|------|
| `TEST Pete Dye 26` (`e0fe4289…`) | 2026-06-26 → 06-27 | active | none |
| `71 at Pinehurst` (`6fe4b726…`) | 2026-02 | **cancelled** | — |

**TEST Pete Dye 26** has group "TEST Pete Dye 26 Crew" with **7 players** (no manual HI set → all resolve via live GHIN; no per-player tee set):

| Name | GHIN | Status for real event |
|------|------|----------------------|
| Ikie Light | 859178 | TBD |
| Jeff Madden | 1599956 | TBD |
| **Jamie Bailes** | 4913076 | ❌ **NOT coming** (Josh, 2026-06-18) |
| Josh Stoll | 1236376 | ✅ playing (last-minute invite); is the organizer account |
| Dan Earl | 7225172 | TBD |
| Steven Chatterton | 635070 | TBD |
| Alan Thacker | 2909028 | TBD |

→ 6 confirmable players today (7 minus Jamie Bailes). A 12-player member-guest needs **~6 more names + GHINs** from Josh.

Both test rounds: 18 holes, course = **Pete Dye Golf Club** (`c947509d…`).

### ⚠️ Finding to investigate before the real event
The test event's two rounds store **`tee_color = "1"`**, which is **NOT a valid tee** for this course. The Pete Dye revision's real tees are: **Back (73.9/136), Championship (75.5/141), Dye (71.3/130), Dye/Middle (69.3/127), Forward (64.6/118), Middle (68.1/124)**. A tee value with no matching `course_tees` row breaks the slope-aware course-handicap lookup → net/money would mis-compute. **Confirm whether the wizard tee dropdown (B2a) stored an index instead of the tee name; when creating the fresh event, pick a real tee (group plays "Dye").**

---

## Checklist (do later, closer to 6/24)

### 1. Roster finalization (needs Josh input)
- [ ] Collect the full **12-player** list with GHIN numbers (6 known minus Bailes = 5–6 carry over; need the rest + guests).
- [ ] Confirm the **6 two-man team pairings** (member + guest), and that teammates sit in the **same foursome** (slots 1&2 vs 3&4) — this drives `resolveFoursomeTeams`, the 2v2 money, Phase 1 standings, and Phase 2 match-play board.
- [ ] Confirm tee per player (default group tee = **Dye**).

### 2. Create the fresh event
- [ ] Create event "Pete Dye Invitational" (or final name), dates 6/26–6/27, timezone America/New_York, Josh = organizer.
- [ ] Add the 12 roster players (reuse GHINs above where carrying over).
- [ ] Add **2 rounds**, course = Pete Dye Golf Club, **tee = Dye** (NOT "1"), 18 holes each.
- [ ] Build pairings = 3 foursomes; set each foursome's slots so teammates are 1&2 / 3&4.

### 3. Handicap lock
- [ ] On `/admin/events/:id/lock-handicaps`, set **as-of = 2026-06-24** and lock. (Retroactive locking is correct — H1 uses the GHIN revision effective on/before the as-of date, so locking after 6/24 still pins the right value.)
- [ ] Verify the per-player locked-HI table looks right (GHIN provenance shown).
- [ ] Allowance % stays **100%** (no-op) for Pete Dye.

### 4. Archive the test event
- [ ] Cancel `TEST Pete Dye 26` (`e0fe4289…`) via the in-app soft-cancel once the real event is built (reversible, event-scoped).

### 5. Format sanity (already built + deployed)
- Phase 1 (best-ball-vs-par event standings) — live.
- Phase 2 (match-play points board, win=1/halve=0.5/loss=0, foursome-internal) — **deployed 2026-06-18** (`bd13fe3`).
- $50/man winner-take-all pot rides Phase 1; Guyan 2v2 inside foursomes via existing money engine.
- [ ] Confirm `scorer_policy` (test event = `foursome`; pick per-foursome scorer at start-round).
