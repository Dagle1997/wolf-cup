# Codex Review

- Generated: 2026-06-21T18:03:21.310Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Summary

Per-item status (Epic 3.1–3.4, reordered):

1) Story 3.1 schema + invariants + teamKey reconciliation: **CONFIRMED**
   - Story 3.1 AC: creates `teams(id,event_id,name?,…)` + `team_members(team_id,player_id,…)`, UNIQUE `(team_id,player_id)`, enforces one-team-per-player-per-event (in code), 2-player teams in MVP, and explicitly reconciles identity with shipped `teamKey = sorted playerIds` (3.1 AC at lines 641–646).

2) Story 3.1 formation semantics (random persisted; high-low tie + HI source; odd/no-HI; determinism test; reviewable roster): **CONFIRMED**
   - Story 3.1 AC: “random is a one-time draw that is persisted” (line 652);
   - high-low: HI source “H1 locked… else most-recent GHIN”, tiebreak “lowest playerId”, odd/no-HI surfaced, determinism-across-input-order test, and “reviewable proposed roster… before a single commit tx” (lines 651–654).

3) Story 3.1 FR21 edit semantics (no re-pin regression; identity persists; recompute case homed in 3.4 without same-epic forward dep): **PARTIAL**
   - Identity persists: “team_id stays; its members mutate” (line 659) ✅
   - No re-pin regression test: membership edit on already-pinned rounds “does NOT re-pin… regression test asserts this” (line 660) ✅
   - But the **positive recompute case is still expressed inside Story 3.1 AC while being deferred to Story 3.4** (line 661), which is a same-epic forward dependency as written (see Findings).

4) Story 3.2 override scope + endpoint reuse + settling assertion: **CONFIRMED**
   - Scope rules-not-roster (line 673) ✅
   - Reuses Story 1.3 endpoint with `level=round` (line 676) ✅
   - Has “settling assertion” that overridden round changes while sibling is byte-identical (line 677) ✅

5) Story 3.3 pin-by-value precedes 3.4 + captures resolved composition + provenance regression test: **PARTIAL**
   - Pin-by-value (not FK), deterministic stored form, precedes 3.4, and provenance regression test are all present (lines 687–693) ✅
   - However, the stated regression assertion “that round’s money is unchanged” (line 693) is not actually coupled to global-team composition before the event pot exists, so it may be a false-positive test (see Findings).

6) Story 3.4 event pot (buy-in source; WTA + tie rule; reuse shipped aggregation; producer-disjointness; pinned snapshot; uncapped; fail-closed; audience-bounded distinct page): **CONFIRMED (with one new dangling-ref risk)**
   - Buy-in is config source (line 706) ✅
   - WTA + named tie split + remainder to lowest-playerId (line 705) ✅
   - Reuses `computeTeamStandings` (line 710) ✅
   - Producer-disjointness test vs 2v2 (line 711) ✅
   - Reads pinned snapshot (line 712) ✅
   - Uncapped MVP / per-instance cap only if ever configured (line 717) ✅
   - Fail closed on incomplete/DNF/team-missing-player (line 718) ✅
   - Audience-bounded + labeled distinctly from pairings UI (line 720) ✅
   - New risk: it claims buy-in is “set on the Rules & Games setup (Story 2.7)” (line 706) but Story 2.7 AC does not mention event-pot buy-in control.

7) Story ordering forward-dependency-clean (3.1→3.2→3.3→3.4) + no ACs referencing later stories as prerequisites: **NOT-RESOLVED**
   - Story 3.1 AC text still depends on later stories for acceptance/meaningful verification (lines 660–661), and Story 3.4 references UI work in Story 2.7 that is not specified there (line 706). See Findings.

Epic 3 ship/hold verdict: **HOLD** until the forward-dependency/dangling-ref issues below are corrected, because they can cause stories to be non-independent and/or allow tests that pass while the pinned-team semantics are actually broken.

Overall risk: medium

## Findings

