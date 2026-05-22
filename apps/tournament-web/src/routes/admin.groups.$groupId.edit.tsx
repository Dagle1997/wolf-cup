/**
 * T3-3 Group CRUD UI at /admin/groups/$groupId/edit.
 *
 * Single page that combines:
 *   - Group header form (name + money visibility — v1 only 'open' saveable)
 *   - Members table (sorted by name ASC; Remove per row)
 *   - Add Player section (tab toggle: GHIN search vs Manual entry)
 *
 * Backend endpoints consumed:
 *   - GET /api/admin/groups/:groupId  — fetch group + members
 *   - PATCH /api/admin/groups/:groupId  — edit name + moneyVisibilityMode
 *   - POST /api/admin/groups/:groupId/members  — add player (mode: 'ghin'|'manual')
 *   - DELETE /api/admin/groups/:groupId/members/:playerId  — remove member
 *   - GET /api/players/search?name=... (T3-4)  — GHIN search
 *
 * State management uses TanStack Query (useQuery + useMutation) — group is
 * the source of truth fetched once + invalidated on every mutation. The
 * GHIN search results are a separate query gated by an explicit "search
 * clicked" trigger so the fetch doesn't fire on every keystroke.
 *
 * Auth guard: same 5-step auth-status loader as T2-3b/T2-5/T3-2.
 *
 * Dual-export: Route + EditGroupPage.
 */

