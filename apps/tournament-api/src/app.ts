import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { env } from './lib/env.js';
import { adminCoursesRouter } from './routes/admin-courses.js';
import { adminCoursesGhinRouter } from './routes/admin-courses-ghin.js';
import { adminEventHandicapsRouter } from './routes/admin-event-handicaps.js';
import { adminEventBetsRouter } from './routes/admin-event-bets.js';
import { adminEventRoundsRouter } from './routes/admin-event-rounds.js';
import { adminEventsRouter } from './routes/admin-events.js';
import { adminGroupsRouter } from './routes/admin-groups.js';
import { adminRuleSetsRouter } from './routes/admin-rule-sets.js';
import { pdfScheduleRouter } from './routes/pdf-schedule.js';
import { authRouter } from './routes/auth.js';
import { coursesRouter } from './routes/courses.js';
import { inviteRouter } from './routes/invites.js';
import { joinRouter, adminJoinCodesRouter } from './routes/join.js';
import { playersRouter } from './routes/players.js';
import { scoresRouter, eventRoundsCourseRouter } from './routes/scores.js';
import { eventsLeaderboardRouter } from './routes/events-leaderboard.js';
import { scorerAssignmentsRouter } from './routes/scorer-assignments.js';
import { roundLifecycleRouter } from './routes/round-lifecycle.js';
import { scoreCorrectionsRouter } from './routes/score-corrections.js';
import { eventRuleEditsRouter } from './routes/event-rule-edits.js';
import { betsRouter } from './routes/bets.js';
import { moneyRouter } from './routes/money.js';
import { eventsRouter } from './routes/events.js';
import { scheduleRouter } from './routes/schedule.js';
import { coursePreviewRouter } from './routes/course-preview.js';
import { pressesRouter } from './routes/presses.js';
import { subGamesComputeRouter } from './routes/sub-games.js';
import { galleryRouter } from './routes/gallery.js';
import { exportRouter } from './routes/export.js';
import { installPromptRouter } from './routes/install-prompt.js';
import { activityRouter } from './routes/activity.js';
import { requestIdMiddleware } from './middleware/request-id.js';

const STARTUP_TIME = Date.now();

const app = new Hono();

// Request-id middleware (T1-7) mounts FIRST so every downstream middleware
// — including CSRF below, auth, and route handlers — can read
// `c.get('requestId')` and `c.get('logger')`. The child logger emits
// `requestId` on every log line without per-call-site threading.
app.use('*', requestIdMiddleware);

// CSRF protection. `new URL(...).origin` normalizes to `scheme://host[:port]`
// with no path or trailing slash — avoids a class of origin-matching bugs
// where trailing slashes, path components, or port mismatches cause
// legitimate requests to be rejected. Hono's csrf only applies to unsafe
// methods (POST/PUT/PATCH/DELETE), so GET /api/health is unaffected.
const origin = new URL(env.PUBLIC_APP_URL).origin;
app.use('*', csrf({ origin }));

app.get('/api/health', (c) =>
  c.json({ status: 'ok', startupTime: STARTUP_TIME }),
);

// Version probe for the web "new version — refresh" banner. `version` is the
// process startup time: a redeploy restarts the process → the value changes →
// clients polling this notice and prompt a refresh (mirrors Wolf Cup).
app.get('/api/version', (c) => c.json({ version: STARTUP_TIME }));

// Auth router (T1-6b). Mounted at /api/auth so routes appear at
// /api/auth/status, /api/auth/google, /api/auth/google/callback.
app.route('/api/auth', authRouter);

// Courses router (T2-2). Single route: GET /api/courses.
app.route('/api/courses', coursesRouter);

// Admin-courses router (T2-3). POST /api/admin/courses/parse-pdf —
// organizer-gated scorecard-PDF → Anthropic Vision → structured JSON.
app.route('/api/admin', adminCoursesRouter);

// GHIN course-import router. GET /api/admin/courses/ghin/search + /:id —
// organizer-gated read-only discovery + mapping to the save-request shape.
app.route('/api/admin', adminCoursesGhinRouter);

// Handicap-lock router. GET/POST /api/admin/events/:eventId/handicaps[...] —
// organizer-gated lock of each roster player's HI as of a cutoff date.
app.route('/api/admin', adminEventHandicapsRouter);

// "The Action" admin betting router. GET/POST /api/admin/events/:eventId/bets —
// organizer-gated create + list of action bets (Story 1.1: h2h-net). Distinct
// path from the legacy individual_bets POST /api/events/:eventId/bets.
app.route('/api/admin', adminEventBetsRouter);

