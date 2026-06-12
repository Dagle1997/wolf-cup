/* PORTED from apps/web/src/routes/score-entry-hole.tsx @ commit 67238a22a949e37d5d6143ddf46e3804aec57f59, dated 2026-04-26.
 * iOS keyboard synchronous-focus fix from commit ebe3cea (load-bearing — see Save onClick).
 *
 * Tournament deltas vs Wolf Cup:
 *   - Route shape: /rounds/$roundId/score-entry (round-scoped, NOT group-scoped)
 *   - REMOVED wolf-decision UI + state (T6 owns)
 *   - REMOVED greenies/polies/sandies (T6 owns)
 *   - REMOVED CTP per-par-3 prompt (Wolf Cup-only sub-game)
 *   - REMOVED entry-code header (session-cookie auth via T1-6a)
 *   - REMOVED autoCalculateMoney (T6 owns)
 *   - REMOVED putts-week toggle; putts is always-optional input
 *   - CHANGED enqueue payload to T5-3 generic-kind shape with clientEventId
 *   - CHANGED score range 1-9 (Wolf Cup limitation) → 1-20 (T5-6 Zod compat)
 *   - ADDED Skip hole sessionStorage persistence with cleared-on-server-fill
 *   - PRESERVED VERBATIM: synchronous focus on Save onClick BEFORE enqueueMutation;
 *     stable key={member.playerId} on input wrappers so React reuses DOM inputs
 *     across hole advances → iOS keyboard stays open.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingCard } from '../components/loading-card';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  enqueueMutation,
  peekErroredEntries,
  registerTerminalErrors,
  type MutationEntry,
} from '../lib/offline-queue.js';
import { useOfflineQueue } from '../hooks/useOfflineQueue.js';
import { useMarkMutation } from '../hooks/use-first-mutation';
import {
  readCachedRoundCourse,
  readCachedRoundDetail,
  writeCachedRoundCourse,
  writeCachedRoundDetail,
} from '../lib/round-cache.js';
import { useIsInstalledPWA } from '../lib/display-mode';
import { InstallPrompt } from '../components/install-prompt';
import { useAuthSession } from '../hooks/use-auth-session';

// ---- Types ----------------------------------------------------------------

type RoundState =
  | 'not_started'
  | 'in_progress'
  | 'complete_editable'
  | 'finalized'
  | 'cancelled';

interface Member {
  playerId: string;
  name: string;
  handicapIndex: number | null;
}

interface HoleScore {
  holeNumber: number;
  playerId: string;
  grossStrokes: number;
  putts: number | null;
}

interface RoundDetail {
  roundId: string;
  eventId: string | null;
  state: RoundState;
  holesToPlay: 9 | 18;
  myFoursome: {
    foursomeNumber: number;
    isScorer: boolean;
    scorerPlayerId: string | null;
    scorerName: string | null;
    members: Member[]; // sorted by slot_number ASC (load-bearing)
    holeScores: HoleScore[];
  };
}

interface CourseHole {
  holeNumber: number;
  par: number;
  si: number;
  yardagePerTee: Record<string, number>;
}

interface RoundCourse {
  roundId: string;
  courseRevisionId: string;
  course: { name: string; clubName: string };
  holes: CourseHole[];
  tees: Array<{ teeColor: string; rating: number; slope: number }>;
  selectedTeeColor: string;
}

interface ApiError {
  status: number;
  code?: string;
  body?: unknown;
}

function isApiError(err: unknown): err is ApiError {
  return err !== null && typeof err === 'object' && 'status' in err;
}

function courseHash(c: RoundCourse | null | undefined): string {
  if (!c) return '';
  return c.holes
    .map((h) => `${h.holeNumber}:${h.par}:${h.si}`)
    .join('|');
}

// ---- Loader ---------------------------------------------------------------

async function fetchRoundDetail(roundId: string): Promise<RoundDetail> {
  const res = await fetch(`/api/rounds/${roundId}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) {
    let body: { code?: string } | null = null;
    try {
      body = (await res.json()) as { code?: string };
    } catch {
      body = null;
    }
    const err: ApiError = { status: res.status };
    if (body?.code) err.code = body.code;
    throw err;
  }
  return (await res.json()) as RoundDetail;
}

async function fetchRoundCourse(
  eventId: string,
  roundId: string,
): Promise<RoundCourse> {
  const res = await fetch(`/api/events/${eventId}/rounds/${roundId}/course`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) {
    let body: { code?: string } | null = null;
    try {
      body = (await res.json()) as { code?: string };
    } catch {
      body = null;
    }
    const err: ApiError = { status: res.status };
    if (body?.code) err.code = body.code;
    throw err;
  }
  return (await res.json()) as RoundCourse;
}

/**
 * Cache-aside fetch with offline fall-through. Network success → write
 * cache + return fresh. Network failure (TypeError, no .status) → read
 * cache; if hit, return cached; if miss, re-throw network error. ApiError
 * (HTTP 4xx/5xx with .status) propagates without cache fall-through.
 *
 * `onSource` receives 'network' or 'cache' as a side-effect signal so
 * the consumer can render the "Offline mode" chip without polluting the
 * data shape.
 *
 * Per Risk Acceptance §5: navigator.onLine===false short-circuit avoids
 * a 15s loop of futile fetches when the device is known offline.
 */
async function fetchOrCacheRoundDetail(
  roundId: string,
  onSource: (s: 'network' | 'cache') => void,
): Promise<RoundDetail> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const cached = await readCachedRoundDetail<RoundDetail>(roundId);
    if (cached) {
      onSource('cache');
      return cached;
    }
    // Offline + no cache: throw a synthetic network error so the
    // useQuery error branch fires.
    throw new TypeError('Failed to fetch (offline, no cache)');
  }
  try {
    const fresh = await fetchRoundDetail(roundId);
    await writeCachedRoundDetail(roundId, fresh);
    onSource('network');
    return fresh;
  } catch (err) {
    if (isApiError(err)) throw err;
    // Network error: try cache.
    const cached = await readCachedRoundDetail<RoundDetail>(roundId);
    if (cached) {
      onSource('cache');
      return cached;
    }
    throw err;
  }
}

