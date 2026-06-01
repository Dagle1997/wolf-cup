---
title: 'Pairing Transparency & Co-Play Balance Evaluation'
slug: 'pairing-tracking-and-balance-eval'
created: '2026-06-01'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript', 'Hono', 'Drizzle ORM', 'libsql/SQLite', 'React (TanStack Router) + TanStack Query', '@wolf-cup/engine', 'Vitest']
files_to_modify: ['apps/api/src/db/schema.ts', 'apps/api/src/db/migrations/0029_*.sql', 'apps/api/src/routes/admin/rounds.ts', 'apps/api/src/routes/admin/pairing.ts', 'apps/web/src/routes/admin/rounds.tsx', 'apps/api/src/lib/pairing-diff.ts (new)', 'packages/engine (evaluation only — no change)']
code_patterns: ['Hono admin routes under adminAuthMiddleware', 'Drizzle schema + sequential numbered SQL migrations with --> statement-breakpoint', 'engine pure zero-dep functions', 'round_players.groupId is the source of truth for final membership', 'JSON-in-TEXT column convention (battingOrder, bonusesJson)']
test_patterns: ['Vitest in-memory libsql with file::memory:?cache=shared for tx tests', 'engine unit tests in packages/engine/src/*.test.ts', 'api route tests in apps/api/src/routes/**/*.test.ts']
---

# Tech-Spec: Pairing Transparency & Co-Play Balance Evaluation

**Created:** 2026-06-01

## Overview

### Problem Statement

The pairing engine (`suggestGroups`, `packages/engine/src/pairing.ts`) generates suggested groups each week, but **the original suggestion is never persisted** — only the final group assignment survives. So there is no record of what the engine produced versus what the admin (Jason) actually shipped after manual edits (e.g., moving a sub to play with someone they know well). Josh wants every week's generated-vs-final delta tracked so manual changes are visible.

Separately, it is **unverified** whether the engine achieves its original Story 9.1 goal — *"players rotate through the entire league over the course of a season instead of always playing with the same people."* A scan already found an objective drift: 9.1 AC3 specified *minimize the maximum* pairing count and *balance across groups*, but the shipped engine minimizes the *total sum* of pair counts and does not explicitly balance across groups.

### Solution

1. **Tracking (build):** Persist the engine's generated pairing at the moment a round's groups are created — robust to **both** entry points (the `/rounds/from-attendance` auto-create path and the `Suggest Groups` → `Apply` path). Expose a diff endpoint and surface a **"Pairing changes"** section on the **admin round-detail** page showing each player **moved / added / removed** relative to the generated pairing. Forward-only.
2. **Evaluation (analysis, no algorithm change):** Produce a written evaluation of how well the current engine meets the balanced-co-play goal, using real season data, and recommend whether to adopt an **escalating repeat penalty** (2nd pairing costs more than 1st, 3rd much more) to flatten the co-play distribution. The actual algorithm change is **deferred to a follow-up spec**.

### Scope

**In Scope:**
- New persistence for the generated pairing (set once at group creation; never overwritten).
- Capture at **both** round-creation entry points (from-attendance auto-create; suggest+apply).
- Diff computation (moved / added / removed players; sub swaps count as changes).
- `GET` diff endpoint (admin-scoped).
- "Pairing changes" UI section on the admin round-detail page.
- DB migration (nullable column / new table — decided in Step 2); old rounds render as "not tracked."
- Forward-only behavior (no backfill).
- A written **co-play balance evaluation** section grounded in the real 2026 data, with a recommendation toward an escalating-penalty objective.

**Out of Scope:**
- Changing the pairing algorithm / cost objective (deferred follow-up spec).
- Backfilling past rounds' generated pairings (unrecoverable — never persisted + non-deterministic engine).
- Recency weighting of pairings.
- Any change to the ball-draw / batting order (already fixed).

## Context for Development

### Codebase Patterns

