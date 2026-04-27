# T3-8 Party-Mode Review (non-interactive written)

**Story:** T3-8 — Permissions Middleware: Event-Level Role Matrix.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T3-8 is the *unblocking* story for two future epics: T4 (pairings — `requireEventParticipant` gates pairings UI access) and T7 (player experience — `requireInviteToken` gates spectator views for non-authenticated browser tabs). It's pure infrastructure: zero player-visible behavior changes, zero new endpoints, zero new schema. The story exists to **codify the role-matrix taxonomy** so future stories don't re-litigate auth posture per route.

**Threat model — five surfaces worth scrutinizing:**

1. **Token brute-force on `requireInviteToken`.** No rate limit. Token entropy is T3-2's `crypto.randomBytes(32).toString('base64url')` = 256 bits = 43 chars. At 10M guesses/sec → ~10^60 years. The shape guard (16-128 chars, base64url charset) bounds the SELECT input space without rejecting legitimate tokens. **Bulletproof for v1.**

2. **`requireEventParticipant` cross-tenant defense.** BOTH `groups.tenant_id` AND `group_members.tenant_id` are filtered. A foreign-tenant `groups` row OR a foreign-tenant `group_members` row will not satisfy the predicate, even if the other table's row is in the correct tenant. Both tenant filters are pinned by separate tests. This matches the post-T3-7 hardening pattern (defensive against v1.5+ multi-tenant). **Solid.**

3. **No `requireSession` upstream on `requireInviteToken`.** This is intentional per FR-E1 — the token IS the auth. The middleware's tenant-scoped SELECT bounds the attack surface; expired tokens 401 immediately. The risk class shifts from "auth bypass" to "token-share / link-leak" which is the same shape T3-6's invite flow already accepts. **Acknowledged v1 limitation, consistent with prior story.**

4. **500 misuse class for missing path params.** The taxonomy split is load-bearing for *operations*: developer mounts the middleware on the wrong route shape → loud 500 in logs immediately, NOT silent 401/403 that would mask the bug. A future operator triaging a 500 spike sees the misuse code (`middleware_misuse_no_event_id` / `middleware_misuse_no_token`) and knows the action class without diff inspection. **Operationally sound.**

5. **No consumer routes wired in T3-8.** T4-3 + T7-3 will adopt these middleware. The risk: dead code that drifts before its consumers arrive. Mitigation: 14 integration tests against stub Hono apps lock the contract. The middleware is exported AND production-ready; future stories adopt without spec drift. **Acceptable; tracked.**

**Strategic significance:** the role-matrix taxonomy is now stable across 4 middleware (session, organizer, event-participant, invite-token). Future Epic T8 (engagement surfaces) and downstream stories can reference this taxonomy by name rather than re-deriving it.

**Recommendation: ship.** Manual smoke is N/A — there's nothing for Josh to click.

---

## 🏗️ Winston (Architect) — System Design Perspective

Six observations:

1. **The 500-vs-401-vs-403 taxonomy is now solidified.** Four middleware files all follow the same pattern:
   - Missing precondition (no session ahead, no path param) → 500 `middleware_misuse*` (developer-error)
   - Auth-state failure → 401 `*_missing` / `*_invalid` / `*_not_found` / `*_expired`
   - Authz-state failure → 403 `not_*`

   This is the right time to consider a shared `lib/middleware-errors.ts` helper that emits the JSON envelope, but the duplication is paid-for at 4 consumers — promote at 5+. **Hold.**

2. **`require-organizer.ts` pattern reuse.** T3-8's two new middleware mirror it exactly: ctx-aware logger fallback (`c.get('logger') ?? moduleLogger`), `randomUUID()` requestId fallback, descriptive `msg` in the misuse log line. The pattern fight between T3-8 and T1-6a has zero divergence. **Good.**

3. **Optional `invite?:` typing on ContextVariableMap.** The right call. The pre-existing T1-6a typing gap on `session`/`player` (declared required, but only set after `requireSession` validates) IS a real latent issue, but fixing it now would propagate `T | undefined` through every admin handler that calls `c.get('session').sessionId`. That's an auth-typing refactor, NOT T3-8 scope. Track as `T3.x` followup or fold into the next auth-handler-touching story. **T3-8 made the right scope call.**

4. **Tenant scoping on BOTH JOIN columns.** The defensive double-filter (`groups.tenant_id = TENANT_ID` AND `group_members.tenant_id = TENANT_ID`) is overkill for v1 (only one tenant exists), but it's the cheapest defense-in-depth that exists. A future schema migration that introduces v1.5+ multi-tenant would otherwise need to audit every query for tenant scoping; T3-8 (and T3-7) preempt that audit by establishing the pattern early. **Right.**

5. **No consumer wire-up + integration tests against stub Hono apps.** Pragmatic. The alternative — adding a trivial smoke route to `app.ts` to exercise the middleware against the production app router — has two issues: (a) the smoke route is dead surface area until T4-3/T7-3 ship; (b) it's redundant with the unit tests that already mount the middleware on a real Hono. The stub-app approach IS a real Hono — the only difference is which routes are mounted alongside. **Stub app is sufficient.**

