# Codex Review Request — Tournament Epic T8 (In-App Engagement Surfaces)

**Target audience:** Codex (external reviewer).
**Requested by:** Josh Stoll, via Claude Code session.
**Date:** 2026-04-19.
**Branch:** master.
**Artifact under review:** Draft of 4 stories for Tournament epic T8 (not yet committed to `_bmad-output/planning-artifacts/tournament/epics-phase1.md`). Below in the **Stories to review** section.

---

## Review protocol (what I want you to do)

You are reviewing proposed story specs before they are committed to the authoritative epics file. The earlier T1–T6 review passes have consistently caught the following high-value issue classes — prioritize finding these:

1. **Schema-where-FK-doesn't-exist-yet** — a story references a table / column that hasn't been created by an earlier story. This is the #1 most common bug.
2. **Forward dependencies on later-epic schema** — an AC commits to a column that is supposed to be created by T7/T9; flag it.
3. **Contradicts a locked FD (Foundation Decision)** — below I list the 15 locked FDs. Any story that drifts from these needs an explicit amendment, not a silent override.
4. **Unimplementable ACs** — the AC says `X must assert Y` but Y is not derivable from the data shape the story defines.
5. **Layering violations** — engine writes to DB, service performs writes, route bypasses middleware, etc. (See architecture patterns below.)
6. **Integer-cents drift** — any money value specced as `REAL` / `float` / dollars (not cents integer). T6 locked integer-cents throughout; T8 should never handle money but may echo it in payloads.
7. **Duplicate implementation** — if a story specs a helper that already exists (e.g., T6.10 tie-break, T5.10 409 test), flag the duplication.
8. **Test coverage gaps** — an AC asserts behavior X but the integration test scenarios listed don't exercise X.

Also note any:
- **Missing activity types** — T8.1 defines the enum of activity types. If earlier epics' emission points (T5.6, T5.7, T5.8, T5.9, T5.11, T6.4, T6.7, T6.13, T7.4, T7.6) need a type not in the enum, flag.
- **Race / storm conditions** — offline drain storms, device re-connect bursts, poll-coincidence. T8's toast/banner components are especially exposed.
- **Zod schema completeness** — T8.1 specs per-type Zod schemas; flag any type whose schema shape isn't derivable from the emission sites.

## Output format

Please write your findings to `_bmad-output/planning-artifacts/tournament/reviews/T8-codex-findings.md` with this structure:

```
# Codex Findings — T8

## [High] / [Medium] / [Low] <brief title>
<finding body — what's wrong, where, and recommended fix>

## Your flags
<respond to each of my 7 flagged questions at the bottom>

## Overall
<structural assessment — ship as-is, ship with fixes, or restructure>
```

Severity scale: **High** = must fix before commit (schema layering, FD drift, unimplementable). **Medium** = should fix (race conditions, coverage gaps). **Low** = nit / naming / wording.

If you need to verify a behavioral claim against SQLite / IndexedDB / timing, do it locally — you've shown this works for the uniqueness repro in T5. I'll trust observational claims over speculation.

---

## Context you need

### Locked FDs (Foundation Decisions) — do not re-litigate without explicit amendment

- **FD-1** Same monorepo, separate subdomain (`tournament.dagle.cloud`).
- **FD-2** Port-not-fork posture; provenance headers + `PORTS.md` per port.
- **FD-3** Hole-level soft-lock: 409 on conflict; no hard lock; UI overwrite prompt at drain time.
- **FD-4** Identity anchor = `player_id` + SSO sub. GHIN optional enrichment, never precondition.
- **FD-5** **No push / SMS / email ever.** Engagement is in-app only (toast / banner / feed). This is T8's central discipline — every engagement mechanism must surface inside the app, not outside.
- **FD-6** `tenant_id` + `context_id NOT NULL` on every writable table; write-once; stamped `event:{eventId}` on insert.
- **FD-7** `rounds.event_id` nullable for v1.5 forward compat.
- **FD-8** Rule-set + course revisioning; rounds pin revision IDs.
- **FD-9** v1 scope: Pinehurst May 7–10, 2026. 8 players, 4 rounds, Event only, one Group, 2v2 best ball + Skins + carry-greenies.
- **FD-10** Sub-games as first-class, type-tagged; schema scaffolds all 4 types (`skins`, `ctp`, `sandies`, `putting_contest`); v1 implements skins only.
- **FD-11** Skins v1 with modes `gross | net | gross_beats_net`; tournament-local engine at `apps/tournament-api/src/engine/formats/skins.ts`.
- **FD-12** v1 bets: press + auto-press + cross-foursome individual bets + skins + carry-over greenies.
- **FD-13** Four guardrails (mid-event edit, GHIN superseded, scorer handoff, role collapse).
- **FD-14** PWA-primary posture; install prompt after first successful mutation; browser-tab read-only fallback.
- **FD-15** Foundation-first, ship-when-solid. No hard external deadline.

