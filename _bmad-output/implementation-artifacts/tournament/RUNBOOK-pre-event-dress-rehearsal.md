# Runbook — Pre-Event Dress Rehearsal (Tournament app)

**Purpose:** the meta-fix from the 2026-06-28 live-trip post-mortem. The app was
"close to good" but couldn't be used correctly during play because there was no
real, phone-based, multi-day, multi-scorer test before the trip. Every bug that
bit us would have surfaced in one rehearsal.

**This is a GATE, not a suggestion.** Do not run a real-money event until every
🔴 box below passes on actual phones. Budget ~45–60 min.

> Each step tags the post-mortem issue it guards (`#1`…`#6`, see
> `POSTMORTEM-2026-06-28-live-trip.md`). 🔴 = blocking; ⚪ = nice-to-have.

---

## 0. Setup — what you need before you start

- [ ] **At least 2 real phones** (3+ is better — one per "scorer"). The single-phone
      test is what hid the multi-scorer bugs last time.
- [ ] **2+ Google accounts** that can log in (one is the organizer).
- [ ] A **future-dated** rehearsal — schedule the test event **2 days out**, and plan
      to re-open the app **on each of those calendar days** (this is the only way to
      catch the date/"day-2-over" class of bug — `#1`).
- [ ] Know the prod URL (`https://tournament.dagle.cloud`) and that health is 200.
- [ ] Decide up front: **is this rehearsal running the Guyan money game with claim
      modifiers ON?** It must be, to exercise `#4`.

---

## 1. Create the event (organizer phone)

Use the **Quick Event wizard** (the path most events will actually use):

- [ ] 🔴 From the organizer home, tap **⚡ Create Quick Event**. (`#6` — confirm the
      hero button is reachable without hunting.)
- [ ] 🔴 **Step 1 — Course & date:** pick Guyan, a tee, **set the date 2 days out**,
      18 holes. (`#1` — a future date must NOT show "tournament over"/"starts in N
      days" in a way that blocks scoring once started.)
- [ ] 🔴 **Step 2 — Players:** add **at least 8** golfers across two foursomes.
  - [ ] Add 2–3 via **GHIN search** (verify live handicap shows, focus returns to the
        last-name box after Add so you can type the next).
  - [ ] Add the rest **manually** with handicaps.
  - [ ] Confirm the roster count is right and no blank rows sneak through.
- [ ] 🔴 **Step 3 — Foursomes:** split into **2 groups** (this is what makes it a
      multi-scorer test).
- [ ] 🔴 **Step 4 — Games & rules:** Guyan **ON**, whole-dollar point value,
      **greenie + polie + sandie + net-skins all ON**, **Putting game ON**,
      **Snake ON**. (`#4`/`#5` depend on these being on.)
- [ ] 🔴 Tap **Start round** → lands on score entry. No error banner.

> Mark which phone/account is the organizer and which players are in which group.
> You'll hand phones to different "scorers" below.

---

## 2. Players join (the OTHER phones)

- [ ] 🔴 On a second phone, a **different player** joins via **join code / invite
      link** and **Google auth**. (`#7` — the auth + code path.)
- [ ] 🔴 That player is a **member of a foursome they did NOT get designated to
      score**. (Sets up the `#2` test.)
- [ ] ⚪ Copy-invite tap-link works (opens straight into join).

---

## 3. Multi-scorer score entry — THE core test (`#2`, `#4`, `#5`, `#6`)

Do this **on the phones**, not desktop. This is where last weekend fell apart.

- [ ] 🔴 **`#2` — group member can score:** on phone 2, the non-designated foursome
      member opens their group and **the score-entry form is visible and writable**
      (gated on `canScore`, not `isScorer`). They enter a hole. It saves.
- [ ] 🔴 **`#2` — concurrent write:** have phone 1 and phone 2 BOTH enter the same
      hole for the same group. Last write wins, no crash, and the change is reflected.
      (Confirm you're OK with this trade — it's intentional.)
- [ ] 🔴 **`#4` — claim modifiers SHOW:** on a par-3 / relevant hole, the
      **greenie / polie / sandie** buttons actually appear on the entry screen.
      *If they don't, STOP* — the round's pinned config didn't carry the enabled
      modifiers, which is exactly the live bug. Re-check the rules step pinned them.
- [ ] 🔴 **`#5` — putts required:** for a putting-game player, try to **save without
      entering putts** → it should be **blocked** (web gate + API 422 `putts_required`).
      Enter putts → saves. (Without this, snake can't settle.)
- [ ] 🔴 **Snake token:** the 🐍 tap-to-take token appears and transfers to a single
      holder. (Display-only / paper-settle is fine.)
- [ ] 🔴 **`#6` — phone ergonomics:** can you see/enter all 4 players in a group
      without excessive scroll? Is there hole-to-hole navigation? Note the save lag.
      *(Known weak spot — log specifics; this is the score-entry-port story.)*
- [ ] ⚪ Steppers / single-digit auto-advance behave as expected.

---

## 4. Multi-day rollover (`#1`) — the part you can't fake

- [ ] 🔴 **Re-open the app on the NEXT calendar day.** The round must still be
      **playable** and must NOT say "Event complete" / "tournament over" early.
- [ ] 🔴 On the **final scheduled day**, confirm the standings/leaderboard read
      correctly and the "complete" state only appears AFTER the last round's day.

> This is the one step a same-day rehearsal cannot cover. Do not skip it.

---

## 5. Leaderboard, money, settle-up

- [ ] 🔴 Leaderboard / scorecard render on a phone; net-to-par and $ columns look sane.
- [ ] 🔴 Guyan 2v2 money reads **off the foursome low** (not full-CH) and the
      whole-dollar point value matches what you set.
- [ ] 🔴 Skins / putting / snake surfaces show; settle-up shows **who owes whom**
      (pairwise), not a payout.
- [ ] ⚪ "The Action" bets (if used) settle into the same pairwise tally.

---

## 6. Sign-off gate

Do not run a real event until ALL 🔴 boxes pass on phones, including the
**next-day re-open**.

- [ ] Every 🔴 above checked.
- [ ] Any failure logged with screenshots and the exact step.
- [ ] If a 🔴 fails: fix → re-deploy → re-run the affected section before the real event.

**Rehearsal run by:** ____________   **Date:** __________   **Event tested against:** __________

---

### Cross-reference: what each phase guards
| Phase | Post-mortem issue |
|---|---|
| 1 (future date, wizard) | #1 date rollover, #6 reachability |
| 2 (join/auth) | #7 auth + code |
| 3 (multi-scorer entry) | #2 member-scoring, #4 claim modifiers, #5 putts/snake, #6 ergonomics |
| 4 (next-day re-open) | #1 "day-2 over" |
| 5 (money/settle) | money correctness (off-low, whole-dollar, pairwise) |
