import { describe, it, expect } from 'vitest';
import { poliePoints, polieActive } from './polie.js';
import { computeFoursome } from '../compute-foursome.js';
import { ledgerToEdges } from '../ledger-to-edges.js';
import { validateResolvedConfig } from '../registry.js';
import type { GameConfig, HoleState, Modifier, TeamSplit } from '../types.js';

const teamA = ['a1', 'a2'] as const;
const teamB = ['b1', 'b2'] as const;
const teamSplit: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const MEMBERS = ['a1', 'a2', 'b1', 'b2'] as const;

function polieConfig(
  opts: { enabled?: boolean; schedule?: GameConfig['pointValueSchedule'] } = {},
): GameConfig {
  const { enabled = true, schedule } = opts;
  return {
    game: 'guyan-2v2',
    pointValueSchedule: schedule ?? { kind: 'flat', cents: 500 },
    modifiers: enabled ? [{ type: 'polie', enabled: true }] : [],
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
  it('polieActive: present+enabled true; absent false', () => {
    expect(polieActive(polieConfig())).toBe(true);
    expect(polieActive(polieConfig({ enabled: false }))).toBe(false);
  });
  it('polieActive: present-but-DISABLED → false; poliePoints 0', () => {
    const cfg: GameConfig = { ...polieConfig(), modifiers: [{ type: 'polie', enabled: false }] };
    expect(polieActive(cfg)).toBe(false);
    expect(poliePoints(hole(1, 4, { polies: ['a1', 'a2'] }), teamA, teamB, cfg)).toBe(0);
  });
});

describe('polie count model (no gate — always counts when checked)', () => {
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
  it('all four → 0 (2 vs 2 nets out)', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1', 'a2', 'b1', 'b2'] }), teamA, teamB, cfg)).toBe(0);
  });
  it('B-team sign-symmetric (−1, −2)', () => {
    expect(poliePoints(hole(1, 4, { polies: ['b1'] }), teamA, teamB, cfg)).toBe(-1);
    expect(poliePoints(hole(1, 4, { polies: ['b1', 'b2'] }), teamA, teamB, cfg)).toBe(-2);
  });
  it('counts on any hole (par 3 / 4 / 5)', () => {
    expect(poliePoints(hole(1, 3, { polies: ['a1'] }), teamA, teamB, cfg)).toBe(1);
    expect(poliePoints(hole(2, 5, { polies: ['a1'] }), teamA, teamB, cfg)).toBe(1);
  });
  it('foreign claim key (not in foursome) ignored', () => {
    const h = hole(1, 4, { polies: ['a1'], extraClaims: { zzz: { polie: true } } });
    expect(poliePoints(h, teamA, teamB, cfg)).toBe(1);
    const onlyForeign = hole(1, 4, { extraClaims: { zzz: { polie: true } } });
    expect(poliePoints(onlyForeign, teamA, teamB, cfg)).toBe(0);
  });
  it('inactive (absent/disabled) → 0 (self-guard)', () => {
    expect(poliePoints(hole(1, 4, { polies: ['a1', 'a2'] }), teamA, teamB, polieConfig({ enabled: false }))).toBe(0);
  });
});

describe('polie ignores gross (Story 2.4a — the bogey-or-better gate was removed)', () => {
  it('a polie by a player who scored DOUBLE-bogey gross still COUNTS (no eligibility gate)', () => {
    // par 4, b1 gross 6 (double bogey). The 2.3 gate VOIDED this; now it counts.
    const h = hole(3, 4, { polies: ['b1'], gross: { a1: 4, a2: 4, b1: 6, b2: 4 } });
    expect(poliePoints(h, teamA, teamB, polieConfig())).toBe(-1);
  });
  it('non-finite gross is irrelevant now (polie does not read gross)', () => {
    const h = hole(1, 4, { polies: ['a1'], gross: { a1: null as unknown as number } });
    expect(poliePoints(h, teamA, teamB, polieConfig())).toBe(1);
  });
});

describe('polie via computeFoursome — wiring + valuation', () => {
  it('incomplete hole (one member net missing) contributes 0', () => {
    const ledger = computeFoursome(polieConfig(), { teamSplit, holes: [hole(1, 4, { polies: ['a1'], incomplete: true })] });
    expect(ledger.totalCents).toBe(0);
  });
  it('all-push (base 0, no polie) → empty edges', () => {
    const ledger = computeFoursome(polieConfig(), { teamSplit, holes: [hole(1, 4, {})] });
    expect(ledger.totalCents).toBe(0);
    expect(ledgerToEdges(ledger, teamSplit, { sourceId: 's' })).toEqual([]);
  });
  it('valued at the COLLECTING hole PV (segmented front/back): a back-nine polie uses the back PV', () => {
    const cfg = polieConfig({ schedule: { kind: 'front-back', frontCents: 500, backCents: 1000 } });
    const ledger = computeFoursome(cfg, { teamSplit, holes: [hole(12, 4, { polies: ['a1'] })] });
    expect(ledger.perPlayerCents).toEqual({ a1: 1000, a2: 1000, b1: -1000, b2: -1000 });
  });
  it('inactive → boxes inert (0 money)', () => {
    const ledger = computeFoursome(polieConfig({ enabled: false }), { teamSplit, holes: [hole(1, 4, { polies: ['a1', 'a2'] })] });
    expect(ledger.totalCents).toBe(0);
  });
});

describe('polie fail-closed — no variant lever (Story 2.4a)', () => {
  function reasonFor(modifiers: Modifier[]): string | true {
    const v = validateResolvedConfig({ ...polieConfig(), modifiers });
    return v.ok ? true : v.reason;
  }
  it('enabled polie with basis → unsupported_polie_variant:basis', () => {
    expect(reasonFor([{ type: 'polie', enabled: true, variant: { basis: 'net' } }])).toBe('unsupported_polie_variant:basis');
  });
  it('enabled polie with carryover → unsupported_polie_variant:carryover', () => {
    expect(reasonFor([{ type: 'polie', enabled: true, variant: { carryover: true } }])).toBe('unsupported_polie_variant:carryover');
  });
  it('enabled polie with an UNKNOWN key → unsupported_polie_variant:<key> (truly fail-closed)', () => {
    expect(reasonFor([{ type: 'polie', enabled: true, variant: { foo: 1 } } as unknown as Modifier])).toBe('unsupported_polie_variant:foo');
  });
  it('valid enabled polie: no variant OR empty variant:{} passes', () => {
    expect(reasonFor([{ type: 'polie', enabled: true }])).toBe(true);
    expect(reasonFor([{ type: 'polie', enabled: true, variant: {} }])).toBe(true);
  });
  it('DISABLED polie with a stray variant stays inert', () => {
    expect(reasonFor([{ type: 'polie', enabled: false, variant: { basis: 'gross' } }])).toBe(true);
  });
});
