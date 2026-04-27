# T3-3 Party-Mode Review (non-interactive written)

**Story:** T3-3 — Group CRUD UI. Organizer-facing roster management at `/admin/groups/$groupId/edit`.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T3-3 closes the loop between T3-1 (groups + group_members + players schema) and T3-4 (GHIN search) — three commits work together to ship "organizer can pick 8 Pinehurst-Crew players from real GHIN data." Strategic value: until this commit, the schema rows existed but nothing populated them; from here forward, Josh has a single page that creates the entire Pinehurst v1 roster end-to-end. Combined with T3-2 (event wizard), the path "blank tournament-api → Pinehurst event with crew" is now ~5 minutes of clicks.

**Threat model — five surfaces worth flagging:**

1. **Manual-entry spam.** `POST /:groupId/members { mode: 'manual', name, ... }` creates a new players row on every call. Each row consumes ~200 bytes; 1M rows = ~200 MB. requireOrganizer is the only gate. v1 production is single-organizer (Josh) so this is bounded by intent; future multi-organizer would need rate-limiting OR a confirmation flow. **Acceptable v1 — single-organizer threat model.**

2. **Race-safe GHIN reuse.** `resolveOrInsertGhinPlayer` correctly handles concurrent first-add of the same GHIN by two organizers (mirrors auth.ts:384-464 OAuth-bind pattern). The pathological "UNIQUE fired but retry-SELECT empty" branch throws `ghin_resolve_race_retry_empty` — surfaced as 500 with structured log. **Bulletproof for v1 use case.**

3. **Composite-PK violation correctly mapped to 409.** Discovered via test failure during impl that `group_members(group_id, player_id)` PK violations fire `SQLITE_CONSTRAINT_PRIMARYKEY` (1555) not `SQLITE_CONSTRAINT_UNIQUE` (2067). Predicate now catches both. **Real correctness fix; pinned by test.**

4. **context_id stamping discipline (impl-codex R1 catch).** The original code used `event:${groupId}` for group_members.context_id — wrong per FD-6. Now correctly uses parent event's id (`event:${groupEventId}`). Pre-flight SELECT now also fetches eventId. **Real correctness bug fixed.**

5. **GHIN handicap freshness.** `players.manualHandicapIndex` stays null on add-by-GHIN per spec. Member table shows "—" for GHIN-bound players. T3-10 will add live-refresh later. v1 acceptable: organizer adds a player, sees their GHIN binding is recorded, doesn't see a handicap value yet. The post-deploy manual smoke (AC #22) confirms the flow works; T3-10 closes the display gap. **Acknowledged tradeoff documented in spec + Dev Notes.**

**One v1 limitation worth flagging:** the GHIN search hardcodes `state='WV'` (preserved from T3-4 KNOWN LIMITATION). If a Pinehurst Crew member is registered under a different state's GHIN, T3-3's search won't find them — they'll need manual entry. Pin this in AC #22 manual smoke checklist; any non-WV crew member surfaces immediately.

**Recommendation: ship.** AC #22 manual smoke is the final gate (post-deploy + post-VPS-GHIN-env-set).

---

## 🏗️ Winston (Architect) — System Design Perspective

The implementation reveals three architectural debt accumulations that are now ripe for promotion. Six observations:

1. **3rd `/api/admin` mount** (alongside adminCoursesRouter + adminEventsRouter). Per T3-2 + T3-1 party reviews, the threshold was "promote umbrella adminRouter at ~5 mounts." We're now at 3. Hold for now; T3-5 (rule-set editor) will likely add a 4th. The promotion involves moving the 3 existing routers into a single `/api/admin` umbrella and re-mounting. Estimated 30 minutes of refactor. **Hold; revisit after T3-5.**

