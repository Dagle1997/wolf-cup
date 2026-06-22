import { describe, it, expect } from 'vitest';
import { greenieFold, greenieActive, greenieCarryover } from './greenie.js';
import { computeFoursome } from '../compute-foursome.js';
import { ledgerToEdges } from '../ledger-to-edges.js';
import { validateResolvedConfig } from '../registry.js';
import type { GameConfig, HoleClaims, HoleState, Modifier, TeamSplit } from '../types.js';

const teamSplit: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const MEMBERS = ['a1', 'a2', 'b1', 'b2'] as const;

/** Greenie config: flat $5/point unless a schedule is supplied. */
function greenieConfig(
  opts: { enabled?: boolean; carryover?: boolean; schedule?: GameConfig['pointValueSchedule'] } = {},
): GameConfig {
  const { enabled = true, carryover = true, schedule } = opts;
  const modifiers: Modifier[] = enabled
    ? [{ type: 'greenie', enabled: true, variant: { carryover } }]
    : [];
  return {
    game: 'guyan-2v2',
    pointValueSchedule: schedule ?? { kind: 'flat', cents: 500 },
    modifiers,
    lockState: 'locked',
    configVersion: 1,
  };
}

/** A par-3 with all nets = par (complete) unless `incomplete`, plus greenie boxes. */
function par3(
  holeNumber: number,
  boxes: ReadonlyArray<string> = [],
  opts: { incomplete?: boolean; extraClaims?: Record<string, HoleClaims> } = {},
): HoleState {
  const net: Record<string, number> = {};
  for (const p of MEMBERS) net[p] = 3;
  if (opts.incomplete) delete net['b2']; // one member's net missing → incomplete
  const claims: Record<string, HoleClaims> = { ...(opts.extraClaims ?? {}) };
  for (const p of boxes) claims[p] = { ...(claims[p] ?? {}), greenie: true };
  return { holeNumber, par: 3, net, claims };
}

/** A non-par-3 hole, all nets = par (so base points are 0). */
function nonPar3(holeNumber: number, par: number): HoleState {
  const net: Record<string, number> = {};
  for (const p of MEMBERS) net[p] = par;
  return { holeNumber, par, net };
}

describe('greenie helpers', () => {
  it('greenieActive: present+enabled true; absent or disabled false', () => {
    expect(greenieActive(greenieConfig())).toBe(true);
    expect(greenieActive(greenieConfig({ enabled: false }))).toBe(false);
  });

  it('greenieCarryover: defaults to true when variant absent', () => {
    const cfg: GameConfig = { ...greenieConfig(), modifiers: [{ type: 'greenie', enabled: true }] };
    expect(greenieCarryover(cfg)).toBe(true);
    expect(greenieCarryover(greenieConfig({ carryover: false }))).toBe(false);
  });
});

describe('greenie fold — count model', () => {
  it('one A box → +1', () => {
    const fold = greenieFold(greenieConfig(), [par3(1, ['a1'])], teamSplit);
    expect(fold.pointsByHole.get(1)).toBe(1);
    expect(fold.finalCarryPoints).toBe(0);
    expect(fold.settleablePar3Count).toBe(1);
  });

  it('both A boxes → +2 (two greenies on one hole)', () => {
    const fold = greenieFold(greenieConfig(), [par3(1, ['a1', 'a2'])], teamSplit);
    expect(fold.pointsByHole.get(1)).toBe(2);
  });

  it('one A + one B box → contested (0), pending pot PRESERVED (not incremented, not forfeited)', () => {
    // H1 unclaimed (carry→1); H3 contested (carry stays 1); H5 won → +1 + carry 1 = +2.
    const holes = [par3(1, []), par3(3, ['a1', 'b1']), par3(5, ['a1'])];
    const fold = greenieFold(greenieConfig(), holes, teamSplit);
    expect(fold.pointsByHole.has(3)).toBe(false); // contested → no award
    expect(fold.pointsByHole.get(5)).toBe(2); // preserved pot of 1 swept (not 1, not 3)
    expect(fold.finalCarryPoints).toBe(0);
  });
});