import { createFileRoute, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { ScrollableTable } from '../components/scrollable-table';

// ---- Loader (mirror T2-3b/T2-5/T3-2) --------------------------------------


// ---- Types ----------------------------------------------------------------

type GroupMember = {
  playerId: string;
  name: string;
  ghin: string | null;
  manualHandicapIndex: number | null;
  preferredTeeColor: string | null;
};

type GroupResponse = {
  id: string;
  name: string;
  eventId: string;
  moneyVisibilityMode: 'open' | 'participant' | 'self_only';
  members: GroupMember[];
};

type GhinSearchResult = {
  ghinNumber: number;
  firstName: string;
  lastName: string;
  handicapIndex: number | null;
  club: string | null;
  state: string | null;
};

// ---- Component ------------------------------------------------------------

export function EditGroupPage({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const [nameDraft, setNameDraft] = useState<string>('');
  const [nameDraftDirty, setNameDraftDirty] = useState(false);
  const [addTab, setAddTab] = useState<'ghin' | 'manual'>('ghin');
  const [ghinSearchTerm, setGhinSearchTerm] = useState('');
  const [ghinSearchTriggered, setGhinSearchTriggered] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualHandicap, setManualHandicap] = useState('');
  const [topLevelError, setTopLevelError] = useState<string | null>(null);

  // AbortController stack — every mutation registers its controller here
  // on start and removes itself on settle. On unmount, all in-flight
  // requests are aborted (per AC #16). TanStack Query's useMutation
  // doesn't auto-abort mutationFn fetches; this ref + useEffect cleanup
  // is the canonical pattern for v5.
  const inFlightControllers = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const controllers = inFlightControllers.current;
    return () => {
      for (const ac of controllers) ac.abort();
      controllers.clear();
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

  // ---- Group fetch -------------------------------------------------------

  const groupQuery = useQuery<GroupResponse>({
    queryKey: ['group', groupId],
    queryFn: async ({ signal }) => {
      // useQuery passes a signal that auto-aborts on unmount; thread it
      // through fetch so the GET cancels cleanly.
      const res = await fetch(`/api/admin/groups/${groupId}`, { signal });
      if (!res.ok) throw new Error('group_fetch_failed');
      return (await res.json()) as GroupResponse;
    },
    staleTime: 0,
  });

  // ---- GHIN search query ------------------------------------------------

  const ghinSearchQuery = useQuery<{ results: GhinSearchResult[] } | { error: 'unavailable' }>({
    queryKey: ['ghin-search', ghinSearchTerm],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/players/search?name=${encodeURIComponent(ghinSearchTerm)}`,
        { signal },
      );
      if (res.status === 503) return { error: 'unavailable' as const };
      if (!res.ok) throw new Error('ghin_search_failed');
      return (await res.json()) as { results: GhinSearchResult[] };
    },
    enabled: ghinSearchTriggered && ghinSearchTerm.trim().length > 0,
    staleTime: 30_000,
  });

  // ---- Mutations ---------------------------------------------------------

  const patchGroup = useMutation({
    mutationFn: async (payload: { name?: string; moneyVisibilityMode?: 'open' }) => {
      const ac = trackController();
      try {
        const res = await fetch(`/api/admin/groups/${groupId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (!res.ok) {
          const code = body?.code ?? 'unknown';
          throw new Error(code);
        }
        return body as GroupResponse;
      } finally {
        releaseController(ac);
      }
    },
    onSuccess: () => {
      setTopLevelError(null);
      setNameDraftDirty(false);
      void qc.invalidateQueries({ queryKey: ['group', groupId] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'unknown';
      setTopLevelError(
        msg === 'mode_not_v1'
          ? 'v1.5 visibility modes are not yet enabled.'
          : 'Failed to save group.',
      );
    },
  });

  const addMember = useMutation({
    mutationFn: async (
      payload:
        | { mode: 'ghin'; ghin: number; firstName: string; lastName: string }
        | { mode: 'manual'; name: string; manualHandicapIndex?: number },
    ) => {
      const ac = trackController();
      try {
        const res = await fetch(`/api/admin/groups/${groupId}/members`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        if (!res.ok) throw new Error(body?.code ?? 'unknown');
        return body as { player: GroupMember; groupMember: { groupId: string; playerId: string } };
      } finally {
        releaseController(ac);
      }
    },
    onSuccess: () => {
      setTopLevelError(null);
      setManualName('');
      setManualHandicap('');
      void qc.invalidateQueries({ queryKey: ['group', groupId] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'unknown';
      setTopLevelError(
        msg === 'player_already_in_group'
          ? 'That player is already in this group.'
          : msg === 'group_not_found'
            ? 'This group no longer exists.'
            : 'Failed to add player.',
      );
    },
  });

  const removeMember = useMutation({
    mutationFn: async (playerId: string) => {
      const ac = trackController();
      try {
        const res = await fetch(`/api/admin/groups/${groupId}/members/${playerId}`, {
          method: 'DELETE',
          signal: ac.signal,
        });
        if (!res.ok && res.status !== 404) throw new Error('remove_failed');
      } finally {
        releaseController(ac);
      }
    },
    onSuccess: () => {
      setTopLevelError(null);
      void qc.invalidateQueries({ queryKey: ['group', groupId] });
    },
    onError: () => {
      setTopLevelError('Failed to remove player.');
    },
  });

  // ---- Derived ----------------------------------------------------------

  const group = groupQuery.data;

  // Sync nameDraft from query data on first load (or when undirty + query
  // refetches). useEffect avoids the React anti-pattern of calling setState
  // during render (which causes a warning + a wasted render cycle).
  useEffect(() => {
    if (group && !nameDraftDirty && nameDraft !== group.name) {
      setNameDraft(group.name);
    }
  }, [group, nameDraftDirty, nameDraft]);

  // ---- Render -----------------------------------------------------------

  if (groupQuery.isLoading) {
    return (
      <PageShell title="Edit Group">
        <LoadingCard message="Loading group…" />
      </PageShell>
    );
  }

  if (groupQuery.isError || !group) {
    return (
      <PageShell title="Edit Group">
        <ErrorCard
          title="Failed to load group"
          error="Try again or contact support."
        />
      </PageShell>
    );
  }

  return (
    <PageShell title={`Edit Group: ${group.name}`}>
      <BackLink to="/admin/events/$eventId" params={{ eventId: group.eventId }} label="Event admin" />

      {topLevelError ? <p role="alert">{topLevelError}</p> : null}

      <section>
        <h2>Group</h2>
        <label htmlFor="group-name">Name</label>
        <input
          id="group-name"
          type="text"
          value={nameDraft}
          onChange={(e) => {
            setNameDraft(e.target.value);
            setNameDraftDirty(true);
          }}
        />
        <button
          type="button"
          onClick={() => patchGroup.mutate({ name: nameDraft.trim() })}
          disabled={!nameDraftDirty || nameDraft.trim().length === 0 || patchGroup.isPending}
        >
          Save name
        </button>

        <fieldset>
          <legend>Money visibility</legend>
          <label>
            <input
              type="radio"
              name="visibility"
              value="open"
              checked={group.moneyVisibilityMode === 'open'}
              onChange={() => patchGroup.mutate({ moneyVisibilityMode: 'open' })}
            />
            Open
          </label>
          <label title="v1.5 — coming soon">
            <input
              type="radio"
              name="visibility"
              value="participant"
              disabled
              checked={group.moneyVisibilityMode === 'participant'}
              onChange={() => undefined}
            />
            Participant (v1.5)
          </label>
          <label title="v1.5 — coming soon">
            <input
              type="radio"
              name="visibility"
              value="self_only"
              disabled
              checked={group.moneyVisibilityMode === 'self_only'}
              onChange={() => undefined}
            />
            Self-only (v1.5)
          </label>
        </fieldset>
      </section>

      <section>
        <h2>Members ({group.members.length})</h2>
        {group.members.length === 0 ? (
          <EmptyState title="No members yet." body="Add players below." />
        ) : (
          <ScrollableTable label="Group members"><table>
            <thead>
              <tr>
                <th>Name</th>
                <th>GHIN</th>
                <th>Handicap</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {group.members.map((m) => (
                <tr key={m.playerId}>
                  <td>{m.name}</td>
                  <td>{m.ghin ?? '—'}</td>
                  <td>{m.manualHandicapIndex !== null ? m.manualHandicapIndex : '—'}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={`Remove ${m.name}`}
                      onClick={() => removeMember.mutate(m.playerId)}
                      disabled={removeMember.isPending}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></ScrollableTable>
        )}
      </section>

      <section>
        <h2>Add Player</h2>
        <div role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={addTab === 'ghin'}
            onClick={() => setAddTab('ghin')}
          >
            GHIN Search
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={addTab === 'manual'}
            onClick={() => setAddTab('manual')}
          >
            Manual Entry
          </button>
        </div>

        {addTab === 'ghin' ? (
          <div>
            <label htmlFor="ghin-search-input">Last name</label>
            <input
              id="ghin-search-input"
              type="text"
              value={ghinSearchTerm}
              onChange={(e) => {
                setGhinSearchTerm(e.target.value);
                setGhinSearchTriggered(false);
              }}
            />
            <button
              type="button"
              onClick={() => setGhinSearchTriggered(true)}
              disabled={ghinSearchTerm.trim().length === 0}
            >
              Search
            </button>

            {ghinSearchQuery.isFetching ? <p>Searching…</p> : null}

            {ghinSearchQuery.data && 'error' in ghinSearchQuery.data ? (
              <p role="alert">GHIN search unavailable — use Manual Entry.</p>
            ) : null}

            {ghinSearchQuery.data && 'results' in ghinSearchQuery.data ? (
              ghinSearchQuery.data.results.length === 0 ? (
                <p>No results in WV. (Out-of-state lookup not supported in v1.)</p>
              ) : (
                <ul>
                  {ghinSearchQuery.data.results.map((r) => (
                    <li key={r.ghinNumber}>
                      {r.firstName} {r.lastName} — GHIN {r.ghinNumber}
                      {r.handicapIndex !== null ? ` — HI ${r.handicapIndex}` : ''}
                      {r.club ? ` — ${r.club}` : ''}
                      <button
                        type="button"
                        onClick={() =>
                          addMember.mutate({
                            mode: 'ghin',
                            ghin: r.ghinNumber,
                            firstName: r.firstName,
                            lastName: r.lastName,
                          })
                        }
                        disabled={addMember.isPending}
                      >
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : null}

        {addTab === 'manual' ? (
          <div>
            <label htmlFor="manual-name">Player name</label>
            <input
              id="manual-name"
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
            <label htmlFor="manual-handicap">Handicap (optional)</label>
            <input
              id="manual-handicap"
              type="number"
              step="0.1"
              value={manualHandicap}
              onChange={(e) => setManualHandicap(e.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                const trimmed = manualName.trim();
                if (!trimmed) return;
                const handicap = manualHandicap.trim() === '' ? undefined : Number(manualHandicap);
                addMember.mutate({
                  mode: 'manual',
                  name: trimmed,
                  ...(handicap !== undefined && Number.isFinite(handicap)
                    ? { manualHandicapIndex: handicap }
                    : {}),
                });
              }}
              disabled={manualName.trim().length === 0 || addMember.isPending}
            >
              Add
            </button>
          </div>
        ) : null}
      </section>
    </PageShell>
  );
}

// ---- Inline forbidden message ---------------------------------------------

function ForbiddenMessage() {
  return (
    <div>
      <h1>Not an organizer</h1>
      <p>
        You're signed in but don't have organizer permissions. Contact Josh to grant
        organizer access, or <a href="/api/auth/google">sign in as a different account</a>.
      </p>
    </div>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/admin/groups/$groupId/edit')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  const { groupId } = useParams({ from: '/admin/groups/$groupId/edit' });
  if (!player.isOrganizer) return <ForbiddenMessage />;
  return <EditGroupPage groupId={groupId} />;
}
