# T11-1: Tokens + Shell Component Primitives (Foundation Pass)

## Status

done

## Story

As a future-T11 author (T11-2 auth centralization, T11-3 PageShell rollout) and as a future tournament-web feature contributor, I want a small, intentional set of design primitives — 12 color tokens + a 4-step font scale + 2 layout tokens declared as CSS custom properties inline in `index.css`, plus a shared component family (`PageShell`, `BackLink`, `LoadingCard`, `EmptyState`, `ErrorCard`) — to consume in every new route from this point forward, so cross-cutting changes (rebranding, dark mode, spacing pass) become single-file edits instead of 16-file find-and-replace sweeps, and so future visual coherence doesn't depend on every contributor remembering 8 ad-hoc style snippets.

T11-1 introduces the primitives ONLY. It does NOT migrate any existing route to consume them — that's T11-3's scope (PageShell + BackLink rollout to ~25 routes). T11-2 (auth boilerplate centralization) is independently scheduled. This story exists to make T11-2 and T11-3 implementations small and uncontroversial, with the design decisions already locked.

The audit report at `_bmad-output/reviews/T1-T8-final-exit-review-codex.md` (and the inline UI audit done at the start of the T11 cycle) found: 117 raw hex codes across 16 files, brand-blue drift across `#1d4ed8` / `#1e3a8a` / `#3b82f6`, font sizes ranging across 9 unrelated values, no shared loading/empty/error state components, and admin pages that are dead-ends on iOS standalone PWA (no back-button). Those findings are the source of this story's primitive choices.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

Every file in `## Files this story will edit` classifies into the tournament-director's ALLOWED bucket (`apps/tournament-web/**` and `_bmad-output/implementation-artifacts/tournament/**`). No root config, no dependency changes (no `package.json`, no `pnpm-lock.yaml`), no `apps/tournament-api/**`, no `apps/api`/`apps/web`/`packages/engine` touches.

### 2. No route migrations this story

The deliberate split: T11-1 = primitives, T11-2 = auth centralization, T11-3 = PageShell rollout. Mixing rollout into T11-1 would inflate the diff to ~30 files with ~25 route migrations — each one tiny but cumulatively large enough that codex review focus would dilute. Keeping T11-1 to "new files + 1 small index.css edit" lets the design decisions (token names, component APIs, prop shapes) get reviewed cleanly before they're consumed.

### 3. Tokens shape: CSS custom properties at `:root` INSIDE index.css, NOT a separate file

Tournament-web uses Tailwind v4 (already imported in `index.css:1`) but the actual route components use inline `style={{...}}` overwhelmingly more than Tailwind utility classes. Adding tokens as Tailwind v4 `@theme` entries would only benefit utility-class consumers — and the dominant consumer pattern is `style={{ color: 'var(--color-text-primary)' }}`. Therefore tokens are declared as plain CSS custom properties at `:root`. (Adding `@theme` aliases later is a non-breaking extension — left as a future micro-enhancement, not a v1.5 blocker.)

**Why inline in index.css, not a separate `tokens.css` imported via `@import`:** Tailwind v4's `@import "tailwindcss";` triggers a multi-pass pipeline (theme expansion, layer ordering, utility generation). A subsequent `@import "./styles/tokens.css";` MAY or MAY NOT be processed in the expected order depending on Tailwind's import-resolution behavior, build config, and PostCSS plugin chain. To avoid that fragility entirely, the tokens are declared as a single `:root { ... }` block at the TOP of `index.css`, immediately after `@import "tailwindcss";` and BEFORE the existing `@layer base` block. This is a one-file change, ordering-agnostic, and works identically in `vite build` and `vite dev`.

### 4. Token names follow audit-observed colors, not aspirational palette

The 117 hex codes collapse to ~10 distinct shades by frequency:

