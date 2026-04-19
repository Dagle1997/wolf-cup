# Codex Review MCP

This versioned MCP server gives Claude Code a `codex_review` tool backed by
the OpenAI Responses API.

## What It Does

- Reviews the current working-tree changes or specific files/directories
- Pulls in a focused git diff when available
- Writes a review report to `_bmad-output/reviews/codex-review-latest.md` by default
- Returns a concise findings summary directly to Claude

## Required Environment

Set `OPENAI_API_KEY` in the shell or app environment that launches Claude Code.

Optional overrides:

- `CODEX_REVIEW_MODEL` (default: `gpt-5.2`)
- `CODEX_REVIEW_REASONING_EFFORT` (default: `high`)
- `CODEX_REVIEW_MAX_FILES` (default: `12`)
- `CODEX_REVIEW_MAX_CHARS_PER_FILE` (default: `30000`)
