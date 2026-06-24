# Tournament — Session Handoff (2026-06-23 evening)

Context can be cleared after this. Everything below is committed **locally on
`master`, unpushed (11 ahead of origin), NOT deployed.** Pushing + `./deploy.sh`
is a Josh action. Trip: **Pete Dye Invitational, Jun 26–27** (~3 days out).

---

## ▶ RESUME HERE — the money-correctness work (P0, "it's real, has to work")

Josh confirmed the app **scores + settles REAL money** at Pete Dye. Two intertwined
money-correctness features remain, both **golden-gated** (hand-calc fixtures
approved before settlement code merges — NFR-C1 + the magnitude discipline in
CLAUDE.md). Full rules in memory `project_pete_dye_money_rules_and_score_entry.md`.

**Do them in this order (allowance changes the CH basis that off-the-low builds on):**

### 1. Handicap allowance % (build first)
- **Not built today** — grep "allowance" = zero hits; everything is effectively 100%.
- **UI:** a FREE numeric **% box the organizer types** at the event/lock level (NOT
  a preset dropdown). **Must be shown to participants** (leaderboard/scoreboard +
  the date-lock screen), e.g. *"Handicaps locked as of [date] at 80%."* Exact Pete
  Dye % is Josh's to enter (he said 80–90; 90% is the usual best-ball number).
- **Engine:** `CH_allowed = round(fullCH × pct)`. This becomes the CH basis
  **everywhere** — best-ball-vs-par (`services/team-standings.ts`), the Guyan/F1
  net (`services/games-money.ts`), skins, every net computation. The pinned CH
  lives in `round_pins.perPlayerHandicapsJson` (`{playerId:{hi,ch}}`); decide
  whether allowance is applied at pin time (store allowed CH) or on read (store
  pct + apply). Pin-time is cleaner for the recompute-on-read money-safety model.

### 2. Guyan 2v2 off-the-low (then this)
- **Currently WRONG:** `services/games-money.ts:~424` computes F1 net as
  `allocateStrokesFromCourseHandicap(ch, si)` off each player's FULL pinned CH.
  No off-the-low logic exists anywhere (only comments noting it isn't implemented;
  see `engine/games/types.ts:79`). `engine/games/compute-foursome.ts` **consumes**
  `hole.net[p]` — it does NOT compute net — so the fix is in the net producer
  (games-money.ts), not the foursome ledger.
- **Rule (Josh):** off the low **of the FOURSOME** (their own group of 4, NOT the
  field). Low man's allowed-CH → 0 strokes; everyone else gets
  `CH_allowed − foursomeLowCH_allowed` strokes, allocated by SI.
- **Keep best-ball-vs-par on FULL allowed CH** — so the two games use DIFFERENT
  net bases. Off-the-low must be Guyan-specific, not a global change.
- Net basis is per-game: confirm skins follow Guyan-low or full (ask Josh if unsure).

**Approach:** likely run it through the tournament-director discipline (spec →
golden fixtures → codex+gemini ensemble → impl → review), or at minimum
golden-gated. Base goldens must stay byte-identical where 100%/no-low is the case.

---

## What shipped THIS session (all committed, unpushed)

Score-entry got a full Wolf-style pass + the trip-scoring UX Josh asked for:
- **Redesign** (`325c1fa`): one elevated card per player, recessed score well
  (depth), bonuses in-card, **Team 1 plain / Team 2 green** 2v2 separation,
  ‹ Prev / Save / Next › with pre-fill on stepping back, ← Event / Leaderboard
  nav, removed dead progress dots. **Greenie gated to par 3** (polie+sandie any
  hole), read live from course par. Bonus toggle colors now MATCH the leaderboard
  scorecard dots (emerald/amber/orange). Names show **"First L."**. **HI · CH**
  under each name (CH threaded into the round-detail API).
- **Optimistic advance-on-Save** (`3833e5b`): Save jumps to the next hole instantly
  (no network wait); forward-mode only.
- **− / + steppers + single-digit immediate advance** (`1274503`): type one digit →
  advance now (no debounce); >9 only via the + stepper (1..20, no advance).
- **Real PWA icon** (`3833e5b`): generated PD tile via
  `apps/tournament-web/scripts/gen-pwa-icon.mjs` (replaced blank placeholders).

Leaderboard / home:
- **Home consolidated 9 cards → 5** (`4dbd504`): Standings + Money **hubs** with
  Wolf-style tabs (new `components/view-tabs.tsx` on all 6 sub-pages); Money card
  gated on a new `moneyEnabled` flag from `GET /api/events/:id`.
- **HI · CH · Thru** subline + **centered To-Par/$** columns; **money banner**
  dropped when money is live (kept only for not-enabled / scores-only).
- **Activity-feed name hydration** (`325c1fa`): the feed/toast/banner showed raw
  player UUIDs — API read service now injects `*Name` fields; headline builders
  prefer the name. Works for all past events, no migration.

Brochure (`reference/Pete-Dye-Invitational-The-App.pdf`, on Slack):
- Full **dark refresh** on the new UI; added a **Score the hole** page; replaced
  the Wolf scoreboard with our dark scorecard; cut the redundant "Beyond" page;
  "Johnny Hotdog loses" theme; **director-reviewed** (codex+gemini, then a final
  codex pass — "ready to send"). Fixes: dates pinned to Jun 26-27, Fair-Play card
  full-width, real names swapped out, "member-guest" → "Pete Dye Invitational",
  Stollie trimmed to one hero mark, **blur box-shadows removed** (Slack PDF
  rendered them as hard grey rectangles). Pipeline: `reference/render-pete-dye-pdf.mjs`
  + `reference/crop-shots.mjs` (crops top app-chrome off the dark shots).
- Brochure capture harness: `apps/tournament-web/e2e/brochure.spec.ts` (+ seed
  `apps/tournament-api/src/db/brochure-seed.ts`, `brochure.config.ts`) → 6 dark
  shots. Run: `npx playwright test --config brochure.config.ts`.

Tests: score-entry 40, leaderboard + hub pages green, API events/scores/activity
green. Typecheck clean both packages.

---

## Other open backlog (see `backlog-prioritized-2026-06-23.md`)
- **P0 #2** organizer reach score-entry — PARTIAL (live CTA + nav added); remaining:
  a started-but-future-dated round still says "starts in N days" not "Live now".
- **P1 #4** games/money IA — home consolidation DONE; still open: Story 2.7 Guyan
  rule pills, move polie/sandie out of the sub-games admin, fix the missing admin
  "Bets" entry.
- **P2:** expanded-card To-Par/$ scroll-off (#8, quick CSS) · global favorite
  players / saved roster (#9).
- **P3:** Story 3-5 weekend standings · 3-4a test-debt · money-detail per-hole
  fills · F1 Epic 2 remainder (2-5/2-6/2-8) · lockState null-default policy.

## Misc decisions captured this session (memory)
- Duplicate event names already supported (keyed by id; list disambiguates by date)
  — `project_duplicate_events_allowed.md`.
- Brochure voice (Johnny Hotdog, "light larceny") stays — the audience is the crew.
