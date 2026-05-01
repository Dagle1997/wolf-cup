# Tournament Director — v5 Followup Backlog

**Date:** 2026-04-30
**Source:** Codex adversarial review of the v4 director's `auto_approve_clean_specs` opt-in feature. See `_bmad-output/reviews/auto-approve-clean-specs-codex.md` for the full report (gpt-5.2, high reasoning).
**Status:** backlog. Apply post-Pinehurst (after 2026-05-10) before re-considering whether to enable `auto_approve_clean_specs: true`.

---

## Why this exists

After shipping v4 and committing it (`21a5635`), codex was asked specifically whether enabling `auto_approve_clean_specs: true` was safe for the trip-week sprint. Codex returned 5 findings — 2 of which are real bugs in v4 (not just questions about the flag), and 3 of which are concrete gaps that need to close before auto-approve can be safely enabled.

Decision for trip-week: **flag stays off**, manual spec gate every story (~10 min/story overhead × 25 stories ≈ ~4 hours over 6 days, accepted as cheap insurance against a missed-spec architecture error landing unattended).

These findings are recorded here so a future session can apply them after the trip without re-deriving them from chat history.

---

## Findings (recommended order to apply)

### 1. Step 5b does NOT enforce "no drift outside declared file list" (HIGH — pre-flag-enable blocker)

**Where:** `tournament-director.md` step 5b (path classification gate after dev-story returns).

**Bug:** The auto-approve check at step 4 relies on the spec declaring an explicit `## Files this story will edit` list. The check classifies each declared path as ALLOWED. The director then claims (line 4 of step 4 auto-approve announcement) that "step 5b's pre-test classification gate will still catch any post-spec edits that drift outside the declared list."

This claim is false. Step 5b only classifies paths into ALLOWED / SHARED / FORBIDDEN buckets. It does NOT compare the actual diff against the spec's declared list. So if a spec declares `apps/tournament-api/src/routes/leaderboard.ts` and dev-story also writes `apps/tournament-api/src/routes/standings.ts` (both ALLOWED), step 5b passes — the silent scope creep goes undetected and lands in the commit.

**Concrete scenario:** spec for T5-5 declares two files. Codex auto-approves. Dev-story implements both, plus a third file under ALLOWED that wasn't in the spec (a new helper module). Step 5b classifies all three as ALLOWED, proceeds. Story commits with scope creep that bypassed human review.

**Fix:** Strengthen step 5b. After classifying paths into ALLOWED/SHARED/FORBIDDEN, additionally compare the diff's path set against the spec's declared `## Files this story will edit` list (when present and the auto-approve path was taken). For each diff path NOT in the declared list:

- Allowed exception classes (do NOT trigger STOP):
  - `_bmad-output/implementation-artifacts/tournament/{story-key}.md` — the story file itself, updated by dev-story workflow with progress notes
  - `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` — status flips
- Anything else NOT in the declared list → write gate marker `gate_type: "scope-drift"` and STOP. Question: `Director: dev-story modified paths not declared in the spec's "## Files this story will edit" list: {paths}. Approve as legitimate scope expansion, revert the undeclared edits, or abandon the story? [gate-id: ...]`

Add `scope-drift` to the gate_type enum in the Loop pause protocol.

This is the mechanism that makes auto-approve safe: the human doesn't review the spec, but the director catches any drift between what was declared and what was implemented.

**Mechanically fixable:** yes. Localized change to step 5b + gate_type enum + Failure modes section.

---

### 2. Auto-approve is not coupled to the freshness Reviewed-files signal (HIGH — pre-flag-enable blocker)

**Where:** `tournament-director.md` step 3 freshness check (decision matrix) interacting with step 4 auto-approve check.

**Bug:** The two-signal freshness check at step 3 says: if Reviewed-files PASS but mtime FAIL → log a note and proceed. If Reviewed-files FAIL but mtime PASS → log a note and proceed (with a caveat to "check the Findings section actually references your file before applying any auto-fix"). Only both-FAIL stops.

This is reasonable for the *human-gated* path: if Reviewed-files mismatches, the user reading the spec gate question can spot it and reject. But for the *auto-approve path* at step 4, it's unsafe — auto-approve fires before the human sees anything, so there is no human eyeball to catch a Reviewed-files mismatch.

The result: auto-approve can fire on a codex report that doesn't pertain to this spec (e.g., a stale cached report for a different story, or an MCP scope key bug that wrote findings against the wrong path). The PASS verdict in the report would be honored as if it applied to this spec.

**Concrete scenario:** /loop iteration writes spec for T5-7. Codex MCP has a transient bug that writes its report against T5-5's path instead. Reviewed-files header says T5-5; mtime is fresh; report shows PASS. Step 3 logs the Reviewed-files mismatch and proceeds. Step 4 sees PASS + 0 H/M + parseable file list → auto-approves. The director just shipped T5-7 based on a codex review of T5-5.

**Fix:** Add a hard precondition to the auto-approve check at step 4. Auto-approve fires ONLY IF:

- Codex returned PASS with zero High AND zero Medium (existing requirement).
- AND Reviewed-files signal was PASS (i.e., the report's "Reviewed files" header explicitly contained the spec path passed in `paths`). Reviewed-files FAIL — even if mtime passed and the cycle proceeded with a logged note — disqualifies auto-approve and falls back to the manual gate.
- AND mtime signal was PASS (reinforces the "fresh AND right" guarantee for unattended cases).
- AND no fixes were applied at step 3 (existing FIXED-N rule).
- AND machine-checkable file list parses cleanly into ALLOWED-only paths (existing requirement).

Document this as: "the auto-approve path is strictly tighter than the human-gated path — any soft-pass condition that the human path would log-and-proceed becomes a hard fall-back-to-manual condition for auto-approve."

**Mechanically fixable:** yes. Add one bullet to the step 4 auto-approve check; document the strict-vs-soft asymmetry.

---

### 3. "No globs" rule conflicts with generated-file patterns (MEDIUM)

**Where:** `tournament-director.md` step 4 auto-approve check, criterion 2.

**Bug:** The "machine-checkable file list" rule says each entry must be "a single repo-relative path on its own line, optionally prefixed with `- `. Free-form prose is NOT acceptable; 'or equivalent' is NOT acceptable." Globs are explicitly rejected.

But many real tournament stories will create files whose path is generated at create-time. Migration files are the canonical example: drizzle generates `apps/tournament-api/drizzle/0028_some_descriptive_name.sql` where the leading number is determined when the migration runs, and the descriptive suffix may be chosen at the spec-author's discretion. The spec author cannot write a literal path; they write something like `apps/tournament-api/drizzle/00XX_*.sql`.

Result: any story that adds a migration falls back to the manual gate. That's most of T5/T6 (lots of schema work coming).

**Fix:** Allow a narrow set of glob patterns inside the declared list:

- `*` is allowed within a single path segment (e.g., `apps/tournament-api/drizzle/0XXX_*.sql` matches `0028_score_correction.sql`).
- `**` is NOT allowed (too broad; defeats the purpose).
- Brace expansion `{a,b}` is NOT allowed (too cute).
- A glob entry counts toward the auto-approve check only if every path the dev-story actually modifies that matches the glob ALSO classifies into ALLOWED.

Update the parser to split the declared list into "literal paths" and "narrow globs." Diff paths must match either a literal path or a narrow glob; any diff path matching neither triggers the new `scope-drift` gate from finding #1.

**Mechanically fixable:** yes, but mechanical with care — needs a small, stated grammar.

---

### 4. Create-story template doesn't emit the required section (MEDIUM)

**Where:** `_bmad/bmm/workflows/4-implementation/create-story/template.md` (currently shared between Wolf Cup and Tournament).

**Bug:** Auto-approve at step 4 requires a `## Files this story will edit` section in the spec. The template does not emit this section. There's a `### File List` under Dev Agent Record, but that's populated *post-implementation* by dev-story, not at create-story time.

Result: every spec created via the tournament fork falls back to the manual gate. Auto-approve is dead-code without a template change.

**Fix:** Two options:

- **Option A (preferred):** Fork the template into `_bmad/bmm/workflows/4-implementation/create-story/template-tournament.md` and reference it from `workflow-tournament.yaml`. Add the `## Files this story will edit` section to the tournament fork only, leaving Wolf Cup's spec template untouched.
- **Option B:** Edit the shared template in place to add the section (it would just sit empty for Wolf Cup specs since Wolf Cup's director doesn't have the auto-approve feature). Smaller change but couples Tournament's gate logic into Wolf Cup's spec template.

A is cleaner; B is faster.

For either option, the section should sit immediately after `## Acceptance Criteria` so it's visible during spec review. Required content rule: one repo-relative path per line, optionally prefixed with `- `, no commentary mixed in. Allow narrow globs per finding #3.

**Mechanically fixable:** yes for B, moderately mechanical for A (needs workflow-tournament.yaml updated to point at the fork).

---

### 5. Inconsistent mtime drift threshold (LOW)

**Where:** `tournament-director.md` step 3 freshness check vs. Failure modes section.

**Bug:** The freshness check at step 3 was widened to 10-minute window during v4 codex pass 1. Other places in the document (e.g., the Failure modes section's reference to "5min" or to the original v4 backlog's "5 minutes" framing) may still reference 5 minutes.

**Fix:** Audit the file for any "5 min" references in mtime-drift context and unify to 10 min. Cosmetic.

**Mechanically fixable:** yes. Drive-by fix.

---

## Pre-flag-enable checklist

Do NOT enable `auto_approve_clean_specs: true` until findings #1, #2, #3, and #4 are all closed. Finding #5 is cosmetic and not blocking.

After applying:

1. Codex-review the patched director with the prompt: "Verify v5 findings #1–#4 are resolved. Specifically: does step 5b now compare diff paths against the spec's declared list and STOP on undeclared paths? Is auto-approve now strictly tighter than the human-gated path on Reviewed-files mismatch? Does the glob grammar parse correctly? Does the tournament template emit `## Files this story will edit`?"
2. Test the auto-approve path on a small representative story (a docs-only or pure-test story is ideal) before enabling for trip-critical work.
3. Flip `auto_approve_clean_specs: true` only after the test story shipped clean.

---

## Notes for cross-reference

The v10-director (`D:/Claude/2026/.claude/commands/v10-director.md`) does not have an auto-approve feature, so these findings do not back-port. The v4 backlog at `_bmad-output/reviews/tournament-director-v4-improvements-2026-04-29.md` is the prior-generation analog — it covered the orchestrator-pattern bugs, not the auto-approve specific safety holes.

The codex review report this doc was distilled from is at `_bmad-output/reviews/auto-approve-clean-specs-codex.md`.
