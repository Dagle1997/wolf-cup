# Session Handoff — 2026-06-22 evening (Tournament)

**For:** tomorrow's session · **Prod:** tournament.dagle.cloud (live, healthy) · **Branch:** master

---

## ✅ Shipped + DEPLOYED to prod tonight (all live)
1. **31 commits (last 2 days' F1 work)** — F1 Epic 1 + Epic 2 claim modifiers — pushed to origin/master + deployed. Pre-flight: full local suite green (~2930 tests). F1 stays dormant behind per-event config (existing pages unchanged).
2. **Dark mode → true black** (`9641a74`) — swapped the blue-slate scale for a zero-hue neutral near-black (page `#0a0a0a`, cards `#171717`). Pushed + deployed. ⚠️ **see P0 below — it has contrast bugs.**
3. **Story 3-1 — HoleBadge + scorecard-grid port** (`e691d92`, on origin/master + deployed). Built via ultracode build-fan-out + Codex/Claude review-fan-out. tournament-web tests **370 → 404**. NOT wired into a live route yet (that's 3-4) → no visible change yet. Status `done`.
4. **Demo event seeded on prod** — "Pete Dye — Demo" (`ba5153d1-234d-4ffb-a98a-52c6afb65ed2`): 12 real Wolf Cup players (round 47 gross scores), 6 member-guest teams, 3 foursomes, started round, **216 scores**, **$5 2v2 money**. Seeded via `demo-seed.ts` run in-container (docker cp + exec; data persists in the volume).

## 📦 Committed locally but NOT pushed
- **`0c60773`** (local master) — `demo-seed.ts` + `epic-permanent-stats-audit.md`. Push if you want it on origin.
- **Uncommitted** (working tree): brochure edits (`reference/pete-dye-marketing.html` + re-rendered `Pete-Dye-Invitational-The-App.pdf`), and the review artifacts under `_bmad-output/reviews/` (UI + brochure). Commit these when ready.

## 🔗 Live demo URLs (browse as organizer, via direct link — not on your landing page)
- Leaderboard: `https://tournament.dagle.cloud/events/ba5153d1-234d-4ffb-a98a-52c6afb65ed2/leaderboard` (Matt White & Jay Patterson tied 1st @78; Sean Wilson last @100)
- Member-guest "who's in the lead": `…/team-standings` (Ben McGinnis & Kyle Cox lead +2; Madden & Stoll +6)
- Money ($5 Guyan-style, zero-sum per foursome): `…/money`
- Match play: `…/match-play-standings` · Event home: `…/events/ba5153d1-234d-4ffb-a98a-52c6afb65ed2`
- **Disposable:** delete the whole demo event anytime; re-running `demo-seed.js` is a no-op (idempotent on the event name).

---

## 🎯 Next-session task list (prioritized)

### P0 — Dark-mode contrast fixes (DO BEFORE final brochure shots)
Gemini UI review (`_bmad-output/reviews/tournament-web-ui-review-gemini-2026-06-22.md`) — **2 Highs, both in the new dark mode:**
1. **Live-Round CTA** contrast failure in dark mode (`events.$eventId.index.tsx:228-254`).
2. **Hole badges** contrast in dark mode (`hole-badge.tsx:96-148`) — red/blue/amber notation on near-black.
Plus 4 Mediums: scorecard-grid not wrapped in `ScrollableTable` (`scorecard-grid.tsx`); missing iOS safe-area insets (`global-nav.tsx`); storm-banner state-loss (`tournament-banner.tsx`); sub-44px tap target (`index.tsx:267`). + 2 Lows.
→ The brochure's p4/p5 show dark screens, so fix these first, THEN re-capture.

### P1 — Brochure (the marketing PDF)
- **Native screenshots:** re-capture p2 (hub), p3 (leaderboard), **p4 (scorecard — currently a Wolf Cup shot)**, p5 (money) from the **live demo** per `reference/SCREENSHOTS.md` + `reference/swap-and-render.mjs`. ⚠️ Capturing auth'd prod pages needs an organizer session (the demo organizer or Josh's). Do AFTER the P0 dark-mode fixes.
- **Humor pass (needs Josh):** Gemini brochure review (`_bmad-output/reviews/pete-dye-brochure-review-gemini-2026-06-22.md`) wants more inside-joke energy. DONE tonight: added the **Cuban** joke (money page), real names in the handicap-lock mock, removed redundant handicap item (→ "The Action" side bets), sized down the oversized p4 image, wittier formats footer. **TODO: Josh supplies the "AssTV"-style inside jokes / crew references** for a deeper punch-up (taglines, section labels, Johnny Hotdog page).
- Re-render after any change: `node reference/render-pete-dye-pdf.mjs`.

### P1 — NEW REQUIREMENT (Pete Dye day-of): scorekeeper sets the foursome's Guyan game at round time — NOT pre-locked
Josh, 2026-06-22. The per-foursome Guyan game must be set **by that foursome's scorekeeper on the day of the round**, not locked in advance by the organizer. Flow:
1. Day-of, the **scorekeeper joins and finds their group/foursome**.
2. The app **asks: "Is there a Guyan game for this group?"** If yes → it **presents the Guyan rules**, and the scorekeeper sets:
   - the **$ value** (point value), and
   - the **structure: single total, or segmented front/back** (different stake per nine — e.g. $5 front / $10 back).
3. **Groups may decide in the moment**, so the config **must NOT be locked before the round**. It must stay **editable at least through the front nine; lock no earlier than the start of the back nine** (a hole-10 effective boundary).

Design notes for whoever builds it:
- This is the **F1 foursome-level cascade** (Event → Round → **Foursome**) driven by the scorekeeper, in the "foursomes unlocked" state — the per-foursome game config the F1 design already anticipates. Foursome-internal 2v2 money is self-contained, so per-foursome rule/stake variation is safe (no cross-foursome reconciliation).
- The "lock by the back side" boundary maps to the existing **effective-hole-boundary** mechanic (cf. T5-11 mid-event rule edits): edits to the Guyan config apply, then freeze at the hole-10 turn so the front-nine money isn't retro-changed after it's been played.
- Belongs in the scorekeeper's start-of-round / score-entry surface (not the organizer admin page). Ties to Epic 3 (3-4 leaderboard rework) + the F1 game-config write path (`game-config-write.ts`, `resolve-game-config.ts`).
- **Pete Dye is Jun 26–27 — this is needed for the real trip**, so prioritize ahead of the rest of the F1 backlog if the group will run Guyan games that weekend.

### P2 — F1 director backlog (resume `/tournament-director` or `/loop`)
- Epic 2 remainder: `2-5` (birdie modifier), `2-6` (payout cap), `2-7` (rules page), `2-8` (Wolf cross-validation).
- Epic 3 remainder: `3-2` (scorecard API), **`3-3` (per-hole F1 money — see KEY FINDING)**, `3-4` (leaderboard rework — wires 3-1 into a route), `3-5` (weekend standings).
- Epics 4–6: unbuilt.

### Future (NOT this week)
- **Permanent stats + full audit epic** — `epic-permanent-stats-audit.md` (per-event + global stats tied to GHIN/verified player). Plan via BMAD after Epic 2/3.
- 🔴 **F1 base-net "off-the-low"** — pre-real-money correctness item.

---

## 🔑 Key findings / decisions tonight
- **F1 money and member-guest standings are MUTUALLY EXCLUSIVE in current code.** `computeFoursomeResults` hardcodes per-hole F1 team net to `null` ("Epic 4 — not surfaced", `money-detail.ts:469`); `computeTeamStandings` + `computeMatchPlayStandings` gate on that field, so an F1 event zeroes the standings. **This is the per-hole-F1-money gap = story 3-3 / Epic 4.** The demo therefore uses the **legacy 2v2 best-ball** money path ($5 tenant rule_set) — looks identical to Guyan in the UI, but it's not the F1 engine.
- **"No sqlite" was a false alarm** — only the `sqlite3` CLI binary is missing locally; the app runs on **libsql (= SQLite)** and all data persists (DB_PATH=/app/data/tournament.db on the `tournament_sqlite_data` volume). Tournament already has strong per-event append-only audit (`audit_log`, `score_corrections`, `hole_claim_writes`, `round_pins`; money = recompute-on-read).
- **Gemini** was failing early via user-interrupts (not a server problem) — confirmed working later (`GEMINI_OK`). It reviews CODE only (can't see screenshots), so the "phone screen" visual pass is on-device/Claude, not Gemini.
- **Demo seed mechanism** (reusable): additive `demo-seed.ts` (idempotent on event name, NEVER resets) → local `tsc` build → `scp` to VPS → `docker cp` into `tournament-api` container → `DB_PATH=/app/data/tournament.db node dist/db/demo-seed.js`. No redeploy needed (data persists in the volume).

## 📁 Artifacts written tonight
- Reviews: `tournament-web-ui-review-gemini-2026-06-22.md`, `pete-dye-brochure-review-gemini-2026-06-22.md`, `3-1-holebadge-scorecard-grid-port-*.md`, `3-1-...-party-review.md`.
- Epic: `_bmad-output/planning-artifacts/tournament/epic-permanent-stats-audit.md`.
- Seed: `apps/tournament-api/src/db/demo-seed.ts`.
- Brochure: `reference/pete-dye-marketing.html` + `reference/Pete-Dye-Invitational-The-App.pdf`.
- Story: `_bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md` (done).
