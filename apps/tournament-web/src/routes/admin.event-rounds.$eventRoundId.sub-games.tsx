/**
 * Sub-game setup — /admin/event-rounds/$eventRoundId/sub-games.
 *
 * Skins is three INDEPENDENT pots (Josh 2026-06-25): Net / Gross / Canadian
 * (= gross-OR-net wins, engine `gross_beats_net`). Each has its own buy-in +
 * participants and settles as its own pot (even-per-skin). A mode with no buy-in
 * and no players is OFF. CTP + Putting stay "Coming in v1.5".
 *
 * Save = DELETE-then-INSERT upsert: re-saving replaces the whole round's config.
 * Each enabled mode is sent as a `{ type:'skins', mode, buyIn, participants }`
 * entry; the backend keys the duplicate guard on type+mode so all three coexist.
 */

import { createFileRoute, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

type SkinsMode = 'net' | 'gross' | 'gross_beats_net';
const SKINS_MODES: ReadonlyArray<{ mode: SkinsMode; label: string; blurb: string }> = [
  { mode: 'net', label: 'Net Skins', blurb: 'Low NET wins the hole (full course handicap).' },
  { mode: 'gross', label: 'Gross Skins', blurb: 'Low GROSS wins the hole — no handicap.' },
  { mode: 'gross_beats_net', label: 'Canadian Skins', blurb: 'Win by gross OR net (unique low gross, else unique low net).' },
];
const DISABLED_TYPES: ReadonlyArray<{ type: string; label: string }> = [
  { type: 'ctp', label: 'Closest to the Pin (CTP)' },
  { type: 'putting_contest', label: 'Putting Contest' },
];

type GetResponse = {
  eventRound: { id: string; eventId: string; roundNumber: number; roundDate: number };
  event: { id: string; name: string };
  roster: Array<{ playerId: string; name: string }>;
  subGames: Array<{ type: string; mode: SkinsMode | null; buyInPerParticipant: number; participantPlayerIds: string[] }>;
};

type SkinsDraft = { buyInDollars: string; participants: Set<string> };
type SkinsState = Record<SkinsMode, SkinsDraft>;

function emptySkins(): SkinsState {
  return {
    net: { buyInDollars: '', participants: new Set() },
    gross: { buyInDollars: '', participants: new Set() },
    gross_beats_net: { buyInDollars: '', participants: new Set() },
  };
}
function centsToDollars(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2);
}
function dollarsToCents(s: string): number {
  const t = s.trim();
  if (t === '') return 0;
  const n = parseFloat(t);
  return !Number.isFinite(n) || n < 0 ? 0 : Math.round(n * 100);
}

export type SubGamesPageProps = { eventRoundId: string };

