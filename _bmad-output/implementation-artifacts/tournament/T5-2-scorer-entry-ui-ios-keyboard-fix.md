# T5-2: Scorer Entry UI [port — iOS keyboard fix intact]

## Status

Ready for Dev

## Story

As a scorer,
I want a scorer entry screen at `/rounds/:roundId/score-entry` that auto-advances across the foursome's players per hole with ≤10s interaction (NFR-P1) and keeps the iOS keyboard open across hole advances (Wolf Cup commit `ebe3cea`),
So that I can score a foursome of Pinehurst at the hoped-for cadence (FR-B2) without the keyboard flapping.

T5-2 is invoked third in Josh's Option-A sequencing: T5-3 ✓ → T5-6 ✓ → **T5-2 (this)**. All dependencies are met. T5-2 wires both T5-3's queue (Save → `enqueueMutation`) and T5-6's endpoint (the queue's URL targets `/api/rounds/:roundId/holes/:holeNumber/scores`).

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

This story touches:

**Backend (the GET endpoint the UI reads on mount):**
- `apps/tournament-api/src/routes/scores.ts` — modified (add `GET /:roundId` handler returning the score-entry-context shape; keeps the existing POST handler intact)
- `apps/tournament-api/src/routes/scores.read.test.ts` — NEW (8 GET tests)

**Frontend (the actual UI port):**
- `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx` — NEW (the score-entry route component)
- `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx` — NEW (component tests via @testing-library/react)
- `apps/tournament-web/PORTS.md` — modified (append a port row for score-entry)

**Story-tracking:**
- `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` — T5-2 backlog → in-progress → review → done
- spec + codex review files under `_bmad-output/`

**Zero SHARED files.** No `package.json` change. No `pnpm-lock.yaml` change. (Tournament-web already has TanStack Query, idb, fake-indexeddb, all React 19 deps.)

**Zero FORBIDDEN edits.** No `apps/api/**`, `apps/web/**`, `packages/engine/**`. (We READ Wolf Cup's `score-entry-hole.tsx` for porting; we don't modify it.)

### 2. Wolf Cup port + structural translation

Wolf Cup source: `apps/web/src/routes/score-entry-hole.tsx` @ commit `67238a22a949e37d5d6143ddf46e3804aec57f59`, dated 2026-04-26. iOS keyboard fix referenced is `ebe3cea` (the synchronous-focus-on-Save pattern).

**This is NOT a verbatim port.** Wolf Cup's score-entry-hole.tsx is 1459 lines because it carries ALL the Wolf Cup features: wolf decisions (alone/partner/blind_wolf), greenies/polies/sandies, CTP per-par-3, per-week putts toggle, entry-code header, group-scoped routes (`/score-entry/:groupId/...`). T5-2's tournament version is targeted: ~250-300 lines covering ONLY the score-entry primitive + the iOS keyboard fix + offline-queue integration.

**Deltas T5-2 applies vs Wolf Cup `score-entry-hole.tsx`:**
- (a) Route shape: `/rounds/:roundId/score-entry` (round-scoped, NOT group-scoped). Wolf Cup uses `groupId` because Wolf Cup tracks foursomes via `groups`; tournament uses `pairings` from T4-2.
- (b) **REMOVED wolf-decision UI + state** (alone/partner/blind_wolf chips, partner picker, "set decision before save" validation). T6 epic owns wolf for tournament.
- (c) **REMOVED greenies/polies/sandies UI** (the bonus chips). T6 owns sub-games.
- (d) **REMOVED CTP per-par-3 prompt** (the par-3 modal that asks "who hit closest?"). CTP is Wolf Cup-specific; tournament v1 has no CTP.
- (e) **REMOVED entry-code header** (`x-entry-code`); tournament uses session-cookie auth (T1-6a `requireSession`).
- (f) **REMOVED putts-week toggle**; T5-2 ships an OPTIONAL putts input that's always visible (a `putts` field on the per-player input row that scorers can leave blank). Putts → `null` if blank, else integer 0-15.
- (g) **REMOVED autoCalculateMoney**; v1 doesn't compute money in the UI (T6 owns).
- (h) **CHANGED**: enqueue payload shape — `enqueueMutation({ kind: 'hole_score', url: '/api/rounds/${roundId}/holes/${holeNumber}/scores', body: { playerId, grossStrokes, putts: putts ?? null, clientEventId }, clientEventId, roundId })`. Wolf Cup's `enqueueScore` had a different payload (groupId+holeNumber+wolfDecision); tournament's is generic-kind via T5-3.
- (i) **CHANGED**: response handling — 200 deduped → silent (no toast, just remove the "pending" chip); 201 created → optimistic UI shows the score; 409 hole_already_scored → entry stays in queue with conflictPending=true; 422 round_not_writable / hole_number_exceeds_holes_to_play → toast + return scorer to leaderboard; 403 player_not_in_your_foursome / not_scorer_for_this_foursome → swap to the read-only placeholder with `currentScorerName`.
- (j) **PRESERVED VERBATIM (load-bearing)**: the iOS keyboard fix. Save button's onClick handler calls `scoreInputRefs.current[0]?.focus()` SYNCHRONOUSLY (inside the user-gesture click, NOT inside a mutation onSuccess callback) BEFORE invoking enqueueMutation. The score-input ref array uses stable `key={player.id}` so React reuses the same DOM input across hole advances → the keyboard stays open.
- (k) **PRESERVED**: auto-advance pattern. Single-digit input (1-9) on player N → `scoreInputRefs.current[N+1]?.focus()` advances; on the LAST player → `scoreInputRefs.current[N]?.blur()` dismisses the keyboard so the scorer can review.