### Committed earlier-epic schema commitments (relevant to T8)

**From T3.1 (events/groups/rules/players):**
- `events(id TEXT PK, name, start_date, end_date, timezone TEXT, organizer_player_id FK → players.id, created_at)`
- `event_rounds(id PK, event_id FK → events.id, round_number, round_date, course_revision_id FK, tee_color TEXT, created_at)`
- `players(id PK, name NOT NULL, ghin NULLABLE UNIQUE, google_sub NULLABLE UNIQUE, apple_sub NULLABLE UNIQUE, manual_handicap_index REAL, preferred_tee_color, install_prompt_shown_at TIMESTAMP NULLABLE — added by T7.6)`
- `groups(id PK, event_id FK, name, money_visibility_mode TEXT CHECK ('open','participant','self_only') DEFAULT 'open', created_at)`
- `group_members(group_id FK, player_id FK, PK(group_id, player_id))`
- `rule_set_revisions(id PK, rule_set_id FK, revision_number, config_json TEXT NOT NULL, effective_from_round_id FK → event_rounds.id NULLABLE, effective_from_hole INTEGER DEFAULT 1 CHECK BETWEEN 1 AND 19, created_by_player_id FK, reason TEXT NULLABLE, created_at)`

**From T4.2 (pairings):**
- `pairings(id PK, event_round_id FK, foursome_number, locked BOOLEAN, UNIQUE(event_round_id, foursome_number))`
- `pairing_members(pairing_id FK, player_id FK, slot_number, PK(pairing_id, player_id), UNIQUE(pairing_id, slot_number))`

**From T5.1 (scoring):**
- `rounds(id PK, event_id FK → events.id NULLABLE, event_round_id FK → event_rounds.id NULLABLE, opened_at NULLABLE, opened_by_player_id FK NULLABLE, created_at)` — per-round scoring runtime instance, distinct from `event_rounds` schedule entity
- `hole_scores(id PK, round_id FK, player_id FK, hole_number INT CHECK 1-18, gross_strokes INT CHECK >=1, putts INT NULLABLE, scorer_player_id FK, client_event_id TEXT NOT NULL, created_at, updated_at, UNIQUE(round_id, player_id, hole_number), UNIQUE(round_id, player_id, hole_number, client_event_id))`
- `score_corrections(id PK, round_id FK, player_id FK, hole_number, actor_player_id FK, prior_value_json, new_value_json, request_id, reason NULLABLE, created_at)`
- `round_states(round_id PK/FK, state CHECK IN ('not_started','in_progress','complete_editable','finalized','cancelled'), entered_at, entered_by_player_id FK NULLABLE)`
- `scorer_assignments(round_id FK, foursome_number, scorer_player_id FK, assigned_at, assigned_by_player_id FK, PK(round_id, foursome_number))`