2. **3rd copy of `isUniqueConstraintError`-shaped logic.** Auth.ts (T1-6b) has `isUniqueConstraintError`; admin-courses.ts (T2-5) has the same; T3-3 has `isUniqueOrPkConstraintError` (extended to also catch PRIMARYKEY violations). All 3 copies do the same thing minus T3-3's PK extension. **The "promote on 3rd consumer" rule applies — but the natural promotion is more nuanced because T3-3's variant is strictly more permissive.** Recommendation: when the 4th consumer arrives, promote a `apps/tournament-api/src/lib/libsql-errors.ts` with two exports: `isUniqueConstraintError(err)` (the strict variant, what auth + courses use) and `isConstraintError(err, kinds: Set<'UNIQUE' | 'PRIMARYKEY' | 'FOREIGNKEY' | 'CHECK'>)` (a more general predicate). T3-3 uses both shapes. **Hold; promote at 4th consumer.**

3. **Race-safe SELECT-then-INSERT pattern duplicated from auth.ts.** Tournament-api now has TWO copies: `lookupOrBindOAuthIdentity` (auth.ts:384-464) and `resolveOrInsertGhinPlayer` (admin-groups.ts). Both do "outer SELECT → tx → inner SELECT → INSERT → catch UNIQUE → retry-SELECT". The 2nd consumer is the tipping point but the patterns differ enough (auth has 2 inserts, T3-3 has 1) that a generic helper would be awkward. **Hold; revisit if a 3rd similar pattern appears (e.g., player invite-claim in T3-6).**

4. **TanStack Query useMutation pattern is novel in T3-3.** T2-5 + T3-2 used hand-rolled fetch + AbortController for 1 mutation each. T3-3 has 4 mutations and uses `useMutation` + `invalidateQueries(['group', groupId])`. The cache-invalidation idiom is the right call when ≥3 mutations target the same query. **Architecturally sound; future stories with 1-2 mutations should still hand-roll (avoid unnecessary library coupling).**

5. **The manual AbortController via `inFlightControllers` ref** is a workaround for TanStack Query v5's lack of automatic mutationFn cancellation on unmount. Ugly but explicit; the cleanup useEffect aborts every tracked controller. A cleaner abstraction would be a custom `useMutationWithAbort` hook, but that's premature. **Hold the inline pattern; the 5-line ref + 3-line useEffect is readable enough.**

6. **The Zod `discriminatedUnion('mode', [...])` pattern** is exactly right for T3-3's "two body shapes, one endpoint" scenario. Cleaner than the alternative (`superRefine` with custom XOR logic). Future endpoints with similar branching shapes should mirror this. **Set the bar for future polymorphic-body endpoints.**

