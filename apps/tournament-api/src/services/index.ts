/**
 * Tournament-api services layer barrel.
 *
 * **Convention (per architecture D1-1 Services Layer Pattern):** modules
 * exported here are READ-ONLY query services. They never write to the DB.
 * Routes call services to compute response payloads; transaction helpers
 * (audit, activity emit) live in `lib/` and take `tx` as their first
 * parameter.
 *
 * Established by T5-5 with `leaderboard.ts` + `handicap.ts`. Future
 * services (T6 money matrix, T6 sub-games dispatcher) append here.
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
