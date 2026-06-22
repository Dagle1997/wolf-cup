import { describe, it, expect } from 'vitest';
import { sandiePoints, sandieActive } from './sandie.js';
import { computeFoursome } from '../compute-foursome.js';
import { ledgerToEdges } from '../ledger-to-edges.js';
import { validateResolvedConfig } from '../registry.js';
import type { GameConfig, HoleState, Modifier, TeamSplit } from '../types.js';

const teamA = ['a1', 'a2'] as const;
const teamB = ['b1', 'b2'] as const;
const teamSplit: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const MEMBERS = ['a1', 'a2', 'b1', 'b2'] as const;

function sandieConfig(
  opts: { enabled?: boolean; schedule?: GameConfig['pointValueSchedule'] } = {},
): GameConfig {
  const { enabled = true, schedule } = opts;
  return {
    game: 'guyan-2v2',
    pointValueSchedule: schedule ?? { kind: 'flat', cents: 500 },
    modifiers: enabled ? [{ type: 'sandie', enabled: true }] : [],
    lockState: 'locked',
    configVersion: 1,
  };
}

function hole(
  holeNumber: number,
  par: number,
  opts: { sandies?: ReadonlyArray<string>; incomplete?: boolean; extraClaims?: Record<string, { sandie?: boolean }> } = {},
): HoleState {
  const net: Record<string, number> = {};
  for (const p of MEMBERS) net[p] = par;
  if (opts.incomplete) delete net['b2'];
  const claims: Record<string, { sandie?: boolean }> = { ...(opts.extraClaims ?? {}) };
  for (const p of opts.sandies ?? []) claims[p] = { ...(claims[p] ?? {}), sandie: true };
  return { holeNumber, par, net, claims };
}

describe('sandie helpers', () => {
  it('sandieActive: present+enabled true; absent false', () => {
    expect(sandieActive(sandieConfig())).toBe(true);
    expect(sandieActive(sandieConfig({ enabled: false }))).toBe(false); // absent (modifiers: [])
  });
  it('sandieActive: present-but-DISABLED → false; sandiePoints 0 (active/inactive boundary)', () => {
    const cfg: GameConfig = { ...sandieConfig(), modifiers: [{ type: 'sandie', enabled: false }] };
    expect(sandieActive(cfg)).toBe(false);
    expect(sandiePoints(hole(1, 4, { sandies: ['a1', 'a2'] }), teamA, teamB, cfg)).toBe(0);
  });
});

describe('sandie count model (no gate — always counts when checked)', () => {
  const cfg = sandieConfig();
  it('one A box → +1', () => {
    expect(sandiePoints(hole(1, 4, { sandies: ['a1'] }), teamA, teamB, cfg)).toBe(1);
  });
  it('both A boxes → +2 (a team gets 2 when the other has 0)', () => {
    expect(sandiePoints(hole(1, 4, { sandies: ['a1', 'a2'] }), teamA, teamB, cfg)).toBe(2);
  });
  it('one A + one B → 0 (contested)', () => {
    expect(sandiePoints(hole(1, 4, { sandies: ['a1', 'b1'] }), teamA, teamB, cfg)).toBe(0);
  });
  it('all four → 0 (2 vs 2 nets out)', () => {
    expect(sandiePoints(hole(1, 4, { sandies: ['a1', 'a2', 'b1', 'b2'] }), teamA, teamB, cfg)).toBe(0);
  });
  it('B-team sign-symmetric (−1, −2)', () => {
    expect(sandiePoints(hole(1, 4, { sandies: ['b1'] }), teamA, teamB, cfg)).toBe(-1);
    expect(sandiePoints(hole(1, 4, { sandies: ['b1', 'b2'] }), teamA, teamB, cfg)).toBe(-2);
  });
  it('counts on any hole (par 3 / 4 / 5)', () => {
    expect(sandiePoints(hole(1, 3, { sandies: ['a1'] }), teamA, teamB, cfg)).toBe(1);
    expect(sandiePoints(hole(2, 5, { sandies: ['a1'] }), teamA, teamB, cfg)).toBe(1);
  });
  it('foreign claim key (not in foursome) ignored', () => {
    const h = hole(1, 4, { sandies: ['a1'], extraClaims: { zzz: { sandie: true } } });
    expect(sandiePoints(h, teamA, teamB, cfg)).toBe(1);
    const onlyForeign = hole(1, 4, { extraClaims: { zzz: { sandie: true } } });
    expect(sandiePoints(onlyForeign, teamA, teamB, cfg)).toBe(0);
  });
  it('inactive (absent/disabled) → 0 (self-guard)', () => {
    expect(sandiePoints(hole(1, 4, { sandies: ['a1', 'a2'] }), teamA, teamB, sandieConfig({ enabled: false }))).toBe(0);
  });
});

