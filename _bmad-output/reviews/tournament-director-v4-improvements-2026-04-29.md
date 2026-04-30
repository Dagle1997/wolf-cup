# Tournament Director — v4 Improvement Backlog

**Date:** 2026-04-29
**Source:** Findings transferred from the codex-review pass on the v10-director (D:/Claude/2026/.claude/commands/v10-director.md), which was modeled on tournament-director v3. Several class-of-bug issues found in v10-director also exist in tournament-director.
**Companion artifact:** `D:/Claude/2026/_bmad-output/reviews/v10-director-design-codex.md` — the original codex review whose findings are transferred here.
**Status:** backlog. Not applied to tournament-director yet. Apply during the next tournament work session, or when one of these bugs actually bites.

---

## Why this exists

The v10-director (Richwood competitive briefing orchestrator) was modeled on tournament-director v3 because the gate / codex-review / loop-pause shape is the same. When v10-director was codex-reviewed before first run, four of the findings were not v10-specific — they describe bugs in the underlying orchestrator pattern, and tournament-director has them too.

These haven't bitten yet on tournament-director because the loop hasn't run enough iterations to hit the failure modes. They will eventually. Cheap to fix when the file is open for other reasons; expensive to debug from a corrupted gate state mid-loop.

---

## Findings (transferable from v10-director codex review)

### 1. Status/commit ordering bug (HIGH)

**Where:** `tournament-director.md` step 10 (commit) and step 11 (flip status to `done`).

**Bug:** Step 11 flips `sprint-status.yaml` from `review` to `done` _after_ step 10's commit lands. The status flip is a separate write. If the process crashes, /loop drops, or the user interrupts between step 10 and step 11, the story is committed but stuck at `review` indefinitely. The next /loop iteration's orient step sees a `review` status and (per the in-flight rule) does not start a new story — it asks the user to resume. The user has no easy way to know "the commit landed, just flip the status" vs. "the commit didn't land, redo it."

**Concrete scenario:** the loop crashes between `git commit` returning sha `abc1234` and the `sprint-status.yaml` write. On resume, sprint-status says story is `review`; git log shows `abc1234` already committed; the director can't tell which side of the boundary it crashed on.

**Fix:** Atomic with the commit, not after it. Two options:

- **Option A (preferred):** Fold the `done` status flip into step 10. Order: stage `sprint-status.yaml` with status=done as part of the commit; commit; capture sha; (optional) follow-on amend-free commit to record `commit_sha` field in sprint-status.yaml. This is what v10-director step 9 does.
- **Option B:** Leave step 11 as a separate commit but make the resume rule "if the previous commit's diff includes the story's source file but sprint-status status is still `review`, infer the commit landed and the status flip is the only remaining work — flip it without re-running anything else." More fragile; depends on diff inspection.

**Mechanically fixable:** yes. Self-contained rewrite of step 10/11.

---

### 2. Gate marker `director_message_id` not anchored in conversation text (HIGH)

**Where:** `tournament-director.md` "Loop pause protocol" — gate marker file, "Procedure at the start of every invocation."

**Bug:** The marker JSON stores `director_message_id` (a "short identifier unique to this gate-writing turn") but nothing in the user-visible conversation pins to that ID. Step 0 says "scan the conversation for a user message that appears AFTER the assistant turn that wrote this marker" — there is no machine-checkable way to identify which assistant turn wrote the marker. The director relies on whatever it can infer from message content (e.g., the gate question wording), which is brittle:

- If the question wording shifts between iterations (e.g., user reruns a similar gate manually), the wrong turn matches.
- If the assistant said the gate question in two messages (e.g., reply + clarification), the anchor is ambiguous.
- If conversation context is compacted, the gate-write turn might be summarized away while the marker file persists.

**Concrete scenario:** /loop iteration 1 writes a marker with `director_message_id: "abc123"`. The user replies "hold on, let me check." Iteration 2 reads the marker, scans for "the gate-write turn," can't find a deterministic anchor, falls back to "look for any assistant message containing the gate question wording" — but iteration 1's message contained two questions, both copied verbatim from the gate. Director picks the wrong anchor and treats a non-resolution reply as resolving.

**Fix:** Embed the gate-id literally in the user-facing question text, so step 0 can grep the conversation for that exact substring. Concretely:

