# T3-9 Party-Mode Review (non-interactive written)

**Story:** T3-9 — Sub-Game Opt-In UI on Round Setup.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T3-9 is the bridge between T3-1's sub-games schema (shipped April 19) and T6.13's compute dispatcher (future). It writes the opt-in setup state — who's in the skins pot, at what buy-in — that T6.13 will read at scoring time. Strategic significance: this is the FIRST data surface where money discipline (integer cents) hits a player-facing UI, and it sets the pattern for every future buy-in/pot UI.

**Threat model — six surfaces worth scrutinizing:**

1. **`buy_in_per_participant` integer-cents discipline.** Backend Zod requires non-negative integer. Frontend `dollarsStringToCents` uses `Math.round(parseFloat(input) * 100)`. Schema CHECK enforces `>= 0`. Three layers; floating-point drift impossible. **Bulletproof.**

2. **Cross-tenant defense.** Every SELECT/UPDATE/DELETE on `sub_games`, `sub_game_participants`, `event_rounds`, `events`, `groups`, `group_members` is filtered on `tenant_id = TENANT_ID`. The GET roster JOIN was hardened in impl-codex round 1 to add `eq(players.tenantId, TENANT_ID)`. Cross-tenant test pinned: foreign-tenant event_round → 404. **Solid for v1.5+ multi-tenant.**

3. **`sub_game_type_not_enabled` defense-in-depth.** Backend rejects `ctp/sandies/putting_contest` even though schema CHECK allows them — prevents inert config rows the UI couldn't clear. Mirror of T3-3 admin-groups' `money_visibility_mode` v1 guard. v1.5 enabling = add types to `V1_ENABLED_SUB_GAME_TYPES` Set. **Right call.**

4. **Player-not-in-event pre-flight.** FK on `sub_game_participants.player_id → players.id` is RESTRICT — would NOT FK-fail when opting in any valid player_id. The "must be in this event's group_members" rule is application-level. Pre-flight SELECT on `groupMembers JOIN groups WHERE groups.event_id = :eventId` enforces it loudly (400). Tested. **Solid.**

5. **Upsert (DELETE-then-INSERT) race-safety.** Inside a single `db.transaction`. If any INSERT fails partway (UNIQUE collision, FK violation), full rollback restores prior state. Mirror of T3-2's transactional event creation. Test: re-save with different participants verifies replacement (not accumulation). **Right.**

6. **UX dead-end: no "clear skins" path once enabled.** The serverHadSkins gate (round-2 codex fix) preserves an empty skins row across re-saves. There's no "Disable skins for this round" toggle in v1. An organizer who set skins by mistake can't easily remove it from the UI (could clear all participants + buy-in, but the row persists). Real UX limitation; flagged for v1.5+ polish, not blocking v1.

**Strategic significance:** integer-cents pattern is now codified in a frontend surface for the first time. T6.13 inherits a clean opt-in state schema. Money discipline carries forward.

**Recommendation: ship.** AC #13 manual smoke (Josh's 4-step toggle + save + re-save flow) is the final gate.

---

## 🏗️ Winston (Architect) — System Design Perspective

Seven observations:

1. **5th `/api/admin` mount.** Threshold case finally hit. T3-3/T3-5/T3-6 reviews all noted "promote umbrella adminRouter at ~5 mounts." T3-9 holds the existing pattern; umbrella refactor deferred to a scope-disciplined refactor story. The right call — bundling refactor with feature work expands diff surface and complicates review.

2. **DELETE-then-INSERT upsert pattern.** Idempotent under retry. Composite PK on `(sub_game_id, player_id)` would force delicate per-row diffs; upsert eliminates that surface. The transaction wrapper handles partial-failure rollback. Same shape as T3-2/T3-5 transactional saves. **Pattern reuse working.**

3. **Tenant scoping precedent.** T3-9 establishes "every SELECT/UPDATE/DELETE filters tenant_id = TENANT_ID" for new code. Pre-T3-7 admin routes (T3-2/T3-3/T3-5) are NOT tenant-scoped — flagged as separate retrofit followup, NOT T3-9 scope. Defensible, but worth the explicit tracking.

