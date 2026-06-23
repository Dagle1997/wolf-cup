# Party-Mode Review — Story 3-2: Scorecard API

**Mode:** single non-interactive written review (analyst / architect / pm / qa / dev lenses).
**Artifact:** `apps/tournament-api/src/{services/scorecard.ts, routes/scorecard.ts}` + tests + `app.ts` mount.
**Context:** read-only `GET /api/rounds/:roundId/players/:playerId/scorecard` feeding the during-round Wolf-style board (3-1 components; wired in 3-4). `moneyNet` null (3-3 seam). 114 tournament-api files green; typecheck+lint clean; external codex+gemini debate → SHIP.

---

## 📋 Analyst (Mary) — requirements & AC coverage

Story goal is faithfully met: the endpoint returns exactly the per-hole shape the 3-1 `ScorecardHole` consumer needs, and every AC maps to code + a test. The scope boundary is clean — this is the *data* half of the board; presentation (3-1) and wiring (3-4) stay out. The single most important product decision — **never fabricate a number** — is honored twice: `moneyNet` is structurally `null` (not `0`), and net falls to `null` (not `gross`) when strokes are unknown. That's the right call; a fabricated net on the board would erode trust in the money that follows in 3-3.

One requirement-level note for the 3-4 consumer: the contract guarantees `relativeStrokes` and the three claim booleans are **always present** even on unplayed holes, which is exactly what the grid needs for stroke dots on not-yet-played cells. Good alignment. **No blocking concerns.**

## 🏛️ Architect (Winston) — layering, reuse, seams

Architecturally this is a model additive read story:
- **Reuse over reinvention** — `deriveCurrentClaims` (the canonical append-only fold) and `allocateStrokesFromCourseHandicap` (the canonical stroke kernel the money path uses) are both reused, not re-implemented. The **consistency invariant** (scorecard net == money-engine net) is enforced *by construction* because both call the same kernel from the same pinned CH. This is the single most important architectural property here and it's correct.
- **The `moneyNet: null` seam** is clean: 3-3 fills one field with no response reshape, no auth change, no new query path. The builder even comments the seam.
- **FD-1/FD-2** respected — `ScorecardHole` is a local mirror, zero cross-app imports; the engine kernel is the only `packages/engine`-origin code and it's reached via the in-tree `engine/handicap-strokes.ts` (not a new boundary import).
- **Pin authority** — reads the pinned CH, never live HI; aligns with the recompute-on-read money-safety invariant.

Concerns are all forward-looking, none blocking: (1) the `event_rounds.courseRevisionId` vs `round_pin.courseRevisionId` agreement is assumed, not asserted — fine until a correction can re-point the course (Epic 4); (2) money audience-bounding will be needed at this same gate when 3-3 exposes dollars. Both are already logged as followups. **No blocking concerns.**

## 📈 PM (John) — scope, sequencing, value

Scope discipline is excellent: additive only, no schema, no migration, no web churn — the diff is 4 new files + a 3-line `app.ts` mount. That keeps the blast radius tiny and the story independently shippable. Sequencing is correct against the real driver (the Pete Dye brochure re-capture / Jun 26–27 trip): 3-2 is the data spine that 3-3 (money) and 3-4 (wiring) build on, and it unblocks them without committing to either yet. The decision to keep `moneyNet` null here rather than smuggle partial money in is the right risk posture for a money-bearing app. Followups are explicitly tracked, not lost. **No blocking concerns.**

## 🔍 QA (Quinn) — coverage holes & edge cases

Coverage is strong (19 new tests; the no-pin net=null path, claims latest-wins + remove + cross-player isolation, the consistency invariant, the 403/404/400 taxonomy, 9-hole count, and the missing-course_hole error are all exercised). Honest gaps, all **non-blocking** and consistent with the external SHIP:
- **Plus-handicap (`ch ≤ 0`)** is not explicitly tested at the scorecard level. The kernel clamps it to 0 strokes (net=gross), which is correct, but a direct test would lock the behavior. *Worth a cheap add in a future hardening pass.*
- **Route-level `ScorecardDataError → 500`** is service-tested (missing course_hole) but not exercised over HTTP — the 500 mapping branch in the route is unproven by a test.
- **Dual-router reachability** (scorecard mounted alongside scoresRouter) isn't asserted; path-shadowing is impossible under Hono segment matching, so this is a future-proofing guard only.
- **A participant of event A requesting a round of event B** — the round→eventId→participant binding makes this safe (the auth check keys on the *resolved* event), and the 403 non-participant test covers the negative path; an explicit cross-event IDOR test would be a nice belt-and-suspenders addition.

None of these change the verdict; they're the natural 3-2→3-4 hardening backlog.

## 💻 Dev (Amelia) — code quality & maintainability

Clean, idiomatic, matches the surrounding `scores.ts` conventions (tenant-scoped queries, UUID guard, uniform 404, `requestId` plumbing). The builder is a pure `(db, args) → ScorecardHole[]` function — trivially testable, which the test file exploits well. `JSON.parse` of the pin JSON is fail-closed in a `try/catch`. The `ScorecardDataError` class gives a clean route→500 mapping for genuine data faults without masking them as 404s. The private `:memory:` test DB choice (switched from an initial per-pid temp file after it caused full-suite timeouts under disk contention) is the right isolation primitive and is well-commented. Minor: the route does a round lookup that the builder repeats — a negligible double-query accepted for a clean pure-service boundary. **No blocking concerns.**

---

## 🎲 Consolidated verdict

**SHIP — no must-fix items.** All five lenses agree the story meets its acceptance criteria with strong test coverage, correct money-adjacent net semantics (no fabrication), clean reuse of the canonical kernels, and a tidy `moneyNet` seam for 3-3. Every observation raised is a non-blocking, already-logged followup (cache headers at money-exposure time, plus-handicap/route-500/reachability test adds, course-revision agreement, money audience-bounding). This matches the external codex+gemini synthesis (SHIP, high confidence).

**Open questions for the user:** none blocking. The only product-level decision deferred to 3-3 is money audience-bounding (who sees dollars on the board) — correctly out of scope here.
