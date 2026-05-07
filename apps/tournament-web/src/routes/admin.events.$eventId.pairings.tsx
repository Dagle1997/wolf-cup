/**
 * T4-2 organizer pairings page at /admin/events/$eventId/pairings.
 *
 * Trip-critical hand-assign workflow: a grid of N rounds × M foursomes ×
 * 4 cells. Each cell is a `<select>` populated with the event's roster.
 * Pin (client-side, used by Regenerate). Lock-row (persisted as
 * pairings.locked). Save (POST upsert). Refresh (GET refetch).
 * Regenerate-unpinned (POST /pairings/suggest, calls T4-1 engine).
 *
 * Auth: 5-step auth-status loader; non-organizer → ForbiddenMessage.
 */

import { createFileRoute, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { queryClient as appQueryClient } from '../lib/query-client';

// ---- Loader ---------------------------------------------------------------

type AuthStatus = { player: null | { id: string; isOrganizer: boolean } };

function validateAuthStatus(body: unknown): AuthStatus {
  if (body === null || typeof body !== 'object') return { player: null };
  const p = (body as { player?: unknown }).player;
  if (p === null) return { player: null };
  if (
    p !== null &&
    typeof p === 'object' &&
    typeof (p as { id?: unknown }).id === 'string' &&
    typeof (p as { isOrganizer?: unknown }).isOrganizer === 'boolean'
  ) {
    return {
      player: {
        id: (p as { id: string }).id,
        isOrganizer: (p as { isOrganizer: boolean }).isOrganizer,
      },
    };
  }
  return { player: null };
}

async function loadAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status').catch(() => null);
  if (res === null || !res.ok) return { player: null };
  const body = (await res.json().catch(() => null)) as unknown;
  if (body === null) return { player: null };
  return validateAuthStatus(body);
}

// ---- Types ----------------------------------------------------------------

const FOURSOME_SIZE = 4;
const EMPTY = '__EMPTY__';

type RosterEntry = { playerId: string; name: string };

type GetPairingsResponse = {
  event: { id: string; name: string };
  rounds: Array<{
    eventRoundId: string;
    roundNumber: number;
    roundDate: number;
    defaultTeeColor: string;
    availableTees: string[];
    pairings: Array<{
      id: string;
      foursomeNumber: number;
      locked: boolean;
      members: Array<{
        playerId: string;
        name: string;
        slotNumber: number;
        teeColor: string | null;
      }>;
    }>;
  }>;
  roster: RosterEntry[];
};

type Cell = { playerId: string; teeColor: string | null };

type GridRound = {
  eventRoundId: string;
  roundNumber: number;
  locked: boolean;
  defaultTeeColor: string;
  availableTees: string[];
  // foursomes[foursomeIdx][slotIdx] = { playerId | EMPTY, teeColor }
  foursomes: Cell[][];
};

// ---- Component ------------------------------------------------------------

export type PairingsPageProps = { eventId: string };

