/**
 * Per-hole team composition from a perspective player's point of view.
 *
 * Powers the rival/charm/dominate stats on the stats page (B.8) and anywhere
 * else we need to know "was X my teammate or opponent on this hole?"
 *
 * Pure function — no DB access, no engine dependency.
 */

export type HoleTeam = {
  teammates: Set<number>;  // player IDs on the same side as perspective (excludes self)
  opponents: Set<number>;  // player IDs on opposite side
};

export type WolfDecisionInput = {
  decision: 'alone' | 'partner' | 'blind_wolf';
  wolfPlayerId: number;
  partnerPlayerId: number | null; // non-null only when decision === 'partner'
};

const SKINS_HOLES: ReadonlySet<number> = new Set([1, 3]);

export function isSkinsHole(holeNumber: number): boolean {
  return SKINS_HOLES.has(holeNumber);
}

/**
 * Return the team composition for `perspectivePlayerId` on a given hole.
 *
 * Skins holes (1, 3): everyone is on their own team — all 3 groupmates are
 * opponents from any player's perspective. `wolfDecision` is ignored.
 *
 * Wolf holes:
 *   - decision='alone' or 'blind_wolf' → wolf is 1v3 against the other 3.
 *   - decision='partner' → 2v2; wolf + partnerPlayerId vs the remaining 2.
 */
export function getHoleTeamFor(
  perspectivePlayerId: number,
  holeNumber: number,
  groupPlayerIds: number[],
  wolfDecision: WolfDecisionInput | null,
): HoleTeam {
  // Defensive: perspective must be in the group
  if (!groupPlayerIds.includes(perspectivePlayerId)) {
    return { teammates: new Set(), opponents: new Set() };
  }
  const others = groupPlayerIds.filter((id) => id !== perspectivePlayerId);

  // Skins hole: everyone on their own team
  if (isSkinsHole(holeNumber)) {
    return { teammates: new Set(), opponents: new Set(others) };
  }

  // Wolf hole without a recorded decision — treat as no-team (safest default)
  if (!wolfDecision) {
    return { teammates: new Set(), opponents: new Set() };
  }

  const { decision, wolfPlayerId, partnerPlayerId } = wolfDecision;

  if (decision === 'alone' || decision === 'blind_wolf') {
    // Wolf is 1v3
    if (perspectivePlayerId === wolfPlayerId) {
      return { teammates: new Set(), opponents: new Set(others) };
    }
    // Non-wolf: other 2 non-wolf players are teammates, wolf is opponent
    return {
      teammates: new Set(others.filter((id) => id !== wolfPlayerId)),
      opponents: new Set([wolfPlayerId]),
    };
  }

  // decision === 'partner' (2v2)
  if (partnerPlayerId === null) {
    // Data inconsistency — treat like alone
    if (perspectivePlayerId === wolfPlayerId) {
      return { teammates: new Set(), opponents: new Set(others) };
    }
    return {
      teammates: new Set(others.filter((id) => id !== wolfPlayerId)),
      opponents: new Set([wolfPlayerId]),
    };
  }

  if (perspectivePlayerId === wolfPlayerId) {
    // I'm the wolf; my teammate is the partner; the other 2 are opponents
    return {
      teammates: new Set([partnerPlayerId]),
      opponents: new Set(others.filter((id) => id !== partnerPlayerId)),
    };
  }

  if (perspectivePlayerId === partnerPlayerId) {
    // I'm the picked partner; my teammate is the wolf; the other 2 are opponents
    return {
      teammates: new Set([wolfPlayerId]),
      opponents: new Set(others.filter((id) => id !== wolfPlayerId)),
    };
  }

  // I'm on the non-wolf team; my teammate is the 4th non-wolf-team player;
  // the wolf + partner are my opponents
  const nonWolfTeamOther = others.find((id) => id !== wolfPlayerId && id !== partnerPlayerId) ?? null;
  return {
    teammates: nonWolfTeamOther !== null ? new Set([nonWolfTeamOther]) : new Set(),
    opponents: new Set([wolfPlayerId, partnerPlayerId]),
  };
}
