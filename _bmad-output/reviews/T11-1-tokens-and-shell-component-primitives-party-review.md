# Party-Mode Review — T11-1 tokens + shell-component primitives

**Story:** `_bmad-output/implementation-artifacts/tournament/T11-1-tokens-and-shell-component-primitives.md`
**Mode:** Non-interactive written review (per tournament-director step 8)
**Date:** 2026-05-20
**Reviewed scope:** 11 implementation files + spec + sprint-status flip

---

## 📊 Mary (Analyst) — Does this set up T11-2/T11-3 effectively?

The split worked. T11-1 ships exactly what T11-3 needs to consume (5 primitives with locked APIs) and exactly what T11-2 can ignore (T11-2 centralizes auth boilerplate, which doesn't depend on these primitives). The 18 design tokens cover every shade observed in the 117-hex audit data — collapse ratio of roughly 6.5:1 — and the 4-step font scale collapses 9 ad-hoc values to a usable set. No tokens were created for hypothetical-future-needs; every one cites a frequency-backed audit observation in its inline comment. Consumers in T11-3 will be reading `style={{ color: 'var(--color-text-muted)' }}` rather than `color: '#555'`, with no guesswork about which token to pick (the comment names the literal it replaces). The "no migrations this story" boundary is honest — visible value lands in T11-3, not here, and the spec says so up front. The string-typing sharp edge on BackLink is documented honestly as a future-enhancement candidate and a code-review watch item; T11-3 reviewers will see it. **Verdict: foundation is well-grounded; T11-2 and T11-3 can proceed unblocked.**

## 🏗️ Winston (Architect) — Are the API shapes minimal-yet-extensible?

Yes, deliberately so. Each component is a thin presentational wrapper with no router awareness (except BackLink which by definition wraps Link), no data fetching, no theming hooks, no compound-component plumbing. Props mirror the obvious shape: `title`/`actions`/`children` for PageShell; `to`/`params`/`label` for BackLink; `message` for LoadingCard; `title`/`body`/`action` for EmptyState; `error`/`title`/`onRetry` for ErrorCard. Extensibility is preserved via the "documented constraints, not enforced constraints" pattern — e.g., PageShell's header-render-if-either rule is in the doc + tests, not enforced via a stricter prop union, so future variants can extend without breaking the contract. The CSS-token consumption is consistent (every component uses `var(--*)` instead of literals — verified across all 5 files). One small architectural choice worth noting: ErrorCard's 5-step extractMessage is implemented as a private function inside the component file, not exported. That's right for v1 — if a future story needs to reuse the extraction logic elsewhere (e.g., a toast component), promote it to `lib/safe-error-message.ts` then. Until then, keep it private. The string-typing on BackLink loses route-tree validation but the conditional-spread pattern for `params` correctly handles `exactOptionalPropertyTypes: true` and mirrors a pattern already used in the codebase (cited in the comment). **Verdict: minimal, extensible, no architectural debt introduced.**

## 📋 John (PM) — Right scope or scope-creep?

Right scope. T11-1 produces primitives; T11-2 does auth dedup; T11-3 does the visible rollout. Splitting prevents a single 30+ file PR that codex review would dilute attention across. What's NOT in this story (route migrations, base-reset migration to vars, dark-mode variants, Tailwind `@theme` aliases, mobile responsive `@media` queries) is correctly excluded — each item has its own clean follow-on. The one place scope crept is the BackLink typing wrestle: codex impl-round-1 flagged the `to as any` cast, and the back-and-forth between strict and loose typing added meaningful effort + a Medium followup. Acceptable given consumers in T11-3 will use BackLink ~25 times; the typing decision was worth making consciously. Under-deliver risk: T11-1 ships infrastructure with no end-user visible improvement until T11-3 lands. That's correct given the story description's risk-acceptance language ("until T11-3 actually rolls out PageShell, the visual coherence benefit is invisible to end users") — PRs against this story should be evaluated on "are the primitives well-designed?" not "did Pinehurst's admin pages get prettier?". They didn't, yet. **Verdict: scope and split are correct.**

## 🧪 Quinn (QA) — Test coverage quality?

Strong. 27 new tests across 5 component files:
- PageShell: 5 tests covering all 4 header-render branches (children-only, title-only, actions-only, both) + the root CSS-var check
- BackLink: 3 tests with the async `findByRole` + `waitFor` pattern that future T11-3 tests for any component-that-uses-Link can copy verbatim. The pattern is reusable infrastructure, not just test-specific
- LoadingCard: 3 tests including a11y role
- EmptyState: 4 tests including the title-only no-body-no-action branch
- ErrorCard: 12 tests — the most thorough of the five, covering every extractMessage precedence path (Error → string → object.message → JSON.stringify → "Unknown error" literal), plus a circular-reference test, an `undefined` test, an empty `{}` test, and a defensive "never renders [object Object]" assertion across 4 object shapes, plus the no-throw-for-any-input test (5 input types). The "[object Object]" forbidden-output assertion is the audit-honest version of the spec's "safely stringifies" requirement — codex spec-round-2 flagged the ambiguity and this is the unambiguous closure

**Honest characterization of the LOW codex flagged about primitive-input UX:** for `null` input, `JSON.stringify(null)` returns `"null"` (a literal string), so ErrorCard renders "null" as text. For `42`, renders "42". For `true`, renders "true". This is per-spec behavior (step 4 says "render the JSON" without distinguishing primitive types) but it IS arguably mediocre UX. Tests do not assert this behavior — they assert nothing about the rendered text for these primitives, only that the render doesn't throw. If you want primitive inputs to fall through to "Unknown error" instead of rendering their JSON-stringified form, that's a one-line implementation change (`typeof error === 'object' && error !== null` gate before step 4) but requires updating tests. **Open question for user below.**

**Verdict: coverage is strong; one open UX question on primitive inputs noted below.**

## 💻 Amelia (Dev) — Code-level concerns?

`index.css:5-50`: inline `:root` block placement (between `@custom-variant dark` and `@layer base`) is correct for Tailwind v4. The per-token inline comments are accurate against the audit data (verified counts match: `#555` ×21, `#fff` ×23, `#1d4ed8` ×7, etc.). Brand-blue drift collapse is correctly attributed (`#1e3a8a` ×2, `#3b82f6` named as drift collapsing to `--color-brand-primary`). `--color-success` correctly collapses both `#0a5` (4 uses) and `#16a34a` (2 uses). The two layout tokens (`--page-padding: 16px`, `--page-max-width: 960px`) are consumed by PageShell only this story; future consumers don't need to re-derive them.

`page-shell.tsx:24`: `showHeader = Boolean(title) || Boolean(actions)` is the load-bearing logic for the codex-flagged ambiguity. Clean.

`back-link.tsx:23-35`: doc comment about the typing tradeoff is honest. The conditional-spread for `params` correctly handles `exactOptionalPropertyTypes: true`. The `as unknown as NonNullable<LinkProps['params']>` double-cast is uglier than ideal but is the minimal way to satisfy TypeScript without changing the prop shape.

`error-card.tsx:33-60`: extractMessage implements the locked 5-step precedence exactly. The `try/catch` around `JSON.stringify` and the explicit `typeof json === 'string' && json !== '{}'` check (instead of truthiness) match the spec's "implementation note" verbatim.

`loading-card.tsx`, `empty-state.tsx`: trivially correct.

**One small observation (not blocking):** the `PageShell`'s `<h1>` always renders with `fontSize: 'var(--font-lg)'`. The audit observed `<h1>` elements appearing 86 times across 23 route files with varying treatment; this primitive's `--font-lg` (`1.25rem`) is on the smaller end of the observed range. Routes that need a hero-sized title (e.g., `events.$eventId.courses.$courseId.tsx:189` uses larger) will need to override via `actions={<h1 style="...">}` or by not using PageShell's `title` prop. Acceptable for v1; T11-3 will surface if anyone screams.

**Verdict: code is idiomatic, citation-friendly, ready.**

---

## Open Questions for User

**1. ErrorCard primitive-input UX (Low, raised by codex impl-round-1 L#2):** for inputs like `null`, `42`, `true`, the current implementation renders them as their JSON stringification (`"null"`, `"42"`, `"true"`). These are valid JSON but arguably mediocre UX in an error card. Options:
   - (a) **Leave as-is** (current implementation). Per-spec behavior; one less code path to maintain.
   - (b) **Tighten extraction to object-only at step 4**: add `typeof error === 'object' && error !== null` gate before the JSON.stringify path; primitives fall through to "Unknown error". Requires 1 line of code + 3 lines of test updates.

The current 12 ErrorCard tests don't assert behavior for these primitive inputs — only that render doesn't throw. Either way, no current test will fail. **Pick (a) defer / (b) tighten-now.**

---

## Summary verdict

**GO** — code-complete, all 27 new tests pass, full regression suite green (engine 472, wolf-cup-api 517, tournament-api 965+2sk, tournament-web 272→299), typecheck + lint clean, ESLint test 3× isolated runs all green (carry-over signal from T10-2 baseline).

**Main risks:**
1. BackLink string-typing sharp edge: caller can pass `to="/admin/events/$eventId"` without `params` and trigger a runtime throw on href construction. Documented in spec followups; T11-3 code review must watch for it. Future micro-enhancement: typed `BackLinkTo<Router>` generic variant.
2. Primitive-input UX in ErrorCard (open question above) is mediocre but not broken; spec didn't pin a choice.
3. Visual coherence benefit is INVISIBLE until T11-3 actually rolls out PageShell to admin routes. T11-1 is infrastructure-only; no end-user-visible change.
4. `<h1>` font size in PageShell is `--font-lg` (1.25rem), smaller than some existing hero-sized titles. Routes wanting hero treatment will need to override or skip the `title` prop. Surface during T11-3.
5. Base `@layer base` form-control styles still hardcode hex literals duplicated by the new tokens. Documented constraint per Risk Acceptance §6 (conservative path); future opportunistic touch can migrate.
