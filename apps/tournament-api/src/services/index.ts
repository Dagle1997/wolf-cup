/**
 * Tournament-api services layer barrel.
 *
 * **Convention (per architecture D1-1 Services Layer Pattern):** modules
 * exported here are PRIMARILY read-only query services. They generally
 * do not write to the DB — routes call services to compute response
 * payloads; transaction helpers (audit, activity emit) live in `lib/`
 * and take `tx` as their first parameter.
 *
 * **Single mutating exception (T5-8): `transitionState` from
 * `round-state.ts`.** Domain-side-effect-isolating functions where the
 * mutation IS the domain semantic (e.g., FSM transitions) are allowed
 * here. The line is: orphan side-effects without a domain reason are
 * NOT allowed; encapsulating the legal-transition matrix + race-safe
 * UPDATE + audit-row write into a single function IS the domain reason.
 *
 * Established by T5-5 with `leaderboard.ts` + `handicap.ts`; extended
 * by T5-8 with `round-state.ts`. Future services (T6 money matrix, T6
 * sub-games dispatcher) append here.
 */

export {
  calcCourseHandicap,
  allocateNetThroughHole,
  type CourseHandicapInput,
  type NetAllocationInput,
} from './handicap.js';

export {
  computeLeaderboard,
  type LeaderboardRow,
  type LeaderboardCtx,
  type LeaderboardOpts,
} from './leaderboard.js';

export {
  transitionState,
  getRoundState,
  isEventOrganizer,
  isEventOrganizerByEventId,
  computeExpectedCells,
  computeMissingCells,
  getRoundContext,
  BusinessRuleError,
  type RoundState,
} from './round-state.js';

export {
  runPressOrchestrator,
  type RunPressOrchestratorInput,
} from './press-orchestrator.js';

export {
  computeMoneyMatrix,
  type MoneyMatrix,
} from './money.js';

export {
  computeSubGame,
  computeSubGamesForRound,
  aggregateSkinsForEvent,
} from './sub-games.js';
