# T7-6: In-App Install Prompt (Per-Device One-Shot, FD-14)

## Status

ready-for-dev

## Story

As a player making my first successful mutation from a specific device, I want the app to surface an in-app install prompt appropriate to my platform, so that I install the PWA at the moment of my first-commit dopamine hit — and a player who uses two devices gets prompted once per device, not suppressed after the first device (FR-E8, FD-14).

## v1 Scope

The "install prompt" is a tiny UI surface (iOS Add-to-Home-Screen card OR Android `beforeinstallprompt` button) that appears ONCE per (player, device) pairing, gated behind:
1. The PWA is not already installed on this device.
2. The current `device_bindings.install_prompt_shown_at` is NULL (per-device one-shot).
3. The player has just completed at least one successful mutation in this session (first-commit dopamine hit).
4. The platform supports prompting (iOS 16+ Safari OR Android Chrome with a stored `beforeinstallprompt` event).

The prompt is dismissible. On dismiss OR auto-display, the client POSTs to a new endpoint that stamps `device_bindings.install_prompt_shown_at = now()` and writes an audit row. Subsequent loads on the same device suppress the prompt forever; the player's OTHER device (separate `device_bindings` row) gets a fresh prompt on its first mutation.

### Backend additions

**1. Schema migration `0009_install_prompt_shown_at.sql` — additive:**

```sql
ALTER TABLE `device_bindings` ADD `install_prompt_shown_at` integer;
```

Drizzle schema update at `apps/tournament-api/src/db/schema/device_bindings.ts`:
```ts
installPromptShownAt: integer('install_prompt_shown_at'),  // nullable; ms-since-epoch
```

**2. New POST endpoint `POST /api/events/:eventId/devices/me/install-prompt-shown`:**

