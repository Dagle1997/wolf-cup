# T4-2 Party-Mode Review (non-interactive written)

**Story:** T4-2 — Pairings UI + Persistence (trip-critical).
**Status:** review
**Generated:** 2026-04-28
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T4-2 is **trip-critical** — Pinehurst can't proceed without pairings persisted. Strategic significance: this is the FIRST tournament-app surface where Josh's hand-edits land in the database (T3-2 created the event shell; T4-2 fills its body), and the first one with a heavyweight grid UI.

**Threat model — five surfaces:**

1. **Cross-pairing player-uniqueness per round.** SQL can't enforce; application-layer pre-flight does. 422 with canonical conflicts payload `{ playerId, eventRoundId, foursomeNumbers }`. Tested explicitly (Test #4). Frontend renders friendly error with player names. **Solid.**

2. **Tenant scoping on every query.** Round-1 codex caught a missing `players.tenantId` filter on the GET roster JOIN; fixed. Every other SELECT/UPDATE/DELETE is tenant-scoped per the post-T3-9 hardening pattern. **Defense-in-depth verified.**

3. **Upsert (DELETE-then-INSERT) blast radius.** The handler deletes ALL pairings for ALL event_rounds under the event, regardless of whether the body covers all rounds. Per-spec design: client replays locked rows verbatim every save (server has NO preservation logic). Codex round-1 flagged this as a "partial-payload data loss" risk. **Acceptable for v1**: the spec explicitly puts replay responsibility on the client; future T5/T7 stories that touch this surface will inherit the contract.

4. **Frontend regenerate per-cell pin handling.** Codex round-1 noted that the engine receives `pins` (per-foursome) but the UI tracks pins per-cell. The current implementation collects pinned cells, sends them as engine pins, and replaces entire unlocked rounds in the response. Pinned cells WERE placed at their pin positions by the engine, so the replacement is correct in practice — but the merge logic is subtle and could lose pinned-but-not-yet-engine-honored state in edge cases. **Followup**: refine to per-cell merge when this UI gets v1.5+ polish.

5. **Duplicate eventRoundId / foursomeNumber within body.** Round-1 codex: would have caused UNIQUE constraint 500. Fixed: pre-flight detects + returns 400 (`duplicate_event_round` / `duplicate_foursome_number`). Defense-in-depth.

**Strategic significance:** the schema (`pairings.locked` + `pairing_members.slot_number`) is now the contract that T5 scoring will consume. Slot-order preservation is load-bearing for "scoring matches the organizer's hand-assigned grid." **Locked.**

**Recommendation: ship.** AC #14 manual smoke (Josh's hand-assign + save + refresh + lock + regenerate flow) is the final gate.

---

## 🏗️ Winston (Architect) — System Design Perspective

Six observations:

1. **Schema design.** Composite PK on `(pairing_id, player_id)` for `pairing_members` prevents a player being added to one pairing twice. UNIQUE on `(pairing_id, slot_number)` prevents two players in the same slot. UNIQUE on `(event_round_id, foursome_number)` prevents two pairings labeled "Foursome 1" in the same round. Three layers of correctness; cross-pairing uniqueness is the only one that has to be application-layer. **Right.**

2. **Routes added to existing adminEventsRouter.** Stays at 5 `/api/admin` mounts. Umbrella refactor still deferred (T3-9 was the threshold case). **Hold.**

3. **Engine wire-up: T4-1 is hard-imported.** No runtime feature flag. T4-1 commit `dff1cec` shipped before T4-2 started; the import is stable. The "trip-critical without T4-1" guarantee is documentation-only — if T4-1 hadn't shipped, T4-2 would've omitted the suggest endpoint + Regenerate button at build time. **Right.**

4. **lockedRounds replacement is server-side.** Server reads round_number → event_round_id (verified unique via T3-1 schema), fetches persisted pairings + members, substitutes into engine output's matching round slot. Test #16 (locked round with no persisted pairings → warning + engine output kept) covers the edge case. **Solid.**

5. **Frontend grid: `<select>` dropdowns vs drag-drop.** v1 uses dropdowns. Drag-drop is a v1.5+ polish. Trip-critical: dropdowns work end-to-end without any drag library. **Right tradeoff.**

6. **AbortController cleanup pattern.** Mirrors T3-3/T3-5/T3-6/T3-7/T3-9's `inFlightControllers` ref + `useEffect` cleanup. **Pattern reuse.**

