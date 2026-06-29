/* PORTED from apps/web/src/routes/score-entry-hole.tsx @ commit 67238a22a949e37d5d6143ddf46e3804aec57f59, dated 2026-04-26.
 * iOS keyboard synchronous-focus fix from commit ebe3cea (load-bearing — see Save onClick).
 *
 * Tournament deltas vs Wolf Cup:
 *   - Route shape: /rounds/$roundId/score-entry (round-scoped, NOT group-scoped)
 *   - REMOVED wolf-decision UI + state (T6 owns)
 *   - greenie/polie/sandie claims for F1 (Epic 2, Story 2.1) — compact color-coded
 *     G/P/S toggles in a "Bonuses" card (2026-06-23 Wolf-style redesign).
 *   - REMOVED CTP per-par-3 prompt (Wolf Cup-only sub-game)
 *   - REMOVED entry-code header (session-cookie auth via T1-6a)
 *   - REMOVED autoCalculateMoney (T6 owns)
 *   - REMOVED the putts input (2026-06-23 condense — putting moves to Bets per
 *     Josh). Save PRESERVES any existing server-side putts for a cell (never
 *     overwrites to null); the entry UI just no longer captures new putts.
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
  // Pinned course handicap (strokes received). Optional — absent on older server
  // builds / un-pinned rounds → the card shows HI only.
  courseHandicap?: number | null;
}

interface HoleScore {
  holeNumber: number;
  playerId: string;
  grossStrokes: number;
  putts: number | null;
}

// F1 Epic 2 (Story 2.1) — a current claim cell (latest write was a `set`).
type ClaimType = 'greenie' | 'polie' | 'sandie';
interface CurrentClaim {
  playerId: string;
  holeNumber: number;
  claimType: ClaimType;
}
const CLAIM_LABELS: Record<ClaimType, string> = {
  greenie: 'Greenie',
  polie: 'Polie',
  sandie: 'Sandie',
};

/**
 * Compact display name for the score-entry card: "First L." when a last name
 * exists, else the single token as-is. Wolf Cup hit collisions showing only the
 * first name (two players, same first name) — the last initial disambiguates.
 */
function shortPlayerName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return full.trim();
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

