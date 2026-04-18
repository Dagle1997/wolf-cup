---
title: 'Post-Round-1 UX Polish + Highlight Reel Rewrite'
slug: 'post-round-1-ux-polish'
created: '2026-04-18'
revised: '2026-04-18'
status: 'draft — v3 after adversarial review, implementation-ready'
tech_stack: ['Hono API', 'Drizzle ORM + SQLite', 'React 19 + TanStack Router/Query', 'Vitest', 'shadcn/ui + Tailwind v4']
files_to_modify:
  - 'apps/web/src/routes/score-entry-hole.tsx'
  - 'apps/web/src/routes/score-entry.tsx'
  - 'apps/web/src/routes/ball-draw.tsx'
  - 'apps/web/src/routes/index.tsx'
  - 'apps/web/src/routes/stats.tsx'
  - 'apps/api/src/routes/rounds.ts'
  - 'apps/api/src/routes/stats.ts'
  - 'new: apps/web/src/lib/names.ts'
  - 'new: apps/api/src/lib/money-breakdown.ts'
  - 'new: apps/api/src/lib/hole-teams.ts'
code_patterns:
  - 'session state: { roundId, entryCode, groupId } only — no per-player identity'
  - 'live leaderboard with group filter and accordion lives on the home route (index.tsx)'
  - 'single selectedPlayerId accordion state — needs to become Set<number> for multi-expand'
  - 'recalculateMoney() in rounds.ts:73 is group-scoped; does not expose per-hole breakdown'
  - 'highlights reducers in rounds.ts use reduce() without tie handling'
---

# Tech-Spec: Post-Round-1 UX Polish + Highlight Reel Rewrite

**Created:** 2026-04-18
**Revised:** 2026-04-18 — v2 after code review caught 4 scoping errors in v1.

**Context:** First live Friday round (2026-04-17) surfaced a batch of UX friction points and a handful of weak/incorrect highlights in the finalized reel. This spec bundles them into two logically-separate PRs.

**v1 → v2 changes:** (a) A.3 / A.4 rewritten around the existing group-scoped session model (no per-player identity). (b) A.2 now targets `index.tsx` (the actual live leaderboard surface). (c) A.5 now explicitly specifies the accordion-state model change. (d) B.3-B.5 gated on first extracting a shared wolf-money breakdown helper.

