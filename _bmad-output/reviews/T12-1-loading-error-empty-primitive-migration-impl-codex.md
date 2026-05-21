# Codex Review

- Generated: 2026-05-21T20:05:19.938Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/routes/events.$eventId.money.tsx, apps/tournament-web/src/routes/events.$eventId.settle-up.tsx, apps/tournament-web/src/routes/events.$eventId.bets.tsx, apps/tournament-web/src/routes/events.$eventId.schedule.tsx, apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx, apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx, apps/tournament-web/src/routes/events.$eventId.index.tsx, apps/tournament-web/src/routes/events.$eventId.gallery.tsx, apps/tournament-web/src/routes/index.tsx, apps/tournament-web/src/routes/invite.$token.tsx, apps/tournament-web/src/routes/admin.event-rounds.$eventRoundId.sub-games.tsx, apps/tournament-web/src/routes/admin.events.$eventId.index.tsx, apps/tournament-web/src/routes/admin.events.$eventId.pairings.tsx, apps/tournament-web/src/routes/admin.groups.$groupId.edit.tsx, apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx, apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx

## Summary

Migration is largely consistent with the stated rules (routes-only changes; primitives untouched; most loading/error/empty branches now render via PageShell + LoadingCard/ErrorCard/EmptyState; score-entry only migrated its loading branch with data-testid preserved). Two concrete copy regressions are present, and one route violates the “PageShell title normalization” expectation by omitting a title in all state branches (and the main view).

Overall risk: medium

## Findings

1. [medium] Copy regression: Index error state drops “Refresh to retry.” sentence
   - File: apps/tournament-web/src/routes/index.tsx:113-123
   - Confidence: high
   - Why it matters: The migration notes say copy was preserved verbatim. Previously this branch explicitly told the user to refresh to retry; now the rendered message is only “Couldn't load your events.” (even though onRetry is wired). If product/tests rely on exact copy, this is a regression.
   - Suggested fix: Change the error prop to include the original full sentence (e.g., `error="Couldn't load your events. Refresh to retry."`), or set `title` + `error` such that the combined visible copy matches the previous text.

2. [low] Copy regression: Bets empty-state text/punctuation changed (em-dash removed, capitalization changed)
   - File: apps/tournament-web/src/routes/events.$eventId.bets.tsx:137-145
   - Confidence: high
   - Why it matters: The previous copy was a single sentence: “No bets yet — organizer can add via admin.” The migrated version splits into title/body and changes both punctuation and capitalization (“No bets yet” / “Organizer can add via admin.”). This violates the stated “copy preserved verbatim” rule and could be user-visible regression.
   - Suggested fix: If strict preservation is required, put the original sentence verbatim into a single field (e.g., `title="No bets yet — organizer can add via admin."` and omit body), or keep exact casing/punctuation across title/body.

3. [medium] Course preview route: PageShell state branches omit title (and loading/error no longer render the prior “Course” heading)
   - File: apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx:108-138
   - Confidence: high
   - Why it matters: In loading/error/forbidden branches, `PageShell` is rendered without a `title` (and the previous explicit `<h1>Course</h1>` in those states is gone). If `PageShell` is responsible for consistent page headings and/or document titles, this is a behavior/accessibility regression and also inconsistent with the migration rule to normalize via `PageShell title=...`.
   - Suggested fix: Pass a title in these branches (e.g., `<PageShell title="Course">`) so the loading/error/forbidden states preserve the prior page-level label and match the normalization rule. Optionally evaluate whether the main view should also set a PageShell title (even if it still renders its own `<h1>`).

## Strengths

- Allowlist honored: diff shows changes confined to `apps/tournament-web/src/routes/**`; no primitives/components were modified in the provided diff.
- Retry wiring looks correct where applied (e.g., event pages pass `onRetry={query.refetch}` in error states).
- EmptyState usage supplies required `title` everywhere it’s introduced in the provided files.
- Score-entry migration matches the stated constraint: only the loading branch changed and `data-testid="loading"` is preserved.

## Warnings

- Truncated file content for review: apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