interface RoundDetail {
  roundId: string;
  eventId: string | null;
  state: RoundState;
  holesToPlay: 9 | 18;
  myFoursome: {
    foursomeNumber: number;
    isScorer: boolean;
    // Group-member gate (Josh 2026-06-28): true when the viewer may write scores
    // for this group — either the designated scorer OR any member of the
    // foursome. Absent on older server builds → fall back to isScorer.
    canScore?: boolean;
    viewerIsFoursomeMember?: boolean;
    scorerPlayerId: string | null;
    scorerName: string | null;
    members: Member[]; // sorted by slot_number ASC (load-bearing)
    holeScores: HoleScore[];
    claims?: CurrentClaim[]; // Story 2.1; absent on older server builds
    // Which claim-modifiers the round's pinned config settles (greenie/polie/sandie
    // that are ON). A claim button is hidden for any type NOT in this list. `null`
    // or absent (un-pinned / non-F1 round, or an older server build) → show all
    // three (no regression). Empty array → all three OFF, no claim buttons.
    enabledClaimTypes?: ClaimType[] | null;
    // Players in an active putting game for this round → score entry asks them
    // for putts each hole. Absent/empty (no putting game) → no putts input.
    puttsPlayerIds?: string[] | null;
    // Organizer-scoring: when the organizer opened a group they aren't in, the
    // UI shows a group switcher across these foursome numbers.
    viewerIsOrganizer?: boolean;
    availableFoursomes?: number[];
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
  // ?foursome=N lets the ORGANIZER (who isn't in any group) open a specific
  // group to score; ignored for players (they always resolve to their own).
  const fs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('foursome') : null;
  const qs = fs && /^\d+$/.test(fs) ? `?foursome=${fs}` : '';
  const res = await fetch(`/api/rounds/${roundId}${qs}`, {
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
    // F1 Epic 2 (Story 2.1) claim writes: 4xx codes from POST .../claims that
    // the queue MUST treat as terminal (no transient retry loop). round_not_writable
    // is the interim finalized-check refusal.
    registerTerminalErrors('claim', [
      'invalid_round_id',
      'invalid_body',
      'round_state_missing',
      'round_not_writable',
      'foursome_has_no_scorer',
      'player_not_in_any_foursome',
      'player_not_in_your_foursome',
      'not_scorer_for_this_foursome',
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
  // Group-member gate (Josh 2026-06-28): a member of this foursome may score it
  // directly — no designated-scorer handoff. Falls back to isScorer for older
  // server builds that don't send canScore (no regression).
  const canScore = data.myFoursome.canScore ?? data.myFoursome.isScorer;
  if (data.state === 'finalized' || data.state === 'cancelled') {
    return (
      <div data-testid="round-closed">
        Round is closed ({data.state}).
      </div>
    );
  }
  if (data.myFoursome.scorerPlayerId === null && !canScore) {
    return (
      <div data-testid="no-scorer">
        Scorer not yet assigned for this foursome — ask the organizer.
      </div>
    );
  }
  if (!canScore) {
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
      <div>
        {/* A way OUT — never trap a non-scorer on this screen. */}
        {data.eventId !== null ? (
          <nav style={{ marginBottom: 'var(--space-2)' }}>
            <a
              data-testid="read-only-back"
              href={`/events/${data.eventId}`}
              style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 var(--space-2)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-sm)', fontWeight: 600, textDecoration: 'none' }}
            >
              ← Event home
            </a>
          </nav>
        ) : null}
        {/* Organizer group switcher — lets the organizer jump to ANY group from
            this read-only view (else they're stuck on whatever group loaded). */}
        {data.myFoursome.viewerIsOrganizer && (data.myFoursome.availableFoursomes?.length ?? 0) > 1 ? (
          <div data-testid="organizer-group-switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Scoring group:</span>
            {data.myFoursome.availableFoursomes!.map((n) => {
              const active = n === data.myFoursome.foursomeNumber;
              return (
                <a
                  key={n}
                  data-testid={`organizer-group-${n}`}
                  href={`/rounds/${roundId}/score-entry?foursome=${n}`}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textDecoration: 'none', fontWeight: 700, color: active ? '#fff' : 'var(--color-text-secondary)', background: active ? 'var(--color-brand-primary)' : 'var(--color-surface)' }}
                >
                  {n}
                </a>
              );
            })}
          </div>
        ) : null}
        <StaleQueueBanner roundId={roundId} />
        <div data-testid="read-only">
          <strong>{data.myFoursome.scorerName}</strong> is currently scoring
          foursome {data.myFoursome.foursomeNumber}.
        </div>
        <ClaimScoringButton roundId={roundId} foursomeNumber={data.myFoursome.foursomeNumber} />
      </div>
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
      <ScoreEntryForm
        data={data}
        queue={queue}
        course={courseQuery.data ?? null}
      />
      {/* Once-or-twice-a-round actions live behind a disclosure so they don't
          outrank the 18×-a-round scoring controls. */}
      <details className="card" style={{ marginTop: 'var(--space-4)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          More — hand off scorer, presses
        </summary>
        <div style={{ marginTop: 'var(--space-3)' }}>
          {/* Handoff is a designated-scorer action (myPlayerId is the current
              scorer). A foursome member who can score via the group-member gate
              but ISN'T the designated scorer doesn't manage the handoff, so this
              renders only for the designated scorer (also narrows the non-null
              scorerPlayerId the control requires). */}
          {data.myFoursome.isScorer && data.myFoursome.scorerPlayerId !== null ? (
            <HandoffControl
              roundId={roundId}
              foursomeNumber={data.myFoursome.foursomeNumber}
              members={data.myFoursome.members}
              myPlayerId={data.myFoursome.scorerPlayerId}
              queueDrain={queue.drain}
              queueRefreshCount={queue.refreshCount}
            />
          ) : null}
          <PressControl roundId={roundId} />
        </div>
      </details>
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

// (ClaimChips removed 2026-06-23 — greenie/polie/sandie are now compact
//  color-coded G/P/S toggles in the score-entry "Bonuses" card, Wolf-style.)

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

  // Players in an active putting game → show a small per-hole putts field for
  // them. Empty (no putting game) → the score card is exactly as before.
  const puttsPlayerIds = useMemo(
    () => new Set(data.myFoursome.puttsPlayerIds ?? []),
    [data.myFoursome.puttsPlayerIds],
  );

  // F1 Epic 2 (Story 2.1) — current claims keyed `${playerId}:${hole}:${type}`.
  // Seeded from the server-derived current-claim set; toggled optimistically as
  // the scorer taps a chip (each toggle is a queued set/remove mutation).
  const serverClaims = data.myFoursome.claims;
  const [claimState, setClaimState] = useState<Set<string>>(
    () => new Set((serverClaims ?? []).map((c) => `${c.playerId}:${c.holeNumber}:${c.claimType}`)),
  );
  // Re-seed from server on a fresh poll, but UNION with local optimistic toggles
  // so an in-flight queued claim isn't clobbered by a poll that predates its
  // server commit. Server truth wins for cells it knows about; local-only cells
  // (still draining) are preserved.
  const serverClaimKey = useMemo(
    () => (serverClaims ?? []).map((c) => `${c.playerId}:${c.holeNumber}:${c.claimType}`).sort().join('|'),
    [serverClaims],
  );
  useEffect(() => {
    // serverClaimKey is the stable content hash; serverClaims identity churns
    // each poll even when unchanged, so we key the effect on the hash and read
    // the latest serverClaims inside.
    setClaimState(new Set((serverClaims ?? []).map((c) => `${c.playerId}:${c.holeNumber}:${c.claimType}`)));
  }, [serverClaimKey, serverClaims]);

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

  // Optimistically-saved holes: the moment a Save's local enqueues succeed we
  // treat the hole as filled so the form advances to the next hole IMMEDIATELY,
  // instead of waiting for the server round-trip + the next poll (the old "Save
  // doesn't advance / feels laggy" gap). The background drain syncs; once the
  // server confirms a hole, the prune effect below drops it from this set (it's
  // then covered by serverFilledHoles).
  const [optimisticFilled, setOptimisticFilled] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    setOptimisticFilled((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((h) => !serverFilledHoles.has(h)));
      return next.size === prev.size ? prev : next;
    });
  }, [serverFilledHoles]);

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

  // Compute currentHole. A hole counts as scored if the server has it OR we just
  // optimistically saved it (so Save advances without waiting for the network).
  const unscoredHoles = useMemo(() => {
    const set = new Set<number>();
    for (let h = 1; h <= holesToPlay; h++) {
      if (!serverFilledHoles.has(h) && !optimisticFilled.has(h)) set.add(h);
    }
    return set;
  }, [serverFilledHoles, optimisticFilled, holesToPlay]);

  const eligibleHoles = useMemo(() => {
    const arr: number[] = [];
    unscoredHoles.forEach((h) => {
      if (!skippedHoles.has(h)) arr.push(h);
    });
    return arr.sort((a, b) => a - b);
  }, [unscoredHoles, skippedHoles]);

  // Manual hole override (Prev/Next). null = follow the auto-advance (the first
  // unscored, unskipped hole). When the scorer steps back to review/fix a hole,
  // manualHole pins the view there until they navigate again. Clamped to the
  // round on every set via goToHole.
  const [manualHole, setManualHole] = useState<number | null>(null);
  const autoHole = eligibleHoles.length > 0 ? eligibleHoles[0]! : null;
  const currentHole = manualHole ?? autoHole;

  const goToHole = useCallback((target: number) => {
    const clamped = Math.max(1, Math.min(holesToPlay, target));
    setManualHole(clamped);
  }, [holesToPlay]);

  // Per-input score string; clientEventIds are generated at Save time.
  const [currentInputs, setCurrentInputs] = useState<Record<string, string>>({});
  // Per-hole putts for the current hole, keyed by playerId (putting-game players
  // only). Seeded from saved putts when stepping to a scored hole.
  const [currentPutts, setCurrentPutts] = useState<Record<string, string>>({});

  // Latest server scores, read (not subscribed) by the hole-change seed effect so
  // navigating BACK to a scored hole pre-fills its inputs — without a poll
  // clobbering in-progress typing (the effect deps stay [currentHole]).
  const holeScoresRef = useRef(data.myFoursome.holeScores);
  holeScoresRef.current = data.myFoursome.holeScores;

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

  // Seed inputs when currentHole changes. For a fresh hole this is empty; for a
  // hole already scored (e.g. stepping back with Prev) it pre-fills the saved
  // gross so the scorer can review/correct it. Reads holeScoresRef so a later
  // poll can't overwrite typing (deps are [currentHole] only).
  useEffect(() => {
    if (currentHole === null) {
      setCurrentInputs({});
      setCurrentPutts({});
    } else {
      const seeded: Record<string, string> = {};
      const seededPutts: Record<string, string> = {};
      for (const hs of holeScoresRef.current) {
        if (hs.holeNumber === currentHole) {
          seeded[hs.playerId] = String(hs.grossStrokes);
          if (hs.putts != null) seededPutts[hs.playerId] = String(hs.putts);
        }
      }
      setCurrentInputs(seeded);
      setCurrentPutts(seededPutts);
    }
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
      // Empty (backspace) — accept.
      if (raw === '') {
        setCurrentInputs((prev) => ({ ...prev, [member.playerId]: '' }));
        clearPendingAdvanceTimer(idx);
        return;
      }
      // SINGLE-DIGIT typing only (Josh): the just-typed character must be 1-9.
      // We take the LAST char so typing onto an existing value (incl. a 10-20
      // set via the + stepper) replaces it with that one digit. Scores above 9
      // are NOT typed — you type 9 then tap + to climb. '0' / non-digits reject.
      const lastChar = raw[raw.length - 1] ?? '';
      if (!/[1-9]/.test(lastChar)) {
        clearPendingAdvanceTimer(idx);
        return;
      }
      setCurrentInputs((prev) => ({ ...prev, [member.playerId]: lastChar }));
      clearPendingAdvanceTimer(idx);
      // Always advance to the next player right after one digit (Josh: "I always
      // want the tab to advance after you type one number"). No debounce.
      advanceFocus(idx);
    },
    [advanceFocus, clearPendingAdvanceTimer],
  );

  // − / + steppers (Josh): adjust a player's score in place, 1..20, WITHOUT
  // advancing — the only way to reach 10-20 (you can't type two digits). + from
  // empty starts at 1; − on empty is a no-op.
  const handleStep = useCallback(
    (member: Member, idx: number, delta: 1 | -1) => {
      clearPendingAdvanceTimer(idx);
      setCurrentInputs((prev) => {
        const cur = parseInt(prev[member.playerId] ?? '', 10);
        if (Number.isNaN(cur)) {
          if (delta < 0) return prev; // nothing to decrement
          return { ...prev, [member.playerId]: '1' };
        }
        const next = Math.max(1, Math.min(20, cur + delta));
        return { ...prev, [member.playerId]: String(next) };
      });
    },
    [clearPendingAdvanceTimer],
  );

  // Putts steppers (putting-game players only): 0..15, in place, no advance.
  const handlePuttsStep = useCallback((member: Member, delta: 1 | -1) => {
    setCurrentPutts((prev) => {
      const cur = parseInt(prev[member.playerId] ?? '', 10);
      const base = Number.isNaN(cur) ? 0 : cur;
      const next = Math.max(0, Math.min(15, base + delta));
      return { ...prev, [member.playerId]: String(next) };
    });
  }, []);

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
        const grossStrokes = parseInt(score!, 10);
        // Putts: for a putting-game player, save what the scorer entered (the
        // per-hole stepper). For everyone else, PRESERVE any putts the server
        // already has (never overwrite to null on a re-save) — the entry UI
        // shows no putts field for them.
        const priorPutts =
          data.myFoursome.holeScores.find(
            (hs) => hs.playerId === member.playerId && hs.holeNumber === currentHole,
          )?.putts ?? null;
        let putts: number | null = priorPutts;
        if (puttsPlayerIds.has(member.playerId)) {
          const entered = currentPutts[member.playerId];
          if (entered != null && entered !== '') {
            const n = parseInt(entered, 10);
            // Defensive clamp — the stepper only ever sets 0..15, but never let a
            // stray value serialize to NaN (→ null) or out of the server's range.
            putts = Number.isFinite(n) ? Math.max(0, Math.min(15, n)) : null;
          } else {
            putts = null;
          }
        }
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

    // Optimistic advance: in forward-scoring mode, mark this hole filled locally
    // so the form jumps to the next hole NOW (sync runs in the background). When
    // reviewing/fixing a past hole (manualHole set), stay put.
    if (manualHole === null) {
      setOptimisticFilled((prev) => {
        if (prev.has(currentHole)) return prev;
        return new Set(prev).add(currentHole);
      });
    }

    // Trigger drain immediately if online; queue's setTimeout heartbeat
    // handles offline gracefully.
    void queue.drain();
  }, [allValid, currentHole, currentInputs, currentPutts, puttsPlayerIds, data.myFoursome.holeScores, isSaving, manualHole, markMutation, members, persistClientEventIdCache, roundId, queue]);

