# Tournament — Event-Setup UX & Rules Backlog

Living backlog from hands-on testing (2026-06-15, Josh). Ordered by priority.
Update as items ship.

## STATUS (2026-06-15, end of session)
SHIPPED + DEPLOYED this session: B1 (GHIN search first-name/club/scroll), member-HI live-GHIN display, pairings increase-crash fix, B2a (round tee dropdown in wizard). Also live earlier: event soft-cancel, wizard "Course not listed?" links, Pete Dye seed, GHIN course import, dark mode. PARKED on branch `feat/handicap-lock`: handicap-lock backend (needs UI+tests). NEXT: B2b (roster per-player tee), B3 (TBD course — needs edit-round-course first), then a BMAD/design session for the F-series (rules/side-games rework) + UI/QOL polish. Josh created a real "Pete Dye" test event, added players, exercised the flow.

## 🔴 Setup blockers (in progress — building now)

### B0. Join via CODE (not just Google login) — IMPORTANT QOL
- Players "probably all don't have google login." Need a way to join by a short **code** (or the existing invite **link**) without Google SSO.
- NOTE: the invite-claim flow ALREADY works without Google — it's device-binding ("the token IS the auth", `routes/invites.ts` GET/POST `/:token/claim`). So a shared invite LINK already bypasses Google today. The ask = surface a short, human-typeable **join code** + a "enter code to join" screen as an alternative to the link. Enhancement on existing infra, not new auth.

### B3b. Add-course affordance shows where you can't use it
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
- Rule-set card un-clickable (see F1).

### F1b. Side games (rename from "Sub Games") + player-driven
- **Rename "Sub Games" → "Side Games"** everywhere (UI labels; keep DB table names).
- **Overall TEAM game** in the rules: foursomes vs each other for a $ value (the main event game). New format alongside the existing 2v2.
- **Player-vs-player hole-by-hole side games** — this largely maps to the EXISTING `individual_bets` engine (match_play_per_hole + match_play_with_auto_press already implemented in `engine/rules/individual-bets.ts` + `routes/bets.ts`). What's missing is the player-facing UX + options:
  - Add opponent (pick from roster) → stake per hole ($5/$10) → handicap basis: **full** vs **negotiated** handicaps → optional **auto-press** (e.g. down 2 holes → x1→x2→x3 each further 2 down).
  - Examples: "Ronnie Adkins + Josh Stoll — $5/hole, full handicaps"; "Ronnie Adkins + Steven Chatterton — $10/hole, auto-press at 2 down, full handicap".
  - **Putting game** as a checkbox/add-on (or its own side-game type).
- **CRITICAL: players add their OWN side games** — not the organizer doing every one. Needs a player-facing "my side games" surface (the bets route is organizer/participant-gated today; open it to participants to self-create against others in the event).
- This is messy + large — needs its own design pass before build.

### F2. Team selection
- Possibly pick 2-man (or N-man) teams for the event (not just per-round foursome pairings). Design TBD.

### F3. Friends / Favorites roster
- Organizer-saved player list (favorites) tied to the admin, so future events can quickly select known people instead of re-searching GHIN each time.

## 🔵 In flight (parked on branch `feat/handicap-lock`)

### H1. Handicap lock "as of a date"
- **Backend DONE** (migration 0016 `events.handicap_lock_date` + `event_handicaps` snapshot; GHIN `getHandicapHistory`; lock/unlock/GET endpoints; locked-HI overlay applied to leaderboard/money/money-detail/sub-games/press/bets so it carries into every round). Compiles; not shipped.
- **TODO:** "Lock Handicaps" admin page (As-of date picker + per-player table: today's HI / locked HI) + tests + deploy.
- GHIN history proven feasible (Ben McGinnis). Rule = index as of cutoff date.
