---
description: Run the external Codex review tool against the current story work or a selected file set
argument-hint: [optional focus or paths]
---

Use the `mcp__codex_review__review_code` tool to run an external Codex review before
we consider implementation complete.

Workflow:

1. Identify the story, task, or bugfix we are validating right now.
2. If the user supplied file paths, use those as `paths`.
3. Otherwise let the MCP tool review the current git changes automatically.
4. Include the current acceptance criteria, risks, and anything the user is worried
   about in `review_request`.
5. Write the review report to `_bmad-output/reviews/codex-review-latest.md`.
6. Present findings first, ordered by severity. If there are no findings, say so
   explicitly.

Recommended tool arguments:

- `workspace_root`: current project root
- `review_request`: story goal + acceptance criteria + focus areas
- `paths`: optional narrowed file set
- `output_path`: `_bmad-output/reviews/codex-review-latest.md`