describe('greenie fold — carryover lever', () => {
  it('ON: 1st+2nd par-3 unclaimed → 3rd won worth 3 (sweep)', () => {
    const holes = [par3(1, []), par3(3, []), par3(5, ['a1'])];
    const fold = greenieFold(greenieConfig({ carryover: true }), holes, teamSplit);
    expect(fold.pointsByHole.get(5)).toBe(3);
    expect(fold.settleablePar3Count).toBe(3);
    expect(fold.finalCarryPoints).toBe(0);
  });

  it('OFF: identical inputs → 3rd worth 1 (unclaimed greenies expire)', () => {
    const holes = [par3(1, []), par3(3, []), par3(5, ['a1'])];
    const fold = greenieFold(greenieConfig({ carryover: false }), holes, teamSplit);
    expect(fold.pointsByHole.get(5)).toBe(1);
  });

  it('winner sweeps WITH multi-greenie: rawA=+2 with carriedIn=2 → +4', () => {
    const holes = [par3(1, []), par3(3, []), par3(5, ['a1', 'a2'])];
    const fold = greenieFold(greenieConfig({ carryover: true }), holes, teamSplit);
    expect(fold.pointsByHole.get(5)).toBe(4);
  });

  it('B team can win + sweep too (sign-symmetric): rawA=−1 with carriedIn=2 → −3', () => {
    const holes = [par3(1, []), par3(3, []), par3(5, ['b1'])];
    const fold = greenieFold(greenieConfig({ carryover: true }), holes, teamSplit);
    expect(fold.pointsByHole.get(5)).toBe(-3);
  });
});

describe('greenie fold — par-3 isolation + foreign keys', () => {
  it('non-par-3 holes never land the pot (carry rolls past par-4/5)', () => {
    const holes = [par3(1, []), nonPar3(2, 4), nonPar3(4, 5), par3(5, ['a1'])];
    const fold = greenieFold(greenieConfig(), holes, teamSplit);
    expect(fold.pointsByHole.get(5)).toBe(2); // 1 won + 1 carried (rolled past 2 & 4)
    expect(fold.settleablePar3Count).toBe(2); // only the two par-3s folded
  });

  it('foreign claim key (not in foursome) is ignored for counting AND for zeroBoxes', () => {
    // a1 box + foreign zzz box on a won hole → counts only a1 (+1).
    const won = greenieFold(greenieConfig(), [par3(1, ['a1'], { extraClaims: { zzz: { greenie: true } } })], teamSplit);
    expect(won.pointsByHole.get(1)).toBe(1);

    // ONLY a foreign box → treated as zeroBoxes (unclaimed → rolls), proving the
    // foreign key never counts as a checked member.
    const foreignOnly = greenieFold(
      greenieConfig(),
      [par3(1, [], { extraClaims: { zzz: { greenie: true } } }), par3(3, ['a1'])],
      teamSplit,
    );
    expect(foreignOnly.pointsByHole.get(3)).toBe(2); // H1 rolled 1 → H3 +1+1
  });
});

describe('greenie fold — incomplete-par-3 BARRIER (AC8)', () => {
  it('breaks at the first incomplete par-3; later par-3 deferred (award 0, carry frozen)', () => {
    const holes = [par3(1, []), par3(3, [], { incomplete: true }), par3(5, ['a1'])];
    const fold = greenieFold(greenieConfig(), holes, teamSplit);
    expect(fold.pointsByHole.get(5)).toBeUndefined(); // H5 deferred (no carry bridged)
    expect(fold.settleablePar3Count).toBe(1); // only H1 folded
    expect(fold.finalCarryPoints).toBe(1); // carry frozen at its pre-barrier value
  });

  it('once the gap completes (unclaimed), the later par-3 collects 3 (monotonic, no retro-vanish)', () => {
    const holes = [par3(1, []), par3(3, []), par3(5, ['a1'])];
    const fold = greenieFold(greenieConfig(), holes, teamSplit);
    expect(fold.pointsByHole.get(5)).toBe(3);
    expect(fold.settleablePar3Count).toBe(3);
  });
});

