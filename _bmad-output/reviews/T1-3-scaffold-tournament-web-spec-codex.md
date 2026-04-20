# Codex Review

- Generated: 2026-04-20T15:21:03.346Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md

## Summary

Spec is detailed and mostly implementable within the allowed paths, with good guardrails against touching Wolf Cup. Main risks are (1) brittle/possibly incorrect assumptions about vite-plugin-pwa emitted artifact names/registration behavior, (2) a Workbox config that explicitly excludes the very icons referenced by the manifest, and (3) hardcoded “match Wolf Cup exactly” versions that could drift and cause dev to follow the spec yet fail the real parity requirement.

Overall risk: medium

## Findings

1. [high] PWA build artifact expectations are brittle; spec doesn’t pin the config needed to guarantee `registerSW.js`/`sw.js` output names
   - File: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md:72-153
   - Confidence: medium
   - Why it matters: AC #15 requires `dist/` to contain specific filenames (`manifest.webmanifest`, `sw.js`, `registerSW.js`, `workbox-*.js`). In vite-plugin-pwa, emitted filenames and whether `registerSW.*` is generated depends on configuration (e.g., `injectRegister` behavior) and plugin defaults that can change across versions. The story also claims the plugin “auto-imports” registration without specifying `injectRegister` (Dev Notes line ~220), which is easy for an implementer to misinterpret and may lead to no registration script being emitted/linked, or different filenames (e.g., `.mjs`). That can cause AC failures or a PWA that builds but doesn’t register a SW as expected.
   - Suggested fix: Make AC #7 explicitly set the options that guarantee the expected outputs, or relax AC #15 to verify behavior rather than filenames. Concretely: add `injectRegister: 'auto'` (or whatever Wolf Cup uses) and, if you truly require exact filenames, also set `filename: 'sw.js'` and `injectManifest`/`strategies` choices explicitly. Alternatively, change AC #15 to assert that `manifest.webmanifest` exists and that a service worker file exists (pattern match), rather than exact names.

2. [high] Workbox precache config explicitly ignores `icon-*.png` while manifest references those icons
   - File: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md:77-79
   - Confidence: high
   - Why it matters: AC #7 sets `globPatterns` to include `png` but then sets `globIgnores: ['**/icon-*.png']` (line 78), while the manifest icons are exactly `/icon-192.png` and `/icon-512.png` (line 77). That means the service worker precache will intentionally omit the app icons even though they’re core PWA assets. This can produce confusing offline/first-load behavior (icons missing until fetched online), and it’s at odds with AC #15 expecting those icons to be part of the built output and part of the PWA experience.
   - Suggested fix: Remove the `globIgnores` for `icon-*.png`, or document why excluding them is desired and ensure offline expectations match. If the intent is to avoid double-caching, consider leaving them precached (typical) and instead control caching via `maximumFileSizeToCacheInBytes` or by limiting glob patterns.

3. [medium] Hardcoded dependency versions conflict with “match Wolf Cup exactly” if Wolf Cup changes; spec should direct copying from source of truth at implementation time
   - File: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md:17-40
   - Confidence: high
   - Why it matters: AC #1 requires exact version parity with `apps/web/package.json`, but the story also hardcodes a full version list. If Wolf Cup’s versions differ (now or by the time a dev-agent runs), an implementer can follow the spec verbatim and still fail the actual parity requirement. This is especially likely for fast-moving packages like Vite/TanStack Router/React Query.
   - Suggested fix: Change AC #1 to: “copy the dependency and devDependency version ranges directly from `apps/web/package.json` at implementation time,” optionally listing the expected package set (names) but not pinning the numeric versions in the story text. Or add a required verification step: diff `apps/tournament-web/package.json` vs `apps/web/package.json` for those keys and fail if any mismatch.

4. [medium] ESLint config description likely contains a copy/paste/logic error (`recommended` spread twice) and may mislead implementers
   - File: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md:123-138
   - Confidence: medium
   - Why it matters: AC #10 describes exporting `tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, ...)` (line 125), which appears to include the same config twice. If an implementer follows this literally and it’s not actually what tournament-api uses, lint behavior could diverge (or the config could be subtly wrong), undermining the “identical to tournament-api” requirement for the boundary guardrail.
   - Suggested fix: Instead of describing the full ESLint config structure loosely, require copying `apps/tournament-api/eslint.config.js` structure verbatim and only adjusting what must differ (e.g., ignore paths). If the duplication is intentional, explicitly say so and why; otherwise correct it to the intended config chain.

5. [low] Proxy `changeOrigin` explanation conflates Host rewriting with CORS/Origin behavior; may cause later confusion for auth/cookies
   - File: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md:61-214
   - Confidence: high
   - Why it matters: The spec’s rationale implies `changeOrigin: true` would rewrite “origin” (line 214), but Vite’s `changeOrigin` primarily affects the proxied `Host` header. This won’t break the scaffold, but it can mislead future work (especially if cookie domain/secure flags or absolute redirects become relevant), and it may cause incorrect debugging assumptions.
   - Suggested fix: Tighten the wording: describe Host header rewriting (not browser Origin). Optionally add a note: if API sets cookies or does host-based redirects, you may need `changeOrigin: true` and/or `cookieDomainRewrite`.

## Strengths

- Clear path isolation intent (no writes outside `apps/tournament-web/**` except lockfile) and explicit lockfile approval gate (lines 194-199, 218).
- Explicitly calls out divergences from architecture.md to match Wolf Cup’s proven Tailwind v4 zero-config shape (lines 212-213).
- Good forward-reference avoidance: minimal routes, no Dockerfile, no premature API client, no UI chrome (lines 219-223, 222).
- Typecheck script includes `tsr generate` to avoid routeTree drift, and lint explicitly ignores the generated route tree (lines 53-55, 138).
- Engine boundary rule is precisely specified and aligned with the empirically-verified negation pattern from T1-2 (lines 125-137).

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md