1. [high] Story 3.1 AC still embeds same-epic forward dependencies (3.3 pin, 3.4 positive recompute test), breaking the claimed dependency-clean order
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:656-662
   - Confidence: high
   - Why it matters: Epic 3 explicitly claims “story order is dependency-clean: 3.1→3.2→3.3→3.4” (line 631), but Story 3.1’s Acceptance Criteria requires behavior whose correctness is only meaningful once Story 3.3/3.4 exist. As written, a team edit ‘does NOT re-pin… (the pin holds their composition — Story 3.3)’ (line 660) and the positive recompute case is ‘homed’ in Story 3.4 (line 661). This makes Story 3.1’s ACs either (a) not satisfiable at 3.1 time or (b) satisfiable only via weak tests that don’t actually validate team pin/recompute semantics.
   - Suggested fix: Adjust Story 3.1 ACs so they are fully verifiable within 3.1: (1) assert team edits never touch round pins generically (no write to pin rows) without assuming pinned team composition exists yet; (2) remove the ‘positive case is homed in 3.4’ bullet from Story 3.1 AC and instead place that AC/test requirement in Story 3.4 where the first team-dependent settlement exists.

2. [high] Story 3.3 provenance regression test asserts ‘round’s money unchanged’ but global-team pinning doesn’t affect round settlement pre-3.4 (risk of false-positive test)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:679-694
   - Confidence: high
   - Why it matters: Story 3.3’s purpose is to ensure re-teaming later does not move past money because the pinned snapshot stores global team composition by value (lines 690–693). But its explicit regression test says: form teams → pin round → change team membership → that round’s money is unchanged (line 693). At this point in the epic, the only shipped round settlement is intra-foursome 2v2, which explicitly does not read global teams (Story 3.1 line 646). So the test could pass even if the global team snapshot is not populated, not read, or incorrectly read—undermining the core safety goal.
   - Suggested fix: Make Story 3.3’s regression test directly assert the pinned snapshot content/immutability: e.g., read the round pin row and verify the stored team snapshot remains byte-identical after live `team_members` edits; additionally assert recompute for any consumer that reads the pinned snapshot (if none yet, keep the test at the pin-storage layer, not ‘money unchanged’). Alternatively, move the ‘money unchanged’ provenance test to Story 3.4 where the event pot actually consumes the pinned snapshot.

3. [medium] Story 3.4 references buy-in configuration being set in Story 2.7, but Story 2.7 AC does not specify event-pot/buy-in UI or persistence
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:703-707
   - Confidence: high
   - Why it matters: Story 3.4 requires: ‘buy-in amount is a config field… set on the Rules & Games setup (Story 2.7)’ (line 706). However, Story 2.7’s acceptance criteria enumerate point value, modifiers, cap, and templates, but do not mention an event pot game, buy-in field, or a control for it. This is a dangling reference that can lead to missing UI/endpoint behavior or contradictory ownership across epics/stories.
   - Suggested fix: Either (a) update Story 2.7 AC to explicitly include authoring/persisting the event-pot buy-in field (and any template implications), or (b) reword Story 3.4 to say it extends the existing Rules & Games setup page and include explicit ACs for the buy-in control + persistence under Story 3.4.

4. [low] Potential layering ambiguity: Story 3.4 places event-pot logic in `games/team-pot.ts` while also requiring reuse of `services/team-standings.ts` aggregation
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:708-711
   - Confidence: medium
   - Why it matters: Epic 1’s engine rules stress a pure engine under `apps/tournament-api/src/engine/games/` (no db/I/O, deps-in). Story 3.4 says to build `games/team-pot.ts` (line 709) but also to reuse `services/team-standings.ts` `computeTeamStandings` (line 710). If `services/team-standings.ts` has service-layer dependencies, importing it into the engine would violate purity and complicate testing/fixtures. Even if it is pure, the cross-layer reference is unclear in the spec and could cause implementation churn.
   - Suggested fix: Clarify whether the event pot is (1) an engine-level pure game that receives pre-aggregated standings as input, or (2) a service-level settlement producer that calls pure helpers and then maps to `SettlementEdge`s via `games-money.ts`. If reuse is required, consider moving/duplicating a pure `computeTeamStandings` helper into the engine (or explicitly declare it pure and safe to import).

## Strengths

- Story 3.1 explicitly names and makes testable the determinism requirements for high-low (HI source + lowest-playerId tiebreak + input-order determinism test) and the ‘random is persisted, not re-rolled’ constraint (lines 651–654).
- Story 3.2 cleanly scopes overrides to rules/config (not roster) and reuses the existing game-config endpoint with `level=round`, plus includes a byte-identical sibling-round settlement assertion (lines 673–677).
- Story 3.4 ACs correctly cover settlement integrity: buy-in as integer-cents config source, named tie split + remainder rule, producer-disjointness test, pinned-team snapshot read, fail-closed for incomplete/DNF, and audience-bounded visibility with distinct labeling (lines 705–721).

## Warnings

- Truncated file content for review: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md