### 3. Backend GET endpoint — `GET /api/rounds/:roundId`

The UI needs a single read on mount to render the right view. Mounted in the existing `scoresRouter` (`apps/tournament-api/src/routes/scores.ts`) so only one `app.route('/api/rounds', scoresRouter)` mount in `app.ts` (already there from T5-6).

**Chain**: `requireSession` only. NO `requireScorerForRound` (the GET is read-only; non-scorers must be able to fetch the round to render the read-only placeholder).

**Path**: `GET /:roundId` (relative; effective URL `GET /api/rounds/:roundId`).

**Path-param validation**: `:roundId` must match the UUID-shape regex (same one as T5-6). 400 `invalid_round_id` if mismatch.

**Response shape (200)**:
```ts
{
  roundId: string,
  state: 'not_started' | 'in_progress' | 'complete_editable' | 'finalized' | 'cancelled',
  holesToPlay: 9 | 18,
  myFoursome: {
    foursomeNumber: number,
    isScorer: boolean,                 // session.userId === scorerAssignments.scorer_player_id for this foursome (false if no scorer yet OR session ≠ assigned scorer)
    scorerPlayerId: string | null,     // null when no scorer_assignments row for this foursome (setup-pending)
    scorerName: string | null,         // null in the same case
    members: Array<{
      playerId: string,
      name: string,
      handicapIndex: number | null,    // players.manual_handicap_index; null if not set
    }>,                                // sorted by pairing_members.slot_number ASC (load-bearing for ref-positional indexing)
    holeScores: Array<{
      holeNumber: number,
      playerId: string,
      grossStrokes: number,
      putts: number | null,
    }>,
  },
}
```

**Error shapes**:
- 400 `invalid_round_id` — path UUID-shape fail.
- 401 — no session (standard `requireSession`).
- 404 `round_not_found` — **round doesn't exist OR foreign tenant OR session.userId is not a member of any foursome for this round**. Returning 404 (NOT 200 with `myFoursome: null`, NOT 403 not_round_participant) for the non-participant case obfuscates round existence — a probe attempt with random round IDs cannot distinguish "doesn't exist" from "exists but I'm not in it." Standard "exists XOR authorized" obfuscation pattern. (Round-1 codex caught the info-leak risk of 200+null.)

