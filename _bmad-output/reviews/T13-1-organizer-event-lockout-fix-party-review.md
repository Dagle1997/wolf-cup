# T13-1 Organizer Event-Lockout Fix — Party-Mode Review

**Mode:** non-interactive written review (no open questions to the user).
**Story:** T13-1-organizer-event-lockout-fix (Epic T13, production run-through bug fixes)
**Change:** `requireEventParticipant` now exempts THIS event's organizer (`events.organizer_player_id`, tenant-scoped) on the non-member path; 4 new middleware tests + 1 integration test; 2 **tournament-web** render tests (the admin link pre-existed). The tournament-web *component* was NOT modified — the API fix makes the existing organizer link reachable by removing the 403 short-circuit.
**Allowlist note (for context-free readers):** every edited path is under `apps/tournament-api/**` or `apps/tournament-web/**` (ALLOWED). "tournament-web" is the Tournament app and is NOT Wolf Cup's `apps/web/**` (FORBIDDEN); no FORBIDDEN path is touched. "No external API code" here means no third-party HTTP integration (Anthropic/GHIN/etc.) — it does not imply "no front-end work".
**Status entering review:** tournament-api 970 ✓ (+5), tournament-web 331 ✓ (+2), engine 472 ✓, wolf-cup-api 517 ✓, typecheck + lint clean, impl codex PASS (0 findings after one test-hardening round).

---

## 📊 Mary — Business Analyst

Requirements trace cleanly to a defect confirmed against prod data (organizer row + empty `group_members` → 403 on the event home). The story is correctly *narrow*: it fixes the participant-view lockout and explicitly defers the broader multi-organizer authorization model (event-creation-for-all, per-event roles, tenancy) to a dedicated design pass. That deferral is the right call — bundling them would have conflated a clear bug fix with an open design question. The ACs are falsifiable and the prod evidence is cited. **No requirements gaps.**

## 🏗️ Winston — Architect

This is the architecturally-honest version. The fix sits at the single chokepoint (`requireEventParticipant`), so every participant-gated route inherits it, and it keys on `events.organizer_player_id` — the **event-specific** authorization unit, deliberately not the global `is_organizer` flag. That matters because the confirmed product direction is multi-organizer: a global-flag exemption (the originally-proposed Option A) would have let any organizer read anyone's event, which would have been a latent authorization defect the moment a second organizer existed. Option B is forward-compatible with the coming model and grants nothing broader than "view events you organize." The membership-query-first / organizer-lookup-only-for-non-members ordering keeps the common path's cost unchanged. The tenant conjunct on the organizer lookup preserves the no-existence-leak invariant. My one forward note (already captured as a followup, not a gap): the global `requireOrganizer` + hardcoded `TENANT_ID='guyan'` still encode the single-org assumption — that's the explicitly-scheduled multi-org pass, and T13-1 is built to fit it. **No architectural concerns.**

## 📋 John — Product Manager

Smallest change that unblocks the real user (you, the organizer, locked out of your own event) without prejudging the bigger platform decision. WHY it matters: this is the literal first wall a brand-new organizer hits, so it would have blocked every future event setup. Shipping B now buys correctness *and* keeps the multi-org design open. The interim web-link gating on the global flag is acceptable because it's a convenience, not an authority boundary (server enforces). **Ship-ready from a product lens; the multi-org model is correctly the next planning item, not this story's burden.**

## 🧪 Quinn — QA Engineer

Coverage is strong and, after the hardening round, actually proves the security property. The pivotal test is "403 for the organizer of a DIFFERENT event": it seeds two events and authenticates as event B's organizer hitting event A — so a regression dropping the `events.id` conjunct would flip it to 200 and fail the test. That's the test that earns its keep. Plus: this-event-organizer→200, cross-tenant→403, nonexistent→403, and the integration test on the real `GET /api/events/:eventId` with `isOrganizer:false` stamped (proving the exemption is keyed on `organizer_player_id`, not the flag). The 2 web tests assert the admin link's presence/absence by `isOrganizer`. Honest gaps, all acceptable: no live end-to-end against the authed prod route (that's the separate run-through), and the empty-`name` player issue is out of scope. **Tests adequate; all green first run.**

## 🎨 Sally — UX Designer

The dead-end is gone: the organizer now reaches their event home and sees the "Manage event → pairings, roster, sub-games, courses" affordance that was always there but hidden behind the 403. That's the bridge to the roster-building flow the organizer actually needs. One honest note (already a followup, not a blocker): the link is gated on the *global* organizer flag, so under multi-org a global organizer viewing an event they don't own could see a "Manage event" link that the server then rejects — mildly confusing, but not a dead-end and not an auth hole. Making it event-specific (an `isEventOrganizer` flag on the event response) folds into the multi-org pass. **No UX changes required for this story.**

## 💻 Amelia — Developer

Implementation matches spec AC-by-AC. AC-1: organizer exemption keyed on `organizer_player_id`, tenant-scoped, membership-first. AC-2: five middleware paths incl. the strengthened distinguishing test. AC-3: integration test on `GET /api/events/:eventId` proves the real route returns 200 for the no-membership organizer. AC-4: tournament-web render tests for link present/absent (component unchanged — link pre-existed; the fix is making it reachable). AC-5: 970/331/472/517 green, typecheck + lint clean. No drift; the only post-impl-codex change was the test hardening, which was re-reviewed clean. **No drift.**

---

## 🧙 BMad Master — Consolidated Verdict

All six perspectives converge: T13-1 correctly fixes the organizer lockout with the multi-organizer-compatible Option B, the test that matters actually guards the event-specific scoping, and the broader multi-organizer model is properly deferred to its own design pass (not bolted on here). Residual items (interim global-flag web gating; empty player name; the full multi-org auth/tenancy redesign) are all explicitly out of scope and recorded.

**Verdict: SHIP-READY. Zero required changes.**
