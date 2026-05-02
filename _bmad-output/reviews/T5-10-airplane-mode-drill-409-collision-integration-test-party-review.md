# T5-10 Party-Mode Review (non-interactive, written)

- Story: T5-10 Airplane-Mode Drill + 409-Collision Integration Test [new]
- Spec: `_bmad-output/implementation-artifacts/tournament/T5-10-airplane-mode-drill-409-collision-integration-test.md`
- Generated: 2026-05-02 (impl-codex-rerun returned 0H 1M 1L; M applied, L deferred)
- Convened: Mary (📊 Analyst), Winston (🏗 Architect), John (📋 PM), Quinn (🧪 QA), Amelia (💻 Dev)

---

## Mary (📊 Analyst) — AC compliance

8 ACs traced. Solid.

- **AC-1 + AC-2 (strengthened 409 test):** ✅ 5 new assertions (rows.length / grossStrokes / clientEventId / entity-scoped audit count / total-round audit count). Test passes.
- **AC-3 (existing dedupe test verification):** ✅ The dedupe test already asserts everything per epic AC. T5-10 spec confirmed this; no code change needed.
- **AC-4–7 (drill markdown):** ✅ File exists with Setup section, 7 steps, drill-record block, pre-trip gate preamble. iOS-only platform explicit. Two-path step 6 (preferred + fallback). Step 7 owned by organizer/developer.

---

## Winston (🏗 Architect) — boundary + correctness

- **Test changes are additive only** — no existing assertions removed.
- **Drill markdown lives at apps/tournament-web/src/scripts/** — new directory, ALLOWED.
- **`reference/drills/` (root-level SHARED) explicitly out-of-scope** — Followup T5-10a captures.
- **VPS credentials removed from drill markdown** — operational secrets stay in operator's internal SOP.

Boundary check: zero edits to apps/api/**, apps/web/**, packages/engine/**.

---

## John (📋 PM) — trip-day usability

The drill is the pre-trip gate that proves Jeff's iPhone can score offline + sync correctly.

**Trip-day usability:** Setup section makes it clear what "drill round" means + who creates it. 7 steps fit on a laptop screen. Step 6 fallback path works when the organizer isn't physically present. Step 7 (audit verify) is honestly tagged as "developer task, scorer marks Pending".

**Pinehurst readiness:** drill is run-ready. Needs to be executed against each scoring iPhone before May 4.

---

## Quinn (🧪 QA) — test rigor

- The strengthened 409 test now genuinely proves first-writer-wins (not just symptoms).
- Both audit-count assertions provide defense in depth.
- Test count unchanged (622/622); assertions added inside an existing test.

**Risk:** Codex impl-rerun's Low #1 (assert first POST response) — would aid diagnosis on failure. v1.5 polish; not blocking.

---

## Amelia (💻 Dev) — code quality

- Test diff is +30 LOC across one test case. Inline comments explain rationale.
- Drill markdown is 200+ lines, no executable code.

`pnpm -r typecheck` ✅. `pnpm -r lint` ✅.

---

## Consolidated recommendations

| # | Recommendation | Severity | Status |
|---|---|---|---|
| 1 | Strengthen 409 test (5 assertions) | High (spec) | ✅ APPLIED |
| 2 | Drill checklist content | Med (spec) | ✅ APPLIED |
| 3 | Step 3 wording / return-to-PWA | Med (impl) | ✅ APPLIED |
| 4 | Remove VPS credentials from public doc | Low (impl) | ✅ APPLIED |
| 5 | Assert first POST response | Low | v1.5 polish |
| 6 | Admin audit-log endpoint (T5-10b) | — | v1.5 |
| 7 | Drill record auto-archiver (T5-10c) | — | v1.5 |
| 8 | Android validation (T5-10e) | — | post-Pinehurst |

**Verdict:** Recommend → done. AC compliance solid; trip-ready as documentation; first drill execution is pre-trip operator task.
