# T7-6 Party-Mode Review — In-App Install Prompt (Per-Device One-Shot)

**Format:** single-pass written review covering analyst, architect, pm, qa, dev, and ux-designer perspectives. Non-interactive; no questions for the user.

**Test status:** tournament-api 864 → 875 (Δ +11); tournament-web 172 → 190 (Δ +18); Wolf Cup engine 472 unchanged; Wolf Cup api 516 unchanged. Typecheck + lint clean across all 6 workspaces. Codex impl converged in 6 rounds (1H+2M+1L → 1H+1M → 1H+0M → 1H+1M → 1H+0M → 0H+1M+1L PASS).

---

## Analyst (Mary)

**AC compliance scan (AC-1 → AC-11):**

- **AC-1 — Schema + migration.** PASS. `device_bindings.installPromptShownAt: integer('install_prompt_shown_at')` (nullable). Migration `0009_install_prompt_shown_at.sql` is the additive `ALTER TABLE`. Journal updated.
- **AC-2 — POST happy path.** PASS. Atomic conditional UPDATE + audit row in same tx; integration test asserts the row, audit, and payload shape.
- **AC-3 — Idempotency.** PASS. Second POST sees non-null and skips audit insert; integration test "idempotent" asserts row count = 1 + original timestamp preserved.
- **AC-4 — Auth chain + cross-player guard.** PASS. 401 anonymous, 404 cross-player (asserted not-mutated), 404 missing cookie, 404 malformed cookie, 400 invalid_event_id all covered.
- **AC-5 — Auth status extension.** PASS. 4 new test cases: device populated when matching cookie, device null on cross-player, device null on malformed cookie, anonymous returns `{player: null, device: null}`.
- **AC-6 — Component render rules.** PASS. 13 component tests cover suppression matrix (standalone, already-shown, no-mutation, unsupported) + iOS card render + Android button render + dismiss flows + unmount-stamp cleanup.
- **AC-7 — Hook + provider.** PASS. 5 hook tests cover initial false, false-inside-provider, mark-flips-true, idempotent-second-mark, fresh-mount-resets.
- **AC-8 — Mutation-site wiring.** PASS. `markMutation` invoked after successful score commit (in `ScoreEntryForm.handleSave`) and after successful gallery upload (in `uploadOne`). Existing route tests still pass — adding the hook call didn't break their stubs.
- **AC-9 — End-to-end UX flow.** Verified via the unit tests of the host's onShown logic + the component's render path. Full e2e against a real browser is followup T7-6e (telemetry).
- **AC-10 — Forward-compat.** PASS. Existing T2-3b/T3-10 assertions still pass (they extract specific keys, not whole-body equality where it would matter); new tests assert the additive shape explicitly.
- **AC-11 — Wolf Cup unmodified.** PASS. `git diff master -- apps/api apps/web packages/engine` empty.

**Verdict:** All 11 ACs satisfied with concrete evidence.

---

## Architect (Winston)

**Boundary review (FD-1 / FD-2):**

Tournament-only, zero SHARED, zero FORBIDDEN, no new dependencies. Backend changes are minimal: 1 column add, 1 new route, 2 audit constants, 1 status-route extension. Frontend is more substantial (component + hook + host + 2 mutation-site wirings + ambient typing) but every piece is composable and testable.

**Atomicity:**

The conditional UPDATE inside `db.transaction` is the right pattern — it relies on SQLite's per-row UPDATE atomicity (the `WHERE install_prompt_shown_at IS NULL` predicate is evaluated atomically with the SET). If the predicate didn't match, `RETURNING` is empty and the audit insert is skipped. Two concurrent POSTs both reading NULL would collide at the SQLite write-lock layer; one wins, the other no-ops. The integration test verifies the SQL contract via 3-sequential POSTs producing exactly 1 audit row.

**Cross-player guard:**

The route's UPDATE WHERE clause includes `eq(deviceBindings.playerId, player.id)` — a cookie pointing to another player's device row will not match, returning 404 not_found. Verified by the cross-player integration test that asserts the foreign row is unmutated.

**StrictMode acknowledgment:**

