# T12-3 Scroll-Region Accessibility — Party-Mode Review

**Mode:** non-interactive written review (no open questions to the user).
**Story:** T12-3-scroll-region-accessibility
**Change under review:** `ScrollableTable` primitive + `.scroll-region:focus-visible` rule in `index.css` + migration of 8 wrappers across 7 routes + 4 unit tests.
**Status entering review:** tests green (tournament-web 329, engine 472, wolf-cup-api 517, tournament-api 965+2 skip), typecheck + lint clean, impl codex PASS (0 findings).

---

## 📊 Mary — Business Analyst

The story traces cleanly to a real, evidenced need: T12-2's own Dev Agent Record (lines 109–110) named these two gaps as deferred followups. Requirements are precise and bounded — accessible name + focus ring on exactly the 8 focusable scroll regions T12-2 created, no scope creep. The out-of-scope carve-outs (on-phone confirmation, role=group debate) are explicit, which keeps the AC set falsifiable. One observation, not a gap: the value here is latent-risk reduction (keyboard/SR operability), not a feature users will notice — so success is "no one is blocked," which only on-device SR testing fully confirms. That's already acknowledged as operational followup. **No requirements gaps.**

## 🏗️ Winston — Architect

Architecturally this is the right move and consistent with the T11/T12 trajectory: collapse 8 copy-pasted inline wrappers into one presentational primitive in the existing `components/**` family, exactly as `BackLink`/`PageShell`/`LoadingCard` were. The focus ring correctly lives as a class-keyed CSS rule (`.scroll-region:focus-visible`) because `:focus-visible` cannot be expressed inline — that's not a workaround, it's the only correct vehicle, and it mirrors the precedent already in the base layer. To be precise about "mirror": the rendered values are identical to the input rule (2px / `#1d4ed8` / offset 1px); the *only* difference is that the color is referenced via the `--color-brand-primary` token instead of the `#1d4ed8` literal. The token resolves to the same color, so this is a sourcing-style refinement with no value divergence — not a different ring. No new deps, no layering inversion, no boundary risk (all under `apps/tournament-web/**`). The `overflowX:auto` "responsive by nature" property is preserved verbatim from T12-2, so the 375px overflow fix is not disturbed. **No architectural concerns.**

## 📋 John — Product Manager

Smallest change that closes the named gap — I like it. It ships value (a11y operability) without re-litigating the table design. WHY does this matter to the league? Because the app is used one-handed at the course, and a keyboard/SR user (or a future audit) hitting an unnamed, unringed tab-stop is exactly the kind of paper-cut that erodes trust. The decision to defer device confirmation rather than block on it is the correct iteration call. I'd only note for the backlog: if a future a11y pass ever finds 8 region landmarks noisy in a screen reader's landmark menu, the reversible `role="group"` swap is the lever — already documented. **Ship-ready from a product lens.**

## 🧪 Quinn — QA Engineer

The 4 unit tests assert the load-bearing contract: children render, the region is queryable by accessible name (`getByRole('region', { name })` — which implicitly proves both `role="region"` and `aria-label`), `tabIndex=0`, the `scroll-region` class, and `overflowX:auto`. That's the right coverage for a presentational primitive in jsdom. Honest coverage holes (all acceptable / out-of-scope): (1) jsdom does not compute layout, so the focus *ring* pixels and overflow scrolling are not asserted here — but the CSS rule is a 1:1 mirror of the already-proven input rule, and T12-2 already proved the overflow mechanism in real Chromium; (2) per-route rendering isn't re-tested, but the existing route tests still pass (329 green) and the grep proves 0 bare wrappers remain. The tournament-web suite (the only suite this story touches) passed cleanly on its first run (329, incl. the 4 new tests). The one transient *tournament-api* failure on its first run is the known T10-3 finalize-before-handoff flake — it did not reproduce on two reruns (965 green) and is unreachable from a tournament-web-only diff, so it is not a regression. **Tests adequate; the modified suite passed first-run.**

## 🎨 Sally — UX Designer

From a keyboard/SR experience view this is a clear win: tabbing onto a wide table is now *intended* to expose a human label (the `aria-label` values "Money matrix", "Leaderboard", etc.) instead of an anonymous group, and the focus ring makes the stop visible. (The exact SR announcement string is implementation/AT-dependent and is what the deferred on-device confirmation verifies; the `aria-label` is the code-level contract, which the unit test asserts.) The labels read as content names, which is what a SR user wants to hear. Two soft notes, neither blocking: (a) the labels are good but slightly terse — "Money matrix" is fine; if a future pass wanted parity with on-screen headings, some routes title the section differently (e.g. the page is "Money") — current labels are still accurate and arguably better (more specific). (b) `:focus-visible` (not `:focus`) is the right call — it avoids flashing a ring on touch-scroll, which would look like a bug on a phone. **No UX changes required.**

## 💻 Amelia — Developer

Implementation matches spec, AC by AC. AC-1: primitive at `scrollable-table.tsx:35-46` with the exact attribute set. AC-2: 8 sites migrated, `grep overflowX routes/** = 0`, and the one table-level style (`width:100%;borderCollapse:collapse` on the course scorecard `<table>`) preserved on the element, not hoisted. AC-3: `.scroll-region:focus-visible` width/color/offset identical to the input rule. AC-4: added attributes (role/aria-label/class) do not affect layout; DOM is structurally T12-2 + attrs. AC-5: 329 web tests, others unchanged, typecheck/lint clean. JSX open/close replacements verified — no mismatched tags (the two-table `admin.courses.new` used h2-anchored opens and distinct trailing context for each close). **No drift.**

---

## 🧙 BMad Master — Consolidated Verdict

All six perspectives converge: the implementation meets every acceptance criterion, introduces no architectural or boundary risk, and carries adequate test coverage for a presentational a11y primitive. The only residual items are explicitly out of scope and already recorded as operational/reversible (on-device SR confirmation; `role="group"` fallback).

**Verdict: SHIP-READY. Zero required changes.**
