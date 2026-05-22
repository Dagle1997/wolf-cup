# Multi-Organizer Platform — Design Proposal (for review)

**Status:** PROPOSAL — not a decision. Drafted 2026-05-22 after Josh confirmed the product scope is bigger than the single-organizer v1: *"Anyone with a verified account should be able to open the app and create an event and invite people to it or add non-verified users with GHINs."* Needs Josh's decisions on the open questions in §6 before any implementation.

**Relationship to prior decisions:** This EXTENDS the architecture's anticipated direction, it does not contradict it. FD-13 ("Single-admin v1 with four guardrails") was a deliberate v1 scoping choice; FD-6 already put `tenant_id` + `context_id` on every writable table; D4-7 names `brand.ts` as "the single-tenant surface that multi-tenancy (v2+) swaps for a per-tenant resolver"; D5-10 notes "per-tenant buckets are v2+". So the scaffolding for this was laid intentionally.

---

## 1. Current state (evidence-grounded, verified 2026-05-22)

| Concern | How it works today | Evidence |
|---|---|---|
| Who can create an event | Only a player with the GLOBAL `is_organizer` flag | `admin-events.ts:111-112` (`requireSession → requireOrganizer`); `require-organizer.ts:40` checks `player.isOrganizer` |
| New user's organizer status | New Google sign-ups get `isOrganizer: false` | `auth.ts:797` |
| Admin authorization | Global: any `is_organizer` player can admin ANY event | `requireOrganizer` (global flag); `app.use('/admin/*', requireOrganizer)` pattern (D2-3) |
| Per-event organizer | Recorded (`events.organizer_player_id`) but NOT used for auth (until T13-1's participant-view exemption) | `events.ts:46`; T13-1 |
| Tenancy | Single hardcoded tenant `'guyan'` in every middleware WHERE clause | `TENANT_ID = 'guyan'` (all middleware); `DEFAULT_TENANT_ID` (`auth.ts:52`) |
| Tenant columns | `tenant_id` + `context_id` exist on every table (NOT NULL, defaults) but are NOT dynamically resolved — v1 pins them to `'guyan'` | FD-6; architecture L497 "NOT filtered by v1 queries" |
| Accountless roster | Organizer CAN add players by GHIN or manual name+handicap with NO account; invite-claim binds them by device (Google optional/later); one logged-in scorer per foursome scores for all four | `admin-groups.ts:394-458`; `invites.ts:203-419` |

**Bottom line:** the *data model* is already multi-organizer-ready (`organizer_player_id`, accountless players, FD-6 columns). The constraints live in the *authorization layer* (global flag + global `requireOrganizer`) and the *hardcoded tenant*.

## 2. Target vision (Josh, 2026-05-22)

- Any verified (Google) user can create an event and becomes its organizer.
- That organizer invites people (who optionally log in) and/or adds non-verified players by GHIN/handicap.
- Scales to "many many people" — multiple independent organizers running their own events.

## 3. The two axes (separate these — they have very different cost)

**Axis A — Multi-ORGANIZER.** Any verified user can create + own + administer THEIR events; authorization becomes per-event. Mostly an authorization-layer change. The data model already supports it.

**Axis B — Multi-TENANT.** True data isolation between separate communities/leagues (organizer X's world never sees organizer Y's). The heavier, v2+ item — touches the hardcoded `TENANT_ID`, `brand.ts`, R2 prefixes, and cross-tenant query filtering.

**Key insight:** You can have **multi-organizer within a single shared tenant** (many events + many organizers, one shared player/course pool) WITHOUT full multi-tenancy. Whether you ALSO need Axis B depends entirely on whether different organizers' data must be isolated from each other — that's the #1 decision (§6.1).

## 4. Proposed phased plan

### Phase 1 — Multi-organizer, single shared tenant (delivers most of the vision)
1. **Any verified user can create events.** Drop `requireOrganizer` on `POST /api/admin/events`; require only `requireSession`. The creator's `player.id` becomes `events.organizer_player_id`.
2. **Event-scoped admin authorization.** Introduce `requireEventOrganizer` (checks `events.organizer_player_id === player.id`, tenant-scoped) and apply it to event-admin routes (`/api/admin/events/:eventId/*`, groups, pairings, rounds, rule-sets, sub-games for that event). Replaces the blanket global `requireOrganizer` on event-scoped admin actions. (T13-1 already did the read-side equivalent for `requireEventParticipant`.)
3. **Retain a global super-admin** (optional) for you/support — repurpose `is_organizer` as `is_super_admin`, or add a separate flag. Used for cross-event support, course-library curation, etc.
4. **Per-event roles (minimal):** organizer (creator) + participants (group members). Co-organizers are a later add (§6.3).
5. **Onboarding unchanged structurally:** OAuth still creates a player; that player can now create events. Accountless GHIN roster + invite-claim already work.

*Phase 1 is bounded to the authorization layer + the event-creation gate. No tenancy migration. This is where T13-1 is a down-payment.*

### Phase 2 — Multi-tenant isolation (only if §6.1 says it's needed)
1. Stop hardcoding `TENANT_ID`; resolve tenant per request (per organizer, per league, or per "community").
2. Per-tenant branding via the `brand.ts` resolver (D4-7 anticipated this).
3. Tenant-filtered queries everywhere (the FD-6 columns become live filters, not constants).
4. R2 prefixing per tenant (D5-10: "per-tenant buckets are v2+").
5. Data migration: assign existing `'guyan'` rows to the right tenant(s).

*Phase 2 is a real migration with isolation-correctness risk. Defer until the vision demonstrably needs isolated communities.*

## 5. Code surfaces touched (Phase 1)
- `apps/tournament-api/src/middleware/require-organizer.ts` → keep for super-admin; add `require-event-organizer.ts` (new, event-scoped).
- `apps/tournament-api/src/routes/admin-events.ts` (event creation gate) + the `/api/admin/events/:eventId/*` mounts → swap blanket `requireOrganizer` for `requireEventOrganizer` where event-scoped.
- `apps/tournament-api/src/routes/auth.ts` → decide new-user default role (§6.4).
- `apps/tournament-web` → "Create event" reachable for any verified user; event-specific `isEventOrganizer` flag on the event-detail response so the "Manage event" link (and admin nav) is event-correct (closes the T13-1 interim global-flag gating).
- Course library (`admin-courses`) + rule-sets: decide shared vs per-organizer (§6.5).

## 6. Open decisions (need Josh)

1. **Tenancy (the big one):** Do different organizers' events need to be ISOLATED from each other (Axis B / Phase 2), or is "many events in one shared community" (Phase 1 only) enough? E.g., should organizer X ever see organizer Y's events/players/courses? If never → Phase 2. If it's fine (one golf community, shared course library) → Phase 1 suffices for a long time.
2. **Global super-admin:** Keep a you/support role that can see/fix everything (recommended for ops), or pure per-event only?
3. **Co-organizers:** Does an event need multiple admins (e.g., you + a co-host), or is one organizer per event fine for now?
4. **Who can create events:** Any verified user immediately on first login? Or gated (invite-to-create, or you approve new organizers)? Affects spam/abuse posture if the app is public.
5. **Shared vs per-organizer resources:** Course library, rule-sets — shared across all organizers (one pool, less duplication) or scoped per organizer/tenant? (Courses are expensive to build via PDF parse, so a shared library has real value.)
6. **The `is_organizer` flag's fate:** repurpose as `is_super_admin`, drop, or keep alongside per-event roles?

## 7. Risks
- **Authorization regressions** — swapping global→per-event auth touches every admin route; needs the same rigor as T13-1 (per-route tests proving event-scoping, not global).
- **FD-13 guardrails under multi-org** — the four single-admin guardrails (mid-event rule edit, GHIN bailout, scorer handoff, role collapse) were designed for one admin; re-validate each under multiple organizers.
- **Abuse surface** — "any verified user creates events" makes the app effectively public; §6.4 (gating) + rate limits matter if it's not invite-only.
- **Phase 2 isolation correctness** — cross-tenant leak is a security bug class; the existing tenant-scoped middleware tests (e.g. T13-1's cross-tenant cases) are the pattern to extend.

## 8. Recommendation
Decide §6.1 first — it determines whether this is a bounded Phase-1 authorization project or a Phase-1+2 platform migration. My lean: **start with Phase 1** (any-user-creates-events + event-scoped authorization within the single shared tenant), since it delivers the felt vision (anyone creates events, invites, accountless GHIN rosters) with bounded risk and no data migration, and defer Phase 2 until isolation is a concrete need. T13-1 already moved the read-side to event-scoped authorization, so Phase 1 has a head start.