export function SubGamesPage({ eventRoundId }: SubGamesPageProps) {
  const queryClient = useQueryClient();
  const [skins, setSkins] = useState<SkinsState>(emptySkins);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successAt, setSuccessAt] = useState<number | null>(null);

  const inFlight = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const set = inFlight.current;
    return () => { for (const ac of set) ac.abort(); set.clear(); };
  }, []);

  const queryKey = ['event-round-sub-games', eventRoundId] as const;
  const query = useQuery<GetResponse, Error & { status?: number }>({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/sub-games`, { credentials: 'same-origin', signal });
      if (!res.ok) { const e = new Error(`http_${res.status}`) as Error & { status?: number }; e.status = res.status; throw e; }
      return (await res.json()) as GetResponse;
    },
    retry: false,
    staleTime: 30_000,
  });

  const data = query.data;
  useEffect(() => {
    if (!data) return;
    const next = emptySkins();
    for (const sg of data.subGames) {
      if (sg.type === 'skins' && sg.mode && next[sg.mode]) {
        next[sg.mode] = { buyInDollars: centsToDollars(sg.buyInPerParticipant), participants: new Set(sg.participantPlayerIds) };
      }
    }
    setSkins(next);
  }, [data]);

  const enabledCount = useMemo(
    () => SKINS_MODES.filter(({ mode }) => dollarsToCents(skins[mode].buyInDollars) > 0 || skins[mode].participants.size > 0).length,
    [skins],
  );

  const save = useMutation<{ subGameCount: number }, Error & { code?: string }>({
    mutationFn: async () => {
      const ac = new AbortController();
      inFlight.current.add(ac);
      try {
        // Emit one entry per ENABLED mode (a buy-in OR at least one player).
        const subGames = SKINS_MODES
          .filter(({ mode }) => dollarsToCents(skins[mode].buyInDollars) > 0 || skins[mode].participants.size > 0)
          .map(({ mode }) => ({
            type: 'skins' as const,
            mode,
            buyInPerParticipant: dollarsToCents(skins[mode].buyInDollars),
            participantPlayerIds: Array.from(skins[mode].participants),
          }));
        const res = await fetch(`/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/sub-games`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', signal: ac.signal,
          body: JSON.stringify({ subGames }),
        });
        const body = (await res.json().catch(() => null)) as ({ subGameCount: number; code?: string }) | null;
        if (!res.ok) { const err = new Error(body?.code ?? `http_${res.status}`) as Error & { code?: string }; if (body?.code) err.code = body.code; throw err; }
        return body as { subGameCount: number };
      } finally { inFlight.current.delete(ac); }
    },
    onSuccess: () => { setErrorText(null); setSuccessAt(Date.now()); void queryClient.invalidateQueries({ queryKey }); },
    onError: (err) => {
      if (err.name === 'AbortError') return;
      const code = err.code;
      let msg = 'Save failed. Try again.';
      if (code === 'player_not_in_event') msg = "A player you picked isn't on this event's roster.";
      else if (code === 'duplicate_participant') msg = 'A player was listed twice. Refresh and try again.';
      else if (code === 'event_round_not_found') msg = "This round doesn't exist anymore.";
      else if (code === 'invalid_body') msg = 'Invalid input — check the buy-in amounts.';
      setSuccessAt(null); setErrorText(msg);
    },
  });

  if (query.isLoading) return <PageShell title="Sub-game setup"><LoadingCard /></PageShell>;
  if (query.isError) return <PageShell title="Sub-game setup"><ErrorCard error="Couldn't load sub-game setup. Try again." /></PageShell>;
  if (!data) return <PageShell title="Sub-game setup"><LoadingCard /></PageShell>;

  function toggle(mode: SkinsMode, playerId: string): void {
    setSkins((prev) => {
      const set = new Set(prev[mode].participants);
      if (set.has(playerId)) set.delete(playerId); else set.add(playerId);
      return { ...prev, [mode]: { ...prev[mode], participants: set } };
    });
  }
  function setBuyIn(mode: SkinsMode, value: string): void {
    setSkins((prev) => ({ ...prev, [mode]: { ...prev[mode], buyInDollars: value } }));
  }

  return (
    <PageShell title={`Sub-game setup — Round ${data.eventRound.roundNumber}`}>
      <BackLink to="/admin/events/$eventId" params={{ eventId: data.eventRound.eventId }} label="Event admin" />
      <p>{data.event.name}</p>
      <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>
        Skins is three separate pots — turn on any combination. Set a buy-in and pick who&apos;s in. Each settles even-per-skin (refund if no skins).
      </p>

      {SKINS_MODES.map(({ mode, label, blurb }) => (
        <fieldset key={mode} data-testid={`skins-section-${mode}`} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 12, marginBottom: 12 }}>
          <legend style={{ fontWeight: 700 }}>{label}</legend>
          <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginBottom: 8 }}>{blurb}</div>
          <label style={{ display: 'block', marginBottom: 8 }}>
            Buy-in ($/player):{' '}
            <input type="number" step="0.01" min="0" data-testid={`skins-buyin-${mode}`} value={skins[mode].buyInDollars} onChange={(e) => setBuyIn(mode, e.target.value)} style={{ minHeight: 40, width: 90 }} />
          </label>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {data.roster.map((p) => (
              <li key={p.playerId} style={{ minHeight: 32 }}>
                <label>
                  <input type="checkbox" data-testid={`skins-participant-${mode}-${p.playerId}`} checked={skins[mode].participants.has(p.playerId)} onChange={() => toggle(mode, p.playerId)} />{' '}
                  {p.name}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}

      {DISABLED_TYPES.map(({ type, label }) => (
        <fieldset key={type} disabled title="Coming in v1.5" data-testid={`sub-game-section-${type}`} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 12, marginBottom: 12, opacity: 0.6 }}>
          <legend>{label}</legend>
          <p><em>Coming in v1.5</em></p>
        </fieldset>
      ))}

      <button type="button" data-testid="save-sub-games" onClick={() => save.mutate()} disabled={save.isPending} style={{ minHeight: 44 }}>
        {save.isPending ? 'Saving…' : `Save (${enabledCount} skins pot${enabledCount === 1 ? '' : 's'})`}
      </button>
      {successAt !== null ? <p role="status">Saved.</p> : null}
      {errorText !== null ? <p role="alert">{errorText}</p> : null}
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/event-rounds/$eventRoundId/sub-games')({
  beforeLoad: async () => requireAuthOrRedirect(),
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
