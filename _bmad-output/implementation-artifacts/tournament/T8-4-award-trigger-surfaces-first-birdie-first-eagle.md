# T8-4: Award Trigger Surfaces (First Birdie + First Eagle, Best-Effort)

## Status

ready-for-dev

## Story

As a player whose score just triggered a first-of-event award, I want a brief celebratory animation on my player home when the award fires, so that the first-birdie-of-the-trip moment gets the dopamine it deserves without a push notification ever being needed (FD-5, FR-C3).

## v1 Scope

T8-1 + T8-2 + T8-3 ship the consumer surfaces (typed activity spine, paginated read API, singleton provider, toast, banner, feed). The `award.triggered` headline + icon + route are already wired across all three frontend surfaces. T8-4 is the **production producer** — server-side detection of first-birdie/first-eagle inside the score-commit transaction, emitting `award.triggered` activity rows that flow through the existing pipeline. Plus a small player-home celebration overlay for the affected player.

**Award scope (post-Codex per epic line 2689):** v1 detects exactly two award types:
- `first_birdie_of_event` — first `score.committed` in this Event where `toPar < 0`.
- `first_eagle_of_event` — first `score.committed` in this Event where `toPar <= -2`. INDEPENDENT of the birdie award (an eagle fires its own award even if a prior birdie already fired in the event).

**`skins_pot_streak` is deferred to v1.5.** The award is not derivable at score-commit time from the currently locked T6 shape (skins results are authoritative only at finalize; no live per-hole skins result exists during scoring). Supporting it would require adding a live interim skins recompute on hole-complete — explicit v1.5 enhancement story.

### Layer 1 — Awards service (`apps/tournament-api/src/services/awards.ts`, NEW)

