# Story 1.3 — multi-perspective review (orchestrator-condensed)

> Produced inline by the Tournament Director (not the full party spawn), given the depth already applied: dual-model spec review (3 Highs fixed) + dual-model impl review with TWO fix rounds (seeding race, write-path fail-closed, three JSON.parse guards, concurrent-write upsert), both models confirming the security-critical core. Implementation + fixes were delegated to focused subagents; reviewed via the codex+gemini ensemble. Full party available on request.

## Analyst — ACs met?
- AC1 dead card → "Set up Rules & Games" link/summary ✓ · AC2 preset single DB-seeded source (deterministic per-tenant ids, idempotent) ✓ · AC3 event-level row, lock_state locked default, parseGameConfig-validated, columns asserted ✓ · AC4 row+audit+activity in one tx, seeded-vs-updated emission ✓ · AC5 cascade resolver + hierarchy validation ✓ · AC6 F1 routing (row-exists) + orphan rejection ✓ · AC7 organizer-gated endpoints, full status/response contract ✓ · AC8 single/front-back point value (even-cents) ✓ · AC9 lock toggle (column re-derived from config_json) ✓ · AC10 preset-first UI w/ shipped primitives ✓ · AC11 scope held ✓.

## Architect
- Clean reuse: engine `resolveConfig` (1.1) + `parseGameConfig`/`checkConfigColumnsConsistent` (1.2) — no duplicated merge/validation. Services thin around the engine. Route mirrors `admin-event-handicaps.ts`. Activity types correctly registered in the real union (`engine/types/activity-events.ts`). No migration (reuses `rule_sets`/`rule_set_revisions` + 1.2's `game_config`).

## PM
- Ships the headline win (dead card gone, working setup). Scope held: modifiers/cap/Wolf presets → E2; functional unlock → E6; round-start pin/settlement → 1.4.

## QA — what the ensemble caught + verified
- **Confirmed correct (both models):** the cross-event/cross-tenant leak guard — `resolveEventGameConfig` validates round∈event, foursome∈round's pairings, all in tenant, BEFORE loading any config; all three endpoints organizer-gated; the row+audit+activity tx atomicity.
- **Fixed over 2 rounds:** preset-seed concurrency (deterministic PK + onConflictDoNothing); write path fully fail-closed (validate before any side-effect, single tx, zero-side-effect-on-invalid test); 3 JSON.parse guards (resolver + write + seed) → `corrupt_config`/clean error, no 500; concurrent-first-write → upsert. Each turned into or covered by a regression test (api 1203 passing + the 2 pre-existing skips; the lone red is the documented `lifecycle-full.e2e` full-suite-load flake — passes in isolation).
- web: 362 passing incl. the new setup-page component test.

## Dev
- Integer/whole-dollar (even-cents) discipline via the engine validator. Fail-closed everywhere. Deterministic. No new deps.

## UX
- Preset-first page, shipped Button/Card/FormField, dark-mode, ≥44px targets; the dead-end card is replaced.

## Followups (non-blocking, noted)
- `TENANT_ID='guyan'` constant is the **platform-wide** single-tenant pattern (identical to `admin-event-handicaps.ts:38`) — revisit app-wide when multi-tenancy lands, not a Story 1.3 issue.
- Minor: a TOCTOU pairing re-query + the `created` flag derivation are race-tolerant lows; the write builds the candidate from the in-code `STANDARD_GUYAN_BASE_CONFIG` constant (equivalent to the seeded revision by construction — the seed persists the same value; `seed_rule_set_revision_id` records provenance).

## Verdict
**No blocking issues.** ACs met; the security-critical core (cross-event isolation, auth, atomicity) verified correct by both models; all Highs + the fail-closed mediums fixed and tested. Ready to commit.
