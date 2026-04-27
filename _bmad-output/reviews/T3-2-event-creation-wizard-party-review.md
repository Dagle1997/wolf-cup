# T3-2 Party-Mode Review (non-interactive written)

**Story:** T3-2 — Event Creation Wizard. FIRST user-facing T3 surface.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T3-2 is the first user-visible value out of Epic T3 — until this commit, the entire T3-1 schema (10 tables, 144-line migration) sat idle. Now an organizer can sign in, hit `/admin/events/new`, and stand up Pinehurst 2026 in three clicks. Strategic significance: the path from "blank tournament-api DB" to "first round playable" now goes:
1. Course already seeded (T2-2)
2. T3-2 → event + invite link
3. T3-6 invite-claim flow (NOT YET) → guests bind to player rows
4. T5 scoring (NOT YET) → actual play

Steps 3 + 4 are still missing. **T3-2 alone doesn't ship a usable v1**, but it unlocks the Pinehurst-readiness conversation: "the event is created in production; what's the next blocker?"

**Threat model — five surfaces:**

1. **Invite token entropy.** `crypto.randomBytes(32).toString('base64url')` → 256 bits → 43 chars. Equal to the sessions cookie posture. Brute-force at 1M guesses/sec would take ~10^61 years. **Solid.** Backend test pins regex + length so a regression that downgrades to UUID would fail.

2. **TOCTOU window: pre-flight check vs transactional INSERT.** A course_revision deleted between the pre-flight SELECT and the events INSERT would fail the FK constraint inside the tx → 500 create_failed instead of 400 unknown_course_revision. The window is microseconds and the production posture is "course_revisions are RESTRICT-protected against deletion when referenced anywhere" (T2-1 schema), so this race is essentially unreachable. **Acceptable v1; the failure mode is degradation in error-code precision, not data corruption.**

3. **Invite token leakage in server logs.** The handler logs `event: 'admin_event_created'` with `eventId, eventName, roundCount` — but NOT the inviteToken. Good hygiene; tokens stay out of structured logs (would surface in `cat /var/log/...` greps). The token DOES appear in the response body to the organizer (intended) and is persisted to invites.token (intended). Pin: future T3-6 invite-claim handler must NOT log the token either.