/**
 * Same cache-aside pattern as detail. ALSO computes the course-superseded
 * banner trigger: reads cache BEFORE writing fresh; compares stable
 * hash (holeNumber:par:si). On change AND prior cache existed (NOT
 * first fetch), invokes `onCourseChanged` so the consumer can fire the
 * banner state.
 */
async function fetchOrCacheRoundCourse(
  eventId: string,
  roundId: string,
  onSource: (s: 'network' | 'cache') => void,
  onCourseChanged: () => void,
): Promise<RoundCourse> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const cached = await readCachedRoundCourse<RoundCourse>(roundId);
    if (cached) {
      onSource('cache');
      return cached;
    }
    throw new TypeError('Failed to fetch (offline, no cache)');
  }
  // (1) READ cached BEFORE writing fresh — load-bearing for banner.
  const cachedBefore = await readCachedRoundCourse<RoundCourse>(roundId);
  try {
    const fresh = await fetchRoundCourse(eventId, roundId);
    // (2) Compare hashes BEFORE overwriting.
    if (cachedBefore !== null) {
      const oldHash = courseHash(cachedBefore);
      const newHash = courseHash(fresh);
      if (oldHash !== newHash) {
        onCourseChanged();
      }
    }
    // (3) Write fresh AFTER comparison.
    await writeCachedRoundCourse(roundId, fresh);
    onSource('network');
    return fresh;
  } catch (err) {
    if (isApiError(err)) throw err;
    if (cachedBefore) {
      onSource('cache');
      return cachedBefore;
    }
    throw err;
  }
}

// ---- Score input validation + auto-advance state machine ------------------

const SCORE_RE = /^([1-9]|1[0-9]|20)$/;
const ADVANCE_DEBOUNCE_MS = 1500;

// ---- Skip-hole sessionStorage persistence ---------------------------------

const SKIPPED_HOLES_KEY_PREFIX = 'tournament:skipped-holes:';

function loadSkippedHoles(roundId: string): Set<number> {
  try {
    const raw = sessionStorage.getItem(SKIPPED_HOLES_KEY_PREFIX + roundId);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { skippedHoles?: number[] };
    return new Set(parsed.skippedHoles ?? []);
  } catch {
    return new Set();
  }
}

function persistSkippedHoles(roundId: string, set: Set<number>): void {
  try {
    sessionStorage.setItem(
      SKIPPED_HOLES_KEY_PREFIX + roundId,
      JSON.stringify({ skippedHoles: Array.from(set) }),
    );
  } catch {
    // sessionStorage may be unavailable (private mode); skip silently.
  }
}

// ---- Component ------------------------------------------------------------

