# T3-10 Party-Mode Review (non-interactive written)

**Story:** T3-10 — Optional GHIN Enrichment Profile Action.
**Status:** review
**Generated:** 2026-04-27
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T3-10 is the **last story in Epic T3** and closes the FR-E11 promise: GHIN linkage is OPTIONAL — at no point can a NULL or lookup failure block the player from using the app. Strategic significance: this is the FIRST player-facing self-service mutation surface in the tournament app (T3-9 was organizer-only), and it sets the pattern for every future "manage your own profile" action.

**Threat model — six surfaces:**

1. **GHIN brute-force enumeration via the link endpoint.** Direct mode accepts a positive integer and validates via getHandicap. An attacker could bind every reachable GHIN one at a time. Mitigation: requireSession gates the endpoint (any authenticated player); UNIQUE constraint prevents binding a GHIN already taken; per-tenant scoping. Real risk: **none for v1** (8-player Pinehurst Crew, all GroupMe-vetted). Future hardening: rate limit per session or per IP.

2. **Identity-confusion via search → pick flow.** If the search returns 5 candidates and the player picks the wrong one, they bind to someone else's GHIN. Mitigation: pick-mode re-validates via getHandicap (defense-in-depth — confirms the chosen GHIN is real before binding). UNIQUE constraint catches "already-bound to someone else" → 409. The user sees the picker with club + state info to disambiguate. **Acceptable for v1.**

3. **Tenant scoping across all 3 mutations + extended GET /status.** Every UPDATE on `players` is filtered on `tenant_id = TENANT_ID`. The new GET /status SELECT is similarly scoped. Defense-in-depth for v1.5+ multi-tenant. **Solid.**