describe('sandie via computeFoursome — wiring + valuation', () => {
  it('incomplete hole (one member net missing) contributes 0', () => {
    const ledger = computeFoursome(sandieConfig(), { teamSplit, holes: [hole(1, 4, { sandies: ['a1'], incomplete: true })] });
    expect(ledger.totalCents).toBe(0);
  });
  it('all-push (base 0, no sandie) → empty edges', () => {
    const ledger = computeFoursome(sandieConfig(), { teamSplit, holes: [hole(1, 4, {})] });
    expect(ledger.totalCents).toBe(0);
    expect(ledgerToEdges(ledger, teamSplit, { sourceId: 's' })).toEqual([]);
  });
  it('valued at the COLLECTING hole PV (segmented front/back): a back-nine sandie uses the back PV', () => {
    const cfg = sandieConfig({ schedule: { kind: 'front-back', frontCents: 500, backCents: 1000 } });
    const ledger = computeFoursome(cfg, { teamSplit, holes: [hole(12, 4, { sandies: ['a1'] })] });
    expect(ledger.perPlayerCents).toEqual({ a1: 1000, a2: 1000, b1: -1000, b2: -1000 });
  });
  it('inactive → boxes inert (0 money)', () => {
    const ledger = computeFoursome(sandieConfig({ enabled: false }), { teamSplit, holes: [hole(1, 4, { sandies: ['a1', 'a2'] })] });
    expect(ledger.totalCents).toBe(0);
  });
});

describe('sandie fail-closed — no variant lever (AC10, FR44)', () => {
  function reasonFor(modifiers: Modifier[]): string | true {
    const v = validateResolvedConfig({ ...sandieConfig(), modifiers });
    return v.ok ? true : v.reason;
  }
  it('enabled sandie with basis → unsupported_sandie_variant:basis', () => {
    expect(reasonFor([{ type: 'sandie', enabled: true, variant: { basis: 'net' } }])).toBe('unsupported_sandie_variant:basis');
  });
  it('enabled sandie with carryover → unsupported_sandie_variant:carryover', () => {
    expect(reasonFor([{ type: 'sandie', enabled: true, variant: { carryover: true } }])).toBe('unsupported_sandie_variant:carryover');
  });
  it('enabled sandie with an UNKNOWN key → unsupported_sandie_variant:<key> (truly fail-closed)', () => {
    expect(reasonFor([{ type: 'sandie', enabled: true, variant: { foo: 1 } } as unknown as Modifier])).toBe('unsupported_sandie_variant:foo');
  });
  it('valid enabled sandie: no variant OR empty variant:{} passes', () => {
    expect(reasonFor([{ type: 'sandie', enabled: true }])).toBe(true);
    expect(reasonFor([{ type: 'sandie', enabled: true, variant: {} }])).toBe(true);
  });
  it('DISABLED sandie with a stray variant stays inert', () => {
    expect(reasonFor([{ type: 'sandie', enabled: false, variant: { basis: 'gross' } }])).toBe(true);
  });
});