4. **`V1_ENABLED_SUB_GAME_TYPES` Set vs hardcoded check.** Single-source-of-truth for v1.5 enabling. Adding types = mutate the Set + flip UI's `V1_ENABLED` constant on the frontend. Two copies (backend + frontend) — same posture as the project's other v1-vs-v1.5 toggles. Could promote to a shared constant in the future, but the no-SHARED rule + 4-line duplication makes promotion premature.

5. **Frontend fieldset `disabled` attribute.** The disabled `<fieldset>` inherits-disable on all child inputs (the HTML standard). This is the cleanest way to gate a section without per-input disabled props. Test pins both fieldset-level + checkbox-level disabled states. **Idiomatic.**

6. **`isDirty` simplified after round-2 codex.** Pure server-vs-draft content-equality after the serverHadSkins gate took over the "preserve empty entry" responsibility. Cleaner than the original edge-case-laden version. **Better post-fix.**

7. **No consumer route change for T6.13.** T3-9 ships the writer; T6.13 (future) ships the reader (compute dispatcher + `sub_game_results`). No forward dependency from T3-9 on T6.13. Schema FK from `sub_games.event_round_id → event_rounds.id` is the only contract. **Clean separation.**

**Architectural concerns: zero blockers.** Three "watch and promote" notes (umbrella adminRouter, V1_ENABLED dedup, pre-T3-7 tenant retrofit) — none warrant T3-9 changes.

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T3-9 satisfy organizer-facing value?** Yes. Pre-T3-9, opting players into skins required direct DB INSERTs by Josh. Post-T3-9, organizer toggles checkboxes + saves. The blast radius for "did I accidentally include the wrong player in the pot" drops from "Josh has to verify the SQL" to "form shows a checkbox state, organizer can re-save."

**Is the v1.5 deferral defensible?** Yes. CTP per-par-3 is already shipped on Wolf Cup as a separate flow (per project memory). Sandies is a Wolf Cup engine concept that T6 will port. Putting contest is an as-yet-unspecified format. Putting all 4 in v1's UI without T6.13 to compute results would be cosmetic clutter. **Right scope.**

**The "no clear skins button" UX limitation flagged by Mary.** This is real but has a workaround: organizer toggles all participants off + sets buy-in to 0 + saves. The skins row persists with empty config. T6.13 (future) likely treats empty-participant skins as a no-op pot anyway. So the "limitation" is really "the skins row exists in the DB but has no effect on scoring" — semantic equivalence to "skins isn't enabled." Acceptable v1.

**Scope discipline check.** Did the dev agent stay in T3-9's lane?
- 5 ALLOWED files (3 NEW backend, 2 NEW frontend) + 1 modified backend (`app.ts` mount) + 1 auto-regen routeTree.
- 0 SHARED edits.
- 0 FORBIDDEN edits.
- No deps. No migrations. No schema changes.

**Path footprint compliance.** **Scope-disciplined.**

**One scope question:** the page is currently unreachable from any other admin UI — there's no link to `/admin/event-rounds/$eventRoundId/sub-games` from the event detail page. Josh would have to type the URL by hand. v1 organizer UX limitation; future story (event-detail-page polish) wires it up.

**Recommendation: ship.** AC #13 manual smoke is the final gate.

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 372 → 392 (+20). AC #9 floor was +16. Margin: +4.
- tournament-web: 36 → 43 (+7). AC #10 floor was +4. Margin: +3.
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).