- **Engine is pure & zero-dep:** `packages/engine/src/pairing.ts` — `suggestGroups({matrix, playerIds, pins, groupSize})` returns `{groups: number[][], remainder, totalCost}`. Uses **correct Fisher–Yates** + 10 random restarts, keeps lowest `totalCost`. **Non-deterministic** (random restarts → re-running differs). Confirmed no batting-order-class bug.
- **Auto-create path:** `apps/api/src/routes/admin/rounds.ts` `POST /rounds/from-attendance` — builds `matrix` from `pairingHistory` (season-scoped, raw pair counts), builds pins from First/Last requests (`buildGroupRequestPins`), runs `suggestGroups`, then creates `rounds` + `groups` + `round_players` **directly from the suggestion** (`playerToGroupIdx`). `suggestion.totalCost` is returned but not stored. → This is where the generated pairing == initial groups; snapshot it here.
- **Suggest+Apply path:** Story 9.1 `POST /admin/rounds/:roundId/suggest-groups` (ephemeral) → admin reviews → commits via group/player endpoints. Needs verification in Step 2 (does Jason use it; how does Apply commit). Capture point must cover it.
- **Manual edits flow through:** `POST /rounds/:roundId/groups/:groupId/players` (add), `DELETE .../players/:playerId` (remove), `DELETE .../groups/:groupId`, `POST /rounds/:roundId/groups/:groupId/swap` (swap) — all in `admin/rounds.ts`. These mutate `round_players.groupId` after creation; the "final" is current `round_players` membership.
- **Pairing history maintenance:** at finalize, `updatePairingHistory(roundId, seasonId)` upserts `+1` per pair per group (`admin/rounds.ts:43-64`). Pure count, NOT recency-weighted.
- **Group player order:** `round_players` returned with **no ORDER BY** = insertion order; consumers key by `groupId`.
- **Schema patterns:** Drizzle in `apps/api/src/db/schema.ts`; multi-statement migrations need `--> statement-breakpoint` between statements (known libsql gotcha).
- **Admin auth:** new endpoints under `adminAuthMiddleware` in `apps/api/src/routes/admin/`.
- **Admin round detail UI:** `apps/web/src/routes/admin/rounds.tsx` (suggestion panel + group management live here).

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `packages/engine/src/pairing.ts` | `suggestGroups` engine — generated pairing source; evaluation target |
| `apps/api/src/routes/admin/rounds.ts` | from-attendance create, manual-edit endpoints, finalize/pairingHistory hook |
| `apps/api/src/routes/admin/pairing.ts` | Story 9.1 matrix + suggest endpoints (verify in Step 2) |
| `apps/api/src/db/schema.ts` | add generated-pairing persistence (column or table) |
| `apps/web/src/routes/admin/rounds.tsx` | admin round detail — add "Pairing changes" section |
| `_bmad-output/implementation-artifacts/9-1-weighted-average-pairing.md` | original design intent + objective drift |

### Technical Decisions

- **Scope:** tracking feature + written evaluation only; algorithm change deferred (Josh, 2026-06-01).
- **Capture both entry points** (from-attendance auto-create AND suggest+apply); make capture robust to both (Josh, 2026-06-01).
- **Balance goal:** evaluation should assess against an **escalating-repeat-penalty** ideal (everyone-plays-everyone), even though the change itself is deferred (Josh, 2026-06-01).
- **Unit of analysis is foursome composition** (who plays with whom), NOT batting slot within a group (Josh, 2026-06-01).
- **First/Last group requests are accepted hard constraints**, not a fairness defect: a player requesting first/last forces that group and legitimately narrows the options for everyone else. The evaluation must treat these pins as **exogenous** — i.e., assess whether the system is fair/defensible *for the players and slots not constrained by an explicit request*, rather than penalizing the engine for honoring requests (Josh, 2026-06-01).
- **Evaluation's real question = defensibility:** can we demonstrate that, over a season and setting aside forced requests, the weighted-average engine gives players a similar spread of partners (no one stuck repeatedly with the same group, no one denied playing the field)? The evaluation must produce a defensible, data-backed answer — not just describe the algorithm (Josh, 2026-06-01).
- **Forward-only:** past rounds are unrecoverable; render as "not tracked."
- **Real-data baseline (from audit 2026-06-01):** 6 finalized 2026 rounds; max any pair has played together = 3; 11 pairs repeated >1; `pairingHistory` reconciles exactly with actual groups (0 mismatches, 102 pairs); all groups balanced at size 4.

### Investigation Findings (Step 2)

