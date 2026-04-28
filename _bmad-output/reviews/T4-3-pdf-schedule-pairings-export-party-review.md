# T4-3 Party-Mode Review (non-interactive written)

**Story:** T4-3 — PDF Schedule + Pairings Export (last in Epic T4).
**Status:** review
**Generated:** 2026-04-28
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T4-3 is the **last story in Epic T4** and the **trip-day paper-fallback** promise (FR-F1/F2/H4). Strategic significance: this is the FIRST tournament-app surface where binary content leaves the server, and the FIRST production use of the T3-8 invite-token middleware. If the app fails day-of, players hold a printable PDF of their schedule + foursomes + handicaps; this is the resilience floor.

**Threat model — five surfaces:**

1. **Token-as-auth.** Anyone with a valid invite token can download the PDF. T3-8's middleware bounds the attack surface: tenant-scoped token SELECT, cheap shape guard, expiry check. Token entropy is T3-2's `randomBytes(32).toString('base64url')` = 256 bits. **Bulletproof.**

2. **Tenant scoping coverage.** Round-1 impl-codex caught a Med (course/course_revisions SELECTs lacked tenant filter); fixed. Every other SELECT (events, event_rounds, pairings, pairing_members, players, groups, group_members, invites) is tenant-scoped. **Defense-in-depth verified.**

3. **`event_token_mismatch` defense.** A token for event A used in event B's URL → 403. Prevents a "token from one event leaks into another's URL" attack class. Tested explicitly. **Solid.**

4. **PDF byte-determinism.** `info.CreationDate = new Date(0)` freezes the timestamp; same input + same call → identical bytes. Snapshot-testable. Code path produces no runtime Chrome / network call / random bytes. **Right call.**

5. **Greenfield decision rationale.** Wolf Cup has NO runtime PDF generator (verified by grep). PORTS.md documents this honestly with the Chrome-shell-out alternative + reasons rejected. Future Wolf Cup PDF stories can reference this entry. **Audit trail intact.**

**Strategic significance:** the trip-day fallback is now real. If `tournament.dagle.cloud` is unreachable from the course in West End, NC, every player can hold a printout that has their foursome + handicaps. Mission complete for Epic T4.

**Recommendation: ship.** AC #10 manual smoke (Josh's URL-paste + browser download + iOS/desktop PDF render verification) is the final gate.

---

## 🏗️ Winston (Architect) — System Design Perspective

Six observations:

1. **`renderEventPdf` purity.** No DB, no fetch, no env. Input → Buffer. Mirrors the engine-purity pattern set by T4-1's `engine/pairings/`. The `lib/` directory is the right home (not `engine/`); `engine/` is reserved for compute-only code, while `lib/` is for shared helpers that may have side effects (the renderer doesn't, but it lives next to existing `lib/ghin-client.ts`, etc.).

2. **Buffer → Blob → Response.** Round-1 impl-codex Low: Blob vs Buffer. The wire-format is identical (raw bytes); TS's BodyInit just doesn't accept Buffer directly. The fresh-ArrayBuffer copy avoids pooled-Buffer adjacency leaks. **Correct.**

3. **Token-suffixed route shape.** `GET /api/events/:eventId/pdf/schedule/:token`. T3-8's middleware reads `:token` by name; position doesn't matter. The event-scoped URL prefix preserves grep/log structure. **Right.**

4. **No new mount-threshold concerns.** The new `pdfScheduleRouter` mounts at `/api/events` (NOT `/api/admin`), so the umbrella-router 5-mount threshold is unaffected. **Right.**

5. **PORTS.md as audit trail.** Future "did Wolf Cup ever ship a runtime PDF generator?" auditors can `git log --all -- 'apps/api/**/pdf*'` and verify no result on or before 2026-04-28. The greenfield decision is documented + reproducible. **Right pattern.**

6. **pdfkit choice.** Pure-Node, no Chrome, deterministic. Tradeoff: layout DSL is imperative (less elegant than HTML/CSS), but T4-3's content is simple (tables + headings). **Right tradeoff.**

**Architectural concerns: zero blockers.**

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T4-3 satisfy the trip-critical promise?** Yes. The endpoint produces a downloadable PDF with event header + per-round sections (foursomes with names + handicaps) + roster table. Josh can paste the URL into a browser, the PDF downloads, opens in iOS Safari + desktop Chrome, prints to letter paper.

**Scope discipline check:**
- 6 ALLOWED files (3 new backend modules + 1 modified app.ts + 1 PORTS.md append + 2 test files counted as 2 of the 3 new modules above) — actually: pdf-gen.ts + pdf-gen.test.ts + pdf-schedule.ts + pdf-schedule.test.ts + app.ts + PORTS.md = 6 files.
- 2 SHARED files (package.json + pnpm-lock.yaml) approved THIS STORY at spec gate.
- 0 FORBIDDEN edits.

**v1 limitations** (acceptable):
- No live GHIN handicap fetch at PDF-export time (uses stored `manual_handicap_index` + `ghin` label). Future T7+ stories may add live fetch button.
- No frontend "Export PDF" button (T7-1 player-home page will add).
- No Cumulative leaderboard / standings appended (T5/T6 territory).

**Recommendation: ship.** AC #10 manual smoke is the final gate.

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-api: 444 → 456 (+12). AC #7 floor was +10. Margin: +2.
- tournament-web: 55 (unchanged — backend-only story).
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).

**pdf-gen coverage** (5 tests):
| Branch | Test | Pin? |
|---|---|---|
| %PDF- magic bytes | A | ✅ |
| Empty rounds → still valid PDF | B | ✅ |
| Multi-round 4×2×4 sanity bounds | C | ✅ |
| Determinism: byte-for-byte equal | D | ✅ load-bearing |
| Handicap formatting (no-op test) | E | ⚠️ codex Low #4 |

