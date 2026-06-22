# Epic 1 Retrospective — F1 "The Rule-Set Spine"

Date: 2026-06-21 · Stories: 1.1–1.4 (all done + committed, local/unpushed) · Process: Tournament Director, dual-model (codex gpt-5.2 + gemini-pro-latest) ensemble + subagent-delegated implementation.

## 1. Outcome

Epic 1 shipped the complete F1 money spine end-to-end on the base 2v2 Guyan game:
- **1.1** (`aae0f89`) pure engine (3 team points + net-skins) with hand-approved golden fixtures + fast-check property tests.
- **1.2** (`c016837`) additive `game_config` + immutable round-pin schema + Zod validator.
- **1.3** (`88f7948`) Standard Guyan seed + cascade-resolver endpoint + preset-first setup UI (killed the dead card).
- **1.4** (`4a07311`) the `games-money.ts` settlement chokepoint — recompute-on-read from the pin into the real pairwise settle-up, dual-read switch, leaderboard money mode, fail-closed, server-side audience-bounding — dark-launched behind `TOURNAMENT_F1_MONEY_ENABLED` (OFF).

Success criteria met: golden-gated math, additive-only migration, zero legacy regression (45 legacy money/leaderboard/handicap tests unchanged), real money settles on hand-proven math.

## 2. What the dual-model ensemble caught (the headline value)

The review ensemble's value concentrated, hard, on **money-critical + security** code — and the bugs it caught were overwhelmingly ones the implementation's own *happy-path* tests passed over:

- **1.1:** the net-birdie money model was wrong three times until grounded in Wolf Cup's canonical `bonuses.ts`/`money.ts` (Josh's pointer turned hand-waving into a proven 3-point model). Golden-first caught it at the *fixture* stage, not in code.
- **1.2:** 3 schema-ambiguity Highs (column-vs-JSON source of truth, HI+CH storage shape, round_pin keying).
- **1.3:** a **cross-event config leak** (both models, independently), a preset-seed concurrency race, and fail-closed gaps.
- **1.4 (the big one):** the spec review caught a **CRITICAL unsafe ship-split** (would double-count money + leak dollars) and a **pinned-CH-vs-live-GHIN contradiction** — before any code. The impl review then caught **2 CRITICAL + 4 HIGH money-safety bugs** the subagent's happy-path tests missed: live-handicap fallback on a missing pin, an event-wide crash on one throwing foursome, missing-handicap silently settling as scratch, un-tenant-scoped pin reads, a `/foursome-results` dollar leak, and a reader-path 500 on a corrupt pin.

**Signal/noise:** the second model (gemini) most often **confirmed** codex's criticals (convergence) rather than diverging — so the ensemble was high-signal. Material disagreement was rare; the value was the *union* of findings + the confidence of two independent model families agreeing on a critical.

## 3. Process lessons (what worked)

- **Golden-first (NFR-C1) is the single highest-leverage discipline.** Hand-approving the money model before writing the engine (1.1) meant the model churned 3× at the cheap stage (spec/fixtures) instead of the expensive one (code + settled data).
- **Subagent-delegated implementation** (1.3, 1.4) isolated large builds' context cost and kept the orchestrator's context for review + commit. It scaled to a 17-file api+web story and a money-critical integration.
- **The dual-model director-skill upgrade paid for itself immediately** (caught the cross-event leak on the very next story).
- **Dark-launch flag** (`TOURNAMENT_F1_MONEY_ENABLED`) let the heaviest money code merge safely with nothing exposed.

## 4. Process lessons (what to tune for Epic 2+)

- **NEVER delegate the money-safety review.** The recurring miss: subagents wrote correct happy-path code + happy-path tests, but the *fail-closed/edge* paths (missing pin, missing handicap, corrupt data, concurrent writes, cross-tenant) were where the CRITICAL/HIGH bugs lived. The impl ensemble was the net every time. **Front-load explicit fail-closed/edge-case tests into the spec's Task list** so the implementation agent writes them up front, not after the review catches the gap.
- **Spec reviews on money stories must be adversarial about ship-order.** The 1.4 "split it for size" instinct was a CRITICAL trap (the hardening *was* the safety). For money work, the safe-minimum unit, not the happy-path unit, is the boundary.
- **Verify the negative case** (claim discipline): the "hard-coded tenant" HIGH was a false-positive on severity — confirmed it matched the shipped pattern. Cheap to check, prevented a needless change.

## 5. Open items / risks carried into Epic 2

- **Nothing is pushed** (all local commits). Consider pushing/deploying Epic 1 + flipping the flag (or keeping it dark) before Epic 2 — Josh's call.
- **Non-blocking followup:** the F1 leaderboard *gross* total / throughHole don't filter holes-in-play (the *net* does) — a 9-hole gross-display skew, not a money bug. Fold into Epic 2 or a quick fix.
- **Epics 2–6 are not yet registered** in the tracker (Epic 1 was registered alone). Epic 2 (claims + birdie variants + cap + template picker) introduces **gross-dependent** logic (2.5) and the **cap** (2.6) — both money-bearing — and the **Wolf-Cup cross-validation golden** (2.8). Carry golden-first (one modifier = one resolver = one golden = one story).
- **H1b handicap-allowance %** (relative-to-low allocation) remains an open config knob if the group wants it (per Josh's "change the low handicap → recalc" note — works pre-pin; a correction post-pin).
