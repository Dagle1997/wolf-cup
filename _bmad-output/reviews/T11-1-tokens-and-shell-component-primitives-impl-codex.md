# Codex Review

- Generated: 2026-05-20T21:43:34.669Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/index.css, apps/tournament-web/src/components/page-shell.tsx, apps/tournament-web/src/components/page-shell.test.tsx, apps/tournament-web/src/components/back-link.tsx, apps/tournament-web/src/components/back-link.test.tsx, apps/tournament-web/src/components/loading-card.tsx, apps/tournament-web/src/components/loading-card.test.tsx, apps/tournament-web/src/components/empty-state.tsx, apps/tournament-web/src/components/empty-state.test.tsx, apps/tournament-web/src/components/error-card.tsx, apps/tournament-web/src/components/error-card.test.tsx

## Summary

Cannot directly verify conformance to the referenced spec file because its contents were not provided in this review packet; findings below are based strictly on the shown diff/file contents and the behavior implied by the code.

Within that constraint: the primitives look functionally correct, avoid unsafe HTML, and generally follow good a11y defaults (PageShell h1, EmptyState/ErrorCard h2, LoadingCard status/polite, ErrorCard alert). Test coverage is solid and targets the main behavioral branches.

Main risk area is BackLink’s `to as any`/`params as any`: it meaningfully weakens compile-time safety and the comment claiming “route-tree typing to validate at the call site” is not true given `to: string`. There are also a couple of smaller robustness/maintenance risks noted below.

Overall risk: low

## Findings

1. [medium] BackLink `to: string` + `as any` removes route typing; comment about call-site validation is inaccurate
   - File: apps/tournament-web/src/components/back-link.tsx:14-30
   - Confidence: high
   - Why it matters: `BackLinkProps` declares `to: string` (line 15) and then casts `to`/`params` to `any` when passing into TanStack Router’s `<Link>` (lines 25–30). With `to` typed as a plain string, consumers no longer get route-tree-based validation at the call site (contrary to the comment on lines 21–23). This increases the chance of shipping invalid paths/params that only fail at runtime (bad navigation, broken back links), and it makes later large-scale usage (you mentioned ~25 call sites in T11-3) easier to get subtly wrong.
   - Suggested fix: Preserve TanStack Router’s typing by deriving props from the actual Link component instead of using `string` + `any`.

Example (often works well in practice):
- `type BackLinkProps = { label?: string } & Pick<React.ComponentProps<typeof Link>, 'to' | 'params'>;`
Then pass `to={to}` and `params={params}` without casts.

If `ComponentProps<typeof Link>` is too generic in your setup, consider exporting a project-local typed wrapper (parameterized by your router type) and have BackLink depend on that, so the `to`/`params` types stay aligned with your route tree.

2. [low] ErrorCard shows JSON.stringify outputs like "null"/"42" for non-object inputs; tests don’t assert intended UX for these cases
   - File: apps/tournament-web/src/components/error-card.tsx:33-60
   - Confidence: medium
   - Why it matters: `extractMessage` applies JSON.stringify to any value (lines 48–55). For `null` it returns `'null'`; for numbers it returns e.g. `'42'`. That may be acceptable, but it’s a UX/product decision: many apps prefer the Step 5 fallback for these shapes. Your tests currently only assert “does not throw” for `null`/number/symbol/function (test at lines 71–80 in `error-card.test.tsx`) and do not pin what message should be displayed, so unintended behavior changes here could slip in unnoticed.
   - Suggested fix: If the intended behavior is “Unknown error” for `null`/number/boolean, gate Step 4 to objects only (or explicitly exclude primitives):
- Only attempt JSON.stringify when `typeof error === 'object' && error !== null` (and maybe arrays too if desired).

If current behavior is intended, add explicit assertions for representative primitive inputs (e.g., `null` renders `Unknown error` OR renders `null`), so the precedence/UX stays locked.

3. [low] Design tokens exist, but base form-control styles still hardcode colors duplicated by tokens (risk of future drift)
   - File: apps/tournament-web/src/index.css:67-135
   - Confidence: high
   - Why it matters: You introduced token values in `:root` (lines 26–50), but the existing `@layer base` rules still hardcode several of the same literals (e.g., `#cbd5e1`, `#fff`, `#0f172a`, `#1d4ed8`, `#475569` at lines 70–84, 86–90, 112–128). This is not a runtime bug today, but it creates a maintenance hazard: future token changes won’t affect these base styles, and you’ll reintroduce the “drift” the tokenization is meant to eliminate.
   - Suggested fix: When allowed by the spec/ACs, replace duplicated literals in `@layer base` with the new vars (e.g., `border: 1px solid var(--color-border)` etc.). If the spec explicitly requires leaving base unchanged for T11-1, add a TODO with a ticket reference so this doesn’t get forgotten.

4. [low] BackLink test asserts `href` synchronously after `findByRole`; may be timing-flaky across router versions
   - File: apps/tournament-web/src/components/back-link.test.tsx:39-46
   - Confidence: medium
   - Why it matters: You already noted TanStack Router resolves `<Link>` asynchronously. In the first test you assert `href` immediately after `findByRole` (lines 43–46). Depending on router/link internals, the element can exist before `href` stabilizes, creating occasional flakes (you already use `waitFor` in the params test).
   - Suggested fix: Make the first test consistent with the third by wrapping the `href` assertion in `await waitFor(() => expect(link).toHaveAttribute('href', '/admin/events'))`.

## Strengths

- All primitives avoid `dangerouslySetInnerHTML`; rendering is text/ReactNode only, so XSS risk is low by default.
- ErrorCard’s extraction logic is defensive (try/catch around stringify; avoids `String(error)`), and tests cover circular refs and `{}` cases.
- Good baseline a11y: LoadingCard uses `role="status"` + `aria-live="polite"`; ErrorCard uses `role="alert"`; headings are semantic (h1 in PageShell when title present; h2 in EmptyState/ErrorCard).
- PageShell header rendering condition (title OR actions) is explicitly implemented and tested across branches.
- New components consistently consume CSS variables (no new hardcoded hex values inside the TSX components).

## Warnings

None.