  // Toggle a claim for (player, current hole, type). A toggle ON enqueues a
  // `set` op; a toggle OFF enqueues a `remove` op (removal is a queued mutation
  // too — never a client-only delete). Both carry a fresh clientEventId so the
  // append-only log records each as a distinct write (idempotent on replay).
  const handleToggleClaim = useCallback(
    (playerId: string, claimType: ClaimType) => {
      if (currentHole === null) return;
      const key = `${playerId}:${currentHole}:${claimType}`;
      const currentlyActive = claimState.has(key);
      const op: 'set' | 'remove' = currentlyActive ? 'remove' : 'set';
      // Optimistic local toggle.
      setClaimState((prev) => {
        const next = new Set(prev);
        if (op === 'set') next.add(key);
        else next.delete(key);
        return next;
      });
      const clientEventId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      void enqueueMutation({
        kind: 'claim',
        url: `/api/rounds/${roundId}/claims`,
        body: { playerId, holeNumber: currentHole, claimType, op, clientEventId },
        clientEventId,
        roundId,
      })
        .then(() => queue.drain())
        .catch(() => {
          // Enqueue failed — revert the optimistic toggle so the chip reflects
          // reality. The queue drains on reconnect for already-enqueued writes.
          setClaimState((prev) => {
            const next = new Set(prev);
            if (op === 'set') next.delete(key);
            else next.add(key);
            return next;
          });
        });
    },
    [currentHole, claimState, roundId, queue],
  );

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
        <button
          data-testid="review-holes"
          onClick={() => goToHole(holesToPlay)}
          style={{ minHeight: 'var(--control-height-lg)', padding: '0 var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', fontWeight: 600, cursor: 'pointer', marginTop: 'var(--space-3)' }}
        >
          ‹ Review / fix a hole
        </button>
      </div>
    );
  }

  // Scorecard-shell: par + SI for the current hole, populated from course data.
  const currentHoleInfo = course?.holes.find((h) => h.holeNumber === currentHole);
  const par = currentHoleInfo?.par ?? 4;
  const enteredCount = members.filter((m) => SCORE_RE.test(currentInputs[m.playerId] ?? '')).length;

  // Bonus toggles available on THIS hole. A greenie (closest-to-pin) can only
  // happen on a par 3, so the G toggle only appears when this hole's par is 3 —
  // read live from the course's hole data (never hard-coded), so it's correct on
  // any course and updates as you Prev/Next between holes. While course data is
  // still loading (par defaults to 4) greenie stays hidden, the safe fail-closed
  // default. Polie and sandie can happen on any hole, so they always show.
  // Colors MATCH the leaderboard scorecard bonus dots (components/hole-badge.tsx):
  // greenie = emerald-500, polie = amber-400, sandie = orange-500 — so a color
  // means the same thing on both screens. These are bright fills, so the active
  // letter is dark (see the toggle style) for WCAG-AA contrast.
  //
  // A claim button is HIDDEN when its modifier is OFF in the round's pinned config
  // (Josh 2026-06-25 — disabled bonuses don't appear on score entry). The server
  // sends the ON set in `enabledClaimTypes`; `null`/absent (un-pinned, non-F1, or
  // an older server build) means "show all three" — today's behavior, no regression.
  const enabledClaimTypes = data.myFoursome.enabledClaimTypes;
  const isClaimEnabled = (t: ClaimType): boolean =>
    enabledClaimTypes == null || enabledClaimTypes.includes(t);
  const bonusButtons: Array<[ClaimType, string, string]> = [
    ...(par === 3 ? [['greenie', 'G', '#10b981'] as [ClaimType, string, string]] : []),
    ['polie', 'P', '#fbbf24'],
    ['sandie', 'S', '#f97316'],
  ].filter((b) => isClaimEnabled((b as [ClaimType, string, string])[0])) as Array<
    [ClaimType, string, string]
  >;

  // 2v2 team grouping. Members are slot-ordered (load-bearing), so in the Guyan
  // 2v2 shape slots 1&2 are Team 1 and slots 3&4 are Team 2 (mirrors the engine's
  // resolveFoursomeTeams). A full 4-player foursome IS that shape; a smaller
  // foursome renders flat (single group, no team chrome). Color scheme (Josh):
  // black + green — Team 1 is plain (neutral), Team 2 gets a single green accent
  // that ties back to the green HOLE header, so the palette stays cohesive (no
  // competing hues).
  const teamAccent = (teamIdx: number): string | null => (teamIdx === 0 ? null : 'var(--color-brand-primary)');
  const teams: Member[][] = members.length === 4 ? [members.slice(0, 2), members.slice(2, 4)] : [members];

  return (
    <div data-testid="score-entry-form">
      {/* Organizer group switcher: the organizer (not in any group) opened a
          group to score — let them jump between groups. Each button reloads with
          ?foursome=N. Players never see this (viewerIsOrganizer is false). */}
      {data.myFoursome.viewerIsOrganizer && (data.myFoursome.availableFoursomes?.length ?? 0) > 1 ? (
        <div data-testid="organizer-group-switch" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Scoring group:</span>
          {data.myFoursome.availableFoursomes!.map((n) => {
            const active = n === data.myFoursome.foursomeNumber;
            return (
              <a
                key={n}
                data-testid={`organizer-group-${n}`}
                href={`/rounds/${roundId}/score-entry?foursome=${n}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44,
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textDecoration: 'none', fontWeight: 700,
                  color: active ? '#fff' : 'var(--color-text-secondary)',
                  background: active ? 'var(--color-brand-primary)' : 'var(--color-surface)',
                }}
              >
                {n}
              </a>
            );
          })}
        </div>
      ) : null}
      {/* Nav row — a way OUT of the scoring screen (Josh: "a way back from inside
          scoring"). Back to the event home on the left, the live leaderboard on
          the right. Both 44px tap targets. */}
      {data.eventId !== null && (
        <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          <a
            data-testid="back-to-event-link"
            href={`/events/${data.eventId}`}
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 var(--space-2)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-sm)', fontWeight: 600, textDecoration: 'none' }}
          >
            ← Event
          </a>
          <a
            data-testid="score-leaderboard-link"
            href={`/events/${data.eventId}/leaderboard`}
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', color: 'var(--color-brand-primary)', fontSize: 'var(--font-sm)', fontWeight: 700, textDecoration: 'none' }}
          >
            Leaderboard →
          </a>
        </nav>
      )}
      {/* Sticky hole header — big hole number, par/SI, sync pill (no more
          "Hole 4All synced" run-together). */}
      <header
        style={{
          position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-surface)',
          boxShadow: 'var(--shadow-card)', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 'var(--space-3)',
        }}
      >
        <div>
          <span
            data-testid="current-hole"
            style={{ fontSize: 'var(--font-2xl)', fontWeight: 800, color: 'var(--color-brand-primary)', textTransform: 'uppercase', lineHeight: 1 }}
          >
            Hole {currentHole}
          </span>
          {currentHoleInfo && (
            <div data-testid="scorecard-shell-strip" style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-sm)', marginTop: 2 }}>
              Par {currentHoleInfo.par} · SI {currentHoleInfo.si}
            </div>
          )}
        </div>
        <span
          data-testid="sync-chip"
          style={{
            fontSize: 'var(--font-xs)', fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap',
            background: queue.pendingCount > 0 ? 'var(--color-warning-bg)' : 'var(--color-brand-tint)',
            color: queue.pendingCount > 0 ? 'var(--color-accent)' : 'var(--color-success)',
          }}
        >
          {queue.pendingCount > 0 ? `${queue.pendingCount} queued` : 'All synced'}
        </span>
      </header>

      {/* One elevated card per player — name + Hcp, a RECESSED score well, and the
          color-coded G / P / S bonus toggles all together (best for 2v2; you see
          a player's score and their bonuses in one place). Depth comes from the
          raised card (border + shadow) sitting over the near-black page, and the
          sunken, inset-shadowed score input reading as a pressed-in well. Tapping
          a number auto-advances to the next player (Wolf-style). The trailing
          padding keeps the last card clear of the sticky Save bar. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)', paddingBottom: 112 }}>
        {teams.map((team, teamIdx) => {
          const accent = teamAccent(teamIdx); // null = plain (Team 1), green (Team 2)
          return (
            <div key={teamIdx} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {/* Team header — only when there's a real 2v2 split to separate. */}
              {teams.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: accent ?? 'var(--color-text-muted)', flex: '0 0 auto' }} />
                  <span style={{ fontSize: 'var(--font-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
                    Team {teamIdx + 1}
                  </span>
                </div>
              )}
              {team.map((member) => {
                const idx = members.indexOf(member);
                const raw = currentInputs[member.playerId] ?? '';
                const sc = parseInt(raw, 10);
                const scoreColor = Number.isNaN(sc)
                  ? 'var(--color-text-muted)'
                  : sc < par ? 'var(--color-success)' : sc > par ? 'var(--color-accent)' : 'var(--color-text-primary)';
                const displayName = shortPlayerName(member.name);
                return (
                  <div
                    key={member.playerId}
                    className="card"
                    style={{
                      padding: 'var(--space-3)', borderRadius: 22,
                      border: '1px solid var(--color-border)',
                      // Team 2 gets a green left-edge stripe tying its two teammates
                      // together; Team 1 stays plain (neutral border).
                      ...(accent ? { borderLeft: `4px solid ${accent}` } : {}),
                      boxShadow: 'var(--shadow-card)',
                    }}
                  >
                    {/* name + Hcp on the left, the recessed score well on the right */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--font-md)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={member.name}>
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)', marginRight: 6 }}>{idx + 1}</span>{displayName}
                        </div>
                        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                          HI {member.handicapIndex != null ? member.handicapIndex.toFixed(1) : '—'}
                          {member.courseHandicap != null ? ` · CH ${member.courseHandicap}` : ''}
                        </div>
                      </div>
                      {/* − [score] + : type a single digit (auto-advances); use the
                          steppers to fix a value or climb past 9 (no advance). */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
                        <button
                          type="button"
                          data-testid={`score-minus-${idx}`}
                          aria-label={`Decrease score for ${member.name}`}
                          onClick={() => handleStep(member, idx, -1)}
                          style={{
                            width: 44, height: 56, flex: '0 0 auto', borderRadius: 'var(--radius-md)',
                            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                            color: 'var(--color-text-secondary)', fontSize: 'var(--font-xl)', fontWeight: 800,
                            lineHeight: 1, padding: 0, margin: 0, cursor: 'pointer',
                          }}
                        >
                          −
                        </button>
                        <input
                          ref={(el) => { scoreInputRefs.current[idx] = el; }}
                          data-testid={`score-input-${idx}`} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2}
                          aria-label={`Score for ${member.name}`}
                          value={raw} onChange={(e) => handleScoreChange(member, idx, e.target.value)} onBlur={() => handleBlur(idx)}
                          style={{
                            width: 64, minHeight: 56, flex: '0 0 auto', textAlign: 'center',
                            fontSize: 'var(--font-2xl)', fontWeight: 800, color: scoreColor, margin: 0, padding: '4px 0',
                            background: 'var(--color-surface-sunken)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-lg)',
                            boxShadow: 'inset 0 2px 4px rgb(0 0 0 / 0.45)',
                          }}
                        />
                        <button
                          type="button"
                          data-testid={`score-plus-${idx}`}
                          aria-label={`Increase score for ${member.name}`}
                          onClick={() => handleStep(member, idx, 1)}
                          style={{
                            width: 44, height: 56, flex: '0 0 auto', borderRadius: 'var(--radius-md)',
                            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                            color: 'var(--color-text-secondary)', fontSize: 'var(--font-xl)', fontWeight: 800,
                            lineHeight: 1, padding: 0, margin: 0, cursor: 'pointer',
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    {/* Putts (putting-game players only): a small per-hole number
                        with −/+ steppers, so each hole's putts are visible/editable.
                        Steppers (not typing) keep it from fighting the score input's
                        auto-advance. Hidden entirely when no putting game is on. */}
                    {puttsPlayerIds.has(member.playerId) && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border-subtle)' }}>
                        <span style={{ fontSize: 'var(--font-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                          Putts
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            data-testid={`putts-minus-${idx}`}
                            aria-label={`Decrease putts for ${member.name}`}
                            onClick={() => handlePuttsStep(member, -1)}
                            style={{ width: 44, height: 44, flex: '0 0 auto', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-lg)', fontWeight: 800, lineHeight: 1, padding: 0, margin: 0, cursor: 'pointer' }}
                          >
                            −
                          </button>
                          <span data-testid={`putts-value-${idx}`} style={{ minWidth: 30, textAlign: 'center', fontSize: 'var(--font-lg)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: currentPutts[member.playerId] ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                            {currentPutts[member.playerId] ?? '–'}
                          </span>
                          <button
                            type="button"
                            data-testid={`putts-plus-${idx}`}
                            aria-label={`Increase putts for ${member.name}`}
                            onClick={() => handlePuttsStep(member, 1)}
                            style={{ width: 44, height: 44, flex: '0 0 auto', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-lg)', fontWeight: 800, lineHeight: 1, padding: 0, margin: 0, cursor: 'pointer' }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Bonuses, in the same card, below a hairline divider. Circular
                        toggles (no square corners) in the SAME colors as the
                        leaderboard scorecard dots (emerald / amber / orange), with a
                        dark letter on the bright active fill for contrast. The whole
                        row is hidden when every claim-modifier is OFF in the pinned
                        config (bonusButtons empty) — no orphaned "Bonus" label. */}
                    {bonusButtons.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border-subtle)' }}>
                      <span style={{ fontSize: 'var(--font-xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                        Bonus
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {bonusButtons.map(([type, letter, color]) => {
                          const on = claimState.has(`${member.playerId}:${currentHole}:${type}`);
                          return (
                            <button
                              key={type}
                              type="button"
                              data-testid={`claim-${type}-${member.playerId}`}
                              aria-pressed={on}
                              aria-label={`${on ? 'Remove' : 'Add'} ${CLAIM_LABELS[type]} for ${member.name} on hole ${currentHole}`}
                              onClick={() => handleToggleClaim(member.playerId, type)}
                              style={{
                                width: 44, height: 44, flex: '0 0 auto', borderRadius: '50%',
                                fontSize: 'var(--font-sm)', fontWeight: 800, padding: 0, margin: 0, cursor: 'pointer',
                                border: `1px solid ${on ? color : 'var(--color-border)'}`,
                                background: on ? color : 'transparent',
                                color: on ? '#0a0a0a' : 'var(--color-text-muted)',
                              }}
                            >
                              {letter}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {saveError !== null && (
        <div data-testid="save-error" role="alert" style={{ color: 'var(--color-danger)', marginTop: 'var(--space-3)' }}>
          {saveError}
        </div>
      )}

      {/* Sticky bottom Save bar with live progress. */}
      <div data-testid="save-bar" style={{ position: 'sticky', bottom: 0, marginTop: 'var(--space-4)', paddingTop: 'var(--space-2)', paddingBottom: 'calc(var(--space-2) + env(safe-area-inset-bottom))', background: 'var(--color-surface-sunken)' }}>
        {!allValid && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>
            <span>{enteredCount} of {members.length} entered</span>
            <button data-testid="skip-hole" data-skip-base-style onClick={handleSkipHole} style={{ background: 'none', border: 'none', color: 'var(--color-brand-primary)', fontWeight: 600, minHeight: 44, padding: '0 var(--space-2)', margin: 0, cursor: 'pointer' }}>
              Skip hole
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 'var(--space-2)' }}>
          <button
            data-testid="prev-hole"
            aria-label="Previous hole"
            disabled={currentHole <= 1}
            onClick={() => goToHole(currentHole - 1)}
            style={{
              flex: '0 0 auto', minWidth: 56, minHeight: 'var(--control-height-lg)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)',
              fontSize: 'var(--font-lg)', fontWeight: 700, margin: 0, padding: 0,
              cursor: currentHole <= 1 ? 'default' : 'pointer', opacity: currentHole <= 1 ? 0.4 : 1,
            }}
          >
            ‹
          </button>
          <button
            data-testid="save-button" disabled={!allValid || isSaving} onClick={handleSave}
            style={{ flex: 1, minHeight: 'var(--control-height-lg)', fontSize: 'var(--font-md)', borderRadius: 'var(--radius-md)', margin: 0, boxShadow: 'var(--shadow-raised)' }}
          >
            {isSaving ? 'Saving…' : `Save Hole ${currentHole}`}
          </button>
          <button
            data-testid="next-hole"
            aria-label="Next hole"
            disabled={currentHole >= holesToPlay}
            onClick={() => goToHole(currentHole + 1)}
            style={{
              flex: '0 0 auto', minWidth: 56, minHeight: 'var(--control-height-lg)', borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)',
              fontSize: 'var(--font-lg)', fontWeight: 700, margin: 0, padding: 0,
              cursor: currentHole >= holesToPlay ? 'default' : 'pointer', opacity: currentHole >= holesToPlay ? 0.4 : 1,
            }}
          >
            ›
          </button>
        </div>
      </div>
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
