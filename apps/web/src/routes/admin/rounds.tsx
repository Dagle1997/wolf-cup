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
  ExternalLink,
  Lock,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Shuffle,
  Trash2,
  UserPlus,
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
  roundNumber: number | null;
  type: 'official' | 'casual';
  status: 'scheduled' | 'active' | 'finalized' | 'cancelled';
  scheduledDate: string;
  tee: 'black' | 'blue' | 'white' | null;
  autoCalculateMoney: number; // 0 | 1
  headcount: number | null;
  entryCode: string | null;
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
  handicapIndex: number | null;
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

  const currentSeason = [...seasons].sort((a, b) => b.id - a.id)[0] ?? null;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Rounds</h2>

      {currentSeason && (
        <HarveyLiveToggle season={currentSeason} />
      )}

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
// Harvey Live Toggle
// ---------------------------------------------------------------------------

function HarveyLiveToggle({ season }: { season: Season }) {
  const navigate = useNavigate();
  const enabled = season.harveyLiveEnabled === 1;

  const toggleMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ season: Season }>(`/admin/seasons/${season.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ harveyLiveEnabled: !enabled }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') void navigate({ to: '/admin/login' });
    },
  });

  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2 mb-4 bg-muted/20">
      <div>
        <p className="text-sm font-medium">Harvey Live Points</p>
        <p className="text-xs text-muted-foreground">
          Show projected Harvey pts on leaderboard · {season.name}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => toggleMutation.mutate()}
        disabled={toggleMutation.isPending}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:opacity-50 ${enabled ? 'bg-primary' : 'bg-input'}`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
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
    <div className="flex flex-col gap-2">
      {rounds.map((r) => (
        <Fragment key={r.id}>
          {editingId === r.id ? (
            <div className="rounded-md border p-3 bg-muted/10">
              <EditRow round={r} onClose={() => setEditingId(null)} />
            </div>
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
            <div className="rounded-md border bg-muted/10 -mt-1">
              <HandicapPanel roundId={r.id} />
            </div>
          )}
          {groupsExpandedId === r.id && editingId !== r.id && (
            <div className="rounded-md border bg-muted/10 -mt-1">
              <GroupsPanel roundId={r.id} seasonId={r.seasonId} />
            </div>
          )}
        </Fragment>
      ))}
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

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ deleted: boolean }>(`/admin/rounds/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-rounds'] }),
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') void navigate({ to: '/admin/login' });
    },
  });

  const isBusy = cancelMutation.isPending || finalizeMutation.isPending || deleteMutation.isPending;
  const canDelete = round.status !== 'finalized';

  function handleDelete() {
    if (!window.confirm(`Permanently delete round on ${formatDate(round.scheduledDate)}? This cannot be undone.`)) return;
    deleteMutation.mutate(round.id);
  }

  function handleCancel() {
    if (!window.confirm(`Cancel round on ${formatDate(round.scheduledDate)}? This cannot be undone.`)) return;
    cancelMutation.mutate(round.id);
  }

  function handleFinalize() {
    if (!window.confirm(`Finalize round on ${formatDate(round.scheduledDate)}? Scores will be locked.`)) return;
    finalizeMutation.mutate(round.id);
  }

  const shortDate = (() => {
    const [y, m, d] = round.scheduledDate.split('-').map(Number);
    return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  })();

  return (
    <div className={`rounded-md border overflow-hidden ${dimmed ? 'opacity-50' : ''}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <span className="font-semibold text-sm">
          {round.roundNumber ? `R${round.roundNumber}` : ''}
        </span>
        <span className="text-sm">{shortDate}</span>
        {round.tee && (
          <span className="text-xs text-muted-foreground capitalize">{round.tee}</span>
        )}
        {round.entryCode && (
          <span className="text-xs text-muted-foreground">
            Code: <span className="font-mono font-semibold text-foreground">{round.entryCode}</span>
          </span>
        )}
        <span className="flex-1" />
        {round.status === 'cancelled' && (
          <Badge text="Cancelled" className={STATUS_BADGE['cancelled']} />
        )}
        {round.status === 'finalized' && (
          <Badge text="Final" className={STATUS_BADGE['finalized']} />
        )}
        {round.status === 'active' && total > 0 && (
          <span className={`text-xs ${allComplete ? 'text-green-600 font-medium' : 'text-muted-foreground'}`}>
            {complete}/{total} scored
          </span>
        )}
      </div>

      {/* Actions */}
      {editable && (
        <div className="flex items-center gap-1 px-3 py-2 flex-wrap">
          <Link to={`/pairings/${round.id}`} target="_blank">
            <Button variant="outline" size="sm" aria-label="View pairings">
              <ExternalLink className="h-3 w-3" />
              <span className="ml-1">Pairings</span>
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={onToggleGroups} disabled={isBusy}>
            {groupsExpanded ? <ChevronDown className="h-3 w-3" /> : <Users className="h-3 w-3" />}
            <span className="ml-1">Groups</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onToggleHandicap} disabled={isBusy}>
            {handicapExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span className="ml-1">HI</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit} disabled={isBusy}>
            <Pencil className="h-3 w-3" />
            <span className="ml-1">Edit</span>
          </Button>
          <span className="flex-1" />
          {round.status === 'active' && round.type === 'official' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleFinalize}
              disabled={isBusy || !allComplete}
              title={allComplete ? 'Finalize round' : 'Waiting for all groups to finish'}
            >
              {finalizeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
              <span className="ml-1">Finalize</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isBusy} className="text-muted-foreground">
            {cancelMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={isBusy} className="text-destructive">
            {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        </div>
      )}
      {!editable && canDelete && (
        <div className="flex justify-end px-3 py-2">
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={isBusy} className="text-destructive">
            {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            <span className="ml-1">Delete</span>
          </Button>
        </div>
      )}
    </div>
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
  );
}

// ---------------------------------------------------------------------------
// Groups Panel
// ---------------------------------------------------------------------------

type SuggestedGroup = { groupNumber: number; playerIds: number[] };
type SuggestResponse = { groups: SuggestedGroup[]; remainder: number[]; totalCost: number };
type SubEntry = { id: number; name: string; hi: number; isNew: boolean };

let nextTempId = -1;

function GroupsPanel({ roundId, seasonId: _seasonId }: { roundId: number; seasonId: number }) {
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState<SuggestResponse | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number> | null>(null); // null = not yet initialized
  const [subs, setSubs] = useState<SubEntry[]>([]);
  const [addingSubMode, setAddingSubMode] = useState<'none' | 'existing' | 'new'>('none');
  const [newSubName, setNewSubName] = useState('');
  const [newSubHI, setNewSubHI] = useState('');
  const [existingSubId, setExistingSubId] = useState('');

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

  const suggestMutation = useMutation({
    mutationFn: (playerIds: number[]) =>
      apiFetch<SuggestResponse>(`/admin/rounds/${roundId}/suggest-groups`, {
        method: 'POST',
        body: JSON.stringify({ playerIds }),
      }),
    onSuccess: (data) => setSuggestions(data),
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') void navigate({ to: '/admin/login' });
    },
  });

  const [applying, setApplying] = useState(false);

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
  const allRoster = rosterQuery.data?.items ?? [];
  const roster = allRoster.filter((p) => p.isActive === 1 && p.isGuest === 0);
  const guests = allRoster.filter((p) => p.isGuest === 1);
  const assignedPlayerIds = new Set(roundPlayerList.map((p) => p.playerId));
  const nextGroupNumber = groupList.length + 1;

  // Initialize checkedIds: if players are already assigned to the round, default
  // to just those; otherwise default to all active roster players
  if (checkedIds === null && roster.length > 0) {
    const initialIds = assignedPlayerIds.size > 0
      ? new Set(assignedPlayerIds)
      : new Set(roster.map((p) => p.id));
    queueMicrotask(() => setCheckedIds(initialIds));
  }

  const effectiveCheckedIds = checkedIds ?? (assignedPlayerIds.size > 0
    ? new Set(assignedPlayerIds)
    : new Set(roster.map((p) => p.id)));

  // Pool = checked roster players + subs
  const totalPlayers = effectiveCheckedIds.size + subs.length;
  const numGroups = Math.ceil(totalPlayers / 4);
  const needed = numGroups > 0 ? (numGroups * 4) - totalPlayers : 4 - totalPlayers;
  const isFull = totalPlayers >= 4 && totalPlayers % 4 === 0;

  const suggestionPool = [
    ...Array.from(effectiveCheckedIds),
    ...subs.map((s) => s.id),
  ];
  const canSuggest = suggestionPool.length >= 4;

  // Build HI lookup: assigned players keep their round HI, roster players use stored HI, subs use entered HI
  function getHI(playerId: number): number {
    const rp = roundPlayerList.find((p) => p.playerId === playerId);
    if (rp) return rp.handicapIndex;
    const sub = subs.find((s) => s.id === playerId);
    if (sub) return sub.hi;
    const rosterP = roster.find((p) => p.id === playerId);
    return rosterP?.handicapIndex ?? 0;
  }

  function handleSuggest() {
    suggestMutation.mutate(suggestionPool);
  }

  // Existing guests that aren't already added as subs
  const subIds = new Set(subs.map((s) => s.id));
  const availableGuests = guests.filter((g) => !subIds.has(g.id) && !effectiveCheckedIds.has(g.id));

  function handleAddExistingSub() {
    const id = Number(existingSubId);
    const guest = guests.find((g) => g.id === id);
    if (!guest) return;
    setSubs((prev) => [...prev, { id: guest.id, name: guest.name, hi: guest.handicapIndex ?? 0, isNew: false }]);
    setExistingSubId('');
    setAddingSubMode('none');
  }

  function handleAddNewSub() {
    const name = newSubName.trim();
    const hi = Number(newSubHI);
    if (!name || isNaN(hi) || hi < 0 || hi > 54) return;
    const tempId = nextTempId--;
    setSubs((prev) => [...prev, { id: tempId, name, hi, isNew: true }]);
    setNewSubName('');
    setNewSubHI('');
    setAddingSubMode('none');
  }

  function removeSub(id: number) {
    setSubs((prev) => prev.filter((s) => s.id !== id));
    // Also clear suggestions if they included this sub
    if (suggestions) setSuggestions(null);
  }

  function toggleChecked(playerId: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev ?? roster.map((p) => p.id));
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
    // Clear suggestions when pool changes
    if (suggestions) setSuggestions(null);
  }

  async function handleApply() {
    if (!suggestions) return;
    setApplying(true);
    setApplyError(null);
    try {
      // 1. Create new sub players and map temp IDs to real IDs
      const tempToReal = new Map<number, number>();
      for (const sub of subs) {
        if (sub.isNew) {
          const result = await apiFetch<{ player: { id: number } }>('/admin/players', {
            method: 'POST',
            body: JSON.stringify({ name: sub.name }),
          });
          tempToReal.set(sub.id, result.player.id);
        }
      }

      // 2. Resolve all player IDs (replace temps with real IDs)
      function resolveId(id: number): number {
        return tempToReal.get(id) ?? id;
      }

      // 3. Remove all currently-assigned players from their groups
      for (const rp of roundPlayerList) {
        await apiFetch(
          `/admin/rounds/${roundId}/groups/${rp.groupId}/players/${rp.playerId}`,
          { method: 'DELETE' },
        );
      }

      // 4. Delete existing empty groups
      // (Groups are re-created by apply, but we can't delete groups with the current API.
      //  Instead, create new groups with correct numbers.)

      // 5. Create new groups and add suggested players
      const subIdSet = new Set(subs.map((s) => s.id));
      for (const sg of suggestions.groups) {
        const created = await apiFetch<{ group: GroupDetail }>(
          `/admin/rounds/${roundId}/groups`,
          { method: 'POST', body: JSON.stringify({ groupNumber: sg.groupNumber }) },
        );
        for (const pid of sg.playerIds) {
          const realId = resolveId(pid);
          const isSub = subIdSet.has(pid);
          await apiFetch(`/admin/rounds/${roundId}/groups/${created.group.id}/players`, {
            method: 'POST',
            body: JSON.stringify({ playerId: realId, handicapIndex: getHI(pid), isSub }),
          });
        }
      }

      setSuggestions(null);
      setSubs([]);
      void queryClient.invalidateQueries({ queryKey: ['admin-round-groups', roundId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-round-players', roundId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-roster'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg === 'UNAUTHORIZED') { void navigate({ to: '/admin/login' }); return; }
      setApplyError(`Failed to apply: ${msg}`);
    } finally {
      setApplying(false);
    }
  }

  // Heat color for a group's pairing cost
  function heatColor(cost: number): string {
    if (cost === 0) return 'text-green-600';
    if (cost <= 2) return 'text-yellow-600';
    return 'text-red-600';
  }

  function playerName(id: number): string {
    const sub = subs.find((s) => s.id === id);
    if (sub) return sub.name;
    return roster.find((p) => p.id === id)?.name
      ?? roundPlayerList.find((p) => p.playerId === id)?.name
      ?? `Player ${id}`;
  }

  return (
    <div className="p-3">
      {/* Who's Playing? checklist */}
      <div className="mb-3">
        <button
          type="button"
          onClick={() => setShowChecklist((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
        >
          {showChecklist ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Who&apos;s Playing?
          <span className="normal-case font-normal">({effectiveCheckedIds.size + subs.length} players)</span>
        </button>

        {showChecklist && (
          <div className="mt-2 rounded-md border p-3 bg-muted/10">
            {/* Roster checklist */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {roster.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                  <input
                    type="checkbox"
                    checked={effectiveCheckedIds.has(p.id)}
                    onChange={() => toggleChecked(p.id)}
                    className="rounded"
                  />
                  <span className={effectiveCheckedIds.has(p.id) ? 'font-medium' : 'text-muted-foreground line-through'}>
                    {p.name}
                  </span>
                  <span className="text-muted-foreground">({p.handicapIndex ?? '?'})</span>
                </label>
              ))}
            </div>

            {/* Gap indicator */}
            <div className="mt-3 flex items-center gap-2">
              {isFull ? (
                <p className="text-xs font-medium text-green-600">
                  {totalPlayers} players — {numGroups} group{numGroups !== 1 ? 's' : ''} of 4
                </p>
              ) : totalPlayers >= 4 ? (
                <p className="text-xs font-medium text-yellow-600">
                  {totalPlayers} players — need {needed} more for {numGroups} group{numGroups !== 1 ? 's' : ''}
                </p>
              ) : (
                <p className="text-xs font-medium text-yellow-600">
                  {totalPlayers} player{totalPlayers !== 1 ? 's' : ''} — need {4 - totalPlayers} more for 1 group
                </p>
              )}
            </div>

            {/* Subs chips */}
            {subs.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">Subs:</p>
                <div className="flex flex-wrap gap-1.5">
                  {subs.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 text-xs"
                    >
                      {s.name} ({s.hi})
                      <button
                        type="button"
                        onClick={() => removeSub(s.id)}
                        className="hover:text-destructive transition-colors"
                        aria-label={`Remove ${s.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Add Sub controls */}
            {addingSubMode === 'none' && (
              <div className="mt-2 flex gap-1.5">
                {availableGuests.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setAddingSubMode('existing')}
                  >
                    <UserPlus className="h-3 w-3" />
                    <span className="ml-1">Past Sub</span>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setAddingSubMode('new')}
                >
                  <Plus className="h-3 w-3" />
                  <span className="ml-1">New Sub</span>
                </Button>
              </div>
            )}

            {addingSubMode === 'existing' && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <select
                  value={existingSubId}
                  onChange={(e) => setExistingSubId(e.target.value)}
                  className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select past sub...</option>
                  {availableGuests.map((g) => (
                    <option key={g.id} value={g.id}>{g.name} ({g.handicapIndex ?? '?'})</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleAddExistingSub}
                  disabled={!existingSubId}
                >
                  Add
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => { setAddingSubMode('none'); setExistingSubId(''); }}
                >
                  Cancel
                </Button>
              </div>
            )}

            {addingSubMode === 'new' && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Name"
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  className="w-32 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <input
                  type="number"
                  placeholder="HI"
                  min={0}
                  max={54}
                  step={0.1}
                  value={newSubHI}
                  onChange={(e) => setNewSubHI(e.target.value)}
                  className="w-16 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleAddNewSub}
                  disabled={!newSubName.trim() || !newSubHI || isNaN(Number(newSubHI)) || Number(newSubHI) < 0 || Number(newSubHI) > 54}
                >
                  Add
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => { setAddingSubMode('none'); setNewSubName(''); setNewSubHI(''); }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Group Assignments
        </p>
        <div className="flex gap-1.5">
          {canSuggest && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={handleSuggest}
              disabled={suggestMutation.isPending || applying}
              title="Auto-suggest groups to minimize repeat pairings"
            >
              {suggestMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Shuffle className="h-3 w-3" />
              )}
              <span className="ml-1">Suggest</span>
            </Button>
          )}
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
      </div>

      {suggestions && (
        <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold">Suggested Groups</p>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => void handleApply()}
                disabled={applying}
              >
                {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                <span className="ml-1">Apply</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={handleSuggest}
                disabled={suggestMutation.isPending || applying}
              >
                <RefreshCw className="h-3 w-3" />
                <span className="ml-1">Re-roll</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setSuggestions(null)}
                disabled={applying}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {suggestions.groups.map((sg) => (
                <div key={sg.groupNumber} className="rounded border bg-background px-2 py-1.5">
                  <p className="text-xs font-medium mb-1">Group {sg.groupNumber}</p>
                  <div className="flex flex-wrap gap-1">
                    {sg.playerIds.map((pid) => {
                      const isSub = subs.some((s) => s.id === pid);
                      return (
                        <span
                          key={pid}
                          className={`text-xs px-1.5 py-0.5 rounded ${isSub ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-muted'}`}
                        >
                          {playerName(pid)}
                        </span>
                      );
                    })}
                  </div>
                </div>
            ))}
            {suggestions.remainder.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Unassigned: {suggestions.remainder.map((id) => playerName(id)).join(', ')}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Repeat pairing cost: <span className={heatColor(suggestions.totalCost)}>{suggestions.totalCost}</span>
            </div>
          </div>
          {applyError && <p className="text-xs text-destructive mt-1">{applyError}</p>}
        </div>
      )}

      {groupList.length === 0 && !suggestions ? (
        <p className="text-xs text-muted-foreground">No groups yet — add one above or use Suggest.</p>
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

  const deleteGroupMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean }>(
        `/admin/rounds/${roundId}/groups/${group.id}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-round-groups', roundId] });
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{groupPlayers.length}/4 players</span>
          {groupPlayers.length === 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={() => deleteGroupMutation.mutate()}
              disabled={deleteGroupMutation.isPending}
            >
              {deleteGroupMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
            </Button>
          )}
        </div>
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
