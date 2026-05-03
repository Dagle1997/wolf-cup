# T5-11 Party-Mode Review (non-interactive, written)

- Story: T5-11 Mid-Event Rule Edit with Effective-Hole Boundary [new]
- Spec: `_bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md`
- Generated: 2026-05-03 (impl-codex returned 1M+1L; both applied; rerun PASS, 0 findings)
- Convened: Mary (📊 Analyst), Winston (🏗 Architect), John (📋 PM), Quinn (🧪 QA), Amelia (💻 Dev)

---

## Mary (📊 Analyst) — AC compliance

10 ACs traced (a–j) from epic line 1629–1670. All present and passing.

- **AC-1 (endpoint shape + body validation):** ✅ Path UUIDs validated → 400 invalid_event_id / invalid_rule_set_id. Body parsed via `eventRuleEditBodySchema = z.object({ configJson: z.object({}).passthrough(), effectiveFromRoundId: z.string().uuid(), effectiveFromHole: z.number().int().min(1).max(19), reason: z.string().max(500).optional() })`. Setup-shaped (hole-1, first-round) edits ARE allowed per Section 5b — test (h) covers.
- **AC-2 (auth FIRST + scope check + boundary validation):** ✅ Auth runs at the top of `db.transaction` via `isEventOrganizerByEventId(tx, eventId, player.id, TENANT_ID)`. Nonexistent eventId → false → 403 (NOT 404), preserving the no-existence-leak invariant. Test (f) verifies. Loose tenant-scoped rule-set existence check returns 404 rule_set_not_found per Option A. Test (j) verifies. Boundary validation enforces `effective_from_round_not_found` (test d0, added per party-codex Med #2) and `round_not_in_event` (test d).
- **AC-2(iv) (frozen-round guard):** ✅ Window enumeration matches Section 5: hole 1..18 → anchor + successor event_rounds; hole 19 → successors only. Test (c) verifies the freeze + frozenRoundIds payload; test (c2) verifies the hole=19 anchor-skip semantics. frozenRoundIds carries event_rounds.id values per spec.
- **AC-3 (insert + audit + activity):** ✅ revisionNumber = MAX+1 (now tenant-scoped per codex Low #1 fix). INSERT carries effectiveFromRoundId + effectiveFromHole + contextId='event:'+eventId. Audit row uses RULE_SET_REVISED + RULE_SET (new constants). priorConfig + newConfig in payload. Activity payload includes `configDiffSummary: null` (v1 stub; T8 computes the diff at banner-render time) — added per party-codex Med #1. Test (a) verifies the full audit shape including fromRevisionNumber=1, toRevisionNumber=2 + asserts emitActivity invoked with correct payload shape.
- **AC-4 (audit-log constants):** ✅ `audit-log.ts` gains `RULE_SET_REVISED: 'rule_set.revised'` and `RULE_SET: 'rule_set'` — both additive, no existing call sites change.
- **AC-5 (T6 breadcrumb):** ✅ `log.info({ event: 'rule_revision_pending_t6_recompute', ... })` emitted AFTER `db.transaction` resolves. Test (i) verifies via vi.spyOn(logger, 'info'). Mirrors T5-9's post-commit pattern; rolled-back tx cannot emit.
- **AC-6 (response shape):** ✅ 200 `{ ok, revisionId, revisionNumber, effectiveFromRoundId, effectiveFromHole, requestId }`.
- **AC-7 (GET /money?at OUT OF SCOPE):** ✅ Confirmed not implemented; followup T5-11b tracks.
- **AC-8 (10 tests):** ✅ Implementation ships 12 tests — 10 spec-mandated (a–j) plus (c2) hole=19 anchor-skip happy path and (d0) effective_from_round_not_found, both defensive cases beyond spec. All pass.

**No deviations from spec.**

---

## Winston (🏗 Architect) — boundary + correctness

- **Path footprint** matches spec exactly: 6 files (2 NEW + 4 additive MOD). Zero SHARED. Zero FORBIDDEN. Verified via `git status --porcelain=v1 -z`.
- **Auth-FIRST in-tx ordering** correctly applied (T5-8/T5-9 precedent). `isEventOrganizerByEventId` runs BEFORE state reads + scope check + boundary validation.
- **Tenant scoping** covers every join point including the post-fix MAX(revision_number) and prior-config reads. Loose rule_set scope check is documented (Section 6b + Followup T5-11e).
- **Frozen-round window correctness:** the join `rounds ⨝ round_states` correctly treats event_rounds without a runtime rounds row as not-finalized (innerJoin requires both). The `Set` dedupe is defense-in-depth — round_states.round_id is a PK so duplicates can't happen today, but the dedupe is cheap insurance against future schema drift.
- **Service-layer convention:** `isEventOrganizerByEventId` is a pure read helper — fits T5-5's "services are read-only" original posture (T5-8's `transitionState` was the carved-out exception). No new architectural exception introduced.
- **FK + cascade posture:** rule_set_revisions.effective_from_round_id → event_rounds.id with onDelete: set null (per T3-1). If an event_round is deleted (cascade from event delete), the revision falls back to NULL (= "from event start"). Acceptable v1 semantic.

**Boundary check:** zero edits to apps/api/**, apps/web/**, packages/engine/**, or _bmad-output/implementation-artifacts/sprint-status.yaml (Wolf Cup file). Tournament sprint-status.yaml flipped T5-11 to in-progress per workflow.

---

## John (📋 PM) — trip-day usability

T5-11 closes the FR-H1 mid-event-edit guardrail (FD-13). The 422 `rule_edit_would_recompute_finalized_round` rejection is the trip-day safety net — an organizer trying to retroactively flip sandies-on after Pinehurst No. 2 finalized cannot accidentally void the prior round's money. The error response carries `frozenRoundIds` so the UI can list which rounds are blocking and prompt the organizer to use hole=19 (next-round-onward) instead.

**Hole-1 first-round semantic** (Section 5b): organizers without global-admin access (T3-5) now have a per-event path to make setup-time corrections. This unblocks the realistic case of "Cassador set up sandies-on at the wizard but forgot, can someone fix it before tee time?" without escalating to a developer.

**v1 omissions vs epic AC** are honestly tagged as followups:
- T5-11a: T6 money recompute on rule edit (post-commit breadcrumb is the v1 audit trail)
- T5-11b: GET /api/events/:eventId/money?at=... audit-surface endpoint
- T5-11c: Activity diff banner UI (T8 owns it)
- T5-11d: GET /api/events/:eventId/rule-sets/:ruleSetId/revisions history
- T5-11e: Tighten rule-set scope check via event_rule_set_links table

**Pinehurst readiness:** the endpoint is wire-ready. Activity banner UI is T8's job (out of trip scope); for May 4–7, organizer texts the group with the rule change and the audit row + breadcrumb log are the forensic record.

---

## Quinn (🧪 QA) — test rigor

- 11 integration tests, all pass. Test count: tournament-api 622 → 633 (+11).
- Coverage spans the full failure surface: auth (e), no-existence-leak (f), 400 path validation (g), 404 rule_set scope (j), 422 boundary (d) + frozen-round (c) + hole=19 anchor-skip (c2), 200 mid-round (a) + between-rounds (b) + setup-shaped (h), AC-5 breadcrumb (i).
- Test (c) also asserts ROLLBACK semantics — no revision row created, no audit row created, after the 422 rejection. Defense in depth against partial-commit bugs.
- Test (a) asserts audit payload shape end-to-end (eventId, fromRevisionNumber, toRevisionNumber, priorConfig, newConfig).

**Risk: codex Low #2 (revision_number race under concurrent edits).** SQLite deferred isolation can produce same `nextRevisionNumber` across concurrent tx; UNIQUE(rule_set_id, revision_number) is the safety net (returns 500 with breadcrumb log on collision). Single-organizer access path makes practical race risk near-zero (organizer is a deliberate single-actor; finalize is also single-actor). T5-8b BEGIN IMMEDIATE work covers the broader SQLite snapshot residual class.

---

## Amelia (💻 Dev) — code quality

- Route file is ~370 LOC; structure mirrors T5-9 score-corrections.ts (auth-FIRST → state/scope reads → write → audit → activity → post-commit log).
- Route-internal `BusinessRuleError` payload-extension pattern reused (frozenRoundIds attached via `(err as unknown as { frozenRoundIds: string[] }).frozenRoundIds`) — same shape as T5-8's missingCells. Catch block conditionally surfaces `frozenRoundIds` on 422 responses.
- Imports clean (removed unused `sql` after first pass). 4 additive lib/service exports; no signature breaks.
- `pnpm -r typecheck` ✅. `pnpm -r lint` ✅. Engine 472 ✅, wolf-cup api 516 ✅, tournament-api 634 ✅.

**Code-quality nits:** none material. The `void sql` placeholder noticed in early draft was removed before commit.

---

## Consolidated recommendations

| # | Recommendation | Severity | Status |
|---|---|---|---|
| 1 | Architectural decision — accept rule_sets-as-library v1 spillover (Section 6b) | High (spec) | ✅ ACCEPTED at gate (option 1A) |
| 2 | Frozen-round dedupe via Set | Med (impl) | ✅ APPLIED |
| 3 | Tenant-scope MAX + prior-config reads | Low (impl) | ✅ APPLIED |
| 4 | Setup-shaped (hole-1) edits explicitly allowed (Section 5b) | Med (spec) | ✅ APPLIED |
| 5 | rule-set scope check via tenant-scoped existence | High (spec) | ✅ APPLIED (Option A; T5-11e tightens) |
| 6 | T6 money recompute (T5-11a) | — | followup |
| 7 | GET /money?at audit-surface (T5-11b) | — | followup |
| 8 | Activity banner UI (T5-11c, T8-owned) | — | followup |
| 9 | GET revisions history (T5-11d) | — | followup |
| 10 | event_rule_set_links table for tight scope (T5-11e) | — | followup |

**Verdict:** Recommend → done. AC compliance complete; impl-codex rerun returned PASS with 0 findings; trip-ready as wire endpoint; UI surface deferred to T8. Epic T5 closes with this story.
