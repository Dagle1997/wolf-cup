# T3-5 Party-Mode Review (non-interactive written)

**Story:** T3-5 — Rule-Set Editor (tenant-scoped, revisioned per FD-8). Organizer-facing editor at `/admin/rule-sets/$id/edit`.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T3-5 unlocks the FD-8 historical-context promise: events that ran under "Pinehurst stakes revision 3" stay computed under that exact revision forever, even after Josh edits the rule set into revision 4. Without T3-5 the schema rows existed but no UI surfaced the immutability story. Strategic value: the event-replay-correctness property (computing money for last year's Pinehurst still produces last year's numbers) becomes live.

**Threat model — five surfaces worth flagging:**

1. **Concurrent revision_number race.** Two organizers both compute `nextRevisionNumber = max + 1`; second INSERT hits the composite UNIQUE → 409. Tested via `vi.spyOn(db.transaction)`. The 409 → no-auto-retry posture is correct: an auto-retry could overwrite organizer A's intent with organizer B's (different) edits. Surface to the user as "reload to see latest before saving again." **Bulletproof for v1; rare in single-organizer production.**

2. **Stored config_json drift.** A future schema migration that adds a field to `RuleSetConfigSchema` would make existing TEXT rows fail the `safeParse`. T3-5's two-stage parse (JSON.parse → Zod safeParse with distinct 500 codes) handles this defensively rather than crashing the UI. **Solid hardening; tested both branches.**

3. **XSS via config_json.** Currently zero exposure: T3-5's frontend uses controlled `<input>` values; no `dangerouslySetInnerHTML`; no clickable URL fields. Future UI rendering a `name` or other text field unescaped would inherit the risk. **Acceptable v1; pin in T3-10 / T7 review checklists.**

4. **Tenant-scoping read leak.** v1 single-tenant 'guyan' makes this benign in production, but the SELECT queries DON'T filter by tenant_id. Same gap acknowledged in T3-1 / T3-3 / courses.ts:39-43. Multi-tenant hardening = future coordinated story across all admin routers. **Acknowledged debt, not introduced by T3-5.**

5. **Manual SQL bypass of validation.** A direct INSERT into rule_set_revisions could store an invalid config_json (carryover=true + validation='none', for instance). T3-5's two-stage parse catches this on read → 500 corrupt_config_shape. **The reader is the line of defense; defense-in-depth works.**

**One v1 limitation worth flagging:** T3-5 has no list view, so Josh can only navigate to a rule_set he already knows the UUID for. After running `POST /api/admin/rule-sets` via curl + capturing the returned ruleSetId, he goes to `/admin/rule-sets/<that-id>/edit`. AC #19 manual smoke walkthrough explicitly covers this. **Future polish: `/admin/rule-sets` index route.**

**Recommendation: ship.** AC #19 manual smoke is the final gate.

---

## 🏗️ Winston (Architect) — System Design Perspective

The implementation lands cleanly. Six observations:

1. **4th `/api/admin` mount.** Per T3-3 party Winston note, "promote umbrella at ~5 mounts." We're at 4. T3-6 (invite-claim flow) likely adds a 5th, OR it lives under a separate `/api/invites` umbrella. Either way the umbrella refactor is one story away. **Hold.**

2. **4th copy of `isUniqueConstraintError`-shape logic.** Auth.ts (UNIQUE only); admin-courses.ts (UNIQUE only); admin-groups.ts (UNIQUE + PRIMARYKEY); admin-rule-sets.ts (UNIQUE + PRIMARYKEY, identical to admin-groups). This is the **5th-consumer threshold for promotion** — the next story that needs it should also extract a `apps/tournament-api/src/lib/libsql-errors.ts` module with two named exports: `isUniqueConstraintError` (strict; auth + courses use this) and `isUniqueOrPkConstraintError` (broader; groups + rule-sets use this). Naming is already aligned. **Promote at 5th consumer; same recommendation as T3-3.**

3. **3rd copy of the AbortController `inFlightControllers` ref pattern.** T3-3 (groups), T3-5 (rule-sets), and pre-existing T2-5/T3-2 hand-rolled fetch+AbortController. The pattern is novel enough across these implementations that a `useTrackedControllers` hook could promote it, but each impl has slightly different needs (T2-5/T3-2 have 1 mutation each + use hand-rolled fetch; T3-3/T3-5 use TanStack Query useMutation with multiple mutations). **Hold; promote when a 4th implementation arrives or when consumers' needs converge.**

