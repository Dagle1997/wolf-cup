import { describe, it, expect } from 'vitest';
import { poliePoints, polieActive, polieBogeyOrBetter } from './polie.js';
import { computeFoursome } from '../compute-foursome.js';
import { ledgerToEdges } from '../ledger-to-edges.js';
import { validateResolvedConfig } from '../registry.js';
import type { GameConfig, HoleState, Modifier, TeamSplit } from '../types.js';

const teamA = ['a1', 'a2'] as const;
const teamB = ['b1', 'b2'] as const;
const teamSplit: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const MEMBERS = ['a1', 'a2', 'b1', 'b2'] as const;

function polieConfig(
  opts: { enabled?: boolean; gate?: boolean; schedule?: GameConfig['pointValueSchedule'] } = {},
): GameConfig {
  const { enabled = true, gate = false, schedule } = opts;
  const modifiers: Modifier[] = enabled
    ? [{ type: 'polie', enabled: true, variant: { polieBogeyOrBetter: gate } }]
    : [];
  return {
    game: 'guyan-2v2',
    pointValueSchedule: schedule ?? { kind: 'flat', cents: 500 },
    modifiers,
    lockState: 'locked',
    configVersion: 1,
  };
}

function hole(
  holeNumber: number,
  par: number,
  opts: {
    polies?: ReadonlyArray<string>;
    gross?: Record<string, number>;
    incomplete?: boolean;
    extraClaims?: Record<string, { polie?: boolean }>;
  } = {},
): HoleState {
  const net: Record<string, number> = {};
  for (const p of MEMBERS) net[p] = par;
  if (opts.incomplete) delete net['b2'];
  const claims: Record<string, { polie?: boolean }> = { ...(opts.extraClaims ?? {}) };
  for (const p of opts.polies ?? []) claims[p] = { ...(claims[p] ?? {}), polie: true };
  const h: HoleState = { holeNumber, par, net, claims };
  if (opts.gross !== undefined) h.gross = opts.gross;
  return h;
}

describe('polie helpers', () => {
  it('polieActive: present+enabled true; absent/disabled false', () => {
    expect(polieActive(polieConfig())).toBe(true);
    expect(polieActive(polieConfig({ enabled: false }))).toBe(false);
  });
  it('polieBogeyOrBetter: defaults false when variant absent', () => {
    const cfg: GameConfig = { ...polieConfig(), modifiers: [{ type: 'polie', enabled: true }] };
    expect(polieBogeyOrBetter(cfg)).toBe(false);
    expect(polieBogeyOrBetter(polieConfig({ gate: true }))).toBe(true);
  });
});

describe('polie count model (gate off)', () => {
  const cfg = polieConfig();
  it('one A box → +1', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1'] }), teamA, teamB, cfg)).toBe(1);
  });
  it('both A boxes → +2', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1', 'a2'] }), teamA, teamB, cfg)).toBe(2);
  });
  it('one A + one B → 0 (contested)', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1', 'b1'] }), teamA, teamB, cfg)).toBe(0);
  });
  it('all four → 0 (each worth 1 point, nets out)', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1', 'a2', 'b1', 'b2'] }), teamA, teamB, cfg)).toBe(0);
  });
  it('counts on a par-4 AND a par-5 (NOT par-3 restricted)', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1'] }), teamA, teamB, cfg)).toBe(1);
    expect(poliePoints(hole(2, 5, { polies: ['b1'] }), teamA, teamB, cfg)).toBe(-1);
  });
  it('foreign claim key (not in foursome) ignored', () => {
    const h = hole(1, 4, { polies: ['a1'], extraClaims: { zzz: { polie: true } } });
    expect(poliePoints(h, teamA, teamB, cfg)).toBe(1); // zzz not counted
    const onlyForeign = hole(1, 4, { extraClaims: { zzz: { polie: true } } });
    expect(poliePoints(onlyForeign, teamA, teamB, cfg)).toBe(0);
  });
});

describe('polie gross bogey-or-better gate', () => {
  const gateOn = polieConfig({ gate: true });
  it('gross = par+1 (bogey) → eligible (+1)', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1'], gross: { a1: 5 } }), teamA, teamB, gateOn)).toBe(1);
  });
  it('gross = par+2 (double) → voided (0)', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1'], gross: { a1: 6 } }), teamA, teamB, gateOn)).toBe(0);
  });
  it('absent gross under the gate → voided (fail-closed, 0)', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1'], gross: {} }), teamA, teamB, gateOn)).toBe(0);
    expect(poliePoints(hole(1, 4, { polies: ['a1'] }), teamA, teamB, gateOn)).toBe(0);
  });
  it('non-finite gross (null/NaN/string) → voided, NEVER coerced (null <= par+1 is true in JS!)', () => {
    for (const bad of [null, NaN, '4', undefined] as unknown[]) {
      const h = hole(1, 4, { polies: ['a1'], gross: { a1: bad as number } });
      expect(poliePoints(h, teamA, teamB, gateOn)).toBe(0);
    }
  });
  it('gate OFF → gross ignored (a worse-than-bogey polie still counts)', () => {
    const gateOff = polieConfig({ gate: false });
    expect(poliePoints(hole(1, 4, { polies: ['a1'], gross: { a1: 9 } }), teamA, teamB, gateOff)).toBe(1);
  });
});

