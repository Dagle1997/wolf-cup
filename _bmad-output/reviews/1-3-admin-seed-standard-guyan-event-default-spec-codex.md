# Codex Review

- Generated: 2026-06-21T21:55:05.794Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md

## Summary

Spec is mostly implementable and anchored to existing seams (Story 1.1/1.2), but several key behaviors are still ambiguous in ways that could yield incompatible implementations—especially around what the “Standard Guyan preset” *is* (DB-seeded vs in-code), how F1-vs-legacy is classified without Story 5.1, and the exact API contract (query params, status codes, response shape) for the resolved-config/orphan/unseeded cases. There are also potential correctness/security footguns if round/foursome identifiers aren’t validated as belonging to the event.

Overall risk: medium

## Findings

1. [high] Contradictory/ambiguous definition of the “Standard Guyan preset” (DB-seeded config vs in-code constant)
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:22-78
   - Confidence: high
   - Why it matters: AC2 says the preset is “seeded … as a rule_set + rule_set_revision … carrying the base config provenance” and its “config = the engine’s guyAN-2v2 base config” (lines 23–24). But Key decisions later say “Preset config is built in-code from the guyAN-2v2 base + organizer’s point value; seed_rule_set_revision_id records provenance” (lines 76–78). Those can be implemented incompatibly:
- Implementation A: store the full config_json in rule_set_revision and copy/resolve from DB.
- Implementation B: seed only a revision row as a marker/provenance ID; actual config lives in code.
This affects idempotency keys, migrations, auditability, and whether future preset changes are data-driven or code-driven.
   - Suggested fix: Make an explicit decision in AC2/Key decisions:
- Option 1 (data-driven): rule_set_revision contains canonical config_json; seeding/updates read from DB.
- Option 2 (code-driven): rule_set_revision is a stable identifier only; config is an in-code constant (and clarify what columns are populated in revision).
Also specify the stable lookup key for idempotency (e.g., slug='standard-guyan', revision_number=1) and whether rule_set_revision content is immutable once shipped.

2. [high] Resolved-config endpoint contract is underspecified for unseeded/orphan cases (status codes + response shape)
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:27-35
   - Confidence: high
   - Why it matters: AC6/AC7 describe outcomes (“rejected”, “returns … reason”) but do not define the HTTP status code(s) or a stable JSON response schema for:
- unseeded event (no event-level row)
- orphan round/foursome row without event-level row (“no_event_level_config”)
- invalid roundId/foursomeNumber input
Without a precise contract, web may implement one expectation (e.g., 200 with {ok:false}) while API implements another (e.g., 409/422/404), causing integration churn and test brittleness.
   - Suggested fix: Specify a concrete response contract for GET /resolved-config, e.g.:
- 200 { ok:true, resolvedConfig: GameConfig, sources:{event?:id, round?:id, foursome?:id}, lockState:'locked'|'unlocked' }
- 409 or 422 { ok:false, reason:'no_event_level_config'|'unseeded_event'|'invalid_scope', details?:... }
Also decide whether “orphan rejected” means HTTP error (preferred) or 200 with ok:false, and ensure the UI knows how to render it.

3. [high] Potential cross-event data leak / incorrect resolution if roundId/foursome override inputs aren’t validated as belonging to the event
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:27-59
   - Confidence: high
   - Why it matters: AC5 says resolver loads rows for (event, round?, foursome?) (line 29) and AC7 exposes GET /api/admin/events/:eventId/resolved-config (line 34), but the spec never defines how roundId/foursomeNumber are passed (query params?) nor requires validation that:
- roundId belongs to :eventId
- foursomeNumber is in range and belongs to that round/event
If the service queries game_config by roundId alone (or accepts arbitrary identifiers), an organizer of Event A could accidentally (or maliciously) resolve configs using overrides from Event B, leaking configuration across tenants or producing wrong results.
   - Suggested fix: Add acceptance criteria requiring scope validation:
- roundId must be a round of eventId (else 404/403)
- foursomeNumber must be valid for that event/round (else 400/404)
Also constrain DB queries to include eventId in joins/WHERE clauses when loading round/foursome rows.

4. [medium] Lock-state/config-version “derived from config_json and asserted equal” is unclear given lock_state is also a user toggle
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:23-43
   - Confidence: high
   - Why it matters: AC3 says lock_state/config_version are “derived from config_json and asserted equal” (line 24), but AC3/AC9 also treat lock_state as an explicit column set by default and a user toggle (lines 24, 42). If config_json does not contain lock_state, ‘deriving’ it is impossible; if it does, then the toggle must update both config_json and column consistently, which is a different design. This ambiguity can lead to inconsistent persistence or broken checkConfigColumnsConsistent enforcement.
   - Suggested fix: Clarify the source of truth:
- If lock_state is a column only: deriveConfigColumns should not claim to derive lock_state from config_json; checkConfigColumnsConsistent should compare only the columns that are actually encoded.
- If lock_state is duplicated in config_json: specify exact JSON path and require updates keep both in sync (and ensure parseGameConfig schema includes it).

5. [medium] PUT semantics: when to emit game.config_seeded vs game.config_updated is not fully specified (idempotency + auditing)
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:24-56
   - Confidence: medium
   - Why it matters: AC4 requires both activity types exist (line 25), and Task 3 describes ‘seedOrUpdateEventGameConfig’ (line 56), but the spec doesn’t define the exact rules:
- If the event-level row exists and PUT repeats the same payload, is it a no-op? Still emit updated?
- If changing only lock_state, is that updated or seeded?
- If seed_rule_set_revision_id is unchanged but point value changes, do we keep ‘seeded’ provenance?
Different choices affect audit/activity volume, UI timeline semantics, and tests.
   - Suggested fix: Define explicit rules, e.g.:
- First creation of event-level game_config => emit game.config_seeded
- Subsequent writes that change any material field => emit game.config_updated
- Writes that are identical => 200 + no-op (no audit/activity) or still log (choose one)
Also specify required activity payload fields (eventId, prior/new lock_state, pointValueSchedule, seed_rule_set_revision_id, etc.).

6. [medium] F1-event classification “row exists ⇒ F1” may conflict with legacy/cutover behaviors; dual-read boundary needs sharper definition
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:29-77
   - Confidence: medium
   - Why it matters: AC6/Key decisions say this story treats “event-level game_config row exists ⇒ F1” until Story 5.1 adds cutover_state (lines 30–31, 75–77). If any legacy flow could ever create an event-level game_config row (now or in future backfills), this heuristic could misclassify and route users into F1 behavior unexpectedly. Also AC6 says orphan round/foursome rows without event-level row are rejected (line 30–31), but it’s unclear whether that means the system is *never* allowed to create non-event rows in legacy mode, or just that the resolver endpoint refuses to resolve them.
   - Suggested fix: Tighten the dual-read contract:
- State whether legacy mode ever writes to game_config at any level.
- If yes, define a more robust classifier now (even if cutover_state comes later), e.g. require event-level row with seed_rule_set_revision_id not null, or a specific config_version.
- Clarify whether orphan rows are treated as data corruption (alert) vs a supported transitional state (and the expected operator response).

7. [low] API parameters for point-value schedule and “presses remain OFF” are not concretely tied to schema fields
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:36-39
   - Confidence: medium
   - Why it matters: AC8 references config_json.pointValueSchedule kinds and says “Whole-dollar values only (even cents — the engine’s validator enforces it). Presses remain OFF for F1 events.” (line 38). Two issues:
- “even cents” reads like a typo/ambiguity (do you mean “no cents”?).
- “Presses remain OFF” implies a schema field or feature flag; if the GameConfig schema already includes presses, state the exact field and default; if it does not, this is a hidden forward dependency on later schema/engine work.
   - Suggested fix: Clarify wording and schema mapping:
- Explicitly require integer dollars (no cents) and name the schema property types.
- Name the exact config_json field that controls presses (or state “presses not represented in config yet; no UI and no writes”).

8. [low] File allowlist notes an unnamed app-router file; boundary is probably OK but could be tightened for FD-1/FD-2 tracking
   - File: _bmad-output/implementation-artifacts/tournament/1-3-admin-seed-standard-guyan-event-default.md:97-114
   - Confidence: high
   - Why it matters: The story says an app-router registration file “e.g. src/app.ts” will be edited but “Exact path confirmed at implementation” (lines 113–114). If FD-1/FD-2 requires precise file tracking, leaving it unnamed can cause review gaps or accidental edits outside the intended area.
   - Suggested fix: Name the exact router file path now (once known) or list the set of candidates (e.g., apps/tournament-api/src/app.ts or src/routes/index.ts) and require the dev to update the allowlist when confirmed.

## Strengths

- Clear reuse of Story 1.1 resolveConfig and Story 1.2 parseGameConfig/checkConfigColumnsConsistent seams (lines 66–69), reducing risk of duplicated resolution logic.
- Organizer-only gating is explicitly called out and references an existing route to mirror (lines 34–35, 69–70), which should prevent accidental auth drift.
- Transactional requirement is explicitly stated (line 25) and tests are planned to assert it (line 61), which is important for audit/activity consistency.
- Good explicit scope boundaries: settlement/round pin/leaderboard mode wiring deferred to Story 1.4 and cutover_state to 5.1 (lines 40–43, 50–51, 80–82).

## Warnings

None.