**From T6 (rules/money):**
- `team_press_log(id PK, round_id FK, team CHECK IN ('teamA','teamB'), fired_at_hole INT CHECK 1-18, trigger_type CHECK IN ('manual','auto'), multiplier REAL, created_at, UNIQUE(round_id, team, fired_at_hole, trigger_type))`
- `individual_bets(id PK, event_id FK, player_a_id FK, player_b_id FK, bet_type CHECK IN ('match_play_per_hole','match_play_with_auto_press'), stake_per_hole_cents INTEGER NOT NULL, config_json, created_by_player_id FK, created_at, UNIQUE(event_id, player_a_id, player_b_id, bet_type))`
- `individual_bet_rounds(bet_id FK, event_round_id FK, PK(bet_id, event_round_id))`
- `individual_bet_presses(id PK, bet_id FK, fired_at_round_id FK → event_rounds.id, fired_at_hole INT CHECK 1-18, trigger_type CHECK, multiplier REAL NOT NULL, created_at, UNIQUE(bet_id, fired_at_round_id, fired_at_hole, trigger_type))`
- `sub_game_results(id PK, sub_game_id FK → sub_games.id, computed_at NOT NULL, config_snapshot_json, results_json, total_pot_cents INTEGER NOT NULL, created_by_player_id FK NULLABLE)` — append-only
- `gallery_photos` (T7.4 port) — `(id PK, event_id FK, round_id FK NULLABLE, uploaded_by_player_id FK, r2_key TEXT NOT NULL, content_type, uploaded_at, UNIQUE(r2_key))`

**Emission points across T5/T6/T7 that call `emitActivity` (T8.1 consumer):**
- T5.6 `score.committed` (per hole commit, after hole-complete for presses)
- T5.7 `scorer.transferred`
- T5.8 `round.finalized`, `round.cancelled`
- T5.9 `score.corrected`
- T5.11 `rule_set.revised`
- T6.4 `press.auto_fired`, `press.manual_fired`
- T6.7 `press.manual_fired`, `press.manual_undone`
- T6.13 `subgame.computed`
- T7.4 `gallery.uploaded`
- T7.6 `install_prompt.shown`
- T8.4 `award.triggered`, plus derived `bet.flipped` + `lead.changed` which run inside the T6.4 / T8.4 paths

### Locked architecture patterns

- **Transaction boundary rule:** every mutating route wraps its work in `db.transaction(async (tx) => {...})`; services never open their own transactions.
- **Transaction helpers write; query services read.** `services/activity.ts` is a transaction helper (`emitActivity(tx, event)` — tx-required signature). `services/money.ts`, `services/leaderboard.ts` are query services (no writes, ever).
- **Activity writes go through `emitActivity` ONLY.** No direct `tx.insert(activity)` anywhere else.
- **Zod validates BEFORE insert** (D3-2 Codex tightening on payloads). Invalid payload → throw (fail-loud).
- **Money: integer cents everywhere.** All columns `INTEGER NOT NULL`, all TS types `number` representing cents.
- **Fail-loud on engine / service bugs inside a score-commit transaction.** T6.4 locked this posture: if press / money / activity engine throws, the commit rolls back.

### T8 epic-header commitments (already in the file)

- T8.1 can parallelize with T5/T6 (no runtime dep on their outputs — just schema shape of emission)
- T8.2–T8.4 require T5 + T6 exits met
- Exit criteria: activity rows landing for each of score.committed, press.fired, bet.flipped, lead.changed, award.triggered; toast renders within 6s on a second device; stacked banners collapse; feed surface on player home; **production config audit confirms zero push/SMS/email infrastructure present** (FD-5 enforcement gate — no VAPID keys, no APNs cert, no Twilio creds, no email-send endpoints)

---

## Stories to review

### Story T8.1: [new] Activity Spine Schema + Emitter + Zod-Validated Payloads

As a developer,
I want `activity` table + `services/activity.ts` `emitActivity(tx, event)` transaction helper + `engine/types/activity-events.ts` discriminated union with per-type Zod schemas validated BEFORE insert,
So that every downstream engagement surface (T8.2/T8.3/T8.4) reads from a single authoritative event spine with strong typing (FD-5, FR-C3, D3-2).

**Parallelizable with T5/T6:** this story has no runtime dependency on T5/T6 outputs; it defines schema + emitter shape that T5/T6 call. Can land in parallel if slot-scheduled early.

