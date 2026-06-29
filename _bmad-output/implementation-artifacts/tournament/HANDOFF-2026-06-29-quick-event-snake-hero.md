# Handoff — Tournament 2026-06-29 (afternoon): post-trip #1/#2 + Quick Event / snake / hero

## TL;DR
Two deploys today, both **SHIPPED + DEPLOYED + verified** on prod. The morning's
two open post-trip items (#1 claim modifiers, #2 putts) are DONE, and a 3-feature
phone-first build (Create Quick Event wizard + organizer hero + interactive snake
token) shipped on top. Prod HEAD = `9dc1700`, CI-green, health 200, migration 0026
applied on the encrypted prod DB. **One gate before relying on it: a 2-minute
phone smoke-test of the Quick Event flow (never field-tested).**

---

## Deploy 1 — `7c3128a` (post-trip #1 + #2)
| Item | Resolution |
|---|---|
| **#2 putts required** | Enforced at the score-entry **Save gate ONLY** (numeric 0–15 for putting-game players). Director review killed the API-side 422 — rejecting the whole hole write coupled a money-critical gross to a missing secondary stat and could silently drop a queued gross on sync. **Decision (Josh): a valid gross must ALWAYS persist.** No server reject. |
| **#1 claim modifiers not showing** | Root cause (Josh): per-foursome games were enabled but their rules were never entered → all claim modifiers off → no buttons, no prompt. The setup→pin→display path is correct + fail-open. Fix = **start-round preventive guard**: `422 no_claim_modifiers` (overridable `confirmNoModifiers`) when NO foursome enables any greenie/polie/sandie + a web prompt with rules links. Helper `noClaimModifiersForAnyFoursome`. |

Director review: codex+gemini full debate, both "criticals" were false positives
(verified: `puttsPlayerIds` is a Set; foursome configs ARE keyed by `pairing.id`).

## Deploy 2 — `9dc1700` (Quick Event wizard + organizer hero + snake token)
Phone-first ("all entry on phone"). **No new backend except snake** — the wizard
client-orchestrates existing organizer endpoints.

**A · Organizer hero** (`apps/tournament-web/src/routes/index.tsx`): centered hero
(⚡ Create Quick Event + ＋ Create New Event). Organizers no longer auto-redirect
into their one event (so the hero is reachable); players with one ACTIVE event still
auto-enter (`activeEvents.length===1`).

**B · Create Quick Event wizard** (`apps/tournament-web/src/routes/admin.events.quick.tsx`,
route `/admin/events/quick`, `beforeLoad: requireAuthOrRedirect`): course + today's
date + holes → #players + roster → arrange foursomes (per-player Group select,
`numFoursomes+1` options) → Guyan rules (whole-dollar point value + greenie/polie/
sandie pills) + Putting?/Snake? → Start. Orchestration order: `POST /api/admin/events`
→ `GET .../admin-context` (groupId + eventRoundId) → `POST groups/:id/members` ×N →
`PUT .../scorer-policy {open}` → `PUT .../game-config` (if Guyan) → `POST
event-rounds/:er/sub-games` (putting/snake) → `POST .../pairings` (locked) → `POST
event-rounds/:er/start` (organizer as scorer; open policy + group-member gate let any
validated player score) → navigate to score-entry. Point value REQUIRES a positive
whole-dollar integer (engine rejects non-×100 cents) — Start blocked + inline error
on invalid (no silent coercion). **Partial failure leaves a half-created event** (the
organizer can cancel it from Home) — acceptable for a throwaway test path.

**C · Interactive snake token**: snake is now its own `sub_game` **type** (separate
election from putting). **Migration 0026** extends the `sub_games` type CHECK to add
`snake` + adds append-only `snake_holder_writes` (UNIQUE(round_id, client_event_id)).
Single transferable token per (round,foursome) — latest write wins, no explicit
release. `POST /api/rounds/:roundId/snake` reuses `resolveScorerGate` + requires the
target elected snake + writability gate + idempotent. Score-entry shows a 🐍
tap-to-take icon ONLY for snake participants (holder bright, others greyed).
Offline-queue `snake` kind + terminal-errors. **DISPLAY-ONLY — settles on paper,
never feeds money** (by construction; reviewers confirmed).

⚠️ **Migration drift caught**: drizzle-generated 0026 re-emitted `ALTER TABLE bets ADD
line` (already shipped in the hand-named `0025_over_under_line.sql` → snapshot drift).
Removed it (would dup-column-fail on prod + fresh test DBs). **Watch for this on the
next `db:generate`** — the snapshot now matches, but hand-named migrations are the
root cause.

Director review: full debate HOLD → fixed → confirm SHIP. Both reviewers' "support
$2.50 point values" suggestion was WRONG (engine requires whole dollars) — fixed the
right way (validate + block, not coerce). Fixes: arrange dropdown `numFoursomes+1`;
`confirmNoModifiers = guyanOn && noClaimsOn`; tee always required + trimmed;
courses-load error state; defense-in-depth Start guard. Artifacts:
`_bmad-output/reviews/*quick-event-snake-hero*` + `*quick-event-confirm*`.

---

## Prod state (verified)
- HEAD `9dc1700`, CI-green; `./deploy.sh` rebuilt all 4 containers.
- `Tournament API: migrations applied` (0026 ran on the encrypted DB) — no errors.
- Health 200: `tournament.dagle.cloud/api/health`, `wolf.dagle.cloud/api/health`.

## 🔴 Gate before relying on it (do this first)
**2-minute phone smoke-test** (the dress-rehearsal that was missing last trip):
Landing → **Create Quick Event** → pick course/tee → add ~4 players → toggle
**Snake** on → Start → confirm the score screen shows the 🐍 and tapping moves it
between players; enter a couple of scores. Throwaway data — cancel the event after.

## Open / next
- **Snake auto-payout**: snake is paper-settled (token only). A future story could
  auto-settle the pot from the final holder.
- **Per-file test DBs**: the shared `file::memory:?cache=shared` flake now trips
  `round-lifecycle.integration` + `lifecycle-full.e2e` in the FULL api run (both pass
  in isolation). Today's snake test data widened the contamination surface. Worth
  fixing (per-file DB or drop `cache=shared`).
- **Wizard polish** (backlog): per-player putting/snake election (currently whole-
  field), drag-to-reorder foursomes, editable scorer per foursome.
- **Quick Event partial-failure**: client-orchestrated, so a mid-sequence failure
  leaves an orphan event. Fine for testing; a transactional backend endpoint would
  harden it for real use.

## Key decisions (do NOT re-litigate)
- Putts: **web Save gate is the enforcement; the gross always persists** (no API reject).
- Quick Event scoring: **open policy** + organizer-as-scorer; any validated (GHIN +
  join-code) group member can score (the group-member gate from this morning).
- Snake: its own sub_game type; **display-only/paper-settle**, never money.
- Point values: **whole dollars only** (engine constraint).

Memory: `project_tournament_quick_event_snake_hero.md`,
`project_tournament_postmortem_2026_06_28.md`.
