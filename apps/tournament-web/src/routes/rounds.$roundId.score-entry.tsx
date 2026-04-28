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
import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  enqueueMutation,
  registerTerminalErrors,
} from '../lib/offline-queue.js';
import { useOfflineQueue } from '../hooks/useOfflineQueue.js';

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

interface ApiError {
  status: number;
  code?: string;
  body?: unknown;
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
  const { data, isLoading, error } = useQuery<RoundDetail, ApiError>({
    queryKey: ['round-detail', roundId],
    queryFn: () => fetchRoundDetail(roundId),
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  // Register terminal errors for the 'hole_score' kind once at mount.
  useEffect(() => {
    registerTerminalErrors('hole_score', [
      'round_not_writable',
      'hole_number_exceeds_holes_to_play',
      'foursome_has_no_scorer',
      'invalid_body',
      'invalid_round_id',
      'invalid_hole_number',
    ]);
  }, []);

  if (isLoading) {
    return <div data-testid="loading">Loading…</div>;
  }
  if (error) {
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
    return (
      <div data-testid="read-only">
        <strong>{data.myFoursome.scorerName}</strong> is currently scoring
        foursome {data.myFoursome.foursomeNumber}.
      </div>
    );
  }

  return <ScoreEntryForm data={data} queue={queue} />;
}

// ---- ScoreEntryForm (the load-bearing piece) ------------------------------

function ScoreEntryForm({
  data,
  queue,
}: {
  data: RoundDetail;
  queue: ReturnType<typeof useOfflineQueue>;
}) {
  const { roundId, holesToPlay } = data;
  const members = data.myFoursome.members;

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

    // Trigger drain immediately if online; queue's setTimeout heartbeat
    // handles offline gracefully.
    void queue.drain();
  }, [allValid, currentHole, currentInputs, currentPutts, isSaving, members, persistClientEventIdCache, roundId, queue]);

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

  return (
    <div data-testid="score-entry-form">
      <header>
        <span data-testid="current-hole">Hole {currentHole}</span>
        <span data-testid="sync-chip">
          {queue.pendingCount > 0 ? `${queue.pendingCount} queued` : 'All synced'}
        </span>
      </header>

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

// ---- TanStack Router file-route -------------------------------------------

export const Route = createFileRoute('/rounds/$roundId/score-entry')({
  component: ScoreEntryRoute,
});
