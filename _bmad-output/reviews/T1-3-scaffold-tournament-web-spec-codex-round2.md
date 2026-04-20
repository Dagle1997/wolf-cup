# Codex Review

- Generated: 2026-04-20T15:25:01.204Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md

## Summary

Round-1 fixes mostly land well: pinning `filename: 'sw.js'` + `injectRegister: 'auto'` is internally consistent, and removing `globIgnores` resolves the manifest/icon self-contradiction without meaningfully impacting precache size (it only adds two PNGs). The remaining issues are primarily around AC #15 being *practically verifiable* and not accidentally specifying checks that can’t work (service workers + file://) or that may be brittle/portable only on certain shells.

Overall risk: high

## Findings

1. [high] AC #15 suggests verifying SW registration by “opening dist/index.html”, which will fail if interpreted as file:// (service workers require secure context)
   - File: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md:155-165
   - Confidence: high
   - Why it matters: A dev-agent (or reviewer) may literally open `apps/tournament-web/dist/index.html` from the filesystem. Service workers generally cannot register on `file://` origins; they require HTTPS or `http://localhost`. That makes the stated behavioral verification non-actionable and risks false failures even when the build is correct.
   - Suggested fix: Change the verification to explicitly use a server, e.g. `pnpm -F @tournament/web preview` and then visit the printed localhost URL (or serve `dist/` via a simple static server). Phrase it as: “When served over http://localhost (via vite preview), the page registers the SW without console errors.”

2. [medium] The grep-based “registration plumbing” verification is not reliably portable/verifiable as written (globstar + grep regex portability)
   - File: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md:162-165
   - Confidence: high
   - Why it matters: `grep -l ... dist/**/*.html dist/**/*.js` depends on shell globstar expansion (`**`) and on GNU grep’s `\|` alternation semantics. On many environments (Windows PowerShell/cmd, bash without `globstar`, BSD grep), this command can return no matches or error even when registration injection is present, undermining AC #15’s “behavioral form still verifiable” goal.
   - Suggested fix: Use a tool/command that is explicitly cross-platform in your repo context (e.g., `rg -l "registerSW|workbox-window" apps/tournament-web/dist` if ripgrep is available), or use `find`/`xargs` with `grep -E`. Alternatively, assert a simpler invariant: `index.html` contains a script reference to a generated registration asset (pattern-based), and `dist/sw.js` exists.

3. [medium] AC #15 requires a `workbox-*.js` runtime chunk, which may not be stable across vite-plugin-pwa/workbox configuration changes
   - File: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md:155-163
   - Confidence: medium
   - Why it matters: Even if you avoid literal filenames, asserting that a separate `workbox-*.js` file exists is still an implementation-detail assumption (some modes/configs inline workbox runtime, change naming, or emit different chunking). This can cause avoidable test/acceptance churn on plugin upgrades—exactly what Round-1 was trying to reduce.
   - Suggested fix: Make this check behavioral like the others: e.g., assert `dist/sw.js` contains references consistent with workbox precaching/runtime caching (or assert that the build output contains *either* a `workbox-*.js` chunk *or* `sw.js` includes workbox runtime markers). If you keep it file-based, loosen to “service worker and its dependencies emitted successfully” without naming `workbox-*`.

4. [medium] Workbox `globPatterns` omits `*.webmanifest`, so the manifest may not be precached for offline scenarios
   - File: _bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md:81-83
   - Confidence: medium
   - Why it matters: You explicitly enumerate `globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}']`. That excludes `manifest.webmanifest`. If the intent is an installable/offline-friendly PWA skeleton, excluding the manifest from precache is an easy footgun (especially since AC #15 also treats the manifest as a key artifact).
   - Suggested fix: Consider adding `webmanifest` (and possibly `json`) to `globPatterns`, e.g. `**/*.{js,css,html,ico,png,svg,woff,woff2,webmanifest}`. If you intentionally don’t want it precached, call that out explicitly to avoid confusion.

## Strengths

- Pinning `filename: 'sw.js'` + `injectRegister: 'auto'` is internally consistent and removes the prior brittleness around default SW naming/registration injection behavior (AC #7 + #15).
- Dropping `globIgnores` cleanly resolves the manifest/icon contradiction; precache size impact is negligible at scaffold time (two placeholder PNGs).
- AC #1 now clearly establishes `apps/web/package.json` as the source of truth and adds an explicit parity-verification step (7.1a), which is actionable for a dev-agent and reduces version drift risk.

## Warnings

None.