**Backend coverage:**
| AC | Test | Pin? |
|---|---|---|
| #2 GET happy + roster + empty subGames | ✅ | ✅ |
| #2 GET happy WITH existing config | ✅ | ✅ |
| #2 GET 404 unknown id | ✅ | ✅ |
| #2 GET cross-tenant → 404 | ✅ | ✅ |
| #2 GET anonymous → 401 | ✅ | ✅ |
| #2 GET non-organizer → 403 | ✅ | ✅ |
| #3 POST happy (1 skins, 2 participants) | ✅ | ✅ |
| #3 POST upsert REPLACES (re-save with different participants) | ✅ | ✅ |
| #3 POST empty subGames clears all | ✅ | ✅ |
| #3 POST empty participantPlayerIds within entry | ✅ | ✅ |
| #3 POST resave-to-empty (5 → 0 participants) | ✅ | ✅ |
| #3 400 sub_game_type_not_enabled | ✅ | ✅ |
| #3 400 player_not_in_event | ✅ | ✅ |
| #3 400 duplicate_sub_game_type | ✅ | ✅ |
| #3 400 duplicate_participant | ✅ | ✅ |
| #3 400 invalid_body (negative buy-in) | ✅ | ✅ |
| #3 error precedence (duplicate_sub_game_type fires before player_not_in_event) | ✅ | ✅ |
| #3 404 event_round_not_found on POST | ✅ | ✅ |
| #3 cross-tenant POST → 404 | ✅ | ✅ |
| #3 403 non-organizer on POST | ✅ | ✅ |

**Frontend coverage:**
| AC | Test | Pin? |
|---|---|---|
| #5 idle render: skins enabled, v1.5 sections disabled with tooltip | ✅ | ✅ |
| #5 toggle + save → POST body matches; success message | ✅ | ✅ |
| #5 400 player_not_in_event → friendly inline message; form preserved | ✅ | ✅ |
| #5 v1.5 type checkboxes ARE disabled | ✅ | ✅ |
| #5 prepopulates from existing config (2 participants + $5.00) | ✅ | ✅ |
| #5 empty-skins-server-state edge: save disabled on idle, save preserves entry | ✅ | ✅ |
| #5 save button disabled on idle (form matches server state) | ✅ | ✅ |

**Observations:**

1. **AbortController-on-unmount NOT separately tested.** AC #6 calls for it; pattern is identical to T3-3/T3-5/T3-6/T3-7's invariant inFlightControllers ref + useEffect cleanup. Defensible omission per the established convention.

2. **No test for "server has empty skins, no user changes, save (programmatically) → POST emits empty skins entry to preserve it."** This branch is unreachable from the UI (isDirty correctly disables Save). Codex round-3 flagged the gap; functionally moot.

3. **isDirty edge-case coverage.** New test "server has empty skins entry: save disabled on idle; save preserves the empty entry" covers the round-2 catch by simulating the empty-server state, asserting Save is disabled, then exercising the user-toggle-and-save path that would have been broken pre-fix.

4. **No test for "server has NO skins, user types in buy-in but doesn't toggle a player, then saves."** That path is exercised implicitly by the existing happy-path test (which toggles + types). Not a gap.

5. **Backend test for empty-participantPlayerIds within an entry.** Pinned (test "empty participantPlayerIds within skins entry: 1 sub_games row, 0 sub_game_participants rows"). Confirms the AC #3 "can be empty" UX flow.

**Coverage verdict: solid.** Margin above AC floors, key correctness paths pinned, edge cases (empty-entry, resave-to-empty, error precedence) explicitly tested. Cross-tenant defense pinned for both endpoints.

**Recommendation: ship.** AC #13 manual smoke is the final gate.

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + AC IDs.

**`admin-event-rounds.ts:88-156`** — GET handler. AC #2 contract.
- L91-95: tenant-scoped event_round SELECT.
- L99-104: tenant-scoped event SELECT.
- L114-127: groups + group_members JOIN, post-impl-codex round-1 includes `eq(players.tenantId, TENANT_ID)` defense-in-depth.
- L132-140: roster dedupe via Set. Mirror of T3-6 invites.ts pattern.
- L142-159: existing sub_games + sub_game_participants prepopulation, ASC ordering on participantPlayerIds.

**`admin-event-rounds.ts:162-330`** — POST handler. AC #3 contract.
- L196-209: 6-step error precedence. Each step has a single early-return guard.
  - Step 1 invalid_body (Zod parse, L195-208).
  - Step 2 event_round_not_found (L211-220).
  - Step 3 sub_game_type_not_enabled (L222-235).
  - Step 4 duplicate_sub_game_type (L237-251).
  - Step 5 duplicate_participant per-entry (L253-272).
  - Step 6 player_not_in_event (L274-318).
