/**
 * Sub-status is owned by the roster badge. A player's status (players.status:
 * 'active' | 'sub' | 'inactive') is the single, live source of truth for whether
 * they count as a sub: anyone who is not 'active' is a sub.
 *
 * Standings and the stats page read this LIVE, so toggling a player's roster
 * badge moves them above/below the line (and in/out of stats) immediately and
 * reversibly — there is no per-round snapshot to repair. Keep this the one place
 * that derives sub-status from roster state.
 */
export function isSubFromStatus(status: string | null | undefined): boolean {
  return status !== "active";
}