4. **FR-E11 invariant in the code.** Searched the diff: no new `if (player.ghin === null) return 4xx/5xx` guards. The 404/503/409 paths on the link endpoint return error status WITHOUT mutating `players.ghin` (verified by inspection of bindGhin's structure: getHandicap → throw → return error JSON; UPDATE only on success). Codified by Test #2 ("404 ghin_not_found ... Player.ghin remains NULL"). **Verified.**

5. **GHIN client unset at runtime (env vars empty).** Returns 503 ghin_unavailable; player can still use the app. Test #3 pins this. **Honors FR-E11.**

6. **Manual handicap range -10 to 54.** Matches USGA WHS spec. Out-of-bounds (e.g., 100) → 400 invalid_body. Catches typo errors (user types `100` instead of `10.0`) without rejecting legitimate plus-handicap players. **Right bounds.**

**Strategic significance:** the "opt-in to enrichment" pattern is now established. Future stories (cross-event stats, leaderboard handicap views) can rely on `players.ghin` being populated for opted-in players, NULL for everyone else.

**Recommendation: ship.** AC #15 manual smoke (Josh's link/unlink/manual flow) is the final gate.

---

## 🏗️ Winston (Architect) — System Design Perspective

Six observations:

1. **GET /status extension is additive.** New fields (`ghin`, `manualHandicapIndex`) added to the response shape; no removal, no rename. Existing T2-3b consumers extract `id` + `isOrganizer` only and ignore unknown keys (manual `validateAuthStatus` function — NOT a `Zod.strict()` validator). Spec round-1 codex round-1 verified safe. The new T3-10 frontend uses the new fields. **Right pattern.**

2. **`bindGhin` helper inside the POST handler.** Closure over `ghinClient`, `db`, `session`, `requestId`, `log`, `body.mode`. Used by direct, pick, AND search-single-match. ~50 lines; pulling it out would force passing 6 args. **Inlined helper is the right tradeoff.**

3. **Pick-mode re-validates via getHandicap.** Defense-in-depth — confirms the chosen GHIN is real before binding. Adds one upstream API call per pick, but the search returned matches already (so the GHIN definitely existed at search time); the re-validate handles the rare race where the GHIN was deleted between search and pick. **Right.**

4. **UNIQUE constraint catch via `isUniqueConstraintError`.** Mirror of T1-6b's auth.ts pattern. Catches drizzle's wrapped LibsqlError. The 409 response is user-class (the user can pick a different GHIN); no retry. **Pattern reuse.**

5. **Manual handicap as a separate endpoint, not bundled with link/unlink.** AC #4 + Risk §7 codify the FR-E11 invariant: manual_handicap_index is INDEPENDENT of GHIN state. A separate endpoint enforces that at the architecture layer (no shared transaction, no shared state machine). **Clean separation.**

6. **No new dep + no migration.** T3-1 schema already had `players.ghin TEXT NULLABLE` + `manual_handicap_index REAL NULLABLE` + partial UNIQUE on ghin. T3-10 is pure code over existing schema. **Minimal blast radius.**

**Architectural concerns: zero blockers.**

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T3-10 satisfy a v1 player-facing user promise?** Yes. Pre-T3-10, GHIN linkage required Josh to manually run SQL. Post-T3-10, players self-service. The scope is exactly what the FR-E11 revision (2026-04-18) promised: opt-in, never-blocking, easy to recover from mistakes (unlink + re-link).

**Scope discipline check:**
- 6 ALLOWED files touched (3 modified backend, 1 modified test, 2 NEW frontend) + 1 auto-regen routeTree.
- 0 SHARED edits.
- 0 FORBIDDEN edits.
- No deps. No migrations.

**The "manual handicap" form input on the same page:** correct UX choice. Placing it on a separate route would force 2 navigations for a 30-second profile-setup flow. Per AC #7, the manual-handicap input is visible regardless of GHIN state. **Right scope decision.**

**One UX limitation (flagged by Mary's analyst review)**: rate-limiting the link endpoint to prevent enumeration. Out of v1 scope; track for future hardening.

**Path footprint compliance.** **Scope-disciplined.**

**Recommendation: ship.**

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 392 → 410 (+18). AC #11 floor was +14. Margin: +4.
- tournament-web: 43 → 50 (+7). AC #12 floor was +5. Margin: +2.
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).

**Backend coverage:**
| Branch | Test | Pin? |
|---|---|---|
| POST /me/ghin/link direct happy | ✅ | ✅ |
| POST direct 404 ghin_not_found | ✅ | ✅ |
| POST direct 503 client null | ✅ | ✅ |
| POST direct 409 ghin_already_linked | ✅ | ✅ |
| POST 401 anonymous | ✅ | ✅ |
| POST 400 invalid_body | ✅ | ✅ |
| POST search single match → AUTO-LINK | ✅ | ✅ |
| POST search multi-match → 200 result:multi-match | ✅ | ✅ |
| POST search zero matches → 404 | ✅ | ✅ |
| POST pick mode happy | ✅ | ✅ |
| PATCH /me/ghin happy: link + unlink → null | ✅ | ✅ |
| PATCH /me/ghin idempotent | ✅ | ✅ |
| PATCH /me/ghin 401 anonymous | ✅ | ✅ |
| PATCH /me/manual-handicap happy 12.5 | ✅ | ✅ |
| PATCH /me/manual-handicap NULL | ✅ | ✅ |
| PATCH /me/manual-handicap 400 (out of bounds 100) | ✅ | ✅ |
| PATCH /me/manual-handicap 401 anonymous | ✅ | ✅ |
| GET /api/auth/status returns ghin + manualHandicapIndex | ✅ | ✅ |

**Frontend coverage** (7 tests):
| Branch | Test | Pin? |
|---|---|---|
| Idle render with ghin=null: Link button + manual-handicap input | ✅ | ✅ |
| Idle render with ghin populated: Linked + Unlink buttons | ✅ | ✅ |
| Click Link → form with two tabs | ✅ | ✅ |
| Direct-mode submit → POST → linked state | ✅ | ✅ |
| Search → multi-match → pick → linked | ✅ | ✅ |
| Manual-handicap save → PATCH → success | ✅ | ✅ |
| Unlink confirm flow | ✅ | ✅ |

**Observations:**

1. **bodyLimit 4 KB 400 branch not tested.** Codex round-1 Low #3. Marginal coverage gain on generic Hono middleware; not blocking.

2. **`searchByName` ignores state param** (T3-4 known limitation). T3-10 spec acknowledges this. The frontend collects `state` and sends it; the backend forwards it but the GHIN client hardcodes WV. **Documented; not a coverage gap.**

3. **AbortController-on-unmount not separately tested.** Pattern shared with T3-3/T3-5/T3-6/T3-7/T3-9 (`inFlightControllers` ref + useEffect cleanup). Defensible per the established convention.

4. **No test for "0 rows affected" UPDATE path.** Impl codex round-1 Med flagged this as a correctness risk. In production, require-session validates `session.playerId` before the handler runs, so the player MUST exist (sessions.player_id FK RESTRICT to players.id). 0-rows-affected is unreachable. Documented as known limitation.

5. **FR-E11 invariant** (AC #16): no `players.ghin === null` guards introduced anywhere. Verified by inspection — the touched files (players.ts, auth.ts, profile.tsx) have zero such guards.

**Coverage verdict: solid.** Margin above AC floors; key correctness paths pinned.

**Recommendation: ship.** AC #15 manual smoke is the final gate.

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + AC IDs.

**`players.ts:215-242`** — Zod schemas for the 3 mutation routes. AC #1-#4.
- discriminatedUnion('mode') for link request: direct / search / pick.
- ManualHandicapRequestSchema with -10..54 bounds.

**`players.ts:250-373`** — POST /me/ghin/link handler. AC #2.
- L268-282: bodyLimit + invalid_body + Zod safeParse.
- L290-300: ghinClient null check (503 ghin_unavailable).
- L304-359: bindGhin helper closure. getHandicap → 404/503; UPDATE catches UNIQUE → 409; clean INSERT → 200 result:linked.
- L362-371: search-mode branching: 0 → 404, 1 → bindGhin (auto-link), 2+ → 200 result:multi-match.

**`players.ts:381-415`** — PATCH /me/ghin handler. AC #3.
- Tenant-scoped UPDATE; idempotent (re-unlink succeeds).

**`players.ts:417-481`** — PATCH /me/manual-handicap handler. AC #4.
- Body Zod safeParse + bodyLimit + tenant-scoped UPDATE.

**`auth.ts:91-120`** — GET /status extended. AC #6.
- Tenant-scoped SELECT on players. Nullish-coalescing handles missing rows defensively.

**`profile.tsx`** — frontend page. AC #5/#7/#8.
- L121-133: AbortController via inFlightControllers ref + useEffect cleanup. AC #8.
- L142-194: linkMutation with discriminator-aware onSuccess (linked → setPlayer + close form; multi-match → setMatches + render picker).
- L301-380: form with two tabs; direct-mode + search-mode + match-picker.

**Lint + typecheck + build:** clean. No `any`. No `// eslint-disable`. AC #14 satisfied.

**Tests: 410 backend** (392 + 18); **50 frontend** (43 + 7). AC #11 + AC #12 satisfied.

**No new deps. No migrations. No SHARED edits.** AC #17 satisfied.

**DRY notes:**
- Auth-status loader pattern duplicated across 6+ admin/profile routes. Promotion to a shared util is overdue.
- TENANT_ID constant in 6+ files. FD-6 tenant resolver remains a future story.

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five disciplinary perspectives converge. Spec-codex hit terminal-clean in 2 rounds (1H+4M+1L → 0H+0M+1L). Impl-codex iterated 2 rounds: round-1 Critical (mid-file import) fixed; round-2 Med (implicit any) fixed defensively. Test deltas exceed AC floors with margin. Path footprint is fully ALLOWED, zero SHARED, zero FORBIDDEN. Wolf Cup regressions clean. **Last story in Epic T3** — Director will gate the user on epic completion + retrospective after the commit.

**Load-bearing correctness fixes:**
1. Response `result` discriminator (round-1 spec codex catch) — disambiguates `linked` vs `multi-match` for the frontend.
2. UNIQUE constraint catch → 409 (no retry; user-class error class).
3. Pick-mode re-validates via getHandicap (defense-in-depth against deleted-between-search-and-pick race).
4. Tenant scoping on every players UPDATE/SELECT including the new GET /status SELECT.
5. FR-E11 invariant codified by AC #16 + verified by inspection (no new GHIN-null guards anywhere).

**Documented limitations** (acceptable for v1):
- bodyLimit 400 branch not tested — generic middleware; pattern exercised elsewhere.
- 0-rows-affected on UPDATE returns 200 — unreachable in production via require-session FK chain.
- searchByName ignores state param — T3-4 known limitation, documented.
- No rate limit on link endpoint — out of v1 scope (8-player Crew is GroupMe-vetted).
- AbortController-on-unmount not separately tested — pattern shared.

**Followups** (track but not blockers):
- Auth-status loader → shared util.
- TENANT_ID → FD-6 tenant resolver.
- Rate limiting on link endpoint (post-v1 hardening).
- Pre-T3-7 admin route tenant-scoping retrofit.

**Manual smoke (post-deploy, Josh, AC #15):**
1. Visit `/profile`. Verify "GHIN not linked" + "Link your GHIN" button.
2. Tap "By name" tab; enter "Stoll" + "Josh"; submit. Verify auto-link or disambiguation picker.
3. Verify "GHIN linked: <number>" + "Unlink" button.
4. Set manual handicap to e.g. 12.5; verify Save success.
5. Click "Unlink"; confirm; verify return to "GHIN not linked" state.

**Epic T3 will be COMPLETE after this commit.** Director's epic-completion gate will fire on the next loop iteration.

**The director workflow can proceed to commit.**
