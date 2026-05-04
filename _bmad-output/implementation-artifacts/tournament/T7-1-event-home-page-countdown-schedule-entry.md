# T7-1: Event Home Page — Hero + Greeting + Entry Cards (Minimal v1)

## Status

ready-for-dev

## Story

As any Event participant, I want an Event home page at `/events/:eventId` showing the Event name + date range + countdown + a "you're in, {name}" greeting + entry cards into the surfaces that already exist (Leaderboard, Money, Bets, Settle-up), so that the trip's home base is one tap from the URL bar instead of a memorized deep link (FR-E1, FR-E3 — partial).

## v1 Scope (TRIM from epic AC)

The epic AC specifies a richer page: countdown ticker that re-flips on round start/end, "Your pairing for round 1" row, entry cards for **6** sub-pages (Schedule, Leaderboard, Pairings, Course Previews, Photo Gallery, Activity Feed), invite-link first-arrival pre-SSO state, admin-only cards split. Most of those routes don't exist yet (T7-2 Schedule, T7-3 Course Previews, T7-4 Photo Gallery, T8-3 Activity Feed). Shipping the full epic-AC home page now would link to dead ends.

**v1 trims to:**
- Hero band: Event name + date range + timezone + countdown text (computed at render — NO ticker / no auto-refresh; followup T7-1a).
- "You're in, {firstName}" greeting row (no pairing detail; followup T7-1b when T4-2 read endpoints expose viewer-pairing in a clean shape).
- Entry cards for the 4 surfaces that DO exist today: **Leaderboard, Money, Bets, Settle-up**. Each card is a `<Link to="/events/$eventId/{surface}">`-style anchor.
- Forbidden state: same `requireEventParticipant` 403 → inline "you aren't a participant" card pattern as the leaderboard/money/bets pages.

**Deferred to followups** (all listed below): countdown ticker, viewer-pairing row, Schedule/Course-Previews/Photo-Gallery/Activity-Feed cards, admin-only card split, mid/post-Event card state transitions, invite-link pre-SSO read-only state.

### Backend addition

