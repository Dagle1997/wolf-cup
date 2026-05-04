# T6-9: Hand-Calc Money Fixture + HTTP Roundtrip Test (NFR-C1 Gate)

## Status

ready-for-dev

## Story

As a developer, I want one fully hand-calculated Pinehurst-shaped fixture (4 players, 4 rounds, 2v2 best ball + 2 cross-foursome individual bets + skins + carry-greenies, all integer cents) validated at BOTH engine level AND HTTP-roundtrip level, so that NFR-C1 "head-to-head money matches hand-calculation" is closed end-to-end before the May 8–10 trip (NFR-C1, NFR-C2, money-correctness-failure mitigation).

## v1 Scope

This story ships two distinct deliverables:

1. **Fixture skeleton (input only).** A complete, deterministic fixture JSON with players, course, pairings, scores, sub-game config, and individual bets — but with the `expected.*` block left as TODO placeholders + `verifiedBy: null`.
2. **Test scaffolds.** Engine-level + HTTP-roundtrip tests that load the fixture and self-skip with a clear message if `verifiedBy === null`. Once Josh hand-calculates the expected money matrix and fills in `verifiedBy` + `verifiedDate`, the tests auto-activate.

This bifurcation honors the AC's "hand-calculated by Josh" requirement (the test's value depends on the human-derived ground truth) while still merging the test infrastructure on the same story.

### Pinehurst-shaped, simplified

- **4 players** with realistic but clean HI: P1 = 0.0, P2 = 8.0, P3 = 14.0, P4 = 22.0.
- **1 course revision**, par 72, slope 113, rating 72.0 — chosen so CH = HI exactly (no slope scaling), keeping hand-calc tractable.
- **4 rounds** of 18 holes each.
- **1 group of 4 players per round**, 2v2 pairings rotating across rounds:
  - Round 1: Team A = (P1, P2), Team B = (P3, P4)
  - Round 2: Team A = (P1, P3), Team B = (P2, P4)
  - Round 3: Team A = (P1, P4), Team B = (P2, P3)
  - Round 4: Team A = (P1, P2), Team B = (P3, P4) — revisits R1 partnership
- **Best-ball config**: `basePerHoleCents: 100`, sandies on (+50¢), carry-greenies on with 2-putt validation, base greenie 100¢.
- **Skins** (gross mode) on all 4 rounds; buy-in **500¢ per player PER ROUND** (i.e., each round has its own `subGames` row with `buyInPerParticipant: 500`, scoped per `eventRoundId` — confirmed by `apps/tournament-api/src/db/schema/subgames.ts` + `services/sub-games.ts` shape); last-hole-unclaimed = `split-among-winners`. With 4 participants × 4 rounds, total event-wide skins pot = 4 × 4 × 500 = 8,000¢ before per-round outcomes.
- **2 individual bets, both straight (NO auto-press)** per Josh's 2026-05-04 call:
  - Bet 1: P1 vs P4 across all 4 rounds, basePerHoleCents 50.
  - Bet 2: P2 vs P3 across rounds 1+2 only (exercises round-scoping), basePerHoleCents 50.

This is "Pinehurst-shaped" in name and structure but smaller in complexity than the May 8–10 trip itself (no auto-press, no multi-group cross-foursome). Josh confirmed the actual trip won't use auto-press either, so the fixture mirrors trip realism.

### Pending-state pattern

The fixture contains a top-level `__meta` block (JSON has no native comments, so prose lives in named fields) and a top-level `expected` block:

```json
{
  "__meta": {
    "storyKey": "T6-9",
    "regenerated": null,
    "scoreNotes": "Hole-level intent: see explanatory entries describing which holes produce sandies, greenies, carries, skins, ties.",
    "scoreIntentByHole": [
      { "round": 1, "hole": 4, "kind": "sandie", "note": "P1 up-and-down from greenside bunker" },
      { "round": 2, "hole": 7, "kind": "greenie+carry-from-hole-4", "note": "P3 GIR ≤2-putt; chains to hole 4 unclaimed" }
    ]
  },
  "expected": {
    "verifiedBy": null,
    "verifiedDate": null,
    "matrixCents": null,
    "totalsCents": null,
    "skinsResults": null,
    "betResults": null,
    "_handCalcWorksheet": "TODO: paste derivation summary (per-round per-rule contributions) here when verified"
  }
}
```