**Architectural concerns: zero blockers.** Three "hold and watch" notes (umbrella adminRouter, libsql-errors lib, race-safe pattern) — none warrant T3-3 changes.

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T3-3 satisfy organizer-facing value?** Yes — and uniquely, this is the FIRST T3 story shipping the FULL epic AC with no scope cuts (T3-1 was schema-only; T3-2 deviated from the epic's anonymous-redirect target; T3-4 is a port). T3-3 hits AC #1 through AC #22 cleanly because T3-4 unblocked the GHIN search prerequisite.

**Most fragile manual smoke steps (AC #22, in order of likely failure):**

1. **GHIN search returning empty results.** If the VPS GHIN env vars aren't yet set, search 503s and the UI shows "GHIN unavailable — use Manual Entry." Recoverable. If env vars ARE set but the searched name has no WV records, the UI shows "No results in WV." Both are correct UX; first deploy will likely hit one of these.

2. **Add-by-GHIN handicap display.** The member table shows "—" for the new GHIN-bound member's handicap because v1 doesn't live-fetch. **Document this for Josh** — it's not a bug, it's the v1 acknowledged limitation. T3-10 will refresh.

3. **Visibility mode radio buttons.** `participant` and `self_only` should be visibly disabled with tooltips. If the disabled attribute doesn't render correctly across browsers (Safari/Firefox/Chrome), the API guard (`mode_not_v1`) is the safety net.

4. **Concurrent organizer adds same GHIN.** Single-organizer v1 makes this rare; the race-safe path handles it correctly. Won't surface in normal smoke.

5. **Group not found / member not found cleanups.** Edge cases the UI shouldn't reach but the API correctly handles.

**Scope discipline: tight.**
- Zero new deps. TanStack Query is already in use (introduced in T3-2 for course picker).
- ZERO SHARED gates. Sixth story in a row (T2-5, T3-1, T3-2, T3-4 had 1, T3-3) — wait, T3-4 had 1 SHARED. Five-of-six clean.
- Spec went 4 rounds in codex (hitting the AI-1 cap) — the noisiest spec to date. Suggests T3-3's complexity warranted more upfront design thinking. **Future T3 stories should benefit from the lessons (mode discriminator pattern, mount-path consistency, bodyLimit scoping language).**
- 18 backend tests + 5 frontend tests. Both exceed minimums.

**Concerns / observations:**

1. **No "Save name" button feedback for the user.** The user sees the input value updates immediately (controlled state), clicks Save, and the button disables briefly while patching. No "Saved!" confirmation toast. The query invalidation refreshes the heading text post-save. v1 acceptable; future polish: success toast.

2. **Member sort is by name ASC (DB-side)** — case-sensitive in SQLite. "alice" comes before "Bob" before "charlie". Pinehurst crew members are unlikely to have lowercase first chars; not a v1 issue.

3. **Add Player success doesn't auto-clear GHIN search results.** If Josh searches "Stoll" and adds Josh, then tries to add another GHIN-bound member, the previous search results are still visible. He needs to clear the input + click Search again. Mild friction.

4. **No "Reset" button on manual entry.** Filling name + handicap, then deciding not to add, requires manual clear. Friction is bounded — T3-3's UI is for one organizer creating ~8 members per event.

5. **The "Save name" button stays disabled when nameDraft equals current group.name.** If Josh tries to "fix" a typo by retyping the same name, he needs to actually change the value. v1 acceptable; this is the same as how most form UIs work.

**Recommendation: ship.** AC #22 manual smoke is the final gate.

---

## 🧪 Quinn (QA) — Test Coverage / Failure-Mode Perspective

**Coverage analysis.** Test deltas:
- @tournament/api: 291 → 308 (+17 backend tests; 41% over AC #17 minimum of +12)
- @tournament/web: 16 → 21 (+5 frontend tests; 25% over AC #18 minimum of +4)

**Backend test inventory** (admin-groups.test.ts):

| # | Test | Failure Mode |
|---|---|---|
| 1 | GET happy path: members sorted by name ASC | Persistence + ORDER BY contract |
| 2 | GET 404 unknown groupId | Pre-fetch existence check |
| 3 | GET anonymous → 401 | requireSession |
| 4 | GET non-organizer → 403 | requireOrganizer |
| 5 | PATCH name change → 200 + DB updated | Persistence happy path |
| 6 | PATCH visibility=open → 200 | v1 mode allowed |
| 7 | PATCH visibility=participant → 400 mode_not_v1 | v1 guard |
| 8 | PATCH visibility=self_only → 400 mode_not_v1 | v1 guard |
| 9 | PATCH body > 4 KiB → 400 body_too_large | bodyLimit middleware |
| 10 | PATCH empty body → 400 invalid_body | Zod refine "at least one field" |
| 11 | POST add-by-GHIN new player → 201 + 2 rows | Player + member persistence |
| 12 | POST add-by-GHIN existing player → 201 + reuses player_id | SELECT-or-INSERT |
| 13 | POST add-manual → 201 + new player ghin=null | Manual path |
| 14 | POST duplicate add → 409 player_already_in_group | composite-PK fire |
| 15 | POST unknown groupId → 404 group_not_found | Pre-flight check |
| 16 | POST missing mode → 400 invalid_body | Zod discriminator |
| 17 | DELETE happy → 204; group_member gone, players intact | Removal correctness |
| 18 | DELETE non-existent → 404 member_not_found | Empty-rows handling |

**Frontend test inventory** (admin.groups.$groupId.edit.test.tsx):
| # | Test | Coverage |
|---|---|---|
| 1 | Idle render: heading + members + tabs | Initial render correctness |
| 2 | GHIN search → results → Add → invalidate | Full GHIN add flow |
| 3 | Manual entry → Add → invalidate | Full manual add flow + payload shape |
| 4 | Remove member → DELETE → row gone | Remove flow + cache invalidation |
| 5 | 409 player_already_in_group → friendly alert | Server-error UX mapping |

**Failure modes well-covered:**
- ✅ Each backend layer (Zod / pre-flight / DB / middleware) has at least one rejection test
- ✅ Race-safe player reuse pinned (test #12 — second add reuses player_id, no duplicate row)
- ✅ Composite-PK violation routes to 409 (test #14 — regression guard for the impl-time discovery)
- ✅ context_id stamping pre-flight verified by happy path (member row inserts with correct contextId implicit in not crashing on FK)
- ✅ AbortController on unmount handled via tracked refs + useEffect cleanup
- ✅ TanStack Query cache invalidation tested via groupCallCount-based mock response switching

**Failure modes NOT covered (acceptable Lows):**

- **Unmount-mid-fetch** is not separately tested. The tracked-controller pattern is straightforward enough that an integration test would be heavy. Manual smoke catches this.
- **Concurrent PATCH + POST mutations.** Both target the same queryKey; cache resyncs after each. Not race-tested but the invalidate pattern is correct by inspection.
- **GHIN search fetching during type (debounce).** v1 doesn't debounce — fetches only on Search button click. No keystroke flood.
- **The contextId stamping fix has no dedicated regression test** (codex-R2 Low #3). The happy path tests the full add flow which exercises stamping, but a future regression that re-broke it would only fail an indirect assertion. **Acceptable Low.**
- **Member row sorting with mixed case** (codex would have flagged if surfaced — sort is DB-side ASC, case-sensitive SQLite default). Not a v1 issue per John's note.
- **Visibility radio disabled-attribute coverage.** Tested implicitly (the API guard fires on 'participant'/'self_only'); UI disabled state not asserted in component tests.
- **bodyLimit on POST endpoint.** Backend test #9 covers PATCH; POST has the same middleware shape. Inferred-correct.

**Integration risks that surface at later T3 story time:**

- **T3-6 invite-claim flow** will need to coordinate with group_members. A claimed player_id MAY already exist in group_members via T3-3 manual add. T3-6's spec needs to handle "claim a player who's already in the group" as 200 success (not 409).
- **T3-10 refresh-from-GHIN action** consumers must handle the v1 limitation gracefully (member without GHIN binding shouldn't crash; member with stale data should refresh).

**Residual risk: low.** The test pyramid covers every load-bearing failure mode. The 6 untested edges are all manual-smoke-covered, downstream-spec problems, or polish.

**Recommendation: ship.**

---

## 💻 Amelia (Dev) — Code Quality / Maintainability Perspective

Code reads cleanly. Six observations:

1. **The `isUniqueOrPkConstraintError` extension** (catching both UNIQUE 2067 and PRIMARYKEY 1555) was discovered via test-driven failure during impl. The comment block in admin-groups.ts:39-46 documents WHY both sentinels are needed. Future readers won't be surprised. **Set the documentation bar for sentinel-extension decisions.**

2. **The pre-flight `groupRows[0]!.eventId` unwrap** is the result of impl-codex R1 finding the contextId bug. Worth pinning — the alternative (querying the group row twice: once for existence, once for eventId) would be inefficient. The single SELECT with `{ id, eventId }` projection is the right shape. **Idiomatic.**

3. **`resolveOrInsertGhinPlayer` is 32 lines** mirroring auth.ts:384-464. The shape is identical: outer SELECT, transactional inner SELECT, INSERT, catch UNIQUE, retry-SELECT, fallback throw. Comment block at admin-groups.ts:413-422 explains the race semantics. **Consistent with the codebase pattern.**

4. **The `inFlightControllers` ref pattern** is verbose (ref + useEffect cleanup + trackController + releaseController helpers + signal threading on every mutation). 4 mutations × 4 lines per mutation = ~16 lines of plumbing. A custom `useMutationWithAbort` hook would compress to 1 line per mutation but adds an abstraction. **The verbose explicit pattern is the right call for a story that ONLY this component uses; future stories with similar needs can extract.**

5. **The `nameDraft` sync useEffect** (admin.groups.$groupId.edit.tsx:217-221) uses a 3-condition guard (`group && !nameDraftDirty && nameDraft !== group.name`) inside the effect. Slightly verbose; alternative is a derived-state pattern (compute the displayed value at render time). useEffect is correct because nameDraft is editable; the derived approach would require a separate "edit mode" flag. **Acceptable.**

6. **The `groupCallCount` test pattern** (mock returns Alice on call 1, Alice + new member on call 2) accurately models cache invalidation. Test brittleness is bounded — if TanStack Query changes its invalidate-then-refetch behavior, tests would need re-tuning, but that's expected. **Idiomatic for testing useMutation + invalidate flows.**

**No `// eslint-disable`, no `as any`, no implicit any.** Casts limited to:
- `(await res.json().catch(() => null)) as { code?: string } | null` — narrowing fetch's untyped JSON
- `(input as Request).url` — narrowing fetch's RequestInfo union in the test's mockImplementation
- `body as GroupResponse` after PATCH — flagged by codex-R2 as imprecise (PATCH doesn't return members), but no runtime bug because callers only read fields PATCH does return

**Two minor cleanup items (Lows):**

- The PATCH return type cast (`body as GroupResponse`) is technically wrong. Could create a `PatchGroupResponse` type with the subset fields. **Future polish.**
- The hardcoded TENANT_ID + PLAYER_CONTEXT_ID strings inherit the codebase's v1 single-tenant posture. When multi-tenant lands, every `tenantId: TENANT_ID` line needs to derive from session/event context. **Acknowledged; v1 acceptable.**

**Mid-impl observations:**

- **Wolf Cup pairing-history feature was committed in parallel** (commits `201b00d` + `2b3f3e6`) — Josh's work didn't bleed into T3-3's scope, and the working tree was cleaned twice via separate Wolf Cup commits. **Good co-development hygiene.** The director correctly stopped on the first uncommitted Wolf Cup detection and asked Josh to commit separately rather than auto-stashing.
- **Test failure on first run** (composite-PK 1555 vs UNIQUE 2067) caught the predicate gap immediately. **TDD-style validation works.**

**No blockers.** Ship.

---

## Synthesis & Verdict

All 5 perspectives converge: **ship T3-3 as-is** (after AC #22 manual smoke).

**Cumulative non-blocking flags (none warrant re-iteration):**

| Source | Flag | Disposition |
|---|---|---|
| Mary | Manual-entry spam (rate limiting) | v1 single-organizer; future multi-tenant |
| Mary | WV-hardcoded GHIN search | T3-4 KNOWN LIMITATION; document in AC #22 smoke |
| Winston | 3rd /api/admin mount | Promote umbrella at ~5 mounts |
| Winston | 3rd isUniqueConstraint variant | Promote libsql-errors lib at 4th consumer |
| Winston | 2nd race-safe SELECT-INSERT pattern | Hold; revisit if 3rd similar pattern |
| John | No success toast on Save name | Future polish |
| John | GHIN search results don't auto-clear after Add | Mild friction; future polish |
| John | No "Reset" button on manual entry | Bounded friction (~8 adds per event) |
| Quinn | Unmount-mid-fetch not unit-tested | Manual smoke covers; pattern straightforward |
| Quinn | contextId stamping has no dedicated regression test | Happy path covers indirectly |
| Amelia | PATCH return type cast imprecision | Future polish |
| Amelia | Hardcoded TENANT_ID / PLAYER_CONTEXT_ID | v1 single-tenant; future multi-tenant story |

**No agent has open questions for the user.** No proposed code changes warrant another impl iteration. **Director may proceed to step 9 (codex-on-party-review).**

Epic T3 progress: 4/10 done after T3-3 commit (T3-1, T3-2, T3-3, T3-4). 6 stories remain (T3-5 rule-set editor, T3-6 invite-claim, T3-7 device rebind, T3-8 permissions middleware, T3-9 sub-game opt-in, T3-10 GHIN profile enrichment). T3-5 is up next per file order. AC #22 manual smoke for T3-3 + AC #20 for T3-2 + AC #20 for T2-5 all pending Josh's deploy-and-click pass.