The page needs Event metadata (name, startDate, endDate, timezone) which no existing endpoint surfaces in a clean shape. Add `GET /api/events/:eventId` returning `{ event: { id, name, startDate, endDate, timezone }, rounds: Array<{ id, roundNumber, roundDate, holesToPlay }> }` — the `id` field is the `event_rounds` primary key (no separate `eventRoundId` field; the table's PK and the per-round identity are the same column). Auth chain: `requireSession` + `requireEventParticipant` (mirrors money/bets). No-existence-leak: 403 from middleware.

### Time-semantics convention

`event.startDate` / `event.endDate` / `event_rounds.roundDate` are all stored as **ms-since-epoch encoding the local-day-start (midnight) in the event's IANA timezone**. This convention is set by T3-1's seed and matches how the events get scheduled (you don't schedule "round 1 at 9:42:13 UTC", you schedule "round 1 on May 8" in Pinehurst time). The countdown computes against `roundDate` directly and rounds to the nearest day.

## Path footprint — ALLOWED only

```
apps/tournament-api/src/routes/events.ts                          [NEW]
apps/tournament-api/src/routes/events.integration.test.ts         [NEW]
apps/tournament-api/src/app.ts                                    [MODIFIED — mount]
apps/tournament-web/src/routes/events.$eventId.index.tsx          [NEW]
apps/tournament-web/src/routes/events.$eventId.index.test.tsx     [NEW]
```

5 NEW + 1 MODIFIED. All under `apps/tournament-*/`. Zero SHARED, zero FORBIDDEN.

(Note: TanStack Router's file-route convention is `events.$eventId.index.tsx` for the `/events/:eventId` index; the bare `events.$eventId.tsx` would conflict with the existing `.leaderboard.tsx`-style children.)

## Acceptance Criteria

**AC-1 — `GET /api/events/:eventId` happy path.**

**Given** session player is a participant of `:eventId`
**When** invoked
**Then** returns 200 with body:

```ts
{
  event: {
    id: string;
    name: string;
    startDate: number;          // ms-since-epoch (matches DB shape)
    endDate: number;
    timezone: string;            // IANA (e.g., "America/New_York")
  };
  rounds: Array<{
    id: string;                  // event_rounds.id
    roundNumber: number;
    roundDate: number;           // ms-since-epoch
    holesToPlay: 9 | 18;
  }>;       // ordered by round_number asc
}
```

`cache-control: no-store` (mirrors money/bets).

**AC-2 — `GET /api/events/:eventId` auth chain + no-existence-leak.**

**Given** anonymous → 401 from `requireSession`. **Given** authenticated non-participant → 403 `not_event_participant` from `requireEventParticipant`. **Given** malformed `eventId` (not a UUID) OR unknown `eventId` → 403 `not_event_participant` from the same middleware (the SQL `WHERE groups.event_id = ?` returns 0 rows for both cases, so the predicate evaluates to "not a participant" — same response shape). NEVER 404. The handler body never runs for these cases, so no value-validation 500s either.

**AC-3 — Web page renders hero + greeting + entry cards.**

**Given** session player is a participant
**When** `/events/:eventId` loads
**Then** the page renders:
  - `<h1>` Event name.
  - Hero subtitle: `{startDate} – {endDate}` formatted in the event's timezone via `Intl.DateTimeFormat` with `timeZone: event.timezone` (NEVER viewer's device timezone). Format: `MMM d` for both ends, omitting the year if start+end share the same year.
  - Countdown text (computed once at render — no ticker; tests pin `Date.now()` via `vi.useFakeTimers()` for determinism):
    - If next-round `roundDate` > now AND diff ≥ 1 day → `Round {N} starts in {M} day(s)` (rounded down via `Math.floor((roundDate - now) / 86_400_000)`; "1 day" not "1 days" via simple plural rule).
    - If next-round `roundDate` > now AND diff < 1 day → `Round {N} starts today`.
    - If `now >= lastRoundDate + 86_400_000` (one day past last round) → `Event complete`.
    - Otherwise (mid-event window: now ≥ some round's date AND < lastRoundDate + 1 day) → `Round in progress`. Detail flips deferred to T7-1e.
  - Greeting row: `You're in, {firstName}` where `firstName = player.name.split(' ')[0]`.
  - Entry cards (4): Leaderboard, Money, Bets, Settle-up. Each is a clickable card linking to the corresponding sub-route. Each card has a brief description ("See live standings" / "Head-to-head money matrix" / "Your bets" / "End-of-trip settle").

**AC-3a — Frontend auth/error handling distinguishes 401 from 403.**

The page mirrors the leaderboard pattern (`events.$eventId.leaderboard.tsx:275-290`):

  - `beforeLoad` calls `loadAuthStatus()` → if `status.player === null` → `window.location.assign('/api/auth/google')` + throw to abort the route. Anonymous viewers redirect; never reach the data fetch.
  - Authenticated viewers reach the data fetch. The fetch returns `{ kind: 'forbidden' }` for 403 and `{ kind: 'ok', data }` for 200. The component renders the inline forbidden card for `'forbidden'`. There is no in-app handling of 401 in the data-fetch path — `requireSession` would return 401 only if the session cookie expired between page load and fetch (rare); a 401 from the fetch is rendered as a generic error message and the user can refresh.

**AC-4 — Forbidden state.**

**Given** anonymous viewer → `window.location.assign('/api/auth/google')` redirect. **Given** 403 from API → inline "You aren't a participant in this event" card. Same pattern as leaderboard/money/bets.

**AC-5 — Tests.**

API test (integration, mirrors money/bets pattern):
  - 200 happy path returns event + rounds; rounds field ordered ascending by `roundNumber`.
  - 403 non-participant (outsider).
  - 403 unknown eventId (no-existence-leak).
  - 403 malformed eventId (not a UUID).

Web test:
  - Renders Event name + greeting + 4 entry cards.
  - Renders forbidden card on 403.
  - Countdown text: with `vi.useFakeTimers()` pinned BEFORE event start → "Round 1 starts in {N} days". Pinned AFTER event end → "Event complete". Pinned within 24h of round 1 → "Round 1 starts today". Tests use `vi.setSystemTime()` for deterministic now.
  - Hero date format: with timezone `America/New_York` and startDate/endDate in same year, asserts no year appears. With timezone different from system locale, asserts the formatted text is in the event's TZ (snapshot a known instant).

## Followups

- **T7-1a (countdown ticker):** poll/tick logic so the countdown updates every second/minute without page reload. v1.5 polish.
- **T7-1b (viewer pairing row):** "Your foursome for round 1: {3 names}" once T4-2 exposes a clean per-viewer pairing read endpoint.
- **T7-1c (Schedule/Course-Previews/Photo-Gallery/Activity-Feed cards):** add entry cards as those routes ship (T7-2, T7-3, T7-4, T8-3).
- **T7-1d (admin-only card split):** event settings, raw-state export, admin Bets — visible only when `viewer.id === event.organizerPlayerId`.
- **T7-1e (mid/post-Event card flips):** countdown card transforms into "Round N is LIVE" + scoring entry / "Watch leaderboard" / "Settle up" depending on current state.
- **T7-1f (invite-link first-arrival pre-SSO state):** AC mandated this in epic; defer until T3-6 invite-claim flow's edge cases are nailed down.

## Codex review notes

### Spec-codex round 1: 0 critical, 2 H, 2 M, 1 L. All addressed inline:

- **High #1 (eventRoundId vs id inconsistency)** — clarified that the rounds[] field uses `id` (= event_rounds primary key); no separate `eventRoundId` field.
- **High #2 (countdown timezone semantics)** — added explicit time-semantics convention: roundDate is local-day-start (midnight) in event's IANA tz, encoded ms-since-epoch. Countdown computes against this.
- **Medium #3 (no-existence-leak + malformed IDs)** — AC-2 now spells out that malformed UUIDs return 403 from the middleware (the SQL eq predicate returns 0 rows), never 500.
- **Medium #4 (frontend 401 vs 403)** — added AC-3a explicit auth/error handling: `beforeLoad` → 401 path redirects; data fetch → 403 inline card.
- **Low #5 (countdown copy + test determinism)** — AC-3 now specifies rounding (`Math.floor`), plural rule, "today" threshold; AC-5 tests use `vi.useFakeTimers()` + `vi.setSystemTime()` for deterministic now.

Per autonomous-progress mandate: proceeding to implementation without a third spec round.

### Impl-codex round 1: 0 critical, 1 H, 2 M, 2 L. Two findings rejected as out-of-scope (consistent with established v1 conventions); three addressed inline:

- **High #1 (hard-coded `TENANT_ID = 'guyan'`)** — REJECTED as out-of-scope. Every existing tournament route follows this pattern (money.ts, bets.ts, leaderboard, sub-games, etc.) per FD-1's single-tenant v1 assumption. Multi-tenant tenant-derivation is a v2+ cross-cutting concern; introducing it for one route would create inconsistency without a system-wide migration.
- **Medium #2 (`beforeLoad` uses `window.location.assign` + thrown Error)** — REJECTED as out-of-scope. Same pattern is used by every other tournament page (`events.$eventId.leaderboard.tsx`, `events.$eventId.money.tsx`, `events.$eventId.bets.tsx`, `events.$eventId.settle-up.tsx`). If the pattern is fragile, the fix is system-wide, not local to T7-1.
- **Medium #3 (countdown 1-day boundary)** — addressed: added two boundary tests covering `diff === ONE_DAY_MS` ("1 day") and `diff === ONE_DAY_MS - 1` ("today").
- **Low #4 (misleading test label)** — addressed: split into two tests with accurate labels covering the actual boundary semantics.
- **Low #5 (timezone test doesn't validate "not viewer's local")** — addressed: added Pacific/Auckland fixture asserting the rendered date matches Auckland-time, which would differ from any plausible CI viewer timezone (UTC, NY).

## Files this story will edit

- apps/tournament-api/src/routes/events.ts
- apps/tournament-api/src/routes/events.integration.test.ts
- apps/tournament-api/src/app.ts
- apps/tournament-web/src/routes/events.$eventId.index.tsx
- apps/tournament-web/src/routes/events.$eventId.index.test.tsx

## Risks / Followups

- **Naming collision with existing `events.$eventId.*` child routes.** TanStack Router file-route convention requires `index.tsx` for the bare `/events/:eventId` path when sibling files like `events.$eventId.leaderboard.tsx` exist. Caught at planning; no risk if the file is named correctly.
- **Timezone formatting** — must use `event.timezone`, NOT viewer's device timezone. Hard-pin at the formatter call site; defensive copy of the test fixture asserts a non-local timezone.
- **`requireEventParticipant` is group-member-scoped.** Same caveat as bets/money: an event organizer who isn't a group member would 403. T6-8a is the cross-cutting fix; T7-1d depends on it for the admin-card split.
