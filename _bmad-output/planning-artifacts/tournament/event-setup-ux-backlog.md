# Tournament — Event-Setup UX & Rules Backlog

Living backlog from hands-on testing (2026-06-15, Josh). Ordered by priority.
Update as items ship.

## STATUS (2026-06-15, end of session)
SHIPPED + DEPLOYED this session: B1 (GHIN search first-name/club/scroll), member-HI live-GHIN display, pairings increase-crash fix, B2a (round tee dropdown in wizard). Also live earlier: event soft-cancel, wizard "Course not listed?" links, Pete Dye seed, GHIN course import, dark mode. PARKED on branch `feat/handicap-lock`: handicap-lock backend (needs UI+tests). NEXT: B2b (roster per-player tee), B3 (TBD course — needs edit-round-course first), then a BMAD/design session for the F-series (rules/side-games rework) + UI/QOL polish. Josh created a real "Pete Dye" test event, added players, exercised the flow.

## 📋 2026-06-21 testing session — new items, verdicts, F1 architecture (Josh)

**BUILT this session (branch `feat/tournament-betting-story-1.1`, NOT deployed):** A1 (admin page reorder to fill-out order), A3 (landing hides cancelled + past behind a toggle), V1 (version/update banner + `GET /api/version`), R1 (roster search clears the used tab after a successful add). Remaining items below are captured, not built.

Hands-on testing of event + course setup. Verified against code (two Explore audits).
**Deployment context:** the "The Action" betting admin page + the betting UI cohesion pass are on
branch `feat/tournament-betting-story-1.1` (committed `f5c5b5f`, **NOT pushed/deployed**). So "I
don't see the bets admin page / the UI pass" = deployment gap, NOT bugs — the bets link IS wired,
unconditional, at `admin.events.$eventId.index.tsx:212`.

### ⭐ F1 DATA-MODEL PRINCIPLE (ratified — drives the whole rework)
**The player is the atomic unit.** Scores, greenies, polies, sandies all attach to `player_id`
(+round+hole). Teams and matchups are LATE-BOUND compositions over players — re-team Rick from
Stu→Jeff and everything recomputes because nothing is tied to the team/foursome/group. Consequences:
- **Cross-group games fall out for free** (X-GROUP below). The foursome-internal money path becomes
  the special case, not the rule.
- Claim-based items (greenie via tee-on-green, polies, sandies) are **self-verified manual inputs per
  player** — not auto-tracked; v1 = self-report, no opponent confirmation.
- Settle-up already supports this: the betting `SettlementEdge {from,to,cents}` IR is debtor→creditor
  between ANY two players — already cross-foursome. The foursome-internal limit lives only in the
  legacy `money.ts` 2v2 path. → **F1 should compute via the SettlementEdge IR, not the foursome path.**

### X-GROUP. Cross-foursome Guyan game (NEW, F1 requirement; "next trip", not Pete Dye)
Some trips run the full Guyan 2v2 ACROSS foursomes — Rick & Stu (group 1) vs Ronnie & Scott (group 2)
— then reconcile by hand post-round ("low ball 3, team total 8, we had a greenie — what'd you have?").
All hole scores are already tracked → score-based parts (low ball/best-net, team total, net-birdie
points) are fully computable; only greenie/poly/sandie are self-reported. Breaks the foursome-internal
invariant → compute via SettlementEdge IR + arbitrary team scope. Pete Dye likely doesn't need it
(teams are within-foursome). Folds into F1.

### Admin IA + setup flow
- **A1. Reorder the admin event page to fill-out order:** Roster → Rule set → Pairings/Tees → Start
  round → rest. Today (`admin.events.$eventId.index.tsx`) order is Pairings, Rounds, Join codes,
  Who-can-score, Lock handicaps, The Action, Start round, Roster(conditional), Rule set(conditional),
  Sub-games. Roster should be FIRST + always visible (most things flow from it). **QUICK WIN.**
- **A2. Event-creation wizard: ask # of players + optionally seed roster + invites at creation.**
  Today the wizard (`admin.events.new.tsx`) is Basics → Rounds → Review; no player count, no roster,
  no rule-set selection. Medium.
- **A3. Landing page: hide CANCELLED events** (71 at Pinehurst still shows) **+ hide PAST rounds**
  behind a "show past / review stats" toggle. Add an admin "see all events" view (cancelled/past
  visible there only). **QUICK WIN.**

