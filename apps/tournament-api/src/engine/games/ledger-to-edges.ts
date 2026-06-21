/**
 * ledger-to-edges (Story 1.1) — pure: lowers a foursome ledger's cross-team
 * pairwise matrix to a canonical SettlementEdge[] (sourceType 'f1_game'),
 * fromPlayerId PAYS toPlayerId. Loss-less: the edge sum reconciles to the
 * ledger total (NFR-C3). Deterministic: sorted by (fromPlayerId, toPlayerId).
 *
 * sourceId is caller-supplied (Story 1.4 passes the real game/round identity),
 * keeping the engine pure — no id generation, no Date/random.
 */
import type { Ledger, SettlementEdge, TeamSplit } from './types.js';

export function ledgerToEdges(
  ledger: Ledger,
  teamSplit: TeamSplit,
  opts: { sourceId: string },
): SettlementEdge[] {
  const edges: SettlementEdge[] = [];
  for (const a of teamSplit.teamA) {
    for (const b of teamSplit.teamB) {
      const v = ledger.cross[a]?.[b] ?? 0;
      if (v > 0) {
        // b owes a
        edges.push({ fromPlayerId: b, toPlayerId: a, cents: v, sourceType: 'f1_game', sourceId: opts.sourceId });
      } else if (v < 0) {
        edges.push({ fromPlayerId: a, toPlayerId: b, cents: -v, sourceType: 'f1_game', sourceId: opts.sourceId });
      }
    }
  }
  edges.sort((x, y) =>
    x.fromPlayerId < y.fromPlayerId ? -1
    : x.fromPlayerId > y.fromPlayerId ? 1
    : x.toPlayerId < y.toPlayerId ? -1
    : x.toPlayerId > y.toPlayerId ? 1
    : 0,
  );
  return edges;
}