- Auth chain: `requireSession` only. Any authenticated player may stamp their own device. **`requireEventParticipant` is intentionally NOT in the chain** — `:eventId` is informational/audit-payload only; the prompt-shown action is per-(player, device), not per-event. A spectator browsing the read-only event page should not have stamping fail because of participant membership.
- **`:eventId` shape validation (codex spec round-1 Med #4).** Even though `:eventId` is audit-payload only and never queried against the events table, it MUST pass a defense-in-depth shape guard before being stored: `/^[A-Za-z0-9_-]+$/` AND length 16-128 (UUID-shape lite, mirrors the cookie guard in `require-session.ts:40`). Anything off-shape → 400 `{ error: 'invalid_event_id', requestId }`. Prevents an attacker from stuffing arbitrary text (XSS payloads, oversized strings, control characters) into the audit log's `payload_json`. Existence in the events table is NOT verified — that would require an extra query for a value that's purely diagnostic.
- Resolves the current device by reading the `tournament_device_id` cookie (set by T3-6/T3-7).
- Looks up the device_bindings row by `(id = cookieValue, player_id = session.player.id, tenant_id = TENANT_ID)`. **Player-scoped match is load-bearing** — without it, an attacker holding another player's device cookie could stamp a foreign row. The session's player_id is the trust anchor; the device cookie is just a hint at which row.
- If the device cookie is missing OR the row does not match the session player → 404 `{ error: 'device_binding_not_found', requestId }`. (Not 403 — the cookie is informational, not a permission claim.)
- **Atomic conditional UPDATE + audit (codex spec round-1 High #1).** Inside a single `db.transaction`:
  1. Run `UPDATE device_bindings SET install_prompt_shown_at = ? WHERE id = ? AND player_id = ? AND tenant_id = ? AND install_prompt_shown_at IS NULL RETURNING id` with `Date.now()` as the timestamp (Drizzle: `.update(deviceBindings).set({ installPromptShownAt: nowMs }).where(and(eq(...), isNull(deviceBindings.installPromptShownAt))).returning({ id: deviceBindings.id })`).
  2. If `returning` is empty → either the row doesn't exist (handled in the prior lookup) or it was already stamped (idempotent path — return 204 without writing an audit row).
  3. If `returning` has 1 row → the UPDATE flipped the column from NULL to `nowMs` THIS request; write the audit row inside the same transaction. Two concurrent POSTs both reading NULL will see exactly ONE win the conditional UPDATE; the loser sees 0 rows returned and skips the audit insert. No duplicate audit, no over-write.
- Return 204 either way (success-or-already-stamped is the same to the client).
- Body: empty. Response: 204 on success, 404 on missing/cross-player, 401 on no session.
- Audit: `eventType = 'install_prompt.shown'`, `entityType = 'device_binding'`, `entityId = deviceBinding.id`, `actorPlayerId = session.player.id`, `payload = { eventId, deviceBindingId }`.
- **No activity emit** — this is audit-only per the epic AC ("install-prompt-shown is audit-only per Codex finding; it lives in `audit_log`, not the activity spine").
- The route file: `apps/tournament-api/src/routes/install-prompt.ts` exporting `installPromptRouter`. Mounted in `app.ts` as `app.route('/api/events', installPromptRouter)` so the effective URL is `/api/events/:eventId/devices/me/install-prompt-shown`.

**3. Audit constant additions at `apps/tournament-api/src/lib/audit-log.ts`:**

```ts
AUDIT_EVENT_TYPES: add INSTALL_PROMPT_SHOWN = 'install_prompt.shown'.
AUDIT_ENTITY_TYPES: add DEVICE_BINDING = 'device_binding'.
```

**Schema-level constraint posture (codex spec round-1 Med #3).** `audit_log.entity_type` is a `text` column with NO `CHECK IN (...)` constraint at the SQL layer (verified at `apps/tournament-api/src/db/schema/audit.ts:26-50`). The allowlist is enforced purely by the `AUDIT_ENTITY_TYPES` TypeScript constants and `AuditEntityType` union; callers MUST go through the `writeAudit` helper which is typed `entityType: AuditEntityType`. T7-4 added `GALLERY_PHOTO` via the same path with no migration needed. So adding `DEVICE_BINDING` is a pure constant + type-union addition — no DB migration, no constraint rewrite. The existing T7-5 export's `SCOPED_AUDIT_ENTITY_TYPES` filter does NOT yet include `device_binding` (since install-prompt audits are session-adjacent, like the SESSION type which T7-5 also excluded per NFR-S2); leaving it excluded keeps install-prompt audits out of event exports — appropriate since the event_id in the payload is informational rather than the row's true scope.

**Timestamp source-of-truth (codex spec round-1 Med #2).** All persistence uses `Date.now()` from JavaScript (integer ms-since-epoch UTC), matching the rest of tournament-api (gallery upload's `uploadedAt`, T7-5 export's serializer). NO use of SQL `now()` — SQLite's CURRENT_TIMESTAMP returns a string, not an integer, and would mismatch the integer-ms convention every other column uses. The audit row's `createdAt` field is also `Date.now()` per the existing `writeAudit` helper.

**4. Auth status extension at `apps/tournament-api/src/routes/auth.ts` (GET `/api/auth/status`):**

When the cookie `tournament_device_id` is present AND validates to a device_bindings row matching the current session's player + tenant, the response gains a `device` object:

```ts
{
  player: { ... existing ... },
  device: {
    id: string,
    installPromptShownAt: number | null,   // ms-since-epoch UTC
  } | null,
}
```

When the device cookie is absent OR the lookup fails (cross-player, deleted row, malformed cookie) → `device: null`. Existing T2-3b / T3-10 callers ignore unknown keys (forward-compat verified at spec-time) so this addition does not break them.

### Frontend additions

**5. New `<InstallPrompt>` component at `apps/tournament-web/src/components/install-prompt.tsx`:**

Self-contained component receiving four props:
```ts
type InstallPromptProps = {
  installPromptShownAt: number | null;
  hasMutatedThisSession: boolean;
  isStandalone: boolean;       // window.matchMedia('(display-mode: standalone)').matches
  beforeInstallEvent: BeforeInstallPromptEvent | null;  // null on iOS Safari (the API doesn't exist there)
  onShown: () => void;          // POST + invalidate auth-status query
};
```

Render rules:
- If `isStandalone === true` → render `null` (already installed, see T7.7 detection).
- If `installPromptShownAt !== null` → render `null` (already shown on this device).
- If `hasMutatedThisSession === false` → render `null` (no mutation yet).
- Else, platform detection:
  - If `beforeInstallEvent !== null` (Android Chrome / Edge / desktop Chromium with the manifest) → render an "Install" button. On click, call `beforeInstallEvent.prompt()`; await `userChoice`; call `onShown()` regardless of accept/dismiss (per Android UX convention — once they've seen the system prompt, they have decided).
  - Else if iOS-likely (`/iPad|iPhone|iPod/i.test(navigator.userAgent) && !window.MSStream`) → render a small instructions card: `Tap the Share icon → "Add to Home Screen"`. Includes a "Got it" dismiss button. Either dismiss action calls `onShown()`.
  - Else → render `null` (unsupported platform; e.g., Firefox Android, desktop Safari without manifest support).
- Component sets a one-shot `useEffect` that calls `onShown()` on unmount IF the user has neither accepted nor dismissed (defense-in-depth: any render of the prompt counts as "shown" for backend stamping). This guarantees the per-device one-shot invariant even if the user closes the tab without interacting.
- **Single-invocation guard (codex spec round-2 Med #2).** The component holds `const hasStampedRef = useRef(false)` and a `function stampOnce()` that early-returns when `hasStampedRef.current === true`, otherwise sets it to `true` AND invokes `props.onShown()`. EVERY path that calls `onShown` (the dismiss button, the `prompt()` resolution, the unmount cleanup, the catch-block fallback) goes through `stampOnce`. The endpoint is also idempotent (AC-3) — but the client guard prevents the wasted POST and matches the "stamped once per render lifecycle" semantics. React 18 strict-mode double-mount in dev would otherwise fire the unmount-stamp twice; the ref guard handles that too.

**6. New `useFirstMutationFlag` hook + provider at `apps/tournament-web/src/hooks/use-first-mutation.tsx`:**

```ts
export const FirstMutationContext = createContext<{
  flag: boolean;
  markMutation: () => void;
}>({ flag: false, markMutation: () => {} });

export function FirstMutationProvider({ children }) {
  const [flag, setFlag] = useState(false);
  const markMutation = useCallback(() => setFlag(true), []);
  return <FirstMutationContext.Provider value={{ flag, markMutation }}>{children}</FirstMutationContext.Provider>;
}

export function useFirstMutationFlag() { return useContext(FirstMutationContext).flag; }
export function useMarkMutation() { return useContext(FirstMutationContext).markMutation; }
```

The flag is **session-scoped** (resets on a hard reload). The persistence is on the server via `device_bindings.install_prompt_shown_at`; the in-memory flag is just the trigger for the "first mutation in this session" gate. After the first call to `markMutation`, the flag stays `true` for the session.

**7. Beforeinstallprompt capture at `apps/tournament-web/src/main.tsx` (or root tree):**

A top-level `useEffect` (or a non-hook listener wired before React hydration) installs `window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__deferredInstallPrompt = e; })`. The captured event is then passed down via a tiny store / context. **Window-typed augmentation:** add `apps/tournament-web/src/types/install-prompt.d.ts` with the `BeforeInstallPromptEvent` interface declaration + a `Window` extension `__deferredInstallPrompt?: BeforeInstallPromptEvent`. (Browsers without the API leave `window.__deferredInstallPrompt` permanently undefined; iOS Safari falls into the iOS-instructions branch.)

**Event lifecycle / staleness (codex spec round-1 Low #6 + round-2 Med #1).** Per Chrome's docs, the `beforeinstallprompt` event fires once per page-load when the manifest passes installability criteria; the event becomes invalid once the user accepts/dismisses, navigates away, OR the SPA re-renders past the registration. The handler MUST clear `window.__deferredInstallPrompt = undefined` after `prompt()` resolves (success or dismissal) to avoid re-using a stale event. Re-firing in the same SPA session is impossible without a hard reload.

The `<InstallPrompt>` component reads the global at mount time; if a future re-render uses a stale reference, `prompt()` would throw. The catch-block fallback is **platform-aware**: render the iOS instructions card ONLY when the iOS UA regex still matches; otherwise render `null`. The fallback MUST NOT show iOS-shaped instructions to a non-iOS user just because the Android prompt failed (codex spec round-2 Med #1). Sketch:

```ts
try {
  const userChoice = await beforeInstallEvent.prompt();
  window.__deferredInstallPrompt = undefined;
  onShown();
} catch {
  if (isIosUserAgent(navigator.userAgent)) {
    setShowIosFallback(true);
  } else {
    onShown();   // suppress and stamp; null render
  }
}
```

**8. `__root.tsx` integration:**

Wraps the existing route tree with `<FirstMutationProvider>`. Renders `<InstallPromptHost>` (a tiny wrapper that pulls auth-status + reads the `__deferredInstallPrompt` + the matchMedia signal + the flag, then conditionally renders `<InstallPrompt>`). Calling `onShown` from `<InstallPromptHost>` POSTs to the install-prompt-shown endpoint AND invalidates the auth-status query.

**9. Wiring into mutation sites:**

In v1, the two mutation flows that fire `markMutation()` after a 200 response are:
- `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx` — after a successful `POST /api/rounds/:roundId/scores` (T5-6 happy path).
- `apps/tournament-web/src/routes/events.$eventId.gallery.tsx` — after a successful upload (T7-4 `POST /api/events/:eventId/gallery`, branch in `uploadOne` after 200).

Other mutation sites (T6-7 manual presses, T6-13 sub-game compute, admin event create, etc.) are **explicitly deferred** to followup T7-6a — the v1 surface is "the player's two most-likely first interactions." If Josh notices a player not getting the prompt, the followup adds the missing call site. The provider is global so adding new call sites is a one-liner.

### Cookie / cross-tenant safety

- The install-prompt endpoint reads the device cookie via `c.req.header('cookie')` and the same `extractCookie` helper used by `require-session.ts`. No new cookie code.
- Cookie value validation: matches `^[A-Za-z0-9_-]+$` and length 16-128 (UUID-shape lite). Anything off-shape → 404 (treat as no cookie).
- Tenant scoping on the device_bindings UPDATE + audit insert. Mirrors the existing T3-7 rebind tenant-scoped pattern (`apps/tournament-api/src/routes/auth.ts:391-400`).
- Auth-status `device` extension applies the same shape guards: malformed cookie → `device: null`, cross-player row → `device: null`. Never throws.

## Path footprint

### ALLOWED — Tournament-scoped (write freely)

```
apps/tournament-api/src/db/schema/device_bindings.ts                                [MODIFIED — add column]
apps/tournament-api/src/db/migrations/0009_install_prompt_shown_at.sql              [NEW — drizzle output, renamed from auto-name]
apps/tournament-api/src/db/migrations/meta/_journal.json                            [MODIFIED — append entry]
apps/tournament-api/src/db/migrations/meta/0009_snapshot.json                       [NEW — drizzle emits]
apps/tournament-api/src/lib/audit-log.ts                                            [MODIFIED — add INSTALL_PROMPT_SHOWN + DEVICE_BINDING]
apps/tournament-api/src/routes/install-prompt.ts                                    [NEW]
apps/tournament-api/src/routes/install-prompt.integration.test.ts                   [NEW]
apps/tournament-api/src/routes/auth.ts                                              [MODIFIED — extend /status with device]
apps/tournament-api/src/routes/auth.test.ts                                         [MODIFIED — assert device extension]
apps/tournament-api/src/app.ts                                                      [MODIFIED — mount install-prompt router]
apps/tournament-web/src/components/install-prompt.tsx                               [NEW]
apps/tournament-web/src/components/install-prompt.test.tsx                          [NEW]
apps/tournament-web/src/hooks/use-first-mutation.tsx                                [NEW]
apps/tournament-web/src/hooks/use-first-mutation.test.tsx                           [NEW]
apps/tournament-web/src/types/install-prompt.d.ts                                   [NEW — Window + BeforeInstallPromptEvent typing]
apps/tournament-web/src/routes/__root.tsx                                           [MODIFIED — wrap with FirstMutationProvider + add InstallPromptHost]
apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx                      [MODIFIED — call markMutation on score-commit success]
apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx                 [MODIFIED — assert markMutation fires on success]
apps/tournament-web/src/routes/events.$eventId.gallery.tsx                          [MODIFIED — call markMutation on upload success]
apps/tournament-web/src/routes/events.$eventId.gallery.test.tsx                     [MODIFIED — assert markMutation fires on upload success]
_bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md  [THIS FILE]
```

10 NEW + 10 MODIFIED. All under `apps/tournament-*/`. (Two extra test-file modifications for AC-8 coverage per codex spec round-1 Med #5.)

### Files this story will edit

```
apps/tournament-api/src/db/schema/device_bindings.ts
apps/tournament-api/src/db/migrations/0009_install_prompt_shown_at.sql
apps/tournament-api/src/db/migrations/meta/_journal.json
apps/tournament-api/src/db/migrations/meta/0009_snapshot.json
apps/tournament-api/src/lib/audit-log.ts
apps/tournament-api/src/routes/install-prompt.ts
apps/tournament-api/src/routes/install-prompt.integration.test.ts
apps/tournament-api/src/routes/auth.ts
apps/tournament-api/src/routes/auth.test.ts
apps/tournament-api/src/app.ts
apps/tournament-web/src/components/install-prompt.tsx
apps/tournament-web/src/components/install-prompt.test.tsx
apps/tournament-web/src/hooks/use-first-mutation.tsx
apps/tournament-web/src/hooks/use-first-mutation.test.tsx
apps/tournament-web/src/types/install-prompt.d.ts
apps/tournament-web/src/routes/__root.tsx
apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx
apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx
apps/tournament-web/src/routes/events.$eventId.gallery.tsx
apps/tournament-web/src/routes/events.$eventId.gallery.test.tsx
_bmad-output/implementation-artifacts/tournament/T7-6-in-app-install-prompt-per-device-one-shot.md
```

### SHARED — none expected

No `pnpm-lock.yaml`, no `docker-compose.yml`, no root `package.json`. Zero new runtime dependencies (the `BeforeInstallPromptEvent` type is hand-rolled in a `.d.ts` file).

### FORBIDDEN — none

Wolf Cup is unmodified.

## Acceptance Criteria

**AC-1 — Schema + migration.**

**Given** `apps/tournament-api/src/db/schema/device_bindings.ts`
**When** inspected
**Then** the `deviceBindings` table has a new `installPromptShownAt: integer('install_prompt_shown_at')` (nullable; no default; no constraint). Migration `0009_install_prompt_shown_at.sql` performs an additive `ALTER TABLE`. The `_journal.json` is updated. No other column is touched.

**AC-2 — POST endpoint happy path.**

**Given** an authenticated session player AND a `tournament_device_id` cookie that resolves to a `device_bindings` row owned by that player AND `install_prompt_shown_at IS NULL`
**When** invoking `POST /api/events/:eventId/devices/me/install-prompt-shown` with no body
**Then** the row is updated with `install_prompt_shown_at = Date.now()`, an `audit_log` row is inserted (`event_type = 'install_prompt.shown'`, `entity_type = 'device_binding'`, `entity_id = deviceBinding.id`, `actor_player_id = session.player.id`, `payload_json` containing `{ eventId, deviceBindingId }`), the response is 204 with no body.

**AC-3 — POST endpoint idempotency.**

**Given** the same scenario but `install_prompt_shown_at IS NOT NULL` (already stamped previously)
**When** invoking the endpoint
**Then** the row is NOT updated (the original timestamp is preserved), NO new audit row is written, the response is still 204 (no error). Verifies idempotency at the SQL + audit-trail level.

**AC-4 — Auth chain + cross-player guard.**

**Given** anonymous caller (no session cookie)
**When** invoking the endpoint
**Then** 401 from `requireSession`.

**Given** authenticated session player A AND a `tournament_device_id` cookie pointing to a row owned by player B
**When** invoking the endpoint
**Then** 404 `{ error: 'device_binding_not_found', requestId }`. The row IS NOT mutated (verified by re-reading from the DB).

**Given** authenticated session player AND no `tournament_device_id` cookie
**When** invoking the endpoint
**Then** 404 `{ error: 'device_binding_not_found', requestId }`.

**Given** authenticated session player AND a malformed `tournament_device_id` cookie (e.g., `'<script>'` or 1024-char garbage)
**When** invoking the endpoint
**Then** 404 (the shape guard short-circuits before hitting the DB; never throws).

**AC-5 — Auth status extension.**

**Given** authenticated session AND a valid `tournament_device_id` cookie matching a row owned by the session player
**When** invoking `GET /api/auth/status`
**Then** the response body has a `device: { id: string, installPromptShownAt: number | null }` object alongside the existing `player` object.

**Given** authenticated session AND no device cookie OR a cross-player cookie OR malformed cookie
**When** invoking `/status`
**Then** the response body has `device: null`. The existing `player` shape is unchanged (additive).

**AC-6 — Component render rules (suppression + display).**

`apps/tournament-web/src/components/install-prompt.test.tsx` covers:
- (a) `isStandalone: true` → renders `null` regardless of other props.
- (b) `installPromptShownAt: <some-number>` → renders `null` regardless of other props.
- (c) `hasMutatedThisSession: false` → renders `null`.
- (d) iOS-shape (no `beforeInstallEvent`, UA matches `/iPad|iPhone|iPod/`) → renders the iOS instructions card with the dismiss button.
- (e) Android-shape (`beforeInstallEvent` provided, UA does NOT match iOS regex) → renders the "Install" button. Click → `beforeInstallEvent.prompt()` is called; `onShown` is invoked once `userChoice` resolves.
- (f) Unsupported platform (no event AND not iOS) → renders `null`.
- (g) Component unmount before user interacts → `onShown` is invoked exactly once (defense-in-depth one-shot).
- (h) Dismiss button on iOS card → `onShown` invoked once; subsequent dismiss clicks are no-ops (component already unmounted).

**AC-7 — Hook + provider.**

`apps/tournament-web/src/hooks/use-first-mutation.test.tsx` covers:
- (a) Initial flag value is `false` outside the provider AND inside the provider (until `markMutation` fires).
- (b) After `markMutation()` is called once, `useFirstMutationFlag()` returns `true`.
- (c) Subsequent `markMutation()` calls are no-ops (flag stays `true`; no re-render storm).
- (d) The provider's state resets to `false` on a fresh mount (= fresh page load equivalent).

**AC-8 — Mutation-site wiring.**

**Given** a successful `POST /api/rounds/:roundId/scores`
**When** the `score-entry` route's mutation `onSuccess` fires
**Then** `markMutation()` is called.

**Given** a successful `POST /api/events/:eventId/gallery`
**When** the gallery page's `uploadOne` returns 200
**Then** `markMutation()` is called.

(Tested at the route-test level with a render harness that wraps the route in `FirstMutationProvider` + asserts the hook's flag flips to `true` after a stubbed mutation success.)

**AC-9 — End-to-end UX flow (integration assertion through render harness).**

**Given** the InstallPromptHost wraps `<InstallPrompt>` with all four props sourced from real hooks (auth status + matchMedia + window.__deferredInstallPrompt + useFirstMutationFlag)
**When** the user lands on `/events/:eventId` for the first time on iOS Safari, with no prior install prompt shown, AND completes a score commit (mutation fires)
**Then** the prompt renders. On dismiss, the POST fires, the auth-status query is invalidated, the next render shows `installPromptShownAt: <number>` and the prompt suppresses forever on this device.

**AC-10 — Auth status is forward-compat.**

**Given** an existing T2-3b / T3-10 consumer that destructures `{ player }` from the status response
**When** the response gains the new `device` field
**Then** the existing consumer continues to work without modification.

**Evidence (codex spec round-1 Low #7).** The two existing call sites for the status loader in tournament-web (`events.$eventId.index.tsx:74-80` `loadAuthStatus` + `events.$eventId.gallery.tsx:48-55` `loadAuthStatus`) both implement non-strict body parsing: they extract `body.player` via `(body as { player?: unknown }).player`, return `{ player: null }` on missing/invalid, and ignore every other top-level key. Adding `device: { ... } | null` does not break these consumers — verified by reading the existing source. The new `auth.test.ts` assertions cover the additive shape; existing T2-3b / T3-10 status-test cases continue to pass unchanged.

**AC-11 — Wolf Cup unmodified.**

`git diff master -- apps/api apps/web packages/engine` is empty.

## Risks

- **First-mutation flag is session-scoped, not persistent.** A player who triggers a mutation in tab 1, then opens tab 2 in the same browser without further mutations, sees no prompt in tab 2. The server-side `install_prompt_shown_at` is the persistent guard; the client-side flag is just the "first-commit dopamine hit" trigger. Acceptable v1 trade-off — alternative (persist flag in localStorage) adds complexity without obvious benefit (a tab that hasn't mutated wouldn't have triggered the prompt anyway).
- **Onunmount stamping can over-stamp.** If the user navigates away from a route that briefly rendered `<InstallPrompt>` (e.g., flicker during a redirect), the unmount-fires-onShown defense-in-depth could stamp the timestamp without actually showing the user anything visible. Mitigation: the component's render pre-checks ensure `<InstallPrompt>` only mounts when ALL conditions hold; a brief mount during render thrash should be rare. If it becomes a problem, followup T7-6b can add a "minimum-visible-ms" guard before stamping.
- **iOS UA detection is heuristic.** The `/iPad|iPhone|iPod/` regex misses iPadOS-13+ which spoofs as macOS Safari. The result is iPad-Safari-13+ users won't see the iOS instructions card — they fall into the unsupported branch (no prompt). This matches Wolf Cup's posture and is acceptable for v1; followup T7-6c is iOS-13+ iPad detection via `navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)`.
- **`beforeinstallprompt` requires an installable manifest.** If `apps/tournament-web/public/manifest.json` doesn't have all the icons/start_url/display fields, Chrome silently won't fire the event and Android users see no prompt. **Pre-check:** the implementation should verify the manifest has at least `name`, `short_name`, `start_url`, `display: 'standalone'`, and `icons[]`. If T7-6 reveals manifest gaps, that's a followup T7-6d (PWA manifest hardening).
- **No telemetry on install rate.** v1 ships without measuring "of N players who saw the prompt, M installed." Followup T7-6e: log `userChoice` outcome to audit (`install_prompt.outcome` with `accepted | dismissed`) so future stories can derive an install conversion rate.
- **Cross-tab race.** Two tabs in the same browser share the same device cookie. If both render the prompt simultaneously and both fire onShown, the endpoint is idempotent (AC-3) so the worst case is one extra POST that no-ops at the SQL layer. Acceptable.

## Followups (out of scope, capture only)

- **T7-6a** — Wire `markMutation()` into additional mutation sites (T6-7 manual presses, T6-13 sub-game compute, admin event create, T5-9 score corrections).
- **T7-6b** — Minimum-visible-ms guard before stamping (avoid over-stamping on render thrash).
- **T7-6c** — iPadOS-13+ detection heuristic.
- **T7-6d** — PWA manifest audit + hardening to ensure `beforeinstallprompt` actually fires on Chromium.
- **T7-6e** — Install-outcome telemetry (audit `install_prompt.outcome` with `accepted | dismissed`).
- **T7-6f** — A/B testable copy / icon size for the iOS instructions card.

## Definition of done

- All AC pass (AC-1 through AC-11).
- `pnpm --filter @tournament/api test` green; new install-prompt integration tests + auth-status extension tests included.
- `pnpm --filter @tournament/web test` green; new install-prompt component tests + first-mutation hook tests included.
- `pnpm -r typecheck` clean (including the new `Window` augmentation).
- `pnpm -r lint` clean.
- Wolf Cup test counts unchanged (engine 472, api 516).
- The migration `0009_install_prompt_shown_at.sql` is generated, renamed to its descriptive name, and `_journal.json` is updated.
- Spec + impl + party codex reviews each PASS or FIXED-N (no STOP-on-High user decisions outstanding).
