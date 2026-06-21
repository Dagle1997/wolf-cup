# Gemini Review MCP

Sibling of `codex-review-mcp`. Gives Claude Code a `gemini_review` tool backed
by Google's Gemini API. Use when you want a third independent reviewer
(different model family from Claude/Codex) on high-stakes prose or code.

## What It Does

- Reviews the current working-tree changes or specific files/directories
- Pulls in a focused git diff when available
- Extracts text from `.pdf` files via PyMuPDF
- Writes a review report to `_bmad-output/reviews/gemini-review-latest.md` by default
- Returns a concise findings summary directly to Claude

## Setup

1. Get a free API key at https://aistudio.google.com/apikey
2. Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in the shell or app environment
   that launches Claude Code.

The free tier's rate limits cover infrequent opt-in reviews; if you start
hitting them, switch to a paid plan or drop to `gemini-2.5-flash`.

## Required Environment

`GEMINI_API_KEY` (preferred) or `GOOGLE_API_KEY`.

## Optional Overrides

- `GEMINI_REVIEW_MODEL` (default: `gemini-3-pro`)
- `GEMINI_REVIEW_REASONING_EFFORT` (default: `high`) — mapped to Gemini
  `thinkingBudget`: none=0, low=2048, medium=8192, high=16384, xhigh=32768
- `GEMINI_REVIEW_MAX_FILES` (default: `12`)
- `GEMINI_REVIEW_MAX_CHARS_PER_FILE` (default: `30000`)
- `GEMINI_REVIEW_PYTHON` — path to a Python interpreter with PyMuPDF installed.
  If unset, falls back to `CODEX_REVIEW_PYTHON`, then tries `db_toolkit/venv`
  and `db_toolkit/.venv` under the workspace root, then `python3`/`python` on PATH.

## Differences vs codex-review

- Different model family (Google Gemini vs OpenAI GPT) — useful as a third
  independent opinion. Catches issues each other model misses.
- No web-search grounding in this version. Gemini's `googleSearch` tool isn't
  compatible with strict structured output; if we need grounded reviews we'll
  add a separate non-structured mode.
- Output written to `_bmad-output/reviews/gemini-review-latest.md` so it
  doesn't clobber codex's report.

## Tools

This server exposes two tools.

### `review_code`

Primary first-pass review tool. Output defaults to
`_bmad-output/reviews/gemini-review-latest.md`.

### `critique_review` (debate mode)

Second-opinion / debate tool. Takes the prior reviewer's report and returns:

- **Per-finding stances**: `agree`, `partial`, `disagree`, `theoretical`,
  `missing_evidence` — each with reasoning.
- **Additional findings** Gemini catches that the prior reviewer missed.
- **Verdict**: `ship`, `hold`, or `escalate`.
- **Consensus recommendations**.

Output defaults to `_bmad-output/reviews/gemini-critique-latest.md`.

Required parameters: `review_request` and `prior_review`. See the
`codex-review-mcp` README for the typical debate flow.