// Admin-events router (T3-2). POST /api/admin/events — organizer-gated
// transactional create across events + event_rounds + invites + groups.
// Mounted alongside adminCoursesRouter under /api/admin; each defines its
// own subroutes so they don't conflict.
app.route('/api/admin', adminEventsRouter);

// Players router (T3-4). GHIN proxy endpoints (search + lookup). Both
// gated by requireSession only — any authenticated player may use them.
// Returns 503 service_unavailable when GHIN credentials are unset.
app.route('/api/players', playersRouter);

// Admin-groups router (T3-3). 4 endpoints under /api/admin/groups/...
// Mounted under /api/admin matching adminCoursesRouter + adminEventsRouter
// (each defines its own subroutes; they coexist without path conflict).
app.route('/api/admin', adminGroupsRouter);

// Admin-rule-sets router (T3-5). 3 endpoints under /api/admin/rule-sets/...
// 4th /api/admin mount; per T3-3 party Winston note, promote umbrella
// adminRouter at ~5 mounts. T3-5 holds the existing pattern.
app.route('/api/admin', adminRuleSetsRouter);

// Admin-event-rounds router (T3-9). 2 endpoints under
// /api/admin/event-rounds/:eventRoundId/sub-games (GET + POST).
// 5th /api/admin mount — Winston's threshold case. T3-9 holds the
// existing pattern; umbrella adminRouter promotion is a future story.
app.route('/api/admin', adminEventRoundsRouter);

// Invites router (T3-6). 2 anonymous-friendly endpoints under
// /api/invites/... — first-arrival flow per FR-E1; no SSO triggered.
app.route('/api/invites', inviteRouter);

// B0 join-via-code. POST /api/join (public, claim by per-player code →
// device binding, no Google) + GET /api/admin/events/:id/join-codes
// (organizer, list/generate codes).
app.route('/api/join', joinRouter);
app.route('/api/admin', adminJoinCodesRouter);

// PDF schedule export router (T4-3). 1 endpoint:
// GET /api/events/:eventId/pdf/schedule/:token. Token-gated via T3-8
// requireInviteToken middleware (any participant; FR-H4 trip-day fallback).
app.route('/api/events', pdfScheduleRouter);

// Scores router (T5-6). 1 endpoint:
// POST /api/rounds/:roundId/holes/:holeNumber/scores. Single-writer
// enforcement via require-scorer-for-round middleware (FR-B10, FR-H3).
app.route('/api/rounds', scoresRouter);

// T5-4 course endpoint mounted at /api/events (uses eventId in path so
// requireEventParticipant can read it). Effective URL:
// GET /api/events/:eventId/rounds/:roundId/course.
app.route('/api/events', eventRoundsCourseRouter);

// T5-5 cross-group stroke-play leaderboard. Effective URL:
// GET /api/events/:eventId/leaderboard?round=<roundId | 'current' | omitted>.
// Gated by requireSession + requireEventParticipant; recomputes on read
// per architecture D1-1 (no cache v1).
app.route('/api/events', eventsLeaderboardRouter);

// T5-7 scorer-handoff endpoint. Effective URL:
// POST /api/rounds/:roundId/scorer-assignments/transfer.
// Authorization: per-event organizer OR current scorer of the foursome
// (handler-internal; auth re-check is in-tx for TOCTOU safety).
app.route('/api/rounds', scorerAssignmentsRouter);

// T5-8 round-lifecycle endpoints. Effective URLs:
// POST /api/rounds/:roundId/complete            (organizer OR any-foursome scorer)
// POST /api/rounds/:roundId/complete-rollback   (organizer OR any-foursome scorer)
// POST /api/rounds/:roundId/finalize            (per-event organizer only)
// POST /api/rounds/:roundId/cancel              (per-event organizer only)
// All transitions go through services/round-state.ts (single FSM).
app.route('/api/rounds', roundLifecycleRouter);

// T5-9 score-corrections endpoints. Effective URLs:
// POST /api/rounds/:roundId/scores/:playerId/:holeNumber/correct
//      (per-event organizer OR scorer of target player's foursome)
// GET  /api/rounds/:roundId/score-corrections
//      (per-event organizer OR scorer of any foursome of this round)
// Allowed states: in_progress, complete_editable, finalized.
// T6 money recompute deferred to followup T5-9a (post-commit breadcrumb only).
app.route('/api/rounds', scoreCorrectionsRouter);

// T5-11 event-scoped rule-set revision endpoint. Effective URL:
// POST /api/events/:eventId/rule-sets/:ruleSetId/revisions
// Authorization: per-event organizer ONLY (events.organizer_player_id).
// Effective-hole-aware boundary (1..18 = mid-round; 19 = next-round-onward).
// Frozen-round freeze guard rejects edits whose window includes any
// finalized round (422 rule_edit_would_recompute_finalized_round).
// T6 money recompute deferred to followup T5-11a (post-commit breadcrumb only).
app.route('/api/events', eventRuleEditsRouter);

