# T1-3 Party-Mode Review — Tournament-web Scaffold

- **Generated:** 2026-04-20 (non-interactive, director-invoked)
- **Story:** `_bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md`
- **Implementation:** `apps/tournament-web/**` (17 source files) + `pnpm-lock.yaml` (SHARED, approval-gated)
- **Prior codex passes:** spec ×3 rounds (all clean), impl ×1 round (0 High, 1 Med, 2 Low — noted in Followups)
- **Verification:** tournament-web typecheck/lint/test/build all green. Wolf Cup regression: engine 468 ✅, api 429 ✅, tournament-api 19 ✅ — zero delta.

---

## Summary

Scaffold ships clean. The 17-file tree matches the spec's target shape. Dependency parity with `apps/web/package.json` holds verbatim (21/21 packages). The deliberate divergences from Wolf Cup (omitted `globIgnores`, distinct cache name, distinct theme color, added Vitest + dev-proxy config) are all justified and isolated to scaffold-hygiene decisions — no FD-1/FD-2 boundary violations, no FD-11/12 engine-boundary escape hatches. Party verdict leans **PASS-WITH-FOLLOWUPS**: the footprint is correct and future-proof, but three small concerns get logged for later attention (React Query Devtools in prod, smoke-test thinness, pre-existing Wolf Cup web typecheck drift).

---

## 📊 Mary — Analyst

*The treasure-hunter angle: what does this scaffold actually buy us, and what does it explicitly defer?*

**Near-term product fit.** T1-3 is foundation, not feature — the measure is whether Epic T2 (course library) and Epic T5 (scoring/offline) land cleanly on top. Evidence suggests yes:

- **Route tree slot is open.** Adding a new route is a single `src/routes/<name>.tsx` file; `tsr generate` picks it up. T2's `/admin/courses.new.tsx`, T3's `/invite.$token.tsx`, T5's `/rounds.$roundId.score-entry.tsx` all drop into the existing `src/routes/` structure without re-scaffolding.
- **Query wiring is plumbed.** `queryClient` is exported once from `src/lib/query-client.ts`; every future `useQuery` call in a route reaches into `QueryClientProvider` without the route needing to know the provider exists. Same pattern Wolf Cup uses across 20+ routes — proven at scale.
- **PWA is already "installable."** Manifest + SW are emitted on build; the placeholder icons are real 192×192/512×512 PNGs (not 1×1 stubs). Branding can replace them later without re-plumbing the manifest.
- **API proxy works in dev without CORS hacks.** `/api/*` → `localhost:3000` is wired at the Vite layer. T1-6 auth (cookies) and T2+ courses API calls will hit the proxy straight from `apiFetch` (once that file lands in a later story).