| Token | Hex | Observed use count | Role |
|---|---|---|---|
| `--color-surface` | `#fff` | 23 | Card / input background |
| `--color-text-primary` | `#0f172a` | 3 | Primary text (already in base form reset) |
| `--color-text-secondary` | `#475569` | 3 | Secondary text (slate-600) |
| `--color-text-muted` | `#555` | 21 | Muted body / metadata |
| `--color-border` | `#cbd5e1` | 5 | Standard input/card border (already in base form reset) |
| `--color-border-subtle` | `#ddd` | 7 | Lighter divider |
| `--color-brand-primary` | `#1d4ed8` | 7 | Primary CTA (collapses brand-blue drift; `#1e3a8a` ×2 and `#3b82f6` are alias-able later) |
| `--color-brand-tint` | `#eff6ff` | 4 | Selected-state tint / brand accent background |
| `--color-success` | `#16a34a` | 2 | Confirmation / positive |
| `--color-warning-bg` | `#fef3c7` | 3 | Warning-state background |
| `--color-warning-text` | `#92400e` | 3 | Warning-state text |
| `--color-danger` | `#dc2626` | (also seen `#c33`/`#f87171` ×3 total) | Destructive / error |

Plus a 4-step font scale derived from the observed usage:

| Token | Value | Maps to |
|---|---|---|
| `--font-xs` | `0.75rem` | smallest annotation (1 use; possibly removable) |
| `--font-sm` | `0.875rem` | replaces the family of `0.85em`/`0.85rem`/`0.9rem`/`0.95rem` (~14 uses total) |
| `--font-base` | `1rem` | body default (3 uses + implicit inherit) |
| `--font-lg` | `1.25rem` | section heading replacement for `1.05rem`/`1.1rem`/`1.5rem`/`1.6rem`/`1.75rem` (~6 uses) |

(`4rem` is a one-off hero — left as a deliberate one-off, not promoted to a token.)

Tokens documented as inline `/* … */` comments inside the `:root { ... }` block in `index.css` (see Risk Acceptance §3 for the file-location rationale) so future readers know what each replaces. This is the rationale-with-the-artifact pattern that makes design tokens maintainable.

### 5. Component APIs — minimal, ref-able, no behavior smuggled in

Each shell component is a thin presentational primitive. No data fetching, no router awareness (except `BackLink` which wraps `<Link>` from TanStack Router). No theming hooks. Props mirror the obvious shape.

**`PageShell`:**
- Props: `children: ReactNode`, `title?: string` (optional `<h1>` render), `actions?: ReactNode` (optional right-aligned slot for page-level CTAs).
- Renders a `<div>` with `padding: var(--page-padding)`, `max-width: var(--page-max-width)`, `margin-inline: auto`.
- **Header render rule:** the `<header>` element is rendered if EITHER `title` OR `actions` is truthy (not both required). The `<h1>` inside renders only if `title` is truthy. The actions slot renders only if `actions` is truthy. When the header renders, its children are flex-aligned with `justify-content: space-between` (title left, actions right; if title is absent, actions still right-align via `margin-inline-start: auto` on the wrapping div).
- Test: renders children with no header when neither title nor actions; renders header with title only; renders header with actions only (no h1); renders header with both, title left + actions right.

**`BackLink`:**
- Props: `to: string` (TanStack Router **path string**, e.g., `/admin/events` — same shape that's accepted by `<Link to={...}>` in this codebase's existing routes), `params?: Record<string, string>`, `label?: string` (defaults to `'Back'`).
- Renders `<Link to={to} params={params}>← {label}</Link>` with consistent muted-text styling.
- TanStack Router v1.x types `to` as a typed route path; this story passes through the string as-is and lets TS/runtime validate it. Future migration to a route-id-aware typed variant is non-breaking.
- Test: renders with default label, renders custom label, passes `to` and `params` to the underlying Link.

**`LoadingCard`:**
- Props: `message?: string` (defaults to `'Loading…'`).
- Renders a centered card with the message. No spinner — keep simple for v1; future enhancement.
- Test: renders default message, renders custom message.

**`EmptyState`:**
- Props: `title: string`, `body?: string`, `action?: ReactNode`.
- Renders a centered card with title (heading), optional body text, optional action slot.
- Test: renders title (required), renders body when provided, renders action when provided.