**v2 → v3 changes (adversarial review 2026-04-18):** (a) A.1 marked DONE — score-entry implementation shipped locally, ball-draw/index.tsx deferrals made explicit. (b) A.2 rewritten to use server-computed ranks (`rank` / `stablefordRank` / `moneyRank`) rather than client re-rank; Harvey-off rounds default to To Par sort (matches today's behavior). (c) A.3 split into two distinct flows — fresh-mount auto-resume (real friction) vs post-submit confirmation (kept as-is). (d) A.4 escape-hatch boundary clarified on the batting-order-without-scores threshold. (e) A.5 state-reset via explicit `useEffect` on `viewMode`, no preserve across mode transitions. (f) B.0 flagged as side-effect-free (no `wolf_decisions.outcome` write) with polie-decomposition test note. (g) B.5/B.6 dedup gated on "B.3/B.4 actually emitted" — skip-cases no longer trigger phantom dedup. (h) B.8 field rename clean (old fields dropped, not silently redefined).

---

## Session Model — Authoritative Reference

Before any flow work, confirm the actual model the app runs on today:

```ts
// apps/web/src/lib/session-store.ts
type WolfSession = {
  roundId: number;
  entryCode: string | null;
  groupId: number | null;   // NOT per-player
};
```

Players do **not** identify themselves individually. The entire player-side flow is **group-scoped**:

- `/rounds/:id/start` only validates the entry code and returns round detail. No player picker.
- All score-entry / wolf-decision queries are `/rounds/:roundId/groups/:groupId/...`.
- Score-entry advances to the first unscored hole by reading the group's saved scores — not by tracking an individual player's progress.

Any language in this spec that reads like "the player saves their hole" / "per-player identity" is short-hand for **"any member of this group on any device submitting via the shared groupId."** No session changes, no new `playerId` field.

---

## Overview

### Problem Statement

Week 1 of the 2026 season exposed several rough edges:

1. **Duplicate first names collide in-group.** Two Jeffs (Madden + Biederman) in Group 1 both rendered as "Jeff" on score-entry rows — hard to tell which input belonged to which Jeff.
2. **Live leaderboard is locked to Harvey sort.** Players with an intuition for stableford or money ranking have no way to see the board reordered on those axes.
3. **Score-entry requires an extra tap to resume.** When session already has a `groupId`, the join screen still shows a confirmation with a "Resume Round" button — users have to tap it even though all information needed to route them onward is already present.
4. **Group picker is buried inside ball-draw.** A player who enters the join code lands on "Start Ball Draw" before being explicitly asked which group they're in. The group picker is embedded in `/ball-draw`, not a distinct step.
5. **Group-filter view on leaderboard doesn't expand all 4 cards.** The single-selected-player accordion model means a user must tap each card individually, and opening one collapses the others.
6. **Highlight reel "X Points on One Hole" is a weak stat.** Net eagle (4 pts) is achievable by mid-handicap players getting 2 strokes on a par-5 who score a gross par.
7. **Highlight reel drops tied players silently.** `Big Winner`, `Deepest Hole`, and `Points Leader` all use `reduce()` without collecting ties. Week 1: Kyle & Jaquint both at -$16, only one rendered.
8. **Wolf-specific highlights are missing entirely.** The reel surfaces total money (mixed with skins + bonuses) but never isolates wolf-play performance.

### Solution

Two independent PRs.

**PR A — Web UX Polish** (all web-only, no server changes)
- A.1 — `shortName()` for duplicate first names in-group.
- A.2 — Sort toggle on the live leaderboard (Harvey / Stableford / Money) — **on `index.tsx`, the home-route live board; NOT `standings.tsx`**.
- A.3 — Auto-skip the join-confirmation screen when session already has `groupId`.
- A.4 — Move the group picker from inside `/ball-draw` into a dedicated step after join-code entry.
- A.5 — In group-filter view, expand all 4 cards by default (requires accordion-state refactor).

**PR B — Highlight Reel Rewrite** (API only)
- **B.0** — *New precondition.* Extract a reusable per-round money-breakdown helper (`money-breakdown.ts`) that exposes per-hole / per-player / per-source ($kind) totals, aggregated across groups.
- B.1 — Fix tie-handling on reducer-based highlights.
- B.2 — Remove "X Points on One Hole."
- B.3 — Add `Biggest Wolf Win` (single hole, top wolf $).
- B.4 — Add `Biggest Wolf Loss` (single hole, bottom wolf $).
- B.5 — Add `Pack Leader` (round-total wolf $, best) — emit only if round-total differs from player's best single-hole win.
- B.6 — Add `Fed to the Pack` (round-total wolf $, worst) — emit only if round-total differs from player's worst single-hole loss.
- B.7 — Add `Pack of One` (most alone/blind_wolf attempts, ≥3 required, independent of money).
- **B.8** — Rewrite stats-page **Rival / Lucky Charm / Dominate** callouts on per-hole team-composition math (current logic stores round totals, so all teammates share the same `myMoney` and the "Rival" label is meaningless).

### Scope

**In scope:** All 11 items above. No migrations, no engine edits, no schema changes. Standard deploy via `./deploy.sh`.

**Out of scope:**
- Any form of per-player identity in the session model (would be a far larger change — not on the table for this cycle).
- Live mid-round stableford-by-pace re-ranking (discussed; decision was *do nothing*).
- Hole-by-hole inline 4×18 grid on leaderboard (deferred; lightweight per-card expand is sufficient).
- Admin-facing flows (group reassignment, score correction UI).

---

## PR A — Web UX Polish

### A.1 `shortName()` for duplicate first names in-group — **DONE 2026-04-18**

**Status:** implemented locally, uncommitted. Typecheck + lint clean.

**Shipped:**
- `apps/web/src/lib/names.ts` — created with `shortName(fullName, contextNames)` helper.
- `apps/web/src/routes/stats.tsx` — migrated from inline to shared import.
- `apps/web/src/routes/score-entry-hole.tsx` — `groupNames` computed from `orderedPlayers`; applied at 5 call sites (summary table, score-entry cards, bonuses row, wolf row header, partner-selection buttons).

**Intentionally deferred (not a goal):**
- `ball-draw.tsx` — the group-picker view (post-A.4) wants full names so players can find themselves in the 3-group list. Collisions here are a feature, not a bug.
- `index.tsx` leaderboard rows — each row is a distinct player with their own full name visible; the Jeff/Jeff confusion doesn't manifest in a vertical list where "Jeff Madden" and "Jeff Biederman" are on their own rows. Keep full names.

**Outcome:** Jeff M. / Jeff B. now disambiguate on score-entry. Deploy with PR A bundle or as standalone micro-commit.

---

### A.2 Sort toggle on the live leaderboard

**Driver:** round-day leaderboard is locked to Harvey sort. Players asked for stableford / money views.

**Target file:** `apps/web/src/routes/index.tsx` — specifically the live-round leaderboard component beginning around `index.tsx:641`. (Confirmed during review: this is the board with the group filter, rank column, and per-player accordion, NOT `standings.tsx` which is the season standings page.)

**Behavior:**
- Add a segmented control next to or above the existing All / Group pill. Options depend on `data.harveyLiveEnabled`:
  - `harveyLiveEnabled === true` → **Harvey / Stableford / Money**.
  - `harveyLiveEnabled === false` → **To Par / Stableford / Money** (Harvey replaced with To Par, since server's primary rank is netToPar when Harvey is disabled — see below).
- Default sort on load:
  - `harveyLiveEnabled === true` → Harvey (preserves current behavior).
  - `harveyLiveEnabled === false` → To Par (preserves current behavior — `leaderboard.ts:251` falls back to `netToParRanks` as the primary when Harvey is off).
- Toggle persists per-browser in `localStorage` (key: `wolf-cup:leaderboard-sort`). On load, if persisted value is incompatible with current round (e.g., saved `'harvey'` on a Harvey-off round), render with the round's default without overwriting the saved preference.
- Active sort indicated by a caret/arrow on the column header — no extra banner.

**Rank column mapping — use server-computed ranks (no client re-rank):**

The server already returns three rank values per player via `LeaderboardPlayer` at `leaderboard.ts:25-43`:
- `rank` — the primary rank. Harvey total desc when `harveyLiveEnabled`, else netToPar asc.
- `stablefordRank` — always stableford total desc (ties preserved).
- `moneyRank` — always money total desc.

The `#` column simply swaps which server field it reads, per active sort:
- Harvey sort (when enabled) or To Par sort (when Harvey disabled) → `player.rank`.
- Stableford sort → `player.stablefordRank`.
- Money sort → `player.moneyRank`.

Tie-handling is already correct in the server ranks via `assignRanks` / `assignRanksAsc`. No client-side re-ranking, no custom tiebreaker logic — the spec's earlier "tiebreakers per mode" section is dropped in favor of trusting server authority.

**Row ordering:** rows sort by the same axis as the rank column (sort ASC when the rank is ASC — netToPar only; sort DESC otherwise). Group-filter (All / Group N) is orthogonal; filtering hides rows but sort remains field-wide.

**Risk:** low. Client-side re-sort.

**Tests:** manual verification across all three sort modes. No API change to test.

---

### A.3 Auto-resume on fresh mount when session already has `groupId`

**Driver:** the friction Josh is calling out isn't the post-join confirmation card — it's that **revisiting the app with an existing session** still requires tapping through the round list. When a user comes back to the app and taps Score, if they already have a valid session with `groupId` set, they should land directly in their active hole without a middleman screen.

**Two screens, two distinct behaviors:**

**Screen 1 — fresh mount (user opens Score tab with existing session):**
Today: `/score-entry` renders the list of joinable rounds. User has to find their round and tap Join again.
Change: on component mount, check `getSession()`. If it returns a populated session where `groupId != null` AND the session's `roundId` maps to a round in the current list that isn't finalized/cancelled → `router.navigate({ to: '/score-entry-hole' })` immediately. Skip the round-list render entirely.

**Screen 2 — post-join confirmation (user JUST submitted entry code):**
Keep as-is. The "Official round joined" / "Resume Round" card at `score-entry.tsx:101-139` is a post-submit confirmation — it shows the user the round name and date as a sanity check before they advance. Removing it would make the entry-code submission feel instant-and-disorienting. The `joined` state is transient (set on mutation success) and only shows once per code submission. Not friction.

**Target file:** `apps/web/src/routes/score-entry.tsx` — add a mount-time redirect gate BEFORE the main render. Do NOT touch the `joined`-state flow.

**Implementation sketch:**
```ts
useEffect(() => {
  const session = getSession();
  if (!session || session.groupId == null) return;
  // Validate round is still active via rounds query
  const match = data?.items.find((r) => r.id === session.roundId);
  if (match && match.status === 'active') {
    void router.navigate({ to: '/score-entry-hole' });
  } else if (match && (match.status === 'finalized' || match.status === 'cancelled')) {
    clearSession();
  }
  // else: round not found yet (loading) — re-run once data arrives
}, [data]);
```

**Edge cases:**
- Session references a deleted round → `data.items` won't contain it; redirect doesn't fire; user sees the normal round list. Session can be cleared defensively on that path.
- Session references a finalized round → clear session, show list.
- Round query still loading → effect re-runs on data change.
- Group deleted but round still active → `/score-entry-hole` will 404 on group-scoped queries; add defensive 404 handler there that clears session and bounces back to `/score-entry`.

**Risk:** low. New useEffect on one route, behind positive gates. The post-submit confirmation flow (which users actively see and tap) is untouched.

**Tests:** manual verification — (1) fresh session → enter code → confirmation shows (unchanged); (2) existing session, tap Score → immediate redirect to `/score-entry-hole`; (3) existing session pointing at finalized round → session clears, round list renders.

---

### A.4 Move group picker out of ball-draw into a dedicated step

**Driver:** current flow is `Enter code → "Start Ball Draw" → [pick group inside ball-draw]`. Josh wants `Enter code → Pick group → Start Ball Draw`. The group choice exists today inside `/ball-draw` — it's just in the wrong sequence.

**Current state in code:**
- `/ball-draw` has `selectedGroupId` local state initialized from `session.groupId` (ball-draw.tsx:98).
- Auto-selects if round has only 1 group (ball-draw.tsx:170).
- Batting-order submission persists `groupId` to session (ball-draw.tsx:270).
- For multi-group rounds, user currently selects a group inline before batting-order entry.

**Behavior:**
- After join-code entry, if `session.groupId == null` AND the round has multiple groups, show a **dedicated group-picker screen** before navigating to `/ball-draw`. This can be either:
  - **(a)** A new intermediate state inside `/score-entry` (shown after successful `start` mutation, before the confirmation card redirects onward).
  - **(b)** A new route like `/score-entry/pick-group` that `/score-entry` routes to.
  - **Recommendation: (a)** — minimizes new routing, keeps the entire "join flow" in one file.
- On this screen: "Which group are you in?" + one button per group. If the server has groups numbered 1/2/3, show those labels. Each button shows the 4 players in that group (so a new user can find themselves by name).
- Pre-selection logic: none — the server has no idea who this user is (confirmed via review). Every user picks manually. That's the reality of the session model today.
- **Visual style:** reuse the current ball-draw presentation (Group 1 with 4 player names listed, Group 2 with 4 player names listed, Group 3 with 4 player names listed — stacked vertically). Josh confirmed this layout works; we're moving it, not redesigning it.
- On tap: `setSession({ ...session, groupId: selectedGroupId })` and navigate to `/ball-draw`.
- `/ball-draw` simplifies: if `session.groupId == null` AND round has multiple groups, redirect back to `/score-entry` (belt + suspenders — shouldn't happen after this change).
- Single-group rounds: skip the picker; auto-set `groupId` and go straight to ball-draw (matches current auto-select behavior at `ball-draw.tsx:170`).

**Escape hatch for wrong group:**
- From `/score-entry-hole`, add a small "Wrong group?" link or menu item.
- Detection: query `/rounds/:roundId/groups/:groupId/scores`. The group flows through two commit thresholds:
  - **Threshold 1 — batting-order set, zero hole_scores:** this is what `ball-draw.tsx:270` does when a user submits the batting order. Group is "committed" server-side (wolf rotation frozen) but no actual hole scoring has happened. Changing groups at this point still feels safe — user picks a different group, that group's batting order is either already set (they join it) or they'd re-run ball-draw there.
  - **Threshold 2 — one or more `hole_scores` rows exist:** real scoring has started. Changing groups would orphan those scores in the wrong group.
- **Rule:** "Wrong group?" link is enabled when `hole_scores` count for this player's group = 0, regardless of batting-order state. Once any hole has been scored, link disables with tooltip: "Scores already saved. An admin can reassign groups if needed."
- Detection query: `SELECT COUNT(*) FROM hole_scores WHERE round_id = ? AND group_id = ?`. Cached with TanStack Query for 30s to avoid query spam.
- Action on tap: `setSession({ ...session, groupId: null })` then `router.navigate({ to: '/score-entry' })`. That triggers A.3 fresh-mount flow, which sees no groupId and shows the round list + group picker. No server write — purely local session reset.
- Note: if the user committed a batting order in Group A, then switches to Group B, Group A's batting order remains committed (orphaned) until admin cleans up or someone else rejoins Group A. This is the same state as today's ball-draw flow; A.4 doesn't make it worse.

**Risk:** moderate. Touches entry flow — the player's first interaction with the app. Worth a practice-round sanity check before deploying mid-Friday.

**Tests:** component tests for the picker state machine (no group → pick → confirm → session updated → advance). Manual end-to-end flow verification.

---

### A.5 Expand all 4 cards in group-filter view — accordion state refactor

**Driver:** tapping Group-N filter gives 4 rows but each still behaves as a single-select accordion — opening one closes the rest. Josh wants all 4 open by default in group view, with individual toggling still possible.

**Target file:** `apps/web/src/routes/index.tsx` — the live leaderboard component starting around line 641. Current state is:

```ts
const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
```

This is a single-select accordion. It can't represent "4 open, any one toggleable" without a model change.

**Proposed state model:**

```ts
const [expandedPlayerIds, setExpandedPlayerIds] = useState<Set<number>>(new Set());
```

**Behavior:**
- `viewMode === 'all'` (12 players) → tap behavior preserves today's single-open accordion. On tap: `setExpandedPlayerIds(isSame ? new Set() : new Set([id]))`. Only one card open at a time.
- `viewMode === 'group'` → on switch TO group view, seed all 4 group members. Tap behavior is additive — toggle membership: `set.has(id) ? set.delete(id) : set.add(id)`. Multiple cards open simultaneously; each collapses independently.

**State reset via `useEffect` on `viewMode`:**
```ts
useEffect(() => {
  if (viewMode === 'group' && myGroupId !== null) {
    const groupIds = data.leaderboard
      .filter((p) => p.groupId === myGroupId)
      .map((p) => p.playerId);
    setExpandedPlayerIds(new Set(groupIds));
  } else {
    setExpandedPlayerIds(new Set()); // All mode: start closed
  }
}, [viewMode, myGroupId]);
```

Key property: switching All→Group→All does NOT preserve expansion state across transitions. Each mode switch resets to that mode's default. This prevents the "4 open in All view violating one-at-a-time" edge case.

**Row render:** `const isExpanded = expandedPlayerIds.has(player.playerId)` replaces `const isSelected = selectedPlayerId === player.playerId`.

**Effect on current callers:** the `onClick` handler at `index.tsx:713` updates to the new Set-based toggle logic with a branch on `viewMode` (replace-single-id in All, toggle-membership in Group).

**Risk:** low. Local state refactor; no API contract changes.

**Tests:** manual — (1) All view behaves like today (one open at a time); (2) switching to Group view opens all 4; (3) in Group view, tapping one card collapses just it; (4) in Group view, re-tapping re-opens just it.

---

## PR B — Highlight Reel Rewrite

All changes live in `apps/api/src/routes/rounds.ts` (`GET /rounds/:roundId/highlights`) plus one new helper file. No web changes — the client renders whatever `highlights[]` the API returns.

### B.0 (Precondition) Extract `money-breakdown.ts`

**Driver:** the existing `recalculateMoney()` in `rounds.ts:73` is group-scoped and returns only per-player totals — it discards the per-hole breakdown internally. B.3-B.5 need cross-group aggregation AND per-hole visibility (for "Biggest Wolf Hole"). Building those on top of the raw `wolf_decisions` rows (as v1 of this spec proposed) would re-derive the money math and is a correctness trap. Extract first.

**New file:** `apps/api/src/lib/money-breakdown.ts`

**Shape (proposed):**

```ts
export type HoleMoneyBreakdown = {
  holeNumber: number;
  groupId: number;
  holeType: 'wolf' | 'skins';
  wolfPlayerId: number | null;      // null on skins holes
  partnerPlayerId: number | null;   // null on skins, alone, blind wolf
  decision: 'alone' | 'partner' | 'blind_wolf' | null;
  perPlayer: Map<number, {
    skins: number;                  // $ from skins pot
    wolfSettlement: number;         // $ from wolf resolution (0 on skins holes)
    bonuses: number;                // greenies + polies + sandies (always 0 on skins)
    total: number;                  // skins + wolfSettlement + bonuses
  }>;
};

export type RoundMoneyBreakdown = {
  holes: HoleMoneyBreakdown[];      // 18 per group, flattened across groups
  perPlayerTotals: Map<number, {
    skins: number;
    wolfSettlement: number;
    bonuses: number;
    total: number;
  }>;
};

export async function computeRoundMoneyBreakdown(roundId: number): Promise<RoundMoneyBreakdown>;
```

**Implementation sketch:**
- Fetch `groups` for the round, `roundPlayers` (for handicaps), `holeScores`, `wolfDecisions`.
- For each group, replicate the `recalculateMoney()` loop (rounds.ts:124-165) but record the `calculateHoleMoney()` / `applyBonusModifiers()` return values per-hole, decomposed into skins / wolf-settlement / bonus buckets.
- Decomposition strategy: call `calculateHoleMoney()` (base) first — that's skins-or-wolf-settlement (no bonuses). Then compute `applyBonusModifiers()` delta and that's the bonus portion.
- Sum into `perPlayerTotals` across groups.

**CRITICAL — no side effects.** `recalculateMoney()` writes `wolf_decisions.outcome` per hole (`rounds.ts:166-181`). This is correct for its caller (it's updating state after a score change). The new helper is a **read-only** computation called from highlights and stats endpoints — it MUST NOT carry over the outcome-write block. Every invocation would otherwise thrash the DB with idempotent writes. Test this by mocking the DB write path and asserting it's never called.

**Edge case — polies multiply the pot.** `applyBonusModifiers()` handles polies as pot doublers, not additive bonuses. Decomposition still works mathematically — "base" is the pre-polie settlement, "delta" is the (potentially large) polie-amplified difference — but the per-player bucket labels matter. The `bonuses` bucket captures the full amplification for the player; it's not a flat $1/polie. Test fixtures should include at least one scenario with a polie (single and double) to assert bucket decomposition is correct, not just that totals match `recalculateMoney`.

**"Wolf money" definition — per-player, own-wolf-holes only.**

Each player is the wolf on **exactly 4 holes per round** (16 wolf holes ÷ 4 batting positions = 4 per player; `packages/engine/src/wolf.ts:36` confirms holes 1 and 3 are the only skins holes).

A player's "wolf money" for the round = sum of **that player's $ outcome** on the 4 holes where **they personally were the wolf**. Other players' wolf holes don't count — if Moses was wolf on hole 7 and beat my group, hole 7 goes in Moses's wolf ledger, not mine. I just lost money as a non-wolf on that hole.

"$ outcome" is wide — it includes wolf settlement + any greenies/polies/sandies on the hole. Players don't mentally split settlement from bonuses; the number they feel is the net swing.

**Concretely:**
- For each `wolf_decisions` row, identify the wolf player via `wolfPlayerId`.
- On that hole, the wolf player's $ = their `total` from the money breakdown (wolf settlement + their bonuses, no skins since skins don't occur on wolf holes).
- Sum across that player's 4 wolf holes → their `wolfMoneyRoundTotal`.
- For per-hole highlights, look at each wolf's single-hole outcome across their 4.

**Refactor of existing `recalculateMoney()`:** out of scope — it still works for its current purpose (group-scoped live money totals). The new helper lives alongside. A future consolidation PR can merge them.

**Tests:** unit tests for the helper with known round fixtures — verify per-player totals match `recalculateMoney()` for a single group, and that cross-group aggregation sums correctly.

---

### B.1 Fix tie-handling on reducer highlights

**Driver:** Week 1, Kyle & Jaquint both at -$16 but `Deepest Hole` rendered only one. Same pattern affects `Big Winner` and `Points Leader`.

**Files:** `apps/api/src/routes/rounds.ts` — blocks at lines 1934-1967.

**Pattern replacement:**

```ts
// before
const best = resultRows.reduce((a, b) => (b.moneyTotal > a.moneyTotal ? b : a));

// after
const maxMoney = Math.max(...resultRows.map(r => r.moneyTotal));
const leaders = resultRows.filter(r => r.moneyTotal === maxMoney);
```

**Detail string format:**
- 1 player → current phrasing unchanged.
- 2 players → `"Kyle & Jaquint both dropped -$16"` (two-name join with `&`).
- 3+ players → `"Ben, Kyle & Jaquint all posted 22 stableford points"` (Oxford-comma style).

**Risk:** low. Output format change.

**Tests:** Vitest — for each of the three highlights, test 1-player / 2-player tie / 3-player tie cases.

---

### B.2 Remove "X Points on One Hole"

**Driver:** weak stat — net eagle (4 pts) is trivially achievable by mid-handicap players on stroke holes. Eagles and birdies are already highlighted separately and are the rarer, more meaningful celebration.

**Files:** `apps/api/src/routes/rounds.ts:1969-1988` — delete the `bestHoleScore` block.

**Risk:** zero.

**Tests:** update any existing expected-highlights counts in `rounds.test.ts` fixtures.

---

### B.3 Add `Biggest Wolf Win` (per-hole)

**Driver:** celebrate the single-hole moment — the wolf who had the biggest positive $ swing on one of their own wolf holes.

**Depends on:** B.0.

**Logic:**
- From `RoundMoneyBreakdown.holes`, filter `holeType === 'wolf'`.
- For each wolf hole, the wolf player is `wolfPlayerId`. Their $ on that hole = `perPlayer.get(wolfPlayerId).total` (wolf settlement + their bonuses on that hole, no skins).
- Find the maximum positive value across all (wolf, hole) pairs.
- Emit only if `max > 0`. Ties: list all tied entries.
- Context in detail string: was the wolf alone, blind, or with a partner? Who was partner if applicable?

**Detail string examples:**
- Alone: `"Moses won $9 going alone on Hole 14"`.
- Blind: `"Moses went blind on Hole 11 and took $12"`.
- With partner: `"Ronnie & Jaquint took Moses & Keaton for $8 on Hole 7"` (both wolf team members credited).

**Emoji:** 🐺

**Tests:** Vitest — alone win, blind win, partner win, tied holes.

---

### B.4 Add `Biggest Wolf Loss` (per-hole)

**Driver:** mirror of B.3 — the wolf who got burned worst on a single hole.

**Depends on:** B.0.

**Logic:**
- Same per-(wolf, hole) pairs as B.3.
- Find minimum (most negative) value.
- Emit only if `min < 0`. Ties: list all tied entries.

**Detail string examples:**
- Alone loss: `"Ronnie lost $15 going alone on Hole 10"`.
- Blind loss: `"Moses went blind on Hole 11 and dropped $12"`.
- With partner loss: `"Stoll & Biederman got taken for $6 on Hole 5"`.

**Emoji:** 🥩

**Tests:** Vitest — alone loss, blind loss, partner loss, tied holes, all-non-negative skip.

---

### B.5 Add `Pack Leader` (round-total, deduped)

**Driver:** recognize the player who played wolf best across all 4 of their wolf holes — a different story from B.3's single-hole moment.

**Depends on:** B.0, runs after B.3.

**Logic:**
- For each player, sum their $ outcome across the 4 holes where they were the wolf → `wolfMoneyRoundTotal`.
- Find player(s) with max positive round-total.
- **Dedup rule — only applies when B.3 actually emitted:** if B.3 was skipped (no player had positive wolf money on any single hole), there's nothing to dedup against → emit B.5 without filtering. If B.3 emitted, then for each B.5 co-leader:
  - If that player was named in B.3 AND their `wolfMoneyRoundTotal` equals their own single-hole wolf win value → filter them out (B.3 already told their story).
  - Else keep them.
- **Tie-aware dedup behavior:** after filtering, if some co-leaders survive and others don't, emit B.5 with only the surviving players. Skip B.5 entirely only if *all* co-leaders filtered out.
- When emitted, name all surviving co-leaders per B.1 formatting.

**Detail string:** `"Madden +$18 from wolf play"` (single survivor) / `"Madden & Moses each +$18 from wolf play"` (multiple survivors).

**Why the dedup:** if a player went wolf alone once, won $9 on hole 14, and broke even on their other 3 wolf holes, their round-total = $9 = their single-hole win. Emitting both is redundant noise. If their other 3 holes pushed the round-total higher (or lower), the round-total IS distinct and worth surfacing.

**Partial-dedup example:** Madden and Moses tied at +$18 round-total. Madden's best single-hole = $18 (deduped — B.3 covers him). Moses's best single-hole = $9, round-total $18 (distinct — emit). Highlight reads `"Moses +$18 from wolf play"` — Madden is represented in B.3 instead.

**Emoji:** 🐺

**Tests:** Vitest — emit case (round ≠ single-hole), skip case (round = single-hole), tied leaders, all-non-positive skip.

---

### B.6 Add `Fed to the Pack` (round-total, deduped)

**Driver:** mirror of B.5 — worst round-total wolf player across their 4 wolf holes.

**Depends on:** B.0, runs after B.4.

**Logic:**
- Per-player `wolfMoneyRoundTotal` as in B.5.
- Find player(s) with min (most negative) round-total. Emit only if `min < 0`.
- **Dedup rule — only applies when B.4 actually emitted:** if B.4 was skipped (no player had negative wolf money on any single hole), emit B.6 without filtering. If B.4 emitted, apply per-player dedup:
  - Co-loser named in B.4 AND their `wolfMoneyRoundTotal` equals their own single-hole wolf loss → filter.
  - Else keep.
- **Tie-aware dedup (per B.5):** if some co-losers survive filter and others don't, emit with only survivors. Skip entirely if all filtered.
- Ties per B.1 formatting.

**Detail string:** `"Biederman -$22 from wolf play"`.

**Emoji:** 🥩

**Tests:** Vitest — emit case, dedup skip case, tied losers, all-non-negative skip, partial-dedup tie (some co-leaders survive dedup, others don't — see tie-handling rule below).

---

### B.7 Add `Pack of One`

**Driver:** celebrate the most aggressive lone-wolf player — 3+ alone/blind attempts in a round. Independent of money; a losing aggressor still deserves recognition.

**No dependency on B.0** — reads only from `wolfDecisions` rows (already fetched by the endpoint).

**Logic:**
- Count `decision IN ('alone', 'blind_wolf')` per `wolfPlayerId` from the existing `decisionRows`.
- Find `maxCount`. If `maxCount < 3`, skip entirely. (Going wolf once is mandatory; twice is taste; 3+ is a statement.)
- Emit highlight listing all players tied at `maxCount`.

**Detail string:** `"Moses went solo 4 times (2 blind)"` — parenthetical blind-count only when blind count > 0.

**Emoji:** 🐺

**Tests:** Vitest — max = 1 (skip), max = 2 (skip), max = 3 single, max = 3 two-way tie, with blind and without.

---

### B.8 Rewrite Rival / Lucky Charm / Dominate on Stats page

**Driver:** current logic (`apps/api/src/routes/stats.ts:528-558`) aggregates `myMoney` and `theirMoney` as **round totals** across rounds the two players were grouped. Every teammate from the same round ends up with the same `myMoney` value. The frontend callouts (`stats.tsx:504-533`) sort on `myMoney` to pick charm / rival, which ties when multiple teammates share a round, and displays a round-total number labeled "Rival" that has nothing to do with head-to-head.

**Observed Week 1:** Ben McGinnis shows "Rival: Jeff Madden +$20." The +$20 is Ben's round total (same value for all 3 of his teammates); Madden was picked by stable-sort arbitrariness.

**Depends on:** B.0 (money breakdown helper).

**New helper:** `apps/api/src/lib/hole-teams.ts`

```ts
export type HoleTeam = {
  teammates: Set<number>;  // player IDs on same team as perspective (excludes self)
  opponents: Set<number>;  // player IDs on opposite team
};

// For a given (perspective player P, hole, wolf decision, group players),
// returns the team composition from P's point of view.
export function getHoleTeamFor(
  perspectivePlayerId: number,
  holeNumber: number,
  groupPlayerIds: number[],
  wolfDecision: { decision: 'alone' | 'blind_wolf' | 'partner'; wolfPlayerId: number; partnerPlayerId: number | null } | null,
): HoleTeam;
```

**Logic:**
- Holes 1 & 3 (skins): `teammates = {}`, `opponents = the other 3 groupmates`. Each player is on their own team.
- Wolf holes:
  - `decision = 'alone'` or `'blind_wolf'` (wolf is 1v3):
    - If perspective IS the wolf → teammates = {}, opponents = other 3.
    - If perspective is NOT the wolf → teammates = the other 2 non-wolf players, opponents = {wolf}.
  - `decision = 'partner'` with partnerPlayerId P (2v2):
    - If perspective IS the wolf → teammates = {P}, opponents = other 2.
    - If perspective IS the partner (P) → teammates = {wolf}, opponents = other 2.
    - If perspective is neither → teammates = the 4th non-wolf-team player, opponents = {wolf, partner}.

**New rival aggregator (replaces `stats.ts:528-558`):**

For each pair (perspective player *me*, other groupmate *X*), iterate every hole they were in the same group together. For each hole:
1. Compute `HoleTeam` from *me*'s perspective.
2. Look up *me*'s hole money and *X*'s hole money from `RoundMoneyBreakdown` (B.0).
3. Accumulate into 4 buckets per (me, X):
   - `partnerHoles_myMoney` — my $ on holes where X was my teammate.
   - `partnerHoles_theirMoney` — X's $ on holes where X was my teammate.
   - `opponentHoles_myMoney` — my $ on holes where X was my opponent.
   - `opponentHoles_theirMoney` — X's $ on holes where X was my opponent.

**Derived rival record per X (clean rename — no backwards-compat field reuse):**

```ts
type Rival = {
  playerId: number;
  name: string;
  roundsTogether: number;
  partnerHoles: number;          // hole count as teammate
  opponentHoles: number;         // hole count as opponent
  luckyCharm: number;            // = partnerHoles_myMoney + opponentHoles_myMoney
                                 //   (my net $ on every hole grouped with X)
  dominate: number;              // = opponentHoles_myMoney
                                 //   (my net $ on opponent-only holes)
  rival: number;                 // = opponentHoles_theirMoney
                                 //   (X's net $ on opponent-only holes)
};
```

**Breaking change:** the old fields `myMoney`, `theirMoney`, `moneyDiff` are **removed** from the API response. No silent semantic change. The frontend rewrite updates every reference to the new names in the same PR. Any stale deploy reading the old endpoint would get a 500-ish shape mismatch, which is louder and safer than silent mis-rendering.

**Mitigation for stale-client risk:**
- The API+web are always deployed atomically via `./deploy.sh` (single Docker Compose rebuild).
- PWA cache miss is surfaced via the existing version-check banner — users see "New version available" and reload.
- No external consumers of this endpoint exist (internal `/stats/:playerId/detail` only, used by `stats.tsx`).

**Frontend rewrite** (`stats.tsx:504-533`):

Replace the three callouts with:

- 🍀 **Lucky Charm** — rival with max `luckyCharm` (>0 gate). "Around them, my money goes up." Tiebreaker: max `partnerHoles + opponentHoles` (longer sample).
- 👑 **Dominate** — rival with max `dominate` (>0 gate). "When they're my opponent, I take $ off them."
- 🎯 **Rival** — rival with max `rival` (>0 gate). "They take the most $ off me when we're on opposite sides."

Same `.length >= 2` emit gate as today. Each callout independently gated on its metric being positive.

**"When Grouped With" full list** (`stats.tsx:840-875`):

Update columns to reflect the new data. Proposed:
- Player · Rds · P/Opp (partner-hole / opponent-hole counts) · Charm · Dom · Rival.
- Sort by `luckyCharm` descending (top of list = most fun to play with).

**Tests:**

Vitest for `hole-teams.ts`:
- Skins hole — every groupmate is opponent for every perspective.
- Wolf alone: wolf perspective → all 3 opponents. Non-wolf perspective → wolf is opponent, other 2 are teammates.
- Wolf partner: 2v2 team splits across all 4 perspectives.
- Blind wolf: same as alone.

Vitest for rival aggregator:
- Single round where A and B are partners on 1 wolf hole, opponents on 14 other wolf holes + 2 skins → partnerHoles=1, opponentHoles=16.
- Multiple rounds summing correctly across different partnership arrangements.
- Skins-hole money correctly attributes to opponent buckets.

Manual web verification:
- Load Ben's stats drill-down — confirm callouts show real head-to-head numbers, not the +$20 round total.
- Load Jaquint's stats drill-down — confirm callouts appear (debug the "no rival" UI issue in passing; if it persists after backend rewrite, trace the frontend gating).

**Migration:**

No DB migration. Pure compute layer. Old `myMoney`/`theirMoney`/`moneyDiff` fields removed from response (see clean-rename section above); frontend updated in the same PR.

**Risk:**
- **Medium.** Most complex of the B-family — per-hole team derivation has many branches (skins × wolf-alone × wolf-partner × 4 perspectives). Test every branch.
- Callout labels shift meaning. Users will notice their Charm/Rival "changed." Communicate in the changelog post.

---

## Rollout

### Sequencing

1. **Already done (uncommitted):** A.1 (shortName). Ship as standalone micro-commit whenever — zero risk.
2. **Before Friday 2026-04-24:** PR A bundle (A.2, A.3, A.4, A.5). Deploy ≥ 48h before Friday for sanity-check window.
3. **Before Friday 2026-04-24:** PR B bundle (B.0 helper + B.1–B.8). Fully independent from PR A.

PRs A and B are independent — either can merge first. A.1's micro-commit can precede either.

### Deploy

Standard `DEPLOY_USER=root ./deploy.sh`. No migrations, no env changes, no container rebuild concerns.

### Post-deploy verification

- **A.1 (DONE):** Confirmed "Jeff M." / "Jeff B." appear on score-entry (local verification pre-commit).
- **A.2:** Toggle all 3 sort modes on live leaderboard; rank column recomputes; localStorage persists.
- **A.3:** Revisit `/score-entry` with session populated → auto-redirects, no confirmation screen.
- **A.4:** Fresh entry-code login → group picker appears before ball-draw.
- **A.5:** Tap Group-N filter → all 4 cards expand; individual toggle still works.
- **B.0-B.7:** Spin up a test round with deliberate ties + wolf scenarios, finalize, inspect reel.
- **B.8:** Load Ben McGinnis's stats drill-down — verify 🍀/👑/🎯 callouts show distinct real head-to-head numbers, not the old +$20 round total. Verify Jaquint's callouts render correctly.

---

## Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| A.4 | Flow change breaks mid-Friday for a player with an old session | Deploy ≥48h early; the new flow is a superset of the old (single-group rounds still auto-pass through) |
| A.3 | Auto-redirect loops if session state is stale (group deleted, round cancelled) | Defensive 404 handler in `/score-entry-hole` that clears session and bounces |
| A.5 | Existing single-select behavior regresses in All view | Explicit `viewMode === 'all'` branch keeps today's replace-on-tap behavior |
| B.0 | Wolf-money helper drifts from `recalculateMoney()` and the two disagree | Tests lock helper output against `recalculateMoney()` for a single group fixture |
| B.3-B.6 | Wolf-money aggregation mistakenly includes non-wolf holes or other players' wolf holes | Spec locks "wolf money = player's $ on holes where *they* were the wolf"; B.0 helper must expose per-(player, hole) where player is wolf |
| B.8 | Team-composition derivation misclassifies a perspective (e.g., wolf's partner's team) and inflates partner/opponent buckets | `hole-teams.ts` is pure and unit-tested across all 4 perspectives × 3 decision types + skins; helper is the single source of truth for the aggregator |
| B.8 | Callout labels shift meaning post-deploy, users confused | Call out in GroupMe changelog post that "Rival" now means real head-to-head, not repeated round total |
| All | PWA cache miss for returning players | Existing version-check banner handles this (already in production, no extra work) |

## Open Questions — Resolved

1. ~~Wolf money definition~~ → **Per-player, own-wolf-holes only.** Each player has exactly 4 wolf holes (16 ÷ 4); their wolf money = $ outcome on those 4 holes including settlement + bonuses. Other players' wolf holes don't count.
2. ~~Per-hole vs round-total framing~~ → **Both, with dedup.** Biggest Wolf Win / Loss (per-hole, always emit when non-zero). Pack Leader / Fed to the Pack (round-total, emit only when different from the single-hole value).
3. ~~B.4 emoji~~ → **🥩**.
4. ~~A.4 picker UX~~ → **Keep current ball-draw layout** (3 groups stacked with player names under each). Moving location, not redesigning presentation.
5. **A.2 sort preference persistence:** `localStorage` (per-browser). Server-side per-player isn't possible without a session model change (out of scope).
