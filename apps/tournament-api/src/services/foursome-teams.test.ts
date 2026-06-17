import { describe, expect, it } from 'vitest';
import { resolveFoursomeTeams } from './foursome-teams.js';

describe('resolveFoursomeTeams', () => {
  it('teams are slots 1&2 vs 3&4 — by organizer order, NOT alphabetical', () => {
    // Slot order deliberately fights alphabetical: A-player + hack on each team.
    const members = [
      { playerId: 'zoe', slotNumber: 1 }, // team A
      { playerId: 'amy', slotNumber: 2 }, // team A
      { playerId: 'yan', slotNumber: 3 }, // team B
      { playerId: 'bob', slotNumber: 4 }, // team B
    ];
    const teams = resolveFoursomeTeams(members)!;
    expect(teams.teamA).toEqual(['zoe', 'amy']);
    expect(teams.teamB).toEqual(['yan', 'bob']);
    expect(teams.ordered).toEqual(['zoe', 'amy', 'yan', 'bob']);
    // Alphabetical would have wrongly produced teamA = [amy, bob].
    expect(teams.teamA).not.toEqual(['amy', 'bob']);
  });

  it('orders by slot regardless of row arrival order', () => {
    const members = [
      { playerId: 'd', slotNumber: 4 },
      { playerId: 'b', slotNumber: 2 },
      { playerId: 'a', slotNumber: 1 },
      { playerId: 'c', slotNumber: 3 },
    ];
    const teams = resolveFoursomeTeams(members)!;
    expect(teams.ordered).toEqual(['a', 'b', 'c', 'd']);
    expect(teams.teamA).toEqual(['a', 'b']);
    expect(teams.teamB).toEqual(['c', 'd']);
  });

  it('returns null when not exactly 4 members', () => {
    expect(resolveFoursomeTeams([])).toBeNull();
    expect(resolveFoursomeTeams([{ playerId: 'a', slotNumber: 1 }])).toBeNull();
    expect(
      resolveFoursomeTeams([
        { playerId: 'a', slotNumber: 1 },
        { playerId: 'b', slotNumber: 2 },
        { playerId: 'c', slotNumber: 3 },
      ]),
    ).toBeNull();
  });

  it('REFUSES (null) on corrupt slot data rather than guessing wrong teams', () => {
    // Duplicate slot_number → intended partnerships are unknowable → null, so
    // the caller skips the foursome (visible "fix the pairing") instead of
    // computing silently-wrong money.
    expect(
      resolveFoursomeTeams([
        { playerId: 'b', slotNumber: 1 },
        { playerId: 'a', slotNumber: 1 },
        { playerId: 'd', slotNumber: 2 },
        { playerId: 'c', slotNumber: 2 },
      ]),
    ).toBeNull();
    // Duplicate playerId (corrupt member rows) → null too.
    expect(
      resolveFoursomeTeams([
        { playerId: 'a', slotNumber: 1 },
        { playerId: 'a', slotNumber: 2 },
        { playerId: 'c', slotNumber: 3 },
        { playerId: 'd', slotNumber: 4 },
      ]),
    ).toBeNull();
  });

  it('accepts distinct slots that are not exactly 1..4 (lowest-two vs highest-two)', () => {
    const teams = resolveFoursomeTeams([
      { playerId: 'p', slotNumber: 2 },
      { playerId: 'q', slotNumber: 4 },
      { playerId: 'r', slotNumber: 5 },
      { playerId: 's', slotNumber: 9 },
    ])!;
    expect(teams.teamA).toEqual(['p', 'q']); // slots 2,4
    expect(teams.teamB).toEqual(['r', 's']); // slots 5,9
  });
});