export function PairingsPage({ eventId }: PairingsPageProps) {
  const queryClient = useQueryClient();
  const [foursomesPerRound, setFoursomesPerRound] = useState(2);
  const [grid, setGrid] = useState<GridRound[]>([]);
  const [pins, setPins] = useState<Set<string>>(new Set()); // key: `${roundIdx}-${foursomeIdx}-${slotIdx}`
  const [errorText, setErrorText] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const inFlightControllers = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const set = inFlightControllers.current;
    return () => {
      for (const ac of set) ac.abort();
      set.clear();
    };
  }, []);

  function track(): AbortController {
    const ac = new AbortController();
    inFlightControllers.current.add(ac);
    return ac;
  }
  function release(ac: AbortController): void {
    inFlightControllers.current.delete(ac);
  }

  const queryKey = ['event-pairings', eventId] as const;
  const query = useQuery<GetPairingsResponse, Error>({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/admin/events/${encodeURIComponent(eventId)}/pairings`,
        { credentials: 'same-origin', signal },
      );
      if (!res.ok) throw new Error(`http_${res.status}`);
      return (await res.json()) as GetPairingsResponse;
    },
    retry: false,
    staleTime: 30_000,
  });

  // Initialize grid on first data load (and on refetch).
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    const next: GridRound[] = data.rounds.map((r) => {
      const foursomes: Cell[][] = [];
      for (let f = 0; f < foursomesPerRound; f++) {
        const persisted = r.pairings.find((p) => p.foursomeNumber === f + 1);
        const slots: Cell[] = new Array(FOURSOME_SIZE)
          .fill(null)
          .map(() => ({ playerId: EMPTY, teeColor: null }));
        if (persisted) {
          for (const m of persisted.members) {
            const slotIdx = m.slotNumber - 1;
            if (slotIdx >= 0 && slotIdx < FOURSOME_SIZE) {
              slots[slotIdx] = { playerId: m.playerId, teeColor: m.teeColor };
            }
          }
        }
        foursomes.push(slots);
      }
      const anyLocked = r.pairings.some((p) => p.locked);
      return {
        eventRoundId: r.eventRoundId,
        roundNumber: r.roundNumber,
        locked: anyLocked,
        // Defensive defaults: if a deployed server hasn't yet shipped the
        // tee-picker fields (rolling deploy or stale cache), the page
        // degrades to "no per-player tee picker available" rather than
        // throwing on undefined.filter / undefined display.
        defaultTeeColor: r.defaultTeeColor ?? 'blue',
        availableTees: r.availableTees ?? [],
        foursomes,
      };
    });
    setGrid(next);
  }, [data, foursomesPerRound]);

  // ---- Save mutation -----------------------------------------------------

  const saveMutation = useMutation<
    { pairingCount: number; memberCount: number },
    Error & { code?: string; conflicts?: unknown[] }
  >({
    mutationFn: async () => {
      const ac = track();
      try {
        // Build memberPlayerIds in the API's hybrid format: bare-string when
        // the player has no per-player tee override (compact, matches v1
        // wire format); object form when teeColor is set so the server
        // persists the override on `pairing_members.tee_color`.
        const body = {
          rounds: grid.map((r) => ({
            eventRoundId: r.eventRoundId,
            pairings: r.foursomes
              .map((slots, fIdx) => {
                const filled = slots.filter((s) => s.playerId !== EMPTY);
                if (filled.length === 0) return null;
                const memberPlayerIds = filled.map((c) =>
                  c.teeColor !== null
                    ? { playerId: c.playerId, teeColor: c.teeColor }
                    : c.playerId,
                );
                return {
                  foursomeNumber: fIdx + 1,
                  locked: r.locked,
                  memberPlayerIds,
                };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null),
          })),
        };
        const res = await fetch(
          `/api/admin/events/${encodeURIComponent(eventId)}/pairings`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            signal: ac.signal,
            body: JSON.stringify(body),
          },
        );
        const json = (await res.json().catch(() => null)) as
          | (
              & { pairingCount?: number; memberCount?: number; code?: string }
              & { conflicts?: unknown[] }
            )
          | null;
        if (!res.ok) {
          const code = json?.code;
          const err = new Error(code ?? `http_${res.status}`) as Error & {
            code?: string;
            conflicts?: unknown[];
          };
          if (code !== undefined) err.code = code;
          if (json?.conflicts !== undefined) err.conflicts = json.conflicts;
          throw err;
        }
        return json as { pairingCount: number; memberCount: number };
      } finally {
        release(ac);
      }
    },
    onSuccess: () => {
      setErrorText(null);
      setSavedAt(Date.now());
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      if (err.name === 'AbortError') return;
      const code = err.code;
      let msg = 'Save failed. Try again.';
      if (code === 'player_in_multiple_pairings_per_round') {
        const conflicts = err.conflicts as
          | Array<{
              playerId: string;
              eventRoundId: string;
              foursomeNumbers: number[];
            }>
          | undefined;
        if (conflicts && conflicts.length > 0) {
          const names = conflicts
            .map((c) => {
              const p = data?.roster.find((r) => r.playerId === c.playerId);
              const round = grid.find((r) => r.eventRoundId === c.eventRoundId);
              return `${p?.name ?? c.playerId} in round ${round?.roundNumber ?? '?'}`;
            })
            .join(', ');
          msg = `Player ${names} appears in multiple foursomes. Pick a different player.`;
        }
      } else if (code === 'duplicate_player_in_foursome') {
        msg = 'A player appears twice in the same foursome.';
      } else if (code === 'unknown_player') {
        msg = "One of the players isn't on this event's roster.";
      } else if (code === 'unknown_event_round') {
        msg = 'Internal error: unknown event_round_id.';
      } else if (code === 'invalid_body') {
        msg = 'Invalid input. Check the form.';
      } else if (code === 'event_not_found') {
        msg = "This event doesn't exist anymore.";
      }
      setSavedAt(null);
      setErrorText(msg);
    },
  });

  // ---- Regenerate mutation -----------------------------------------------

  const regenMutation = useMutation<
    { grid: { rounds: Array<{ round: number; foursomes: Array<{ foursome: number; playerIds: string[] }> }> }; warnings: string[] },
    Error
  >({
    mutationFn: async () => {
      const ac = track();
      try {
        // Translate UI pins (per-cell) into engine pins (per-foursome).
        // Engine pins are { round, foursome, playerId } — round/foursome
        // are 1-indexed.
        const enginePins: Array<{ round: number; foursome: number; playerId: string }> = [];
        for (let rIdx = 0; rIdx < grid.length; rIdx++) {
          const r = grid[rIdx]!;
          for (let fIdx = 0; fIdx < r.foursomes.length; fIdx++) {
            for (let sIdx = 0; sIdx < r.foursomes[fIdx]!.length; sIdx++) {
              const cellKey = `${rIdx}-${fIdx}-${sIdx}`;
              const cell = r.foursomes[fIdx]![sIdx]!;
              if (pins.has(cellKey) && cell.playerId !== EMPTY) {
                enginePins.push({
                  round: r.roundNumber,
                  foursome: fIdx + 1,
                  playerId: cell.playerId,
                });
              }
            }
          }
        }
        const lockedRounds = grid.filter((r) => r.locked).map((r) => r.roundNumber);
        const body = {
          numRounds: grid.length,
          foursomesPerRound,
          pins: enginePins,
          lockedRounds,
        };
        const res = await fetch(
          `/api/admin/events/${encodeURIComponent(eventId)}/pairings/suggest`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            signal: ac.signal,
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) throw new Error(`http_${res.status}`);
        return (await res.json()) as {
          grid: {
            rounds: Array<{
              round: number;
              foursomes: Array<{ foursome: number; playerIds: string[] }>;
            }>;
          };
          warnings: string[];
        };
      } finally {
        release(ac);
      }
    },
    onSuccess: (resp) => {
      // Merge engine output into grid: replace unlocked rounds. Newly-suggested
      // cells get teeColor=null (round default); existing cells whose player
      // didn't change keep their teeColor.
      setGrid((prev) =>
        prev.map((r) => {
          if (r.locked) return r;
          const engineRound = resp.grid.rounds.find(
            (er) => er.round === r.roundNumber,
          );
          if (!engineRound) return r;
          const next: Cell[][] = [];
          for (let f = 0; f < foursomesPerRound; f++) {
            const engineFs = engineRound.foursomes.find(
              (ef) => ef.foursome === f + 1,
            );
            const slots: Cell[] = new Array(FOURSOME_SIZE)
              .fill(null)
              .map(() => ({ playerId: EMPTY, teeColor: null }));
            if (engineFs) {
              for (let i = 0; i < Math.min(engineFs.playerIds.length, FOURSOME_SIZE); i++) {
                const newPlayerId = engineFs.playerIds[i]!;
                // Preserve teeColor if the same player is still in this cell.
                const prevCell = r.foursomes[f]?.[i];
                const teeColor =
                  prevCell !== undefined && prevCell.playerId === newPlayerId
                    ? prevCell.teeColor
                    : null;
                slots[i] = { playerId: newPlayerId, teeColor };
              }
            }
            next.push(slots);
          }
          return { ...r, foursomes: next };
        }),
      );
      setWarnings(resp.warnings);
    },
  });

  // ---- Render ------------------------------------------------------------

  const isDirty = useMemo<boolean>(() => {
    if (!data) return false;
    if (grid.length !== data.rounds.length) return true;
    for (let rIdx = 0; rIdx < grid.length; rIdx++) {
      const r = grid[rIdx]!;
      const dataRound = data.rounds[rIdx]!;
      for (let fIdx = 0; fIdx < foursomesPerRound; fIdx++) {
        const persisted = dataRound.pairings.find(
          (p) => p.foursomeNumber === fIdx + 1,
        );
        const persistedSlots: Cell[] = new Array(FOURSOME_SIZE)
          .fill(null)
          .map(() => ({ playerId: EMPTY, teeColor: null }));
        if (persisted) {
          for (const m of persisted.members) {
            const slotIdx = m.slotNumber - 1;
            if (slotIdx >= 0 && slotIdx < FOURSOME_SIZE) {
              persistedSlots[slotIdx] = { playerId: m.playerId, teeColor: m.teeColor };
            }
          }
        }
        const draftSlots = r.foursomes[fIdx]!;
        for (let s = 0; s < FOURSOME_SIZE; s++) {
          const a = draftSlots[s]!;
          const b = persistedSlots[s]!;
          if (a.playerId !== b.playerId) return true;
          if (a.teeColor !== b.teeColor) return true;
        }
        const draftLocked = r.locked;
        const persistedLocked = persisted?.locked ?? false;
        if (draftLocked !== persistedLocked) return true;
      }
    }
    return false;
  }, [data, grid, foursomesPerRound]);

  if (query.isLoading) return <div>Loading…</div>;
  if (query.isError) return <div role="alert">Couldn&apos;t load pairings.</div>;
  if (!data) return <div>Loading…</div>;

  function setCell(rIdx: number, fIdx: number, sIdx: number, value: string) {
    setGrid((prev) =>
      prev.map((r, ri) => {
        if (ri !== rIdx) return r;
        const next = r.foursomes.map((fs, fi) =>
          fi === fIdx
            ? fs.map((cur, si) =>
                si === sIdx ? { playerId: value, teeColor: cur.teeColor } : cur,
              )
            : fs,
        );
        return { ...r, foursomes: next };
      }),
    );
  }

  // Set per-player tee override. value === '' means "use round default"
  // (sends null to the server). Persists as `pairing_members.tee_color`.
  function setCellTee(rIdx: number, fIdx: number, sIdx: number, value: string) {
    setGrid((prev) =>
      prev.map((r, ri) => {
        if (ri !== rIdx) return r;
        const next = r.foursomes.map((fs, fi) =>
          fi === fIdx
            ? fs.map((cur, si) =>
                si === sIdx
                  ? { playerId: cur.playerId, teeColor: value === '' ? null : value }
                  : cur,
              )
            : fs,
        );
        return { ...r, foursomes: next };
      }),
    );
  }

  function togglePin(rIdx: number, fIdx: number, sIdx: number) {
    const key = `${rIdx}-${fIdx}-${sIdx}`;
    setPins((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRoundLock(rIdx: number) {
    setGrid((prev) =>
      prev.map((r, ri) => (ri === rIdx ? { ...r, locked: !r.locked } : r)),
    );
  }

  return (
    <div>
      <h1>Pairings — {data.event.name}</h1>
      <div>
        <label>
          Foursomes per round:{' '}
          <input
            type="number"
            min="1"
            max="8"
            value={foursomesPerRound}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 1 && n <= 8) {
                setFoursomesPerRound(n);
              }
            }}
            data-testid="foursomes-per-round"
          />
        </label>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !isDirty}
          data-testid="save-button"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          data-testid="refresh-button"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => regenMutation.mutate()}
          disabled={regenMutation.isPending}
          data-testid="regenerate-button"
        >
          {regenMutation.isPending ? 'Regenerating…' : '🔀 Regenerate unpinned'}
        </button>
      </div>

      {warnings.length > 0 ? (
        <div role="alert" data-testid="warnings-banner">
          <strong>Warnings:</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {savedAt !== null ? <p role="status">Saved.</p> : null}
      {errorText !== null ? <p role="alert">{errorText}</p> : null}

      <table>
        <thead>
          <tr>
            <th>Round</th>
            <th>Lock</th>
            {Array.from({ length: foursomesPerRound }, (_, fIdx) => (
              <th key={fIdx} colSpan={FOURSOME_SIZE}>
                Foursome {fIdx + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((r, rIdx) => (
            <tr key={r.eventRoundId} data-testid={`round-row-${rIdx}`}>
              <td>{r.roundNumber}</td>
              <td>
                <button
                  type="button"
                  onClick={() => toggleRoundLock(rIdx)}
                  data-testid={`lock-round-${rIdx}`}
                >
                  {r.locked ? '🔒 Locked' : '🔓 Lock round'}
                </button>
              </td>
              {r.foursomes.map((slots, fIdx) =>
                slots.map((cell, sIdx) => {
                  const cellKey = `${rIdx}-${fIdx}-${sIdx}`;
                  const pinned = pins.has(cellKey);
                  const teeSelectValue = cell.teeColor ?? '';
                  return (
                    <td key={cellKey} data-testid={`cell-${rIdx}-${fIdx}-${sIdx}`}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <select
                          value={cell.playerId}
                          onChange={(e) => setCell(rIdx, fIdx, sIdx, e.target.value)}
                          disabled={r.locked}
                          data-testid={`select-${rIdx}-${fIdx}-${sIdx}`}
                        >
                          <option value={EMPTY}>(empty)</option>
                          {data.roster.map((p) => (
                            <option key={p.playerId} value={p.playerId}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={teeSelectValue}
                          onChange={(e) =>
                            setCellTee(rIdx, fIdx, sIdx, e.target.value)
                          }
                          disabled={r.locked || cell.playerId === EMPTY}
                          data-testid={`tee-${rIdx}-${fIdx}-${sIdx}`}
                          title={`Round default: ${r.defaultTeeColor}`}
                          style={{ fontSize: '0.85em' }}
                        >
                          <option value="">{`tee: ${r.defaultTeeColor} (default)`}</option>
                          {r.availableTees
                            .filter((t) => t !== r.defaultTeeColor)
                            .map((t) => (
                              <option key={t} value={t}>
                                tee: {t}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => togglePin(rIdx, fIdx, sIdx)}
                          disabled={r.locked}
                          data-testid={`pin-${rIdx}-${fIdx}-${sIdx}`}
                          title={pinned ? 'Pinned' : 'Pin'}
                        >
                          {pinned ? '📌' : '📍'}
                        </button>
                      </div>
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Route ----------------------------------------------------------------

export const Route = createFileRoute('/admin/events/$eventId/pairings')({
  beforeLoad: async () => {
    const status = await appQueryClient.ensureQueryData({
      queryKey: ['auth-status'],
      queryFn: loadAuthStatus,
      staleTime: 30_000,
      retry: false,
    });
    if (status.player === null) {
      window.location.assign('/api/auth/google');
      throw new Error('redirecting-to-oauth');
    }
    return { player: status.player };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  const { eventId } = useParams({ strict: false });
  if (!player.isOrganizer) return <ForbiddenMessage />;
  if (typeof eventId !== 'string') return <div>Invalid event.</div>;
  return <PairingsPage eventId={eventId} />;
}

function ForbiddenMessage() {
  return (
    <div>
      <h1>Forbidden</h1>
      <p>You need organizer access to view this page.</p>
    </div>
  );
}