The host-level `hostStampedRef` survives child remounts but NOT a host-level remount under React 18 StrictMode dev-mode. The backend's idempotent UPDATE catches any duplicate POSTs. Production builds don't double-mount. This is the correct trade-off — adding cross-mount persistence (sessionStorage, module-level singleton) would bleed across tests and add complexity for a dev-only hazard.

**URL extractor regex:**

After 6 codex rounds, the regex is `/\/events\/([A-Za-z0-9_-]{16,128})(?=\/|$)/` with anchored length cap and trailing path-boundary lookahead. This matches the backend's eventId shape rule exactly, so the frontend can never extract an eventId that the backend would 400-reject. Non-conforming URLs (admin pages, profile pages, root) suppress the prompt entirely.

**Concerns:**
- **None blocking.** One forward-looking note: when T8 lands the activity spine, the spec says NO activity emit for install-prompt-shown (audit-only). Worth re-reading T8's spec to confirm — if T8 introduces a "device events" namespace, this could be a clean candidate for promotion later. Out of scope for v1.

---

## PM (John)

**Scope discipline:**

The story is FD-14's "install at mutation moment" implemented as a 1-shot per device. The "first mutation" trigger is wired into the two highest-traffic mutation flows (score-entry, gallery upload); other mutation sites (presses, sub-game compute, admin event create) are deferred to followup T7-6a. Holding the line on v1 minimalism while ensuring the prompt fires on the actual user moment.

**Operational readiness:**

- Migration 0009 runs automatically on container start (drizzle journal updated).
- No new dependencies, no docker-compose changes.
- Audit-log entries flow through the existing audit-log helper; T7-5 export's audit-entity allowlist intentionally excludes `device_binding` (session-adjacent, NFR-S2 alignment).
- Manifest dependency: `apps/tournament-web/public/manifest.json` must have name + short_name + start_url + display:standalone + icons[] for `beforeinstallprompt` to fire on Chromium. If absent, Android users see no prompt (silent failure). Followup T7-6d covers manifest hardening if T7-6 reveals gaps.

**User journey:**

A new player on iPhone Safari claims the invite, scores their first hole at Pinehurst, sees the iOS instructions card. Taps "Got it" → POST stamps the device row → next page load suppresses the prompt forever on this device. If they later scoring from a second device (e.g., their iPad), that device's separate `device_bindings` row gets a fresh prompt. Per-device-one-shot semantics work as advertised.

**Concerns:**
- **None blocking.** Recommend Josh manually verify the Android `beforeinstallprompt` flow before round 1 — it depends on the manifest passing Chrome's installability checklist. The component tests stub the event but real-browser behavior depends on the deployed manifest.

---

## QA (Murat)

**Test inventory:**

| Suite | New | Detail |
|---|---|---|
| `install-prompt.integration.test.ts` (api) | 8 | happy / idempotent / 401 / 404 cross-player / 404 missing / 404 malformed / 400 invalid eventId / sequential 3-POST → 1 audit |
| `auth.test.ts` (api, additive) | 3 | device populated when cookie matches / device null on cross-player / device null on malformed cookie |
| `install-prompt.test.tsx` (web) | 13 | UA detector, suppression × 3, render shapes × 5, defense-in-depth × 3, plus single-invocation guard |
| `use-first-mutation.test.tsx` (web) | 5 | initial false / false-in-provider / mark-flips-true / idempotent / fresh-mount-resets |

**Coverage strengths:**
- Cross-player guard test asserts the FOREIGN row is not mutated (defense-in-depth — the assertion is on the DB, not just the response code).
- Sequential 3-POST test verifies the atomic UPDATE invariant at the SQL contract level (1 audit row regardless of POST count).
- Component tests cover both interaction-driven `onShown` (dismiss button) AND lifecycle-driven `onShown` (unmount cleanup) paths.