Both test files use a **describe-level `.skip`** with the pending state baked into the suite title (Vitest's default reporter prints the suite title for skipped suites; `test.skipIf` with a runtime reason does NOT reliably surface that reason — confirmed against codex finding #2). Activation is gated by a strict, total predicate (codex re-run finding #1: empty/whitespace `verifiedBy` should NOT activate):

```ts
function isVerified(fixture): boolean {
  const v = fixture.expected.verifiedBy;
  const d = fixture.expected.verifiedDate;
  return typeof v === 'string'
    && v.trim().length > 0
    && typeof d === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(d);
}
const verified = isVerified(fixture);

const suiteTitle = verified
  ? 'T6-9 Pinehurst hand-calc money fixture'
  : 'T6-9 Pinehurst hand-calc money fixture [SKIPPED — AWAITING JOSH HAND-CALC VERIFICATION; fill in fixture.expected.* and set verifiedBy + verifiedDate (YYYY-MM-DD)]';
const describeFn = verified ? describe : describe.skip;

if (!verified) {
  console.warn('[T6-9] Pinehurst hand-calc fixture is unverified; release-gate test is SKIPPED. See _bmad-output/implementation-artifacts/tournament/T6-9*.md');
}

describeFn(suiteTitle, () => {
  // ALL setup that touches state — `vi.mock`, beforeAll DB seeding, app
  // construction — lives INSIDE this block. Module scope is read-only-ish:
  // imports + the fixture JSON parse + the `isVerified` evaluation. This
  // ensures the skipped state truly performs zero side effects (codex
  // re-run finding #2).
});
```

The `console.warn` ensures CI logs surface the skip even if the reporter elides the suite-title affix. **No `vi.mock`, DB seeding, server construction, or Hono app instantiation may run at module scope** — all of those go inside `describeFn(...)` so the skipped path executes only the bare minimum (parse JSON + evaluate `isVerified`). CI sees the tests as `skipped` (non-failing) until Josh:

1. Prints / spreadsheets the input fixture.
2. Derives `matrixCents`, `totalsCents`, `skinsResults`, `betResults` by walking the rules.
3. Pastes them in, sets `verifiedBy: "Josh Stoll"`, `verifiedDate: "YYYY-MM-DD"`, and writes the derivation summary into `_handCalcWorksheet`.
4. Runs `pnpm -F @tournament/api test` and confirms the tests now pass.

Step 4 is itself the verification — a discrepancy between the hand-calc and engine output fails the test loudly, exactly as the AC demands.

### Why not derive expected values myself

- **Circular validation risk.** If I derive expected values by mentally simulating the engine, my mental model shares blind spots with my engine implementation. A bug I have in code I'd likely have in my hand-calc too.
- **AC literalness.** The original AC names Josh as the hand-calculator. Per Josh's 2026-05-04 confirmation, that constraint stands.
- **Methodology precedent.** Josh committed on 2026-05-04 to keep paper scorecards from real rounds and require future contributors to do the same — this is a methodological discipline, not a one-off.

## Path footprint — ALLOWED only

```
apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.json     [NEW]
apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.test.ts       [NEW]
apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc-generator.mjs  [NEW]
apps/tournament-api/src/routes/money-handcalc.integration.test.ts              [NEW]
```

4 NEW files, all under `apps/tournament-api/`. Zero SHARED, zero FORBIDDEN. The `.mjs` generator is a build-time tool (re-run by hand to regenerate the JSON if input scores need editing) — not imported anywhere.

## Acceptance Criteria

**AC-1 — Fixture JSON exists and is well-formed.**

**Given** `apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.json`
**When** parsed
**Then** the file contains the input fields specified above (players with HI 0/8/14/22, 1 course rev par 72 slope 113 rating 72.0, 4 rounds × 18 holes of gross scores + putts, 2v2 pairings rotating across rounds, sub-game config for skins gross mode, 2 individual bets straight no-auto-press) AND the `expected` block with `verifiedBy: null` and TODO placeholders.

**AC-2 — Scores are deterministic and exercise the rules.**

**Given** the fixture's score data + `__meta.scoreIntentByHole` annotations
**When** read
**Then** the scores produce: at least one sandie award, at least one greenie award, at least one carry-greenie sequence, at least one skin awarded, at least one skin tie-carry, and at least one bet hole won/lost — each occurrence is annotated by a corresponding entry in `__meta.scoreIntentByHole` (a JSON array, since native JSON has no comments). The intent entries are descriptive only and are NOT used for test assertions; they exist so a reader (and Josh during hand-calc) can quickly find which holes exercise which rule.

**AC-3 — Engine-level test scaffold.**

**Given** `apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.test.ts`
**When** run via `pnpm -F @tournament/api test`
**Then**:
- If `fixture.expected.verifiedBy === null` → the suite is `skipped` via `describe.skip` with the suite title prefixed `[SKIPPED — AWAITING JOSH HAND-CALC VERIFICATION; ...]` AND a `console.warn` is emitted to CI logs. The skip reason is therefore visible in BOTH suite-title output AND log output (defense-in-depth against reporter variance).
- If `fixture.expected.verifiedBy !== null` → the test invokes the existing engine calculators (the round-scoring / individual-bet / skins functions exported from `apps/tournament-api/src/engine/formats/best-ball-2v2.ts`, `engine/formats/skins.ts`, and the individual-bet engine — exact export names are an implementation concern, not part of the AC) against the fixture; aggregates per-pair money in cents into a matrix; asserts integer equality against `fixture.expected.matrixCents`, `expected.totalsCents`, `expected.skinsResults`, `expected.betResults`. Anti-symmetry of `matrixCents` (`m[a][b] === -m[b][a]`) and zero-sum of `totalsCents` are also asserted.

**AC-3a — Fixture-incomplete guard (verified branch).**

**Given** `expected.verifiedBy !== null` AND any of `expected.matrixCents`, `expected.totalsCents`, `expected.skinsResults`, `expected.betResults` is null OR malformed
**When** the engine-level test runs
**Then** a single guard helper (e.g., `assertFixtureExpectedShape(fixture)`) throws a clear `Error(\`T6-9 fixture verifiedBy is set but expected.${field} is null/malformed; complete the hand-calc before activating the gate.\`)`. The test fails with that diagnostic rather than a downstream null deref. The same helper also rejects empty-string / whitespace `verifiedBy` and malformed `verifiedDate` (defense-in-depth with the `isVerified` predicate above).

**AC-4 — HTTP-roundtrip test scaffold.**

**Given** `apps/tournament-api/src/routes/money-handcalc.integration.test.ts`
**When** run
**Then**:
- If `fixture.expected.verifiedBy === null` → the suite is `skipped` with the same `describe.skip` + `console.warn` pattern as AC-3.
- If `fixture.expected.verifiedBy !== null` → the test (a) uses the **same `vi.mock('../db/index.js')` connection-injection pattern** already established by `apps/tournament-api/src/routes/sub-games.integration.test.ts` so the seed inserts and the HTTP routes share one libsql client (closes codex finding #7 — connection-sharing risk); (b) seeds the fixture's course, course revision, course tees, course holes, event, event-rounds, players, groups, group-members, rounds, rule set, rule-set revisions, sub-games, sub-game participants, individual bets, and individual-bet-rounds via direct DB inserts (deliberate — no factory layer exists yet for this many entities, and the `sub-games.integration.test.ts` precedent demonstrates direct inserts are the project's current integration-test pattern); (c) for each round: marks the round active, commits all hole scores via `POST /api/rounds/:roundId/holes/:holeNumber/scores` using the round's designated scorer session (REAL API path, not direct DB); (d) finalizes each round via `POST /api/rounds/:roundId/finalize` (which auto-computes sub-games per T6-13a); (e) calls `GET /api/events/:eventId/money` and asserts the response's `matrixCents` field matches `fixture.expected.matrixCents` byte-for-byte (integer equality).

**AC-4a — Seed sanity check.**

**Given** the HTTP-roundtrip test has just completed seeding (post-(b))
**When** seeding ends
**Then** the test executes one read-back assertion (e.g., `await db.select().from(events)` returns the seeded event row) before issuing any HTTP request. This catches the connection-mismatch class of bug at seed time rather than as a confusing 404 or 403 from a route call.

**AC-5 — Drift between engine + HTTP roundtrip fails loudly.**

**Given** the fixture is verified (`verifiedBy !== null`)
**When** the engine-level test produces output X and the HTTP-roundtrip test produces output Y, and X ≠ Y
**Then** the failing test's assertion message identifies the divergence (e.g., "engine matrix[P1][P3]=-1500 ≠ HTTP matrix[P1][P3]=-1450"). Equality is **deep structural equality** (Vitest `expect(actual).toEqual(expected)`), NOT JSON-string equality — key ordering and undefined-vs-missing distinctions are intentionally ignored; only integer cents values and the set of present keys are asserted (codex re-run finding #3). This is the NFR-C1 release gate — the failure is NOT tolerated.

**AC-6 — Skip reason is discoverable in CI.**

**Given** CI runs the tournament-api suite with the fixture in unverified state (`verifiedBy === null`)
**When** the test report and CI logs are read
**Then** the skip reason appears in BOTH (a) the test report's suite title, prefixed `[SKIPPED — AWAITING JOSH HAND-CALC VERIFICATION; fill in fixture.expected.* and set verifiedBy]`, AND (b) the CI stdout/stderr stream as a `console.warn` line. Defense-in-depth against reporter variance — Vitest's default reporter prints suite titles for skipped suites, but if a future reporter elides them, the warn line still surfaces.

**AC-7 — Regeneration discipline.**

**Given** a future rule-set config change
**When** the fixture must be regenerated
**Then** both the input scores AND `expected.*` must be updated together; the fixture's `__meta.regenerated` field (an ISO date string in the JSON; no native comments) is set to the regeneration date AND `expected.verifiedBy` is reset to `null` to force re-verification. The describe-skip pattern in AC-3/AC-4 then re-skips automatically.

## Followups

- **T6-9a (gating CI on verification, future):** once the fixture is verified, consider a CI gate that fails if `verifiedBy === null` is committed, to prevent accidental skip-state regression. Out of scope here because it's a CI-policy change.
- **T6-9b (multi-group cross-foursome variant):** a richer fixture with 2 groups of 4 (8 players total) exercising true cross-foursome bet attribution. v1.5 — not needed for the May trip.
- **T6-9c (auto-press variant):** if auto-press use returns post-trip, add a fixture variant exercising press fixed-point recursion.
- **T6-9d (re-enable sandies + carry-greenies in fixture once production wires them):** discovered during impl-codex review. The 2v2 best-ball engine accepts `sandyFromBunker` per score row + `closestToPinPlayerId` per holeMeta entry, but production's `services/money.ts` currently assembles engine input from `holeScores` rows (no sandy column) and passes `holeMeta: []` (no CTP plumbed). v1 sandies/CTP live as separate `sub_games` entries (T6-13), not as 2v2 augmentations. This fixture therefore disables sandies + carry-greenies (`sandies: false, greenieCarryover: false, ...`) so the engine + HTTP outputs match. When a future story (likely after T6-13's CTP/sandies sub-game types get wired into the money service) plumbs the data through, regenerate the fixture with sandies/greenies re-enabled.

## Files this story will edit

- apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.json
- apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.test.ts
- apps/tournament-api/src/routes/money-handcalc.integration.test.ts

## Codex review notes

The first codex pass on this spec returned 1 critical + 3 high + 3 medium + 1 low.

- **Critical "path allowlist violation" — REJECTED as false positive.** Codex flagged this spec file (`_bmad-output/implementation-artifacts/tournament/T6-9-*.md`) as outside `apps/tournament-api/**`. That is correct in the literal-text sense but misreads the director path-allowlist policy, which explicitly lists `_bmad-output/implementation-artifacts/tournament/**` and `_bmad-output/reviews/**` in the ALLOWED bucket. The "ALLOWED only: apps/tournament-api/**" line in the spec's path-footprint section refers to the *runtime code* this story emits, not to the spec/review files themselves.
- **High "skip reason discoverability"** — addressed by switching from runtime-reason `test.skipIf` to `describe.skip` with the reason baked into the suite title + `console.warn` belt-and-suspenders (AC-3, AC-4, AC-6).
- **High "JSON has no comments"** — addressed by introducing a `__meta` block (`scoreIntentByHole`, `regenerated`) as the documented metadata vehicle (AC-2, AC-7). All hand-calc derivation prose lives in `expected._handCalcWorksheet`.
- **High "skins buy-in semantics"** — addressed by stating "500¢ per player PER ROUND" explicitly in v1 Scope, with the schema citation.
- **Medium "fixture-incomplete guard"** — addressed by AC-3a, requiring an `assertFixtureExpectedShape` helper that throws a tailored error rather than allowing a downstream null-deref.
- **Medium "DB connection sharing"** — addressed by AC-4 specifying the same `vi.mock('../db/index.js')` injection pattern as `sub-games.integration.test.ts`, plus AC-4a's seed sanity check.
- **Medium "schema-coupled direct inserts"** — accepted as a known cost. Direct inserts are the established integration-test pattern in this codebase (`sub-games.integration.test.ts`, `events-leaderboard.integration.test.ts`); building a factory layer is out of scope for this story. Note that scores AND finalize go through real HTTP routes — only the static seed (course/event/players/groups/sub-games/bets) is direct-insert.
- **Low "function name accuracy"** — addressed by loosening AC-3 wording to "the existing engine calculators ... exact export names are an implementation concern."

Codex round 2 (after fixes) returned 0 H, 2 M, 1 L. The 2 M + 1 L were applied inline:

- **Medium round-2 #1 (`verifiedBy !== null` too weak)** — strengthened to `isVerified` predicate requiring non-empty string + `YYYY-MM-DD` regex on `verifiedDate`; AC-3a's guard helper rejects the same edge cases.
- **Medium round-2 #2 (module-scope side effects)** — pending-state pattern now explicitly forbids `vi.mock` / DB seed / app construction at module scope; all side-effectful setup lives inside `describeFn(...)` so the skipped path is truly side-effect-free.
- **Low round-2 #3 ("byte-for-byte" ambiguity)** — rephrased AC-5 to specify `expect(actual).toEqual(expected)` deep structural equality.

**Implementation-codex round 1** (against the actual test files) returned 1 H, 3 M, 1 L:

- **High impl-1 #1 (sandies/CTP not flowing through HTTP)** — discovered that production `services/money.ts` doesn't pull `sandyFromBunker` (no DB column) or `closestToPinPlayerId` (passes empty `holeMeta`). Engine config supports them but the data never arrives. Fix: disabled sandies + carry-greenies in the fixture config so engine + HTTP outputs match. Logged as Followup T6-9d.
- **Medium impl-1 #2 (annotations contradict scores)** — cleaned up `__meta.scoreIntentByHole` to drop sandies/greenie annotations; only skin/bet/best-ball outcomes remain.
- **Medium impl-1 #3 (HTTP missing shape guard)** — added `assertFixtureExpectedShape` call inside the verified-branch HTTP test, mirroring the engine test.
- **Medium impl-1 #4 (libsql client never closed)** — wrapped assertions in try/finally with `__testClient.close()`.
- **Low impl-1 #5 (module-scope `console.warn`)** — documented as the deliberate AC-6 discovery mechanism with a "ONLY allowed module-scope side effect" comment block in both test files.

**Implementation-codex round 2** (after fixes) returned 1 H, 2 M, 2 L:

- **High impl-2 #1 (cleanup scope too narrow)** — try/finally only wrapped the assertions; seed/POST/finalize errors leaked the libsql handle. Fix: try/finally now wraps the entire test body from after `vi.doMock`. `vi.doUnmock` is also called in finally.
- **Medium impl-2 #2 (`vi.doMock` order-dependence)** — added `vi.resetModules()` before the doMock calls so prior test files' imports of `db/index.js` don't leak through.
- **Medium impl-2 #3 (skins trunc/N rounding)** — added an extensive comment in the engine test pointing out that `Math.trunc((potA-potB)/N)` matches `services/money.ts` (T6-5a), preserves anti-symmetry via `trunc(-x)===-trunc(x)`, and drops remainder cents for non-divisible splits (followup T6-5h). Josh's hand-calc must use the same rule for matrix equality. The choice is engineering trade-off, not a bug.
- **Low impl-2 #4 (retained sandies/CTP data structures)** — deleted `CTP_BY_ROUND` + `SANDIES_BY_ROUND` from the generator and removed their references; comment block points to T6-9d for re-enabling.
- **Low impl-2 #5 (organizer flag mismatch)** — set `players.isOrganizer: true` on the seeded organizer to match the mocked-session flag (current routes use `isEventOrganizer(events.organizerPlayerId)`, but consistency guards future code paths).

## Risks / Followups

- **Pending-state half-life.** A `test.skip` on a release-gate test is a known anti-pattern: if Josh forgets to verify, the gate is silently inert. Mitigation: AC-6 makes the skip reason loud in CI output; T6-9a (above) hardens this further if needed.
- **Schema-drift fragility.** The fixture wires together ~12 DB tables. If any schema renames a column post-merge, the seed inserts break. This is acceptable: schema changes already break dozens of tests and this one's failure is just one more datapoint.
- **Score-realism gut-check.** Josh should sanity-check that the scores in the fixture are plausibly Pinehurst-distribution (no 18 birdies, no all-doubles). If not, regenerate with adjusted scores and re-derive expected values — but the input-skeleton-first pattern lets that revision happen pre-verification at zero cost.
