# Gemini Review

- Generated: 2026-06-24T16:20:37.933Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: packages/engine/src/pairing.ts, packages/engine/src/pairing.test.ts, apps/api/src/lib/sub-grouping.ts, apps/api/src/routes/admin/attendance.ts, apps/api/src/routes/attendance.ts, apps/api/src/routes/admin/pairing.ts, apps/api/src/routes/admin/rounds.ts, apps/api/src/db/schema.ts, apps/api/src/db/migrations/0034_harsh_black_bird.sql, apps/web/src/routes/attendance.tsx

## Summary

The implementation introduces sub-aware pairing through an elegant combination of union-find clustering (for hard links) and a mathematically clever marginal cost penalty (for soft sub-spreading). However, the clustering implementation introduces two bin-packing vulnerabilities in the greedy assignment phase: oversized clusters are never broken up (violating the fallback requirement), and random insertion order can cause fragmentation that strands perfectly valid clusters in the remainder.

Overall risk: high

## Findings

1. [high] Oversized linked clusters are not broken up into unlinked players, permanently stranding them
   - File: packages/engine/src/pairing.ts:263
   - Confidence: high
   - Why it matters: If users transitively chain "play-with" links such that a cluster exceeds `groupSize` (e.g., 5 players), the engine will not place any of them. The entire cluster will fail all group capacity checks and be pushed to the `remainder` array, leaving groups underfilled. This violates the stated engine requirement (and JSDoc) that oversized clusters should "fall back to normal (unlinked) assignment."
   - Suggested fix: After `buildClusters` returns, iterate over the generated clusters and flatten any cluster where `members.length > groupSize` into individual singletons before proceeding to the pin validation phase.

2. [high] Shuffled cluster assignment causes bin-packing fragmentation, stranding players in remainder
   - File: packages/engine/src/pairing.ts:323-328
   - Confidence: high
   - Why it matters: Unpinned clusters are randomly shuffled and greedily assigned. If a large cluster (e.g., size 3) appears late in the shuffle sequence, the earlier singletons may have evenly partially filled the available groups such that no single group has 3 contiguous seats left. The large cluster will then fail the capacity check for every group and fall into the remainder, leaving multiple groups underfilled despite there being enough total capacity for all players.
   - Suggested fix: After shuffling `unpinnedClusters` (which consumes the RNG values and preserves determinism), perform a stable sort by descending cluster size (`shuffled.sort((a, b) => b.length - a.length)`). Placing larger blocks first (First-Fit Decreasing) eliminates this fragmentation risk while maintaining randomness among clusters of the same size.

## Strengths

- Excellent use of Union-Find with path compression for handling transitive keep-together links efficiently.
- The marginal sub-collision logic (`existingSubs > 0 ? clusterSubs : Math.max(0, clusterSubs - 1)`) is mathematically elegant and perfectly computes the correct incremental penalty for any cluster size.
- Outstanding preservation of backwards compatibility; the clustering logic beautifully degenerates to the exact pre-existing singleton array ordering when no links are present, guaranteeing the same RNG sequence for deterministic replays.
- Data layer and API integration is defensive and robust, properly discarding stale links if a sponsored player's attendance drops to 'out'.

## Warnings

- Truncated file content for review: apps/api/src/routes/admin/rounds.ts
- Truncated file content for review: apps/api/src/db/schema.ts
- Truncated file content for review: apps/web/src/routes/attendance.tsx