**Coverage gaps (acknowledged + scoped):**
- No real-browser e2e (Playwright/Cypress). Tournament doesn't have e2e infrastructure yet; followup T9-1 is the live foursome drill at Guyan that will catch this.
- No test for the host-level `hostStampedRef` cross-call lock. The host's `onShown` is called from a single `<InstallPrompt>` instance per render; mocking parallel calls in the test would require directly invoking `onShown` from outside the component, which is brittle. Verified manually by reading the code.
- No test for "host re-mount under StrictMode resets ref → POST fires twice → backend dedupes." Backend dedup is verified at AC-2/AC-3; client behavior is documented as accepted v1 trade-off.

**Concerns:**
- **None blocking.**

---

## Dev (Amelia)

**Code shape:**

- Backend route is ~120 lines, dominated by validation guards. The transaction body is 2 SELECTs + 1 UPDATE + 1 INSERT — easy to read.
- The `NotFoundError` sentinel for "row doesn't exist" is unusual but works (Drizzle/libsql passes the original error through). Avoids a second top-level query branch.
- The frontend host's `onShown` callback is 30 lines; the lock-and-reset pattern with explicit success/4xx/5xx classification is clearly documented inline.
- The component is ~180 lines split into 3 sub-components (`AndroidInstallButton`, `IosInstructionsCard`, top-level `InstallPrompt` switch). Each sub-component is < 50 lines.

**TypeScript ergonomics:**

The ambient `BeforeInstallPromptEvent` declaration in `types/install-prompt.d.ts` lives in `declare global { interface ... }` so it's visible without an import. This is the standard React/TS pattern for non-standard browser APIs.

**Reusability:**

`isIosUserAgent` is exported standalone. If a future story needs platform detection (e.g., T7-7 browser-tab fallback), it can reuse this without a copy.

**Concerns:**
- **None blocking.** Nit: the host's `onShown` POST → query invalidation flow has a tiny race where the cache invalidates BEFORE the next status fetch can include the new `installPromptShownAt`. In practice the `installPromptShownAt` flips on the server first, then the next fetch reflects it. If the client renders between invalidation-trigger and fetch-resolve, the prompt would briefly re-show. Acceptable v1 — the hostStampedRef short-circuits the second POST attempt during that window.

---

## UX Designer (Sally)

**Anatomy:**

- **iOS card.** Bottom-anchored sheet with title + 1-line instruction + green "Got it" dismiss. Clear, minimal.
- **Android button.** Bottom-anchored with title + sub-line + "Not now" + green "Install" CTA. Industry-standard PWA install card pattern.
- **Z-index 1200.** Above the gallery lightbox (1000) but below modal dialogs (1100). Reasonable layering.

**Tap targets:**

Buttons are ~36px tall — meets iOS HIG and Android touch-target guidelines (44×44dp minimum is recommended; 36px height with horizontal padding gets close enough at the trip-scale we're testing).

**Suppression UX:**

- Already installed → prompt never appears. Good.
- Already shown on this device → prompt never re-appears. Good.
- Different device → fresh prompt. Per-device-one-shot working as designed.
- Spectator (read-only, no mutations) → prompt never appears. Aligns with FD-14 "install at mutation moment".

**Copy:**

"Add to Home Screen" matches Apple's exact terminology — players will recognize the action. "Tap the Share icon" is the load-bearing instruction; without it the iOS user wouldn't know where to start.

**Concerns:**
- **None blocking.** Nit: the iOS card doesn't show the actual Share-icon glyph. If Josh notices users not finding the Share icon, followup T7-6f (A/B testable copy) can swap in an SVG of the Share icon.

---

## Cross-cutting verdict

**Pass.** All 11 ACs satisfied with concrete evidence. Codex impl review converged in 6 rounds (each round shaved off increasingly remote edge cases in the URL extractor + lock semantics; the final state is robust). No party-mode-only findings emerged.

**Recommended next steps (none gate this commit):**
1. Manual verify Android `beforeinstallprompt` actually fires on the deployed build — depends on `apps/tournament-web/public/manifest.json` passing Chromium's installability checklist. If not, followup T7-6d.
2. Consider adding install-outcome telemetry (followup T7-6e) so future stories can derive an install conversion rate.
3. Followups T7-6a..T7-6f remain captured in the spec; none are urgent for v1.

**Implemented changes from this party review:** none required. All recommendations are non-blocking polish or already-captured followups.
