# Story 1.2 — multi-perspective review (orchestrator-condensed)

> NOTE: Produced inline by the Tournament Director rather than via the full `bmad-party-mode` + party-review-ensemble, given (a) the impl review ensemble converged CLEANLY across both models — codex + gemini found 3 Highs on first pass, all fixed, then bilateral re-review came back codex 1M/1L (resolved) + gemini clean, with NO material disagreement (synthesis verdict SHIP); (b) this is an additive-schema story (no settlement math, no UI, no external API, no auth surface); (c) context preservation for a safe atomic commit. A full party review is available on request.

## Analyst — meets the acceptance criteria?
- AC1 (canonical config_json + derived columns asserted equal): ✓ `.strict()` Zod + `checkConfigColumnsConsistent` + a unit test for mismatch.
- AC2 (UNIQUE tenant/level/ref): ✓ + duplicate-rejected test.
- AC3 (Zod ⇔ validateResolvedConfig, fail-closed at read): ✓ `parseGameConfig` composes both; drift test asserts identical verdicts across valid/unknown-game/unknown-modifier/too-new/odd-pv/gross-variant.
- AC5 (round_pin UNIQUE(round_id), tenant copied from round): ✓ pinRound derives tenant/context from the `rounds` row, throws if missing.
- AC6 (per-player HI+CH JSON, validated): ✓ `perPlayerHandicapsSchema` (finite numbers); NaN-rejected test.
- AC8 (nullable team_composition seam, NULL in E1): ✓ + default-NULL test.
- AC9/AC10 (only game_config + round_pin; additive CREATE TABLE only, no CHECK rebuild): ✓ migration 0019 is two CREATE TABLEs + indexes, statement-breakpoints, no CHECK.
- AC11 (immutable, atomic, idempotent pin): ✓ INSERT…onConflictDoNothing().returning() + first-pin-wins test.
- AC12 (additive, existing tables untouched, suites green): ✓ tournament-api 1173 passing.

## Architect
- Clean layering: schema (`db/schema/game-config.ts`, `round-pins.ts`), pure validator (`engine/games/config-schema.ts` reuses the engine's `validateResolvedConfig` — single source, no drift), service writer (`services/pin-round.ts`, tx-scoped). FKs target existing tables (rule_set_revisions/rounds/course_revisions, verified). No forward deps; lifecycle wiring correctly deferred to Story 1.4.
- Tenancy provenance derived-from-round is the correct AC5 model (no caller-trust).

## PM
- Scope held tight: only the two tables + validator + writer + tests. Seed UI/resolver endpoint (1.3) and live settlement/round-start pin (1.4) correctly out of scope. Epic correction (modifiers='registered', not '[]') folded with rationale.

## QA
- 26 story tests: round-trip, unique, drift, column/JSON consistency, enum guards, pin write/immutability/fail-closed (bad config, NaN handicap, round-not-found, unknown-key). Both impl Highs from the review were turned into regression tests.
- Known trade (accepted): pin-round test disables FKs for synthetic course_revision_id (writer-logic focus); real FK path is exercised in Story 1.4. Documented.
- Residual lows (non-blocking, noted): `tenant_id DEFAULT 'guyan'` is the shared ecosystemColumns convention (out of scope); proto-pollution on handicap keys is bounded — playerIds are trusted roster ids.

## Dev
- Integer-cents/finite-number discipline; canonical (parsed) config persisted; fail-closed everywhere (config, handicaps, createdAt, missing round, conflict-without-row). Deterministic. No new deps (zod/drizzle present).

## UX — n/a (no UI in this story).

## Verdict
**No open questions, no required changes.** ACs met; additive migration clean; the impl ensemble's 3 Highs fixed + bilaterally re-confirmed clean. Ready to commit.
