# Codex Critique

- Generated: 2026-06-22T18:53:42.467Z
- Critiquing: gemini-pro-latest
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/engine/games/config-schema.ts, apps/tournament-api/src/engine/games/modifiers/polie.ts

## Verdict

**SHIP** — overall agreement: partial

## Summary

The prior review correctly describes what would happen *if* a persisted config_json contains the deprecated polieBogeyOrBetter key: Zod `.strict()` + registry allowlisting will hard-reject it, making such rounds/configs “unsettleable.” However, the prior review asserts (without evidence) that Story 2.3 configs with that key are “currently in the database.” Given the supplied context (F1 off in prod, no real-money rounds ever run, no UI to create such configs, seed predates polie, grep shows 0 references), the “High/critical blocker” characterization is not supported. This is a conditional/back-compat concern whose real severity depends entirely on whether any persisted rows actually contain that key.

## Critiques of prior findings

1. [missing_evidence] [high] Backward incompatibility with existing DB configurations (Breaks settlement). registry.ts:155-160. The strict removal of the polieBogeyOrBetter property from Zod schemas and validation creates a critical backwards incompatibility with existing configurations from Story 2.3 currently in the database: such a config would now fail validation → unsettleable.
   - Reasoning: The mechanism is real (any unknown key in `modifier` or `modifier.variant` will fail because `modifierSchema` and `variant` are `.strict()`, and registry rejects any non-empty variant for enabled polie/sandie). But the review’s *key premise*—that Story 2.3 configs with `polieBogeyOrBetter` are “currently in the database”—is not established by the provided evidence. The context strongly suggests there may be **zero reachable/persisted** configs carrying that key (flag off, no money rounds, no template UI, seed predates polie, grep=0). Without a DB scan/export showing such rows exist, calling this “High” is overstated. If such rows do exist (e.g., manually inserted or from a past staging run), then yes: those specific rounds would become unsettleable by design (fail-closed), but that’s a data-presence question, not a proven prod-breaker.

## Additional findings (Codex caught, prior reviewer missed)

1. [medium] Severity hinges on whether any persisted JSON contains the deprecated key; add an explicit data check (or migration) to make this non-guessy
   - File: (operational/DB):0
   - Confidence: high
   - Why it matters: Right now the risk assessment is speculative. A trivial query can definitively answer “is there any reachable persisted config with polieBogeyOrBetter?” If the answer is none, this is a clean break with no blast radius. If the answer is yes, you need either a one-off migration (strip the key) or a compat shim (temporarily accept-and-ignore) to avoid “unsettleable” rounds.
   - Suggested fix: Run a one-time scan on the relevant table/column, e.g. `WHERE config_json::text ILIKE '%polieBogeyOrBetter%'` (or a JSONB-path query). If rows exist: either (a) migrate to remove the key from stored JSON, or (b) temporarily accept `polieBogeyOrBetter` as an optional key and explicitly ignore it for polie (ideally with a comment noting deprecation).

2. [low] Back-compat shims are awkward with a shared `variant` schema; future-proofing may warrant per-modifier variant schemas
   - File: apps/tournament-api/src/engine/games/config-schema.ts:18-37
   - Confidence: medium
   - Why it matters: `variant` is a shared object schema across modifiers. If you ever need to accept deprecated keys for only one modifier (like a legacy polie lever), you either (1) add that key to the shared schema and then police it semantically for every other modifier, or (2) refactor to a discriminated union keyed by `type`. This isn’t a blocker now, but it affects how cleanly you can do targeted compatibility in the future.
   - Suggested fix: If you decide compatibility is important, consider a discriminated union for modifier configs: `{ type: 'polie', enabled, variant: z.object({ polieBogeyOrBetter: z.boolean().optional() }).strict().optional() } | ...` so deprecated keys don’t become globally “structurally valid.”

## Consensus recommendations

- Downgrade the prior “High” to a conditional back-compat note unless/until a DB scan shows persisted configs containing `polieBogeyOrBetter`.
- Do a one-time DB scan for `polieBogeyOrBetter` in persisted `config_json`. If none, document the clean break and proceed.
- If any rows exist, treat it as a product/ops decision: either migrate stored JSON to remove the key, or add a temporary accept-and-ignore compat shim for that specific legacy key (with explicit comments).

## Warnings

None.
