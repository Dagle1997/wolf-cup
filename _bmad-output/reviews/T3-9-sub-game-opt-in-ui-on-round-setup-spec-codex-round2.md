# Codex Review

- Generated: 2026-04-27T19:12:22.982Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md, apps/tournament-api/src/db/schema/subgames.ts

## Summary

Only spec + schema provided (no implementation diff), so verification is limited to internal consistency + implementability of the round-1 spec fixes. The round-1 fixes largely read as intact: deterministic 6-step precedence is implementable; empty participant arrays are explicitly supported by the upsert semantics; v1 rejection of non-skins is clearly specified. One internal spec contradiction remains (Dev Notes still claims backend accepts disabled types).

Overall risk: low

## Findings

1. [medium] Spec contradiction: Dev Notes still say backend accepts disabled sub-game types (ctp/sandies/putting_contest)
   - File: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md:42-46
   - Confidence: high
   - Why it matters: Risk Acceptance §5 and AC #3 explicitly require v1 backend to REJECT non-skins with 400 `sub_game_type_not_enabled` (defense-in-depth). But Dev Notes later state “backend accepts them (smuggled cURL request would succeed)” which is the pre-fix posture. This can cause implementation drift (dev follows Dev Notes, not AC) and would directly reintroduce the High #2 class (stuck inert config).
   - Suggested fix: Update Dev Notes (around lines 239-240) to match the new invariant: v1 backend rejects non-enabled types; note the v1.5 enablement path via `V1_ENABLED_SUB_GAME_TYPES` instead.

2. [low] Test coverage: empty participant list is specified, but resave-to-empty is not explicitly asserted
   - File: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md:158-162
   - Confidence: medium
   - Why it matters: AC #3’s DELETE-then-INSERT semantics imply resaving `skins` with an empty `participantPlayerIds: []` should delete prior participant rows (leaving 1 sub_games row, 0 participant rows). AC #7 includes a test for empty participant list, but it reads like a first-save case; separately there’s an upsert test with “different participants”. Without an explicit “had participants → resave empty” assertion, a buggy implementation could accidentally skip inserting participants but also skip deleting prior ones (e.g., if delete is conditional).
   - Suggested fix: Add/adjust a test to start with skins + participants saved, then POST skins with empty `participantPlayerIds: []`, assert participant rows = 0 and sub_games rows = 1 for that round.

## Strengths

- AC #3 precedence ordering is deterministic and handler-implementable: parse (invalid_body) → fetch event_round (404) → reject disabled types (400) → duplicate type (400) → duplicate participant (400) → roster membership (400). Multiple failures can co-occur (e.g., duplicate_sub_game_type + player_not_in_event), and the stated ordering cleanly resolves which error wins.
- Empty `participantPlayerIds` is explicitly supported in AC #3 (line 110) and insertion semantics explicitly allow 0 participant inserts per sub_game (line 124), so the “1 sub_games row, 0 sub_game_participants rows” outcome is spelled out.
- `sub_game_type_not_enabled` naming matches the established snake_case error-code convention shown in this spec (`player_not_in_event`, `event_round_not_found`, etc.).
- Path footprint remains ALLOWED-only per §8; no evidence of forbidden path creep in provided materials.
- Schema still allows the forward-compatible type CHECK while app-layer v1 guard tightens invariants (defense-in-depth), consistent with the round-1 fix intent.

## Warnings

None.