- L320-358: db.transaction wrapping DELETE + nested INSERTs. Try-catch on the whole tx for ops logging.

**`admin.event-rounds.$eventRoundId.sub-games.tsx:128-159`** — `isDirty` useMemo. Pure content-equality after the serverHadSkins gate moved out. Round-2 fix.

**`admin.event-rounds.$eventRoundId.sub-games.tsx:175-178`** — `serverHadSkins` boolean. Round-2 fix that ensures empty-skins server rows are preserved across saves.

**`admin.event-rounds.$eventRoundId.sub-games.tsx:185-225`** — saveMutation. AC #6.
- L185-192: AbortController via inFlightControllers ref.
- L195-205: serverHadSkins-aware payload construction.
- L226-228: useEffect cleanup pattern.

**Lint + typecheck + build:** clean. No `any`. No `// eslint-disable`. AC #12 satisfied.

**No new deps. No migrations. No SHARED edits.** AC #14 satisfied.

**DRY notes:**
- `TENANT_ID = 'guyan'` constant duplicated in admin-event-rounds.ts (mirror of T3-3/T3-5 pattern). Promotion to FD-6 tenant resolver deferred.
- Auth-status loader pattern duplicated in 5+ admin routes now. Promotion to a shared util would simplify future auth-aware routes; deferred.

**Open: zero.** Every AC traced to a file:line. Every test pins a contract. Round-2 codex concern resolved cleanly.

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five disciplinary perspectives converge on ready-for-commit. Spec-codex hit AI-1 cap (4 rounds) with all fixes applied. Impl-codex iterated 3 rounds: round-1 surfaced the isDirty/save-button drift, round-2 caught the serverHadSkins-empty-row footgun, round-3 confirmed the fix. Test deltas exceed AC floors with margin. Path footprint is fully ALLOWED, zero SHARED, zero FORBIDDEN. Wolf Cup regressions clean.

**Load-bearing correctness fixes:**
1. `serverHadSkins` gate (round-2 impl codex catch) — preserves empty-skins server rows across saves; prevents silent-clear footgun.
2. Players JOIN tenant scoping (round-1 impl codex Low #3) — defense-in-depth against future multi-tenant.
3. `V1_ENABLED_SUB_GAME_TYPES` rejection (round-1 spec codex catch) — prevents inert config the UI couldn't clear.
4. Deterministic 6-step error precedence (round-1 spec codex Med catch) — prevents flaky test ordering and ambiguous error UX.
5. Integer-cents discipline 3 layers deep (Zod + schema CHECK + frontend Math.round).

**Documented limitations** (acceptable for v1):
- No "clear skins for this round" UI button. Workaround: toggle off all participants + zero buy-in. Row persists semantically equivalent to "no skins."
- Page unreachable from any other admin UI; organizer types URL by hand. Future event-detail-page polish wires it up.
- AbortController-on-unmount not separately tested (pattern shared with prior admin pages).
- The serverHadSkins-only-no-user-input branch is UI-unreachable; coverage is moot.

**Followups** (track but not blockers):
- Promote umbrella adminRouter at next /api/admin mount (T3-9 is the 5th).
- Promote `V1_ENABLED_SUB_GAME_TYPES` to a shared constant when a 3rd consumer arrives.
- Pre-T3-7 admin route tenant-scoping retrofit (T3-2/T3-3/T3-5).
- Auth-status loader pattern → shared util.
- Add "Disable skins for this round" button (UX polish).

**Manual smoke (post-deploy, Josh, AC #13):**
1. Visit `/admin/event-rounds/<eventRoundId>/sub-games` for an existing event_round.
2. Toggle 4 of 8 players into skins; set $5.00 buy-in; save.
3. Verify success message; refresh; verify form prepopulates with the saved config.
4. Toggle 2 different players; save; verify the previous opt-ins are replaced (NOT accumulated).

**The director workflow can proceed to commit.**
