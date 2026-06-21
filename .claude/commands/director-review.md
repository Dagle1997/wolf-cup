---
description: Run the full debate ensemble — Codex review + Gemini review in parallel, then cross-critique, then synthesis. Director-level consensus verdict on a single artifact.
argument-hint: [paths or focus area]
---

Use the codex_review + gemini_review MCP servers to run a five-step debate workflow on a single deliverable. This is the highest-effort review path — reserve it for CEO-facing reports, lender materials, irreversible commits, or anything where being wrong has real consequences.

## When to use this vs other review skills

- `/codex-review` — single second opinion. Fast. Default for normal work.
- `/gemini-review` — single third opinion from a different model family. Opt-in.
- `/director-review` — **full debate** — both reviewers + cross-critique + synthesis. Slowest, highest quality, ~$. Use sparingly.

## The five steps

Run sequentially with parallelism within each step. **DO NOT skip steps** — the value is in the debate, not in any single reviewer.

### Step 1: Parallel initial reviews

Fire both in a single message:

- `mcp__codex_review__review_code` — write to `_bmad-output/reviews/codex-review-{slug}.md`
- `mcp__gemini_review__review_code` — write to `_bmad-output/reviews/gemini-review-{slug}.md`

Both should use `reasoning_effort: "high"`. Pass identical `review_request` context to both.

### Step 2: Read both reviews

Read both review files. You need the full content to pass into the critique step.

### Step 3: Parallel cross-critique

Fire both in a single message:

- `mcp__codex_review__critique_review` — Codex critiques Gemini's findings. `prior_review` = full text of Gemini's review. `prior_reviewer` = "gemini-pro-latest". Output to `_bmad-output/reviews/codex-critique-of-gemini-{slug}.md`.
- `mcp__gemini_review__critique_review` — Gemini critiques Codex's findings. `prior_review` = full text of Codex's review. `prior_reviewer` = "gpt-5.2". Output to `_bmad-output/reviews/gemini-critique-of-codex-{slug}.md`.

Each reviewer will produce per-finding stances (agree / partial / disagree / theoretical / missing_evidence), plus any net-new findings the other missed, plus a SHIP/HOLD/ESCALATE verdict.

### Step 4: Read both critiques

You need them to pass into the synthesis step.

### Step 5: Synthesis

Run `mcp__codex_review__synthesize_reviews` with all four `prior_outputs`:

```
prior_outputs: [
  { source: "codex-review", content: <codex review text> },
  { source: "gemini-review", content: <gemini review text> },
  { source: "codex-critique-of-gemini", content: <codex critique text> },
  { source: "gemini-critique-of-codex", content: <gemini critique text> },
]
```

Output to `_bmad-output/reviews/synthesis-{slug}.md`. Synthesis produces:

- Unified verdict (SHIP / MINOR-FIXES / HOLD) with confidence level
- High-confidence findings (where reviewers agreed)
- Divergent findings (where they disagreed — must be resolved)
- Dismissed findings (theoretical or wrong)
- Prioritized action list ranked by must_fix_before_send / should_fix / optional
- Open questions

## Final report to user

After synthesis, present:

1. **Verdict** (SHIP / MINOR-FIXES / HOLD) and confidence
2. **The single most material issue** (1-2 sentences)
3. **Action list** ranked by priority
4. **File paths** to all 5 artifacts (2 reviews + 2 critiques + 1 synthesis)
5. **If MINOR-FIXES or HOLD**: offer to execute the patches and re-run a single combined review (not full debate again)

## Argument handling

- If `$ARGUMENTS` are file paths: pass as `paths` to all tool calls.
- If `$ARGUMENTS` is a focus area / question: include in the `review_request` context for all reviewers.
- If no arguments: review current git changes (`include_git_changes: true`).

## Recommended slug

Derive `{slug}` from the artifact being reviewed plus today's date, e.g. `freight-deep-dive-v2-5-2026-05-14`. Pass the slug into every `output_path` so files are correlated.

## Don't shortcut

- Don't skip cross-critique even if both initial reviews agree. The critique pass catches missed issues — it found 2 net-new mediums during the freight deep-dive workflow that the initial reviews missed.
- Don't skip synthesis even if the critiques converge on SHIP. The synthesis structures the action list which is what the user actually reads.
- Don't run debate on every iteration of a patch cycle. After SHIP, smaller patches only need `/codex-review` to confirm. Run full `/director-review` once on a stabilized version.
