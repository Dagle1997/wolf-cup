# Codex Review

- Generated: 2026-05-01T13:08:21.516Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/scorer-assignments.ts, apps/tournament-api/src/routes/scorer-assignments.integration.test.ts, apps/tournament-api/src/app.ts, apps/tournament-web/src/lib/offline-queue.ts, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx, apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx, _bmad-output/implementation-artifacts/tournament/T5-7-scorer-handoff-endpoint.md

## Summary

Implements the T5-7 scorer-handoff endpoint with the intended in-transaction scorer capture + auth re-check + TOCTOU-narrowed scorer-path UPDATE, plus audit/activity writes and 14 integration tests. Web adds a handoff control and stale-queue banner backed by a new offline-queue peek API. Main correctness concern: when the caller is BOTH current scorer and event organizer, the code always chooses the scorer-path (narrowed) UPDATE, which can incorrectly fail in the exact “organizer override” scenario under contention. Web test coverage also misses the post-200 UI transition to read-only, which is an explicit AC behavior.

Overall risk: medium

## Findings

1. [high] Organizer override can be incorrectly blocked when caller is also current scorer (scorer-path UPDATE takes precedence)
   - File: apps/tournament-api/src/routes/scorer-assignments.ts:227-304
   - Confidence: medium
   - Why it matters: AC-5 requires the organizer-path to skip the TOCTOU narrowing predicate (override semantics). In the current implementation, the UPDATE path is chosen solely by `isCurrentScorer` (ternary at lines 284–303). If the caller is both the current scorer and the event organizer (`isCurrentScorer===true` and `isEventOrganizer===true`), the code takes the scorer-path update with `AND scorer_player_id = :fromPlayerId` (lines 284–294). Under a race (another transfer commits between this tx’s SELECT and UPDATE lock acquisition), the narrowed UPDATE can affect 0 rows and the handler returns 403 not_authorized_for_handoff (lines 305–318), even though the caller should still be authorized as organizer to override. This undermines the recovery semantics in contested conditions.
   - Suggested fix: Choose the organizer-path whenever `isEventOrganizer` is true (or at least when `isEventOrganizer && !isCurrentScorer` is false, i.e. prioritize organizer semantics). Example: `const useNarrowedScorerUpdate = isCurrentScorer && !isEventOrganizer;` then branch on that for the WHERE clause and 0-row handling. Add an integration test that simulates/forces the narrowed UPDATE to return 0 rows while organizer auth is true (or a unit-level test around the branching predicate).

2. [medium] Web test suite does not assert the post-200 handoff UX transition to read-only state (AC-8 behavior)
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx:632-717
   - Confidence: high
   - Why it matters: AC-8 explicitly calls out: on 200, invalidate round-detail and the page transitions to the read-only state. The current tests verify (1) visibility of the button, (2) picker contents, (3) request body, and (4) stale-queue banner behavior, but there is no assertion that after a successful transfer the UI flips out of scorer mode (handoff control disappears, read-only text appears). Without this, regressions where `invalidateQueries` is removed/incorrect queryKey is used won’t be caught.
   - Suggested fix: Extend the “selecting a candidate POSTs…” test (or add a new one) so that after the transfer response, the mocked GET /api/rounds/:roundId returns `isScorer:false` and then assert `read-only` is rendered and `handoff-control` is absent. (You already have `queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] })` in the component; the test should lock that behavior in.)

3. [medium] Stale-queue banner filter can show false positives because it ignores current in-page scorer identity and only keys off error codes + currentScorerName
   - File: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx:586-628
   - Confidence: medium
   - Why it matters: The intended UX is “post-handoff, your queued mutations 403 and we show who is now scoring”. The implementation matches codes `{player_not_in_your_foursome, not_scorer_for_this_foursome}` and requires `currentScorerName` be a string (lines 600–610), but it does not ensure this is actually a handoff scenario versus other situations that might also yield those codes (e.g., a user not in the foursome trying to score, or historical errored entries for this round). Additionally, `StaleQueueBanner` is rendered even when `isScorer===true` (line 437), which increases the chance of confusing messaging if errored entries exist for unrelated reasons.
   - Suggested fix: If you want this banner to be specific to the handoff case, thread in the current round-detail scorer identity and add an additional predicate such as `body.currentScorerName !== data.myFoursome.scorerName` (or require `!data.myFoursome.isScorer`). At minimum, consider requiring `currentScorerName.trim().length > 0` instead of `typeof === 'string'`.

## Strengths

- API handler follows the specified TOCTOU pattern: in-tx scorer SELECT to capture `fromPlayerId` (lines 171–197) → in-tx organizer lookup (lines 198–226) → in-tx auth re-check (lines 227–241) → scorer-path UPDATE narrowed by `scorer_player_id = :fromPlayerId` (lines 282–294).
- Per-event organizer check is correctly implemented via `events.organizer_player_id` (lines 198–230) and does not use `players.is_organizer`; integration test (m) locks this in.
- Tenant scoping is consistently applied on all DB reads/writes shown (round lookup, round_states, scorer_assignments, events, pairings/pairing_members).
- `assignedAt` is computed once (`Date.now()`) and reused for UPDATE + audit payload + response (lines 270–373), matching the “single source of truth” requirement.
- Integration tests cover the enumerated 14 AC-10 cases (a)–(n), including the two key invariants: global organizer ≠ event organizer and scorer-of-different-foursome cannot transfer.

## Warnings

None.
