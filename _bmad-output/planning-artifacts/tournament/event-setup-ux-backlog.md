# Tournament — Event-Setup UX & Rules Backlog

Living backlog from hands-on testing (2026-06-15, Josh). Ordered by priority.
Update as items ship.

## 🔴 Setup blockers (in progress — building now)

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

### F2. Team selection
- Possibly pick 2-man (or N-man) teams for the event (not just per-round foursome pairings). Design TBD.

### F3. Friends / Favorites roster
- Organizer-saved player list (favorites) tied to the admin, so future events can quickly select known people instead of re-searching GHIN each time.

## 🔵 In flight (parked on branch `feat/handicap-lock`)

### H1. Handicap lock "as of a date"
- **Backend DONE** (migration 0016 `events.handicap_lock_date` + `event_handicaps` snapshot; GHIN `getHandicapHistory`; lock/unlock/GET endpoints; locked-HI overlay applied to leaderboard/money/money-detail/sub-games/press/bets so it carries into every round). Compiles; not shipped.
- **TODO:** "Lock Handicaps" admin page (As-of date picker + per-player table: today's HI / locked HI) + tests + deploy.
- GHIN history proven feasible (Ben McGinnis). Rule = index as of cutoff date.
