# Party-Mode Written Review — Story 2.4a: Strip Polie's Bogey-or-Better Gate

**Mode:** Single non-interactive written review (no open questions). Perspectives: Analyst, Architect, PM, QA, Dev.
**Subject:** F1 Epic 2 (inserted) — make polie a pure count, removing the gross gate (user-directed cleanup).
**Prior gate:** Dual-model impl review (codex gpt-5.2 + gemini-pro, high) → synthesis **SHIP**, `must_fix=None` (a backward-compat High raised by both, downgraded by both critiques to zero-impact + fail-closed-safe).

---

## 📊 Analyst (Mary)

This is the consolidation the user asked for: polie and sandie now share **one** money model — count the checked boxes. The user's FR16 insight (the scorer is the rule engine; the system must not silently void a human-entered claim) is now applied consistently. The only behavioral change is the **right** one: a polie by someone who scored worse than bogey now counts, because the group already decided it was a polie when they checked the box. The "bogey-or-better" wording lives on the Rules Sheet (2.7). No modeling gaps.

---

## 🏛️ Architect (Winston)

A **subtractive** story done cleanly. `poliePoints` is now byte-for-byte the same shape as `sandiePoints`; the registry's polie and sandie no-lever branches were **merged** into one (`(type === 'sandie' || type === 'polie')` → reject any non-empty variant), which is the correct deduplication now that both are lever-less. The `polieBogeyOrBetter` lever was removed everywhere it cascaded (type, Zod schema, registry, polie.ts, every test) — verified by a **grep gate** (`grep -r polieBogeyOrBetter src` = 0) baked into the regression.

**The standout decision:** keeping `HoleState.gross` + the games-money threading even though no shipped modifier now reads it. That's correct, not dead code — Story 2.5 (gross/natural birdie) consumes per-player gross, and the JSDoc was updated to say so. Reverting the threading would have been churn that 2.5 immediately undoes.

**Backward-compat (precise scope):** removing a config key from a `.strict()` Zod schema is a breaking change in principle. The impl review surfaced it (both families, High). The resolution is sound and evidence-based: a code-level data check (`git log -S polieBogeyOrBetter -- db/ routes/` = empty) proves no seed or route ever persisted the key, and F1 is flag-off with no real rounds. **The money-safety guarantee is universal but the failure MODE differs by where the stray key sits:** a persisted *polie* config carrying it fails **loudly** (polie now rejects ANY variant key → unsettleable, surfaced); a stray `polieBogeyOrBetter` on a *greenie/net-skins* config is **silently ignored** (those modifiers don't read it → settles as normal greenie/net-skins). Either way it **never mis-settles money** — the worst case is a loud unsettleable (polie) or a correct settlement that ignores an irrelevant key (greenie/net-skins). The greenie/net-skins unknown-key-loudness is the deferred-since-2.2 validator gap (logged). The definitive prod-DB scan is a pre-launch followup for Josh.

---

## 📋 PM (John)

This was a **user-initiated insert** (2.4a) honoring an explicit agreement, run through the full money-story cycle (golden + dual-model + manual gate). The spec gate clearly told Josh "this changes shipped polie money" and he approved. Scope held: engine-only, no service/schema/UI beyond the lever removal. Followups (prod-DB scan, release-note, the deferred unknown-key gap, 2.5 gross test) are logged, not lost.

---

## 🧪 QA (Quinn)

**The test-count drop (1354→1348) is the right kind.** Every removed test was a *gate* test (the gross-gate unit tests, the cross-modifier `polieBogeyOrBetter` rejections, two of the four games-money gate tests, the golden gate-contrast, the obsolete sandie test) — i.e., tests of a feature that no longer exists. **Zero failures.** Polie's count coverage is fully retained, and the behavior change is **newly and explicitly tested**: `polie-counts-regardless.json` (golden) + a "double-bogey-gross polie now counts" unit test + a count-only end-to-end service test prove the strip moves money the way it should. The grep gate guarantees no dangling reference. greenie/sandie/Epic-1 goldens stay byte-identical.

**One coverage note (logged):** the end-to-end *gross-threading* proof went away with the gate. Gemini correctly called this the right deletion (no shipped modifier uses gross now); the reminder for Story 2.5 to re-add a gross-consumption test is logged.

---

## 👷 Dev (James)

Surgical and idiomatic. The cascade was followed precisely (type → schema → registry → resolver → tests → fixtures), the `exactOptionalPropertyTypes` cast pattern reused, and the build is clean (typecheck + lint + grep gate). Merging the polie/sandie validation branch is a nice touch that prevents future drift.

---

## 🎯 Consolidated Verdict

**SHIP.** Meets AC1–AC9, polie is now a correct pure-count claim consistent with sandie, the money change is golden-proven and intentional, fail-closed safety is preserved (a legacy config can only fail loudly, never mis-settle), and the build is clean with a grep gate guaranteeing completeness. No blocking gaps. Followups (the pre-launch prod-DB scan especially) are logged for Josh. Recommend proceeding to commit (flag OFF, local only).

---

### Evidence (concrete artifacts backing every claim above)

- **Pure-count resolver:** `apps/tournament-api/src/engine/games/modifiers/polie.ts` (`poliePoints = #A − #B`, self-guard, no gross read — mirrors `sandie.ts`).
- **Merged no-lever fail-closed branch + removed cross-rejections:** `apps/tournament-api/src/engine/games/registry.ts`; lever removed from `types.ts` + `config-schema.ts`.
- **Behavior-change money proof:** `__fixtures__/polie-counts-regardless.json` ($5/side count-only vs the removed gated $10/side) + the "double-bogey polie now counts" unit test in `modifiers/polie.test.ts` + the count-only end-to-end test in `services/games-money.polie.test.ts`.
- **Grep gate + byte-identical regression:** `grep -r polieBogeyOrBetter apps/tournament-api/src` = 0; `pnpm --filter @tournament/api test` → 1348 passed / 0 failed; greenie/sandie/Epic-1 goldens unchanged; typecheck + lint clean.
- **Backward-compat evidence:** `git log -S polieBogeyOrBetter -- apps/tournament-api/src/db apps/tournament-api/src/routes` = empty (no seed/route ever persisted the key).