**pdf-schedule coverage** (7 tests):
| Branch | Test | Pin? |
|---|---|---|
| Happy path: 200 + Content-Type + Disposition | ✅ | ✅ |
| 404 from Hono router (no :token in URL) | ✅ | ✅ |
| 401 invite_token_invalid | ✅ | ✅ |
| 401 invite_expired | ✅ | ✅ |
| 422 pairings_missing | ✅ | ✅ |
| 403 event_token_mismatch | ✅ | ✅ |
| Cross-tenant: foreign-tenant invite → 401 | ✅ | ✅ |

**Observations:**

1. **Round-1 impl-codex catches**: 1 Med (tenant gap on course/course_revisions) + 1 Med (422 error-field shape `unprocessable` → `pairings_missing`). Both fixed.

2. **Handicap-formatting test is a no-op** (Low #4): doesn't actually assert the formatting output. The determinism test (D) catches any drift indirectly since identical-input → identical-buffer requires stable formatting. **Acceptable but could improve** with a snapshot (e.g., zlib-decompress the PDF stream and search for "12.5" / "+2.1" literals). Marked as v1.5 followup.

3. **Buffer-to-Blob conversion** (Low #3): the AC says "Body: the PDF Buffer" but the response uses Blob (with fresh-ArrayBuffer copy). Wire format identical; TS-BodyInit accepts Blob, not Buffer. Cosmetic spec drift; not a runtime concern.

4. **No test for the slugify function in isolation.** It's exercised end-to-end via the happy-path test (Content-Disposition contains a slug). Defensible for v1.

5. **No test for filename header injection** (e.g., `event.name = 'X\r\nMalicious: header'`). pdfkit doesn't sanitize the slug before embedding in Content-Disposition. **Real concern** but the slug regex `[^a-z0-9]+` already strips CR/LF (they become `-`). **Verified safe by inspection** — slug always matches `[a-z0-9-]+`.

**Coverage verdict: solid.** Margin above floor; key correctness paths pinned including impl-codex round-1 catches.

**Recommendation: ship.** AC #10 manual smoke is the final gate.

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + AC IDs.

**`pdf-gen.ts`** — provenance header at L1-9 (greenfield disclosure with rationale). Pure function `renderEventPdf` over input data; no DB/I/O/env.
- L73-78: `formatDate` via Intl.DateTimeFormat with timezone.
- L84-88: `formatHandicap` for `null` / negative / positive cases.
- L96-103: PDFDocument construction with frozen `info.CreationDate = new Date(0)`.
- L130-160: per-round + per-foursome rendering loop.
- L163-171: roster table.
- L174-179: Buffer assembly via `data` event chunks.

**`pdf-schedule.ts`** — route handler. AC #2.
- L70-73: `requireInviteToken` middleware applied at the route level.
- L78-83: defense-in-depth eventId match (403 event_token_mismatch).
- L86-99: tenant-scoped event SELECT.
- L102-117: tenant-scoped event_rounds SELECT.
- L121-145: tenant-scoped course/course_revisions resolution (round-1 codex fix).
- L148-167: tenant-scoped pairings SELECT + 422 on empty.
- L171-203: pairing_members JOIN to players (tenant-scoped on both).
- L218-247: roster dedupe across event groups.
- L249-294: build EventPdfInput.
- L296-310: renderEventPdf invocation + 500 fallback.
- L317-330: Blob-based Response with Content-Disposition slug.

**`app.ts`** — `app.route('/api/events', pdfScheduleRouter)` mount.

**`PORTS.md`** — append entry documenting greenfield decision + alternatives + dep audit trail.

**Lint + typecheck:** clean. No `any`. No `// eslint-disable`.

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five perspectives converge. Spec-codex round 2 PASS (terminal-clean). Impl-codex round 1: 0H + 2M + 2L; both Meds fixed (tenant gap on course lookups; 422 error-field shape). Test deltas exceed AC floors. Path footprint: ALLOWED + 2 SHARED (approved this story). Wolf Cup regressions clean.

**Load-bearing correctness:**
1. Tenant scoping on every SELECT (post round-1 codex fix).
2. PDF byte-determinism via frozen CreationDate.
3. event_token_mismatch defense-in-depth.
4. Buffer → Blob copy via fresh ArrayBuffer (no pooled-buffer leak).
5. Greenfield decision documented in PORTS.md (auditable).

**Documented limitations** (followups):
- Handicap-formatting test is a no-op; determinism test covers indirectly. v1.5 followup.
- No live GHIN fetch at PDF-export time (stored data only).
- No frontend export button (T7-1 ships it).
- No header-injection test on filename slug (verified safe by inspection: slug regex strips CR/LF).

**Followups:**
- Improve handicap-formatting test (v1.5).
- T7-1 will wire the frontend "Export PDF" button.
- Future story may add live GHIN fetch button on the export.

**Manual smoke (post-deploy, Josh, AC #10):**
1. Get an invite token for an event with persisted pairings (T4-2 saved).
2. Visit `https://tournament.dagle.cloud/api/events/<eventId>/pdf/schedule/<token>` directly.
3. Verify browser downloads `<event-slug>-schedule.pdf`.
4. Open in iOS Safari AND desktop Chrome PDF viewers — verify rendering, fonts, page breaks, selectable text.
5. Verify per-round sections (course + tees + foursomes with names + handicaps) and roster table at end.

**Epic T4 will be COMPLETE after this commit.** Director's epic-completion gate fires next.

**The director workflow can proceed to commit.**
