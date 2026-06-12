/**
 * T13-4 scorer-policy eligibility — pure decision for "may this player be a
 * foursome's designated scorer?" Single source of truth, used by both
 * designation points (start-round + scorer handoff/transfer).
 *
 * Single-writer is unchanged: this gates who may BECOME the active scorer, not
 * concurrent writing. `require-scorer-for-round` still enforces one writer.
 *
 * Pure: no DB, no I/O. Callers fetch the policy, the designee pool, the
 * foursome's member ids, and the event organizer, then ask here.
 */
export type ScorerPolicy = 'foursome' | 'designated' | 'open';

export function isScorerPolicy(v: unknown): v is ScorerPolicy {
  return v === 'foursome' || v === 'designated' || v === 'open';
}

export type ScorerEligibilityInput = {
  policy: ScorerPolicy;
  /** Pool of allowed scorers when policy === 'designated' (event-scoped). */
  designatedIds: ReadonlySet<string> | readonly string[];
  /** Player ids in the foursome being scored. */
  foursomeMemberIds: ReadonlySet<string> | readonly string[];
  /** The event's organizer — always eligible under every policy. */
  organizerPlayerId: string;
  /** The player proposed as the scorer. */
  candidateId: string;
  /**
   * Whether the candidate is an event participant. Only consulted for 'open'
   * (the caller has already confirmed participation via its auth chain, so this
   * defaults true). Guards 'open' from accepting a non-participant id.
   */
  candidateIsParticipant?: boolean;
};

function has(set: ReadonlySet<string> | readonly string[], id: string): boolean {
  return set instanceof Set ? set.has(id) : (set as readonly string[]).includes(id);
}

/**
 * Returns true when `candidateId` may be a scorer for the foursome under the
 * event's policy. The organizer is always eligible (mirrors the pre-T13-4
 * `isMember || isOrganizer` rule, which the 'foursome' policy reproduces).
 */
export function isEligibleScorer(input: ScorerEligibilityInput): boolean {
  const {
    policy,
    designatedIds,
    foursomeMemberIds,
    organizerPlayerId,
    candidateId,
    candidateIsParticipant = true,
  } = input;

  if (candidateId === organizerPlayerId) return true;

  switch (policy) {
    case 'foursome':
      return has(foursomeMemberIds, candidateId);
    case 'designated':
      return has(designatedIds, candidateId);
    case 'open':
      // Any event participant. The caller's auth chain has already confirmed
      // participation; the flag is a defensive guard against a stray id.
      return candidateIsParticipant;
    default:
      return false;
  }
}
