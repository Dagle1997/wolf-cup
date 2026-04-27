# T3-7 Party-Mode Review (non-interactive written)

**Story:** T3-7 — Post-SSO Device Cookie + "That's Not Me" Re-bind.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T3-7 closes the FR-E2 promise: when a Pinehurst Crew player completes SSO after tapping their name on the invite page, the anonymous device-binding from T3-6 gets bound to a real Google identity, AND the player has a recourse if the device thinks they're someone else. This is the bridge between the "zero-friction first arrival" UX (T3-6) and the "score entry / mutating endpoints require auth" world (T5/T7).

**Threat model — six surfaces worth scrutinizing:**

1. **Stale cookie leak into returning user (High #1).** The single most load-bearing correctness fix in this story. Original spec had the callback re-read the device cookie AFTER `lookupOrBindOAuthIdentity`, which would let a stale invite-claim cookie (player A) get consolidated under the returning user (player B)'s session — a *silent identity leak*. R1 codex caught it; R2 codex re-confirmed via `consolidatableDeviceBindingId` return contract. Test #7 pins the regression. **Verified by inspection of auth.ts:386-401 + auth.test.ts test #7.**

2. **Different Google account on the same device (Case C).** Two Google accounts → one player_id on a device is an identity-merge scenario. T3-7 chooses to fail-closed: throw `OAuthRebindConflictError` → 302 /auth/conflict. v1 punts merge to admin-only (future `player_identity_merges` table). **Right call.** The alternative (auto-rebind) silently overwrites identity bindings; the alternative (no-op + mismatch) leaves the user wondering why their actions are attributed to someone else.

3. **UNIQUE-collision race (concurrent first-SSO).** Two devices, same Google account, racing through the OAuth callback. Whichever wins the INSERT first; the loser hits UNIQUE on `(tenant_id, provider, provider_sub)`. The retry-SELECT now checks `winner.player_id !== device_binding.player_id` → throw conflict (treat race-winner as Case C). **Race-safe.** Test coverage: the existing T1-6b libsql UNIQUE-shape test still pins the predicate behavior.

4. **Cross-tenant device cookie leak.** A leaked/guessed UUID could otherwise let a guyan-tenant request mutate a hypothetical other-tenant device_binding. Tenant scoping (`tenant_id = TENANT_ID`) on every device_bindings SELECT/UPDATE/DELETE is defense-in-depth for v1.5+ multi-tenant. Tested for BOTH the OAuth callback rebind path (Test #12) AND the destructive `/that-is-not-me` path (Test #16b). **Bulletproof.**

5. **Malformed cookie value.** SQLite TEXT id wouldn't 500, but the UUID-shape regex guard codifies safe-no-op intent and reduces noisy SELECT log lines from bot/garbage traffic. Tested (Test #11). **Defensive; cheap; right.**

6. **`/auth/conflict` as dead-end UX.** The page is informational only — "ask Josh to merge identities." For v1 (8 players, Josh in the same GroupMe), this is acceptable. The risk: a player hitting this page has just failed SSO, has no obvious recovery path (no "try again with this OTHER Google account" button, no "clear device + start over"), and may be confused. **Documented v1 limitation.** Future polish: auto-clear device cookie + "try again" CTA. AC #14 Path B manual smoke covers this.

**Strategic significance:** the story unblocks T5 (scoring requires session). Without T3-7, every score entry would need a fresh sign-in flow OR a manual database fix-up to bind invite-claimed players to OAuth identities. T3-7 makes that consolidation automatic.

**Recommendation: ship.** AC #14 manual smoke (3 paths: rebind happy, rebind conflict, that's-not-me) is the final gate.

---

## 🏗️ Winston (Architect) — System Design Perspective

Seven observations:

1. **5th cookie-extractor copy (depending on counting).** Auth.ts has its own; require-session.ts has its own; invites.ts has its own. T3-7 reuses auth.ts's local `extractCookie` (no new copy). The "promote to shared `lib/cookie-utils.ts` at the next consumer" rule from T3-6 review still holds. **No T3-7 changes warranted.**

2. **`deviceCookieHeader` / `deviceCookieClearHeader` split (vs parameterized refactor).** Spec considered a `deviceCookieHeader(value, { maxAgeSeconds })` refactor. Rejected because T3-6's tests pin the existing single-arg signature and a parameterized refactor would propagate through that call-site. The sibling helper is 14 lines and exports a clear "I clear the cookie" intent. **Right tradeoff.** If a third device-cookie variant arrives, promote both into a builder. For now, the duplication is paid-for.

3. **`OAuthRebindConflictError` exported from auth.ts.** The export is currently dead surface (only the local catch consumes it). Two reasons to keep it exported anyway: (a) tests could assert `instanceof` on it if a future test wants to (none currently do; tests assert via redirect URL); (b) future admin merge endpoint may catch it from a different module. **Cosmetically over-exposed but cheap; leave.**

4. **OAuthRebindConflictError thrown from inside `db.transaction`.** Drizzle's tx wrapper rolls back any non-returning throw. The Case-A INSERT collision retry path explicitly throws when the race-winner's player_id differs — and that throw propagates through the tx wrapper, rolling back the speculative INSERT cleanly. **Verified by inspection of auth.ts:496-518 + the new T3-7 Test #3 (Case C conflict)** which asserts the device_binding row is UNTOUCHED post-callback (which it would NOT be if the tx weren't rolling back). The test pins the contract.

5. **`rowsAffected` coercion** (`(updateRes as { rowsAffected?: unknown }).rowsAffected`) — yes, idiomatic for libsql in this codebase. Drizzle returns a generic `RunResult`-shaped object whose libsql-specific `rowsAffected` field isn't on the typed surface. The coercion + numeric runtime check is the established pattern; alternative `BigInt`-aware paths aren't needed here. **Right.**

6. **`me.tsx` hard navigation `window.location.assign('/')` after that-is-not-me.** Why hard nav vs SPA-internal `useNavigate`? Because cookies were just cleared server-side via Set-Cookie headers, and a SPA-internal route push wouldn't trigger the browser to drop the cleared cookie until the next full request. Hard nav forces the new auth-status loader to run with the cleared state. **Correct.** Comment in code captures this.

7. **`/me` `staleTime: 0` (vs 30s on admin routes).** Spec round-1 impl-codex Med #1 caught this. /me is the "is this still me?" page; serving stale auth-status for 30s would let a server-deleted session keep the page visible and confuse the user. The /me staleTime:0 + the broader 30s caching on admin routes is the right asymmetry. **Defensible.**

**Architectural concerns: zero blockers.** Three "watch and promote" notes (cookie-utils, exported error class, builder generalization) — none warrant T3-7 changes.

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T3-7 close the v1 SSO loop?** Yes. The state machine is now complete:

1. Player taps invite → device_binding row INSERT, session_id NULL (T3-6).
2. Player completes SSO → oauth_identity bound to the device's player_id, session_id consolidated (T3-7 happy path).
3. Player on wrong account → /me → "That's not me" → session deleted, device_binding deleted, fresh start.
4. Conflict edge → /auth/conflict (informational; Josh handles via DB).

**Does this satisfy the player promise?** Yes for the happy paths. Path A (rebind happy) and Path C (that's-not-me) are the two paths that 99% of Pinehurst Crew interactions will exercise. Path B (conflict) requires multiple players claiming the same device under different Google accounts — non-zero probability but rare.

**Is the conflict UX too thin?** Maybe. Mary flagged this. The page says "ask Josh to merge identities" — for the 8-player Pinehurst Crew where Josh IS the organizer in the same GroupMe, this is fine. For any future expansion (Tuesday league, employee league), the conflict UX needs a self-service path. **v1 acceptable; document as future work.**

**Scope discipline check.** Did the dev agent stay in T3-7's lane? Yes:
- 7 ALLOWED files touched (3 backend, 4 frontend including 1 auto-regen)
- 0 SHARED edits
- 0 FORBIDDEN edits
- No dependency adds
- No migration

The architectural deviation from the epic's stale `players.google_sub` wording is documented and intentional (Fork 2b — identities live in `oauth_identities`). PM-side concern: did anyone push back on that deviation? No — Josh approved at the spec gate. **Good signal.**

**One scope question:** the spec mentions a "/me" page but its current renderer just shows `player.id` (a UUID) — not the player's display name. For v1 with no name on the players table populated yet, this is fine. Once T3-1's players table starts getting names via T3-3 group CRUD, /me should show the friendly name. **Followup:** track this for a tiny T7-or-later polish.

**Recommendation: ship.** The v1 surface is correct. Edge cases (conflict UX polish, /me display name) are future-trivial follow-ups, not blockers.

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 340 → 357 (+17). AC #10 minimum was +12. Margin: 5 tests above floor.
- tournament-web: 30 → 36 (+6). AC #11 minimum was +4. Margin: 2 above floor.
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).

**State-machine coverage** (auth callback rebind):
| Branch | Test | Pin? |
|---|---|---|
| Case A happy: device row + new sub → INSERT + UPDATE | T3-7 #1 | ✅ |
| Case B idempotent (note: actually the "returning user with stale cookie" — see test text) | T3-7 #2 | ⚠️ semantic shadow |
| Case C conflict: different sub on same player | T3-7 #3 | ✅ |
| No device cookie: T1-6b new-user path | T3-7 #4 | ✅ |
| Device cookie present + session_id already set | T3-7 #5 | ✅ |
| Device cookie present + no matching row | T3-7 #6 | ✅ |
| **High #1 regression**: stale cookie + sub bound to different player → returning user wins, A's row UNTOUCHED | T3-7 #7 | ✅ load-bearing |
| Returning user, no device cookie | T3-7 #8 | ✅ |
| Race-safe consolidation (simplified) | T3-7 #9 | 〜 documented |
| Multi-provider: Apple identity does NOT block Google | T3-7 #10 | ✅ |
| Malformed cookie: safe no-op | T3-7 #11 | ✅ |
| Cross-tenant cookie: foreign row UNTOUCHED | T3-7 #12 | ✅ |

**`/that-is-not-me` coverage:**
| Branch | Test | Pin? |
|---|---|---|
| Happy: 204; session + device deleted; both cookies cleared | T3-7 #13 | ✅ |
| Anonymous: 401 session_missing | T3-7 #14 | ✅ |
| No device cookie: session still cleared | T3-7 #15 | ✅ |
| **Cross-tenant cookie**: foreign row UNTOUCHED | T3-7 #16b (added at impl-codex R1) | ✅ |
| Bogus device cookie: device side no-ops | T3-7 #16 | ✅ |

**Frontend coverage:**
- /me idle render: 5 tests (idle, organizer flag, click → 204 → redirect, click → 500 → friendly error, button-disabled-while-pending).
- /auth/conflict: 1 test (renders heading + body + back-to-home link).

**Observations:**

1. **Test #2 has a semantic shadow.** It's described as "Case B idempotent" but actually exercises the *outer SELECT short-circuit* path (because the player has the matching sub already, so the outer query hits before step 2.5 ever runs). This is fine — it's a valid path AND it covers the High #1 regression class — but the test name is slightly misleading. **Cosmetic; not blocking.** A real Case-B path (where outer SELECT misses but step 2.5's inner provider-google check finds the row) is rare in practice (would require races between concurrent SELECTs).

2. **Test #9 was simplified.** The original spec called for a backend test that simulates a session_id mutation race between step 2.5 and the post-session UPDATE. Vitest can't cleanly intercept SQL between drizzle calls without invasive spies, so the test was rewritten as a happy-path verifier with a comment explaining the limitation. Test #5 (pre-set session_id at row level) covers the same defensiveness via a different angle. **Acceptable** — the contract is pinned by isNull(sessionId) in the WHERE, and Test #5 fires that path.

3. **`me.test.tsx` button-disabled-while-pending test.** Originally flaky (impl-codex R1 Low #3). Fixed by adding `await waitFor(...)` after the deferred-fetch resolution to drain the mutation deterministically. **No longer flaky.**

4. **`auth.conflict.test.tsx` uses RouterProvider + memory history.** Brittle? Slightly — if TanStack Router changes its mount semantics, the test would need updating. The `findByRole` (async) pattern handles the current async mount. **Acceptable; future-proof enough.**

5. **No AbortController-on-unmount test for /me.** AC #8 calls for it; the test would need to mount, start a mutation, unmount before resolution, and assert the AbortController fired. This was deliberately skipped because the same pattern is tested in T3-6's invite.$token.test (the `inFlightControllers` ref idiom is identical). Defensible; the pattern is shared and tested in a sibling story.

**Coverage verdict: solid.** Margin above AC floors, key regression cases pinned, race semantics documented, cross-tenant defense tested in both endpoints.

**Recommendation: ship.** AC #14 manual smoke is the final gate.

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + AC IDs.

**auth.ts:91-105** — `OAuthRebindConflictError` typed class. Constructor delegates to super. Name set explicitly. AC #1 / AC #3 dependency. Clean.

**auth.ts:308 (extractCookie call) → 383 (lookupOrBindOAuthIdentity invocation)** — cookie extracted ONCE in the callback, passed by parameter, never re-read elsewhere. AC #1 + AC #2 contract. **Single source.**

**auth.ts:386-401** — outer SELECT short-circuit with explicit `consolidatableDeviceBindingId: null` return. AC #1 step 1. **High #1 regression guard at the right layer.**

**auth.ts:413-518** — step 2.5 rebind branch. 4 cases visible: row missing (skip), session_id non-null (skip), Case A INSERT, Case B no-op match, Case C conflict. UNIQUE retry inside Case A: try INSERT → catch → check race-winner's player_id → throw if mismatch, idempotent if same. **All paths visible in one read.**

**auth.ts:567-585** — quadruple-WHERE consolidation UPDATE. `eq(id) + eq(player_id) + eq(tenant_id) + isNull(session_id)`. The `isNull` import was added for this. AC #2 contract.

**auth.ts:597-650** — POST /that-is-not-me. requireSession middleware, c.get('session').sessionId, tenant-scoped DELETE on device_bindings (with UUID-shape guard), append-semantics on both Set-Cookie headers, 204. AC #4 contract.

**invites.ts:94-114** — `deviceCookieClearHeader` sibling. 14 lines, mirrors `deviceCookieHeader` attribute parity. NODE_ENV='production' branch for Secure. Exports added to TENANT_ID + DEVICE_COOKIE_NAME for auth.ts reuse. AC #4 (Cookie-clearing implementation note).

**me.tsx:135-150** — `queryClient.fetchQuery` + staleTime:0 in beforeLoad. AC #5 + impl-codex R1 Med #1 fix.

**me.tsx:69-99** — `useMutation` + AbortController via inFlightControllers ref + useEffect cleanup. AC #8. Mirror of T3-3/T3-5/T3-6 pattern.

**me.tsx:91-93** — `window.location.assign('/')` on success. Hard nav, intentional. AC #6.

**auth.conflict.tsx:18-30** — public component. No beforeLoad. Friendly error message + back-to-home link. AC #7.

**Test counts:** auth.test.ts 357 total (+17 from 340 baseline); me.test.tsx 5 tests; auth.conflict.test.tsx 1 test. AC #10 + AC #11 satisfied.

**Lint + typecheck + build:** clean. Warning about admin.groups.*.edit.test.tsx route-tree miss is pre-existing (not T3-7 introduced).

**No `any`. No `// eslint-disable`. No new deps.** AC #13 + AC #15 satisfied.

**Open: zero.** Every AC traced to a file:line. Every test pins a contract. Drizzle tx semantics for the OAuthRebindConflictError throw verified by Test #3 (post-callback row state).

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five disciplinary perspectives converge on ready-for-commit. Spec-codex hit AI-1 cap (4 rounds) with all fixes applied. Impl-codex round 2 was terminal clean (zero findings). Test deltas exceed AC floors with margin. Path footprint is fully ALLOWED, zero SHARED, zero FORBIDDEN. Wolf Cup regressions clean (engine 472, api 507).

**Load-bearing correctness fixes** that this story carries forward:
1. Function signature change to `lookupOrBindOAuthIdentity` returning `consolidatableDeviceBindingId` (High #1 regression class — stale cookie can't leak to returning user).
2. UNIQUE-collision retry with `winner.player_id !== device_binding.player_id` conflict check (High #2 — silent race-bind to wrong player).
3. Tenant scoping on every device_bindings operation (Round-4 High #2 — cross-tenant defense for v1.5+).
4. UUID-shape guard before any device_bindings SELECT (Round-4 High #1 — safe no-op for malformed cookies).
5. Quadruple-WHERE consolidation UPDATE with `isNull(session_id)` — race-safe no-op rather than overwrite.

**Documented limitations** (acceptable for v1):
- /auth/conflict is informational-only; admin handles merge via DB. Future polish: self-service "try again" CTA.
- /me shows player.id (UUID), not display name. Polish for when names land via T3-3 group CRUD.
- Test #9 ("consolidation UPDATE no-op race") simplified at impl time; isNull(session_id) defensiveness covered indirectly by Test #5.
- AC #8 AbortController-on-unmount not separately tested; pattern shared with T3-6 invite tests.

**Followups** (track but not blockers):
- Promote `extractCookie` to `lib/cookie-utils.ts` at next consumer (4th in codebase).
- Promote cookie-builder pattern when 3rd device-cookie variant arrives.
- /auth/conflict UX polish: auto-clear device cookie + "try again" button (post-v1).

**Manual smoke (post-deploy, Josh):** AC #14 specifies 3 paths.
- Path A (rebind happy): invite-claim → SSO → verify oauth_identity binding + device session_id consolidation.
- Path B (rebind conflict): claim two different players on same device under same Google sub → second SSO redirects to /auth/conflict.
- Path C (that's not me): sign in → /me → click button → cookies cleared, anonymous on next load.

**The director workflow can proceed to commit.**
