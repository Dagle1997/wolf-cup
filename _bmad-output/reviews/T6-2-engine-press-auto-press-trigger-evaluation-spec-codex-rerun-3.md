# Codex Review

- Generated: 2026-05-04T00:47:16.901Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md

## Summary

Spec is close to implementable, but there are a couple of remaining correctness/contract gaps that could cause real replay/money integrity issues once T6-4 persists presses and replays against the log. The biggest risk is that carried-forward presses are reconstructed using *current* config (multiplier/trigger), which can silently change historical meaning if config changes. There’s also an inconsistency between the stated “one trigger per team per match segment” rule and the algorithm as written, which only ever finds the first trigger for either team in a segment.

Overall risk: medium

## Findings

1. [high] Carried-forward presses re-derive `multiplier`/`trigger` from current config; can corrupt historical meaning if config changes (and is underspecified when autoPressTriggerAtNDown is null/0)
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:146-171
   - Confidence: high
   - Why it matters: `PressLogEntry` only persists `{type, team, startHole}` (lines 140–145), but output `Press` includes `multiplier` and optional `trigger` (lines 146–155). Task 1 step 4 explicitly says carried-forward entries get `multiplier = config.pressMultiplier` and auto `trigger` is re-derived from config (lines 299–300). This means:
- If `pressMultiplier` is ever edited (even accidentally) between evaluations, previously-fired presses will replay with a different multiplier, changing downstream money composition (T6-4/T6-5) without any explicit “config changed” event.
- If `autoPressTriggerAtNDown` is `null`/`0` (auto disabled per AC-12, lines 241–244), but `existingPressLog` contains auto presses from earlier, the spec doesn’t clearly define what `trigger` string should be for those carried-forward auto presses. Task text says “re-derive as `${N}-down` from config” (lines 299–300), which is impossible when config is null/0 unless you special-case it.
This is a data integrity/replay correctness risk because `existingPressLog` is treated as authoritative and is explicitly carried forward even if it “would not fire today” (lines 80–81).
   - Suggested fix: Either:
1) Extend `PressLogEntry` (and thus persisted `team_press_log`) to include `multiplier` and `triggerAtNDown` (or a literal `trigger` string) so replay is stable regardless of current config; and carry-forward uses persisted values.

OR, if you are intentionally assuming config is immutable for a round:
- State an explicit invariant: `config.pressMultiplier` and `config.autoPressTriggerAtNDown` are immutable for the lifetime of the round/log; changing them is unsupported.
- Define what `trigger` should be for carried-forward auto presses when config is `null/0` (e.g., `trigger: undefined`, or throw, or require non-null config whenever an auto press exists in the log).
- Add a fixture/test covering `autoPressTriggerAtNDown = null` with a non-empty `existingPressLog` containing an auto press, asserting the intended `trigger` behavior.

2. [medium] Algorithm only detects the first `|signedDelta| === N` per segment; contradicts stated uniqueness rule “at most one per (team, segment)” and can miss the other team’s trigger after a swing
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:65-66
   - Confidence: high
   - Why it matters: Spec text says: “a single match fires AT MOST ONE press per (`team`, this match's segment)” (line 65), implying each team could (in principle) trigger once in the same segment. But Task 1 defines `findFirstAutoFire(segmentStart, throughHole)` as “First hole h where `|signedDelta| === autoPressTriggerAtNDown` → fire press…” (lines 301–304). That function, as described, returns only the *first* crossing for either team in that segment. After that, the same segment is not re-scanned to see if the *other* team later reaches N-down due to a lead change.

Concrete consequence: in a segment where team A first reaches 2-down (auto press for A), but later the match swings and team B reaches 2-down within the *same* segment, the current algorithm would never emit B’s auto press (unless you define rules that only the earliest crossing in a segment ever matters). This is a behavioral fork that needs to be pinned down in the spec because it changes the press ledger and money results.
   - Suggested fix: Choose and document one:
- If the intended rule is actually “at most one auto-press total per segment (whoever hits N-down first)”, update the uniqueness language in Section 5 (line 65) so it doesn’t suggest per-team triggering.
- If the intended rule is “each team can trigger once per segment when they first become N-down”, then `findFirstAutoFire` needs to be revised to find triggers per team (or to return multiple triggers), and tests/fixtures should include a swing scenario to prove behavior.

3. [low] AC-2 ‘throughHole === 0’ says any number of perHoleResults entries are valid, but duplicate-hole validation still implies some invalid cases
   - File: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md:189-195
   - Confidence: medium
   - Why it matters: AC-2 states duplicate `perHoleResults` entries for the same `holeNumber` → `Error` (line 189). It also states when `throughHole === 0` “any number of perHoleResults entries (all ignored) is valid” (line 194). If “any number” includes potentially-duplicated holeNumbers, that conflicts with the earlier duplicate check. Even if you *intend* duplicates to always be invalid, the current phrasing can mislead implementers or reviewers about expected behavior for `throughHole=0` inputs.
   - Suggested fix: Clarify AC-2 wording to something like: “When throughHole===0, completeness is not required, but perHoleResults still must not contain duplicate holeNumbers and must have valid holeNumber/winner values.” (Or explicitly relax duplicates when throughHole===0, if that’s truly intended.)

## Strengths

- Seed order / fixed-point evaluation is explicitly defined and aligned between Section 5 and Task 1 (lines 54–60, 293–315), reducing implementation drift.
- AC-2 validation surface is comprehensive (throughHole, config, enums, duplicates, completeness) and includes explicit error types in key places.
- Clear deterministic ordering comparator requirement (AC-13, lines 246–255) prevents subtle replay diffs when enums evolve.
- Explicitly handling ‘trigger at hole 18’ as no-fire avoids phantom presses (lines 73–74, 236–240).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T6-2-engine-press-auto-press-trigger-evaluation.md
