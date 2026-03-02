import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, Fragment } from 'react';
import {
  AlertCircle,
  Ban,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lock,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Users,
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
  tee: 'black' | 'blue' | 'white' | null;
  autoCalculateMoney: number; // 0 | 1
  headcount: number | null;
  createdAt: number;
  groupCompletion: { total: number; complete: number };
};

type RoundPlayer = {
  playerId: number;
  name: string;
  ghinNumber: string | null;
  groupId: number;
  groupNumber: number;
  handicapIndex: number;
  isSub: number;
};

type GroupDetail = {
  id: number;
  roundId: number;
  groupNumber: number;
};

type RosterPlayer = {
  id: number;
  name: string;
  ghinNumber: string | null;
  isActive: number;
  isGuest: number;
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
  const [tee, setTee] = useState<'black' | 'blue' | 'white' | ''>('');
  const [formError, setFormError] = useState<string | null>(null);

  const noSeasons = !isLoading && seasons.length === 0;

  const addMutation = useMutation({
    mutationFn: (body: {
      seasonId: number;
      type: 'official' | 'casual';
      scheduledDate: string;
      entryCode?: string;
      tee?: 'black' | 'blue' | 'white';
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
      setTee('');
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
      ...(tee ? { tee } : {}),
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

            {/* Tee selection */}
            <select
              value={tee}
              onChange={(e) => setTee(e.target.value as 'black' | 'blue' | 'white' | '')}
              disabled={addMutation.isPending}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Tees (optional)</option>
              <option value="black">Black</option>
              <option value="blue">Blue</option>
              <option value="white">White</option>
            </select>

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
  const [handicapExpandedId, setHandicapExpandedId] = useState<number | null>(null);
  const [groupsExpandedId, setGroupsExpandedId] = useState<number | null>(null);

  function toggleGroups(roundId: number) {
    setGroupsExpandedId((prev) => (prev === roundId ? null : roundId));
    setHandicapExpandedId(null); // close HI panel when opening groups
  }

  function toggleHandicap(roundId: number) {
    setHandicapExpandedId((prev) => (prev === roundId ? null : roundId));
    setGroupsExpandedId(null); // close groups panel when opening HI
  }

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
          {rounds.map((r) => (
            <Fragment key={r.id}>
              {editingId === r.id ? (
                <EditRow round={r} onClose={() => setEditingId(null)} />
              ) : (
                <RoundRow
                  round={r}
                  onEdit={() => setEditingId(r.id)}
                  handicapExpanded={handicapExpandedId === r.id}
                  onToggleHandicap={() => toggleHandicap(r.id)}
                  groupsExpanded={groupsExpandedId === r.id}
                  onToggleGroups={() => toggleGroups(r.id)}
                />
              )}
              {handicapExpandedId === r.id && editingId !== r.id && (
                <tr className="border-b bg-muted/10">
                  <td colSpan={5} className="p-0">
                    <HandicapPanel roundId={r.id} />
                  </td>
                </tr>
              )}
              {groupsExpandedId === r.id && editingId !== r.id && (
                <tr className="border-b bg-muted/10">
                  <td colSpan={5} className="p-0">
                    <GroupsPanel roundId={r.id} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round Row
// ---------------------------------------------------------------------------

function RoundRow({
  round,
  onEdit,
  handicapExpanded,
  onToggleHandicap,
  groupsExpanded,
  onToggleGroups,
}: {
  round: Round;
  onEdit: () => void;
  handicapExpanded: boolean;
  onToggleHandicap: () => void;
  groupsExpanded: boolean;
  onToggleGroups: () => void;
}) {
  const navigate = useNavigate();
  const dimmed = round.status === 'cancelled' || round.status === 'finalized';
  const editable = round.status === 'scheduled' || round.status === 'active';
  const { total, complete } = round.groupCompletion ?? { total: 0, complete: 0 };
  const allComplete = total > 0 && complete === total;

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

  const finalizeMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ id: number; status: string }>(`/admin/rounds/${id}/finalize`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-rounds'] }),
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') void navigate({ to: '/admin/login' });
    },
  });

  const isBusy = cancelMutation.isPending || finalizeMutation.isPending;

  function handleCancel() {
    if (!window.confirm(`Cancel round on ${formatDate(round.scheduledDate)}? This cannot be undone.`)) return;
    cancelMutation.mutate(round.id);
  }

  function handleFinalize() {
    if (!window.confirm(`Finalize round on ${formatDate(round.scheduledDate)}? Scores will be locked.`)) return;
    finalizeMutation.mutate(round.id);
  }

  return (
    <tr className={`border-b last:border-0 ${dimmed ? 'opacity-60' : ''}`}>
      <td className="py-2 px-3 font-medium">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {formatDate(round.scheduledDate)}
        </span>
        {round.tee && (
          <span className="text-xs mt-0.5 block text-muted-foreground capitalize">{round.tee} tees</span>
        )}
        {round.status === 'active' && round.type === 'official' && total > 0 && (
          <span className={`text-xs mt-0.5 block ${allComplete ? 'text-green-600' : 'text-muted-foreground'}`}>
            {complete}/{total} groups complete
          </span>
        )}
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
          <div className="flex items-center justify-end gap-1 flex-wrap">
            {round.status === 'active' && round.type === 'official' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleFinalize}
                disabled={isBusy || !allComplete}
                title={allComplete ? 'Finalize round' : 'Waiting for all groups to finish'}
                aria-label="Finalize round"
              >
                {finalizeMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Lock className="h-3 w-3" />
                )}
                <span className="ml-1 hidden sm:inline">Finalize</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleGroups}
              disabled={isBusy}
              aria-label="Toggle groups panel"
              title="Manage groups and player assignments"
            >
              {groupsExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <Users className="h-3 w-3" />
              )}
              <span className="ml-1 hidden sm:inline">Groups</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleHandicap}
              disabled={isBusy}
              aria-label="Toggle handicap panel"
              title="View / set handicap indexes"
            >
              {handicapExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span className="ml-1 hidden sm:inline">HI</span>
            </Button>
            <Button variant="outline" size="sm" onClick={onEdit} disabled={isBusy} aria-label="Edit round">
              <Pencil className="h-3 w-3" />
              <span className="ml-1 hidden sm:inline">Edit</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={isBusy}
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
  const [tee, setTee] = useState<'black' | 'blue' | 'white' | ''>(round.tee ?? '');
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
    const resolvedTee = tee || null;
    if (resolvedTee !== round.tee) patch['tee'] = resolvedTee;

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

            {/* Tee */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Tees</label>
              <select
                value={tee}
                onChange={(e) => setTee(e.target.value as 'black' | 'blue' | 'white' | '')}
                disabled={editMutation.isPending}
                className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— none —</option>
                <option value="black">Black</option>
                <option value="blue">Blue</option>
                <option value="white">White</option>
              </select>
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
// Groups Panel
// ---------------------------------------------------------------------------

function GroupsPanel({ roundId }: { roundId: number }) {
  const navigate = useNavigate();

  const groupsQuery = useQuery({
    queryKey: ['admin-round-groups', roundId],
    queryFn: () => apiFetch<{ items: GroupDetail[] }>(`/admin/rounds/${roundId}/groups`),
    retry: false,
  });

  const playersQuery = useQuery({
    queryKey: ['admin-round-players', roundId],
    queryFn: () => apiFetch<{ items: RoundPlayer[] }>(`/admin/rounds/${roundId}/players`),
    retry: false,
  });

  const rosterQuery = useQuery({
    queryKey: ['admin-roster'],
    queryFn: () => apiFetch<{ items: RosterPlayer[] }>('/admin/players'),
    retry: false,
  });

  const addGroupMutation = useMutation({
    mutationFn: (groupNumber: number) =>
      apiFetch<{ group: GroupDetail }>(`/admin/rounds/${roundId}/groups`, {
        method: 'POST',
        body: JSON.stringify({ groupNumber }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-round-groups', roundId] });
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') void navigate({ to: '/admin/login' });
    },
  });

  for (const q of [groupsQuery, playersQuery, rosterQuery]) {
    if ((q.error as Error | null)?.message === 'UNAUTHORIZED') {
      void navigate({ to: '/admin/login' });
      return null;
    }
  }

  if (groupsQuery.isLoading || playersQuery.isLoading || rosterQuery.isLoading) {
    return (
      <div className="p-3 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (groupsQuery.isError || playersQuery.isError || rosterQuery.isError) {
    return <div className="p-3 text-xs text-destructive">Could not load group data.</div>;
  }

  const groupList = groupsQuery.data?.items ?? [];
  const roundPlayerList = playersQuery.data?.items ?? [];
  const roster = (rosterQuery.data?.items ?? []).filter(
    (p) => p.isActive === 1 && p.isGuest === 0,
  );
  const assignedPlayerIds = new Set(roundPlayerList.map((p) => p.playerId));
  const nextGroupNumber = groupList.length + 1;

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Group Assignments
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-xs"
          onClick={() => addGroupMutation.mutate(nextGroupNumber)}
          disabled={addGroupMutation.isPending || groupList.length >= 4}
          title={groupList.length >= 4 ? 'Max 4 groups' : 'Add a new group'}
        >
          {addGroupMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          <span className="ml-1">Add Group</span>
        </Button>
      </div>

      {groupList.length === 0 ? (
        <p className="text-xs text-muted-foreground">No groups yet — add one above.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groupList.map((group) => {
            const groupPlayers = roundPlayerList.filter((p) => p.groupId === group.id);
            const availableRoster = roster.filter((p) => !assignedPlayerIds.has(p.id));
            return (
              <GroupCard
                key={group.id}
                roundId={roundId}
                group={group}
                groupPlayers={groupPlayers}
                availableRoster={availableRoster}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  roundId,
  group,
  groupPlayers,
  availableRoster,
}: {
  roundId: number;
  group: GroupDetail;
  groupPlayers: RoundPlayer[];
  availableRoster: RosterPlayer[];
}) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [hiValue, setHiValue] = useState('');
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [addError, setAddError] = useState<string | null>(null);

  const addPlayerMutation = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>(
        `/admin/rounds/${roundId}/groups/${group.id}/players`,
        {
          method: 'POST',
          body: JSON.stringify({
            playerId: Number(selectedPlayerId),
            handicapIndex: Number(hiValue),
          }),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-round-players', roundId] });
      setAdding(false);
      setSelectedPlayerId('');
      setHiValue('');
      setAddError(null);
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') { void navigate({ to: '/admin/login' }); return; }
      if (err.message === 'CONFLICT') { setAddError('Player already in this round.'); return; }
      setAddError('Could not add player — try again.');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (playerId: number) =>
      apiFetch<{ success: boolean }>(
        `/admin/rounds/${roundId}/groups/${group.id}/players/${playerId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-round-players', roundId] });
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') void navigate({ to: '/admin/login' });
    },
  });

  const selectedRosterPlayer = availableRoster.find((p) => p.id === Number(selectedPlayerId));

  async function handleFetchHI() {
    if (!selectedRosterPlayer?.ghinNumber) return;
    setFetchState('loading');
    try {
      const result = await apiFetch<{ handicapIndex: number | null }>(
        `/admin/ghin/${selectedRosterPlayer.ghinNumber}`,
      );
      if (result.handicapIndex !== null) setHiValue(String(result.handicapIndex));
      setFetchState('idle');
    } catch {
      setFetchState('error');
    }
  }

  const hiNum = Number(hiValue);
  const hiInvalid = hiValue === '' || isNaN(hiNum) || hiNum < 0 || hiNum > 54;

  return (
    <div className="rounded-md border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
        <p className="text-xs font-semibold">Group {group.groupNumber}</p>
        <span className="text-xs text-muted-foreground">{groupPlayers.length}/4 players</span>
      </div>
      <div className="px-3 py-2 flex flex-col gap-1.5">
        {groupPlayers.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No players assigned</p>
        ) : (
          groupPlayers.map((p) => (
            <div key={p.playerId} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">{p.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">HI {p.handicapIndex}</span>
                <button
                  type="button"
                  onClick={() => removeMutation.mutate(p.playerId)}
                  disabled={removeMutation.isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  aria-label={`Remove ${p.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))
        )}

        {!adding && groupPlayers.length < 4 && availableRoster.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs text-primary underline underline-offset-2 hover:no-underline mt-1 self-start"
          >
            + Add Player
          </button>
        )}

        {!adding && availableRoster.length === 0 && groupPlayers.length < 4 && (
          <p className="text-xs text-muted-foreground mt-1">All roster players assigned.</p>
        )}

        {adding && (
          <div className="flex flex-col gap-1.5 mt-1 pt-2 border-t">
            <div className="flex flex-wrap gap-1.5 items-center">
              <select
                value={selectedPlayerId}
                onChange={(e) => {
                  setSelectedPlayerId(e.target.value);
                  setHiValue('');
                  setFetchState('idle');
                }}
                disabled={addPlayerMutation.isPending}
                className="flex-1 min-w-32 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select player</option>
                {availableRoster.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                max={54}
                step={0.1}
                placeholder="HI"
                value={hiValue}
                onChange={(e) => setHiValue(e.target.value)}
                disabled={addPlayerMutation.isPending}
                className="w-16 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {selectedRosterPlayer?.ghinNumber && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => void handleFetchHI()}
                  disabled={fetchState === 'loading' || addPlayerMutation.isPending}
                  title="Fetch HI from GHIN"
                >
                  {fetchState === 'loading' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Fetch HI'
                  )}
                </Button>
              )}
            </div>
            {fetchState === 'error' && (
              <p className="text-xs text-destructive">GHIN fetch failed</p>
            )}
            {addError && <p className="text-xs text-destructive">{addError}</p>}
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => addPlayerMutation.mutate()}
                disabled={!selectedPlayerId || hiInvalid || addPlayerMutation.isPending}
              >
                {addPlayerMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  'Add'
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => { setAdding(false); setAddError(null); }}
                disabled={addPlayerMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Handicap Panel
// ---------------------------------------------------------------------------

function HandicapPanel({ roundId }: { roundId: number }) {
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-round-players', roundId],
    queryFn: () => apiFetch<{ items: RoundPlayer[] }>(`/admin/rounds/${roundId}/players`),
    retry: false,
  });

  if ((error as Error | null)?.message === 'UNAUTHORIZED') {
    void navigate({ to: '/admin/login' });
    return null;
  }

  if (isLoading) {
    return (
      <div className="p-3 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-3 text-xs text-destructive">Could not load players for this round.</div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">No players in this round yet.</div>
    );
  }

  return (
    <div className="p-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Handicap Indexes
      </p>
      <div className="flex flex-col gap-1.5">
        {data.items.map((p) => (
          <PlayerHIRow key={p.playerId} roundId={roundId} player={p} />
        ))}
      </div>
    </div>
  );
}

function PlayerHIRow({ roundId, player }: { roundId: number; player: RoundPlayer }) {
  const navigate = useNavigate();
  const [hiValue, setHiValue] = useState(String(player.handicapIndex));
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ playerId: number; roundId: number; handicapIndex: number }>(
        `/admin/rounds/${roundId}/players/${player.playerId}/handicap`,
        {
          method: 'PATCH',
          body: JSON.stringify({ handicapIndex: Number(hiValue) }),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-round-players', roundId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') void navigate({ to: '/admin/login' });
    },
  });

  async function handleFetch() {
    if (!player.ghinNumber) return;
    setFetchState('loading');
    try {
      const result = await apiFetch<{ handicapIndex: number | null }>(
        `/admin/ghin/${player.ghinNumber}`,
      );
      if (result.handicapIndex !== null) {
        setHiValue(String(result.handicapIndex));
      }
      setFetchState('idle');
    } catch {
      setFetchState('error');
    }
  }

  const hiNum = Number(hiValue);
  const hiInvalid = isNaN(hiNum) || hiNum < 0 || hiNum > 54;

  return (
    <div className="flex items-center gap-2 text-sm flex-wrap">
      <span className="w-28 font-medium truncate text-xs">{player.name}</span>
      <span className="text-xs text-muted-foreground">Grp {player.groupNumber}</span>
      <input
        type="number"
        min={0}
        max={54}
        step={0.1}
        value={hiValue}
        onChange={(e) => { setHiValue(e.target.value); setSaved(false); }}
        className="w-20 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        disabled={saveMutation.isPending}
      />
      {player.ghinNumber && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => void handleFetch()}
          disabled={fetchState === 'loading' || saveMutation.isPending}
          title="Fetch from GHIN"
        >
          {fetchState === 'loading' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Fetch'}
        </Button>
      )}
      {fetchState === 'error' && (
        <span className="text-xs text-destructive">Fetch failed</span>
      )}
      <Button
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || hiInvalid}
      >
        {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
      </Button>
      {saved && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
      {saveMutation.isError && (
        <span className="text-xs text-destructive">Save failed</span>
      )}
    </div>
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