4. **The two-stage parse pattern on GET (JSON.parse → Zod.safeParse) with distinct 500 codes** is novel in T3-5. Generalizable: any future endpoint that reads JSON-blob columns and serves them deserialized to clients should use this pattern. Could promote to a generic helper `safelyDeserializeConfig<T>(raw: string, schema: ZodSchema<T>): { ok: true; data: T } | { ok: false; code: 'invalid_json' | 'invalid_shape'; details: ... }`. **Hold; T3-5 is the FIRST consumer. Future consumer (course-editing? sub-game configs?) is the natural promotion point.**

5. **Integer-cents discipline at form boundary** is consistent with the codebase: form collects dollars (string-typed input), `formToConfig` multiplies by 100 + rounds to integer at submit, server validates with `z.number().int().nonnegative()`. Same pattern T2-5 uses for course rating × 10. **Idiomatic.**

6. **The Greenies carryover toggle** does two `setState` in one event handler (`carryover` + `validation`). React 18+ batches these into a single render — no intermediate render with mismatched values. The Zod refine on the schema is defense-in-depth for any path that bypasses the toggle handler. **Correct semantics.**

**Architectural concerns: zero blockers.** Three "watch and promote on 5th consumer" notes (umbrella adminRouter, libsql-errors lib, useTrackedControllers hook) — none warrant T3-5 changes.

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T3-5 satisfy organizer-facing value?** Yes — but only after AC #19 manual smoke confirms the config persists correctly across save/reload + that the FD-8 immutability story works (a saved revision N stays unchanged when revision N+1 is created). Code-level ACs can't observe this without a live production walkthrough.

**Scope discipline:**
- POST /rule-sets pulled into T3-5 scope (epic only mandated POST /:id/revisions). Documented rationale: editor unreachable without an existing rule_set; v1 acceptable trade.
- ZERO SHARED gates — seventh of nine T3 stories so far without a SHARED stop (T3-4 was the only one). AI-2 prediction holding.
- Spec went 3 rounds in codex (one shy of cap). R1 surfaced 4 real issues; R2/R3 progressively cleaner. **Better than T3-3's 4-round-cap noise.** The spec drafted up-front more carefully (especially around tenant-scoping posture documentation + zero-revisions edge case) reduced churn.
- 16 backend tests + 4 frontend tests. Backend exceeds minimum by 60%; frontend meets minimum.