1. At gate-write time, generate a token (8 hex chars from system entropy).
2. Set `director_message_id: "{story-key}-{phase-tag}-{token}"` where `phase-tag` ∈ {`spec`, `party-clarif`, `shared`, `codex-high`, `epic`, `in-flight`}.
3. The user-facing message MUST include the literal substring `[gate-id: {director_message_id}]` in the question — typically at the end. Example:
   > "Spec for T1-3 approved? Codex: PASS. Proceed to implementation? `[gate-id: T1-3-spec-a3f9b211]`"
4. Step 0's resume procedure: read the marker, extract `director_message_id`, search the conversation for the literal string `[gate-id: T1-3-spec-a3f9b211]`. The most recent assistant message containing that substring is the gate-write turn (deterministic anchor). Then evaluate user messages after that turn.

**Failure mode handled:** if no assistant message contains the substring, the marker is "orphaned" — STOP with a manual-recovery message instead of guessing.

**Mechanically fixable:** yes. Edits are localized to the Loop pause protocol section + each STOP gate's user-message format (steps 4, 7, 9 in tournament-director).

---

### 3. Missing gate_type entries for codex/MCP failures (MEDIUM)

**Where:** `tournament-director.md` Loop pause protocol — gate marker file `gate_type` enum.

**Bug:** Current enum: `spec | party-clarification | shared-approval | codex-high-user-decision | epic | in-flight-resume`. The Failure modes section lists "Codex MCP unavailable or times out → retry once. If still failing, STOP." and "Codex output file is stale or missing → STOP (freshness check failed)." Both say STOP but neither writes a gate marker. Under /loop, "STOP" without a marker means the next iteration's step 0 finds no marker, runs step 1 fresh, and re-hits the same MCP/staleness failure. The loop spins on the failure with no persisted pause state and no easy way to give the user a single resolvable question.

**Concrete scenario:** codex MCP server is restarting (60-second cold start). Director hits step 3, retries once (still failing), STOPs without a marker. /loop next iteration: step 0 sees no marker, advances to step 1, picks the same story, hits step 3, MCP still cold, retries (still failing), STOPs. Repeats every iteration interval until the user manually intervenes.

**Fix:**

- Add to gate_type enum: `mcp-failure`, `codex-stale`.
- Update the Failure modes section to require writing a gate marker on these failures: "On MCP failure after retry: write gate marker `gate_type: 'mcp-failure'`, question: `Codex MCP appears unavailable. Retry now, skip this story, or stop the loop?`" (similar for codex-stale).
- Step 0 reads the marker on next iteration and idles instead of re-attempting the failed action.

**Mechanically fixable:** yes. Self-contained additions.

---

### 4. Codex freshness check brittle on header-date matching (MEDIUM)

**Where:** `tournament-director.md` step 3 freshness check ("its header timestamp should match today's date and the MCP call's return payload").

**Bug:** The check matches "today's date" against a date string in the codex report header. Timezone offset between system clock and report-generation timestamp, format variance (`2026-04-29` vs `Apr 29 2026`), or DST boundary crossings can cause false negatives — the report is fresh but the date strings don't match, so the director treats it as stale and STOPs.

**Concrete scenario:** Run the loop at 23:55 ET on 2026-04-29. Codex MCP runs in UTC and stamps the report `2026-04-30`. Director's "today" is 2026-04-29. Strings don't match → STOP "treat as MCP failure" → wrong inference; the report is fresh.

**Fix:** Use file mtime instead of header date. After the MCP call returns, check that the file at `output_path` has an mtime within the last few minutes (e.g., 5 min) of the call returning. Optional secondary check: confirm the report's "Reviewed files" list actually contains the path you requested. Drop the header-date match.

**Mechanically fixable:** yes.

---

## Findings noticed while reviewing tournament-director directly (not from v10 codex)

### 5. Path classification enforcement is commit-time-only (MEDIUM)

**Where:** `tournament-director.md` "Path allowlist" + step 5 (Implement) + step 10 (commit).

**Bug:** The verification step at the top says "classify every intended edit before making it." Step 5 says "every file edit must classify into ALLOWED. Any SHARED file edit requires pausing for user approval BEFORE making the edit." But the actual enforcement is the pre-commit classification gate at step 10. There's no mechanism that prevents step 5 from quietly editing a SHARED or FORBIDDEN path and only catching it at commit time. By then, the wrong-tree changes are real and may need manual revert.

