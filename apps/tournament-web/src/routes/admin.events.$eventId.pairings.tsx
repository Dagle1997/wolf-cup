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
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

// ---- Loader ---------------------------------------------------------------


// ---- Types ----------------------------------------------------------------

const FOURSOME_SIZE = 4;
// Generous upper bound on foursomes/round — well above any real golf event
// (24 = 96 players), so a saved event is never special-cased or trapped, and an
// accidental − can always be undone with +.
const MAX_FOURSOMES = 24;
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
    // Size to the HIGHEST persisted foursome across rounds (default 2) so EVERY
    // saved foursome hydrates — never truncated to a default, which would show
    // saved foursomes as empty and let a save DELETE real pairings (codex/gemini
    // review). User count changes resize this grid in place (adjustCount) below.
    const count = data.rounds.reduce(
      (m, r) => r.pairings.reduce((mm, p) => Math.max(mm, p.foursomeNumber), m),
      2,
    );
    setFoursomesPerRound(count);
    const next: GridRound[] = data.rounds.map((r) => {
      const foursomes: Cell[][] = [];
      for (let f = 0; f < count; f++) {
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
    // Depends ONLY on `data`: count changes are handled imperatively by
    // `adjustCount` (resize-in-place, preserving unsaved edits). Re-running this
    // server-rebuild effect on a count change would wipe in-progress assignments
    // and leave Save dead at "one group" (Josh 2026-06-25).
  }, [data]);

  /** One empty foursome (4 unfilled slots). */
  function emptySlots(): Cell[] {
    return new Array(FOURSOME_SIZE).fill(null).map(() => ({ playerId: EMPTY, teeColor: null }));
  }

  // Mirror the latest count in a ref so `adjustCount` reads the current value even
  // on rapid taps (no stale closure) WITHOUT a nested state update inside an
  // updater (codex/gemini review). Re-synced to the rendered value every render.
  const countRef = useRef(foursomesPerRound);
  countRef.current = foursomesPerRound;

  /**
   * Change the foursome count by `delta`, RESIZING the existing grid in place:
   * keep filled foursomes, append empties when growing, trim extras when
   * shrinking. Never re-pulls from the server, so unsaved assignments survive and
   * Save stays enabled at one group. Clamped to [1, MAX_FOURSOMES] — high enough
   * that a saved event is never trimmed and a − is always undoable with +.
   */
  function adjustCount(delta: number): void {
    const prev = countRef.current;
    const clamped = Math.max(1, Math.min(MAX_FOURSOMES, prev + delta));
    if (clamped === prev) return;
    countRef.current = clamped;
    setFoursomesPerRound(clamped);
    setGrid((g) =>
      g.map((round) => {
        const foursomes = round.foursomes.slice(0, clamped);
        while (foursomes.length < clamped) foursomes.push(emptySlots());
        return { ...round, foursomes };
      }),
    );
  }

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
    // Pre-hydration: `data` arrived but the init effect hasn't built `grid` yet.
    // Treat as NOT dirty so Save can't fire an empty (destructive) payload in the
    // one-render window before hydration (codex review). After hydration grid has
    // one row per round, so this never masks a real change.
    if (grid.length === 0) return false;
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
        // When the foursome count was just INCREASED, this memo recomputes
        // with the new count before the grid-rebuild effect adds the empty
        // foursome rows — so r.foursomes[fIdx] can be undefined for one render.
        // Treat that transient as "dirty" rather than crashing on [s].
        const draftSlots = r.foursomes[fIdx];
        if (!draftSlots) return true;
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
      // Reducing the count DROPS any populated persisted foursome beyond the new
      // count on the next save — a save-worthy change the per-foursome loop above
      // (bounded by foursomesPerRound) can't see on its own.
      if (dataRound.pairings.some((p) => p.foursomeNumber > foursomesPerRound && p.members.length > 0)) {
        return true;
      }
    }
    return false;
  }, [data, grid, foursomesPerRound]);

  if (query.isLoading) {
    return (
      <PageShell title="Pairings">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Pairings">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" />
        <ErrorCard error="Couldn't load pairings." />
      </PageShell>
    );
  }
  if (!data) {
    return (
      <PageShell title="Pairings">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" />
        <LoadingCard />
      </PageShell>
    );
  }

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
    <PageShell title={`Pairings — ${data.event.name}`}>
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" />

      {/* Controls: count on its own row; Save is the only primary action. */}
      <div className="card" style={{ padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-3)' }}>
        {/* Tap-friendly stepper, not a bare number input — the number input was
            near-impossible to decrease on iPhone (clearing it hit the validation
            guard and snapped back, so it felt "stuck at 2"). Josh 2026-06-25. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', fontWeight: 600 }}>
          <span>Foursomes per round</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              type="button"
              aria-label="Fewer foursomes"
              data-testid="foursomes-minus"
              disabled={foursomesPerRound <= 1}
              onClick={() => adjustCount(-1)}
              style={{ minWidth: 44, minHeight: 44, fontSize: 'var(--font-xl)', fontWeight: 800, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer' }}
            >
              −
            </button>
            <span data-testid="foursomes-per-round" style={{ minWidth: 28, textAlign: 'center', fontSize: 'var(--font-lg)', fontWeight: 800 }}>
              {foursomesPerRound}
            </span>
            <button
              type="button"
              aria-label="More foursomes"
              data-testid="foursomes-plus"
              disabled={foursomesPerRound >= MAX_FOURSOMES}
              onClick={() => adjustCount(1)}
              style={{ minWidth: 44, minHeight: 44, fontSize: 'var(--font-xl)', fontWeight: 800, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer' }}
            >
              +
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !isDirty}
            data-testid="save-button"
            style={{ flex: 1, minHeight: 'var(--control-height)', background: 'var(--color-brand-primary)', color: '#fff', fontWeight: 700, border: 'none' }}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            data-testid="refresh-button"
            style={{ minHeight: 'var(--control-height)' }}
          >
            Refresh
          </button>
        </div>
        <button
          type="button"
          onClick={() => regenMutation.mutate()}
          disabled={regenMutation.isPending}
          data-testid="regenerate-button"
          style={{ width: '100%', minHeight: 'var(--control-height)', marginTop: 'var(--space-2)' }}
        >
          {regenMutation.isPending ? 'Regenerating…' : '🔀 Regenerate unpinned'}
        </button>
      </div>

      {warnings.length > 0 ? (
        <div role="alert" data-testid="warnings-banner" className="card" style={{ borderColor: 'var(--color-accent)', marginBottom: 'var(--space-3)' }}>
          <strong>Warnings:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {savedAt !== null ? <p role="status" style={{ color: 'var(--color-money-pos)', fontWeight: 600 }}>Saved.</p> : null}
      {errorText !== null ? <p role="alert" style={{ color: 'var(--color-money-neg)', fontWeight: 600 }}>{errorText}</p> : null}

      {/* One stacked card per round; within it, one card per foursome with its
          four player slots stacked vertically — no horizontal overflow. */}
      {grid.map((r, rIdx) => (
        <section
          key={r.eventRoundId}
          data-testid={`round-row-${rIdx}`}
          style={{ marginBottom: 'var(--space-4)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <strong style={{ fontSize: 'var(--font-md)' }}>Round {r.roundNumber}</strong>
            <button
              type="button"
              onClick={() => toggleRoundLock(rIdx)}
              data-testid={`lock-round-${rIdx}`}
              style={{ minHeight: 'var(--control-height)', background: r.locked ? 'var(--color-brand-tint)' : undefined, fontWeight: 600 }}
            >
              {r.locked ? '🔒 Locked' : '🔓 Lock round'}
            </button>
          </div>

          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {r.foursomes.map((slots, fIdx) => (
              <div key={fIdx} className="card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
                <div style={{ fontSize: 'var(--font-sm)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                  Foursome {fIdx + 1}
                </div>
                {slots.map((cell, sIdx) => {
                  const cellKey = `${rIdx}-${fIdx}-${sIdx}`;
                  const pinned = pins.has(cellKey);
                  const teeSelectValue = cell.teeColor ?? '';
                  const filled = cell.playerId !== EMPTY;
                  // Slots 1&2 are best-ball Team 1, slots 3&4 Team 2 — the
                  // partnership the scoring/money uses (resolveFoursomeTeams),
                  // never alphabetical. Surface it so the organizer can set
                  // teams deliberately (ball-toss + two-closest, or A/B draw).
                  const teamHeader =
                    sIdx === 0 ? 'Team 1 · best ball' : sIdx === 2 ? 'Team 2 · best ball' : null;
                  return (
                    <Fragment key={cellKey}>
                      {teamHeader ? (
                        <div
                          data-testid={`team-label-${rIdx}-${fIdx}-${sIdx === 0 ? 'A' : 'B'}`}
                          style={{
                            fontSize: 'var(--font-xs, 0.72rem)',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            color: 'var(--color-brand-primary)',
                            marginTop: sIdx === 2 ? 'var(--space-3)' : 'var(--space-1)',
                            marginLeft: 26,
                          }}
                        >
                          {teamHeader}
                        </div>
                      ) : null}
                    <div
                      data-testid={`cell-${rIdx}-${fIdx}-${sIdx}`}
                      style={{ padding: 'var(--space-2) 0', borderTop: sIdx > 0 && sIdx !== 2 ? '1px solid var(--color-border-subtle)' : 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span aria-hidden style={{ width: 18, flexShrink: 0, fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{sIdx + 1}</span>
                        <select
                          value={cell.playerId}
                          onChange={(e) => setCell(rIdx, fIdx, sIdx, e.target.value)}
                          disabled={r.locked}
                          data-testid={`select-${rIdx}-${fIdx}-${sIdx}`}
                          style={{ flex: 1, minWidth: 0, minHeight: 'var(--control-height)' }}
                        >
                          <option value={EMPTY}>(empty)</option>
                          {data.roster.map((p) => (
                            <option key={p.playerId} value={p.playerId}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => togglePin(rIdx, fIdx, sIdx)}
                          disabled={r.locked || !filled}
                          data-testid={`pin-${rIdx}-${fIdx}-${sIdx}`}
                          title={pinned ? 'Pinned — kept on Regenerate' : 'Pin to keep on Regenerate'}
                          aria-label={pinned ? 'Pinned' : 'Pin'}
                          style={{ flexShrink: 0, minHeight: 'var(--control-height)', minWidth: 'var(--control-height)', opacity: filled ? 1 : 0.4 }}
                        >
                          {pinned ? '📌' : '📍'}
                        </button>
                      </div>
                      {/* Per-player tee override — only meaningful for a filled slot. */}
                      {filled ? (
                        <select
                          value={teeSelectValue}
                          onChange={(e) => setCellTee(rIdx, fIdx, sIdx, e.target.value)}
                          disabled={r.locked}
                          data-testid={`tee-${rIdx}-${fIdx}-${sIdx}`}
                          title={`Round default: ${r.defaultTeeColor}`}
                          style={{ marginTop: 4, marginLeft: 26, fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}
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
                      ) : null}
                    </div>
                    </Fragment>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  );
}

// ---- Route ----------------------------------------------------------------

export const Route = createFileRoute('/admin/events/$eventId/pairings')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
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