6. **`TENANT_ID` constant duplicated.** Both T3-8 middleware files have `const TENANT_ID = 'guyan';`. So does `invites.ts`, `auth.ts` (as `DEVICE_TENANT_ID` import + `DEFAULT_TENANT_ID` local), `require-session.ts` (implicitly via env). FD-6 plan calls for a tenant resolver; until that lands, the duplication is paid-for. **Hold; promote at FD-6 lands.**

**Architectural concerns: zero blockers.** Three "watch and promote" notes — none warrant T3-8 changes.

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T3-8 satisfy a v1 user promise?** Indirectly — it's pure infrastructure. The user-facing value lands in T4-3 (pairings) and T7-3 (course preview), both of which depend on T3-8.

**Does the "no consumer routes wired" decision risk anything?** The risk is "infrastructure rot" — middleware sits unused until consumers arrive, and by the time T4-3 ships, the middleware contract may have drifted from what's needed. Mitigations:
- 14 integration tests pin the contract.
- The test fixtures (stub Hono app + per-test seed) are reusable templates for T4-3/T7-3.
- The middleware imports + exports are stable Node modules; zero risk of "where did this go" surprise.

**Is the v1 decision-making sound?** Two scope choices the dev agent made:
1. **URL-only token source (cookie deferred to v1.5+).** The epic AC said "URL/cookie". Dev agent picked URL-only and documented the cookie path as deferred. This is right for v1 — T3-6's `/api/invites/:token` shape is URL-based, no cookie consumer exists yet, adding cookie support would expand the test matrix without a real consumer. Cookie-source can land cleanly in any future story that needs it.
2. **Scorer-specific middleware deferred to T5-6.** Per the epic note. T3-8 ships the role matrix exercisable in epic-T3 sequence (participant + invite-token); scorer-gating depends on `scorer_assignments` table from T5-1. The scope discipline here is right.

**Path footprint compliance.** 5 ALLOWED files touched, 0 SHARED, 0 FORBIDDEN. No dependency adds. No migrations. **Scope-disciplined.**

**Recommendation: ship.** No PM-side concerns. The role-matrix taxonomy unblocks T4 and T7 cleanly.

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 358 → 372 (+14). AC #7 floor was +13. Margin: +1.
- tournament-web: 36 (unchanged — middleware-only story, no frontend surface).
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).

**`requireEventParticipant` coverage** (7 tests):
| Branch | Test | Pin? |
|---|---|---|
| Happy: player IS in group_members | #1 | ✅ |
| 403 not_event_participant: player NOT a member | #2 | ✅ |
| 403 not_event_participant: player in DIFFERENT event | #3 | ✅ |
| 500 middleware_misuse: requireSession not ahead | #4 | ✅ |
| 500 middleware_misuse_no_event_id: route lacks `:eventId` | #5 | ✅ |
| Cross-tenant on `groups.tenant_id` | #6 | ✅ |
| Cross-tenant on `group_members.tenant_id` | #7 | ✅ |

**`requireInviteToken` coverage** (7 tests):
| Branch | Test | Pin? |
|---|---|---|
| Happy: valid + non-expired token | #1 | ✅ |
| 500 middleware_misuse_no_token | #2 | ✅ |
| 401 invite_token_invalid: too short | #3 | ✅ |
| 401 invite_token_invalid: illegal char (`.`) | #4 | ✅ |
| 401 invite_not_found: well-shaped, no row | #5 | ✅ |
| 401 invite_expired | #6 | ✅ |
| Cross-tenant: foreign-tenant invite → 401 invite_not_found | #7 | ✅ |

**Observations:**

1. **Token shape `'a'.repeat(43)`.** Matches T3-2's actual base64url output: 32 bytes → 43 chars. Verified the bounds [16, 128] contain 43. The test #4 illegal-char (`.`) is a representative sample — the regex `/^[A-Za-z0-9_-]+$/` rejects `.`, `+`, `/`, `=`, plus non-ASCII. Test #3 (too-short, 5 chars) covers the lower bound. **No upper-bound test.** That's a Low miss — could add a 129-char test to verify TOKEN_MAX_LEN = 128 isn't off-by-one. Not blocking; marginal coverage gain.

2. **Cross-tenant for require-invite-token only covers `tenantId` mismatch on the invite row.** No test for the case where `events.tenantId` mismatches but `invites.tenantId` matches (the SELECT only filters on invite.tenantId, not joined event.tenantId). However, since invites are created with `tenantId` = parent event's tenantId via T3-2 logic, cross-tenant drift between invite + event in v1 is impossible. **Acceptable for v1.**

3. **Integration tests against stub Hono app.** No test against the actual `app.ts` to verify route mounting works in production shape. Defensible because: (a) the middleware doesn't depend on app.ts's specific mount structure; (b) consumer stories T4-3/T7-3 will mount it for real and their integration tests will catch any production-mount issues. **Acceptable.**

