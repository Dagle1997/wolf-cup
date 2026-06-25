# Tech Spec — Reorder Group Tee-Off Order (post-pairing)

**Status:** Ready to build. **Do NOT push/deploy until next week** (Josh, 2026-06-25).
**App:** Wolf Cup (`apps/api`, `apps/web`). Not Tournament.
**Origin:** Two weeks running, a group asked to go off first/last after pairings were set. Current workaround = delete all groups + manually re-create/re-assign (`apps/web/src/routes/admin/rounds.tsx:1089-1166`). Goal: reorder tee position without tearing down the foursomes.

---

## Decisions (Josh, 2026-06-25)

1. **Storage:** Add a **separate `teeOrder` column.** `groupNumber` stays **frozen** as the pairing-audit identity (ADR-4). Display + sort switch to `teeOrder`, falling back to `groupNumber` when null (old rounds). The pairing audit (`computePairingDiff`) is **untouched** — zero risk.
2. **Interaction:** Admin UI gets **both** drag-to-reorder **and** an editable position number per group.
3. **Guardrail:** Reorder allowed **only before any score is entered** for the round. Once a score exists, lock it.

---

## Why a separate column (the key finding)

`groupNumber` does double duty today:
- **Display label + sort key** — leaderboard, scouting, odds-line, pairings, XLSX "Group N", round-completeness all `orderBy(groupNumber)`.
- **Stable audit identity** — `computePairingDiff` (`apps/api/src/lib/pairing-capture.ts:142`) detects which players a human moved off the generated pairing by comparing player→`groupNumber` maps. Explicit invariant ADR-4 (`pairing-capture.ts:44,139`): *"stable, never renumbered."*

Renumbering `groupNumber` to reorder would falsely flag every player as "moved" and break that invariant. **Confirmed safe:** `groupNumber` is NOT a scoring/money key — all scoring/wolf/money links players via `roundPlayers.groupId` → `groups.id` (PK). So tee order is purely cosmetic to scoring, and a separate `teeOrder` cleanly isolates it.

---

## Schema change

`apps/api/src/db/schema.ts` `groups` table (currently lines 201-219):
- Add `teeOrder: integer("tee_order")` — **nullable** (null ⇒ fall back to `groupNumber`).
- New migration `apps/api/src/db/migrations/00XX_group_tee_order.sql`: `ALTER TABLE groups ADD COLUMN tee_order INTEGER;`
- **No CHECK constraint** (avoids the drizzle table-rebuild gotcha seen in tournament T13-4). Validation in the handler/Zod instead.
- Do **not** backfill — null is a clean "no custom order, use groupNumber" sentinel. Optionally backfill `tee_order = group_number` for tidiness; not required for correctness.

## Initialization

Set `teeOrder = groupNumber` at group **creation** so new rounds show stable, explicit positions from the start (both paths):
- Bulk from-attendance: `apps/api/src/routes/admin/rounds.ts:~1753` (`groupNumber: i + 1`).
- Single-group create: `apps/api/src/routes/admin/rounds.ts:568-640` (`groupNumber: result.data.groupNumber`).
- Also `apps/api/src/routes/rounds.ts:642-649` if that creation path is live.

(Leaving these null also works via fallback; initializing is cleaner and makes the reorder endpoint a pure permutation.)

## New endpoint — bulk reorder

`PATCH /admin/rounds/:roundId/groups/tee-order` (admin-auth, same guards as other admin/rounds routes).
- **Body:** ordered list of `groupId`s `[7, 3, 9, ...]` (position in array ⇒ teeOrder 1..N). A bulk/ordered payload avoids transient duplicate states.
- **Validation:**
  - All `groupId`s belong to `:roundId`; the set is an exact permutation of the round's groups (no missing/extra).
  - **Guardrail:** reject if any score exists for the round (mirror the round's existing "has scores / is locked" check — find it near score-correction / finalization guards). Return a clear 409/422.
- **Write:** single transaction, assign `teeOrder = index + 1` for each group in payload order.
- Does **not** touch `groupNumber`, `roundPlayers`, or the audit snapshot.

## Read/display sites — switch sort + label to teeOrder (fallback groupNumber)

Use `COALESCE(tee_order, group_number)` for ORDER BY, and the same for the displayed "Group N" label. Sites (from grep):
- `apps/api/src/routes/pairings.ts:36,88`
- `apps/api/src/lib/season-export.ts:233,262` ("Group {g.groupNumber}" title → use effective order)
- `apps/api/src/routes/admin/rounds.ts:557, 1146-1154`
- `apps/api/src/routes/leaderboard.ts:119,458`
- `apps/api/src/routes/scouting.ts:122-131,516-528`
- `apps/api/src/lib/odds-line.ts:106-112`
- `apps/api/src/lib/round-completeness.ts:47,137`
- `apps/api/src/routes/rounds.ts:232-252`

**Decision to confirm during build:** when `teeOrder` diverges from `groupNumber`, the human-facing "Group N" label should show **teeOrder** (the tee position is what golfers mean by "group 1"). The admin pairing-audit view ("moved from group 2 → 5") keeps using `groupNumber` (internal identity) — minor admin-only wrinkle, acceptable. Keep the two consistent on un-reordered rounds (where they're equal).

## Web UI

`apps/web/src/routes/admin/rounds.tsx` GroupsPanel (the area around `1089-1166`):
- Render group cards sorted by effective tee order.
- Drag-to-reorder (cards) + an editable position number field per card.
- On commit, call the new PATCH with the ordered `groupId` list; optimistic update + invalidate the round/pairings queries.
- Disable the control (with a tooltip/explanation) once the round has scores.

---

## Tests

- **API unit/integration:** new endpoint — happy path (permutation persists `tee_order`), rejects non-permutation, rejects unknown/foreign groupId, rejects when scores exist (guardrail), is transactional.
- **Audit invariant (regression):** reorder a round, then assert `computePairingDiff` / pairing-audit reports **no spurious moves** (proves decoupling). Extend `pairing-capture.test.ts` or add alongside.
- **Display:** `pairings`, `season-export`, `leaderboard`, `scouting` return groups in `teeOrder` order; old rounds (null teeOrder) byte-identical to today (fallback).
- **Web:** GroupsPanel reorder interaction + locked state when scores exist.

## Rollout

- Build + green tests locally this week. **Hold push/deploy until next week** per Josh.
- Migration is additive (nullable column) — safe, backward-compatible; old rounds unaffected by fallback.
- Recommend a `director-review` (codex + gemini) pass before next-week deploy given it touches read paths feeding money/leaderboard displays (display-only, but worth the adversarial check).

## Open items to resolve at build time

- Exact name of the "round has scores / is locked" predicate to reuse for the guardrail (search finalization + score-correction guards).
- Confirm `apps/api/src/routes/rounds.ts` group-creation path (lines 642-649) is a live path needing `teeOrder` init, vs legacy.
- Whether to also expose tee order on the public pairings page ordering (yes — it already sorts by groupNumber; swapping to teeOrder is the point).