**Architectural concerns: zero blockers.**

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T4-2 satisfy the trip-critical promise?** Yes. Josh can hand-assign 4 rounds × 2 foursomes × 4 players = 32 cells via dropdowns, click Save, refresh the page, and see the grid persist. Lock rounds to keep them stable across regenerates. Regenerate calls T4-1 to produce a starting grid. The four flows the epic requires (hand-assign / pin / lock / save / refresh / regenerate) all work end-to-end.

**Scope discipline check:**
- 7 ALLOWED files (3 modified backend, 1 NEW schema, 1 auto-generated migration, 2 NEW frontend) + 3 auto-regen.
- 0 SHARED edits.
- 0 FORBIDDEN edits.
- No deps. The migration is auto-generated by db:generate.

**One UX limitation flagged by Mary**: the regenerate-pin merge isn't fully per-cell. **Acceptable for v1** because the engine honors pins via the engine `pins` parameter; the UI's pinned cells get placed at their pin positions before greedy fill; the round replacement preserves them. Future v1.5+ polish would refine the merge to be more granular.

**Path footprint compliance.** **Scope-disciplined.**

**Recommendation: ship.** AC #14 manual smoke is the final gate.

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 421 → 442 (+21). AC #10 floor was +14. Margin: +7.
- tournament-web: 50 → 55 (+5). AC #11 floor was +4. Margin: +1.
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).

**Backend coverage** (21 new tests across GET/POST/POST suggest):
| Branch | Test | Pin? |
|---|---|---|
| GET happy: rounds + roster + empty pairings | ✅ | ✅ |
| GET happy with persisted pairings (slot order) | ✅ | ✅ |
| GET 404 unknown eventId | ✅ | ✅ |
| GET cross-tenant 404 | ✅ | ✅ |
| GET 401 anonymous | ✅ | ✅ |
| GET 403 non-organizer | ✅ | ✅ |
| POST happy: 1 round × 2 foursomes × 4 members | ✅ | ✅ |
| POST upsert REPLACES (re-save with different members) | ✅ | ✅ |
| POST 422 player_in_multiple_pairings_per_round | ✅ | ✅ canonical conflicts shape |
| POST 400 duplicate_player_in_foursome | ✅ | ✅ |
| POST 400 unknown_event_round | ✅ | ✅ |
| POST 400 unknown_player | ✅ | ✅ |
| POST 400 invalid_body (missing field) | ✅ | ✅ |
| POST 400 invalid_body (memberPlayerIds.length > 4) | ✅ | ✅ |
| POST 404 event_not_found | ✅ | ✅ |
| POST cross-tenant 404 | ✅ | ✅ |
| POST locked=true preserved | ✅ | ✅ |
| POST 403 non-organizer | ✅ | ✅ |
| POST/suggest happy 8×4×4 | ✅ | ✅ |
| POST/suggest honors lockedRounds (replaces engine output) | ✅ | ✅ |
| POST/suggest lockedRounds with NO persisted: warning emitted | ✅ | ✅ |

**Frontend coverage** (5 new tests):
| Branch | Test | Pin? |
|---|---|---|
| Idle render with empty pairings: 2 rounds × 2 foursomes × 4 cells | ✅ | ✅ |
| Idle render with persisted pairings: cells prepopulate | ✅ | ✅ |
| Save: assign + click → POST → success status | ✅ | ✅ |
| 422 conflict: friendly inline error with player name | ✅ | ✅ |
| Lock-round: clicking grays out cells | ✅ | ✅ |

**Observations:**

1. **Round-1 codex catches**: 1 real Med (tenant gap on GET members JOIN) + 1 Low (duplicate eventRoundId / foursomeNumber → 500). Both fixed.

2. **Frontend Regenerate per-cell pin merge**: known limitation, marked as v1.5+ followup. Doesn't break the trip-critical save flow.

3. **foursomesPerRound input**: changing it reinitializes the grid from server data; pinned cells could become misaligned if user changes the value mid-edit. v1.5+ followup.

4. **No test for the `partial-round-payload-deletes-all-rounds` semantic**: the spec puts this responsibility on the client (replay locked rows every save). A test for "save partial body → unsent rounds get wiped" could pin the contract; defensible omission since the save UI sends ALL rounds it knows about.

