# T8-1 Party Opinion: Single Story vs. Split

**Question:** Ship T8-1 as a single ~22-file story (schema + emitter + ESLint + 14 call-site migrations bundled), or split into T8-1 (infra) + T8-1a (call-site migration)?

---

## 📊 Mary — Business Analyst

Trip-day timeline is the dominant risk. T8 is target-miss-tolerable; T9 is trip-critical. Every week T8 occupies, T9 doesn't move.

Single-story path: one codex cycle, one party review, one commit. Time-to-T9 is shorter even with a longer dev pass.

Split path: two cycles + two party reviews + two commits. Plus a coexistence-window decision artifact (legacy alias) that itself takes review time. The story COUNT goes from 1 → 2, but the unit of independent business value (a working activity spine the rest of T8 can build on) is the SAME.

**Splitting is process work, not product work.** It de-risks individual commits but adds calendar days. **Single de-risks trip-day.**

---

## 🏗️ Winston — Architect

A "two-emitter coexistence window" is a SMELL when the breaking change is documented and authorized. The T5-6 stub's docstring literally says "T8 replaces only the function body" — keeping a legacy alias contradicts that contract and creates a non-trivial-to-remove second writer.

That said: coexistence is a TOOL when the migration scope is genuinely uncertain. Here, it isn't. The 14 call sites are enumerated, the payload reshapes are mechanical, the par-lookup chain is verified, and the type system catches missed sites at compile time.

Cleaner intermediate state under SPLIT? Only superficially: the legacy alias would land as `emitActivityLegacy` or similar and live for one story. That's a flag-day artifact in the codebase that future readers would have to git-archaeology to understand. Single-commit-then-done is a cleaner architectural narrative.

**Single. The "coexistence" benefit is illusory here.**

---

## 📋 John — Product Manager

Engagement-surface user value (toasts, banner, feed) is unlocked by **the entire spine working end-to-end**, not by infra alone. T8-2 + T8-3 + T8-4 all depend on the activity table actually receiving rows from production code paths.

Under SPLIT: after T8-1 ships, the activity table exists but contains zero rows from real users. T8-1a is required before T8-2's polling endpoint has anything to return. So T8-1a is on the critical path to ANY user-visible value.

Under SINGLE: T8-1 ships and the spine immediately starts collecting rows from every score, press, finalize, and bet. T8-2 can be built against real data.

**No PM-side reason to split.** The user value materializes at the same moment under both paths (after call-site migration is done) — but SINGLE gets there in one cycle.

---

## 🧪 Quinn — QA Engineer

This is the only persona with a clear vote for SPLIT, and I'll be honest about why.

A 22-file commit with 14 call-site reshapes plus a new schema plus a new migration plus a new ESLint rule is a big blast radius. If something breaks subtly — say, the score.committed par lookup throws on a particular fixture — the bisect surface is the entire activity-spine landing. Splitting gives me TWO cleaner bisect points.

But: tournament-api has 875 passing tests, the existing call sites are integration-tested at the outer behavior level (status codes + DB writes), and the typed emitter signature catches drift at compile time. The actual regression risk is concentrated in scores.ts (par lookup is new behavior in the score-post path) — and that risk doesn't go down by splitting; it just gets moved to T8-1a.

**Mild lean SPLIT, but I'm outvoted by the timeline. SINGLE is acceptable if scores.ts gets explicit before/after regression-test attention.**

---

## 💻 Amelia — Developer Agent

Pain ratio favors SINGLE.

Two codex review cycles (~5 rounds each = ~10 rounds total) takes longer than one cycle of ~5 rounds even when the single cycle has more diff to review. The mechanical reshape of 14 call sites is grep-able; codex catches missed sites.

Split path adds: a coexistence-window code shape (legacy alias), a story spec for T8-1a, a sprint-status flip for it, two more commits, and the constant question "did I update the legacy or the new emitter?" while T8-1a is open.

Merge conflict risk: low either way (this is a solo branch).

**Ship single.**

---

## 🏃 Bob — Scrum Master

Story splitting discipline says: split when (a) independent business value lands at intermediate points, (b) the larger story crosses a planning boundary, or (c) the team can't fit it in a sprint window.

(a) doesn't apply here: as PM noted, no user-visible value lands at the T8-1-infra cut. (b) doesn't apply: same epic, same sprint, same direction. (c) is the only debatable lever, and a solo dev with a full codex review loop and no team coordination overhead doesn't have sprint-window pressure in the traditional sense.

Story-points-wise this is bigger than T7-7 was. But T7-7's success path validates the BMAD cycle handles 16-file stories cleanly. Going to 22 files is incremental, not categorical.

**Single — discipline doesn't compel a split here.**

---

## 🤝 Synthesis & Recommendation

**Verdict: SINGLE story.** 5 of 6 personas land on single; Quinn's mild lean toward split is overridden by the timeline argument and addressable via "give scores.ts explicit before/after regression-test attention" in the impl review.

**Concrete reasoning:**
1. The T5-6 stub's docstring authorized T8 as a coordinated breaking change. Splitting honors that intent at the cost of a coexistence-window artifact that the docstring explicitly didn't ask for.
2. PM/Architect agreement: no user value lands at the T8-1-infra cut. Splitting is process work, not product work.
3. Trip-day timeline: T8 is target-miss-tolerable, T9 is trip-critical. Calendar days saved by single matter.
4. Quinn's blast-radius concern is real but addressable via test discipline at impl review (specifically scores.ts), not architecture.

**One disagreement worth flagging:** Quinn's QA voice prefers two smaller commits for bisect clarity. The synthesis overrules but doesn't dismiss it — the impl-codex review for SINGLE should pay extra attention to scores.ts's par-lookup behavior in particular.

**Director: proceed to implementation as SINGLE. Approve the spec gate.**
