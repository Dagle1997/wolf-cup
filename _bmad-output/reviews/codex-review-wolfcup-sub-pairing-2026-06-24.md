# Codex Review

- Generated: 2026-06-24T16:17:18.758Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: packages/engine/src/pairing.ts, packages/engine/src/pairing.test.ts, apps/api/src/lib/sub-grouping.ts, apps/api/src/routes/admin/attendance.ts, apps/api/src/routes/attendance.ts, apps/api/src/routes/admin/pairing.ts, apps/api/src/routes/admin/rounds.ts, apps/api/src/db/schema.ts, apps/api/src/db/migrations/0034_harsh_black_bird.sql, apps/web/src/routes/attendance.tsx

## Summary

The engine change cleanly adds soft sub-spreading and hard keep-together links with good targeted tests. However, there is a concrete correctness bug when a contracted cluster exceeds groupSize: the current implementation overflows those players into `remainder` instead of “falling back to normal (unlinked) assignment,” which can drop players from generated groups. Separately, the pin-lifting refactor changes which pins are honored (and the in-group ordering of pinned players) in overflow scenarios, which threatens the stated AC6 “byte-identical to before” requirement even when there are no subs/links.

Overall risk: high

## Findings

1. [critical] Oversized linked clusters (> groupSize) cause players to be dropped into remainder instead of falling back to normal assignment
   - File: packages/engine/src/pairing.ts:261-378
   - Confidence: high
   - Why it matters: The docstring promises: “a cluster larger than `groupSize` cannot fit and its members fall back to normal (unlinked) assignment.” But the code never implements this fallback. If `buildClusters` produces `members.length > groupSize`, then in greedy assignment every group fails `currentGroups[g].length + size > groupSize` (line 339), so `bestGroup` stays -1 and *all members* are pushed to `overflow` (lines 373–377). That means players can be omitted from all groups and end up in `remainder` solely because of an invalid/excessive link graph (e.g., 1 sponsor + 4 subs ⇒ size 5). This is a correctness/data-loss risk for round generation: the engine can output an invalid partition (missing players) even though a valid partition exists if links were ignored/split.
   - Suggested fix: After clustering (or during union), detect clusters with `members.length > groupSize` and *discard/break* those links so those players still get assigned. Minimal approach: in `suggestGroups`, post-process `clusters` so any oversized `members` array is replaced with singleton clusters `[id]` for each member (or otherwise split) before pin-lifting/shuffle. Add a test covering a 5-player contracted cluster with `groupSize=4` asserting all players still land in groups/remainder exactly as the no-link case (i.e., not all 5 in remainder).

2. [high] Pin overflow precedence and pinned-player ordering changed by pin-lifting-to-clusters, threatening “byte-identical to before” determinism in no-link/no-sub scenarios
   - File: packages/engine/src/pairing.ts:265-318
   - Confidence: high
   - Why it matters: Previously, pin validation/capacity (“excess pins fall through”) was enforced in the iteration order of the `pins` map; that order also determined the order pinned players were appended into each group. Now pins are first collected into `playerPin` (lines 269–274) and then applied by iterating `clusters` in `uniquePlayerIds` order (lines 285–300), choosing a cluster’s group via its first pinned member in member order (lines 286–293) and enforcing capacity via `slotsUsed` in that same cluster iteration order (line 294). In cases where too many players are pinned to the same group (or two linked players have conflicting pins), the *set of honored pins* and the *in-group ordering* can differ from the prior engine. That can change (a) which players are shuffled vs pre-seated and thus the RNG draw sequence length/content, and (b) the final `groups` array byte representation (ordering of pinned players). This directly conflicts with the stated AC6 requirement (“byte-identical to before”) for the no-links/no-subs path if callers provide pins (e.g., from group requests/admin pins).
   - Suggested fix: If AC6 truly requires backward byte-identical output, add an explicit fast-path: when `(!input.links || input.links.length===0) && (!input.subIds || input.subIds.size===0)`, execute the legacy pre-cluster pin+shuffle logic unchanged. If you prefer one path, preserve legacy pin precedence by tracking each pin’s insertion index from `pinMap` iteration and sorting `pinnedClusters` (and their members when singleton) by earliest pin index when seeding `currentGroups`, and apply the same precedence when dropping overflow pins.

3. [medium] buildSubGroupingInputs includes play-with links regardless of attendance status; comment says links honored when both are confirmed
   - File: apps/api/src/lib/sub-grouping.ts:55-69
   - Confidence: medium
   - Why it matters: `buildSubGroupingInputs` selects `{ playerId, playWithPlayerId }` for all attendance rows for the week (line 55–61) and includes a link if both IDs are in `playerIds` (line 67), but it does not check `attendance.status`. If a caller passes `playerIds` that include someone who is marked `out` (or if the round’s player list and attendance diverge), this can still emit a hard keep-together constraint even though the schema comments and route docs describe honoring the link “when both are confirmed in.” This can surprise admins and complicate debugging because the link behavior depends on call-site `playerIds`, not on attendance confirmation.
   - Suggested fix: Include `attendance.status` in the select and require `status === 'in'` for both the requester and sponsor (or at least the requester) before pushing a link. This makes link semantics self-contained and consistent with the API/docs.

4. [medium] Public attendance payload now exposes playWithPlayerId (admin-only intent unclear)
   - File: apps/api/src/routes/attendance.ts:103-123
   - Confidence: high
   - Why it matters: The public `GET /attendance` now returns `playWithPlayerId` for every player (lines 105–123). Since only admins can set this field (PATCH endpoint is admin-auth), this may unintentionally leak organizer-only pairing metadata to all users/clients. Even if the UI doesn’t render it for non-admins, it’s available to anyone inspecting the response.
   - Suggested fix: If this field is intended to be admin-only, omit it from the public route or return it only when the request is authenticated as admin. Alternatively, document that it’s public and acceptable to expose.

## Strengths

- Engine: union-find clustering preserves within-cluster member order based on first appearance in `playerIds`, which is a solid basis for deterministic behavior when links exist (packages/engine/src/pairing.ts:170–224).
- Engine: SUB_SPREAD_PENALTY is explicitly an integer constant with tests enforcing integer-ness (packages/engine/src/pairing.ts:138–147; packages/engine/src/pairing.test.ts:515–518).
- Engine tests cover key behaviors: soft spreading, forced co-grouping, absent-player link dropping, and pin inheritance through a link (packages/engine/src/pairing.test.ts:413–513).
- API: PATCH play-with endpoint validates IDs, JSON body, self-link rejection, attendance-row precondition, sponsor existence, and supports clearing via null (apps/api/src/routes/admin/attendance.ts:315–395).

## Warnings

- Truncated file content for review: apps/api/src/routes/admin/rounds.ts
- Truncated file content for review: apps/api/src/db/schema.ts
- Truncated file content for review: apps/web/src/routes/attendance.tsx