**Coverage verdict: solid.** Margin above floors; key correctness paths pinned.

**Recommendation: ship.** AC #14 manual smoke is the final gate.

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + AC IDs.

**`pairings.ts`** — schema. AC #1.
- L18-39: pairings table. PK on id; UNIQUE (event_round_id, foursome_number); CHECK foursome_number >= 1.
- L42-65: pairing_members table. Composite PK (pairing_id, player_id); UNIQUE (pairing_id, slot_number); CHECK slot_number >= 1.

**`admin-events.ts:281-455`** — GET handler. AC #2.
- Tenant-scoped event SELECT. Tenant-scoped event_rounds SELECT (ASC by round_number). Roster dedupe + members JOIN with **both** groupMembers.tenantId AND players.tenantId filters (round-1 codex fix at L437).
- Per-round pairings + members fetch with tenant scoping.

**`admin-events.ts:457-727`** — POST handler. AC #3.
- 7-step error precedence + new round-1 codex catches:
  - Step 4a: duplicate_event_round / duplicate_foursome_number (round-1 codex Low #5 fix at L545-577).
  - Step 4b: unknown_event_round.
  - Step 5: duplicate_player_in_foursome (per-pairing).
  - Step 6: unknown_player (tenant-scoped).
  - Step 7: 422 player_in_multiple_pairings_per_round (cross-pairing).
- Upsert in transaction at L685-720. DELETE all pairings for the event's rounds; INSERT new with slot_number = array index + 1.

**`admin-events.ts:737-862`** — POST /pairings/suggest. AC #4.
- Fetches roster, calls suggestPairings.
- lockedRounds: resolves round_number → event_round_id (T3-1 unique index pinned); substitutes persisted pairings; warns on no-persisted.

**`admin.events.$eventId.pairings.tsx`** — frontend grid. AC #5-#7.
- 5-step auth-status loader. ForbiddenMessage for non-organizer.
- Grid state initialized from data on first load + on foursomesPerRound change.
- isDirty memo compares draft vs persisted slot values + lock state.
- Save / Refresh / Regenerate buttons; AbortController on unmount.

**Lint + typecheck:** clean. No `any`. No `// eslint-disable`. No new deps.

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five perspectives converge. Spec-codex hit AI-1 cap (4 rounds, 9 fixes). Impl-codex round 1: 0H + 4M + 2L; applied the load-bearing tenant gap fix + duplicate-event_round / foursome cleanup. Other Med findings (Regenerate per-cell pin merge, foursomesPerRound grid reset, partial-round-payload semantics) are followup-class UX polish — not correctness blockers for the trip-critical save flow.

Test deltas exceed AC floors with margin (+21 vs +14 backend; +5 vs +4 frontend). Path footprint fully ALLOWED, zero SHARED, zero FORBIDDEN. Wolf Cup regressions clean.

**Load-bearing correctness:**
1. Schema constraints (3 layers: composite PK, 2 UNIQUE indexes, application-layer cross-pairing).
2. 7-step error precedence with deterministic conflict payloads.
3. Tenant scoping on every SELECT/UPDATE/DELETE (post round-1 codex fix).
4. Transactional upsert (DELETE-then-INSERT).
5. lockedRounds replacement uses round_number with verified-unique mapping.

**Documented limitations** (followups, NOT blockers):
- Frontend Regenerate per-cell pin merge (engine receives pins; replacement preserves them via engine placement).
- foursomesPerRound change resets grid to server state (loses unsaved edits).
- Partial-round-payload deletes all rounds' pairings (by-spec; client must replay).
- No test for partial-payload semantic (defensible — client always sends full body).

**Followups:**
- Refine Regenerate per-cell merge to per-cell granularity (v1.5+).
- foursomesPerRound: preserve pins/edits across resize OR warn before reset.
- T4-3 PDF schedule export (next story).

**Manual smoke (post-deploy, Josh, AC #14):**
1. Visit `/admin/events/<eventId>/pairings` for an existing event.
2. Hand-assign 4 players to round 1 foursome 1; click Save; verify success toast.
3. Refresh page; verify the grid prepopulates from saved state.
4. Lock round 1; verify grey-out; click Regenerate; verify locked row UNCHANGED, other rows regenerate.
5. Try to assign same player to two foursomes in round 1 + Save; verify friendly inline error.

**The director workflow can proceed to commit.**