**Scope discipline.** The story ruthlessly defers everything that isn't scaffolding:
- No shadcn primitives (future UX story).
- No `src/lib/api.ts` (T1.6 or T2.5 — first API-calling route adds it).
- No `__root.tsx` chrome (Wolf Cup's 210-line header is intentionally NOT cloned).
- No Dockerfile (T1.4).
- No `PORTS.md` (first port in T5.2/T5.3 creates it).

**Scope gap I'd flag:** none material. The one surface you could argue is missing is `src/lib/env.ts` for Zod-validated Vite env access — but the spec explicitly defers this to T1.6, and there are zero current env vars to validate. Holding.

**Verdict:** T1-3 leaves the codebase in a more useful state than it started. No scope creep, no scope gap of consequence. ✅

---

## 🏗️ Winston — Architect

*Lean architecture: does the shipped shape match the documented architecture, and what does it foreclose?*

**Tech-stack alignment.** Architecture doc (lines 226–231) calls for React 19 + Vite 6 + TanStack Router 1.163 + TanStack Query 5.90 + Tailwind v4 via `@tailwindcss/vite` + `vite-plugin-pwa` + idb 8. All present, all at the specified major versions, all range-matching `apps/web/package.json`.

**Deliberate architecture divergences in the impl (all defensible):**
1. **No `postcss.config.js`, no `tailwind.config.ts`, no `tsconfig.node.json`.** Architecture doc lists these; Wolf Cup ships none. Tailwind v4's `@tailwindcss/vite` plugin is zero-config; Wolf Cup proved the shape. Call this an architecture-doc drift to reconcile later — not a T1-3 bug. Evidence-first: reality wins.
2. **Dropped `globIgnores: ['**/icon-*.png']`.** Codex spec-round-1 flagged Wolf Cup's config as self-contradicting (manifest references icons that SW precache excludes). Tournament drops it. This is a strict-correctness fix, not a divergence from intent. Small, isolated, defensible.
3. **Added `filename: 'sw.js'` + `injectRegister: 'auto'` explicitly.** Plugin defaults today, but pinned to immunize against future plugin-default changes. Good future-proofing.
4. **Added `server.proxy` block (Wolf Cup doesn't have one).** Necessary because the spec requires single-command dev against `tournament-api:3000`. Wolf Cup sidesteps this with a different dev topology. Tournament-explicit is correct.

**FD checkpoint:**
- **FD-1 (Wolf Cup isolation).** ✅ Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`. Only shared touch is `pnpm-lock.yaml` — unavoidable, approval-gated.
- **FD-2 (no Wolf Cup rename).** ✅ Tournament scaffolds at `apps/tournament-web/`, Wolf Cup untouched.
- **FD-11/12 (engine boundary — stableford only).** ✅ `no-restricted-imports` rule in `eslint.config.js` verbatim from tournament-api's rule. Empirically-verified negation pattern (T1-2 scratch test).
- **FD-14 (PWA-primary + install prompt).** ✅ Manifest + SW + icons in place. Install prompt UI is a later story (T7.6); T1-3 gives it the scaffold to hook into.

**Layering concerns I'd raise: zero.**
- No forward FKs (no schema at all; web only).
- No schema-not-yet-migrated traps.
- No architecture contradictions beyond the reconcilable-doc-drift items above.
- No premature services/engine/route-handler layering (no routes exist yet to mislayer).

**Architecture verdict:** clean scaffold on-pattern. ✅

---

## 📋 John — Product Manager

*WHY does this story matter, and does the shipped work let Epic T1 keep moving?*

**Story value delivered.** The PRD's success criterion "All 8 Pinehurst players use the app for all 4 rounds (May 7–10) instead of falling back to paper" depends on the tournament having *any* installable web surface. T1-3 ships the minimum installable PWA skeleton. That's load-bearing foundation — without it, T1-4 (docker+Traefik), T1-6 (auth), T5 (scoring) have no front-end to deploy. Story delivers the gate.

**AC structure.** 17 ACs, all Given/When/Then, mostly verifiable by running commands (typecheck, lint, test, build). Content-based checks for AC #15 (manifest branding + registration plumbing) use Node one-liners that work cross-platform — the round-2 and round-3 codex fixes tightened these specifically. Structure is tight.

**Unblocks downstream:**
- **T1-4 (docker-compose + Traefik):** needs `dist/` output shape to mount into nginx. ✅ Confirmed emitted.
- **T1-5 (CI dual-run):** needs `pnpm -F @tournament/web test/typecheck/lint/build` scripts to exist and exit 0. ✅ All present, all passing.
- **T1-6 (auth):** needs `QueryClientProvider` + `RouterProvider` wired so hooks like `useSession()` have context. ✅ Wired.
- **T2.5 (courses admin UI):** needs `src/routes/` shape so admin route drops in. ✅ Route scaffold present.

**PM footgun I'd flag:** The `ReactQueryDevtools` leaking into production bundles (impl-codex #1, Medium). This is a real user-visible concern — end users will eventually see the dev-tools floating button. The spec matched Wolf Cup 1:1 intentionally; Wolf Cup has the same issue. If we land it in tournament now and mirror-fix it back into Wolf Cup in a single follow-up, that's a cleaner sequencing than diverging at scaffold time. Accept as followup.

**PM verdict:** Delivers value. Unblocks T1-4/T1-5/T1-6/T2+. ✅

---

## 🧪 Quinn — QA

*Ship-it-and-iterate lens: is the scaffold tested enough to trust, and where are the holes?*

**Smoke test assessment.** One test (`src/lib/query-client.test.ts`) that verifies `queryClient` is a `QueryClient` instance with `{staleTime: 4000, gcTime: 300000, retry: 1}`. This is the **minimum defensible coverage for a scaffold**:
- Proves Vitest 3.x runner resolves modules.
- Proves TypeScript compiles under `moduleResolution: "Bundler"`.
- Proves the `@tanstack/react-query` import path works.
- Proves the exported config object has the documented defaults.

**What the smoke test does NOT cover:**
- No DOM render test. `__root.tsx` and `index.tsx` are unverified at test level (only at build level — `tsr generate && tsc --noEmit` proves they compile; `vite build` proves they bundle; nothing proves they render). **Acceptable at scaffold** because: (a) there's nothing product-specific to test yet, (b) adding `jsdom` + `@testing-library/react` adds ~40MB to devDeps for no immediate value, (c) T5.2+ scorer UI is the first story where DOM tests earn their keep.
- No vite.config.ts validation. The plugin order + proxy config only get exercised by running `vite dev` or `vite build`. Build passes, so plugins load correctly.
- No PWA installability test. Lighthouse / manifest validator not wired into CI. Low-risk at scaffold — AC #15 content checks catch the branding drift that matters most.

**Risk assessment on the three impl-codex Medium/Low findings:**
1. **RQ Devtools in prod (M).** Real concern — bundles include devtools UI. Not a functional bug; a production-hygiene issue. Bundle-size delta is ~0.12kB → 313kB (Devtools adds meaningfully more than the visible footprint). Mitigation: a dedicated hardening story, mirror-back to Wolf Cup. **Do not block T1-3 commit.**
2. **`changeOrigin: false` (L).** Only matters if/when tournament-api inspects the Host header. Currently doesn't. Re-evaluate at T1.6 when cookies land.
3. **PWA dev SW enabled (L).** Standard Wolf Cup pattern; known devex papercut but isolated. `clientsClaim + skipWaiting` mitigates staleness on reload. Acceptable.

**Placeholder icons.** They're proper-dimensions PNGs (192×192, 512×512), solid slate-900 fill. Lighthouse install-prompt checks: manifest has name/icons/start_url/display → PASS. Branding PASS on name+theme_color. No rejection risk from validators. Only cosmetic concern — they're boring slate squares. That's deliberate.

**Pre-existing Wolf Cup web typecheck failure.** Verified-pre-existing via `git stash -u` + isolated re-run. FORBIDDEN path (`apps/web/**`). T1-3 correctly did NOT cross the boundary. Noted in Followups. **Separate concern from T1-3 — should not block the commit.**

**QA verdict:** Adequate coverage for a scaffold. Testing debt is named and deferred to the right stories. ✅

---

## 💻 Amelia — Dev

`apps/tournament-web/package.json` — parity ✅ (21/21, excluding `vitest`).
`apps/tournament-web/vite.config.ts:10-62` — plugin order correct, PWA config pinned, proxy config present.
`apps/tournament-web/eslint.config.js:14-24` — engine-boundary rule byte-matches `apps/tournament-api/eslint.config.js:14-24`.
`apps/tournament-web/src/main.tsx:10-18` — router type registration present (required for TanStack Router type safety).
`apps/tournament-web/src/lib/query-client.test.ts:7-14` — AC #12 smoke test, 1 test passing 1ms.

**Build artifacts verified:**
```
dist/registerSW.js        0.13kB
dist/manifest.webmanifest 0.42kB   name=Tournament, theme_color=#0f172a
dist/index.html           0.90kB   references registerSW + workbox-window
dist/sw.js                (emitted)
dist/workbox-321c23cd.js  (emitted, hash filename per plugin default)
dist/icon-192.png         593 bytes
dist/icon-512.png         2201 bytes
dist/assets/index-*.css + dist/assets/index-*.js
```

**Commit scope clean:**
```
 M  _bmad-output/implementation-artifacts/tournament/sprint-status.yaml       ALLOWED
 M  pnpm-lock.yaml                                                            SHARED (approval pending)
 ?? _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-*.md       ALLOWED
 ?? _bmad-output/reviews/T1-3-scaffold-*-codex*.md                            ALLOWED (×3 spec + ×1 impl)
 ?? apps/tournament-web/**                                                    ALLOWED (17 source files)
```
No FORBIDDEN writes. One SHARED (`pnpm-lock.yaml`) needs explicit stage approval.

**Footguns I see that prior codex passes did not flag:**
None. Spec-round-3 already resolved the AC-15 brittleness (filename pinning + behavioral content checks). Impl-round impl-codex flagged the Devtools-in-prod which is Wolf Cup parity; flagging the proxy Host semantics which is documented and deferred; flagging the dev-SW which is Wolf Cup pattern. Nothing novel surfaces here.

**Unstable patterns:** none.

**Dev verdict:** Code builds, runs, passes. Ship it. Apply pnpm-lock approval + stage-and-commit per director protocol. ✅

---

## Consolidated findings

| # | Severity | Agent(s) | Concern | Suggested action |
|---|----------|----------|---------|------------------|
| 1 | Medium | PM, QA | `<ReactQueryDevtools />` rendered unconditionally — ships in prod bundles and exposes a debug UI to end users. Matches Wolf Cup 1:1 per AC #8. | Defer to a dedicated tournament hardening story that guards it behind `import.meta.env.DEV` in `apps/tournament-web/src/main.tsx` only (ALLOWED path). Fixing Wolf Cup's equivalent is a separate Wolf Cup backlog item — do NOT bundle across allowlist boundaries. Noted in story Followups. Do NOT block T1-3. |
| 2 | Low | QA, Dev | Vite dev proxy `changeOrigin: false`. Irrelevant today; relevant when tournament-api sets Host-scoped cookies (T1.6+). | Re-evaluate at T1.6 (auth). Noted in Dev Notes + Followups. Do NOT block T1-3. |
| 3 | Low | QA | `VitePWA.devOptions.enabled: true` — SW runs during `vite dev`, can cause stale-asset devex papercuts. | Keep for now (Wolf Cup parity). If it bites during T5 scorer-UI dev, flip behind an env flag. Noted in Followups. Do NOT block T1-3. |
| 4 | Info | Architect, QA | Pre-existing `apps/web/src/routes/standings.tsx:480` typecheck error surfaces under `pnpm -r typecheck`. FORBIDDEN path — T1-3 correctly didn't touch it. Verified pre-existing by stash+re-run. | Separate Wolf Cup followup. Already logged in T1-3 story Followups. NOT a T1-3 regression. |
| 5 | Info | Architect | Architecture doc lists `postcss.config.js`, `tailwind.config.ts`, `tsconfig.node.json` as target files; Wolf Cup ships none (Tailwind v4 zero-config). T1-3 follows Wolf Cup reality. | Reconcile architecture doc in a future docs-sync pass. Not a T1-3 blocker. |

**No High findings. No codex-High user-decision findings. Zero open questions to the user on technical scope.** *(One procedural gate remains: explicit user approval to stage `pnpm-lock.yaml` — a SHARED-path requirement that is structural to the director protocol, not a content question about the code.)*

---

## Verdict: PASS-WITH-FOLLOWUPS

T1-3 is ready to commit after:
1. Explicit user approval to stage `pnpm-lock.yaml` (SHARED path, pending since impl).
2. Final commit + status flip to `done`.

Followups 1–3 above are logged in the story file; follow-ups 4–5 are cross-cutting and deferred to their proper homes (Wolf Cup web backlog, architecture-doc reconciliation). None block the T1-3 commit.

Party out. 🎉