**Generation entry points (capture design):**
- `POST /admin/rounds/from-attendance` (`admin/rounds.ts:1177`) is the **only** path that auto-builds groups from the engine — it runs `suggestGroups` and creates `groups` + `round_players` directly from the suggestion. **This is the canonical capture point for the original generated pairing.**
- `POST /admin/rounds/:roundId/suggest-groups` (`admin/pairing.ts:83`) is **ephemeral** (returns a suggestion; requires the round to already exist) — it's a mid-edit *re-roll* tool, then the admin Applies via group/player endpoints. Re-rolls are admin-initiated, so for v1 the "generated" baseline = the first machine output that establishes the round's groups; re-suggest+apply counts as a manual change against that baseline. **Capture is atomic:** from-attendance captures inside its create tx (Task 4); apply-suggestion captures inside its own tx (Task 5). There is no separate after-the-fact trigger (avoids the snapshot-after-edit race — Codex #2).
- Manual-edit endpoints that mutate final membership: add (`POST .../groups/:groupId/players`), remove (`DELETE .../players/:playerId`), swap (`POST .../groups/:groupId/swap`), delete group. Final = current `round_players.groupId`.

**Persistence decision (revised per party-mode):** add a single nullable column `generated_pairing TEXT` (JSON `[{groupNumber, playerIds:[...]}]`) to the `rounds` table (`schema.ts:149`). Next migration = **0029** (`apps/api/src/db/migrations/`, latest is 0028; multi-statement needs `--> statement-breakpoint`). Old rounds: null = "not tracked." **Capture is a server-side DB snapshot** of the just-created groups (NOT a client-supplied payload) — the server is the source of truth. `generated_pairing_cost` dropped as YAGNI (the diff/eval don't need it).

**UI insertion:** `apps/web/src/routes/admin/rounds.tsx` — round edit/detail is `EditRow` (~line 729); the suggestion panel + apply mutations live ~871–1143 (`SuggestResponse`, `groupNumber`, apply via `groupNumber` body). The "Pairing changes" section attaches to the round detail near group management.

**Co-play balance evaluation — REAL DATA + adversarial controls (6 finalized 2026 rounds).** Verified via Challenge-from-Critical-Perspective elicitation (2026-06-01), which ran the controls the first pass lacked:

- **Aggregate spread — strongly defensible.** Engine produced **12 total repeat-pairings**; a random-assignment baseline (2000 sims, same weekly rosters & group sizes) averages **29.2**, and **0 of 2000 random draws** matched or beat the engine. The engine more than halves repeats and sits beyond the entire random distribution — it demonstrably adds large value (not a small-sample artifact).
- **Honest denominator.** Among the **124** pairs that *could* repeat (co-attended ≥2 weeks), only **11 (8.9%)** actually repeated. Holds up under the corrected denominator (not diluted by can't-repeat pairs).
- **Individual-fairness GAP (the real finding).** The most-concentrated *player* carries **7** repeat-slots under the engine; random's worst player averages **7.43** — i.e. **at the individual-worst level the engine is no better than random.** It minimizes the group *sum* (12 vs 29) but does **not** protect the worst-off individual. This is the Story-9.1 objective drift (minimize-sum, not minimize-max) made concrete.
- **Jason's concentration is structural, NOT a single pin.** Breakdown: Matt Jaquint 3×, then Jay Patterson / Matt White / Josh / Ben McGinnis / Ronnie Adkins each 2×, plus five at 1× (11 distinct partners). No dominant repeat partner → the "it's just his First/Last request" hypothesis is **weak**. More likely: a 6-of-6 regular in a small recurring attendance pool, and the minimize-sum greedy lets him absorb the aggregate's repeats.

**Defensibility verdict (verified):** *Aggregate* co-play is strongly defensible (halves random, beats 2000/2000, 8.9% repeat rate among repeat-capable pairs). *Individual fairness* has a real, identified gap — the engine optimizes group sum, not any one player's worst case — which is exactly what the deferred escalating-penalty / minimize-max change would fix.

**Evaluation deliverable — REQUIRED rigor (so "defensible" is earned, not asserted):** the written evaluation MUST include (1) the random-baseline comparison (engine repeats vs N-sim random, % of sims that beat the engine); (2) the ≥2-co-attendance denominator for any repeat-rate stat; (3) a per-player worst-case-vs-random check (does the engine protect the most-concentrated player, or not?); (4) verification — not assumption — of whether First/Last pins drive any individual's concentration. First/Last requests are treated as exogenous (excluded from the fairness critique), but their effect on a given player must be measured, not hand-waved.

### Architecture Decision Records

| # | Decision | Rejected alternative(s) + why |
| - | -------- | ----------------------------- |
| ADR-1 | Capture = **atomic, in-transaction, server-side snapshot** of committed groups | Client-payload `PUT` (untrusted, can lie); after-the-fact empty-body trigger (Codex #2 race — can snapshot post-edit/half-applied state) |
| ADR-2 | **Set-once** — never overwrite `generated_pairing` | Re-capture on re-roll (would destroy the original baseline, defeating the audit) |
| ADR-3 | **Forward-only** | Backfill past rounds — *impossible*: nothing was persisted and `suggestGroups` is non-deterministic (random restarts), so the original is unrecoverable |
| ADR-4 | Diff keyed on **`groupNumber`** | Group `id` — less human-meaningful; and `groupNumber` is provably stable (never renumbered; delete is empty-only), so no advantage |
| ADR-5 | **Single nullable column** on `rounds` | Dedicated `pairing_snapshots` table — overkill for one set-once snapshot per round |
| ADR-6 | **Engine unchanged** (evaluation only) | Bundling the minimize-max / escalating-penalty fix — scope; deferred to a follow-up spec |

## Implementation Plan

> Two threads: **A. Tracking (build)** = Tasks 1–8; **B. Evaluation (analysis doc, no code)** = Task 9. Engine is NOT modified.

### Tasks

- [ ] **Task 1: Schema + migration — persist the generated pairing**
  - File: `apps/api/src/db/schema.ts` (`rounds` table, ~line 149)
  - Action: add `generatedPairing: text('generated_pairing')` (nullable JSON). **One column only** (cost dropped per party-mode).
  - File: `apps/api/src/db/migrations/0029_generated_pairing.sql` (new)
  - Action: `ALTER TABLE rounds ADD COLUMN generated_pairing TEXT;` (single statement; if more are added, separate with `--> statement-breakpoint` — libsql gotcha). Regenerate/append the drizzle journal as the existing migrations do.
  - Notes: nullable so all pre-2026-06 rounds read as "not tracked." JSON shape: `[{ "groupNumber": 1, "playerIds": [id,id,id,id] }, ...]`.

- [ ] **Task 2: Diff + serialize helpers**
  - File: `apps/api/src/lib/pairing-capture.ts` (new) — single module imported by BOTH route files (avoids route→route imports; Codex #5).
  - Action: export two clearly-separated functions:
    - `serializeGroups(roundId, dbx) → Promise<{groupNumber, playerIds}[]>` — **does DB IO** (reads `groups` + `round_players`, ordered by `groups.groupNumber`). NOT pure.
    - `computePairingDiff(generated, final) → { moved: {playerId, fromGroup, toGroup}[], added: {playerId, toGroup}[], removed: {playerId, fromGroup}[] }` — **pure, no IO** (in-memory comparison; unit-testable in isolation). A player in both with differing groupNumber = `moved`; only in final = `added`; only in generated = `removed`.
  - Notes: **`groupNumber` is a stable diff key** — it is assigned at group creation and never renumbered; delete-group only removes *empty* groups (`admin/rounds.ts:721`), so remaining groups keep their numbers (closes Codex #4). Keep IO and pure logic in separate functions.

- [ ] **Task 3: Set-once capture helper (server-side snapshot)**
  - File: `apps/api/src/lib/pairing-capture.ts`
  - Action: add `captureGeneratedPairingIfAbsent(roundId, dbx) → Promise<boolean>` — reads the CURRENT groups via `serializeGroups(roundId, dbx)` and writes `generated_pairing` ONLY if it `IS NULL` (idempotent set-once); returns whether it captured. Snapshot is from **committed DB state**, never a client payload. Both capture call-sites (Task 4 from-attendance, Task 5 apply) invoke this helper **inside their own transaction** so the snapshot can never reflect a half-applied or post-edit state (Codex #2).
  - Notes: no standalone empty-body trigger endpoint (removed — it was the fragile race in Codex #2). Capture only ever happens atomically inside the two transactions that establish a round's groups. **⚠️ Implementation trap (pre-mortem): the helper MUST be passed the active transaction handle (`tx`), never the global `db`** — called with the global handle inside an open tx it won't see the uncommitted `round_players` inserts and will snapshot empty/stale state.

- [ ] **Task 4: Capture at the primary path (from-attendance)**
  - File: `apps/api/src/routes/admin/rounds.ts` (`POST /rounds/from-attendance`, ~line 1283 tx)
  - Action: inside the same transaction, AFTER the `round_players` inserts, call `captureGeneratedPairingIfAbsent(round.id, tx)`. At that instant the persisted groups == the engine suggestion, so the snapshot is the generated pairing.
  - Notes: canonical capture; fully server-side.

- [ ] **Task 5: Atomic apply-suggestion endpoint (replaces the fragile trigger — Codex #2)**
  - File: `apps/api/src/routes/admin/pairing.ts` (new endpoint) + `apps/web/src/routes/admin/rounds.tsx` (apply flow, ~lines 1131–1143)
  - Action: add `POST /admin/rounds/:roundId/apply-suggestion` (adminAuth), body = the groups to apply `[{groupNumber, playerIds}]` (validated; the admin legitimately chooses which suggestion to apply). **Validate every `playerId` belongs to this round's `round_players`** (reject unknown IDs → prevents orphaned assignments — FMA guard). In **ONE transaction**: (a) reassign `round_players.groupId` to match the payload (creating groups as needed), then (b) call `captureGeneratedPairingIfAbsent(roundId, tx)` with the **tx handle** — so the snapshot is the just-committed apply result, taken before any manual edit.
  - Notes: this endpoint **REPLACES** the web "Apply" flow's N per-player calls — it is the *sole* commit path for an applied suggestion, not an addition (pre-mortem: running both would double-write). Eliminates the timing race. Captured `generated_pairing` reflects committed DB state, not the raw payload. Rounds built *entirely* by hand (never via apply) read "not tracked" — acceptable. Note: Jason's *normal* post-creation edits (swap/add) are still audited via from-attendance capture vs live final, regardless of this path.

- [ ] **Task 6: Diff endpoint**
  - File: `apps/api/src/routes/admin/pairing.ts`
  - Action: `GET /admin/rounds/:roundId/pairing-diff` (adminAuth) → `{ tracked: boolean, generated: {groupNumber, playerIds, names}[] | null, final: {groupNumber, playerIds, names}[], changes: {moved, added, removed} }`. `tracked=false` + `generated=null` for untracked rounds. Resolve player names for display.
  - Notes: reuse `serializeGroups` + `computePairingDiff`; join `players.name`. **Tolerate a missing/null name** (a since-deleted player in the generated snapshot) → fall back to `Player #<id>`, never throw (FMA guard).

- [ ] **Task 7: Admin UI — "Pairing changes" section**
  - File: `apps/web/src/routes/admin/rounds.tsx` (round detail / `EditRow`, ~line 729)
  - Action: a "Pairing changes" section that fetches `pairing-diff` (TanStack Query). Render **human-readable, ACTOR-NEUTRAL change lines** (Codex #7 — we capture *what* changed, not *who*), e.g. *"Ronnie moved from Group 2 → Group 3"* and *"Kyle Cox (sub) replaced Joe White in Group 1."* (Optionally original-vs-final foursomes below.) **When there are no changes, collapse/hide the section** (clean week shows nothing or a one-line "No changes from the generated pairing"). Untracked → "Not tracked (created before pairing tracking)." **On fetch error (500), render an error state (ErrorCard), not a blank page** (FMA guard). Follow existing admin loading/empty patterns; mobile-friendly 44px targets.
  - Notes: read-only; no mutations. Endpoint returns names + groupNumbers to compose sentences client-side. **Per-edit actor attribution (which admin moved whom) is OUT OF SCOPE** — there is no per-edit audit log; copy must not name an actor.

- [ ] **Task 8: Tests (tracking)**
  - Files: `apps/api/src/routes/admin/pairing.test.ts`, `apps/api/src/lib/pairing-diff.test.ts`
  - Action: cover set-once (second call is no-op), diff moved/added/removed, untracked round = `tracked:false`, admin-auth required. **Party-mode edge cases (Quinn):** (1) **group count changed** between generated and final (a group deleted) → moved/removed resolve, no throw; (2) **headcount not a multiple of 4** (remainder/3-some) → capture + diff handle remainder gracefully; (3) **player removed AND a sub added to the same group** → removed in `changes.removed`, sub in `changes.added`; (4) **re-finalize does NOT re-capture** (set-once). Web: render states (tracked w/ changes, tracked w/ no changes → collapsed, untracked, **error/500**). **Self-consistency invariant (assert in diff tests):** every player in `final` is exactly one of unchanged / moved / added, and every player in `generated` is exactly one of unchanged / moved / removed — no player double-counted. **apply-suggestion tests:** it is the sole commit path (no double-write), rejects unknown playerIds, and captures in-tx.
  - Notes: in-memory libsql with `file::memory:?cache=shared` for tx tests (project gotcha).

- [ ] **Task 9: Co-play balance evaluation (analysis deliverable — NO engine change)**
  - File: `_bmad-output/implementation-artifacts/pairing-balance-evaluation.md` (new)
  - Action: write up the verified evaluation using the real data + adversarial controls already produced (random baseline 12 vs 29.2, 0/2000; ≥2-co-attend denominator 11/124 = 8.9%; per-player worst-case 7 vs random 7.43; Jason structural-not-pin breakdown). MUST satisfy the four rigor requirements in Technical Decisions. Conclude: aggregate strongly defensible; individual-worst gap is real; recommend a follow-up spec for a minimize-max / escalating-repeat-penalty objective in `packages/engine/src/pairing.ts`.
  - Notes: reproducible from `_audit/wolf-cup-prod.db`; cite the script. This documents "is the system doing the best it can" with evidence.

### Acceptance Criteria

- [ ] **AC1 (capture/from-attendance):** Given a round created via `POST /rounds/from-attendance`, when groups are created, then `rounds.generated_pairing` is set to a **server-side snapshot of the just-created groups** as `[{groupNumber, playerIds}]` (which equals the engine suggestion at that instant) — no client payload involved.
- [ ] **AC2 (set-once):** Given a round whose `generated_pairing` is already set, when capture is invoked again (re-finalize, apply, or PUT), then the stored value is unchanged and the endpoint returns `{captured:false}`.
- [ ] **AC3 (diff — moved):** Given a tracked round where the admin moved a player to a different group, when `GET /pairing-diff` is called, then that player appears in `changes.moved` with correct `fromGroup`/`toGroup` and the rest are unchanged.
- [ ] **AC4 (diff — sub swap):** Given a tracked round where a sub replaced a player after generation, when the diff is computed, then the removed player is in `changes.removed` and the sub is in `changes.added`.
- [ ] **AC5 (forward-only):** Given a round created before this feature (`generated_pairing IS NULL`), when `GET /pairing-diff` is called, then it returns `tracked:false`, `generated:null`, and the current groups as `final` (no error).
- [ ] **AC6 (atomic apply-suggestion capture):** Given a round with null `generated_pairing`, when the admin applies a suggestion via `POST /apply-suggestion`, then within that single transaction the group assignments are written AND `generated_pairing` is captured from the committed state (set-once); a subsequent manual edit does NOT change the captured baseline.
- [ ] **AC7 (UI):** Given an admin on the round-detail page, when the round is tracked and has changes, then a "Pairing changes" section shows **human-readable change lines** (e.g. "Jason moved Ronnie from Group 2 → Group 3"; "Sub Kyle Cox replaced Joe White in Group 1"); when tracked with no changes, the section is **collapsed/hidden** (no clutter); when untracked, it shows the "Not tracked" message.
- [ ] **AC10 (group-count change):** Given a generated pairing with N groups and a final state with a different group count (a group was deleted), when the diff is computed, then moved/removed resolve correctly with no error.
- [ ] **AC11 (headcount is always groups-of-4 at creation):** Given `from-attendance` rejects non-multiple-of-4 headcounts with a 400 (`admin/rounds.ts:1222`), then `generated_pairing` always contains complete groups of 4 — there is no engine "remainder" to handle. The only sub-4 *final* state arises when a player is removed after creation, which the diff reports as a `removed` (no crash, no special remainder logic).
- [ ] **AC12 (remove + add same group):** Given a player removed and a different sub added to the same group after generation, when the diff is computed, then the removed player is in `changes.removed` and the sub is in `changes.added`.
- [ ] **AC13 (apply-suggestion validation + atomicity):** Given `POST /apply-suggestion` with a body containing a `playerId` not in the round, then it is rejected (4xx) and no assignments change; given a valid body, then all group reassignments and the set-once capture commit in a single transaction (all-or-nothing), and it is the sole commit path (no per-player double-write).
- [ ] **AC8 (auth):** Given a non-admin, when calling `GET /admin/rounds/:id/pairing-diff` or `POST /admin/rounds/:id/apply-suggestion`, then the request is rejected by `adminAuthMiddleware`.
- [ ] **AC9 (evaluation rigor + reproducible definitions — Codex #6):** Given the evaluation doc, when reviewed, then it (a) compares engine repeats to a random baseline and reports the % of sims that beat the engine; (b) reports repeat-rate using the ≥2-co-attendance denominator; (c) includes a per-player worst-case-vs-random check; (d) states — measured, not assumed — whether First/Last pins drive any individual's concentration; AND defines, explicitly enough to reproduce: the **random-baseline mechanics** (seeded PRNG, N=2000 sims, each sim randomly partitions each week's *actual roster* into the *actual group sizes*; it does NOT replicate First/Last pins — stated as a caveat that makes the engine's job look slightly harder, not easier), and the **metric definitions** (repeat-pairing = a pair grouped together ≥2×; repeat-slots(player) = Σ(timesWithPartner − 1); distinct-partners; co-attendance).

## Additional Context

### Dependencies

- No new external libraries. Reuses `suggestGroups`/`pairKey` (`@wolf-cup/engine`), existing group/player + finalize endpoints, `buildGroupRequestPins`, and the `pairingHistory` table.
- Engine is **unchanged** in this spec; the minimize-max/escalating-penalty improvement is a **separate follow-up spec**.
- Evaluation reproducibility depends on the read-only prod snapshot `_audit/wolf-cup-prod.db` (gitignored).

### Testing Strategy

- **Unit (engine-style, pure):** `computePairingDiff` — moved/added/removed/sub-swap/no-change permutations.
- **API integration:** capture set-once, from-attendance capture inside tx, diff endpoint shapes (tracked / untracked), admin-auth. In-memory libsql `file::memory:?cache=shared`.
- **Web:** render the three states (tracked-with-changes, tracked-no-changes, untracked).
- **Evaluation:** numbers reproducible via the documented node:sqlite script against the snapshot; spot-check one round by hand.
- **Manual:** create a round from attendance, move a player + swap a sub, confirm the "Pairing changes" section reflects it; open an old round, confirm "Not tracked."

### Notes

- **Pre-mortem risks:**
  - *Capturing at the wrong moment* (after an edit) would corrupt the "generated" baseline → mitigated by set-once + capturing inside the from-attendance transaction.
  - *Suggest+apply path missed* → round reads "not tracked"; acceptable v1 degraded state, not a data error.
  - *Re-suggest+apply mid-edit* counts as a manual change against the original baseline (documented decision), not a new baseline.
- **Known limitations:**
  - **Forward-only.** Past rounds' generated pairings are unrecoverable (never persisted + non-deterministic engine). Old rounds render "not tracked."
  - First/Last group requests (pins) are accepted constraints, excluded from the fairness critique; their per-player effect is *measured* in the evaluation, not used to excuse the engine.
- **Future considerations (out of scope, follow-up spec):**
  - **Individual-fairness fix:** change the engine objective from minimize-sum toward minimize-max / escalating repeat penalty so the most-concentrated player is protected (the gap this spec's evaluation quantifies: worst player 7 repeat-slots vs random 7.43).
  - Optional recency weighting (penalize same-pair-two-weeks-running) — separate concern from total balance.
  - **Actor attribution** (which admin moved whom): not captured — no per-edit audit log. The diff shows *what* changed, not *who*. If wanted later, add an edit-log table; UI copy stays actor-neutral until then. (Hindsight: a season in, this may be the first thing wished for.)
  - **Re-runnable evaluation:** the co-play balance eval (Task 9) should be reproducible from the snapshot/script as rounds accrue, so "is it still balanced?" can be re-answered mid-season, not just once.
