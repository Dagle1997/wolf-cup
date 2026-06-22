/**
 * ledger-to-edges (Story 1.1; Story 2.1a 1-to-1 rewrite) — pure: lowers a
 * foursome ledger to a canonical SettlementEdge[] (sourceType 'f1_game'),
 * fromPlayerId PAYS toPlayerId. Deterministic: sorted by (fromPlayerId,
 * toPlayerId). sourceId is caller-supplied (no id gen, no Date/random).
 *
 * Story 2.1a: WHOLE-DOLLAR 1-to-1 layout. Each loser pays ONE winner the FULL
 * per-player amount (slot-paired teamA[i] <-> teamB[i]), instead of the old
 * four pv/2 quarter-legs — so no half-dollar leg ever surfaces in the settle-up
 * ("I pay Tom, you pay Bill"). This is exact because the guyan-2v2 cross matrix
 * is symmetric within a team (compute-foursome adds the same `half` to all four
 * cross cells each hole), so perPlayerCents[a0]==perPlayerCents[a1] and
 * perPlayerCents[b_i] == -perPlayerCents[a_i]. Per-player nets and the ledger
 * total are UNCHANGED vs the 4-leg layout (2*|p| == 4*(|p|/2)); loss-less
 * (NFR-C3) preserved.
 *
 * Teams come from the passed `teamSplit` (NEVER inferred from balances — a push
 * yields no edges). A fail-closed reconstruction guard throws
 * `asymmetric_2v2_ledger` if the <=2 emitted edges do not reproduce all four
 * per-player balances, so a future non-symmetric game can never silently
 * mis-settle through this 2v2-scoped path (it would need its own lowering).
 */
import type { Ledger, SettlementEdge, TeamSplit } from './types.js';

export function ledgerToEdges(
  ledger: Ledger,
  teamSplit: TeamSplit,
  opts: { sourceId: string },
): SettlementEdge[] {
  const { teamA, teamB } = teamSplit;

  // Fail-closed (defensive): structurally validate the 2v2 team split. The
  // production caller (resolveFoursomeTeams) already guarantees four distinct
  // players in distinct slots, but this is a money path — never emit an edge
  // with an undefined or duplicate party even under an unexpected caller bug.
  const slots: ReadonlyArray<unknown> = [teamA?.[0], teamA?.[1], teamB?.[0], teamB?.[1]];
  if (
    !Array.isArray(teamA) ||
    !Array.isArray(teamB) ||
    teamA.length !== 2 ||
    teamB.length !== 2 ||
    slots.some((p) => typeof p !== 'string' || p.length === 0) ||
    new Set(slots).size !== 4
  ) {
    throw new Error('invalid_2v2_team_split');
  }
  const [a0, a1, b0, b1] = slots as [string, string, string, string];

  // Fail-closed: every member must have an EXPLICIT integer per-player balance.
  // No `?? 0` masking — a missing/non-integer key is a malformed ledger, not a
  // silent "zero" (which could drop a real settlement leg and still pass the
  // reconstruction guard because both sides coalesce to 0).
  const pp = ledger.perPlayerCents;
  if (pp === null || typeof pp !== 'object') {
    throw new Error('incomplete_ledger: perPlayerCents is missing');
  }
  for (const m of [a0, a1, b0, b1]) {
    if (!Object.prototype.hasOwnProperty.call(pp, m) || !Number.isInteger(pp[m])) {
      throw new Error(`incomplete_ledger: perPlayerCents missing/non-integer for ${m}`);
    }
  }

  // Slot-paired 1-to-1: teamA[i] settles with teamB[i] for teamA[i]'s FULL
  // per-player amount. Symmetry (see header) makes this exact and whole-dollar.
  const edges: SettlementEdge[] = [];
  for (const [a, b] of [[a0, b0], [a1, b1]] as const) {
    const p = pp[a]!;
    if (p > 0) {
      edges.push({ fromPlayerId: b, toPlayerId: a, cents: p, sourceType: 'f1_game', sourceId: opts.sourceId });
    } else if (p < 0) {
      edges.push({ fromPlayerId: a, toPlayerId: b, cents: -p, sourceType: 'f1_game', sourceId: opts.sourceId });
    }
    // p === 0 → no edge (push leg).
  }

  // Fail-closed: the <=2 edges must reconstruct ALL four per-player balances
  // exactly. Exact for a symmetric 2v2 ledger; throws otherwise so a
  // non-symmetric ledger can never settle silently-wrong through this path.
  const recon: Record<string, number> = { [a0]: 0, [a1]: 0, [b0]: 0, [b1]: 0 };
  for (const e of edges) {
    recon[e.toPlayerId]! += e.cents;
    recon[e.fromPlayerId]! -= e.cents;
  }
  for (const m of [a0, a1, b0, b1]) {
    if (recon[m] !== pp[m]) {
      throw new Error(
        `asymmetric_2v2_ledger: 1-to-1 edges do not reconstruct perPlayerCents for ${m}`,
      );
    }
  }

  // Fail-closed loss-less (NFR-C3, AC3): the emitted edge total must equal the
  // ledger total (sum of |cross cells|). Catches an inconsistent totalCents that
  // the reconstruction guard alone would not (per-player could reconstruct while
  // totalCents disagrees).
  const edgeTotal = edges.reduce((s, e) => s + e.cents, 0);
  if (edgeTotal !== ledger.totalCents) {
    throw new Error(`ledger_total_mismatch: edges=${edgeTotal} ledger=${ledger.totalCents}`);
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