### Capabilities (verified)
- **SMS: NONE** anywhere in the repo. Texting invites = a new paid integration (Twilio/etc.).
- **Email: Wolf Cup only** (`apps/api/src/lib/email.ts`, nodemailer + Gmail SMTP, weekly xlsx
  export). Tournament-api has no email. Reusable for invites but needs porting (extract to a shared
  package + generalize beyond the xlsx shape).
- **Invites today = join-codes (B0, shipped + works).** Recommendation: lean on join-codes; email
  invites = optional later; SMS = only if worth a paid dep.

### V1. Version/update banner (QUICK WIN — port from Wolf Cup)
Wolf Cup polls `GET /api/version` every 60s → "new version — tap to refresh" banner
(`apps/web/src/routes/__root.tsx:19-100`). Tournament has NEITHER the banner NOR a `/api/version`
endpoint. Port both (add `GET /api/version` to tournament-api + the banner to tournament-web
`__root.tsx`).

### Roster QOL + Favorites/Global roster (expands F3)
- **R1. Roster search: clear the name after a SUCCESSFUL add** (not after each search — GHIN search
  needs first-name+club). **QUICK-ISH.**
- **R2. Favorites / global roster** (expands F3): add a player once, favorite them, they appear in a
  dropdown every round. Bigger: **multiple named global rosters** (Guyan group, Wolf group, best
  friends). Today NONE exists — players are only deduped by GHIN (`players.ghin` unique); no
  favorites/global-roster model, **no phone/email on players.** Adding contact info = new PII columns
  + the security/auth hardening Josh flagged. Needs design + decision (per-organizer favorites vs
  shared named rosters; whether to store contact info at all).

### Teams (expands F2)
- **Global/persistent teams:** set 2-man partners ONCE, applied every round (this weekend = same
  partner each round). Today teams are PER-ROUND, derived from pairing slots 1&2 vs 3&4
  (`resolveFoursomeTeams`); no persistent team table. New schema + UI + pairing integration. Caveat
  (Josh): a group might play an intra-foursome game throwing balls for teams → you can be globally
  teamed with someone AND against them in a sub-game. Global team ≠ sub-game opponent (the
  player-centric model handles this).

### Rules & Sub-games reality (folds into F1 / F1b)
- **Sub-games "Coming":** only **Skins** is built. CTP / Sandies / Putting are labeled "Coming in
  v1.5"; the api rejects them (`admin-event-rounds.ts:264`) / engine throws 501 (`sub-games.ts:76`).
  NOT a regression — never implemented. Sub-games admin UI is a "name dump" (confirmed) — needs UX.
- **Rule set "No rule set — defaults apply":** the message exists (`index.tsx:281`) but the defaults
  are NOT enforced at runtime when none is set (confirmed incomplete); NO per-event/global rule-set
  selection (tenant-scoped; per-event link deferred T5-11e). → core of F1.

### Bug verdicts
- **Regenerate unpinned "does nothing":** code IS fully wired (real mutation → `/pairings/suggest`,
  `pairings.tsx:522` + handler `261`); identical on prod. NOT a deploy gap → likely all-pairings-pinned
  or no-visible-change. Becomes moot once W6 (locked teams) reworks it.

## 🟣 Wolf-parity in-round experience (scoped 2026-06-21 via 3 Explore audits)
Goal: make Tournament's in-round UX match Wolf Cup's. Effort/verdict per item.

- **W1. Score entry — copy Wolf's screen, minus the Wolf section.** UI-ONLY port (~1 day). Wolf
  `apps/web/src/routes/score-entry-hole.tsx` 2-col card grid + hole dots + focus progression; OMIT the
  Wolf partner-pick (lines 1191–1300) + Greenie/Polie/Sandie bonus block (1114–1189) + wolf schedule.
  Tournament's `rounds.$roundId.score-entry.tsx` already has the same endpoints, offline queue, iOS
  keyboard fix. **Team tab-adjacency ALREADY HOLDS** — members render in slot order (1,2,3,4 =
  teammate,teammate,opp,opp); no change needed.