```ts
import { and, eq, sql } from 'drizzle-orm';
import { activity } from '../db/schema/index.js';
import type { ScoreCommittedEvent, AwardTriggeredEvent } from '../engine/types/activity-events.js';
import { emitActivity } from '../lib/activity.js';
import type { Logger } from 'pino';

type Tx = ...;  // existing tx type alias

const TENANT_ID = 'guyan';

export async function evaluateAwards(
  tx: Tx,
  event: ScoreCommittedEvent,
  log: Logger,
): Promise<void> {
  // Cheap pre-check: skip if not sub-par. Saves the idempotency query
  // for the 90%+ of commits that aren't candidates. Gate on `toPar < 0`
  // directly rather than `isBirdieOrBetter` — those should always
  // agree (T8-1 typed event computes `isBirdieOrBetter = toPar < 0` in
  // scores.ts), but if they ever diverge due to a refactor or bug, the
  // award definition (toPar < 0 per epic line 2698) is the single
  // source of truth (codex spec round-1 Med #3).
  if (event.toPar >= 0) return;

  const candidates: Array<'first_birdie_of_event' | 'first_eagle_of_event'> = [
    'first_birdie_of_event',
  ];
  if (event.toPar <= -2) {
    candidates.push('first_eagle_of_event');
  }

  for (const awardType of candidates) {
    // Idempotency: query existing award.triggered activity for this event +
    // awardType. If present, skip. The lookup uses json_extract on
    // payload_json — SQLite-supported, O(N) over event's activity rows
    // which is small at Pinehurst scale.
    const existing = await tx
      .select({ id: activity.id })
      .from(activity)
      .where(
        and(
          eq(activity.eventId, event.eventId),
          eq(activity.tenantId, TENANT_ID),
          eq(activity.type, 'award.triggered'),
          sql`json_extract(${activity.payloadJson}, '$.awardType') = ${awardType}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      log.debug({
        msg: 'awards_idempotent_skip',
        eventId: event.eventId,
        awardType,
      });
      continue;
    }

    // Build + emit the award.triggered event.
    const awardEvent: AwardTriggeredEvent = {
      type: 'award.triggered',
      eventId: event.eventId,
      roundId: event.roundId,
      awardType,
      playerId: event.playerId,
      context: {
        holeNumber: event.holeNumber,
        grossStrokes: event.grossStrokes,
        par: event.par,
      },
    };
    await emitActivity(tx, awardEvent);
    log.info({
      msg: 'awards_emitted',
      eventId: event.eventId,
      roundId: event.roundId,
      awardType,
      playerId: event.playerId,
      holeNumber: event.holeNumber,
    });
  }
}
```

**Why this file lives in `services/` and is allowlisted:** awards.ts is a peer to `activity-feed.ts` — it READS the activity table for idempotency lookups AND CALLS emitActivity. The ESLint write-gate must stay armed (the service never writes activity directly; emitActivity is the only legitimate writer). The import block must be off (the service needs `import { activity } from '../db/schema/index.js'` to issue the SELECT). Same allowlist tier as activity-feed.ts.

### Layer 2 — Score-commit integration (`apps/tournament-api/src/routes/scores.ts`)

The integration point is RIGHT AFTER the press orchestrator block (currently `(5b)` at scores.ts:501-514). Before the round-state transition (`(6)` at scores.ts:516+).

Restructure: extract the score-committed event payload to a local variable so it can be passed to BOTH `emitActivity` AND `evaluateAwards`. Currently scores.ts builds the typed payload inline inside the `emitActivity` call at line 482-494; I'll lift it to a `const scoreEvent: ScoreCommittedEvent = { ... }` and pass it to both.

**Best-effort posture (epic line 2705-2707, Codex High 3 + Josh call 6).** The awards block is wrapped in `try / catch` inside the T5.6 transaction:

```ts
// (5c) T8-4 awards — best-effort. A throw here MUST NOT roll back the
// score commit; missing a celebratory animation is acceptable, but
// rejecting a legitimate score because the decorative engine threw is
// not. Different posture from T6.4 press-engine which IS fail-loud
// because presses affect money.
try {
  await evaluateAwards(tx, scoreEvent, log);
} catch (err) {
  log.error({
    msg: 'awards_evaluate_failed',
    requestId,
    eventId: scoreEvent.eventId,
    roundId: scoreEvent.roundId,
    holeNumber: scoreEvent.holeNumber,
    playerId: scoreEvent.playerId,
    err: String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  // Swallow — the score commit continues.
}
```

The `try/catch` is INSIDE the `db.transaction(async (tx) => {...})` block. A throw inside the catch handler swallows; the outer transaction commits the score + audit + activity rows. If `evaluateAwards` itself emits an `award.triggered` activity AND THEN throws (which can't happen in the current shape — emit is the last operation per award type), the typed Zod parse inside emitActivity would have already validated; but in any case the transaction would still succeed because the catch swallows.

The score-committed gate `if (round.eventId !== null && round.eventRoundId !== null)` already wraps the whole emit + awards block — non-event rounds skip both.

### Layer 3 — Awards service tests (`apps/tournament-api/src/services/awards.test.ts`, NEW)

Coverage per epic AC (line 2713-2715):

1. **First birdie of event fires once + doesn't re-fire:** seed empty activity. Call `evaluateAwards` with a birdie ScoreCommittedEvent → assert ONE `award.triggered` activity row written with `awardType='first_birdie_of_event'`. Call again with a SECOND birdie ScoreCommittedEvent → assert NO new row.
2. **First eagle fires independently from first birdie:** seed a pre-existing `first_birdie_of_event` activity row. Call `evaluateAwards` with an eagle ScoreCommittedEvent → assert a new `award.triggered` row with `awardType='first_eagle_of_event'` (NOT a duplicate birdie).
3. **Best-effort throw → score commit succeeds, no award row, error logged:** wrap a synthetic `evaluateAwards`-like call in a transaction; inject a throw via a stub; assert: (a) caller's surrounding tx commits, (b) zero `award.triggered` rows for that eventId, (c) log captures the error context. (This test asserts the route-level wrapping behavior; the awards service itself just throws — it's the route that swallows.)
4. **Idempotency:** seed an existing `award.triggered` row for `first_birdie_of_event`. Call `evaluateAwards` with another birdie event → assert zero new rows AND a debug-level log captures the idempotent skip.
5. **`skins_pot_streak` is NOT detected (v1 scope check):** call `evaluateAwards` with a birdie event → assert NO `award.triggered` row with `awardType='skins_pot_streak'` (verifies the candidate list is fixed to v1 types).

Pre-check optimization test:
6. **Non-sub-par scores skip the idempotency query:** spy on `tx.select`. Call `evaluateAwards` with `isBirdieOrBetter: false` → assert `tx.select` never invoked.

Tests use the same `file::memory:?cache=shared` pattern as `activity.test.ts` + ESLint allowlisting for direct schema seeding.

### Layer 4 — ESLint allowlist update

Add `src/services/awards.ts` to the read-side override block alongside `services/activity-feed.ts`. The override re-declares `no-restricted-imports` with ONLY the engine restriction (omits the `activity`-import block). The write-gate selectors stay ARMED on the file.

`src/services/awards.test.ts` joins the test allowlist tier alongside `activity.test.ts` and `activity.integration.test.ts` (full off — needs to seed activity rows for setup).

### Layer 5 — AwardCelebration component (`apps/tournament-web/src/components/award-celebration.tsx`, NEW)

Subscribes to `useActivityStream`. Filters to `award.triggered` events where `event.playerId === session.player.id`. Renders a full-screen overlay (for eagle) or corner animation (for birdie) for ~4 seconds, auto-dismiss.

```tsx
const ANIMATION_TTL_MS = 4_000;

type CelebrationEntry = {
  rowId: string;
  awardType: 'first_birdie_of_event' | 'first_eagle_of_event';
  arrivedAt: number;
};

export function AwardCelebration() {
  const session = useAuthSession();
  const { rows } = useActivityFeed();
  const myPlayerId = session.player?.id ?? null;
  const [entries, setEntries] = useState<CelebrationEntry[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Auth-resolve catchup (codex spec round-1 High #5). When myPlayerId
  // transitions from null → a real id, scan the provider's rows[] for
  // recent (within ANIMATION_TTL_MS) award.triggered events that match
  // the player. Without this, an award that arrives BEFORE auth
  // resolves would be permanently missed — the activity stream
  // delivers it once, the handler short-circuits on null myPlayerId,
  // and there's no replay.
  useEffect(() => {
    if (myPlayerId === null) return;
    const now = Date.now();
    const fresh: CelebrationEntry[] = [];
    for (const r of rows) {
      if (seenIdsRef.current.has(r.id)) continue;
      if (r.event.type !== 'award.triggered') continue;
      if (r.event['playerId'] !== myPlayerId) continue;
      if (now - r.createdAt > ANIMATION_TTL_MS) continue;
      const at = r.event['awardType'];
      if (at !== 'first_birdie_of_event' && at !== 'first_eagle_of_event') {
        continue; // codex spec round-2 Low #3 — skip unknown types
      }
      seenIdsRef.current.add(r.id);
      fresh.push({
        rowId: r.id,
        awardType: at,
        arrivedAt: r.createdAt,
      });
    }
    if (fresh.length === 0) return;
    setEntries((prev) => [...prev, ...fresh]);
  }, [myPlayerId, rows]);

  const handler = useCallback((newRows: ActivityRow[]) => {
    if (myPlayerId === null) return;
    const mine: CelebrationEntry[] = [];
    for (const r of newRows) {
      if (seenIdsRef.current.has(r.id)) continue;
      if (r.event.type !== 'award.triggered') continue;
      if (r.event['playerId'] !== myPlayerId) continue;
      // Codex spec round-2 Low #3: skip unknown awardType values
      // entirely rather than mapping them to a default (e.g., birdie).
      // A v1.5 award type would surface in the activity feed but NOT
      // crash or render the wrong celebration.
      const at = r.event['awardType'];
      if (at !== 'first_birdie_of_event' && at !== 'first_eagle_of_event') {
        continue;
      }
      seenIdsRef.current.add(r.id);
      mine.push({
        rowId: r.id,
        awardType: at,
        arrivedAt: Date.now(),
      });
    }
    if (mine.length === 0) return;
    setEntries((prev) => [...prev, ...mine]);
  }, [myPlayerId]);

  useActivityStream(handler);

  useEffect(() => {
    if (entries.length === 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setEntries((prev) => prev.filter((e) => now - e.arrivedAt < ANIMATION_TTL_MS));
    }, 250);
    return () => window.clearInterval(id);
  }, [entries.length]);

  if (entries.length === 0) return null;

  // Codex spec round-1 Med #6 + round-2 Med #2: when multiple eagles
  // fire in the TTL window (rare — distinct first-eagle events imply
  // distinct events), pick the MOST RECENT eagle so the player sees
  // the freshest moment. Eagle ALWAYS wins over birdie in mixed
  // batches.
  const mostRecentEagle = [...entries]
    .reverse()
    .find((e) => e.awardType === 'first_eagle_of_event');
  const entry = mostRecentEagle ?? entries[entries.length - 1]!;
  const isEagle = entry.awardType === 'first_eagle_of_event';

  return isEagle ? (
    <FullScreenEagleOverlay key={entry.rowId} />
  ) : (
    <CornerBirdieAnimation key={entry.rowId} />
  );
}
```

**Visual treatment (intentionally minimal for v1):**
- `FullScreenEagleOverlay`: a `position: fixed` overlay at z-index 1300 (above Toast at 1100, Banner at 1050), semi-transparent dark backdrop, centered "🦅 Eagle!" headline + subline "First eagle of the trip — congrats!". CSS `@keyframes` fade-in over 200ms; auto-dismisses at 4s via the parent unmount.
- `CornerBirdieAnimation`: a `position: fixed; top: 16px; left: 16px;` card with "🐦 Birdie!" + subline. Slides in from the left over 200ms.

**Auth session reading.** `useAuthSession()` is a tiny hook that calls `useQuery({ queryKey: ['auth-status'], queryFn: fetchAuthStatus, staleTime: 30_000, retry: false })` — same key as the existing InstallPromptHost so TanStack Query dedupes. Returns `{ player: { id, isOrganizer } | null, device: ... | null }`.

For v1, this hook lives in `apps/tournament-web/src/hooks/use-auth-session.ts`. Already-extant logic from __root.tsx's `fetchAuthStatus` is moved into the hook; __root.tsx then calls the same hook (small refactor). Keeps the auth-query in one place.

### Layer 6 — `__root.tsx` wiring

```tsx
function RootComponent() {
  return (
    <FirstMutationProvider>
      <ActivityFeedProvider>
        <div>
          <Outlet />
          <InstallPromptHost />
          <TournamentToast />
          <TournamentBanner />
          <AwardCelebration />
        </div>
      </ActivityFeedProvider>
    </FirstMutationProvider>
  );
}
```

Mount sits below the existing surfaces. The celebration's full-screen overlay z-index (1300) ensures it visually wins over Toast/Banner if firing simultaneously.

### Layer 7 — AwardCelebration tests (`apps/tournament-web/src/components/award-celebration.test.tsx`, NEW)

Uses the StubProvider pattern from T8-2's tournament-toast/banner tests. Coverage:

1. **Affected player, birdie award**: emit `award.triggered` with `playerId === sessionPlayerId, awardType='first_birdie_of_event'` → corner birdie animation renders.
2. **Affected player, eagle award**: same with `awardType='first_eagle_of_event'` → full-screen eagle overlay renders.
3. **Other player's award**: emit with `playerId !== sessionPlayerId` → NO celebration (other surfaces — toast/banner/feed — show it; celebration is per-affected-player).
4. **Auto-dismiss at 4s**: emit, advance fake timers 4500ms, assert celebration unmounts.
5. **No session (not authenticated)**: `myPlayerId === null` → no celebration even on a matching event.
6. **Auth-resolve catchup (codex spec round-1 High #5)**: render with `session.player === null`, emit a matching `award.triggered` event (handler short-circuits, nothing renders), THEN flip session to a real player whose id matches → assert celebration renders for the previously-missed award (catchup logic at the auth-resolve effect picked it up from the provider rows).
7. **Stale-row catchup is bounded by TTL**: emit a matching `award.triggered` row with `createdAt = Date.now() - 10_000` (older than 4s TTL), THEN resolve auth → assert NO celebration renders (the row is past the TTL window, would be a stale re-celebration).
8. **Eagle priority over birdie (codex spec round-1 Med #6)**: emit BOTH `first_birdie_of_event` AND `first_eagle_of_event` for the same player in one batch → assert the FullScreenEagleOverlay renders (NOT the corner birdie animation).

The session-fetch is mocked at the hook level (`vi.mock('../hooks/use-auth-session', ...)`) so tests don't need to stand up auth-status.

### Layer 8 — Sprint-status hygiene

Flip T8-4 from `backlog → ready-for-dev → in-progress → review → done`. After T8-4 commits, every story under T8 is `done` → epic-T8 status flag is then stale (currently `in-progress`). Bundle the epic-T8 → done flip into this commit's sprint-status edit, mirroring the T7-7 + T8-1 patterns.

## Acceptance Criteria

**AC #1 — Awards service exists and detects v1 award types.**

**Given** `apps/tournament-api/src/services/awards.ts`
**When** inspected
**Then** it exports `evaluateAwards(tx, event: ScoreCommittedEvent, log: Logger): Promise<void>`. Internally: (a) early-returns when `event.toPar >= 0` (codex spec round-1 Med #3 — gate on toPar directly per the epic's award definition, not the `isBirdieOrBetter` derived field); (b) builds a candidate list including `first_birdie_of_event` always (sub-par implies birdie or better) plus `first_eagle_of_event` when `event.toPar <= -2`; (c) for each candidate, queries the activity table for an existing `award.triggered` row with matching `awardType` via `json_extract(payload_json, '$.awardType') = ?` — if present, skip (idempotent); if absent, call `emitActivity` with a typed `AwardTriggeredEvent`. Both information logs (`awards_emitted` on emit, `awards_idempotent_skip` on dedupe) carry eventId + awardType + playerId.

**AC #2 — Score-commit integration with best-effort try/catch.**

**Given** `apps/tournament-api/src/routes/scores.ts`
**When** inspected
**Then** the score-committed event payload is built ONCE as a local `scoreEvent: ScoreCommittedEvent` variable inside the `if (round.eventId !== null && round.eventRoundId !== null)` block. The block then: (1) calls `emitActivity(tx, scoreEvent)`; (2) runs `runPressOrchestrator(tx, ...)`; (3) runs `await evaluateAwards(tx, scoreEvent, log)` wrapped in `try/catch`. The catch logs at level `error` with the eventId, roundId, holeNumber, playerId, err, and stack — and SWALLOWS the throw so the surrounding `db.transaction(async (tx) => {...})` continues to commit. Score commit succeeds even when awards detection throws.

**AC #3 — Idempotency.**

**Given** the activity table already contains an `award.triggered` row for `(eventId, awardType='first_birdie_of_event')`
**When** `evaluateAwards` is called with another birdie ScoreCommittedEvent for the same eventId
**Then** zero new `award.triggered` rows are inserted; the function logs `awards_idempotent_skip` at debug level.

**AC #4 — Eagle is independent of birdie.**

**Given** the activity table contains a `first_birdie_of_event` row for `eventId=E`
**When** `evaluateAwards` is called with an eagle event for the same `eventId=E` (`toPar <= -2`)
**Then** a NEW `award.triggered` row is inserted with `awardType='first_eagle_of_event'`. The existing birdie row is unchanged. (Per epic line 2699: an eagle fires its own award even if a prior birdie already fired.)

**AC #5 — Best-effort throw isolation.**

**Given** the awards service throws (synthetic injected error in detection logic)
**When** scores.ts processes a score commit
**Then** the score commit's outer transaction COMMITS (hole_scores row inserted, audit_log row inserted, activity `score.committed` emitted, press orchestrator emits, sub-game compute proceeds). The error is logged at level `error` with full context. The HTTP response is 200 success (NOT 500).

**Partial-commit semantics (codex spec round-1 Med #4).** If the awards service throws AFTER successfully emitting one award but BEFORE emitting a second (e.g., birdie emit succeeds, then eagle detection crashes), the already-emitted award row STAYS COMMITTED in the outer transaction. The contract is "zero OR more" award rows post-throw, not "zero". This is acceptable because: (a) any successfully-emitted award is a legitimate event; (b) the missed one is silent — the celebration that would have fired doesn't, but the trip continues. The corresponding test asserts: surrounding tx commits AND no MORE awards are emitted after the throw point AND the error is logged.

**AC #6 — Sub-par precheck.**

**Given** a `score.committed` event with `toPar >= 0` (par or worse)
**When** `evaluateAwards` is called
**Then** the function returns without issuing any database queries (idempotency lookup is skipped). Verified via a `tx.select` spy showing zero invocations. Gate is on `toPar` directly, not `isBirdieOrBetter` — the two fields should always agree (T8-1 computes the latter from the former), but the award definition (toPar < 0 per epic line 2698) is the single source of truth.

**AC #7 — `skins_pot_streak` v1 scope check.**

**Given** `evaluateAwards` is called with any qualifying birdie/eagle event
**When** completion is observed
**Then** no `award.triggered` row with `awardType='skins_pot_streak'` is ever written. The candidate list inside `evaluateAwards` is fixed to `['first_birdie_of_event', 'first_eagle_of_event']`. (Defensive — codex spec round-1 may flag if I leave a placeholder for skins_pot_streak.)

**AC #8 — AwardCelebration component renders for the affected player only.**

**Given** `apps/tournament-web/src/components/award-celebration.tsx`
**When** the activity stream emits an `award.triggered` event whose `playerId === session.player.id`
**Then** a celebration animation renders: full-screen overlay for `first_eagle_of_event`, corner animation for `first_birdie_of_event`. Auto-dismisses after 4 seconds.

**Given** an `award.triggered` event whose `playerId !== session.player.id`
**When** the activity stream emits it
**Then** the celebration component renders NOTHING. (Other players see the event in toast + feed via T8-2/T8-3; only the affected player gets the full-screen moment.)

**Given** the user is not authenticated (`session.player === null`)
**When** ANY `award.triggered` event arrives
**Then** the celebration renders nothing.

**AC #9 — Auth session hook extracted.**

**Given** `apps/tournament-web/src/hooks/use-auth-session.ts`
**When** inspected
**Then** it exports `useAuthSession(): { player, device } | { player: null, device: null }` reading from `useQuery({ queryKey: ['auth-status'], queryFn: fetchAuthStatus, staleTime: 30_000, retry: false })`. The `fetchAuthStatus` function lives in this hook file (extracted from __root.tsx's existing inline `fetchAuthStatus`). __root.tsx's `InstallPromptHost` is updated to call this hook instead of inlining the same query.

**AC #10 — __root.tsx wiring.**

**Given** `apps/tournament-web/src/routes/__root.tsx`
**When** inspected
**Then** `<AwardCelebration />` is mounted inside `<ActivityFeedProvider>` alongside `<TournamentToast />` and `<TournamentBanner />`.

**AC #11 — Test coverage.**

**Given** `apps/tournament-api/src/services/awards.test.ts`
**When** the new tests run
**Then** all 6 cases enumerated in Layer 3 are verified.

**Given** `apps/tournament-web/src/components/award-celebration.test.tsx`
**When** the new tests run
**Then** all 8 cases enumerated in Layer 7 are verified.

**AC #12 — Sprint-status hygiene + epic close.**

**Given** sprint-status.yaml after T8-4 commits
**When** inspected
**Then** T8-4 status is `done`. `epic-T8` status is also flipped from `in-progress` to `done` (every story under T8 will then be done — T8-1, T8-2, T8-3, T8-4). No other epic or story status values change.

## Tasks / Subtasks

- [ ] **Task 1 — Awards service (AC #1, #3, #4, #6, #7).**
  - [ ] Write `apps/tournament-api/src/services/awards.ts` per Layer 1.
  - [ ] Add `src/services/awards.ts` to the read-side ESLint allowlist alongside `activity-feed.ts`.

- [ ] **Task 2 — Score-commit integration (AC #2, #5).**
  - [ ] Modify `apps/tournament-api/src/routes/scores.ts`: lift the score-committed payload to a `scoreEvent` const; insert `try { await evaluateAwards(tx, scoreEvent, log); } catch (err) { log.error(...); }` after the press orchestrator block.

- [ ] **Task 3 — Awards service tests (AC #11).**
  - [ ] Write `apps/tournament-api/src/services/awards.test.ts` per Layer 3.
  - [ ] Add `src/services/awards.test.ts` to the test ESLint allowlist alongside `activity.test.ts`.

- [ ] **Task 4 — Auth session hook (AC #9).**
  - [ ] Write `apps/tournament-web/src/hooks/use-auth-session.ts` exporting `useAuthSession()` + `fetchAuthStatus`.
  - [ ] Refactor `__root.tsx`'s `InstallPromptHost` to call `useAuthSession()` instead of its inline `useQuery`. (Verify T7-6 install-prompt tests still pass without modification.)

- [ ] **Task 5 — AwardCelebration component (AC #8, #10).**
  - [ ] Write `apps/tournament-web/src/components/award-celebration.tsx` per Layer 5.
  - [ ] Mount `<AwardCelebration />` in `__root.tsx` per Layer 6.

- [ ] **Task 6 — AwardCelebration tests (AC #11).**
  - [ ] Write `apps/tournament-web/src/components/award-celebration.test.tsx` per Layer 7.

- [ ] **Task 7 — Sprint-status hygiene (AC #12).**
  - [ ] Flip T8-4 through ready-for-dev → in-progress → review → done.
  - [ ] Flip `epic-T8: in-progress → done` in the same commit.

- [ ] **Task 8 — Regression sweep.**
  - [ ] `pnpm --filter @tournament/api test` — every previously-passing test still passes; +6 awards tests.
  - [ ] `pnpm --filter @tournament/web test` — every previously-passing test still passes; +5 celebration tests; T7-6 install-prompt tests still pass after the auth-session refactor.
  - [ ] `pnpm -r typecheck` and `pnpm -r lint` — clean.

## Files this story will edit

- apps/tournament-api/src/services/awards.ts
- apps/tournament-api/src/services/awards.test.ts
- apps/tournament-api/src/routes/scores.ts
- apps/tournament-api/eslint.config.js
- apps/tournament-web/src/hooks/use-auth-session.ts
- apps/tournament-web/src/components/award-celebration.tsx
- apps/tournament-web/src/components/award-celebration.test.tsx
- apps/tournament-web/src/routes/__root.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

## Dev Notes

### Architectural alignment

- **FR-C3 + FD-5** ("pull not push"): the celebration animation is triggered by the existing 5s-poll provider stream, not a push notification. No SSE, no WebSocket, no server-to-client push.
- **T8-1 + T8-2 + T8-3 reuse**: T8-4 plugs into the existing typed activity contract. Award.triggered headlines, icons, and routes are already implemented across all three frontend surfaces from prior stories. T8-4 just adds the producer.
- **Best-effort posture vs. T6.4 fail-loud**: explicit asymmetry. Press engine errors fail-loud because money. Award engine errors fail-soft because dopamine. Codified in scores.ts with a try/catch around evaluateAwards but NOT around runPressOrchestrator.

### Key references

- **T8-1 typed event payloads**: `apps/tournament-api/src/engine/types/activity-events.ts` — `ScoreCommittedEvent` + `AwardTriggeredEvent` interfaces + `activityEventSchemas` Zod.
- **T8-1 emitter**: `apps/tournament-api/src/lib/activity.ts` — typed `emitActivity(tx, event)` consumed by awards.ts.
- **T8-2 read service**: `apps/tournament-api/src/services/activity-feed.ts` — sister file, same allowlist tier (read-only schema access). Awards.ts mirrors its ESLint posture.
- **T8-3 headline helper**: `apps/tournament-web/src/lib/activity-headline.ts` — already renders `award.triggered` headlines for toast/banner/feed across all surfaces.
- **scores.ts integration point**: lines 472-499 (existing emitActivity for score.committed) + 501-514 (press orchestrator). Awards block goes right after the press orchestrator.

### Risk acceptance

- **Hardcoded `TENANT_ID = 'guyan'` (codex spec round-1 High #1).** Awards.ts hardcodes the tenant in the idempotency WHERE clause. This matches the existing tournament-api posture across every service (audit-log, activity-feed, scores, presses, etc.) — single-tenant v1 with documented v1.5+ multi-tenant hardening sweep. Awards.ts does NOT introduce new debt; it inherits the existing pattern. Codex's flag is a project-level concern logged at the architectural level, not blocking.
- **Idempotency SELECT-then-INSERT race (codex spec round-1 High #2).** Two truly concurrent score-commits both passing the idempotency SELECT before either INSERTs could produce duplicate `award.triggered` rows. Real-world risk: extremely rare at Pinehurst-scale (4 foursomes × ~10s per score-commit = serial enough that simultaneous commits on the same award are vanishing-probability). Impact when it occurs: the activity feed shows 2 birdie awards; toast/banner display both; AwardCelebration's `seen` Set dedupes. Mild duplicate UX, NOT a data-integrity bug. **v1.5 hardening:** add a partial UNIQUE index `CREATE UNIQUE INDEX uniq_activity_first_award_per_type ON activity(event_id, json_extract(payload_json, '$.awardType')) WHERE type = 'award.triggered'`. Acceptable v1 trade-off; logged in followups.
- **Idempotency lookup is O(N) per score-post.** N is the count of `award.triggered` rows for the event. At Pinehurst scale (max 2 awards per event in v1), this is constant-time. Acceptable. v1.5 could add a partial unique index if scale demands.
- **Best-effort posture means a buggy awards detection silently misses awards.** Acceptable per Josh call 6: "missing a celebratory animation is acceptable; rejecting a legitimate score because the decorative engine threw is not." If awards reliability becomes a real concern, the SQL-level idempotency contract (lookup on `payload_json $.awardType`) can be migrated to a dedicated `awards_log` table with a partial unique index — v1.5+.
- **Celebration auto-dismiss at 4s.** No user-controlled dismiss button — the animation is brief enough that "tap-to-dismiss" feels like overkill for a 4-second moment. Trip-day acceptable; v1.5 polish could add tap-to-dismiss if user feedback says 4s feels too long or too short.
- **Multiple awards in a 4s window.** Theoretically possible if a player's first sub-par score is also their first eagle (e.g., albatross on hole 1 = both birdie + eagle). My implementation only renders the MOST RECENT entry (full-screen eagle wins over corner birdie). v1 acceptable; v1.5 could queue them sequentially.

### Followups

- **Tap-to-dismiss for celebration animations** (v1.5) — current 4s auto-dismiss is fine for brief moments; user feedback would drive whether explicit dismiss is needed.
- **`skins_pot_streak` award type** (v1.5) — requires a live interim skins recompute on hole-complete; epic-spec deferred. Separate story.
- **Awards on past-finalized rounds** (v1.5) — current logic only fires at score-commit time. A backfill job (or a finalize-time recheck) could detect missed awards for rounds that were committed before T8-4 shipped.
- **Player-name hydration in award headline** (v1.5 — recurring theme from T8-2/T8-3) — `award.triggered.playerId` renders raw. Same fix path as the other surfaces.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Opus 4.7, 1M context)

### Debug Log References

### Completion Notes List

### File List
