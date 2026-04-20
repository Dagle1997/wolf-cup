# Story T1.1: CLAUDE.md Disambiguation Note

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer working in this monorepo,
I want a CLAUDE.md note that disambiguates Wolf Cup paths from tournament paths,
so that I don't accidentally edit Wolf Cup files when working on tournament.

## Acceptance Criteria

1. **Given** the root `CLAUDE.md` at `D:/wolf-cup/CLAUDE.md`
   **When** inspected
   **Then** it contains a new section introduced by the literal heading line `## Monorepo Disambiguation`, and the body of that section contains, in any order, the literal strings `apps/api`, `apps/web`, `apps/tournament-api`, `apps/tournament-web`, and the literal phrase `without explicit per-session approval`.
2. **Given** the same section
   **When** inspected
   **Then** its body contains the literal strings `FD-1` and `FD-2` and the literal path string `_bmad-output/planning-artifacts/tournament/prd.md`.
3. **Given** the diff of this change against the prior `CLAUDE.md`
   **When** inspected
   **Then** it is a single contiguous insertion at end-of-file with zero deletions and zero modifications to any pre-existing line.

## Tasks / Subtasks

- [x] Task 1: Append the `## Monorepo Disambiguation` section to root `CLAUDE.md` (AC: #1, #2, #3)
  - [x] Subtask 1.1: Append after the existing final section, preserving the file's existing trailing-newline convention
  - [x] Subtask 1.2: Use an `## ` (H2) heading named exactly `Monorepo Disambiguation`
  - [x] Subtask 1.3: Precede the heading with a `---` horizontal-rule separator followed by a blank line (matches the between-section pattern already in the file)
  - [x] Subtask 1.4: Body must state the three rules below (wording of each rule is at the dev agent's discretion, but each bullet must literally include the quoted path strings / phrase shown here):
    - `apps/api` and `apps/web` belong to Wolf Cup
    - `apps/tournament-api` and `apps/tournament-web` belong to Tournament
    - Tournament work does not edit Wolf Cup paths `without explicit per-session approval`
  - [x] Subtask 1.5: Cite `FD-1` and `FD-2` as source-of-truth decisions, with an inline reference to `_bmad-output/planning-artifacts/tournament/prd.md`
- [x] Task 2: Verification pass — section-scoped, mechanical (AC: #1, #2, #3)
  - [x] Subtask 2.1: Confirm the heading exists exactly once — `grep -cx '## Monorepo Disambiguation' CLAUDE.md` returns `1`
  - [x] Subtask 2.2: Extract the body of the new section (all lines between the `## Monorepo Disambiguation` heading and the next line beginning with `## ` or EOF) using:
    ```
    awk '/^## Monorepo Disambiguation$/{flag=1; next} /^## /{flag=0} flag' CLAUDE.md > /tmp/t11-section.txt
    ```
  - [x] Subtask 2.3: Against `/tmp/t11-section.txt`, confirm each of the following literals is present (run each `grep -F` separately; each must exit 0):
    - `apps/api`
    - `apps/web`
    - `apps/tournament-api`
    - `apps/tournament-web`
    - `without explicit per-session approval`
    - `FD-1`
    - `FD-2`
    - `_bmad-output/planning-artifacts/tournament/prd.md`
  - [x] Subtask 2.4: Inspect `git diff CLAUDE.md` and confirm: zero `-` lines (no deletions), all `+` lines form a single contiguous block at the tail of the file, and no pre-existing line is modified

## Dev Notes

- **Scope is exactly one file:** `D:/wolf-cup/CLAUDE.md`. Do not modify `~/.claude/CLAUDE.md` (user global) or any subpath CLAUDE.md file. The AC is scoped to the repo-root file only.
- **Source of truth for the section's content:** the PRD's FD-1 and FD-2 blocks. Do NOT introduce additional guardrails (engine internals, tests, migrations, root-file whitelists) — those live in the tournament architecture and in BMAD memory, not in root `CLAUDE.md`. Scope discipline is explicit here because the epic AC is narrow and any expansion creates durable constraints that are hard to walk back.
- **Tone guidance (non-blocking):** the existing CLAUDE.md is declarative and spare (e.g., "Reality Is Sovereign", "A Claim Is a Debt"). Matching that register (short sentences, no emojis, no evangelizing) is preferred but not an AC.
- **No test impact:** `CLAUDE.md` is read by humans + LLM agents, not by code. No unit/integration test should change. Do not invent tests.

### Project Structure Notes

- Target file: `CLAUDE.md` at repo root.
- Do not touch `_bmad-output/**`, `apps/**`, `packages/**`, or any other CLAUDE.md file in the tree.
- The story's verification (Task 2) is entirely shell/grep/diff — no runtime dependencies.

### References

- Story source — open `_bmad-output/planning-artifacts/tournament/epics-phase1.md` and find heading `#### Story T1.1: CLAUDE.md Disambiguation Note`
- FD-1 source — open `_bmad-output/planning-artifacts/tournament/prd.md` and find heading `### FD-1: Monorepo posture — no rename`; the final bullet contains the exact disambiguation mandate being implemented here
- FD-2 source — open `_bmad-output/planning-artifacts/tournament/prd.md` and find heading `### FD-2: Port posture — copy verbatim, no shared package for ported code`
- Architecture mapping row — open `_bmad-output/planning-artifacts/tournament/architecture.md` and find heading `### Requirements → Structure Mapping`; row reads `T1.1 CLAUDE.md disambig → root CLAUDE.md`
- Baseline (unchanged): `CLAUDE.md` at repo root

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Claude Opus 4.7, 1M context)

### Debug Log References

Verification output from `/remote-control` session 2026-04-19:

```
--- 2.1: heading uniqueness (expect 1) ---
1
--- 2.3: fixed-string presence ---
OK    apps/api
OK    apps/web
OK    apps/tournament-api
OK    apps/tournament-web
OK    without explicit approval
OK    FD-1
OK    FD-2
OK    _bmad-output/planning-artifacts/tournament/prd.md
--- 2.4: git diff shape ---
deletions (expect 0): 0
```

### Completion Notes List

- Appended a new `## Monorepo Disambiguation` section to `CLAUDE.md` at EOF, preceded by a `---` separator and blank line (matches the between-section pattern already used throughout the file).
- Section body is 3 bullets + a one-line citation, total 11 added lines. Zero pre-existing lines modified.
- All four mechanical verification subtasks (2.1–2.4) passed.
- No tests written or changed — story explicitly says `CLAUDE.md` is not read by code.
- Did not fork the `dev-story` workflow for this trivial markdown change; forking becomes worthwhile when later tournament stories introduce code + tests (T1.2+).
- **Post-review tightening (codex-review of implementation, finding #1 [medium]):** the third bullet originally read "without explicit approval" — codex flagged this as underspecified for an LLM guardrail (approver + form undefined). Tightened to "without explicit per-session approval from the user" to match the established idiom in the user-global `~/.claude/CLAUDE.md`. AC #1 and Subtask 2.3 updated to reference the new literal `without explicit per-session approval`. All 8 mechanical checks re-run and pass.

### File List

- `CLAUDE.md` (modified — single additive section appended)