- **W2. Leaderboard player-detail drill-down.** NEW BUILD (~1–2 days). Today
  `events.$eventId.leaderboard.tsx` rows aren't clickable + there's NO per-player per-hole scorecard.
  Need: (a) expandable rows, (b) new `GET /api/.../players/:playerId/scorecard` (per-hole gross/net/
  stableford/bonuses), (c) a ScorecardPanel (port Wolf `index.tsx:214–519`, drop the wolf row). Also
  noted: a per-round dropdown (replace the 2-option toggle) needs an event-rounds list endpoint.
- **W3. Team-score displays.** Member-guest = DONE (`team-standings.tsx` best-ball-vs-par +
  `match-play-standings.tsx`). **Sub-game team scores = BLOCKED on F1** (only Skins built;
  CTP/Sandies/Putting are v1.5 stubs that 501). Build the sub-games first.
- **W4. Gallery — pull Wolf's recent streamlined change. ✅ BUILT 2026-06-21 (branch).** Ported the
  Wolf streamlined flow: separate Camera (capture, one-shot) + Library (multi) buttons, a background
  upload queue (keep shooting while uploads run), and the one-tap "Take another" loop. Kept
  Tournament's lightbox + organizer delete. **Trip vs round gallery:** confirmed the API already does
  the right thing — no active round + no roundId → `round_id` NULL → lands in the **"Trip photos"**
  section (renamed from "Other photos"); NO error (Wolf Cup errors here, Tournament doesn't). Backend
  unchanged (R2). Gallery test 9 ✓.
- **W5. New-joiner nav.** MOSTLY ALREADY WORKS. No attendance page (by design — one-off trip).
  Event-home has Leaderboard/Bets/Team Standings/Match Play/Money/Settle-up/Gallery + a live-round CTA;
  leaderboard renders with no active round. Verify by joining via code on prod. Optional: trim the
  9-card grid toward Leaderboard/Bets/Standings emphasis.
- **W6. Regenerate with LOCKED TEAMS + random group assignment.** NEW FEATURE (~30–40h). = the F2
  global/persistent-teams item. Pin model is per-player-per-cell (no pair concept); engine
  (`engine/pairings/suggest.ts`) is team-agnostic. Needs a persisted teams model + engine changes
  (treat 2-man teams as atomic blocks, random foursome placement) + UI. **Design spike first.** Ties to
  the F1 player-centric model. Decision: full build vs a narrow v1 (lock pairs to slots, manual shuffle).

## 🔴 Setup blockers (in progress — building now)

### B0. Join via CODE — ✅ SHIPPED 2026-06-15 (commit 66db5f8)
- Built: `requireSession` device-binding bridge (lib/device-auth.ts) so a device-bound (non-Google) player authenticates app-wide; migration 0016 `player_join_codes` (per-player, globally-unique 6-char codes, **NO expiry** → lasts the whole multi-day event; device cookie keeps them signed in 90 days post-join); `POST /api/join` (public claim) + `GET /api/admin/events/:id/join-codes` (organizer); web `/join` screen, organizer "Join codes" page, home "Join with a code" CTA. Tests: 9 (incl. device-bridge probe). Full api 1035 ✓.
- **Migration note for the parked `feat/handicap-lock` branch:** it ALSO has a 0016 (`0016_tense_felicia_hardy`). On its next rebase onto master, renumber it to 0017 (master's 0016 is now `0016_confused_deathstrike`).

### B0 (original design notes). Join via CODE — DESIGNED 2026-06-15; bigger than QOL
- **CRITICAL FINDING (code-traced):** non-Google players CANNOT use the app today. Sessions are minted ONLY by Google OAuth (`createSession` called only from `auth.ts` Google callback). `requireSession` accepts only the `tournament_session` cookie. The invite-claim flow (`routes/invites.ts /:token/claim`) creates a `device_binding` + `tournament_device_id` cookie but **no session** — so a claimed non-Google player 401s on every authed route (event home, score entry, money). The device-binding infra exists but the bridge to "logged in" was never wired.
- **DECISIONS (Josh, 2026-06-15):**
  - **Access = FULL** (view, leaderboard, money, score entry, create side bets — first-class; scoring still gated to designated scorers).
  - **Per-player codes** (not one event code): each roster player gets a unique short code. Needed so a player self-creating side games is provably THAT player (event-wide code + name-pick would let anyone act as anyone).
  - **Device-bound identity** → **Option A**: extend `requireSession` (or a `requireSessionOrDevice` wrapper) to resolve `tournament_device_id → device_binding → player` when there's no Google session. Reuses existing claim infra; clearing browser / switching device = re-enter code.
- **BUILD SHAPE:** per-player code generation (on roster add, short unique code stored on the player or a new table) → `/join` screen (enter code → claim player on this device, device cookie) → auth bridge so device cookie grants full access → players land in their event. Organizers still use Google (they create events).
- This is arguably the #1 functional blocker for running the trip (people must be able to get in). NOT just QOL.

### B3 / edit-round-course — ✅ SHIPPED 2026-06-15 (commit ad32c2a)
- `PATCH /api/admin/event-rounds/:id/course` (event-scoped; validates revision + tee; refuses after a round starts) + admin-context now returns courseRevisionId/teeColor/started + web "Rounds & courses" page (linked from event admin). Fixes B3b (the add-course path now completes). Tests: 6.
- **Still open — true "Unknown/TBD" course at creation:** needs `event_rounds.course_revision_id` nullable (SQLite rebuild risk) OR a seeded TBD sentinel course. Deferred. Workaround now: create with any course, then change it via Rounds & courses.

### B3b. Add-course affordance shows where you can't use it — ✅ resolved by edit-round-course (B3)
- The post-creation setup screen shows "add course via PDF / manually", but there's no way to **change a round's course after creation** — so that affordance is misleading there. Either hide it post-creation OR (better) build **edit-round-course** (which B3/TBD also needs). Josh: "if we can't add it later that really shouldn't show up there."

### B1. GHIN search: first name + club + scroll
- Last-name-only search returns too many hits (e.g. "Miller"); can't find the right person.
- Add **first name** and optionally **club** as search inputs/filters.
- Results list must **scroll** (currently cut off; can't reach lower matches).
- Files: `apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx` (roster GHIN search UI), `apps/tournament-api/src/routes/players.ts` (search endpoint — already supports firstName via ghin-client.searchByName; verify/extend), `ghin-client.searchByName`.

### B2. Tee is per-PLAYER, not per-course
- A player plays the same tee across the trip (e.g. always "Dye"); tee is a property of the golfer, not the event/round.
- Move tee selection to the **roster** (per group member) as a **dropdown** of the course's available tees — today it's a free-text box on the event/round settings.
- Decision needed: where the per-player tee lives. `players.preferred_tee_color` exists; pairing_members.tee_color is the per-round override. Likely: roster sets a default → flows into pairings; dropdown options = union of the event's courses' tee names.
- Also: the wizard's per-round `tee_color` text input → dropdown of the chosen course's tees.

### B3. Course picker: Unknown/TBD + add-course access
- Add an **"Unknown / TBD"** course option so an event can be created before the venue is decided (requires making `event_rounds.course_revision_id` nullable OR a sentinel TBD course; lean sentinel to avoid FK churn).
- Surface the add-course path (GHIN import / PDF / manual) **from the picker itself**, not only the wizard footer.
- Not locked to pre-loaded courses.

## 🟡 UI quality

### U1. Admin/roster polish pass
- Edit Group and other admin pages render rough/unstyled (plain left-aligned HTML, no cards, odd selection highlights).
- Apply the design-system primitives (PageShell, cards, spacing tokens) + the new dark-mode tokens across admin screens.

## 🟢 New features

### F1. Rules & sub-games config (event-wide + per-round overrides)
- **DESIGN PASS DONE 2026-06-16** (brainstorming): `_bmad-output/brainstorming/brainstorming-session-2026-06-16.md`. Reframed into a 3-layer model (modifiers ride a base game / games own a pot / peer-bets) + a 3-level cascade (Event→Round→Foursome) behind ONE admin lock toggle; "Standard Guyan Game" = a seeded editable preset; 2v2 money is foursome-internal so per-foursome rule variation is safe (no cross-foursome reconciliation); "345" cap collapses into the 2v2 (point-value + cap); lock state drives leaderboard mode (money vs scores-only). Build-blockers flagged: migration off tenant-scoped rule_sets + recompute-vs-immutable-revisions. NEXT: `/bmad-bmm-create-prd` scoped to F1 using that doc.
- Per-day (round-level) AND event-wide setup of:
  - **Polies** on/off; variant: "polie only counts on **bogey-or-better (gross)**" vs any.
  - **Point for net birdie** toggle (some groups: win the hole on a net birdie but no extra point).
  - **Sandies** on/off.
  - (extensible to greenies, CTP, skins mode, etc.)
- Event-wide defaults that each round can override.
- Existing surface: `rule_sets` / `rule_set_revisions` (tenant-level today) + `admin-event-rounds` sub-games. Needs an event-scoped + round-scoped config model + UI.
- **Rules & sub-games are intermixed and need a redo** (Josh). The admin landing shows a yellow "No rule set seeded yet" card that is NOT clickable — there's no UI to create/seed a rule set, and sub-game toggles live separately under event-rounds. Unify into one coherent "Rules & games" setup (event-wide defaults + per-round overrides).

## 🐞 Bugs found in testing (fix as hit)
- ~~Member list showed "—" for handicap on every player~~ — FIXED: roster GET now resolves live GHIN HI (currentHandicapIndex).
- ~~Pairings page crashed ("can't access property 0, c is undefined") when INCREASING foursome count~~ — FIXED: isDirty memo guarded against the transient where the new count outpaces the not-yet-rebuilt grid.
- ~~2v2 teams assigned ALPHABETICALLY (silent money bug — wrong partnerships whenever intended teams ≠ alpha split)~~ — **FIXED + committed `ce91a42` 2026-06-16.** New shared `resolveFoursomeTeams` (slots 1&2 vs 3&4 from `pairing_members.slot_number`) wired into money.ts/money-detail.ts/press-orchestrator.ts so the 3 paths can't disagree; pairings UI now labels Team 1/Team 2. No existing scored prod rounds → pure correctness. (Unblocks Pete Dye member-guest team-setting.)
- Rule-set card un-clickable (see F1).

## ⛳ Pete Dye Invitational (Jun 26–27, member-guest, 12 players) — tactical build
Hard deadline; F1 PRD PAUSED at step 8/11 to do this without rushing the foundation. Format from group texts (STILL DEBATED): 2-day best-ball **against par**, 6 two-man teams (top-6 by low HI as-of 6/14 each drawn an A/B-player + a "hack"), $50/man **winner-take-all**, Guyan 2v2 games inside the foursomes. Teammates sit in the same foursome → 3 foursomes of 4 = two member-guest teams each (the foursome 2v2 = the member-guest match), all 6 teams feed the event pot.
- **DONE:** set-teams-in-admin (the slot-based team fix above, `ce91a42`). Handicap lock as-of 6/24 = H1 (shipped). Pete Dye course seeded (CourseID 5737, "Dye" tees). Guyan 2v2 + money + scoring already work (now with correct teams).
- **DONE — Phase 1 (best-ball-vs-par event standing):** shipped `c5e3072` (`team-standings.ts` + `/team-standings` page + event-home card).
- **DONE — Phase 2 (match-play points board), built 2026-06-17, PUSHED + DEPLOYED 2026-06-18 (master `bd13fe3`):** CI green; deployed via deploy.sh; prod health 200 + endpoint live (401 auth-gated). format locked with Josh — FOURSOME-INTERNAL fixed (slots 1&2 vs 3&4 play only each other, one matchup/round), 9-vs-18 toggle = the existing `event_rounds.holes_to_play` (no new schema), points win=1/halve=0.5/loss=0 (fixed v1), a SEPARATE parallel board from the pot. New `services/match-play-standings.ts` (reuses `computeFoursomeResults` per-hole winners), `GET /:eventId/match-play-standings`, `events.$eventId.match-play-standings.tsx` + ⚔️ Match Play event-home card. Spec: `pete-dye-phase2-match-play-spec.md`. Tests: api 1073 ✓ (+3), web 354 ✓ (+3), typecheck clean. Follow-ups noted: configurable point values, Nassau front/back split.
- **OPERATIONAL (near the date):** create the Pete Dye event + 12 roster + lock handicaps 6/24.

### F1b. Side games (rename from "Sub Games") + player-driven
- **Rename "Sub Games" → "Side Games"** everywhere (UI labels; keep DB table names).
- **Overall TEAM game** in the rules: foursomes vs each other for a $ value (the main event game). New format alongside the existing 2v2.
- **Player-vs-player hole-by-hole side games** — this largely maps to the EXISTING `individual_bets` engine (match_play_per_hole + match_play_with_auto_press already implemented in `engine/rules/individual-bets.ts` + `routes/bets.ts`). What's missing is the player-facing UX + options:
  - Add opponent (pick from roster) → stake per hole ($5/$10) → handicap basis: **full** vs **negotiated** handicaps → optional **auto-press** (e.g. down 2 holes → x1→x2→x3 each further 2 down).
  - Examples: "Ronnie Adkins + Josh Stoll — $5/hole, full handicaps"; "Ronnie Adkins + Steven Chatterton — $10/hole, auto-press at 2 down, full handicap".
  - **Putting game** as a checkbox/add-on (or its own side-game type).
- **CRITICAL: players add their OWN side games** — not the organizer doing every one. Needs a player-facing "my side games" surface (the bets route is organizer/participant-gated today; open it to participants to self-create against others in the event).
- This is messy + large — needs its own design pass before build.
- **PRD AUTHORED 2026-06-20 → `_bmad-output/planning-artifacts/tournament/prd-betting-action-line.md` ("The Action").** Full 12-step BMAD PRD covering the player-driven + admin-managed betting surface: subjects≠stakeholders open book (any roster member can back a side, both sides required, no house), auto-settle from scores, pairwise settle-up, Action board, money_visibility-aware. Bet types (MVP): per-hole match, h2h (net/gross, +Nassau via front/back/total), **putting games** (total-putts h2h, optional front/back/total), **Snake** (group 3-putt, escalating, holder-pays-all; conditional putts entry ports Wolf Cup "least putts"). Over/under + multi-round + verified propose→accept handshake = Growth. **"The Line"/odds/house explicitly OUT** (no in-event history to model odds; nobody wants the book). Target proving ground = Pete Dye Jun 26–27. Admin-console-first build order de-risks the deadline.
- **READINESS VALIDATION + ARCHITECTURE DONE 2026-06-20.** Codex adversarial pass hardened the FR contract to FR1–FR54 (Snake rules locked). **Architecture COMPLETE → `tournament/architecture-betting-action.md`** (READY, HIGH confidence): new `bets` schema (not extending individual_bets); pure recompute-on-read `engine/bets/`; `netForSegment()` reuses existing per-hole net (never re-derive); reversible finalize-snapshot; canonical `SettlementEdge` IR; Snake as N-party type; `fast-check` the only new dep. 3 unknowns verified favorable (`hole_scores.putts` exists, per-hole net exists, `money-detail.ts` already pairwise+per-game). Readiness report: `tournament/implementation-readiness-report-betting-2026-06-20.md`. **HARD GATE before settlement code = golden hand-calc fixtures (first artifact).** NEXT: epics/stories or tactical build at fixtures+schema.

### F2. Team selection
- Possibly pick 2-man (or N-man) teams for the event (not just per-round foursome pairings). Design TBD.

### F3. Friends / Favorites roster
- Organizer-saved player list (favorites) tied to the admin, so future events can quickly select known people instead of re-searching GHIN each time.

## 🔵 In flight (branch `feat/handicap-lock` → merged to master + DEPLOYED 2026-06-16)

### H1. Handicap lock "as of a date" — ✅ SHIPPED + DEPLOYED 2026-06-16 (master `026bcb7`)
- **Rebased onto master + migration renumbered 0016→0017** (`0017_lovely_lucky_pierre`, regenerated via `db:generate` off master's 0016 join-codes snapshot; byte-identical SQL: `event_handicaps` table + `events.handicap_lock_date`). Resolved B0 conflicts (kept both `playerJoinCodes` and `eventHandicaps`).
- **Regression found + FIXED during rebase verification:** the overlay loaders (`event-handicap-overrides.ts`) used the GLOBAL `db` singleton, so inside `runPressOrchestrator(tx)` / e2e they hit "no such table: rounds" (5 press tests + lifecycle e2e failed in isolation). Fix = thread the caller's `tx`/`db` into `loadLockedHandicapsByEvent`/`ByRound` (now first param); updated all 6 call sites (leaderboard `ctx.db`, money/money-detail `txOrDb`, sub-games/press `tx`, bets `db`).
- **Backend DONE** (lock/unlock/GET endpoints; locked-HI overlay on leaderboard/money/money-detail/sub-games/press/bets so it carries into every round).
- **UI DONE:** `/admin/events/:eventId/lock-handicaps` — As-of `<input type=date>` picker + per-player table (today's HI / locked HI w/ GHIN provenance) + lock/re-lock/unlock + locked banner. Linked from event admin landing (`admin-link-lock-handicaps`).
- **Tests DONE:** `handicap-lock.test.ts` (10, pure pickAsOfRevision/isIsoDate), `admin-event-handicaps.test.ts` (13, route GET/lock/unlock incl. GHIN mock + 403 event-scoping), web `lock-handicaps.test.tsx` (4). Full api 1063 ✓ (lone failure = the known full-suite `lifecycle-full.e2e` shared-cache flake, passes isolated), web 352 ✓, `pnpm -r typecheck` clean.
- **SHIPPED + DEPLOYED + verified live** (prod tournament-api health ok; migration 0017 confirmed applied: `event_handicaps` table + `events.handicap_lock_date` column present). GHIN history proven feasible (Ben McGinnis). Rule = index as of cutoff date.
- **Lock TIMING (clarified 2026-06-16):** the snapshot is captured *at click time*, but the VALUE is the GHIN revision effective on/before the as-of date (`pickAsOfRevision` = latest revision ≤ cutoff). So **retroactive locking is correct** — forgot to lock the Wednesday-before? Lock anytime with as-of=that Wednesday; GHIN dated history makes it accurate regardless of when you click. **Future-dating + lock-now is WRONG** — it captures today's index mislabeled (the future revision doesn't exist yet).

### H1b. Handicap-lock UX follow-ups (NEW 2026-06-16, not built)
- **Setup-flow reminder:** surface a handicap-lock prompt/checklist item during event/rules setup ("Lock handicaps as of: ___") so organizers don't forget (Josh forgot the Wednesday-before in practice). The *feature* is H1; this is a setup-UX touchpoint (cross-refs the F1 Rules & Games setup flow — see F1 PRD Journey 1).
- **Scheduled ("set-and-forget") lock:** configure the as-of date early and have the system AUTO-snapshot when that date arrives — so future-dating works. H1 today snapshots at click-time only; this is the enhancement that makes "set it up early" safe. Small, optional.
- **Handicap-allowance %** (NEW 2026-06-16, requested by Josh): add an event-level "% of handicap allowed" option ON the lock-handicaps screen, **default 100%**. Scales each player's COURSE handicap (USGA: course handicap × allowance = playing handicap) for ALL net calcs. **Non-blocking for Pete Dye (uses 100% = no-op).** Build carefully as a focused follow-up — must apply CONSISTENTLY across leaderboard/money/money-detail/sub-games/press/bets + the new team standings (same surface as the locked-HI overlay). Apply to course handicap, not the index.

## 🎲 Wolf Cup Bet Tracker + Odds (2026-06-18, Josh)
**v1 BUILDING NOW (for tomorrow's round):** admin-entered side-action bet tracker, auto-settles from scores. 3 score-prop bet types — overall (h2h, lower 18 wins), over/under (vs a line, push on it), per-hole match-play ($/hole, netHoles×stake). Net default, per-tee correct (reuses leaderboard's slope-aware net). Proposition (subjects) separate from STAKEHOLDERS (both player_id, identity-ready: a non-player like Kyle can back a side). Public `/bets` board (roster per person + outcomes + settle-up) + admin add/delete. Backend done: `bets` table (no CHECK — additive), `services/bets.ts` settle (13 tests), public + admin routers. NO logins yet (admin sets all) but model is identity-ready (H1-style code login is the documented next step — "this is where individual logins start to be needed").
**FAST-FOLLOW (queued, post-v1 + review):**
- **Odds-win bets** — bet a player to WIN the day at locked American odds (Jaquint took Stoll +1650/$100). Additive migration (`odds` int + `odds_win` type), settle by day-winner, ties to The Line. Different shape than the score-prop bets.
- **Odds-section redesign** — make the Line/odds scrollable left↔right with THREE odds per player: (1) wins Stableford #1, (2) wins Money #1, (3) **Perfect Day** = #1 in BOTH (no ties). Needs the Monte-Carlo odds model to compute 3 probabilities. "Perfect Day" is what the +1650 odds-win bets pay out on.
**REVIEW GATE:** Josh wants codex/director review before any push.