**Depends on:** None runtime-wise; conceptually informs T5.6/T5.7/T5.8/T5.11/T6.4/T6.7/T6.13 emission points.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/db/schema/activity.ts`
**When** inspected
**Then** it defines `activity(id PK, event_id FK → events.id NOT NULL, round_id FK → rounds.id NULLABLE, type TEXT NOT NULL CHECK(type IN ('score.committed','score.corrected','scorer.transferred','round.finalized','round.cancelled','press.auto_fired','press.manual_fired','press.manual_undone','bet.created','bet.flipped','lead.changed','award.triggered','rule_set.revised','subgame.computed','gallery.uploaded','install_prompt.shown')), actor_player_id FK → players.id NULLABLE, payload_json TEXT NOT NULL, created_at NOT NULL, INDEX(event_id, created_at DESC))`. Carries `tenant_id` + `context_id` via `_columns.ts`.

**Given** `apps/tournament-api/src/engine/types/activity-events.ts`
**When** inspected
**Then** it exports a TypeScript discriminated union `ActivityEvent` with one variant per `type` value above. Each variant has a concrete payload shape (e.g., `ScoreCommittedEvent = { type: 'score.committed', roundId, holeNumber, playerId, grossStrokes, scorerPlayerId }`). The file also exports `activityEventSchemas: Record<Type, ZodSchema>` — one Zod schema per type.

**Given** `apps/tournament-api/src/services/activity.ts`
**When** inspected
**Then** it exports `emitActivity(tx: Transaction, event: ActivityEvent): Promise<void>` as a transaction helper that: (a) looks up `activityEventSchemas[event.type]`; (b) `schema.parse(event)` — throws if payload doesn't match (loud failure — surfaces pure-function bugs); (c) `tx.insert(activity).values({ event_id, round_id: event.roundId ?? null, type: event.type, actor_player_id: event.actorPlayerId ?? null, payload_json: JSON.stringify(event), created_at: now() })`

**Given** any other file in the codebase
**When** grepped for `tx.insert(activity)` or direct activity-table writes
**Then** zero results — `emitActivity` is the ONLY writer (enforced by convention; add ESLint rule `no-restricted-syntax` for `tx.insert(activity` if drift risk later)

**Given** a malformed event (e.g., `{ type: 'score.committed', roundId: 'abc', holeNumber: 99 }`)
**When** `emitActivity(tx, event)` is called
**Then** Zod parse throws `ValidationError`; the calling transaction rolls back; nothing is written (fail-loud per D3-2)

**Given** `apps/tournament-api/src/services/activity.integration.test.ts`
**When** run
**Then** tests cover: (a) each of the 16 event types — valid payload inserts correctly with correct column population; (b) invalid payload per type — parse throws, no insert; (c) emitActivity outside a transaction (no tx passed) fails at TS compile time (signature enforces tx); (d) index on `(event_id, created_at DESC)` is used by the query pattern `SELECT * FROM activity WHERE event_id=? ORDER BY created_at DESC LIMIT ?` (verifiable via `EXPLAIN QUERY PLAN` in a test — optional but recommended)

---

### Story T8.2: [new] In-App Toast + Banner Components

As any Event participant,
I want a Toast component that renders an activity's headline for ~6s then auto-dismisses AND a Banner component that persists for money-affecting events until I acknowledge it, with stacked banners collapsing to a summary entry when ≥3 arrive within 5 seconds,
So that live events flow into the app visually without overwhelming me during offline-drain catch-up (FR-C3, D3-4).

**Depends on:** T8.1 (activity spine to read from).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/hooks/use-activity-feed.ts`
**When** inspected
**Then** it exports `useActivityFeed(eventId, { since?: ISO })` — a TanStack Query hook polling `GET /api/events/:eventId/activity?since={iso}` every 5 seconds, returning ordered activity events newest-first. Includes an `emitter` mechanism (EventTarget-backed) that fires a `'new-activity'` event with the new payloads whenever the poll returns fresh items.

**Given** `GET /api/events/:eventId/activity?since={iso}` (gated `require-event-participant`)
**When** invoked
**Then** returns activity rows created after `since` (defaults to epoch when not provided), ordered `created_at DESC`; max 100 per request (paginated via `since` on next poll)

**Given** `apps/tournament-web/src/components/tournament-toast.tsx`
**When** inspected
**Then** it subscribes to `useActivityFeed`'s emitter and renders a headline for qualifying event types (`score.committed` if a birdie-or-better, `press.auto_fired`, `press.manual_fired`, `bet.flipped`, `lead.changed`, `award.triggered`); auto-dismisses after 6 seconds; slides in from top on mobile / top-right on desktop. Non-qualifying types are ignored by the toast surface (they still appear in the T8.3 feed).

**Given** `apps/tournament-web/src/components/tournament-banner.tsx`
**When** inspected
**Then** it subscribes to the emitter and renders a persistent banner for money-affecting event types (`press.auto_fired`, `press.manual_fired`, `bet.flipped`, `rule_set.revised`, `round.finalized`); banner sticks until user taps dismiss (no auto-dismiss — D3-4 acknowledgement pattern); dismissal state stored in localStorage keyed by `activity.id` to prevent reappearance on page refresh

**Given** ≥3 banner-eligible events arrive within a 5-second window (offline drain storm)
**When** processed by the banner component
**Then** individual banners collapse into a single summary banner: "N updates (press ×2, bet flip ×1) — tap to review" which expands into a modal listing the individual events; dismissing the summary dismisses all N events collectively

**Given** the toast / banner stack visible
**When** the viewer navigates between routes
**Then** the components persist across route changes (mounted at root layout level via `__root.tsx`); no re-animation on each navigation

**Given** `apps/tournament-web/src/components/tournament-toast.test.tsx` + `tournament-banner.test.tsx`
**When** tests run
**Then** render paths verified: toast auto-dismiss at 6s; banner persistence until dismiss; storm collapse (3 events within 5s → 1 summary); localStorage dismissal survives remount

---

### Story T8.3: [new] Player-Home Activity Feed (reverse-chronological)

As any Event participant,
I want a "What's Happening" feed on the Event home page showing recent activity in reverse-chronological order, scoped to this Event,
So that between shots I can glance at the app and see everything that just happened — the pull surface that replaces push notifications entirely (FR-C3, FD-5 "pull not push").

**Depends on:** T8.1 (activity table), T7.1 (Event home page to host the feed).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/components/activity-feed.tsx`
**When** inspected
**Then** it consumes `useActivityFeed(eventId)` (T8.2) and renders a scrollable list; each row shows: (a) icon per event type (score-committed/press-fired/bet-flipped/etc.); (b) headline ("Rick scored 4 on hole 11", "Auto-press fired — Team A vs Team B at hole 5"); (c) relative time stamp ("2 min ago"); (d) tap routes to the relevant surface (score → scorecard; press → money page; bet-flip → bets page)

**Given** the Event home page (T7.1)
**When** rendered
**Then** the activity feed component is embedded below the schedule cards, showing the 20 most recent events; "Load more" button paginates older items

**Given** no activity yet (Event pre-start)
**When** rendered
**Then** empty-state card: "Activity will show here once scoring starts. Round 1 begins {countdown}."

**Given** a banner-eligible event visible in the feed
**When** the viewer scrolls past it
**Then** the feed entry remains visible (feed ≠ banner — banner is acknowledge-once, feed is persistent historical record)

**Given** score-corrections (T5.9)
**When** they emit `score.corrected` activity
**Then** the feed renders these with a "Corrected by {actor}" label and shows the prior vs. new value inline, not as a separate entry

**Given** `apps/tournament-web/src/components/activity-feed.test.tsx`
**When** tests run
**Then** render paths verified: empty state; 20-event paginated state; score-correction rendering; relative time rendering across fixture times (just now / 2 min ago / 3 hr ago / yesterday)

---

### Story T8.4: [new] Award Trigger Surfaces (first birdie, first eagle, skins-pot streak)

As a player whose score just triggered an award event,
I want a brief celebratory animation on my player home when the award fires,
So that the first-birdie-of-the-trip moment gets the dopamine it deserves without a push notification ever being needed (FD-5, FR-C3).

**Depends on:** T8.1 (activity types include `award.triggered`), T8.2 (toast for surfacing), T6.4 (press-engine emits context needed for detection).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/services/awards.ts`
**When** inspected
**Then** it exports `evaluateAwards(tx, event: ScoreCommittedEvent): Promise<AwardTriggered[]>` — pure-ish (reads state via `tx`, emits new activity via emitActivity). Runs inside the T5.6 score-commit transaction after the 2v2 + press hooks complete. Detects the following award types v1:
  - `first_birdie_of_event` — first score < par for ANY player in the Event
  - `first_eagle_of_event` — first score ≤ par − 2
  - `skins_pot_streak` — same player wins ≥3 consecutive skin holes in a single round (computed via the latest skins sub-game result)

**Given** a qualifying award trigger
**When** detected
**Then** the service calls `emitActivity(tx, { type: 'award.triggered', eventId, actorPlayerId, payload: { awardType, context: {...} } })`. Detection is idempotent: re-running against the same state produces no duplicate activity (check `activity WHERE event_id=? AND type='award.triggered' AND json_extract(payload_json, '$.awardType')=?` for prior fire).

**Given** an `award.triggered` activity in the feed
**When** the T8.2 hook emits it and the affected player opens the app
**Then** a celebratory animation plays on their player home (full-screen overlay for eagles, corner animation for birdies, gold banner for skins streak); auto-dismisses after ~4 seconds

**Given** the awards service throws (pure-function bug in detection)
**When** the score commit runs
**Then** per the T6.4 fail-loud posture, the transaction rolls back and 422 surfaces to the scorer. The awards service is NOT best-effort; detection correctness is important enough to fail loudly.

**Given** `apps/tournament-api/src/services/awards.test.ts`
**When** tests run
**Then** tests cover: (a) first birdie of event fires once + doesn't re-fire on second birdie; (b) first eagle fires independently from first birdie; (c) skins-pot streak detected across 3 consecutive wins; (d) streak broken by a different winner resets detection; (e) idempotency — re-run against same state, zero new activity rows

---

## My flagged questions (please respond to each)

1. **T8.1 event-type enum completeness** — I listed 16 types. Cross-reference the emission points listed in the context section above. Are any missing? Any redundant? Specifically: should `round.started` be a distinct type, or is its information fully captured by the first `score.committed` of a round (since that's the state transition trigger per T5.6)?

2. **T8.1 Zod schema completeness** — the story says "one Zod schema per type" but doesn't enumerate the 16 schemas' field shapes. Is the level of abstraction OK (story commits to existence + validation discipline; schemas fleshed out in implementation)? Or should the story inline the 16 schema shapes as additional ACs?

3. **T8.1 `no direct tx.insert(activity)` enforcement** — I specced it as a convention with a "maybe add ESLint rule later." Push back — should the ESLint rule be part of this story's AC, not deferred? (If so, the rule itself is trivial; it's a `no-restricted-syntax` rule keyed on the `activity` table import.)

4. **T8.2 storm-collapse threshold** — I chose ≥3 banner-eligible events within 5 seconds → collapse to summary. Is this the right threshold? Alternatives: 2/3s (more aggressive), 5/10s (less aggressive), or time-less (always collapse 3+ regardless of window).

5. **T8.2 banner vs toast event-type split** — I split as follows:
   - Toast: `score.committed (birdie+)`, `press.*`, `bet.flipped`, `lead.changed`, `award.triggered`
   - Banner: `press.*`, `bet.flipped`, `rule_set.revised`, `round.finalized`
   So presses AND bet flips appear as BOTH a toast (6s) AND a banner (persistent). Is the overlap correct — i.e., first-notice-then-acknowledge pattern — or should types be partitioned (toast xor banner)?

6. **T8.4 fail-loud vs best-effort** — I spec awards as fail-loud (throw = commit rolls back = 422 to scorer). Counterargument: awards are decorative; a missed award is acceptable but a blocked score commit is not. Should awards be best-effort (try/catch inside the transaction, log the error, continue)?

7. **T8.4 idempotency strategy** — I check for prior `award.triggered` activity rows with the same `awardType`. This is O(activities) per detection call. Alternative: a `awards_fired(event_id, award_type, PK)` table with UNIQUE constraint — O(1) check. Trade-off is schema footprint vs. query performance. Given Pinehurst's scale (~576 hole commits × N award types), does the query cost matter enough to justify a separate table?

---

## End of review file

Please write findings to: `_bmad-output/planning-artifacts/tournament/reviews/T8-codex-findings.md`