describe('polie via computeFoursome — wiring + valuation + inert', () => {
  it('incomplete hole (one member net missing) contributes 0', () => {
    const h = hole(1, 4, { polies: ['a1'], incomplete: true });
    const ledger = computeFoursome(polieConfig(), { teamSplit, holes: [h] });
    expect(ledger.totalCents).toBe(0);
  });
  it('all-push (base 0, no polie) → empty edges', () => {
    const h = hole(1, 4, {});
    const ledger = computeFoursome(polieConfig(), { teamSplit, holes: [h] });
    expect(ledger.totalCents).toBe(0);
    expect(ledgerToEdges(ledger, teamSplit, { sourceId: 's' })).toEqual([]);
  });
  it('valued at the COLLECTING hole PV (segmented front/back): a back-nine polie uses the back PV', () => {
    const cfg = polieConfig({ schedule: { kind: 'front-back', frontCents: 500, backCents: 1000 } });
    // Single back-nine polie (hole 12): +1 valued at back PV (1000) → a1 = 2*(1000/2) = 1000.
    const ledger = computeFoursome(cfg, { teamSplit, holes: [hole(12, 4, { polies: ['a1'] })] });
    expect(ledger.perPlayerCents).toEqual({ a1: 1000, a2: 1000, b1: -1000, b2: -1000 });
  });
  it('polie inactive (absent/disabled) → boxes inert (0 money)', () => {
    const ledger = computeFoursome(polieConfig({ enabled: false }), {
      teamSplit,
      holes: [hole(1, 4, { polies: ['a1', 'a2'] })],
    });
    expect(ledger.totalCents).toBe(0);
  });
});

describe('polie fail-closed variant allowlist (AC10, FR44)', () => {
  function reasonFor(modifiers: Modifier[]): string | true {
    const v = validateResolvedConfig({ ...polieConfig(), modifiers });
    return v.ok ? true : v.reason;
  }
  it('enabled polie with basis → unsupported_polie_variant:basis=', () => {
    expect(reasonFor([{ type: 'polie', enabled: true, variant: { basis: 'net' } }])).toMatch(
      /^unsupported_polie_variant:basis=/,
    );
  });
  it('enabled polie with bonus → unsupported_polie_variant:bonus=', () => {
    expect(reasonFor([{ type: 'polie', enabled: true, variant: { bonus: 'double' } }])).toMatch(
      /^unsupported_polie_variant:bonus=/,
    );
  });
  it('enabled polie with carryover → unsupported_polie_variant:carryover', () => {
    expect(reasonFor([{ type: 'polie', enabled: true, variant: { carryover: true } }])).toBe(
      'unsupported_polie_variant:carryover',
    );
  });
  it('non-boolean polieBogeyOrBetter → unsupported_polie_variant:polieBogeyOrBetter_type', () => {
    expect(
      reasonFor([{ type: 'polie', enabled: true, variant: { polieBogeyOrBetter: 'yes' as unknown as boolean } }]),
    ).toBe('unsupported_polie_variant:polieBogeyOrBetter_type');
  });
  it('enabled greenie with polieBogeyOrBetter → unsupported_greenie_variant:polieBogeyOrBetter', () => {
    expect(
      reasonFor([
        { type: 'polie', enabled: true, variant: { polieBogeyOrBetter: false } },
        { type: 'greenie', enabled: true, variant: { polieBogeyOrBetter: true } },
      ]),
    ).toBe('unsupported_greenie_variant:polieBogeyOrBetter');
  });
  it('enabled net-skins with polieBogeyOrBetter → unsupported_net_skins_variant:polieBogeyOrBetter', () => {
    expect(
      reasonFor([
        { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single', polieBogeyOrBetter: true } },
      ]),
    ).toBe('unsupported_net_skins_variant:polieBogeyOrBetter');
  });
  it('valid enabled polie (polieBogeyOrBetter true/false/absent) passes', () => {
    expect(reasonFor([{ type: 'polie', enabled: true, variant: { polieBogeyOrBetter: true } }])).toBe(true);
    expect(reasonFor([{ type: 'polie', enabled: true }])).toBe(true);
  });
});