4. **No "happy path" test that confirms `c.get('invite')` survives across `await next()` — i.e., that a downstream handler can read the invite.** Test #1 does verify `c.get('invite')` from the handler immediately downstream of the middleware, so this IS pinned. ✓

5. **Test #4 charset rejection uses `.` only.** A more thorough negative test could try `+`, `/`, `=` (the base64-but-not-base64url chars). Not blocking. **Could add followup; marginal.**

**Coverage verdict: solid with one minor Low miss (no upper-bound test).** Margin above AC floor +1; key correctness paths pinned.

**Recommendation: ship.** AC #14 manual smoke is N/A.

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + AC IDs.

**`require-event-participant.ts:46-86`** — handler implementation. AC #1 contract.
- L48-58: `requireSession` precondition check + 500 `middleware_misuse`. Mirrors `require-organizer.ts:32-38`.
- L60-71: `:eventId` precondition check + 500 `middleware_misuse_no_event_id`. AC #1 + Risk §4.
- L75-83: drizzle inner join with 4-tuple AND. Both tenant filters present. AC #1 cross-tenant clause.
- L86: 403 `not_event_participant` when 0 rows.
- L89-90: `await next()` on success. No body.

**`require-invite-token.ts:55-99`** — handler implementation. AC #2 contract.
- L57-67: `:token` precondition check + 500 `middleware_misuse_no_token`. AC #2 + Risk §5.
- L70-78: pre-DB shape guard via TOKEN_CHARSET_RE + length bounds. 401 `invite_token_invalid`.
- L80-88: tenant-scoped SELECT.
- L90-94: 401 `invite_not_found` / `invite_expired` branches.
- L96-97: `c.set('invite', ...)` + `await next()`. AC #2 final clause.

**`hono.d.ts:32-39`** — `invite?: { eventId; inviteId }` member. AC #3.
- Optional shape per the impl-codex round-1 fix.
- Comment captures the rationale (`c.get('invite')` returns `T | undefined` on non-token-gated routes).

**`require-event-participant.test.ts:120-228`** — 7 tests. AC #5.
- Test fixture pattern: `seedEventWithMembers` helper + per-test stub player middleware. Reusable for T4-3 / T7-3.

**`require-invite-token.test.ts:80-185`** — 7 tests. AC #6.
- Same fixture pattern as participant tests.

**Lint + typecheck + build:** clean. No `any`. No `// eslint-disable`. AC #9 satisfied.

**No new deps. No migrations. No SHARED edits.** AC #10 satisfied.

**DRY notes:**
- `TENANT_ID` constant duplicated across 5 files. Pre-existing pattern (Winston flagged); promotion deferred to FD-6 tenant resolver.
- Test fixture shapes (player + event + group seed) are similar to `invites.test.ts` + `admin-events.test.ts`. Each file's helper has slightly different needs (different tables seeded, different parameters); no clean DRY target.

**Test count: 372** (358 + 14). +14 satisfies AC #7 floor of +13.

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five disciplinary perspectives converge on ready-for-commit. Spec-codex hit AI-1 cap (4 rounds) with all fixes applied. Impl-codex round 2 surfaced a pre-existing T1-6a typing gap (out-of-scope for T3-8); T3-8's actual diff is effectively terminal-clean. Test deltas exceed AC floors with margin. Path footprint is fully ALLOWED, zero SHARED, zero FORBIDDEN.

**Load-bearing correctness fixes** that this story carries forward:
1. ContextVariableMap.invite typed OPTIONAL (round-1 impl codex catch — prevents handlers on non-gated routes from accidentally dereferencing).
2. Tenant scoping on BOTH JOIN columns for `requireEventParticipant` (post-T3-7 hardening pattern).
3. Cheap pre-DB shape guard on token (catches malformed/garbage URLs without SELECT round-trip).
4. Symmetric 500/401/403 taxonomy split codified across 4 middleware files (developer-error vs user-error class).

**Documented limitations** (acceptable for v1):
- Pre-existing T1-6a typing gap on `session`/`player` (declared required, set conditionally) — out of scope for T3-8; track as followup for the next auth-handler-touching story.
- No upper-bound (>128 char) token test — marginal coverage gain, not blocking.
- No `app.ts`-level integration smoke for new middleware — consumer stories T4-3/T7-3 will exercise in production shape.
- Cookie-source for invite token deferred to v1.5+ (URL-only in T3-8).
- `requireScorerForRound` deferred to T5-6 per epic note (depends on T5-1 schema).

**Followups** (track but not blockers):
- Auth-typing refactor: make `session`/`player` optional in ContextVariableMap when next auth-handler story touches them.
- Promote `TENANT_ID` constant to a shared module when FD-6 tenant resolver lands.
- Promote middleware-error JSON envelope to `lib/middleware-errors.ts` at 5+ consumers (currently 4).

**No manual smoke required** — middleware-only story, no UI surface, no endpoint surface, no migrations.

**The director workflow can proceed to commit.**