export function ScoreEntryRoute() {
  const { roundId } = Route.useParams();
  const queue = useOfflineQueue(roundId);
  const isInstalled = useIsInstalledPWA();

  // Capture beforeinstallprompt for the T7-7 install-required card —
  // mirrors __root.tsx:100-114. Reading the same `__deferredInstallPrompt`
  // global is safe (the host stores it, this route reads it); a duplicate
  // listener is harmless because both consumers store the same event.
  const [beforeInstallEvent, setBeforeInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.__deferredInstallPrompt) {
      setBeforeInstallEvent(window.__deferredInstallPrompt);
    }
    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      window.__deferredInstallPrompt = e;
      setBeforeInstallEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  // Cache-source signal flows via ref (NOT __source field; NOT useState
  // inside queryFn — both have R19 mid-fetch issues).
  const sourceRef = useRef<{
    detail: 'network' | 'cache' | null;
    course: 'network' | 'cache' | null;
  }>({ detail: null, course: null });
  const [, forceSourceRender] = useState(0);
  const setDetailSource = useCallback((s: 'network' | 'cache') => {
    sourceRef.current = { ...sourceRef.current, detail: s };
    // Trigger a render so the chip + dataUpdatedAt-keyed useMemo re-evaluates.
    forceSourceRender((n) => n + 1);
  }, []);
  const setCourseSource = useCallback((s: 'network' | 'cache') => {
    sourceRef.current = { ...sourceRef.current, course: s };
    forceSourceRender((n) => n + 1);
  }, []);

  const [courseChangedAt, setCourseChangedAt] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const onCourseChanged = useCallback(() => {
    setCourseChangedAt(Date.now());
    setBannerDismissed(false);
  }, []);

  const { data, isLoading, error } = useQuery<RoundDetail, ApiError>({
    queryKey: ['round-detail', roundId],
    queryFn: () => fetchOrCacheRoundDetail(roundId, setDetailSource),
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  // Course query — only enabled once we know the eventId from the
  // detail response. Placeholder enabled=false until then.
  const eventId = data?.eventId ?? null;
  const courseQuery = useQuery<RoundCourse, ApiError>({
    queryKey: ['round-course', roundId, eventId],
    queryFn: () =>
      fetchOrCacheRoundCourse(eventId!, roundId, setCourseSource, onCourseChanged),
    enabled: eventId !== null,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  // isOffline fires if EITHER query served from cache OR EITHER query
  // failed with a non-ApiError (network failure with no cache available
  // — partial-offline state). Round-2 impl-codex catch.
  const courseError = courseQuery.error as ApiError | TypeError | null;
  const isOffline =
    sourceRef.current.detail === 'cache' ||
    sourceRef.current.course === 'cache' ||
    (courseError !== null && !isApiError(courseError));
  const courseChanged =
    courseChangedAt > 0 && !bannerDismissed && courseQuery.data !== undefined;

  // Register terminal errors for queued mutation kinds once at mount.
  useEffect(() => {
    registerTerminalErrors('hole_score', [
      'round_not_writable',
      'hole_number_exceeds_holes_to_play',
      'foursome_has_no_scorer',
      'invalid_body',
      'invalid_round_id',
      'invalid_hole_number',
    ]);
    // T5-7 scorer-handoff: 4xx codes from POST .../scorer-assignments/transfer
    // that the queue MUST treat as terminal (no transient retry loop).
    // Includes the API's 404 round_not_found path — without it, the
    // universal-failsafe would burn 5 transient retries before purging.
    registerTerminalErrors('scorer_handoff', [
      'invalid_round_id',
      'invalid_body',
      'not_authorized_for_handoff',
      'assignee_not_in_foursome',
      'foursome_has_no_scorer',
      'round_state_missing',
      'round_finalized',
      'round_cancelled',
      'round_not_found',
    ]);
  }, []);

  if (isLoading) {
    return (
      <div data-testid="loading">
        <LoadingCard />
      </div>
    );
  }
  if (error) {
    // TypeError without .status — pure network failure with no cached
    // value (the queryFn already tried the cache fall-through and missed).
    // Render the offline-no-cache placeholder rather than a confusing
    // "status undefined" generic error. Round-1 impl-codex catch.
    if (!isApiError(error)) {
      return (
        <div data-testid="offline-no-cache">
          You're offline and this round isn't cached on this device. Reconnect
          to load it.
        </div>
      );
    }
    if (error.status === 404) {
      return (
        <div data-testid="not-in-round">
          This round isn't available to you.
        </div>
      );
    }
    if (error.status === 422 && error.code === 'round_state_missing') {
      return (
        <div data-testid="setup-error">
          Round setup incomplete — ask the organizer.
        </div>
      );
    }
    return (
      <div data-testid="error">
        Couldn't load round (status {error.status}).
      </div>
    );
  }
  if (!data) {
    return <div data-testid="error">No data.</div>;
  }
  if (data.state === 'finalized' || data.state === 'cancelled') {
    return (
      <div data-testid="round-closed">
        Round is closed ({data.state}).
      </div>
    );
  }
  if (data.myFoursome.scorerPlayerId === null) {
    return (
      <div data-testid="no-scorer">
        Scorer not yet assigned for this foursome — ask the organizer.
      </div>
    );
  }
  if (!data.myFoursome.isScorer) {
    // Stale-queue banner is rendered ONLY in the read-only state. When
    // the user IS the active scorer, errored entries scoped to this
    // round are necessarily historical (e.g., user was demoted then
    // re-promoted) and the banner would be misleading. The banner's
    // intent — "the scorer changed; your queued scores were rejected"
    // — only makes sense when the caller is currently NOT scoring.
    //
    // T7-7: this branch ALSO covers "non-installed + non-scorer" — the
    // Codex-gated path where non-scorers in browser tabs see the standard
    // read-only placeholder, NOT an install-required card. Ordering is
    // load-bearing: this `!isScorer` short-circuit MUST run before the
    // `!isInstalled` check below so non-scorers never see the install
    // prompt (which was misleading for users who couldn't score anyway).
    return (
      <>
        <StaleQueueBanner roundId={roundId} />
        <div data-testid="read-only">
          <strong>{data.myFoursome.scorerName}</strong> is currently scoring
          foursome {data.myFoursome.foursomeNumber}.
        </div>
        <ClaimScoringButton roundId={roundId} foursomeNumber={data.myFoursome.foursomeNumber} />
      </>
    );
  }
  if (!isInstalled) {
    // T7-7: scorer in a non-installed browser tab gets an "Install to
    // score" surface (FR-E9). Score-entry needs the offline queue +
    // IndexedDB persistence, both of which require the installed PWA on
    // iOS Safari and become unreliable in a tab. The route-level surface
    // is intentionally NOT audited (audit-emit is reserved for T7-6's
    // first-mutation prompt) — see T7-7 spec followups.
    return (
      <div data-testid="install-required" role="main">
        <h1>Install to score</h1>
        <p>
          Score entry requires the installed app for offline reliability. On
          iOS: Share → Add to Home Screen. On Android: tap Install below.
        </p>
        <InstallPrompt
          installPromptShownAt={null}
          hasMutatedThisSession={true}
          isStandalone={false}
          beforeInstallEvent={beforeInstallEvent}
          userAgent={typeof navigator !== 'undefined' ? navigator.userAgent : ''}
          onShown={() => {
            // No-op: route-level surface, not first-mutation hook.
            // See T7-7 spec "audit-semantics" rationale.
          }}
        />
        {data.eventId !== null && (
          <a
            data-testid="view-leaderboard-link"
            href={`/events/${data.eventId}/leaderboard`}
          >
            View leaderboard instead
          </a>
        )}
      </div>
    );
  }

  return (
    <>
      {isOffline && (
        <div data-testid="offline-chip" role="status">
          Offline mode
        </div>
      )}
      {courseChanged && (
        <div data-testid="course-superseded-banner" role="alert">
          Course data updated — review hole SIs.{' '}
          <button
            data-testid="dismiss-banner"
            onClick={() => setBannerDismissed(true)}
          >
            Dismiss
          </button>
        </div>
      )}
      <HandoffControl
        roundId={roundId}
        foursomeNumber={data.myFoursome.foursomeNumber}
        members={data.myFoursome.members}
        myPlayerId={data.myFoursome.scorerPlayerId}
        queueDrain={queue.drain}
        queueRefreshCount={queue.refreshCount}
      />
      <PressControl roundId={roundId} />
      <ScoreEntryForm
        data={data}
        queue={queue}
        course={courseQuery.data ?? null}
      />
    </>
  );
}

// ---- HandoffControl (T5-7) ------------------------------------------------

interface HandoffControlProps {
  roundId: string;
  foursomeNumber: number;
  members: Member[];
  /** Current scorer's playerId — excluded from the picker list. */
  myPlayerId: string;
  /** Drain trigger from useOfflineQueue. */
  queueDrain: () => Promise<void>;
  /** Pending-count refresher from useOfflineQueue. */
  queueRefreshCount: () => Promise<void>;
}

/**
 * "Hand off scorer" affordance shown to the active scorer.
 *
 * Per AC-8 + spec Section 2: the transfer goes through the offline
 * mutation queue using kind='scorer_handoff' (already in T5-3's
 * MutationKind enum). Online: enqueue → drain → invalidate → page
 * transitions to read-only on next round-detail poll. Offline: enqueue
 * + show "Queued — will sync when online"; queue's auto-drain on
 * connectivity restore handles the eventual POST.
 *
 * Terminal-error codes for 'scorer_handoff' are registered at parent
 * mount via registerTerminalErrors.
 */
function HandoffControl({
  roundId,
  foursomeNumber,
  members,
  myPlayerId,
  queueDrain,
  queueRefreshCount,
}: HandoffControlProps) {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const candidates = useMemo(
    () => members.filter((m) => m.playerId !== myPlayerId),
    [members, myPlayerId],
  );

  const handleTransfer = useCallback(
    async (toPlayerId: string) => {
      setSubmitting(true);
      setError(null);
      setQueuedOffline(false);
      try {
        const clientEventId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await enqueueMutation({
          kind: 'scorer_handoff',
          url: `/api/rounds/${roundId}/scorer-assignments/transfer`,
          body: { foursomeNumber, toPlayerId },
          clientEventId,
          roundId,
        });
        await queueRefreshCount();

        // Trigger immediate drain (online → POSTs through; offline →
        // enqueue stays + retries on online event).
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          setQueuedOffline(true);
          setSubmitting(false);
          // Leave picker open so the user sees the offline-queued state;
          // they can dismiss with Cancel.
          return;
        }

        await queueDrain();
        // After drain, invalidate round-detail so the next refetch shows
        // the read-only state. The 15s poll would catch it eventually
        // but invalidation makes the transition immediate.
        await queryClient.invalidateQueries({
          queryKey: ['round-detail', roundId],
        });
        setPickerOpen(false);
        setSubmitting(false);
      } catch (e) {
        setError(`Network error: ${String(e)}`);
        setSubmitting(false);
      }
    },
    [foursomeNumber, queryClient, queueDrain, queueRefreshCount, roundId],
  );

  if (!pickerOpen) {
    return (
      <div data-testid="handoff-control">
        <button
          type="button"
          data-testid="handoff-open"
          onClick={() => setPickerOpen(true)}
        >
          Hand off scorer
        </button>
      </div>
    );
  }

  return (
    <div data-testid="handoff-picker" role="dialog" aria-label="Hand off scorer">
      <p>Pick the new scorer for foursome {foursomeNumber}:</p>
      <ul>
        {candidates.map((m) => (
          <li key={m.playerId}>
            <button
              type="button"
              data-testid={`handoff-pick-${m.playerId}`}
              onClick={() => handleTransfer(m.playerId)}
              disabled={submitting}
            >
              {m.name}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="handoff-cancel"
        onClick={() => {
          setPickerOpen(false);
          setError(null);
          setQueuedOffline(false);
        }}
        disabled={submitting}
      >
        Cancel
      </button>
      {queuedOffline && (
        <p role="status" data-testid="handoff-queued-offline">
          Queued — will sync when you&apos;re back online.
        </p>
      )}
      {error !== null && (
        <p role="alert" data-testid="handoff-error">
          {error}
        </p>
      )}
    </div>
  );
}

// ---- PressControl (T6-7a) -------------------------------------------------

interface PressControlProps {
  roundId: string;
}

interface PressFireResponse {
  ok: boolean;
  pressId: string;
  fromHole: number;
  canUndoUntilHoleComplete: number;
}

/**
 * T6-7a — minimal manual press UI. Two buttons (Press teamA / Press teamB);
 * on click, POSTs to /api/rounds/:roundId/presses. Server derives fromHole.
 *
 * After firing, shows the fromHole + an Undo button. Undo calls DELETE
 * /api/rounds/:roundId/presses/:pressId. The undo window closes when the
 * pressed hole completes (4/4 scores); the API returns 422 in that case
 * and we surface the error inline.
 *
 * v1 deferrals: confirmation dialog (none — one-tap fire); animations;
 * mobile-responsive layout polish; auto-press visibility (auto presses
 * fire silently per FR-D5; this UI shows MANUAL fires only).
 */
function PressControl({ roundId }: PressControlProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fired, setFired] = useState<{
    pressId: string;
    team: 'teamA' | 'teamB';
    fromHole: number;
  } | null>(null);

  const handleFire = useCallback(
    async (team: 'teamA' | 'teamB') => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`/api/rounds/${roundId}/presses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team }),
          credentials: 'same-origin',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { code?: string };
          setError(`Press failed: ${body.code ?? `HTTP ${res.status}`}`);
          setSubmitting(false);
          return;
        }
        const body = (await res.json()) as PressFireResponse;
        setFired({ pressId: body.pressId, team, fromHole: body.fromHole });
        setSubmitting(false);
      } catch (e) {
        setError(`Network error: ${String(e)}`);
        setSubmitting(false);
      }
    },
    [roundId],
  );

  const handleUndo = useCallback(async () => {
    if (fired === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/rounds/${roundId}/presses/${fired.pressId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(`Undo failed: ${body.code ?? `HTTP ${res.status}`}`);
        setSubmitting(false);
        return;
      }
      setFired(null);
      setSubmitting(false);
    } catch (e) {
      setError(`Network error: ${String(e)}`);
      setSubmitting(false);
    }
  }, [fired, roundId]);

  return (
    <div data-testid="press-control">
      {fired === null ? (
        <div>
          <span style={{ marginRight: '0.5rem' }}>Press:</span>
          <button
            type="button"
            data-testid="press-teamA"
            onClick={() => handleFire('teamA')}
            disabled={submitting}
          >
            Team A
          </button>
          <button
            type="button"
            data-testid="press-teamB"
            onClick={() => handleFire('teamB')}
            disabled={submitting}
            style={{ marginLeft: '0.5rem' }}
          >
            Team B
          </button>
        </div>
      ) : (
        <div data-testid="press-fired">
          <span>
            Press fired: {fired.team} from hole {fired.fromHole}.
          </span>
          <button
            type="button"
            data-testid="press-undo"
            onClick={handleUndo}
            disabled={submitting}
            style={{ marginLeft: '0.5rem' }}
          >
            Undo
          </button>
        </div>
      )}
      {error !== null && (
        <p role="alert" data-testid="press-error">
          {error}
        </p>
      )}
    </div>
  );
}

// ---- StaleQueueBanner (T5-7) ----------------------------------------------

interface StaleQueueBannerProps {
  roundId: string;
}

/**
 * Renders when the offline queue's errored bucket contains entries
 * scoped to this round whose `lastError.body.code` indicates a scorer
 * mismatch (T5-6 codes) AND `lastError.body.currentScorerName` is
 * populated. Surfaces the new scorer's name + an explanation that the
 * held scores require T5-9 admin correction (or re-entry by the new
 * scorer).
 *
 * Banner is dismissible (sessionStorage-keyed by roundId) — dismiss
 * persists for the session, but reappears on a fresh page load until
 * the matching errored entries are cleared. The "View errored entries"
 * details element surfaces the held mutation bodies so the new scorer
 * (or the organizer) can re-enter the held scores or open admin
 * corrections (T5-9) as needed.
 *
 * AC-9 gating: the parent component only mounts this banner in the
 * `!isScorer` (read-only) branch — when the caller IS the active
 * scorer, errored entries scoped to this round are necessarily
 * historical (e.g., user was demoted then re-promoted), so the
 * "scorer changed; your queued scores were rejected" framing would
 * be misleading.
 */

const STALE_BANNER_DISMISS_KEY_PREFIX = 'tournament:stale-queue-banner-dismissed:';

function StaleQueueBanner({
  roundId,
}: StaleQueueBannerProps) {
  const erroredQuery = useQuery<MutationEntry[]>({
    queryKey: ['errored-entries', roundId],
    queryFn: () => peekErroredEntries(roundId),
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const dismissKey = `${STALE_BANNER_DISMISS_KEY_PREFIX}${roundId}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(dismissKey) === '1';
    } catch {
      return false;
    }
  });
  // Re-read sessionStorage when roundId changes (banner is per-round;
  // navigating between rounds without unmount must not leak state).
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(dismissKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);
  const [showDetails, setShowDetails] = useState(false);

  const allMatches = useMemo(() => {
    const entries = erroredQuery.data ?? [];
    return entries.filter((entry) => {
      const lastError = entry.lastError;
      if (!lastError || typeof lastError.body !== 'object' || lastError.body === null) {
        return false;
      }
      const body = lastError.body as { code?: string; currentScorerName?: string | null };
      const isScorerMismatch =
        body.code === 'player_not_in_your_foursome' ||
        body.code === 'not_scorer_for_this_foursome';
      return isScorerMismatch && typeof body.currentScorerName === 'string';
    });
  }, [erroredQuery.data]);

  // The errored bucket may accumulate entries from MULTIPLE handoff
  // incidents over the round's lifetime (e.g., scorer A → B → C). To
  // keep banner copy honest ("{name} is now scoring — N held; ask {name}")
  // we filter to entries whose currentScorerName matches the newest
  // entry's — those are the ones held BY the current scorer. Older
  // entries (held by a since-replaced scorer) are visible only via
  // the View-errored expansion, which shows ALL matching entries.
  const newest = allMatches[allMatches.length - 1] ?? null;
  const currentScorerName: string | null = newest
    ? (newest.lastError!.body as { currentScorerName: string }).currentScorerName
    : null;
  const matches = useMemo(() => {
    if (currentScorerName === null) return [];
    return allMatches.filter((entry) => {
      const body = entry.lastError!.body as { currentScorerName: string };
      return body.currentScorerName === currentScorerName;
    });
  }, [allMatches, currentScorerName]);

  if (matches.length === 0 || dismissed || currentScorerName === null) {
    return null;
  }

  const newScorerName = currentScorerName;

  function handleDismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(dismissKey, '1');
    } catch {
      // sessionStorage unavailable (private mode); dismiss is local-only.
    }
  }

  return (
    <div role="alert" data-testid="stale-queue-banner">
      <p>
        <strong>{newScorerName}</strong> is now scoring — {matches.length}{' '}
        queued score{matches.length === 1 ? ' was' : 's were'} held; ask{' '}
        {newScorerName} to re-enter or request an admin correction (T5.9).
      </p>
      <button
        type="button"
        data-testid="stale-queue-banner-toggle-details"
        onClick={() => setShowDetails((v) => !v)}
      >
        {showDetails ? 'Hide errored entries' : 'View errored entries'}
      </button>
      <button
        type="button"
        data-testid="stale-queue-banner-dismiss"
        onClick={handleDismiss}
      >
        Dismiss
      </button>
      {showDetails && (
        <ul data-testid="stale-queue-errored-list">
          {/*
            View-errored shows ALL matching errored entries (regardless
            of currentScorerName) — preserves the audit trail when
            multiple handoffs accumulated entries from different
            now-stale scorers. Banner copy + count above are scoped to
            the newest scorer for narrative honesty.
          */}
          {allMatches.map((entry, idx) => (
            <li key={entry.id ?? idx} data-testid="stale-queue-errored-entry">
              <code>{entry.url}</code>
              <pre>{JSON.stringify(entry.body, null, 2)}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- ScoreEntryForm (the load-bearing piece) ------------------------------

function ScoreEntryForm({
  data,
  queue,
  course,
}: {
  data: RoundDetail;
  queue: ReturnType<typeof useOfflineQueue>;
  course: RoundCourse | null;
}) {
  const { roundId, holesToPlay } = data;
  const members = data.myFoursome.members;
  const markMutation = useMarkMutation();

  // Skip-hole state, persisted to sessionStorage.
  const [skippedHoles, setSkippedHoles] = useState<Set<number>>(() =>
    loadSkippedHoles(roundId),
  );

  // Persist skippedHoles when it changes.
  useEffect(() => {
    persistSkippedHoles(roundId, skippedHoles);
  }, [roundId, skippedHoles]);

  // Compute the set of holes where ALL members have a server-side score.
  const serverFilledHoles = useMemo(() => {
    const filled = new Set<number>();
    if (members.length === 0) return filled;
    for (let h = 1; h <= holesToPlay; h++) {
      const cellsForHole = data.myFoursome.holeScores.filter(
        (hs) => hs.holeNumber === h,
      );
      const playerIdsAtHole = new Set(cellsForHole.map((hs) => hs.playerId));
      const allFilled = members.every((m) => playerIdsAtHole.has(m.playerId));
      if (allFilled) filled.add(h);
    }
    return filled;
  }, [data.myFoursome.holeScores, members, holesToPlay]);

  // Clear skippedHoles entries that the server has now filled.
  useEffect(() => {
    const next = new Set<number>();
    skippedHoles.forEach((h) => {
      if (!serverFilledHoles.has(h)) next.add(h);
    });
    const changed =
      next.size !== skippedHoles.size ||
      [...next].some((h) => !skippedHoles.has(h));
    if (changed) setSkippedHoles(next);
    // Value-equality check above prevents an infinite loop even though
    // setSkippedHoles fires inside an effect whose deps include
    // skippedHoles — re-running the effect with the new set yields
    // changed=false on the next pass.
  }, [serverFilledHoles, skippedHoles]);

  // Compute currentHole.
  const unscoredHoles = useMemo(() => {
    const set = new Set<number>();
    for (let h = 1; h <= holesToPlay; h++) {
      if (!serverFilledHoles.has(h)) set.add(h);
    }
    return set;
  }, [serverFilledHoles, holesToPlay]);

  const eligibleHoles = useMemo(() => {
    const arr: number[] = [];
    unscoredHoles.forEach((h) => {
      if (!skippedHoles.has(h)) arr.push(h);
    });
    return arr.sort((a, b) => a - b);
  }, [unscoredHoles, skippedHoles]);

  const currentHole = eligibleHoles.length > 0 ? eligibleHoles[0]! : null;

  // Per-input score string; clientEventIds are generated at Save time.
  const [currentInputs, setCurrentInputs] = useState<Record<string, string>>({});
  const [currentPutts, setCurrentPutts] = useState<Record<string, string>>({});

  // Refs for ref-positional indexing — load-bearing for iOS keyboard fix.
  const scoreInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Per-input pending-advance timer ref. Cleared on next keystroke / blur /
  // unmount per Risk Acceptance §4 cancellation rules.
  const pendingAdvanceTimers = useRef<Array<ReturnType<typeof setTimeout> | null>>(
    [],
  );

  const clearPendingAdvanceTimer = useCallback((idx: number) => {
    const t = pendingAdvanceTimers.current[idx];
    if (t !== null && t !== undefined) {
      clearTimeout(t);
      pendingAdvanceTimers.current[idx] = null;
    }
  }, []);

  // Cleanup all pending timers on unmount.
  useEffect(() => {
    return () => {
      pendingAdvanceTimers.current.forEach((t) => {
        if (t !== null && t !== undefined) clearTimeout(t);
      });
    };
  }, []);

  // Reset inputs when currentHole changes (advance to a new hole).
  useEffect(() => {
    setCurrentInputs({});
    setCurrentPutts({});
    pendingAdvanceTimers.current.forEach((t) => {
      if (t !== null && t !== undefined) clearTimeout(t);
    });
    pendingAdvanceTimers.current = [];
  }, [currentHole]);

  const advanceFocus = useCallback((idx: number) => {
    if (idx < members.length - 1) {
      scoreInputRefs.current[idx + 1]?.focus();
    } else {
      scoreInputRefs.current[idx]?.blur();
    }
  }, [members.length]);

  const handleScoreChange = useCallback(
    (member: Member, idx: number, raw: string) => {
      // Empty (backspace) — accept; clear advance timer.
      if (raw === '') {
        setCurrentInputs((prev) => ({ ...prev, [member.playerId]: '' }));
        clearPendingAdvanceTimer(idx);
        return;
      }
      // Validate. Reject (don't update state — controlled-input revert).
      // Cancel any pending advance timer FIRST so an invalid keystroke
      // mid-debounce doesn't fire stale focus advance after the user
      // explicitly tried (and failed) to alter the value.
      if (!SCORE_RE.test(raw)) {
        clearPendingAdvanceTimer(idx);
        return;
      }
      setCurrentInputs((prev) => ({ ...prev, [member.playerId]: raw }));
      clearPendingAdvanceTimer(idx);
      // Auto-advance decision per Risk Acceptance §4.
      if (raw === '1' || raw === '2') {
        // Could be the start of '10'-'19' or '20'. Wait.
        const t = setTimeout(() => {
          pendingAdvanceTimers.current[idx] = null;
          advanceFocus(idx);
        }, ADVANCE_DEBOUNCE_MS);
        pendingAdvanceTimers.current[idx] = t;
        return;
      }
      // 3-9 (single-digit unambiguous), 10-19, 20 → advance immediately.
      advanceFocus(idx);
    },
    [advanceFocus, clearPendingAdvanceTimer],
  );

  const handlePuttsChange = useCallback(
    (member: Member, raw: string) => {
      if (raw === '') {
        setCurrentPutts((prev) => ({ ...prev, [member.playerId]: '' }));
        return;
      }
      if (!/^([0-9]|1[0-5])$/.test(raw)) return;
      setCurrentPutts((prev) => ({ ...prev, [member.playerId]: raw }));
    },
    [],
  );

  const handleBlur = useCallback(
    (idx: number) => {
      // Blur cancels the pending-advance timer. The user already moved
      // focus elsewhere (the timer's purpose was to advance for them;
      // they beat it). The single-digit '1' or '2' value is preserved
      // in currentInputs as the final score; we don't auto-advance focus
      // because the user has already shifted it.
      const t = pendingAdvanceTimers.current[idx];
      if (t !== null && t !== undefined) {
        clearTimeout(t);
        pendingAdvanceTimers.current[idx] = null;
      }
    },
    [],
  );

  const allValid = members.length > 0
    && members.every((m) => SCORE_RE.test(currentInputs[m.playerId] ?? ''));

  // isSaving is THIS Save action's local "in-flight" flag — short-lived,
  // covers the duration of the Promise.allSettled. We deliberately do NOT
  // gate the Save button on queue.pendingCount because a partial-fail
  // would otherwise block retry: successful entries from the first
  // attempt sit in the queue (pendingCount > 0), preventing the user from
  // clicking Save again to retry the failed cells. The chip still shows
  // queue.pendingCount as user-facing sync state.
  const [isSaving, setIsSaving] = useState(false);

  const [saveError, setSaveError] = useState<string | null>(null);

  // Cache of clientEventIds per (hole, playerId). Generated on first Save
  // attempt for a hole; reused on retry so a partial-fail-then-retry
  // cycle doesn't enqueue duplicate cells under different IDs (which
  // would later 409 against the cell-level UNIQUE on the server).
  // Persisted to sessionStorage by roundId so a page reload mid-hole
  // also reuses the same IDs (otherwise reload would generate fresh IDs
  // and the offline queue's first-pass entries would 409 the new
  // attempts on the server). Cleared when currentHole advances OR when
  // the round transitions to finalized/cancelled.
  const CLIENT_EVENT_ID_CACHE_KEY = `tournament:client-event-ids:${roundId}`;

  const clientEventIdCache = useRef<Map<string, string>>(
    (() => {
      try {
        const raw = sessionStorage.getItem(CLIENT_EVENT_ID_CACHE_KEY);
        if (!raw) return new Map();
        const parsed = JSON.parse(raw) as Record<string, string>;
        return new Map(Object.entries(parsed));
      } catch {
        return new Map();
      }
    })(),
  );

  const persistClientEventIdCache = useCallback(() => {
    try {
      const obj: Record<string, string> = {};
      clientEventIdCache.current.forEach((v, k) => {
        obj[k] = v;
      });
      sessionStorage.setItem(CLIENT_EVENT_ID_CACHE_KEY, JSON.stringify(obj));
    } catch {
      // sessionStorage unavailable; in-memory cache still works v1.
    }
  }, [CLIENT_EVENT_ID_CACHE_KEY]);

  // Reset the cache for the prior hole when currentHole changes — but
  // KEEP entries for the new hole. Cache keys are `${hole}:${playerId}`,
  // so we just remove entries whose key prefix doesn't match the
  // current hole. This preserves IDs for the in-progress hole across
  // a hole-advance-then-back navigation while still keeping the cache
  // bounded.
  useEffect(() => {
    if (currentHole === null) {
      clientEventIdCache.current.clear();
      persistClientEventIdCache();
      return;
    }
    const prefix = `${currentHole}:`;
    const next = new Map<string, string>();
    clientEventIdCache.current.forEach((v, k) => {
      if (k.startsWith(prefix)) next.set(k, v);
    });
    if (next.size !== clientEventIdCache.current.size) {
      clientEventIdCache.current = next;
      persistClientEventIdCache();
    }
  }, [currentHole, persistClientEventIdCache]);

  const handleSave = useCallback(async () => {
    if (currentHole === null) return;
    if (!allValid) return;
    if (isSaving) return;
    setSaveError(null);
    setIsSaving(true);

    // iOS Safari only opens the on-screen keyboard when focus() is called
    // inside a user-gesture handler. Focus the first score input here so
    // that when the hole advances, the same DOM input (reused by React via
    // stable key={member.playerId}) keeps the keyboard open.
    // ** SYNCHRONOUS — must run BEFORE any await / async call. **
    scoreInputRefs.current[0]?.focus();

    // Build all 4 promises in a closure that catches sync throws so
    // Promise.allSettled actually sees ALL 4 outcomes (a synchronous
    // throw inside .map() callback would otherwise abort the loop early
    // and leave the hole in a partial-enqueue state).
    const enqueues: Promise<unknown>[] = members.map((member) => {
      try {
        const score = currentInputs[member.playerId];
        const puttsRaw = currentPutts[member.playerId];
        const grossStrokes = parseInt(score!, 10);
        const putts = puttsRaw ? parseInt(puttsRaw, 10) : null;
        // Stable clientEventId per (hole, player) — reuse across retries
        // so retried cells dedupe on the server's UNIQUE(round_id,
        // player_id, hole_number, client_event_id) target. Fresh ID
        // every new hole (cleared via the useEffect above).
        const cacheKey = `${currentHole}:${member.playerId}`;
        let clientEventId = clientEventIdCache.current.get(cacheKey);
        if (!clientEventId) {
          clientEventId = crypto.randomUUID();
          clientEventIdCache.current.set(cacheKey, clientEventId);
          persistClientEventIdCache();
        }
        return enqueueMutation({
          kind: 'hole_score',
          url: `/api/rounds/${roundId}/holes/${currentHole}/scores`,
          body: {
            playerId: member.playerId,
            grossStrokes,
            putts,
            clientEventId,
          },
          clientEventId,
          roundId,
        });
      } catch (err) {
        // Sync throw (e.g., crypto unavailable, parseInt NaN). Convert to
        // a rejected promise so allSettled sees a 'rejected' outcome
        // instead of bailing the .map().
        return Promise.reject(err);
      }
    });
    const results = await Promise.allSettled(enqueues);
    setIsSaving(false);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      setSaveError(
        `${failed.length} of ${members.length} scores didn't save — tap Save again to retry.`,
      );
      // Don't advance the hole. Successful entries are in the queue
      // already; retry uses the cached clientEventIds so successful-on-
      // first-try cells dedupe on the server (200 deduped path) and only
      // the failed ones land as new rows.
      return;
    }

    // T7-6 — flag the first successful score commit in this session as a
    // "first mutation" event for the install-prompt host. Idempotent —
    // the provider's setState short-circuits on subsequent calls.
    markMutation();

    // Trigger drain immediately if online; queue's setTimeout heartbeat
    // handles offline gracefully.
    void queue.drain();
  }, [allValid, currentHole, currentInputs, currentPutts, isSaving, markMutation, members, persistClientEventIdCache, roundId, queue]);

  const handleSkipHole = useCallback(() => {
    if (currentHole === null) return;
    setSkippedHoles((prev) => {
      const next = new Set(prev);
      next.add(currentHole);
      return next;
    });
  }, [currentHole]);

  if (currentHole === null) {
    return (
      <div data-testid="all-done">
        <h1>Scoring complete from your end</h1>
        <p>All holes are either scored or skipped.</p>
      </div>
    );
  }

  // Scorecard-shell: par + SI for the current hole, populated from course data.
  const currentHoleInfo = course?.holes.find((h) => h.holeNumber === currentHole);

  return (
    <div data-testid="score-entry-form">
      <header>
        <span data-testid="current-hole">Hole {currentHole}</span>
        <span data-testid="sync-chip">
          {queue.pendingCount > 0 ? `${queue.pendingCount} queued` : 'All synced'}
        </span>
      </header>

      {currentHoleInfo && (
        <div data-testid="scorecard-shell-strip">
          <span>Hole {currentHoleInfo.holeNumber}</span>
          <span> • Par {currentHoleInfo.par}</span>
          <span> • SI {currentHoleInfo.si}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {members.map((member, idx) => (
          <div key={member.playerId} className="card">
            <div className="member-name">{member.name}</div>
            <input
              ref={(el) => {
                scoreInputRefs.current[idx] = el;
              }}
              data-testid={`score-input-${idx}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              aria-label={`Score for ${member.name}`}
              value={currentInputs[member.playerId] ?? ''}
              onChange={(e) => handleScoreChange(member, idx, e.target.value)}
              onBlur={() => handleBlur(idx)}
            />
            <input
              data-testid={`putts-input-${idx}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              aria-label={`Putts for ${member.name}`}
              placeholder="Putts"
              value={currentPutts[member.playerId] ?? ''}
              onChange={(e) => handlePuttsChange(member, e.target.value)}
            />
          </div>
        ))}
      </div>

      {!allValid && (
        <div data-testid="validation-banner">
          All {members.length} scores required to advance.{' '}
          <button data-testid="skip-hole" onClick={handleSkipHole}>
            Skip hole
          </button>
        </div>
      )}

      {saveError !== null && (
        <div data-testid="save-error" role="alert">
          {saveError}
        </div>
      )}

      <button
        data-testid="save-button"
        disabled={!allValid || isSaving}
        onClick={handleSave}
      >
        {isSaving ? 'Saving…' : `Save Hole ${currentHole}`}
      </button>
    </div>
  );
}

/**
 * T13-4 "I'll score" — one-tap self-claim of the active scorer role, shown to a
 * non-active foursome member in the read-only state. Calls the transfer
 * endpoint assigning the role to the viewer; the server enforces eligibility
 * per the event's scorer policy (a non-eligible member gets a clear message).
 * On success it invalidates round-detail so the score form renders.
 */
function ClaimScoringButton({ roundId, foursomeNumber }: { roundId: string; foursomeNumber: number }) {
  const { player } = useAuthSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!player) return null;

  async function claim(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rounds/${roundId}/scorer-assignments/transfer`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ foursomeNumber, toPlayerId: player!.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(
          body.code === 'assignee_not_in_foursome' || body.code === 'not_authorized_for_handoff'
            ? "You aren't allowed to score this round."
            : `Couldn't take over (${body.code ?? res.status}).`,
        );
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" data-testid="claim-scoring" disabled={busy} onClick={() => void claim()}>
        {busy ? 'Taking over…' : "I'll score"}
      </button>
      {error !== null ? (
        <p role="alert" data-testid="claim-error" style={{ color: 'var(--color-danger, #dc2626)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---- TanStack Router file-route -------------------------------------------

export const Route = createFileRoute('/rounds/$roundId/score-entry')({
  component: ScoreEntryRoute,
});