**Most fragile manual smoke steps (AC #19, in order of likely failure):**

1. **Initial Create flow.** Josh runs `curl -X POST .../rule-sets -d '{"name": "Pinehurst stakes"}' -b cookie.txt`. Captures ruleSetId. Manual step, easy to miss in a future polish-pass demo. **Future: list/create UI.**

2. **Revision-number badge update post-Save.** TanStack Query invalidate + refetch should bump the badge from "Revision 1" → "Revision 2" within a few hundred ms. If the cache invalidation pattern has a bug (rare; tested), the user might see stale state. **Tested via groupCallCount-based mock pattern.**

3. **Greenies carryover toggle.** UI auto-switches validation; user might not notice. Future polish: visible animation or "auto-set to '2-putt'" hint text.

4. **Two-stage parse error states.** 500 corrupt_config_json / corrupt_config_shape only fire if data drifts via direct DB tampering. Production unlikely.

**Concerns / observations:**

1. **No "Reset to Defaults" button.** Josh edits sandies off + match play to $5, then wants to revert to baseline. Currently he reloads the page (gets last-saved state, NOT defaults). Future polish: button to reset form to `defaultConfig()`.

2. **Form doesn't persist between page navigations.** If Josh navigates away mid-edit, his changes are lost (form state is `useState`, not persistent). Acceptable v1 — the editor is for one focused session.

3. **No "Revisions History" view.** v1 cannot show "what changed between revisions 1 and 2." Future story OR a manual SQL query (`SELECT revision_number, config_json FROM rule_set_revisions WHERE rule_set_id = ? ORDER BY revision_number ASC`).

4. **The "no revisions yet" banner** (zero-revisions edge case) is technically reachable only via direct DB tampering. The UI handles it gracefully but users will never see it in production. **Defensive code; acceptable.**

5. **The 409 revision_number_conflict UX** asks the user to "reload before saving again." Workable but mildly clunky — alternative would be to auto-fetch + merge, but that's complex. v1 acceptable.

**Recommendation: ship.** AC #19 manual smoke is the final gate.

---

## 🧪 Quinn (QA) — Test Coverage / Failure-Mode Perspective

**Coverage analysis.** Test deltas:
- @tournament/api: 308 → 324 (+16 backend tests; 60% over AC #14 ≥10 minimum).
- @tournament/web: 21 → 25 (+4; meets AC #15 ≥4 minimum).
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).

**Backend test inventory** (admin-rule-sets.test.ts):

| # | Test | Failure Mode |
|---|---|---|
| 1 | POST /rule-sets happy path | Persistence (rule_set + revision 1) |
| 2 | POST Zod miss: missing name | Schema validation |
| 3 | POST anonymous → 401 | requireSession |
| 4 | POST non-organizer → 403 | requireOrganizer |
| 5 | GET happy path: deserialized configJson | Two-stage parse + response shape |
| 6 | GET 404 unknown id | Pre-fetch existence |
| 7 | GET 500 corrupt_config_json (malformed JSON) | Stage 1 parse failure |
| 8 | GET 500 corrupt_config_shape (Zod fails) | Stage 2 parse failure |
| 9 | POST /:id/revisions happy: max+1; prior rows BYTE-IDENTICAL | FD-8 immutability |
| 10 | POST /:id/revisions: events table BYTE-IDENTICAL | Cross-table immutability |
| 11 | POST /:id/revisions Zod: greenies refine fail | Carryover↔validation invariant |
| 12 | POST /:id/revisions Zod: autoPress.downN OOR | Schema range |
| 13 | POST /:id/revisions 404 unknown id pre-flight | Existence check |
| 14 | POST /:id/revisions body > 8 KiB | bodyLimit middleware |
| 15 | POST /:id/revisions UNIQUE conflict → 409 | Race-safe spy pattern |
| 16 | POST /:id/revisions generic DB failure → 500 | Error mapping |

**Frontend test inventory** (admin.rule-sets.$id.edit.test.tsx):

| # | Test | Coverage |
|---|---|---|
| 1 | Idle render: form populates from query data | Initial render + form sync |
| 2 | Greenies carryover toggle auto-switches validation | UI invariant + state batching |
| 3 | Save success → 201 → revision N+1 after invalidate | Full save flow + cache invalidation |
| 4 | Save error: 409 → reload-message; form preserved | Server-error UX mapping |

**Failure modes well-covered:**
- ✅ Both two-stage parse error codes (corrupt_config_json + corrupt_config_shape) explicitly tested
- ✅ FD-8 immutability pinned by byte-identity assertions on prior revisions AND on events table
- ✅ UNIQUE conflict path tested via vi.spyOn(db.transaction) with libsql-shape error
- ✅ Generic DB failure (500 save_failed) tested separately to verify the error-mapping branch
- ✅ Greenies carryover↔validation refine tested (both client + server enforcement)
- ✅ Zero-revisions GET case implicitly covered by the 404 + 200-with-data tests; explicit test would be polish
- ✅ TanStack Query invalidate-then-refetch tested via groupCallCount-based mock pattern (mirrors T3-3)

**Failure modes NOT covered (acceptable Lows):**

- **AC #13 AbortController on unmount** — same as T3-3, not separately tested. Pattern is identical to T3-3 (which also wasn't separately tested). Manual smoke catches.
- **requestId presence on responses** — codex R2 Low #1; trivial regression risk if a future code change drops the field.
- **Concurrent two-organizer save** — modeled by the 409 spy test; real concurrent test would require a multi-process setup.
- **Form doesn't persist across page reload** — acceptable v1 behavior; not tested.
- **defaultConfig() shape regression** — implicit (every test that creates a rule_set asserts on the default values); no dedicated test.
- **The "no revisions yet" banner UI render** — frontend test could mock a `latestRevision: null` response; not done. Future polish.

**Integration risks that surface at later T3 / T6 time:**

- **T3-2.x will add `events.pinned_rule_set_revision_id`.** When that lands, the byte-identity test on events table will need updating to seed an event with a pinned revision. **Documented in spec.**
- **T6 money-compute** will JOIN through rule_set_revisions to read config_json. T6's JSON.parse path inherits the same drift risk; T3-5's defensive pattern is the precedent.
- **T5.11 mid-event rule edit** sets `effective_from_round_id` to a non-null value. T3-5 always inserts NULL. Future story extends the API with this field.

**Residual risk: low.** Test pyramid covers every load-bearing failure mode. The 6 untested edges are downstream-spec problems, manual-smoke-covered, or trivial polish.

**Recommendation: ship.**

---

## 💻 Amelia (Dev) — Code Quality / Maintainability Perspective

Code reads cleanly. Six observations:

1. **`formToConfig` and `configToForm` helpers** (admin.rule-sets.$id.edit.tsx:138-189) handle the string↔number↔cents boundary at submit/load. NaN safety via `Number.isFinite` checks; falls through to 0 for unparseable inputs (which then fail Zod's `nonnegative()` check + surface a friendly error). Verbose but explicit. **Acceptable; the alternative (mixed string|number state) would be worse.**

2. **The `formInitialized` flag** prevents the useEffect from re-syncing form state on every refetch (e.g., after Save, the invalidate triggers a refetch with NEW configJson — but the user just saved that config, so the form should stay populated with the just-saved values, not get reset). Subtle but correct. Could refactor to a derived `defaultValues` pattern with React Hook Form, but T3-5 explicitly avoids that dep.

3. **The Greenies carryover toggle handler** does `setForm((prev) => ({ ...prev, carryover: next, validation: next ? '2-putt' : 'none' }))` — a single setState call with both fields updated. React 18+ batches this into a single render; no flicker between mismatched states. **Correct.**

4. **The 16 backend tests use the standard pattern** (vi.mock the DB; seedSession + cookie; testApp.request). The vi.spyOn(db.transaction) approach for the UNIQUE conflict + generic 500 tests is consistent with admin-courses.test.ts + admin-events.test.ts patterns. **Idiomatic.**

5. **The two-stage parse helper** (admin-rule-sets.ts:269-302) is inlined in the GET handler. Extractable to a generic helper but T3-5 is the FIRST consumer. **Hold; promote when a 2nd consumer needs it.** Comment block at line 23-32 documents the pattern for future readers.

6. **No `// eslint-disable`, no `as any`, no implicit any.** Casts limited to:
   - `(await res.json().catch(() => null)) as { revisionId?: string; revisionNumber?: number; code?: string } | null` in mutationFn — narrowing fetch's untyped JSON.
   - `null as unknown as string` removed from the test (was a leftover from the broken pre-insert path; cleaned up).

**Three minor cleanup items (Lows):**

- The `defaultConfig()` function is duplicated in the test file (as `validConfig`) for test fixtures. Trivial; could import from the route module but tests aren't supposed to depend on production internals beyond what they're testing. **Acceptable v1.**
- The `formInitialized` flag could be replaced with `useEffect(..., [ruleSetQuery.data?.id])` (only re-syncs if the underlying record changes) — slightly more elegant but functionally equivalent for v1. **Future polish.**
- The error-message mapping in `saveMutation.onError` uses string equality (`code === 'revision_number_conflict'`); could use a discriminated-union object map for type safety. **Future polish.**

**No blockers.** Ship.

---

## Synthesis & Verdict

All 5 perspectives converge: **ship T3-5 as-is** (after AC #19 manual smoke).

**Cumulative non-blocking flags (none warrant re-iteration):**

| Source | Flag | Disposition |
|---|---|---|
| Mary | XSS risk if future UI renders config_json fields unescaped | Pin for T3-10 / T7 review |
| Mary | v1 single-tenant tenant-scoping; queries don't filter | Acknowledged debt; future hardening sweep |
| Mary | No list view; navigation requires UUID | Future polish: `/admin/rule-sets` index |
| Winston | 4th /api/admin mount | Promote umbrella at ~5 mounts |
| Winston | 4th isUniqueConstraintError variant | Promote libsql-errors lib at 5th consumer |
| Winston | 3rd AbortController inFlightControllers ref | Promote useTrackedControllers hook at 4th impl |
| Winston | Two-stage parse pattern is novel | Promote to generic helper at 2nd consumer |
| John | No "Reset to Defaults" button | Future polish |
| John | Form doesn't persist across page reload | Acceptable v1 |
| John | No "Revisions History" view | Future story / manual SQL |
| John | 409 reload-and-retry UX is mildly clunky | Future polish (auto-merge?) |
| Quinn | AbortController on unmount not separately tested | Same as T3-3; manual smoke covers |
| Quinn | requestId presence not asserted in tests | Trivial regression risk |
| Quinn | "No revisions yet" banner UI render not tested | Future polish |
| Amelia | `defaultConfig()` duplicated in test as `validConfig` | Acceptable; production-vs-test separation |
| Amelia | `formInitialized` flag could use deps array on effect | Functional equivalent; future polish |
| Amelia | Error-message mapping uses string equality | Future polish: discriminated union |

**No agent has open questions for the user.** No proposed code changes warrant another impl iteration. **Director may proceed to step 9 (codex-on-party-review).**

Epic T3 progress: **5/10 done** after T3-5 commit (T3-1, T3-2, T3-3, T3-4, T3-5). 5 stories remain (T3-6 invite-claim, T3-7 device rebind, T3-8 permissions middleware, T3-9 sub-game opt-in, T3-10 GHIN profile enrichment). T3-6 is up next per file order. AC #19 manual smoke for T3-5 + AC #22 for T3-3 + AC #20 for T3-2 + AC #20 for T2-5 + AC #13 for T3-4 all owed before declaring those stories truly shipped.
