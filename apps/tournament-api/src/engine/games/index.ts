/**
 * F1 games engine — public surface (Story 1.1). Story 1.4 consumes this barrel
 * from the services layer (services/games-money.ts).
 */
export type {
  PointValueSchedule,
  ModifierVariant,
  Modifier,
  GameConfig,
  TeamSplit,
  HoleState,
  FoursomeInput,
  Ledger,
  SettlementEdge,
} from './types.js';

export { computeFoursome } from './compute-foursome.js';
export { ledgerToEdges } from './ledger-to-edges.js';
export { resolveConfig } from './resolver.js';
export type { ConfigLevel, LeveledConfigRow, ResolveResult } from './resolver.js';
export {
  ENGINE_CONFIG_VERSION,
  registerModifier,
  hasModifier,
  registeredModifierTypes,
  validateResolvedConfig,
} from './registry.js';
export type { Validation } from './registry.js';
export { holeNetPointsA, pointValueCents, netSkinsActive } from './games/guyan-2v2.js';
export { netLevel, netSkinsPoints } from './modifiers/net-skins.js';
