import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AlertCircle,
  Ban,
  CalendarDays,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Season = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  totalRounds: number;
  playoffFormat: string;
  harveyLiveEnabled: number;
  createdAt: number;
};

type Round = {
  id: number;
  seasonId: number;
  type: 'official' | 'casual';
  status: 'scheduled' | 'active' | 'finalized' | 'cancelled';
  scheduledDate: string;
  autoCalculateMoney: number; // 0 | 1
  headcount: number | null;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const STATUS_LABEL: Record<Round['status'], string> = {
  scheduled: 'Scheduled',
  active: 'Active',
  finalized: 'Finalized',
  cancelled: 'Cancelled',
};

const STATUS_BADGE: Record<Round['status'], string> = {
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  finalized: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

const TYPE_BADGE: Record<Round['type'], string> = {
  official: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  casual: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
};

function Badge({ text, className }: { text: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/admin/rounds')({
  component: RoundsPage,
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function RoundsPage() {
  const navigate = useNavigate();

  const seasonsQuery = useQuery({
    queryKey: ['admin-seasons'],
    queryFn: () => apiFetch<{ items: Season[] }>('/admin/seasons'),
    retry: false,
  });

  const roundsQuery = useQuery({
    queryKey: ['admin-rounds'],
    queryFn: () => apiFetch<{ items: Round[] }>('/admin/rounds'),
    retry: false,
  });

  const isLoading = seasonsQuery.isLoading || roundsQuery.isLoading;
  const isError = seasonsQuery.isError || roundsQuery.isError;
  const error = seasonsQuery.error ?? roundsQuery.error;

  if (isError) {
    if ((error as Error).message === 'UNAUTHORIZED') {
      void navigate({ to: '/admin/login' });
      return null;
    }
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4">Rounds</h2>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load rounds — tap to retry</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void seasonsQuery.refetch();
              void roundsQuery.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const seasons = seasonsQuery.data?.items ?? [];
  const rounds = roundsQuery.data?.items ?? [];

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Rounds</h2>

      <CreateRoundForm seasons={seasons} isLoading={isLoading} />

      <div className="mt-6">
        {isLoading ? (
          <LoadingSkeleton />
        ) : rounds.length === 0 ? (
          <p className="text-muted-foreground text-sm">No rounds yet.</p>
        ) : (
          <RoundsTable rounds={rounds} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Round Form
// ---------------------------------------------------------------------------

function CreateRoundForm({ seasons, isLoading }: { seasons: Season[]; isLoading: boolean }) {
  const navigate = useNavigate();
  const [seasonId, setSeasonId] = useState('');
  const [roundType, setRoundType] = useState<'official' | 'casual'>('official');
  const [scheduledDate, setScheduledDate] = useState('');
  const [entryCode, setEntryCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const noSeasons = !isLoading && seasons.length === 0;

  const addMutation = useMutation({
    mutationFn: (body: {
      seasonId: number;
      type: 'official' | 'casual';
      scheduledDate: string;
      entryCode?: string;
    }) =>
      apiFetch<{ round: Round }>('/admin/rounds', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-rounds'] });
      setSeasonId('');
      setRoundType('official');
      setScheduledDate('');
      setEntryCode('');
      setFormError(null);
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      setFormError('Could not create round — try again.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!seasonId) { setFormError('Select a season.'); return; }
    if (!scheduledDate) { setFormError('Date is required.'); return; }
    if (roundType === 'official' && !entryCode.trim()) {
      setFormError('Entry code is required for official rounds.');
      return;
    }
    setFormError(null);
    addMutation.mutate({
      seasonId: Number(seasonId),
      type: roundType,
      scheduledDate,
      ...(roundType === 'official' && entryCode.trim() ? { entryCode: entryCode.trim() } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border p-4 bg-muted/20">
      <h3 className="text-sm font-semibold mb-3">Create Round</h3>

      {noSeasons ? (
        <p className="text-sm text-muted-foreground">
          Create a season first (<Link to="/admin/season" className="underline underline-offset-2">Season settings</Link>).
        </p>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Season select */}
            <select
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
              disabled={addMutation.isPending}
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Season *</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            {/* Date */}
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              disabled={addMutation.isPending}
              className="w-full sm:w-44 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              required
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mt-2">
            {/* Type toggle */}
            <div className="flex rounded-md border overflow-hidden shrink-0">
              {(['official', 'casual'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRoundType(t)}
                  disabled={addMutation.isPending}
                  className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                    roundType === t
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Entry code — official only */}
            {roundType === 'official' && (
              <input
                type="text"
                placeholder="Entry Code *"
                value={entryCode}
                onChange={(e) => setEntryCode(e.target.value)}
                disabled={addMutation.isPending}
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}

            <Button type="submit" size="sm" disabled={addMutation.isPending} className="shrink-0">
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span className="ml-1">Create</span>
            </Button>
          </div>

          {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}
        </>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Rounds Table
// ---------------------------------------------------------------------------

function RoundsTable({ rounds }: { rounds: Round[] }) {
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Date</th>
            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Type</th>
            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Auto-$</th>
            <th className="py-2 px-3" />
          </tr>
        </thead>
        <tbody>
          {rounds.map((r) =>
            editingId === r.id ? (
              <EditRow key={r.id} round={r} onClose={() => setEditingId(null)} />
            ) : (
              <RoundRow
                key={r.id}
                round={r}
                onEdit={() => setEditingId(r.id)}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round Row
// ---------------------------------------------------------------------------

function RoundRow({ round, onEdit }: { round: Round; onEdit: () => void }) {
  const navigate = useNavigate();
  const dimmed = round.status === 'cancelled' || round.status === 'finalized';
  const editable = round.status === 'scheduled' || round.status === 'active';

  const cancelMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ round: Round }>(`/admin/rounds/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-rounds'] }),
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') void navigate({ to: '/admin/login' });
    },
  });

  function handleCancel() {
    if (!window.confirm(`Cancel round on ${formatDate(round.scheduledDate)}? This cannot be undone.`)) return;
    cancelMutation.mutate(round.id);
  }

  return (
    <tr className={`border-b last:border-0 ${dimmed ? 'opacity-60' : ''}`}>
      <td className="py-2 px-3 font-medium">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {formatDate(round.scheduledDate)}
        </span>
      </td>
      <td className="py-2 px-3">
        <Badge text={round.type === 'official' ? 'Official' : 'Casual'} className={TYPE_BADGE[round.type]} />
      </td>
      <td className="py-2 px-3">
        <Badge text={STATUS_LABEL[round.status]} className={STATUS_BADGE[round.status]} />
      </td>
      <td className="py-2 px-3">
        {round.autoCalculateMoney === 1 ? (
          <Check className="h-4 w-4 text-green-600" aria-label="Auto-money on" />
        ) : (
          <X className="h-4 w-4 text-muted-foreground" aria-label="Auto-money off" />
        )}
      </td>
      <td className="py-2 px-3">
        {editable && (
          <div className="flex items-center justify-end gap-1">
            <Button variant="outline" size="sm" onClick={onEdit} disabled={cancelMutation.isPending} aria-label="Edit round">
              <Pencil className="h-3 w-3" />
              <span className="ml-1 hidden sm:inline">Edit</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
              aria-label="Cancel round"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Ban className="h-3 w-3" />
              )}
              <span className="ml-1 hidden sm:inline">Cancel</span>
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Edit Row
// ---------------------------------------------------------------------------

function EditRow({ round, onClose }: { round: Round; onClose: () => void }) {
  const navigate = useNavigate();
  const [date, setDate] = useState(round.scheduledDate);
  const [headcount, setHeadcount] = useState(String(round.headcount ?? ''));
  const [entryCode, setEntryCode] = useState('');
  const [autoMoney, setAutoMoney] = useState(round.autoCalculateMoney === 1);
  const [editError, setEditError] = useState<string | null>(null);

  const editMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ round: Round }>(`/admin/rounds/${round.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-rounds'] });
      onClose();
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      setEditError('Could not save — try again.');
    },
  });

  function handleSave() {
    const patch: Record<string, unknown> = {};
    if (date !== round.scheduledDate) patch['scheduledDate'] = date;
    const parsedHeadcount = headcount.trim() ? Number(headcount) : undefined;
    if (parsedHeadcount !== undefined && parsedHeadcount !== (round.headcount ?? undefined)) {
      patch['headcount'] = parsedHeadcount;
    }
    if (entryCode.trim() && round.type === 'official') patch['entryCode'] = entryCode.trim();
    if (autoMoney !== (round.autoCalculateMoney === 1)) patch['autoCalculateMoney'] = autoMoney;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setEditError(null);
    editMutation.mutate(patch);
  }

  return (
    <tr className="border-b last:border-0 bg-muted/20">
      <td className="py-3 px-3" colSpan={5}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Date */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={editMutation.isPending}
                className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Headcount */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Headcount</label>
              <input
                type="number"
                placeholder="e.g. 12"
                value={headcount}
                min={1}
                onChange={(e) => setHeadcount(e.target.value)}
                disabled={editMutation.isPending}
                className="w-28 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Entry code — official only */}
            {round.type === 'official' && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">New Entry Code</label>
                <input
                  type="text"
                  placeholder="Leave blank to keep"
                  value={entryCode}
                  onChange={(e) => setEntryCode(e.target.value)}
                  disabled={editMutation.isPending}
                  className="w-44 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {/* Auto-money toggle */}
            <div className="flex flex-col gap-1 justify-end">
              <label className="text-xs text-muted-foreground">Auto-Money</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoMoney}
                  onChange={(e) => setAutoMoney(e.target.checked)}
                  disabled={editMutation.isPending}
                  className="rounded"
                />
                <span className="text-sm">{autoMoney ? 'On' : 'Off'}</span>
              </label>
            </div>
          </div>

          <div className="flex gap-1">
            <Button size="sm" onClick={handleSave} disabled={editMutation.isPending}>
              {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={editMutation.isPending}>
              Cancel
            </Button>
          </div>
          {editError && <p className="text-sm text-destructive">{editError}</p>}
        </div>
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