**`ErrorCard`:**
- Props: `title?: string` (defaults to `'Something went wrong'`), `error: Error | string | unknown` (display-safe), `onRetry?: () => void` (optional retry button).
- Display-safe extraction (locked behavior):
  1. If `error instanceof Error` → render `error.message`.
  2. Else if `typeof error === 'string'` → render the string.
  3. Else if `error != null && typeof error === 'object' && 'message' in error && typeof error.message === 'string'` → render `error.message`.
  4. Else attempt `JSON.stringify(error)`. If the call throws (e.g., circular reference) OR returns `undefined` (e.g., the input itself is `undefined`, a `function`, or a `symbol` — per JSON.stringify spec these yield `undefined` not a string) OR returns the literal string `'{}'` → fall through to step 5. Otherwise render the JSON.
  5. Else render the literal fallback string `'Unknown error'`. Implementation note: wrap step 4's `JSON.stringify` in a try/catch to handle the throw case, then explicitly check `typeof result === 'string' && result !== '{}'` before using it — relying on truthiness alone is wrong because the literal string `'0'` is truthy but irrelevant here.
- Critically: NEVER call `String(error)` directly without the above guards, because `String({...})` yields `'[object Object]'` which is a bad UX. The fallback path goes through `JSON.stringify` then to the `'Unknown error'` literal.
- Renders a centered card with title, error message, optional retry button.
- Test: renders title (default and custom), renders message from Error object, renders message from string, renders extracted message from `{message: '…'}` object shape, renders JSON for `{foo: 'bar'}` (round-trippable object), renders `'Unknown error'` literal for `{circular: ...}` or `undefined` (un-stringifiable / empty), renders retry button when callback provided, calls callback on click.

Each component lives at `apps/tournament-web/src/components/{kebab-name}.tsx` with a sibling `.test.tsx`. No barrel index — direct imports per existing convention.

### 6. index.css edit: inline tokens, optionally migrate base reset to use vars

`apps/tournament-web/src/index.css:1-88` currently uses hard-coded hex literals (`#cbd5e1`, `#1d4ed8`, `#fff`, `#0f172a`, `#475569`, `#334155`). Two paths:

- **Conservative (this story):** Add a `:root { ... }` token block inline (between `@custom-variant dark` and `@layer base`, per Risk Acceptance §3 / AC-2). Leave the existing `@layer base` hex literals alone — migrating them risks subtle re-render diffs that need visual review. Future story (T11-2 or T11-3) can opportunistically migrate base reset to use `var(--color-*)` as it touches adjacent code.
- **Aggressive (NOT this story):** Migrate the base reset block to use `var(--color-*)` everywhere. Rejected because it risks visual regression and would inflate codex review beyond "primitives only."

This story takes the conservative path.

### 7. What is NOT in this story

