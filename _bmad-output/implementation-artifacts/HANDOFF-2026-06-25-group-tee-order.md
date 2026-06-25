# HANDOFF — Group Tee-Order Reorder (Wolf Cup)

**Date:** 2026-06-25 · **App:** Wolf Cup (`apps/api`, `apps/web`) · **Status:** Spec ready, NOT built yet.
**Hard rule:** Build is fine next week, but **do NOT push/deploy until next week** (Josh, 2026-06-25).

---

## TL;DR — pick up here next week

1. Read the spec: **`_bmad-output/implementation-artifacts/tech-spec-group-tee-order-reorder.md`** (this is the source of truth — fully grounded with file:line citations and the 3 decisions).
2. Create a feature branch (currently on `master`).
3. Build per the spec: migration → endpoint → display-site sort swap → web UI → tests.
4. Run tests green locally. Optionally `director-review` (codex+gemini).
5. **Then** ask Josh before push/deploy.

## The problem (why)

Two weeks running, a group asked to tee off first/last *after* pairings were set. Josh's only workaround = delete all groups + manually re-create and re-assign players (`apps/web/src/routes/admin/rounds.tsx:1089-1166`). We want to reorder tee position **without** tearing down the foursomes.

## Decisions locked (Josh, 2026-06-25)

1. **Storage:** separate nullable **`teeOrder`** column. `groupNumber` stays **frozen** as the pairing-audit identity (ADR-4). Display/sort use `COALESCE(tee_order, group_number)`. Audit `computePairingDiff` untouched.
2. **UI:** **both** drag-to-reorder **and** editable position number per group.
3. **Guardrail:** reorder allowed **only before any score is entered** for the round.

## Why this is safe (the key finding from exploration)

- `groupNumber` is **NOT** a scoring/money key. All scoring/wolf/money links players via `roundPlayers.groupId` → `groups.id` (PK). Tee order is cosmetic to scoring.
- `groupNumber` *is* the stable identity for the pairing audit (`apps/api/src/lib/pairing-capture.ts:142`, ADR-4 invariant at lines 44/139 — "never renumbered"). So we must NOT renumber it; a separate `teeOrder` column isolates the new concern with zero audit risk.
- Migration is additive (nullable column) → backward-compatible; old rounds fall back to `groupNumber`, behavior byte-identical.

## Build checklist (from the spec)

- [ ] Schema: add `teeOrder: integer("tee_order")` nullable to `groups` (`apps/api/src/db/schema.ts:201-219`).
- [ ] Migration `00XX_group_tee_order.sql`: `ALTER TABLE groups ADD COLUMN tee_order INTEGER;` (no CHECK — avoid drizzle table-rebuild gotcha; validate in handler/Zod).
- [ ] Init `teeOrder = groupNumber` at creation: `apps/api/src/routes/admin/rounds.ts:~1753` (bulk) + `:568-640` (single); check `apps/api/src/routes/rounds.ts:642-649`.
- [ ] Endpoint `PATCH /admin/rounds/:roundId/groups/tee-order` — ordered `groupId[]` = positions 1..N; validate permutation + ownership; reject if scores exist; transactional; touches only `tee_order`.
- [ ] Switch ORDER BY + "Group N" label to effective tee order at the read sites:
      `pairings.ts:36,88` · `season-export.ts:233,262` · `admin/rounds.ts:557,1146-1154` · `leaderboard.ts:119,458` · `scouting.ts:122-131,516-528` · `odds-line.ts:106-112` · `round-completeness.ts:47,137` · `rounds.ts:232-252`.
- [ ] Web GroupsPanel (`apps/web/src/routes/admin/rounds.tsx:~1089-1166`): drag + number field; disable when scores exist; optimistic update + query invalidation.
- [ ] Tests: endpoint happy/permutation/foreign-id/score-locked/transactional; **audit-invariant regression** (reorder ⇒ no spurious "moved" in `computePairingDiff` — extend `pairing-capture.test.ts`); display order on pairings/export/leaderboard/scouting; old-round fallback byte-identical; web reorder + locked state.

## Open items to resolve while building

- Exact "round has scores / is locked" predicate to reuse for the guardrail (search finalization + score-correction guards).
- Confirm `apps/api/src/routes/rounds.ts:642-649` group-creation is a live path needing `teeOrder` init vs legacy.
- Confirm human-facing "Group N" label shows `teeOrder` (tee position) while the admin audit view keeps `groupNumber` (internal identity) — they're equal on un-reordered rounds.

## State of the tree

- New (uncommitted at time of writing, then committed in this session): this handoff + the tech spec. **No code changed.**
- Pre-existing unrelated untracked/modified files in `_bmad-output/reviews/` and `_bmad-output/implementation-artifacts/tournament/` are NOT part of this work — leave them alone.
- Memory: `project_feature_pairing_group_order.md` (+ MEMORY.md index line) records this feature, decisions, and spec pointer.
