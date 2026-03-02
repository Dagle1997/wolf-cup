import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, Pencil, Plus, RefreshCw, Trash2, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Player = {
  id: number;
  name: string;
  ghinNumber: string | null;
  isActive: number;
  isGuest: number;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/admin/roster')({
  component: RosterPage,
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function RosterPage() {
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-roster'],
    queryFn: () => apiFetch<{ items: Player[] }>('/admin/players'),
    retry: false,
  });

  if (isError) {
    if ((error as Error).message === 'UNAUTHORIZED') {
      void navigate({ to: '/admin/login' });
      return null;
    }
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4">Roster</h2>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load roster — tap to retry</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const rosterPlayers = (data?.items ?? []).filter((p) => p.isGuest === 0);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Roster</h2>
      <AddPlayerForm />
      <div className="mt-6">
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <PlayerTable players={rosterPlayers} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Player Form
// ---------------------------------------------------------------------------

function AddPlayerForm() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [ghin, setGhin] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (body: { name: string; ghinNumber?: string }) =>
      apiFetch<{ player: Player }>('/admin/players', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-roster'] });
      setName('');
      setGhin('');
      setAddError(null);
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      setAddError(
        err.message === 'VALIDATION_ERROR' ? 'Name is required.' : 'Could not add player — try again.',
      );
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setAddError('Name is required.');
      return;
    }
    setAddError(null);
    addMutation.mutate({ name: name.trim(), ...(ghin.trim() ? { ghinNumber: ghin.trim() } : {}) });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border p-4 bg-muted/20">
      <h3 className="text-sm font-semibold mb-3">Add Player</h3>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Name *"
          value={name}
          onChange={(e) => { setName(e.target.value); if (addError) setAddError(null); }}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={addMutation.isPending}
        />
        <input
          type="text"
          placeholder="GHIN # (optional)"
          value={ghin}
          onChange={(e) => setGhin(e.target.value)}
          className="w-full sm:w-36 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={addMutation.isPending}
        />
        <Button type="submit" size="sm" disabled={addMutation.isPending} className="shrink-0">
          {addMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          <span className="ml-1">Add</span>
        </Button>
      </div>
      {addError && <p className="mt-2 text-sm text-destructive">{addError}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Player Table
// ---------------------------------------------------------------------------

function PlayerTable({ players }: { players: Player[] }) {
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: 0 | 1 }) =>
      apiFetch<{ player: Player }>(`/admin/players/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onMutate: ({ id }) => setTogglingId(id),
    onSettled: () => setTogglingId(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-roster'] }),
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') void navigate({ to: '/admin/login' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ success: boolean }>(`/admin/players/${id}`, { method: 'DELETE' }),
    onMutate: (id) => setDeletingId(id),
    onSettled: () => setDeletingId(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-roster'] });
      setDeleteError(null);
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') { void navigate({ to: '/admin/login' }); return; }
      if (err.message === 'HAS_ROUND_HISTORY') {
        setDeleteError('Cannot delete — player has round history. Deactivate instead.');
      } else {
        setDeleteError('Could not delete player — try again.');
      }
    },
  });

  if (players.length === 0) {
    return <p className="text-muted-foreground text-sm">No players yet.</p>;
  }

  return (
    <div className="rounded-md border overflow-hidden">
      {deleteError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 text-destructive text-xs border-b">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {deleteError}
          <button className="ml-auto underline underline-offset-2" onClick={() => setDeleteError(null)}>Dismiss</button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Name</th>
            <th className="py-2 px-3 text-left font-medium text-muted-foreground">GHIN #</th>
            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="py-2 px-3" />
          </tr>
        </thead>
        <tbody>
          {players.map((p) =>
            editingId === p.id ? (
              <EditRow
                key={p.id}
                player={p}
                onClose={() => setEditingId(null)}
              />
            ) : (
              <PlayerRow
                key={p.id}
                player={p}
                isToggling={togglingId === p.id}
                isDeleting={deletingId === p.id}
                onEdit={() => setEditingId(p.id)}
                onToggle={(isActive) => toggleMutation.mutate({ id: p.id, isActive })}
                onDelete={() => {
                  if (!window.confirm(`Delete ${p.name}? This cannot be undone.`)) return;
                  setDeleteError(null);
                  deleteMutation.mutate(p.id);
                }}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player Row
// ---------------------------------------------------------------------------

function PlayerRow({
  player,
  isToggling,
  isDeleting,
  onEdit,
  onToggle,
  onDelete,
}: {
  player: Player;
  isToggling: boolean;
  isDeleting: boolean;
  onEdit: () => void;
  onToggle: (isActive: 0 | 1) => void;
  onDelete: () => void;
}) {
  const inactive = player.isActive === 0;
  const [hiState, setHiState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ok'; hi: number | null; date: string }
    | { status: 'error'; msg: string }
  >({ status: 'idle' });

  async function handleFetchHI() {
    if (!player.ghinNumber) return;
    setHiState({ status: 'loading' });
    try {
      const result = await apiFetch<{ handicapIndex: number | null; retrievedAt: string }>(
        `/admin/ghin/${player.ghinNumber}`,
      );
      const date = new Date(result.retrievedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      setHiState({ status: 'ok', hi: result.handicapIndex, date });
    } catch (err) {
      const code = (err as Error).message;
      const msg =
        code === 'NOT_FOUND'
          ? 'GHIN # not found'
          : code === 'GHIN_NOT_CONFIGURED'
            ? 'GHIN not configured'
            : 'Lookup failed';
      setHiState({ status: 'error', msg });
    }
  }

  return (
    <tr className="border-b last:border-0">
      <td className={`py-2 px-3 font-medium ${inactive ? 'text-muted-foreground' : ''}`}>
        {player.name}
      </td>
      <td className={`py-2 px-3 ${inactive ? 'text-muted-foreground' : ''}`}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span>{player.ghinNumber ?? <span className="text-muted-foreground/50">—</span>}</span>
          {player.ghinNumber && hiState.status === 'idle' && (
            <button
              type="button"
              onClick={() => void handleFetchHI()}
              className="text-xs text-primary underline underline-offset-2 hover:no-underline"
              title="Fetch current handicap index from GHIN"
            >
              Fetch HI
            </button>
          )}
          {player.ghinNumber && hiState.status === 'loading' && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          {hiState.status === 'ok' && (
            <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3" />
              HI: {hiState.hi ?? '—'} ({hiState.date})
              <button
                type="button"
                onClick={() => setHiState({ status: 'idle' })}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </span>
          )}
          {hiState.status === 'error' && (
            <span className="text-xs text-destructive">
              {hiState.msg}
              <button
                type="button"
                onClick={() => setHiState({ status: 'idle' })}
                className="ml-1 underline underline-offset-2"
              >
                retry
              </button>
            </span>
          )}
        </div>
      </td>
      <td className="py-2 px-3">
        {inactive ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Inactive
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
            Active
          </span>
        )}
      </td>
      <td className="py-2 px-3">
        <div className="flex items-center justify-end gap-1">
          <Button variant="outline" size="sm" onClick={onEdit} disabled={isToggling || isDeleting} aria-label="Edit player">
            <Pencil className="h-3 w-3" />
            <span className="ml-1 hidden sm:inline">Edit</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onToggle(inactive ? 1 : 0)}
            disabled={isToggling || isDeleting}
            aria-label={inactive ? 'Reactivate player' : 'Deactivate player'}
          >
            {isToggling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : inactive ? (
              <UserCheck className="h-3 w-3" />
            ) : (
              <UserX className="h-3 w-3" />
            )}
            <span className="ml-1 hidden sm:inline">{inactive ? 'Reactivate' : 'Deactivate'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={isToggling || isDeleting}
            aria-label="Delete player"
            className="text-destructive hover:text-destructive"
          >
            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Edit Row
// ---------------------------------------------------------------------------

function EditRow({ player, onClose }: { player: Player; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(player.name);
  const [ghin, setGhin] = useState(player.ghinNumber ?? '');
  const [editError, setEditError] = useState<string | null>(null);

  const editMutation = useMutation({
    mutationFn: (body: { name: string; ghinNumber: string | null }) =>
      apiFetch<{ player: Player }>(`/admin/players/${player.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-roster'] });
      onClose();
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      setEditError(
        err.message === 'VALIDATION_ERROR' ? 'Name is required.' : 'Could not save — try again.',
      );
    },
  });

  function handleSave() {
    if (!name.trim()) {
      setEditError('Name is required.');
      return;
    }
    setEditError(null);
    editMutation.mutate({ name: name.trim(), ghinNumber: ghin.trim() || null });
  }

  return (
    <tr className="border-b last:border-0 bg-muted/20">
      <td className="py-2 px-3" colSpan={4}>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={editMutation.isPending}
            autoFocus
          />
          <input
            type="text"
            placeholder="GHIN # (optional)"
            value={ghin}
            onChange={(e) => setGhin(e.target.value)}
            className="w-full sm:w-36 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={editMutation.isPending}
          />
          <div className="flex gap-1 shrink-0">
            <Button size="sm" onClick={handleSave} disabled={editMutation.isPending}>
              {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={editMutation.isPending}>
              Cancel
            </Button>
          </div>
        </div>
        {editError && <p className="mt-1 text-sm text-destructive">{editError}</p>}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="rounded-md border overflow-hidden animate-pulse">
      <div className="h-9 bg-muted/50" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 px-3 py-3 border-b last:border-0">
          <div className="flex-1 h-4 bg-muted rounded" />
          <div className="h-4 w-20 bg-muted rounded" />
          <div className="h-4 w-16 bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}
