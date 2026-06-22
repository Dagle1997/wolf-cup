# HANDOFF — F1 Epic 2 (Claim Modifiers) — session 2026-06-22

**To resume:** start a fresh session, `/clear`, then `/loop /tournament-director`. The director will orient (clean tree), pick the next backlog story **2-5-birdie-modifier**, and run it — pausing at its spec gate (money story) for your approval.

---

## What shipped this session (all LOCAL commits, NOTHING pushed — `master` is ahead 24)

| Commit | Story | What |
|--------|-------|------|
| `0d24a10` | **2-2 greenie** | Stateful carryover modifier (par-3 count + carry pot; winner sweeps). First stateful + money-bearing Epic-2 modifier. Dense-holes barrier in `games-money.ts`. |
| `ee67008` | **2-3 polie** | Stateless count modifier with a (then) bogey-or-better GROSS gate. Threaded `HoleState.gross` + populated it in `games-money.ts`. |
| `ecc2732` | **2-4 sandie** | Pure-count claim, NO gate. Reworked mid-flight from the epics' gated draft per your FR16 call. |
| `0ac0fc3` | **2-4a polie-strip** | Removed polie's bogey-or-better gate → polie is now pure count, identical to sandie (your agreed cleanup). Changed shipped polie money (a worse-than-bogey polie now counts). |
| `c0745e7` | reference/ | Your WIP Pete Dye marketing PDF/HTML snapshot (committed for a clean tree; unrelated to F1). |

(`2-1` claims-capture `7383b1a`, `2-1a` whole-dollar 1-to-1 edges `3663d67`, and the `2-2` spec `42a6119` predate this session.)

**Test posture:** `@tournament/api` 1348 passing / 0 failures; `pnpm -r typecheck` + lint clean. The lone known flake is the documented T10-2/T10-3 lifecycle-e2e load flake (passes in isolation; unrelated).

## THE KEY DECISION YOU MADE THIS SESSION (drives everything below)

**FR16 — claims are "just count the boxes."** The system does NOT validate claim eligibility. The scorer is the rule engine: they don't check "polie/sandie/greenie" unless the player earned it under the group's rule. So **greenie / polie / sandie are pure COUNT modifiers** (`rawA = #teamA boxes − #teamB boxes`, each a ±1/player team point). The "must be bogey-or-better / par-or-better / up-and-down" rules are **Rules-Sheet documentation + setup pills (Story 2.7)**, NOT engine gates. (Greenie keeps its one real lever — carryover on/off — because that genuinely changes money across holes.)

- Polie's original gross gate (2-3) was stripped (2-4a) for this reason. Sandie never had one (2-4).
- **`HoleState.gross` + the `games-money.ts` gross threading are KEPT** (no modifier reads gross today, but **Story 2.5 gross/natural birdie needs per-player gross** — do NOT revert the threading).

## Epic-2 remaining (in file order — director picks top backlog)

- **2-5-birdie-modifier-generalized-net-gross-single-double** ← NEXT. Generalize the shipped `net-birdie` modifier IN PLACE (keep the `net-skins` type string; add `variant.basis: net|gross` + `variant.bonus: single|double`). NFR: **config_version BUMP** (changes net-birdie semantics) with a backward-compat default (absent/pre-2.5 → `{net, single}`, the Epic-1 behavior, NOT tripped by the too-new-version fail-closed). Re-run the Epic-1 base golden UNCHANGED + assert byte-identical (a refactor that can silently move money). Home the plus-handicap adversarial. **This story re-consumes `HoleState.gross` (basis:gross = natural-vs-par) — re-add an end-to-end gross-threading test (the polie one was removed with its gate).**
- 2-6-payout-cap ("345") + cap-never-exceeds property.
- 2-7-rules-page template picker + live pills + save preset → **this is where the on/off pills + the "bogey-or-better / up-and-down / etc." Rules-Sheet text live** (the home for everything we deferred from the claim modifiers).
- 2-8-comparison-harness + Wolf-Cup cross-validation golden.

## Outstanding followups (prioritized)

1. **🔴 HIGH — "net off the low" base-money model (pre-F1-launch).** The shipped engine computes net off each player's **FULL** USGA course handicap (`engine/handicap-strokes.ts`), NOT "off the low man" as your group plays. Affects the base **skin gate** + **net-skins levels** (absolute net-vs-par thresholds); low-ball/team-total are mostly comparison-invariant. NO real money mis-settled yet (F1 flag OFF). **Needs a dedicated investigation + likely a config option (full-CH vs off-the-low) before F1 settles real money.** Polie/sandie/greenie counts are unaffected (claims = checkbox; no net dependence). Logged in `2-3-polie-modifier.md` + `2-4-sandie-...md` followups.
2. **should_fix — prod-DB scan for `polieBogeyOrBetter`** (2-4a backward-compat). Code-level check proved no seed/route ever persisted the key (`git log -S polieBogeyOrBetter -- db/ routes/` = empty), but only the prod DB is authoritative. Before F1 launch, scan `game_config`/`round_pin` JSON; if any exist, a tiny migration strips the key. Expected: zero.
3. **deferred general-engine (since 2.2) — unknown-key-on-greenie/net-skins.** `validateResolvedConfig` doesn't loudly reject an unknown variant key on greenie/net-skins (they ignore it → still correct money; Zod `.strict()` rejects at write). polie/sandie already reject any key. A future hardening pass could add a generic unknown-key reject to greenie/net-skins.
4. **1v1 "Action" bets whole-dollar stakes** (logged earlier; separate track).

## Coordination state

- `.director-config.json` = `{ auto_approve_clean_specs: true }`. NOTE: every money/golden story (2-5, 2-6, 2-8) carries a "Spec-gate note" that DISABLES auto-approve (golden values need your NFR-C1 sign-off), so they still gate manually. 2-7 (UI, no golden) may auto-approve if both reviewers are clean.
- No pending gate marker. Tree clean.
- **Per-cycle rhythm:** each money story pauses at its **spec gate** for your golden ratification, then runs implement → mandatory impl debate (codex+gemini synthesis) → party review → atomic commit (status=done). Gemini's MCP was intermittently flaky this session (retries usually recover).

## Hard reminders for the next session

- **Local commits only — never push.** (You're ahead 24; pushing is your call.)
- Tournament paths only (`apps/tournament-api/**`); FD-1/FD-2 — never touch Wolf Cup (`apps/api`, `apps/web`, `packages/engine`).
- NFR-C1: golden hand-calc authored + your-approved BEFORE resolver code, every money story.
- 2-5 is a refactor-in-place of `net-skins` (the birdie point) — the Epic-1 base golden MUST stay byte-identical.