**No-scorer-yet path**: when the foursome has no `scorer_assignments` row (pre-T5-7 setup state OR organizer hasn't assigned), the GET returns 200 with `myFoursome.scorerPlayerId: null` + `scorerName: null` + `isScorer: false`. The UI renders a "Scorer not yet assigned for this foursome — ask the organizer" placeholder. The session can still be a participant with no assigned scorer; we don't gate the read on scorer-presence.

**Tenant scoping**: every SELECT filters on `tenant_id = TENANT_ID`. The lookup chain mirrors T5-6's middleware:
1. `rounds` row by id + tenant — 404 if absent.
2. `round_states` row by round_id + tenant. If absent → 422 `round_state_missing` (NOT a default-to-not-started). Rationale: v1 always seeds `round_states` (T5-8 seeds; T5-6 tests seed manually; T5-2 tests will seed manually too). A missing row = setup error = we want it loud, not silent. The UI handles 422 by showing a setup-error placeholder routing the user to the organizer.
3. All `pairings` for this round's `event_round_id`. For each pairing, fetch `pairing_members` (with player names + manual_handicap_index via JOIN to `players`). Build the per-foursome members map.
4. All `scorer_assignments` for this round. For each, fetch the scorer's name via JOIN to `players`. Build the scorer-by-foursome map.
5. Locate session.userId in pairing_members (across all of this round's pairings). Identify `myFoursomeNumber`. **If not found → 404 `round_not_found`** (uniform with foreign-tenant/non-existent for round-existence obfuscation per Risk Acceptance §3 error-shapes).
6. If found, compute `isScorer = scorerByFoursome[myFoursomeNumber]?.scorerPlayerId === session.userId`. Build `myFoursome.members` from the pairing_members. Fetch `hole_scores` filtered by round_id + the foursome's player_ids.
7. Return the response.

**Performance**: 4 SELECTs + a final hole_scores SELECT. ~5 queries total. Trip-day acceptable (NFR-P1 is ≤10s for the FOURSOME ENTRY pass; this is a single-page-load read).

### 4. Frontend route — `/rounds/:roundId/score-entry`

**TanStack Router** route. Uses TanStack Query's `useQuery` to fetch the GET endpoint on mount. The query key is `['round-detail', roundId]`; staleTime 0 (poll-on-focus to catch handoffs from T5-7). RefetchInterval 15000ms (15s) so a stale tab catches a scorer-handoff within ~15s without WebSockets (epic AC line 1494). **`refetchIntervalInBackground: false`** (TanStack Query default) — backgrounded tabs don't poll, conserving battery + bandwidth. The next foreground focus refetches naturally (TanStack's `refetchOnWindowFocus: true` is the default).

**Component tree** (sketch):
```tsx
function ScoreEntryRoute() {
  const { roundId } = useParams();
  const { data, isLoading, error } = useQuery({...});
  const queue = useOfflineQueue(roundId);
  // Register terminal errors for 'hole_score' kind once at mount.
  useEffect(() => {
    registerTerminalErrors('hole_score', [
      'round_not_writable',
      'hole_number_exceeds_holes_to_play',
      'foursome_has_no_scorer',
      'invalid_body',
      'invalid_round_id',
      'invalid_hole_number',
    ]);
  }, []);

  if (isLoading) return <Loading />;
  if (error) {
    if (error.status === 404) return <NotInRoundPlaceholder />;
    if (error.status === 422 && error.code === 'round_state_missing') return <SetupErrorPlaceholder />;
    return <ErrorView error={error} />;
  }
  if (data.state === 'finalized' || data.state === 'cancelled') return <RoundClosedPlaceholder state={data.state} />;
  if (data.myFoursome.scorerPlayerId === null) return <NoScorerPlaceholder />;
  if (!data.myFoursome.isScorer) return <ReadOnlyPlaceholder scorerName={data.myFoursome.scorerName!} />;
  return <ScoreEntryForm round={data} queue={queue} />;
}
```

**`ScoreEntryForm` component** (the load-bearing piece):

- **Member ordering** (load-bearing for ref-positional indexing): the GET endpoint MUST return `myFoursome.members` sorted by `pairing_members.slot_number ASC`. The frontend renders members in array order, registers `scoreInputRefs.current[idx]` to the input at index `idx`, and relies on this ordering being byte-stable across refetches. Tests pin both: backend test asserts members are returned in slot_number order; frontend test asserts a stable members list survives a TanStack Query refetch without remounting the inputs.

- **Score input range**: gross strokes accept 1-20 (matching T5-6's Zod schema `z.number().int().min(1).max(20)`). **NOT 1-9 as Wolf Cup's UI does** — Wolf Cup's `maxLength={1}` + `/^[1-9]$/` regex is a known Wolf Cup limitation (cannot score 10+). Tournament drops this constraint:
  - `maxLength={2}` on each score input.
  - **Allowed transient states** (don't reject; let the user keep editing):
    - `''` (empty — backspace cleared the input)
    - `'1'` (could be 1, or the start of 10-19 — see auto-advance state machine)
    - `'10'`-`'19'` (valid 2-digit scores)
    - `'20'` (valid)
    - any single digit `'2'`-`'9'` (valid)
  - **Rejected keystroke patterns** (revert to prior state via `e.preventDefault()` OR ignore the new value in onChange):
    - `'0'` (zero alone — invalid score)
    - `'01'`, `'02'`, ..., `'09'` (leading zero)
    - `'21'`, `'22'`, ..., `'30'`, ..., `'99'` (out of range)
    - non-digit characters
  - **Inputs are CONTROLLED** — `value={currentInputs[playerId] ?? ''}` always reflects React state. The "revert on invalid keystroke" pattern works ONLY because the input is controlled: when we don't call `setCurrentInputs`, React re-renders the input with the prior value, effectively reverting the user's keystroke. Implementation pattern (in onChange):
    ```ts
    const raw = e.target.value;
    if (raw === '') { setCurrentInputs((p) => ({ ...p, [playerId]: '' })); return; }
    if (!/^([1-9]|1[0-9]|20)$/.test(raw)) return;  // controlled-input revert: not calling setState re-renders with prior value
    setCurrentInputs((p) => ({ ...p, [playerId]: raw }));
    // auto-advance decision below...
    ```
  - **DO NOT use uncontrolled inputs with `defaultValue`** — the revert pattern would not work; invalid keystrokes would persist.
  - **Auto-advance state machine** (decided AFTER state update; uses a single `pendingAdvanceTimer` ref keyed per-input-idx):
    - On entering `''` (backspace clear): clear any pending timer for this idx.
    - On entering `'3'`-`'9'`: clear any pending timer; advance immediately via `scoreInputRefs.current[idx+1]?.focus()` (or blur on the last input). (No valid score starts with `'3'`-`'9'` AND has a second digit; `30`-`99` are out of range.)
    - On entering `'1'` OR `'2'` (could be a complete score 1 or 2, OR the start of `10`-`19` or `20` respectively): clear any pending timer; set a NEW 1500ms `setTimeout` that, if it fires, accepts the single digit as the final score and advances. **The timer is cleared (`clearTimeout`)** if the user: (a) types another digit (the next onChange clears + decides anew), (b) tabs/clicks to a different input (use the input's `onBlur` to clearTimeout AND accept the single digit as final), (c) the component unmounts (cleanup useEffect calls `clearTimeout` on every ref).
    - On entering `'10'`-`'19'` or `'20'`: clear any pending timer; advance immediately. (Note: `'21'`-`'29'` and `'2[3-9]'` etc. are rejected by the keystroke regex, so they never reach this branch.)
  - Stored as `string` in `currentInputs` until Save; cast to `parseInt(input, 10)` on enqueue.
  - **Cancellation rules summary**: the 1500ms timer is canceled by ANY of: another keystroke on the same input, blur of that input, parent component unmount, route change. Blur explicitly accepts `'1'` as final (no surprise focus-steal after the user has navigated away).

- State: `currentHole` (1-indexed), `currentInputs` (Record<playerId, string>), `currentPutts` (Record<playerId, string>), `skippedHoles` (Set<number>; persisted via `sessionStorage` keyed by `roundId`).

- **`currentHole` computation** (defends against the Skip hole vs server-refetch snap-back):
  - Compute `unscoredHoles = { h | 1 ≤ h ≤ holesToPlay AND any of the 4 members has no hole_score for hole h }` (set of holes that still need scoring).
  - Compute `eligibleHoles = unscoredHoles - skippedHoles` (unscored AND not skipped).
  - `currentHole = eligibleHoles.size > 0 ? min(eligibleHoles) : null`.
  - When `currentHole === null` → either every cell is scored OR every remaining unscored hole is skipped. Render the "scoring complete from your end" placeholder.
  - **Walkthrough of the pinned scenario** (skip 5, score 6, stay on 7):
    - Server initially has cells 1-4 fully scored. Hole 5 missing.
    - User skips hole 5 → `skippedHoles = {5}`. UI advances to hole 6.
    - User scores hole 6 → all 4 cells synced.
    - Server refetch: cells 1-4, 6 fully scored. Hole 5 still missing. holesToPlay = 18.
    - `unscoredHoles = { 5, 7, 8, ..., 18 }`.
    - `eligibleHoles = unscoredHoles - {5} = { 7, 8, ..., 18 }`.
    - `currentHole = min(eligibleHoles) = 7`. ✓ (NOT 5; NOT 6.)
  - Test #11 pins this exact scenario.

- **`skippedHoles` persistence**: `sessionStorage.getItem('tournament:skipped-holes:' + roundId)` parsed as JSON `{ skippedHoles: number[] }`. Per-tab by sessionStorage's design — multi-tab on the same browser have INDEPENDENT skip lists; that's intentional (each tab represents a separate scorer-session view; v1 doesn't model cross-tab state). Across-device is irrelevant (different browsers don't share sessionStorage anyway).
  - **Updated** on every "Skip hole" tap.
  - **Cleared** in two cases:
    1. The skipped hole now has a server-side score (a different scorer or an admin correction filled it; we no longer need to skip it). Implementation: a `useEffect` keyed on `[serverFilledHoles]` (a derived value computed from `data.myFoursome.holeScores` — the set of holes where ALL 4 cells are filled). The effect computes `next = skippedHoles.difference(serverFilledHoles)`. **Compare via value-equality** (`next.size !== skippedHoles.size || [...next].some(h => !skippedHoles.has(h))`); if different, call `setSkippedHoles(next)` AND `sessionStorage.setItem(...)`. This avoids both the infinite-loop risk (only writes when actually changed) AND the never-clear risk (always recomputes on `serverFilledHoles` change).
    2. The browser's sessionStorage purges (tab close). Naturally cleared.
  - **NOT cleared** on `state === 'finalized' || 'cancelled'` — at that point the form isn't shown anyway, so the residue doesn't matter.

- **`currentHole` edge case — all done**: if `firstUnscoredHole > holesToPlay` (every cell scored), set `currentHole = null` → render "Round complete; tap Save round" placeholder OR auto-redirect to leaderboard. If every UNSKIPPED hole 1..holesToPlay is scored but skipped holes remain → set `currentHole = null` (we've done everything we can; the skipped holes need a correction via T5.9). Both cases: show a "scoring complete from your end" placeholder.

- 4 score inputs in a grid, one per `myFoursome.members[idx]` (in slot_number order per the member-ordering rule above). Each `<div key={member.playerId}>` wraps an `<input ref>` registered into `scoreInputRefs.current[idx]`.

- `inputMode="numeric"`, `pattern="[0-9]*"`, `maxLength={2}`. iOS surfaces the numeric keyboard.

- "Save Hole N" sticky button. Disabled until all 4 inputs filled with valid 1-20 values. onClick handler:
  1. **SYNCHRONOUSLY** call `scoreInputRefs.current[0]?.focus()` (the iOS keyboard fix; preserves the keyboard across the hole advance via the stable `key={member.playerId}`).
  2. For each filled input, call `queue.enqueueMutation({ kind: 'hole_score', url: \`/api/rounds/${roundId}/holes/${currentHole}/scores\`, body: { playerId, grossStrokes: parseInt(input, 10), putts: putts === '' ? null : parseInt(putts, 10), clientEventId: crypto.randomUUID() }, clientEventId, roundId })`. NOTE: 4 separate enqueueMutation calls (one per player); each gets its own clientEventId.
  3. Optimistically update local state to advance to `currentHole + 1`; clear `currentInputs` and `currentPutts`.
  4. The TanStack Query refetch on next focus will reconcile the server view.

**"Pending sync" chip**: rendered in the page header. Reads `queue.pendingCount`. Shows "All synced" when 0; "N queued" when > 0.

**Validation banner**: if scorer taps "Next hole" with < 4 cells filled, show inline banner "All 4 scores required to advance" + a "Skip hole" tertiary button. "Skip hole":
1. Adds `currentHole` to `skippedHoles` Set.
2. Persists `{ skippedHoles: Array.from(skippedHoles) }` to sessionStorage (`'tournament:skipped-holes:' + roundId` key).
3. Recomputes `currentHole` per the formula above. Result: UI stays advanced even after a 15s GET refetch returns the skipped hole as still-missing.
4. Writes nothing to the queue. Logs nothing. Per epic AC line 1313.

**Read-only placeholder**: when `!myFoursome.isScorer`. Shows "**<scorerName>** is currently scoring foursome N" + a button "Open leaderboard" (links to `/rounds/${roundId}` — placeholder route; T5-5 owns).

**Round closed placeholder**: when `state === 'finalized' || state === 'cancelled'`. Shows "Round is closed" + leaderboard link.

**Not in round placeholder**: when the GET returns 404 `round_not_found`. Shows "This round isn't available to you" + leaderboard link. (The 404 is uniform with foreign-tenant case; UI doesn't distinguish.)

**Setup error placeholder**: when the GET returns 422 `round_state_missing`. Shows "Round setup incomplete — ask the organizer" + a refresh button.

**No-scorer-yet placeholder**: when `data.myFoursome.scorerPlayerId === null`. Shows "Scorer not yet assigned for this foursome — ask the organizer".

### 5. T5-3 + T5-6 wiring

**T5-3** (offline queue): `useOfflineQueue(roundId)` hook from T5-3. The Save handler calls `enqueueMutation` 4 times (once per player); the queue handles dedupe + retry + failsafe automatically.

**T5-6** (server endpoint): the queue's drain function POSTs to `/api/rounds/:roundId/holes/:holeNumber/scores` with the body shape T5-6 expects. The 14-path error taxonomy maps to the queue's drain decision tree:
- 200 deduped → queue removes the entry silently.
- 201 created → queue removes the entry silently; optimistic UI's "score visible" matches.
- 409 hole_already_scored → queue retains the entry with `conflictPending=true` + fires `tournament-offline-queue-conflict` CustomEvent. T5-2 listens and shows a toast "Hole N already has a score by <conflictingEntry.scorer_player_id>; ask the organizer for a correction (T5.9)" (T5.10's overwrite UX comes later).
- 422 round_not_writable, 422 hole_number_exceeds_holes_to_play, 422 foursome_has_no_scorer, 400 invalid_body — all REGISTERED as terminal errors at mount (T5-2's `registerTerminalErrors('hole_score', [...])` call). Queue purges the entry; T5-2 shows a generic toast "Score rejected (state issue); refresh and try again."
- 403 player_not_in_your_foursome, 403 not_scorer_for_this_foursome — NOT registered as terminal (defensive: they SHOULDN'T happen if the GET correctly identified `isScorer`, but if a scorer-handoff slipped between GET and Save, the 403 retries until `MAX_TRANSIENT_RETRIES=5` then auto-purges via the failsafe). T5-2 listens for the failsafe-purged event and shows a toast pointing to the new scorer name (next GET refetch will reflect the handoff).
- Network/5xx → queue's existing BREAK + 30s heartbeat handles transparently; pendingCount grows; user sees the chip.

### 6. Accessibility + qualitative ≤10s NFR

- Each input has `aria-label="Score for {member.name}"`.
- Sticky footer with Save button is always visible.
- `inputMode="numeric"` triggers the iOS numeric keyboard.
- The ≤10s NFR-P1 (full-foursome-for-one-hole entry in 10s) is QUALITATIVE — observed during T9.1 9-hole drill. No CI-gated test.

### 7. Test surface

**Backend GET tests** (`scores.read.test.ts`): 10 tests covering happy + error + tenant + state variations + uniform-404 (existence obfuscation) + 422 round_state_missing + no-scorer-yet.

**Frontend tests** (`rounds.$roundId.score-entry.test.tsx`): 13 tests covering view branches + save flow + iOS keyboard fix + auto-advance state machine + validation + chip + terminal-error registry + Skip hole.

**Total: +23 tests minimum.** (AC #10 floor: +23.)

### 8. Forward references

- T5-7 (scorer handoff endpoint): once it ships, the GET endpoint's response stays the same; only the underlying scorer_assignments row changes. Stale UIs catch the handoff via the 15s polling.
- T5-9 (score correction endpoint): T5-2's 409 path hints "ask organizer for a correction (T5.9)"; the actual correction UI lands in T5.9.
- T5.10 (airplane-mode drill): integration test that exercises the full enqueue → offline → reconnect → drain → 409 → resolveConflict('overwrite', body) → re-drain flow against the real backend. T5-2 ships the queue + chip + listener; T5.10 verifies end-to-end.
- T5-5 (leaderboard v1): the "Open leaderboard" button targets `/rounds/${roundId}` which T5-5 will build out; T5-2 leaves it as a placeholder link (or a hash anchor `/rounds/${roundId}#scoreboard`).

## Acceptance Criteria

**AC #1 — Backend `GET /api/rounds/:roundId` mounted in scoresRouter**

Given `apps/tournament-api/src/routes/scores.ts`
When inspected
Then it exports an additional `scoresRouter.get('/:roundId', requireSession, async (c) => { ... })` handler that returns the score-entry-context shape per Risk Acceptance §3. Path-param validates UUID-shape (400 `invalid_round_id` on mismatch). Round existence + tenant filtering via `rounds` SELECT; 404 `round_not_found` on absent. Tenant-scoped on every SELECT.

**AC #2 — GET response shape**

Given a round with 1 foursome (4 players), session.userId is the assigned scorer
When `GET /api/rounds/:roundId` is invoked
Then the response is 200 with:
- `state` matching the `round_states.state` row. (If the row is absent → 422 `round_state_missing` per Risk Acceptance §3 step 2; the GET does NOT silently default.)
- `holesToPlay` matching `rounds.holes_to_play`.
- `myFoursome.foursomeNumber` matching the pairing's foursome_number.
- `myFoursome.isScorer === true`.
- `myFoursome.scorerPlayerId === scorerAssignments.scorer_player_id`.
- `myFoursome.scorerName === players.name` for that scorer.
- `myFoursome.members` is an array of `{ playerId, name, handicapIndex }` objects matching the pairing_members + players JOIN, **sorted by `pairing_members.slot_number` ASC** (load-bearing for ref-positional indexing in the UI per Risk Acceptance §4 member-ordering rule).
- `myFoursome.holeScores` is the existing hole_scores rows scoped to the foursome's player_ids.

**AC #3 — Non-scorer participant gets `myFoursome.isScorer = false`**

Given the session.userId is in the foursome but is NOT the assigned scorer
When the GET is invoked
Then `myFoursome.isScorer === false`. `scorerName` and `scorerPlayerId` are populated. The UI uses these to render the read-only placeholder.

**AC #4 — Non-participant gets 404 (uniform with foreign-tenant)**

Given the session.userId is NOT a member of any foursome for this round
When the GET is invoked
Then 404 `round_not_found` — byte-identical response to the foreign-tenant case so a probe attempt cannot distinguish "doesn't exist" from "exists but I'm not in it." (Round-1 codex caught the original 200+null info-leak risk.)

**AC #5 — Tenant scoping defense-in-depth**

Given a round seeded under a foreign tenant
When the GET is invoked with a session in the local tenant
Then 404 `round_not_found`. (Same defense pattern as T5-6.)

**AC #6 — Frontend route renders the iOS keyboard fix verbatim**

Given `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx`
When inspected
Then:
- The provenance header at the top of the file cites `apps/web/src/routes/score-entry-hole.tsx @ commit 67238a22a949e37d5d6143ddf46e3804aec57f59` + the commit `ebe3cea` for the iOS-keyboard fix.
- The Save button's `onClick` handler **synchronously** calls `scoreInputRefs.current[0]?.focus()` BEFORE any async / mutation call. Comment explicitly cites the iOS Safari user-gesture requirement.
- Score inputs are rendered inside `<div key={member.playerId}>` wrappers (stable keys → React reuses the same DOM input across hole advances → keyboard stays open).
- onChange auto-advance: per the state machine in Risk Acceptance §4. Single digit `'2'`-`'9'` advances immediately; `'1'` waits 1500ms (or until additional input/blur); 2-digit values `'10'`-`'19'` and `'20'` advance immediately. Backspace to `''` is allowed (no advance, no rejection).
- `inputMode="numeric"`, `pattern="[0-9]*"`, `maxLength={2}` on every score input. Allowed values 1-20 (matches T5-6's Zod). Invalid keystrokes (`'0'`, leading zero, out-of-range, non-digit) are reverted (state not updated) per Risk Acceptance §4.

**AC #7 — Save action enqueues per-player hole_score mutations**

Given the scorer fills all 4 cells for hole N
When they tap "Save Hole N"
Then the Save handler synchronously focuses the first input (per AC #6), THEN calls `enqueueMutation({ kind: 'hole_score', url: '/api/rounds/${roundId}/holes/${currentHole}/scores', body: { playerId, grossStrokes, putts: putts ?? null, clientEventId }, clientEventId, roundId })` 4 times (one per member; each with its OWN `clientEventId = crypto.randomUUID()`). The local state advances to `currentHole + 1` optimistically. No wait on the network response.

**AC #8 — `registerTerminalErrors('hole_score', [...])` at mount**

Given the route mounts
When the `useEffect` registration fires
Then `registerTerminalErrors('hole_score', ['round_not_writable', 'hole_number_exceeds_holes_to_play', 'foursome_has_no_scorer', 'invalid_body', 'invalid_round_id', 'invalid_hole_number'])` is called once. Subsequent re-renders MUST NOT re-register (the effect's dependency list is `[]`).

**AC #9 — Pending-sync chip + read-only placeholder + round-closed placeholder**

Given `pendingCount > 0`
Then a "N queued" chip is visible in the page header.

Given `myFoursome.isScorer === false` (a participant who's not the scorer)
Then the page renders a read-only placeholder showing "{scorerName} is currently scoring foursome {N}" + an "Open leaderboard" link.

Given `state === 'finalized' || state === 'cancelled'`
Then the page renders a round-closed placeholder.

Given the GET returns 404 `round_not_found` (non-participant or non-existent)
Then the page renders a not-in-round placeholder ("This round isn't available to you" + leaderboard link).

Given `myFoursome.scorerPlayerId === null` (no scorer assigned yet for this foursome)
Then the page renders a no-scorer-yet placeholder ("Scorer not yet assigned for this foursome — ask the organizer").

**AC #10 — Tests**

Given `apps/tournament-api/src/routes/scores.read.test.ts` + `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx`
When `pnpm -F @tournament/api test` and `pnpm -F @tournament/web test` run
Then a **net +23 or more new passing tests** vs the start-of-story baseline (tournament-api: 489 → ≥499; tournament-web: 78 → ≥91). No previously-passing test goes red. typecheck + lint clean.

Test attribution (minimum):
- `scores.read.test.ts` (10 tests):
  1. 200 happy path: scorer + members (sorted by slot_number ASC) + scorerName + holesToPlay + state.
  2. 200 non-scorer participant: `isScorer === false` + scorer info populated.
  3. 404 round_not_found when session.userId is not in any foursome (uniform with foreign-tenant case to obfuscate round existence — round-1 codex catch).
  4. 200 with hole_scores populated (pre-seed 3 cells; assert returned in holeScores array).
  5. 200 state=finalized: `state` reflects round_states.state.
  6. 200 holes_to_play=9: response carries `holesToPlay: 9`.
  7. 200 no-scorer-yet: foursome with no scorer_assignments row → `scorerPlayerId: null`, `scorerName: null`, `isScorer: false`.
  8. 422 round_state_missing: round_states row absent → 422 with `code: 'round_state_missing'`.
  9. 400 invalid_round_id: non-UUID path param.
  10. 404 round_not_found: foreign-tenant round (and verifies the response is byte-identical to the non-participant 404 — uniform shape).

- `rounds.$roundId.score-entry.test.tsx` (13 tests):
  1. Renders Loading on initial mount (data not yet returned).
  2. Renders score inputs grid when `data.myFoursome.isScorer === true`.
  3. Renders read-only placeholder when `data.myFoursome.isScorer === false`.
  4. Renders round-closed placeholder when `data.state === 'finalized'`.
  5. Renders no-scorer-yet placeholder when `data.myFoursome.scorerPlayerId === null`.
  6. Auto-advance: typing `'5'` on input 0 immediately focuses input 1; typing `'1'` on input 0 waits 1500ms (verified via fake timers — pendingAdvanceTimer set, advance fires only after timeout OR additional input); typing `'2'` on input 0 also waits (could be the start of `'20'`); typing `'12'` advances after the second digit; typing `'20'` advances after the second digit.
  7. Score input rejects invalid values: typing `'30'`, `'01'`, `'0'`, or non-digits → input value stays unchanged.
  8. Validation: Save button disabled when fewer than 4 cells filled with valid 1-20 values.
  9. iOS keyboard fix: Save button onClick calls `scoreInputRefs.current[0]?.focus()` SYNCHRONOUSLY before invoking enqueueMutation (verified via spy on focus + ordering — focus is called BEFORE the queue's enqueue spy fires).
  10. Save enqueues 4 mutations (one per player) with distinct clientEventIds.
  11. Skip hole: tapping "Skip hole" on hole 5 advances to hole 6; sessionStorage gets `{skippedHoles:[5]}`. Simulating a server refetch where hole 5 is still unscored — the UI stays on hole 6 (NOT snaps back to 5).
  12. registerTerminalErrors is called exactly once at mount (verified via spy).
  13. Pending-sync chip shows "N queued" when `useOfflineQueue` returns `pendingCount > 0`.

**AC #11 — Wolf Cup regression clean**

Given the full regression sweep
When run after T5-2's commits
Then engine 472 / api 507 unchanged; tournament-api 489 → ≥497; tournament-web 78 → ≥89; typecheck + lint clean across all workspaces.

**AC #12 — `apps/tournament-web/PORTS.md` row appended**

Given the file exists from T5-3
When T5-2's commit lands
Then a new row references `score-entry-hole.tsx` Wolf Cup source path + commit `67238a22a949e37d5d6143ddf46e3804aec57f59` + iOS-keyboard-fix commit `ebe3cea` + the deltas listed in Risk Acceptance §2.

## Tasks

1. Capture start-of-story baseline test counts: tournament-api 489 + tournament-web 78.
2. Add the GET handler to `apps/tournament-api/src/routes/scores.ts` per AC #1-#5 (paths the same scoresRouter; `requireSession` only).
3. Write `apps/tournament-api/src/routes/scores.read.test.ts` per AC #10 (10 tests). Use `vi.mock('../middleware/require-session.js', ...)` per the T5-6 pattern.
4. Inspect Wolf Cup `apps/web/src/routes/score-entry-hole.tsx` for the iOS keyboard fix + auto-advance pattern (lines 1060-1090 input grid, lines 1360-1376 Save button onClick).
5. Write `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx` per AC #6-#9. Provenance header citing Wolf Cup source path + commit. Stable keys on input wrappers. Synchronous focus on Save onClick BEFORE any async call. registerTerminalErrors in a one-shot useEffect.
6. Write `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx` per AC #10 (13 tests). Use `@testing-library/react` + `vi.stubGlobal('fetch', ...)` for the GET; mock the offline-queue module at the boundary so the Save flow can be inspected.
7. Generate routeTree (`pnpm -F @tournament/web routes:generate`) so the new route registers with TanStack Router.
8. Append the port row to `apps/tournament-web/PORTS.md` per AC #12.
9. Run `pnpm -F @tournament/api test` + `pnpm -F @tournament/web test` — confirm net +23 passing per AC #10. Run `pnpm -r typecheck` + `pnpm -r lint` — confirm clean.
10. Run `pnpm --filter @wolf-cup/engine test` + `pnpm --filter @wolf-cup/api test` — confirm baseline (Wolf Cup regression check per AC #11).

## Test strategy

- **Backend GET**: full integration tests against `:memory:` libsql DB; seed event/round/pairing/scorer/hole_scores; vi.mock requireSession to inject the test player; assert response shape + tenant + state.
- **Frontend component**: @testing-library/react renderHook-style + render. Mock `fetch` via `vi.stubGlobal`. Mock `useOfflineQueue` via `vi.mock('../hooks/useOfflineQueue.js')` so the Save flow can be inspected without real IDB. Spy on focus() to verify the iOS keyboard ordering.
- **Snapshot tests are NOT used** (the UI is in flux; behavior tests via roles/text are more durable).

## Followups

- T5-7 (scorer handoff): once shipped, the GET endpoint's response stays the same; client-side polling at 15s catches the handoff transparently. The 403 response from T5-6 (which T5-2's queue auto-purges via the failsafe) is the secondary signal.
- T5-9 (score correction): the 409 path's "ask organizer for a correction" guidance becomes a real link; T5.10's overwrite UX may also drive a `resolveConflict('overwrite', body)` action.
- T5.10 (airplane-mode drill): full integration test of enqueue → offline → reconnect → drain → 409 → resolveConflict.
- T5-5 (leaderboard): the "Open leaderboard" link target becomes real.
- T8 (activity spine): the 201-created path's `emitActivity` no-op is replaced; T5-2 doesn't change.
- T5-8 (round lifecycle FSM): refactor of T5-6's inline state code; T5-2's GET-side reads of `round_states.state` continue to work.

## Risks

- **iOS keyboard fix is the load-bearing UX detail.** If the dev moves `scoreInputRefs.current[0]?.focus()` into a mutation onSuccess callback (outside the user-gesture handler), the keyboard flaps on every Save → trip-day cadence breaks. The provenance-header comment + AC #6's explicit "synchronously" wording + Test #8 (verifies focus() is called BEFORE enqueueMutation) are the multi-layer guards.

- **The 4-separate-enqueueMutation approach** (one per player) means 4 entries in the queue per hole. The dedupe target is per-clientEventId per cell; the 4 entries don't share IDs. **Risk: a partial drain (3 of 4 cells synced; 1 stuck offline)** leaves an inconsistent foursome. Mitigation: the UI's optimistic state assumes all 4 are written; the 15s GET poll will reconcile if the 4th eventually drains (200) or surfaces conflict (409). In the failsafe-purge case, the player whose cell was rejected gets a "missing score" indicator on the next GET refetch — score-correction (T5.9) recovers.

- **GET endpoint added to scoresRouter** (which currently has only the POST). The router file grows. Acceptable for v1; future split into `routes/round-detail.ts` is a refactor candidate.

- **The 11-test frontend coverage** is comprehensive but doesn't cover **every route/state branch**. Specifically untested:
  - 9-hole round vs 18-hole round difference in expected hole count.
  - Putts-input behavior (optional; spec includes it, test coverage is minimal).
  - Conflict-pending entry visualization (T5.10 covers).
  - Mid-round refetch behavior (15s polling). v1.5 followup.

- **Race between handoff and the open form**. If T5-7 hands the scorer off mid-form, the existing scorer's Save returns 403 from T5-6. The queue's failsafe purges after 5 attempts. The user sees a toast + the next GET reflects the new scorer. **Acceptable v1 behavior** — not a real risk for trip day (handoffs are intentional, scorer should know).

- **The `useEffect` dependency list of registerTerminalErrors is empty.** If `registerTerminalErrors` ever needs per-route configuration, the empty dep would prevent re-registration. Acceptable v1 (the registry is global; re-registering replaces; one-shot is fine). Documented.

- **TanStack Query refetch interval (15s)**. Energy + bandwidth tradeoff. 15s catches handoffs in time without burning battery on a phone. Tweakable later.

- **The route test count (11)** approaches the upper bound for a single file. If we add more, consider splitting into `score-entry.placeholder.test.tsx` + `score-entry.form.test.tsx`. Not v1.