// T6-3 cross-foursome individual bets endpoint. Effective URL:
// POST /api/events/:eventId/bets
// Authorization: requireSession + requireEventParticipant (any event member).
// Validates self-bet, duplicate roundIds, both players in event, applicable
// rounds belong to event, config shape per betType, UNIQUE on (event, A, B,
// type) for canonical alphabetical ordering. Audit + activity emit in-tx.
app.route('/api/events', betsRouter);

// T6-5 head-to-head money matrix endpoint. Effective URL:
// GET /api/events/:eventId/money
// Authorization: requireSession + requireEventParticipant.
// Aggregates 2v2 best ball + active individual bets across all rounds.
// Press multipliers + skins deferred (Followup T6-5f / T6-5a). Read-only;
// no audit, no activity, no cache. cache-control: no-store.
app.route('/api/events', moneyRouter);

// T7-1 event-detail endpoint for the Event home page.
// GET /api/events/:eventId → { event: {...}, rounds: [...] }.
// Read-only; cache-control: no-store. Auth: requireSession +
// requireEventParticipant (no-existence-leak via 403 from middleware).
app.route('/api/events', eventsRouter);

// T7-2 schedule view endpoint. Effective URL:
//   GET /api/events/:eventId/schedule
// Returns rounds + course + viewer's-foursome pairing (3-state). Read-only;
// cache-control: no-store. Auth: requireSession + requireEventParticipant.
app.route('/api/events', scheduleRouter);

// T7-3 course preview endpoint.
//   GET /api/events/:eventId/courses/:courseId
// Returns course + pinned revision + tees + holes + defaultTeeColor.
// Read-only; cache-control: no-store. Auth: requireSession +
// requireEventParticipant + course-must-be-referenced-by-event-rounds
// (uniform 403 for course-not-in-event / unknown / malformed).
app.route('/api/events', coursePreviewRouter);

// T6-7 manual press routes. Effective URLs:
// POST   /api/rounds/:roundId/presses        (file a manual press)
// DELETE /api/rounds/:roundId/presses/:pressId (undo within window)
// Authorization: requireSession + scorer-of-this-round (handler-internal).
// Server-derived fromHole = max-complete-hole + 1; UNIQUE on
// (round_id, team, fired_at_hole, trigger_type) prevents duplicate fires.
app.route('/api/rounds', pressesRouter);

// T6-13 sub-game compute route. Effective URL:
// POST /api/rounds/:roundId/sub-games/:subGameId/compute
// Authorization: requireSession + handler-internal event-participant check.
// Dispatches by sub_games.type: 'skins' → calcSkins (T6-11) + persist;
// 'ctp' | 'sandies' | 'putting_contest' → 501 stub. Append-only writes
// to sub_game_results — score-correction recomputes preserve history.
app.route('/api/rounds', subGamesComputeRouter);

// T7-4 photo gallery routes. Effective URLs:
//   POST   /api/events/:eventId/gallery
//   GET    /api/events/:eventId/gallery
//   DELETE /api/events/:eventId/gallery/:photoId
// Auth: requireSession + requireEventParticipant (+ requireOrganizer on DELETE).
// Bucket strategy per arch D5-10 — same R2 bucket as Wolf Cup, key prefix
// `tournament/events/{eventId}/`. Reads return presigned GETs (1h TTL).
app.route('/api/events', galleryRouter);

// T7-5 raw-state JSON export (organizer-only). Effective URL:
//   GET /api/events/:eventId/export/raw
// Auth: requireSession + requireOrganizer (NO requireEventParticipant — an
// organizer running an event they're not playing in still gets the export).
// Returns Content-Type: application/json + Content-Disposition: attachment.
// Single-shot JSON.stringify; streaming deferred to followup T7-5c.
app.route('/api/events', exportRouter);

// T7-6 PWA install-prompt one-shot. Effective URL:
//   POST /api/events/:eventId/devices/me/install-prompt-shown
// Auth: requireSession only (NOT requireEventParticipant — :eventId is
// audit-payload-only). Atomic conditional UPDATE inside a tx so concurrent
// POSTs cannot produce duplicate audit rows. Returns 204 / 404 / 401 / 400.
app.route('/api/events', installPromptRouter);

// T8-2 activity feed: GET /api/events/:eventId/activity with cursor
// pagination (?after / ?before / neither). Auth: requireSession +
// requireEventParticipant. Read-side companion to T8-1's emitter.
app.route('/api/events', activityRouter);

export { app };