describe('greenie via computeFoursome — valuation + inert + terminal carry', () => {
  it('swept pot is valued at the COLLECTING hole PV (front carry, back collect → back PV; points not cents)', () => {
    // Front par-3 (hole 3) unclaimed → carry 1; back par-3 (hole 12) won by a1 →
    // award +2, valued at BACK pv (1000), not front (500). a1 = 2 * (1000/2) * 2 cells = 2000.
    const cfg = greenieConfig({ schedule: { kind: 'front-back', frontCents: 500, backCents: 1000 } });
    const holes = [par3(3, []), par3(12, ['a1'])];
    const ledger = computeFoursome(cfg, { teamSplit, holes });
    expect(ledger.perPlayerCents).toEqual({ a1: 2000, a2: 2000, b1: -2000, b2: -2000 });
  });

  it('terminal pending carry contributes 0 money (no phantom edge); finalCarryPoints reflects the pot', () => {
    const holes = [par3(1, []), par3(3, [])]; // both unclaimed, never won
    const fold = greenieFold(greenieConfig(), holes, teamSplit);
    expect(fold.finalCarryPoints).toBe(2);

    const ledger = computeFoursome(greenieConfig(), { teamSplit, holes });
    expect(ledger.totalCents).toBe(0);
    expect(ledgerToEdges(ledger, teamSplit, { sourceId: 's' })).toEqual([]);
  });

  it('greenie INACTIVE (no modifier) → boxes are inert (0 money)', () => {
    const cfg = greenieConfig({ enabled: false });
    const holes = [par3(1, ['a1', 'a2'])]; // boxes present but greenie not registered for this config
    const fold = greenieFold(cfg, holes, teamSplit);
    expect(fold.pointsByHole.size).toBe(0);
    expect(fold.settleablePar3Count).toBe(0);

    const ledger = computeFoursome(cfg, { teamSplit, holes });
    expect(ledger.totalCents).toBe(0);
  });

  it('greenie DISABLED (enabled:false modifier) → inert', () => {
    const cfg: GameConfig = {
      ...greenieConfig(),
      modifiers: [{ type: 'greenie', enabled: false, variant: { carryover: true } }],
    };
    expect(greenieActive(cfg)).toBe(false);
    const fold = greenieFold(cfg, [par3(1, ['a1'])], teamSplit);
    expect(fold.pointsByHole.size).toBe(0);
  });
});

describe('greenie fail-closed variant allowlist (AC11, FR44)', () => {
  it('enabled greenie with variant.basis → unsupported_greenie_variant', () => {
    const cfg: GameConfig = {
      ...greenieConfig(),
      modifiers: [{ type: 'greenie', enabled: true, variant: { basis: 'net' } }],
    };
    const v = validateResolvedConfig(cfg);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/^unsupported_greenie_variant:basis=/);
  });

  it('enabled greenie with variant.bonus → unsupported_greenie_variant', () => {
    const cfg: GameConfig = {
      ...greenieConfig(),
      modifiers: [{ type: 'greenie', enabled: true, variant: { bonus: 'double' } }],
    };
    const v = validateResolvedConfig(cfg);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toMatch(/^unsupported_greenie_variant:bonus=/);
  });

  it('modifier with a NON-BOOLEAN enabled → invalid_modifier_enabled (fail closed, not JS truthiness)', () => {
    const cfg: GameConfig = {
      ...greenieConfig(),
      modifiers: [{ type: 'greenie', enabled: 'yes' as unknown as boolean, variant: { carryover: true } }],
    };
    const v = validateResolvedConfig(cfg);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe('invalid_modifier_enabled:greenie');
  });

  it('enabled greenie with a NON-BOOLEAN carryover → unsupported_greenie_variant:carryover_type (fail closed, not `?? true`)', () => {
    // computeFoursome's guard must reject a malformed carryover that bypassed Zod,
    // rather than let greenieCarryover's `?? true` mis-interpret it via truthiness.
    const cfg: GameConfig = {
      ...greenieConfig(),
      // Cast through unknown: the runtime guard exists for callers that bypass the
      // compile-time type (e.g. unvalidated JSON reaching computeFoursome directly).
      modifiers: [{ type: 'greenie', enabled: true, variant: { carryover: 'false' as unknown as boolean } }],
    };
    const v = validateResolvedConfig(cfg);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe('unsupported_greenie_variant:carryover_type');
  });

  it('enabled net-skins with variant.carryover → unsupported_net_skins_variant:carryover', () => {
    const cfg: GameConfig = {
      ...greenieConfig(),
      modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single', carryover: true } }],
    };
    const v = validateResolvedConfig(cfg);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe('unsupported_net_skins_variant:carryover');
  });

  it('enabled modifier with a NON-OBJECT variant → invalid_variant_shape (fail closed, not read as absent)', () => {
    for (const bad of ['oops', true, null, [1]] as unknown[]) {
      const cfg: GameConfig = {
        ...greenieConfig(),
        modifiers: [{ type: 'greenie', enabled: true, variant: bad as never }],
      };
      const v = validateResolvedConfig(cfg);
      expect(v.ok).toBe(false);
      expect(v.ok === false && v.reason).toBe('invalid_variant_shape:greenie');
    }
  });

  it('DISABLED greenie with a stray variant key stays inert (variant unconstrained)', () => {
    const cfg: GameConfig = {
      ...greenieConfig(),
      modifiers: [{ type: 'greenie', enabled: false, variant: { basis: 'gross' } }],
    };
    expect(validateResolvedConfig(cfg).ok).toBe(true);
  });
});