4. **Anonymous wizard access.** beforeLoad redirects anonymous to `/api/auth/google` directly (deviation from epic AC #888 which mentions a `/auth/sign-in?next=...` route that doesn't exist). The redirect is fail-safe — the wizard renders for organizers only; anonymous never sees the form fields. Non-organizer authenticated users get the inline ForbiddenMessage (no redirect-loop risk). **Auth posture is clean.**

5. **CSRF via global Origin check.** Inherited from T1-6a's `app.use('*', csrf({ origin }))`. Same protection that gates every other tournament-api unsafe-method route. **No T3-2-specific CSRF surface.**

**One v1 limitation worth flagging:** the wizard has no edit/delete affordance. If Josh creates an event with a typo in the name or wrong date, the only path is direct DB intervention (no UI yet). T3 epic explicitly defers edit/delete to future stories; T3-2's "create-only" scope is correct but worth knowing pre-Pinehurst (have a contingency: SSH + sqlite3 to fix typos).

**Recommendation: ship.** Threat surface is small + well-mitigated.

---

## 🏗️ Winston (Architect) — System Design Perspective

The implementation is a clean architectural mirror of T2-5 with the additions T3-2 needs. Six observations:

1. **Pre-flight + transaction layering is the right shape.** `SELECT id FROM course_revisions WHERE id IN (...)` runs OUTSIDE the transaction; on miss → 400 unknown_course_revision (clean validation error). On hit → enter transaction. The TOCTOU window is microseconds; the FK inside the tx is the safety net. Mary called this out from the threat-model angle; from architecture it's a "validation-layer-before-persistence-layer" pattern that mirrors T2-5's `validateCourse()` → tx flow. **Consistent with established patterns.**

2. **The 4-INSERT transaction shape** (events → N event_rounds → 1 invite → 1 group) is structured so the parent's `id` and `contextId` are generated BEFORE the tx opens, then threaded through every child INSERT. Per T3-1 party-review Winston note: "T3-2's spec should pin the context_id threading pattern" — the impl does exactly that (admin-events.ts:131-133 generates eventId/contextId/inviteToken pre-tx; lines 156, 170, 187 stamp contextId on all 4 inserts). **Pinning the pattern as expected.**

3. **The `isValidIanaTimezone` helper duplication** (server admin-events.ts:48-56 ↔ client admin.events.new.tsx:64-71). Per the spec's no-SHARED rule, both copies are 8 lines each. Same Intl.DateTimeFormat pattern. Same engine-deferred .format() call. The two-Zod-schema (client CreateEventRequestSchema + server CreateEventRequestSchema) is similar duplication for similar reasons. Acknowledged drift risk: if a future story adds a field-level Zod constraint (e.g., name max length), both schemas need update. **The cost is real; the alternative (shared package) is a SHARED edit which carries higher friction. Hold the duplication; promote when a 3rd consumer arrives or when the first cross-schema bug surfaces.**

4. **Course query gating via `enabled: form.step >= 2`** (round-1 fix) is the right TanStack Query pattern. The query mounts unconditionally but TanStack defers the actual fetch until enabled is true. When the user advances to step 2, the fetch fires; the data is cached for the rest of the wizard's lifetime (60s staleTime). **Idiomatic.**

5. **The 3-step state machine** uses a single `form.step: 1|2|3` discriminator inside the FormState object. All step bodies render conditionally (`{form.step === 1 ? ... : null}`). State preservation across steps is automatic because `useState<FormState>` is a single source. Compare to a multi-route wizard (separate routes per step) — the single-state design avoids router state-sync complexity for a 3-step flow that lives entirely client-side. **Right choice for the scale.**

6. **The two-router-mount pattern in app.ts** (`app.route('/api/admin', adminCoursesRouter)` AND `app.route('/api/admin', adminEventsRouter)` both under `/api/admin`). Hono allows this; each router defines its own subroutes. Future T3-3 (group CRUD) will likely add a third `/api/admin` mount. At ~5 admin routers this gets noisy; the natural promotion would be a single `adminRouter` that mounts each sub-domain at a sub-path. **Hold for now; revisit at T3-5+.**

**Architectural concerns: zero blockers.** Ship.

---

## 📋 John (PM) — User Value / Scope Perspective

**Does this satisfy organizer-facing value?** Yes — but only after AC #20 manual smoke at `https://tournament.dagle.cloud/admin/events/new`. Code-level ACs can't observe whether the wizard actually works end-to-end against the deployed `/api/courses` (Pinehurst-area courses live in the seed) and the deployed save endpoint. **AC #20 is the load-bearing test.**

**Most fragile manual smoke steps (in order of likely failure):**

1. **Step 2 course picker.** The dropdown depends on `GET /api/courses` returning the seed data. T2-2 ships this; production verified at deploy time. Failure mode: empty `<select>` with only "— pick a course —". Recovery: hard-refresh; check browser network tab for 401 (auth) or 500 (backend).

2. **Step 1 → Step 2 transition.** The Next button is disabled until step1Valid() returns true. Most likely friction: typing an invalid timezone (e.g., user-entered "EST" instead of "America/New_York"; isValidIanaTimezone rejects). The default value comes from `Intl.DateTimeFormat().resolvedOptions().timeZone` which on Josh's browser will return "America/New_York" already. **Default should pass v1 use case.**

3. **Step 3 Submit → 201 success.** The success screen shows the invite URL constructed from `${window.location.origin}/invite/${inviteToken}`. Failure mode: 400 unknown_course_revision (if a course was deleted between page load and submit — extremely unlikely). 500 create_failed surfaces a generic error message; the form values are preserved so the organizer can retry.

4. **The invite URL itself.** v1 just renders the URL string; the `/invite/{token}` route doesn't exist yet (T3-6). If Josh shares the URL with a teammate before T3-6 ships, the recipient gets a tournament-web 404. **Not a blocker for "create the event"; document in completion notes.**

**Scope discipline: tight.**
- Zero new deps. useState + hand-rolled Zod + AbortController (mirroring T2-5).
- Path footprint: 4 new files + 2 modified + 1 auto-regen. **Zero SHARED gates.**
- Risk Acceptance §1's "no SHARED expected" prediction held — fifth story in a row to ship without a SHARED stop (AI-2 success).
- Spec went 4 rounds in codex (the AI-1 cap) for a complex story — acceptable. Each round addressed real issues: timezone helper API, useQuery thunk shape, 409 internal contradiction, error-code consistency, token shape, rounds count, CSRF clarity, env-portable invite URL, client coercion at boundary, helper-copy posture, pre-flight FK validation, rollback test mechanism.

**Concerns / observations:**

1. **Default 1 round in step 2** (per spec §8) means Josh has to manually click "Add round" 3 times for Pinehurst (4 rounds). Mild friction but explicit; the Pinehurst use case is documented in AC #20.

2. **Anonymous redirect goes to `/api/auth/google` not `/auth/sign-in?next=...` (epic line 888 deviation, AC #22 documented).** The post-OAuth callback redirects to `/` (PUBLIC_APP_URL home), so an anonymous Josh clicking the wizard link gets:
   - Click → redirect to /api/auth/google
   - Sign in
   - Redirected to home, NOT back to /admin/events/new
   - Re-navigate manually
   
   Mild friction. Future polish: add `?next=/admin/events/new` parameter through the OAuth flow.

3. **The wizard has no "Save draft" affordance.** If Josh is half-way through filling step 2 and his browser closes, the form state is lost. v1 acceptable (the wizard takes <2 minutes); a future polish story could add localStorage persistence.

**Recommendation: ship.** AC #20 manual smoke at `/admin/events/new` is the final gate.

---

## 🧪 Quinn (QA) — Test Coverage / Failure-Mode Perspective

**Coverage analysis.** Test deltas:
- @tournament/api: 266 → 277 (+11 backend tests; 38% over AC #16 minimum of +8)
- @tournament/web: 11 → 16 (+5 frontend tests; 25% over AC #17 minimum of +4)

**Backend test inventory** (admin-events.test.ts):

| # | Test | Failure Mode |
|---|---|---|
| 1 | Happy path 201 + 4-table verify + invite token shape (regex + length 43) + contextId stamping all 4 tables | Persistence + token contract + stamping discipline |
| 2 | Zod end_date < start_date → 400 invalid_body | Schema-layer date refine |
| 3 | Zod round_date outside [start, end] → 400 invalid_body | Schema-layer per-round refine |
| 4 | Zod empty rounds → 400 invalid_body | Schema-layer min(1) |
| 5 | Zod invalid IANA tz "foo/bar" → 400 invalid_body | Schema-layer .refine(isValidIanaTimezone) |
| 6 | Pre-flight unknown course_revision_id → 400 unknown_course_revision with missing list | Pre-flight existence check |
| 7 | Anonymous → 401 session_missing | requireSession middleware |
| 8 | Non-organizer → 403 not_organizer | requireOrganizer middleware |
| 9 | Body > 16 KiB → 400 body_too_large | bodyLimit middleware |
| 10 | db.transaction spy throws → 500 create_failed + atomicity (0 rows in all 4 tables) | Transaction rollback + error mapping |
| 11 | Multi-round event (4 rounds) → round_number 1..4 sequential | Array-index → round_number contract |

**Frontend test inventory** (admin.events.new.test.tsx):

| # | Test | Coverage |
|---|---|---|
| 1 | Step 1 idle render: Basics inputs visible; Next disabled | Initial render + completeness gating |
| 2 | Step 1 → 2 → 1 transition: values preserved on Back | State preservation across step changes |
| 3 | Validation: end_date < start_date → Next stays disabled | Client-side step1Valid gating |
| 4 | Full happy-path: fill all 3 steps + Submit → 201 → success screen with invite URL | Full wizard flow + success state |
| 5 | Save error: 400 unknown_course_revision → friendly message + form preserved | Server-error UX mapping |

**Failure modes well-covered:**
- ✅ Each backend layer (Zod / pre-flight / middleware / tx) has at least one rejection test
- ✅ Atomicity asserted on the rollback test (all 4 tables checked for 0 rows)
- ✅ Token entropy contract pinned (regex + exact length 43)
- ✅ contextId stamping verified on all 4 tables (regression guard against future changes)
- ✅ Multi-round event verifies round_number sequence (catches off-by-one in array-index → round_number conversion)
- ✅ Frontend step-transition AND state-preservation both tested
- ✅ Frontend full happy-path includes payload-shape verification (asserts dates coerced to numbers, holes_to_play coerced to number)

**Failure modes NOT covered (acceptable Lows):**
- **AbortController on unmount** is not separately tested. Manually verifiable: navigating away mid-submit aborts the fetch. Not test-covered because vitest's component unmount in the middle of a fetch is awkward to assert. Mirrored from T2-5 untested-unmount-abort posture. **Acceptable.**
- **Concurrent submit races.** If the user double-clicks Submit, the `saveAbortRef.current?.abort()` line aborts the prior request before kicking off the new one (admin.events.new.tsx:227-230 region). Tested implicitly by the spy pattern but not by explicit race scenario. **Acceptable.**
- **Course-list fetch failure on step 2** (impl-codex round-2 Low). No friendly error message; Submit becomes blocked. Fail-soft but ugly UX. **Future polish.**
- **OAuth redirect-then-back UX.** Per John's analysis, anonymous → /api/auth/google → home (loses step). Manual smoke (AC #20) catches this; not unit-test-covered. **Acceptable; future polish for `?next=` parameter.**
- **Pre-flight TOCTOU race.** Tested mechanism: pre-flight catches missing IDs cleanly. NOT tested: a race where a course_revision is deleted between pre-flight and tx INSERT → falls through to FK 500. Per Mary's threat-model analysis, this is essentially unreachable in production (course_revisions are RESTRICT-protected). **Acceptable; the safety net is the FK + existing 500 path.**

**Integration risks that surface at T3-3 / T3-6 / T5 time:**

- **Default Group naming `"{event.name} Crew"`** is hardcoded. T3-3 group CRUD will let organizers rename it. If an organizer renames AND deletes, the wizard's `Crew` is lost; T3-3 must handle that gracefully.
- **Invite token expires_at = now + 7 days.** T3-6's claim-flow handler must check expires_at < now → 410 Gone. The schema enforces NOT NULL on expires_at; the claim handler enforces semantics.
- **organizer_player_id taken from `c.get('player').id`.** Pin: T3-8's permissions middleware should enforce this matches the auth player. v1 middleware already does.

**Residual risk: low.** The test pyramid covers every load-bearing failure mode. The 5 untested edges are either downstream-spec problems, manual-smoke-covered, or polish.

**Recommendation: ship.** AC #20 manual smoke is the final gate.

---

## 💻 Amelia (Dev) — Code Quality / Maintainability Perspective

Code reads cleanly. Six observations:

1. **The wizard's state-machine pattern** (`form.step: 1|2|3` + conditional render branches) is verbose but readable. Each step's section is self-contained; the Next/Back transitions are 4-line functions. Compare to a multi-route wizard (3 separate `Route` files): the single-component design centralizes form state without router complexity. For a 3-step flow that fits in <500 lines, this is the right call. **No abstraction needed.**

2. **`isValidIanaTimezone` is duplicated** server (admin-events.ts:48-56) ↔ client (admin.events.new.tsx:64-71). Per the spec's no-SHARED rule. Same logic, same engine-deferred .format() trick. Mirrors the duplicate-cookie-extractor + duplicate-isUniqueConstraintError patterns elsewhere in the codebase. The promote-on-3rd-consumer rule applies if a 3rd consumer arrives. **Hold.**

3. **`CreateEventRequestSchema` lives in admin-events.ts** with its date refines visible adjacent to the Zod field declarations. Mirror schema on the client (per spec) is similarly co-located. Two sources of truth, both visible in their respective story files. **Consistent with T3-2's spec rationale.**

4. **The pre-flight try/catch** (round-1 Med fix, admin-events.ts:144-167) has a stage tag (`stage: 'preflight_course_revision_check'`) in its log event — distinguishes pre-flight failures from in-tx failures in the log stream. Future ops debugging will appreciate the granularity. **Small but thoughtful.**

5. **`enabled: form.step >= 2` on the courses query** (round-1 Med fix, admin.events.new.tsx:163) is the canonical TanStack Query pattern for step-gated fetches. Comment documents the rationale. **No surprises.**

6. **No `// eslint-disable`, no `as any`, no implicit any.** Casts are limited to:
   - `(input as Request).url` in test fetch mock router — narrowing fetch's RequestInfo union to a Request. Standard pattern.
   - `e.target.value as '9' | '18'` in the holes_to_play select — the `<select>` is constrained to those two values via `<option>` tags but TS doesn't infer that from the runtime constraint. Acceptable narrowing.

**Two minor cleanup items (Lows):**

- The unused `epochMsToDateString` function I initially wrote was caught by the lint pass and removed. Good — eslint config catches unused exports.
- The `as Record<string, unknown>` cast in `buildPayload`'s return type is loose. Could be tightened to a proper interface that mirrors CreateEventRequestSchema. Future polish; not blocking.

**Mid-impl observations worth noting:**

- The 3rd-mount pattern in app.ts (T3-3 will be the next admin sub-router) means we'll soon have `app.route('/api/admin', adminCoursesRouter)`, `app.route('/api/admin', adminEventsRouter)`, and `app.route('/api/admin', adminGroupsRouter)`. At ~5 mounts this gets noisy. The architectural promotion (single `adminRouter` umbrella) is Winston's call; from a code-quality view, the current pattern is fine for now.
- The `dateStringToEpochMs` helper assumes UTC midnight (`+'T00:00:00Z'`). For events in non-UTC timezones, this means "May 7" gets stored as 2026-05-07 00:00 UTC, which is May 6 21:00 EDT. **This is intentional** — the timezone is stored separately on the event row; the round_date is just "this calendar date in the event's timezone". Display code (T7) is responsible for rendering with the event's tz. Pin this in any T7-related future review.

**No blockers.** Ship.

---

## Synthesis & Verdict

All 5 perspectives converge: **ship T3-2 as-is** (after AC #20 manual smoke).

**Cumulative non-blocking flags (none warrant re-iteration):**

| Source | Flag | Disposition |
|---|---|---|
| Mary | TOCTOU race between pre-flight and tx INSERT | Falls through to FK 500; production unreachable |
| Mary | No edit/delete UI for events | Future T3-x story; v1 contingency = SSH + sqlite3 |
| Winston | isValidIanaTimezone duplicated server + client | Promote on 3rd consumer per codebase posture |
| Winston | Two-Zod-schema (client + server) drift risk | Acknowledged in spec; field-level changes require both updates |
| Winston | 3rd /api/admin mount (T3-3 next) gets noisy | Promote umbrella adminRouter at ~5 mounts |
| John | Default 1 round in step 2 (Pinehurst needs 4) | Mild friction; documented |
| John | Anonymous → /api/auth/google → home (loses step) | Future ?next= polish |
| John | No "Save draft" affordance | v1 acceptable (wizard <2 min); future polish |
| John | /invite/{token} route doesn't exist (T3-6) | Document; share-link only useful post-T3-6 |
| Quinn | AbortController on unmount not separately tested | Mirrors T2-5 untested-unmount posture |
| Quinn | Concurrent Submit race tested implicitly only | Acceptable; abort-prior pattern in code |
| Quinn | Course-list fetch failure on step 2 has no UX | Future polish (impl-codex R2 Low) |
| Quinn | Pre-flight TOCTOU race not tested | Production unreachable per Mary |
| Amelia | dateStringToEpochMs assumes UTC midnight | Intentional + correct given timezone-on-event-row design |
| Amelia | buildPayload return type loose (Record<string, unknown>) | Future polish |

**No agent has open questions for the user.** No proposed code changes warrant another impl iteration. **Director may proceed to step 9 (codex-on-party-review).**

Epic T3 progress: 2/10 done (T3-1, T3-2). Next story: T3-3 (group CRUD UI).