- No migrations of existing routes to consume `PageShell`/`BackLink`/etc. (T11-3 scope).
- No changes to `apps/tournament-web/src/hooks/use-auth-session.ts` (T11-2 scope).
- No dark-mode theme variants. (`@custom-variant dark` in index.css:3 suggests it's wired but unused; revisit in a future story.)
- No Tailwind v4 `@theme` entries mirroring the tokens. Future micro-enhancement.
- No mobile-responsive `@media` queries. The audit identified zero `@media` queries in tournament-web; that's a separate finding the next sweep (T11-2/T11-3 or beyond) addresses.
- No new dependencies (no testing-library install needed if it isn't already present — verify in subtask 1.0).

## Acceptance Criteria

**AC-1: Design tokens exist with the documented variables AND value-pinned hex/size literals.**

**Given** `apps/tournament-web/src/index.css`
**When** the file is parsed
**Then** a `:root { ... }` block declares every one of the following CSS custom properties with EXACTLY these values (no drift; codex spec round-1 H#1 fix locks the values):

| Token | Exact value |
|---|---|
| `--color-surface` | `#fff` |
| `--color-text-primary` | `#0f172a` |
| `--color-text-secondary` | `#475569` |
| `--color-text-muted` | `#555` |
| `--color-border` | `#cbd5e1` |
| `--color-border-subtle` | `#ddd` |
| `--color-brand-primary` | `#1d4ed8` |
| `--color-brand-tint` | `#eff6ff` |
| `--color-success` | `#16a34a` |
| `--color-warning-bg` | `#fef3c7` |
| `--color-warning-text` | `#92400e` |
| `--color-danger` | `#dc2626` |
| `--font-xs` | `0.75rem` |
| `--font-sm` | `0.875rem` |
| `--font-base` | `1rem` |
| `--font-lg` | `1.25rem` |
| `--page-padding` | `16px` |
| `--page-max-width` | `960px` |

**And** each token has an inline `/* … */` comment naming the audit-observed hex literal (or font-size) it collapses, when applicable.

**AC-2: Tokens live inside index.css (no separate tokens.css file).**

**Given** `apps/tournament-web/src/index.css`
**When** the file is parsed
**Then** the `:root { ... }` block from AC-1 appears AFTER `@import "tailwindcss";` and `@custom-variant dark (...)` and BEFORE the existing `@layer base { ... }` block
**And** no new `@import` statement is added (no separate `tokens.css` file — H#2 from codex spec round-1: Tailwind v4 `@import` ordering is fragile)
**And** the existing `@layer base` block's hex literals are unchanged (conservative path per Risk Acceptance §6; migration to `var(--color-*)` deferred to a future opportunistic touch)

**AC-3: PageShell component exists with the documented API and behavior.**

**Given** `apps/tournament-web/src/components/page-shell.tsx`
**When** rendered with `children` only
**Then** it renders a `<div>` with the children inside, NO `<header>`, NO `<h1>`
**And** when rendered with `title="Foo"` only, renders a `<header>` containing `<h1>Foo</h1>`, NO actions slot
**And** when rendered with `actions={<button>X</button>}` only (no title), renders a `<header>` containing the button (no `<h1>`)
**And** when rendered with both `title` and `actions`, the header contains both with the title flex-aligned left and actions flex-aligned right
**And** the rendered root has `max-width` and padding driven by `var(--page-max-width)` and `var(--page-padding)`
**And** the `<header>` is omitted entirely when BOTH `title` AND `actions` are nullish/undefined/false

**AC-4: BackLink component exists with the documented API and behavior.**

**Given** `apps/tournament-web/src/components/back-link.tsx`
**When** rendered with `to="/admin/events"`
**Then** it renders a TanStack Router `<Link>` with `to="/admin/events"` and the default label `"← Back"`
**And** when rendered with `label="To events"`, the rendered text is `"← To events"`
**And** when rendered with `params={{ eventId: 'abc' }}`, the `<Link>` receives the params verbatim

**AC-5: LoadingCard component exists with the documented API and behavior.**

**Given** `apps/tournament-web/src/components/loading-card.tsx`
**When** rendered with no props
**Then** the visible text is `"Loading…"`
**And** when rendered with `message="Fetching scores"`, the visible text is `"Fetching scores"`

**AC-6: EmptyState component exists with the documented API and behavior.**

**Given** `apps/tournament-web/src/components/empty-state.tsx`
**When** rendered with `title="No rounds yet"`
**Then** the title is visible
**And** when rendered with `body="Create one to get started."` AND `action={<button>New round</button>}`, both render
**And** when rendered with `title` only, no body or action elements appear

**AC-7: ErrorCard component exists with the documented API and behavior.**

**Given** `apps/tournament-web/src/components/error-card.tsx`
**When** rendered with `error={new Error('Boom')}`
**Then** the visible text includes `Boom` AND the default title `"Something went wrong"`
**And** when rendered with `error="Network down"` (string form), the visible text includes `Network down`
**And** when rendered with `error={{ message: 'Wrapped' }}` (object with message property), the visible text includes `Wrapped`
**And** when rendered with `error={{ foo: 'bar' }}` (non-Error, non-string, no `message` property, JSON-serializable), the visible text includes the JSON string `{"foo":"bar"}` — NEVER the literal `[object Object]`
**And** when rendered with `error=undefined` OR with a circular-reference object (un-JSON-stringifiable), the visible text is exactly the literal `"Unknown error"` — NEVER `[object Object]` or `undefined`
**And** when rendered with `onRetry={vi.fn()}` AND clicked, the callback fires exactly once
**And** the render never throws regardless of the `error` input shape

**AC-8: Each component has a sibling .test.tsx covering the AC's behavior.**

**Given** `apps/tournament-web/src/components/{page-shell,back-link,loading-card,empty-state,error-card}.test.tsx`
**When** `pnpm --filter @tournament/web test` runs
**Then** every new test passes
**And** every previously-passing tournament-web test still passes

**AC-9: No regression in test counts.**

**Given** the full regression set
**When** `pnpm --filter @tournament/web test`, `pnpm --filter @tournament/api test`, `pnpm --filter @wolf-cup/engine test`, `pnpm --filter @wolf-cup/api test`, `pnpm -r typecheck`, `pnpm -r lint` all run
**Then** every previously-passing test still passes (no count drop)
**And** tournament-web's count increases by the number of new tests added (5 component tests × N test cases each — name them explicitly in Completion Notes)
**And** typecheck + lint exit 0 with no new warnings or errors

**AC-10: Sprint-status flip lands atomically with the commit.**

**Given** the commit produced by step 10 of the director cycle
**When** the final commit is inspected
**Then** `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` has `T11-1-tokens-and-shell-component-primitives: done`
**And** no other story's status changed in the same commit

## Tasks / Subtasks

1. **Pre-flight: verify test environment is complete**
   1.0. Check `apps/tournament-web/package.json` (and `vitest.config.ts` if present) for ALL of:
        - `@testing-library/react` (renders components into the DOM)
        - `@testing-library/jest-dom` (custom matchers like `toBeInTheDocument`)
        - a DOM runtime: either `happy-dom` or `jsdom`, plus `vitest.config.ts` configured with `environment: 'happy-dom'` or `environment: 'jsdom'`
        - a test-setup file that imports `'@testing-library/jest-dom'` to register the matchers globally
        Verify by inspecting `package.json` deps AND `vitest.config.ts` AND any setup file (likely `apps/tournament-web/src/test-setup.ts` or similar). The existing component tests (`activity-feed.test.tsx`, `tournament-toast.test.tsx`, etc.) imply all are present — confirm before writing new tests. If ANY of the four is missing, that's a SHARED edit (package.json + pnpm-lock.yaml) and/or vitest config — STOP and request approval. If all present, proceed.

2. **Design tokens (inline in index.css)**
   2.1. Edit `apps/tournament-web/src/index.css`: insert a `:root { ... }` block AFTER `@import "tailwindcss";` and `@custom-variant dark (...)` and BEFORE the existing `@layer base { ... }` block. The block declares every token from AC-1's table with the exact pinned values, with inline `/* … */` comments documenting each token's audit-observed replacement.
   2.2. Do NOT create a separate `tokens.css` file (per Risk Acceptance §3 + AC-2; Tailwind v4 `@import` ordering is fragile).
   2.3. Do NOT modify the existing `@layer base { ... }` block (conservative path per Risk Acceptance §6).

3. **PageShell**
   3.1. Create `apps/tournament-web/src/components/page-shell.tsx`.
   3.2. Create `apps/tournament-web/src/components/page-shell.test.tsx` covering AC-3 cases.

4. **BackLink**
   4.1. Create `apps/tournament-web/src/components/back-link.tsx`. Uses TanStack Router `<Link>` (import from `@tanstack/react-router`).
   4.2. Create `apps/tournament-web/src/components/back-link.test.tsx` covering AC-4 cases. Test setup mirrors existing TanStack-Router component tests (`router/QueryClientProvider/test wrapper` pattern from existing tests).

5. **LoadingCard**
   5.1. Create `apps/tournament-web/src/components/loading-card.tsx`.
   5.2. Create `apps/tournament-web/src/components/loading-card.test.tsx` covering AC-5 cases.

6. **EmptyState**
   6.1. Create `apps/tournament-web/src/components/empty-state.tsx`.
   6.2. Create `apps/tournament-web/src/components/empty-state.test.tsx` covering AC-6 cases.

7. **ErrorCard**
   7.1. Create `apps/tournament-web/src/components/error-card.tsx`. Defensively handles `Error | string | unknown` per AC-7.
   7.2. Create `apps/tournament-web/src/components/error-card.test.tsx` covering AC-7 cases including the non-Error-non-string case (no thrown render).

8. **Verify**
   8.1. Run `pnpm --filter @tournament/web test` — confirm new tests pass + no regression in existing 272.
   8.2. Run `pnpm --filter @tournament/api test`, `pnpm --filter @wolf-cup/engine test`, `pnpm --filter @wolf-cup/api test` — confirm no regression.
   8.3. Run `pnpm -r typecheck` and `pnpm -r lint` — confirm clean.
   8.4. Record in Dev Agent Record Completion Notes: per-component test count, total tournament-web count before/after, any non-obvious decisions (e.g., styling shortcuts taken in component implementations).

## Dev Notes

### Architectural alignment

T11-1 is the foundation pass for the T11 design-consistency sweep. The deliberate split (T11-1 primitives, T11-2 auth, T11-3 rollout) keeps each cycle's diff focused, lets codex review each design layer independently, and lets you ship one layer if a later one stalls.

The tokens choice — CSS custom properties at `:root`, not Tailwind v4 `@theme` — reflects the dominant consumer pattern (inline `style={{...}}` in route components). Future Tailwind-utility adoption can layer `@theme` aliases on top without changing the token names.

The component APIs are intentionally minimal. No theming hooks, no compound-component patterns, no slot prop libraries. Each component is a thin presentational primitive — easy to read, easy to test, easy to extend later. The "no behavior smuggled in" rule prevents these from becoming god-components.

### Key references

- UI audit findings (inline during T11 cycle setup) — surfaced 117 hex codes, brand-blue drift, no shared empty/loading/error components, no back-links on admin detail pages.
- Existing component tests in `apps/tournament-web/src/components/*.test.tsx` — establish the testing-library/react + vitest patterns to mirror.
- `apps/tournament-web/src/index.css` — existing `@layer base` form-reset block; the inline `:root { ... }` token block is declared BEFORE `@layer base` so any future migration of the base reset to `var(--color-*)` Just Works.
- T11-2 (`T11-2-centralize-auth-boilerplate-in-use-auth-session`) — consumes nothing from this story directly but ships alongside.
- T11-3 (`T11-3-pageshell-and-backlink-rollout`) — consumes all 5 components from this story.

### Risks / Followups

- **Followup: dark-mode token variants.** `index.css:3` declares `@custom-variant dark (&:is(.dark *))` which suggests dark-mode plumbing exists. The inline `:root { ... }` block does NOT define `:root.dark` overrides this story. Future story can add them additively.
- **Followup: Tailwind v4 `@theme` aliases for the tokens** — non-breaking extension that benefits utility-class consumers.
- **Followup: base reset migration to use vars.** Defer to T11-3 (or a later opportunistic touch); the audit-flagged value (consistency) lands when route migrations happen, not when the base reset changes.
- **Risk acceptance:** until T11-3 actually rolls out PageShell, the visual coherence benefit is invisible to end users. T11-1 ships primitive infrastructure, not user-visible polish. PRs against this story should be evaluated on "are the primitives well-designed?" not "did Pinehurst's admin pages get prettier?" (they didn't, yet).
- **Risk acceptance:** introducing tokens does NOT collapse the 117 raw-hex-code count by itself. That collapse happens during T11-3's migration. T11-1 is the prerequisite.
- **Risk acceptance (BackLink string-typing sharp edge):** because `to` is typed as `string` (not the TanStack Router generic), there's no compile-time guard preventing a caller from passing a `$param` placeholder path (e.g., `to="/admin/events/$eventId"`) WITHOUT a `params` prop. The runtime would throw during href construction. T11-3's review should specifically watch for this when migrating routes; the symptoms are obvious (immediate page-load error in dev). Future micro-enhancement: a typed `BackLinkTo<Router>` generic variant that consumers opt into for strict path validation.

## Files this story will edit

- apps/tournament-web/src/index.css
- apps/tournament-web/src/components/page-shell.tsx
- apps/tournament-web/src/components/page-shell.test.tsx
- apps/tournament-web/src/components/back-link.tsx
- apps/tournament-web/src/components/back-link.test.tsx
- apps/tournament-web/src/components/loading-card.tsx
- apps/tournament-web/src/components/loading-card.test.tsx
- apps/tournament-web/src/components/empty-state.tsx
- apps/tournament-web/src/components/empty-state.test.tsx
- apps/tournament-web/src/components/error-card.tsx
- apps/tournament-web/src/components/error-card.test.tsx
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

12 files. Additional files MAY be added during implementation only under `apps/tournament-web/**` and MUST be appended to this list before commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director).

### Debug Log References

(to be populated during dev-story + codex passes)

### Completion Notes List

(to be populated during dev-story)

### File List

(to be populated during dev-story)
