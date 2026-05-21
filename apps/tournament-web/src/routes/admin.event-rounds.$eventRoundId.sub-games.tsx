/**
 * T3-9 organizer page at /admin/event-rounds/$eventRoundId/sub-games.
 *
 * v1 enables `skins` only; the 3 other sub-game types render with their
 * controls disabled + a "Coming in v1.5" tooltip.
 *
 * Auth gate: 5-step auth-status loader (T2-3b pattern); anonymous →
 * redirect to /api/auth/google; non-organizer → ForbiddenMessage.
 *
 * Form state: TanStack Query useQuery for the GET prepopulation; useMutation
 * for the POST. AbortController-on-unmount via inFlightControllers ref.
 *
 * Save semantics: DELETE-then-INSERT upsert at the backend. Re-saving with
 * different participants replaces (NOT accumulates) the prior config.
 *
 * Dual-export: `Route` for TanStack file-route registration AND `SubGamesPage`
 * for direct test rendering.
 */

import { createFileRoute, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';

// ---- Loader (mirror T2-3b/T2-5) -------------------------------------------


// ---- Types ----------------------------------------------------------------

const ALL_SUB_GAME_TYPES = ['skins', 'ctp', 'sandies', 'putting_contest'] as const;
type SubGameType = (typeof ALL_SUB_GAME_TYPES)[number];

const V1_ENABLED: ReadonlySet<SubGameType> = new Set(['skins'] as const);

const TYPE_LABELS: Record<SubGameType, string> = {
  skins: 'Skins',
  ctp: 'Closest to the Pin (CTP)',
  sandies: 'Sandies',
  putting_contest: 'Putting Contest',
};

type GetResponse = {
  eventRound: { id: string; eventId: string; roundNumber: number; roundDate: number };
  event: { id: string; name: string };
  roster: Array<{ playerId: string; name: string }>;
  subGames: Array<{
    type: SubGameType;
    buyInPerParticipant: number;
    participantPlayerIds: string[];
  }>;
};

type SubGameDraft = {
  buyInDollars: string; // raw input string; converted to integer cents on submit
  participantPlayerIds: Set<string>;
};

type DraftState = Record<SubGameType, SubGameDraft>;

function emptyDraft(): DraftState {
  return {
    skins: { buyInDollars: '', participantPlayerIds: new Set() },
    ctp: { buyInDollars: '', participantPlayerIds: new Set() },
    sandies: { buyInDollars: '', participantPlayerIds: new Set() },
    putting_contest: { buyInDollars: '', participantPlayerIds: new Set() },
  };
}

function centsToDollarsString(cents: number): string {
  if (cents === 0) return '';
  return (cents / 100).toFixed(2);
}

function dollarsStringToCents(s: string): number {
  const trimmed = s.trim();
  if (trimmed === '') return 0;
  const parsed = parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

// ---- Component ------------------------------------------------------------

export type SubGamesPageProps = { eventRoundId: string };

export function SubGamesPage({ eventRoundId }: SubGamesPageProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successAt, setSuccessAt] = useState<number | null>(null);

  const inFlightControllers = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const set = inFlightControllers.current;
    return () => {
      for (const ac of set) ac.abort();
      set.clear();
    };
  }, []);

  // ---- Fetch existing config -----------------------------------------------

  const queryKey = ['event-round-sub-games', eventRoundId] as const;
  const query = useQuery<GetResponse, Error & { status?: number }>({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/sub-games`,
        { credentials: 'same-origin', signal },
      );
      if (!res.ok) {
        const err = new Error(`http_${res.status}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return (await res.json()) as GetResponse;
    },
    retry: false,
    staleTime: 30_000,
  });

  // Initialize draft once data lands.
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    const next = emptyDraft();
    for (const sg of data.subGames) {
      if (next[sg.type]) {
        next[sg.type] = {
          buyInDollars: centsToDollarsString(sg.buyInPerParticipant),
          participantPlayerIds: new Set(sg.participantPlayerIds),
        };
      }
    }
    setDraft(next);
  }, [data]);

  // Compute whether the draft differs from the server state. AC #5 disables
  // the save button when no change has been made (prevents redundant POSTs).
  // The mutation now ALWAYS emits a skins payload entry when the server had
  // one (see serverHadSkins gate below), so isDirty can be a pure
  // content-equality check — no "would-clear-on-save" edge case.
  const isDirty = useMemo<boolean>(() => {
    if (!data) return false;
    const serverSkins = data.subGames.find((sg) => sg.type === 'skins');
    const draftSkins = draft.skins;
    const draftBuyInCents = dollarsStringToCents(draftSkins.buyInDollars);
    const serverBuyInCents = serverSkins?.buyInPerParticipant ?? 0;
    if (draftBuyInCents !== serverBuyInCents) return true;
    const serverParticipants = new Set(serverSkins?.participantPlayerIds ?? []);
    if (draftSkins.participantPlayerIds.size !== serverParticipants.size) return true;
    for (const pid of draftSkins.participantPlayerIds) {
      if (!serverParticipants.has(pid)) return true;
    }
    return false;
  }, [data, draft]);

  // ---- Save mutation -------------------------------------------------------

  const serverHadSkins = data?.subGames.some((sg) => sg.type === 'skins') ?? false;

  const saveMutation = useMutation<
    { subGameCount: number; participantCount: number },
    Error & { code?: string }
  >({
    mutationFn: async () => {
      const ac = new AbortController();
      inFlightControllers.current.add(ac);
      try {
        // v1 only sends skins. ctp/sandies/putting_contest stay client-side
        // disabled — never serialized to the backend.
        const subGamesPayload: Array<{
          type: SubGameType;
          buyInPerParticipant: number;
          participantPlayerIds: string[];
        }> = [];
        const skinsDraft = draft.skins;
        // Emit a skins entry if EITHER (a) the user has filled in something
        // (buy-in or participants), OR (b) the server originally had a skins
        // row that we should preserve. The (b) gate prevents the "save with
        // no changes silently clears the existing empty-skins row" footgun
        // that an earlier impl had (round-2 codex catch).
        const draftHasContent =
          skinsDraft.buyInDollars.trim() !== '' ||
          skinsDraft.participantPlayerIds.size > 0;
        if (draftHasContent || serverHadSkins) {
          subGamesPayload.push({
            type: 'skins',
            buyInPerParticipant: dollarsStringToCents(skinsDraft.buyInDollars),
            participantPlayerIds: Array.from(skinsDraft.participantPlayerIds),
          });
        }

        const res = await fetch(
          `/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/sub-games`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            signal: ac.signal,
            body: JSON.stringify({ subGames: subGamesPayload }),
          },
        );
        const body = (await res.json().catch(() => null)) as
          | ({ subGameCount: number; participantCount: number; code?: string })
          | null;
        if (!res.ok) {
          const code = body?.code;
          const err = new Error(code ?? `http_${res.status}`) as Error & {
            code?: string;
          };
          if (code !== undefined) err.code = code;
          throw err;
        }
        return body as { subGameCount: number; participantCount: number };
      } finally {
        inFlightControllers.current.delete(ac);
      }
    },
    onSuccess: () => {
      setErrorText(null);
      setSuccessAt(Date.now());
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      if (err.name === 'AbortError') return;
      const code = err.code;
      let msg = 'Save failed. Try again.';
      if (code === 'player_not_in_event') {
        msg = "One of the players you picked isn't on this event's roster.";
      } else if (code === 'duplicate_participant') {
        msg = 'A player was listed twice. Refresh and try again.';
      } else if (code === 'duplicate_sub_game_type') {
        msg = 'Internal error: duplicate sub-game type. Refresh and try again.';
      } else if (code === 'sub_game_type_not_enabled') {
        msg = 'That sub-game type is not enabled in v1.';
      } else if (code === 'event_round_not_found') {
        msg = "This round doesn't exist anymore.";
      } else if (code === 'invalid_body') {
        msg = 'Invalid input — check the buy-in amount.';
      }
      setSuccessAt(null);
      setErrorText(msg);
    },
  });

  // ---- Render --------------------------------------------------------------

  if (query.isLoading) {
    return <div>Loading…</div>;
  }
  if (query.isError) {
    return <div role="alert">Couldn't load sub-game setup. Try again.</div>;
  }
  if (!data) {
    return <div>Loading…</div>;
  }

  function togglePlayer(type: SubGameType, playerId: string): void {
    setDraft((prev) => {
      const set = new Set(prev[type].participantPlayerIds);
      if (set.has(playerId)) set.delete(playerId);
      else set.add(playerId);
      return { ...prev, [type]: { ...prev[type], participantPlayerIds: set } };
    });
  }

  function setBuyIn(type: SubGameType, value: string): void {
    setDraft((prev) => ({
      ...prev,
      [type]: { ...prev[type], buyInDollars: value },
    }));
  }

  return (
    <PageShell title={`Sub-game setup — Round ${data.eventRound.roundNumber}`}>
      <BackLink to="/admin/events/$eventId" params={{ eventId: data.eventRound.eventId }} label="Event admin" />
      <p>{data.event.name}</p>

      {ALL_SUB_GAME_TYPES.map((type) => {
        const enabled = V1_ENABLED.has(type);
        const tooltipText = enabled ? undefined : 'Coming in v1.5';
        return (
          <fieldset
            key={type}
            disabled={!enabled}
            title={tooltipText}
            data-testid={`sub-game-section-${type}`}
          >
            <legend>{TYPE_LABELS[type]}</legend>
            {!enabled ? (
              <p>
                <em>Coming in v1.5</em>
              </p>
            ) : null}
            <label>
              Buy-in ($):{' '}
              <input
                type="number"
                step="0.01"
                min="0"
                value={draft[type].buyInDollars}
                onChange={(e) => setBuyIn(type, e.target.value)}
                disabled={!enabled}
                data-testid={`buy-in-${type}`}
              />
            </label>
            <ul>
              {data.roster.map((p) => {
                const checked = draft[type].participantPlayerIds.has(p.playerId);
                return (
                  <li key={p.playerId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePlayer(type, p.playerId)}
                        disabled={!enabled}
                        data-testid={`participant-${type}-${p.playerId}`}
                      />{' '}
                      {p.name}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}

      <button
        type="button"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || !isDirty}
      >
        {saveMutation.isPending ? 'Saving…' : 'Save'}
      </button>

      {successAt !== null ? (
        <p role="status">Saved.</p>
      ) : null}
      {errorText !== null ? (
        <p role="alert">{errorText}</p>
      ) : null}
    </PageShell>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute(
  '/admin/event-rounds/$eventRoundId/sub-games',
)({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  const { eventRoundId } = useParams({ strict: false });
  if (!player.isOrganizer) return <ForbiddenMessage />;
  if (typeof eventRoundId !== 'string') return <div>Invalid round.</div>;
  return <SubGamesPage eventRoundId={eventRoundId} />;
}

function ForbiddenMessage() {
  return (
    <div>
      <h1>Forbidden</h1>
      <p>You need organizer access to view this page.</p>
    </div>
  );
}

