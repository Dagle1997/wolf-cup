/**
 * T3-10 player profile page at /profile.
 *
 * Authed (any signed-in player); NOT organizer-gated. Per FR-E11 (revised
 * 2026-04-18), GHIN linkage is OPTIONAL — the page renders successfully
 * regardless of `ghin === null` state.
 *
 * Three flows:
 *   1. Link GHIN: tabs for "By GHIN number" + "By name". Search may return
 *      a multi-match list; user picks one and the form re-submits with
 *      `mode: 'pick'`.
 *   2. Unlink GHIN: confirmation dialog → PATCH /api/players/me/ghin.
 *   3. Manual handicap index: separate input + Save → PATCH
 *      /api/players/me/manual-handicap. Independent of GHIN state.
 *
 * Dual-export: `Route` + `ProfilePage`.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { queryClient as appQueryClient } from '../lib/query-client';
import { PageShell } from '../components/page-shell';

// ---- Loader (mirror T2-3b/T2-5) -------------------------------------------

type AuthStatus = {
  player:
    | null
    | {
        id: string;
        isOrganizer: boolean;
        ghin: string | null;
        manualHandicapIndex: number | null;
      };
};

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
    const rawGhin = (p as { ghin?: unknown }).ghin;
    const rawHi = (p as { manualHandicapIndex?: unknown }).manualHandicapIndex;
    return {
      player: {
        id: (p as { id: string }).id,
        isOrganizer: (p as { isOrganizer: boolean }).isOrganizer,
        ghin: typeof rawGhin === 'string' ? rawGhin : null,
        manualHandicapIndex: typeof rawHi === 'number' ? rawHi : null,
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

type GhinSearchResult = {
  ghinNumber: number;
  firstName: string;
  lastName: string;
  handicapIndex: number | null;
  club: string | null;
  state: string | null;
};

type LinkResponse =
  | { result: 'linked'; ghinNumber: number; handicapIndex: number | null }
  | { result: 'multi-match'; matches: GhinSearchResult[] };

type LinkDirectInput = { mode: 'direct'; ghinNumber: number };
type LinkSearchInput = {
  mode: 'search';
  lastName: string;
  firstName?: string;
  state?: string;
};
type LinkPickInput = { mode: 'pick'; ghinNumber: number };
type LinkInput = LinkDirectInput | LinkSearchInput | LinkPickInput;

// ---- Component ------------------------------------------------------------

export type ProfilePageProps = {
  player: NonNullable<AuthStatus['player']>;
};

export function ProfilePage({ player: initialPlayer }: ProfilePageProps) {
  const queryClient = useQueryClient();
  const [player, setPlayer] = useState(initialPlayer);
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [tab, setTab] = useState<'direct' | 'search'>('direct');
  const [direct, setDirect] = useState({ ghinNumber: '' });
  const [search, setSearch] = useState({ lastName: '', firstName: '', state: 'WV' });
  const [matches, setMatches] = useState<GhinSearchResult[] | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [hiInput, setHiInput] = useState<string>(
    initialPlayer.manualHandicapIndex !== null
      ? String(initialPlayer.manualHandicapIndex)
      : '',
  );
  const [hiSavedAt, setHiSavedAt] = useState<number | null>(null);
  const [hiError, setHiError] = useState<string | null>(null);

  const inFlightControllers = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const set = inFlightControllers.current;
    return () => {
      for (const ac of set) ac.abort();
      set.clear();
    };
  }, []);

  function trackController(): AbortController {
    const ac = new AbortController();
    inFlightControllers.current.add(ac);
    return ac;
  }
  function releaseController(ac: AbortController): void {
    inFlightControllers.current.delete(ac);
  }

  // ---- Link mutation -----------------------------------------------------

  const linkMutation = useMutation<LinkResponse, Error & { code?: string }, LinkInput>({
    mutationFn: async (input) => {
      const ac = trackController();
      try {
        const res = await fetch('/api/players/me/ghin/link', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          signal: ac.signal,
          body: JSON.stringify(input),
        });
        const body = (await res.json().catch(() => null)) as
          | (LinkResponse & { code?: string })
          | null;
        if (!res.ok) {
          const code = body?.code;
          const err = new Error(code ?? `http_${res.status}`) as Error & {
            code?: string;
          };
          if (code !== undefined) err.code = code;
          throw err;
        }
        return body as LinkResponse;
      } finally {
        releaseController(ac);
      }
    },
    onSuccess: (data) => {
      setLinkError(null);
      if (data.result === 'linked') {
        setPlayer((p) => ({ ...p, ghin: String(data.ghinNumber) }));
        setMatches(null);
        setLinkFormOpen(false);
        void queryClient.invalidateQueries({ queryKey: ['auth-status'] });
      } else {
        setMatches(data.matches);
      }
    },
    onError: (err) => {
      if (err.name === 'AbortError') return;
      const code = err.code;
      let msg = 'Link failed. Try again.';
      if (code === 'ghin_not_found') msg = 'No GHIN matched. Try a different number or search by name.';
      else if (code === 'ghin_already_linked') msg = 'That GHIN is already linked to another player.';
      else if (code === 'ghin_unavailable') msg = 'GHIN service unavailable. Try again later.';
      else if (code === 'invalid_body') msg = 'Invalid input. Check the form.';
      setLinkError(msg);
    },
  });

  // ---- Unlink mutation ---------------------------------------------------

  const unlinkMutation = useMutation<void, Error>({
    mutationFn: async () => {
      const ac = trackController();
      try {
        const res = await fetch('/api/players/me/ghin', {
          method: 'PATCH',
          credentials: 'same-origin',
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`http_${res.status}`);
      } finally {
        releaseController(ac);
      }
    },
    onSuccess: () => {
      setPlayer((p) => ({ ...p, ghin: null }));
      setUnlinkOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    },
  });

  // ---- Manual handicap mutation ------------------------------------------

  const hiMutation = useMutation<void, Error & { code?: string }>({
    mutationFn: async () => {
      const ac = trackController();
      try {
        const trimmed = hiInput.trim();
        const value = trimmed === '' ? null : parseFloat(trimmed);
        if (value !== null && !Number.isFinite(value)) {
          throw new Error('invalid_body');
        }
        const res = await fetch('/api/players/me/manual-handicap', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          signal: ac.signal,
          body: JSON.stringify({ manualHandicapIndex: value }),
        });
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (!res.ok) {
          const code = body?.code;
          const err = new Error(code ?? `http_${res.status}`) as Error & {
            code?: string;
          };
          if (code !== undefined) err.code = code;
          throw err;
        }
      } finally {
        releaseController(ac);
      }
    },
    onSuccess: () => {
      setHiError(null);
      setHiSavedAt(Date.now());
      void queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    },
    onError: (err) => {
      if (err.name === 'AbortError') return;
      const code = err.code;
      let msg = 'Save failed. Try again.';
      if (code === 'invalid_body') msg = 'Invalid handicap index. Use a number between -10 and 54.';
      setHiSavedAt(null);
      setHiError(msg);
    },
  });

  // ---- Render ------------------------------------------------------------

  return (
    <PageShell title="Your profile">
      <p>
        Signed in as <code style={{ wordBreak: 'break-all' }}>{player.id}</code>
        {player.isOrganizer ? ' (organizer)' : ''}.
      </p>

      <section>
        <h2>GHIN</h2>
        {player.ghin === null ? (
          <>
            <p>GHIN not linked.</p>
            {!linkFormOpen ? (
              <button type="button" onClick={() => setLinkFormOpen(true)}>
                Link your GHIN
              </button>
            ) : (
              <div>
                <div role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'direct'}
                    onClick={() => {
                      setTab('direct');
                      setMatches(null);
                    }}
                  >
                    By GHIN number
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'search'}
                    onClick={() => {
                      setTab('search');
                      setMatches(null);
                    }}
                  >
                    By name
                  </button>
                </div>

                {tab === 'direct' ? (
                  <div>
                    <label>
                      GHIN number:{' '}
                      <input
                        type="number"
                        value={direct.ghinNumber}
                        onChange={(e) => setDirect({ ghinNumber: e.target.value })}
                        data-testid="link-direct-input"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={linkMutation.isPending || direct.ghinNumber.trim() === ''}
                      onClick={() => {
                        const n = parseInt(direct.ghinNumber, 10);
                        if (!Number.isFinite(n) || n <= 0) {
                          setLinkError('Enter a valid GHIN number.');
                          return;
                        }
                        linkMutation.mutate({ mode: 'direct', ghinNumber: n });
                      }}
                    >
                      {linkMutation.isPending ? 'Linking…' : 'Link'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <label>
                      Last name:{' '}
                      <input
                        type="text"
                        value={search.lastName}
                        onChange={(e) =>
                          setSearch((s) => ({ ...s, lastName: e.target.value }))
                        }
                        data-testid="link-search-lastname"
                      />
                    </label>
                    <label>
                      First name (optional):{' '}
                      <input
                        type="text"
                        value={search.firstName}
                        onChange={(e) =>
                          setSearch((s) => ({ ...s, firstName: e.target.value }))
                        }
                        data-testid="link-search-firstname"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={linkMutation.isPending || search.lastName.trim() === ''}
                      onClick={() => {
                        const input: LinkSearchInput = {
                          mode: 'search',
                          lastName: search.lastName.trim(),
                        };
                        if (search.firstName.trim() !== '') input.firstName = search.firstName.trim();
                        if (search.state.trim() !== '') input.state = search.state.trim();
                        linkMutation.mutate(input);
                      }}
                    >
                      {linkMutation.isPending ? 'Searching…' : 'Search'}
                    </button>
                  </div>
                )}

                {matches !== null && matches.length > 0 ? (
                  <div data-testid="match-picker">
                    <h3>Pick the right one:</h3>
                    <ul>
                      {matches.map((m) => (
                        <li key={m.ghinNumber}>
                          <button
                            type="button"
                            disabled={linkMutation.isPending}
                            onClick={() =>
                              linkMutation.mutate({
                                mode: 'pick',
                                ghinNumber: m.ghinNumber,
                              })
                            }
                            data-testid={`match-pick-${m.ghinNumber}`}
                            style={{ textAlign: 'left', wordBreak: 'break-word', whiteSpace: 'normal' }}
                          >
                            {m.firstName} {m.lastName}
                            {m.club !== null ? ` — ${m.club}` : ''}
                            {m.state !== null ? `, ${m.state}` : ''}
                            {' '}(GHIN {m.ghinNumber})
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {linkError !== null ? <p role="alert">{linkError}</p> : null}
              </div>
            )}
          </>
        ) : (
          <>
            <p>
              GHIN linked: <code>{player.ghin}</code>
            </p>
            {!unlinkOpen ? (
              <button type="button" onClick={() => setUnlinkOpen(true)}>
                Unlink
              </button>
            ) : (
              <div role="dialog" aria-label="Confirm unlink">
                <p>Unlink your GHIN? You can re-link it any time.</p>
                <button
                  type="button"
                  onClick={() => unlinkMutation.mutate()}
                  disabled={unlinkMutation.isPending}
                >
                  {unlinkMutation.isPending ? 'Unlinking…' : 'Confirm unlink'}
                </button>
                <button type="button" onClick={() => setUnlinkOpen(false)}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <h2>Manual handicap index</h2>
        <p>
          Independent of GHIN state. Use this if you don&apos;t have a GHIN
          number, or if you want a custom override for tournament-specific
          play.
        </p>
        <label>
          Handicap index:{' '}
          <input
            type="number"
            step="0.1"
            value={hiInput}
            onChange={(e) => setHiInput(e.target.value)}
            data-testid="hi-input"
          />
        </label>
        <button
          type="button"
          onClick={() => hiMutation.mutate()}
          disabled={hiMutation.isPending}
        >
          {hiMutation.isPending ? 'Saving…' : 'Save'}
        </button>
        {hiSavedAt !== null ? <p role="status">Saved.</p> : null}
        {hiError !== null ? <p role="alert">{hiError}</p> : null}
      </section>
    </PageShell>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/profile')({
  beforeLoad: async () => {
    const status = await appQueryClient.fetchQuery({
      queryKey: ['auth-status'],
      queryFn: loadAuthStatus,
      staleTime: 0,
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
  return <ProfilePage player={player} />;
}