**Concrete scenario:** During step 5 dev-story implementation, the director edits `pnpm-lock.yaml` (SHARED) because a transitive dep changed. Step 10 catches it at commit time and HARD STOPs for approval — but the file is already modified, and "revert the change" means losing whatever the dev-story workflow did, possibly invalidating the commit's other changes.

**Fix:** Two options:

- **Option A:** Wrap the dev-story workflow's file-write capability in a path-classifier that announces and STOPs _before_ an edit lands on a non-ALLOWED path. Heavier — requires intercepting all writes.
- **Option B:** After step 5 returns, before step 6 (regression tests), run a pre-flight classification pass on the working tree's diff and HARD STOP if any SHARED/FORBIDDEN changes exist. Lighter; catches the bug just after it lands rather than just before, but still before tests/codex run on tainted state.

Option B is the cheaper retrofit.

**Mechanically fixable:** yes (option B at least).

---

### 6. Story-key uniqueness not asserted (LOW)

**Where:** `tournament-director.md` step 1 Orient — "scanning stories within the current epic in file order (top to bottom)."

**Bug:** If `sprint-status.yaml` accidentally contains two entries with the same story-key (manual edit error, merge conflict not fully resolved), the director picks "the first one found in file order" without noting the duplicate. The two entries can have different statuses; the director silently uses one and ignores the other.

**Fix:** At orient time, after parsing sprint-status.yaml, assert all story-keys within the active epic are unique. If duplicate detected, STOP with a schema-violation message.

**Mechanically fixable:** yes (one-line assertion + clear error message).

---

### 7. Mixed porcelain v1 / -z mode descriptions (LOW)

**Where:** `tournament-director.md` step 10 staging/parsing rules.

**Bug:** The doc recommends `git status --porcelain=v1 -z` (NUL separators, no quoting) and then describes "Rename lines in porcelain v1 appear as `R  old -> new`; in `-z` mode the old and new paths are on separate NUL-terminated records." Both formats are described correctly, but a reader can ambiguate which one applies because the example status codes (`R `, `D `, etc.) are quoted from the v1 default format and the actual recommendation is `-z`. A future contributor implementing the parser could mix the two.

**Fix:** Pick one mode and stick with it for all examples. If the recommendation is `-z`, drop the v1 rename example or move it to a "if you must use the default format" footnote.

**Mechanically fixable:** yes; cosmetic.

---

## Recommended order to apply

1. **#2 (gate-id anchoring)** — highest leverage. Until this is fixed, every gate has a small chance of misresuming on a misread reply. Cheap to apply (Loop pause protocol + each STOP step's question wording).
2. **#1 (status/commit ordering)** — fix when next opening tournament-director for any reason. Self-contained rewrite of step 10/11.
3. **#3 (missing gate_types) + #4 (mtime freshness)** — pair them; both touch the codex-handling sections. Apply together.
4. **#5 (commit-time-only enforcement)** — retrofit option B (post-step-5 classification pass). Apply when the bug actually bites or as part of a v4 refactor.
5. **#6, #7** — drive-by fixes the next time anyone touches the relevant sections.

---

## Test before declaring v4 done

After applying #1–#4:

1. Manually simulate the resume scenarios:
   - Crash between commit and status-flip — verify resume detects committed-but-status-stuck and recovers.
   - Crash mid-codex-MCP — verify resume detects mcp-failure marker and idles instead of re-attempting.
   - User replies to gate A while gate B has been written in same session — verify gate-id anchor disambiguates.
2. Run one full /loop iteration on a small backlog story end-to-end and confirm no regressions vs. v3 behavior.
3. Codex-review v4 with the prompt: "did the v4 fixes preserve every gate that v3 had, and did any of the fixes introduce a new STOP path that doesn't write a marker?"

---

## Notes for v10-director cross-reference

The v10-director has all four of #1–#4 fixed in its initial draft (it never shipped with the bugs because the codex review caught them pre-flight). Tournament-director's working state is the canonical source — these fixes here are the recommended back-port path, not a different design.

If you do apply these to tournament-director, the v10-director command file is the reference implementation for #1, #2, #3, and #4. See `D:/Claude/2026/.claude/commands/v10-director.md` step 9 (status/commit ordering), Loop pause protocol section (gate-id anchoring + expanded gate_type enum), and step 4 freshness check (mtime-based).
