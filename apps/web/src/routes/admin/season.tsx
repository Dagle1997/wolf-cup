import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trophy,
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
  harveyLiveEnabled: number; // 0 | 1
  createdAt: number;
};

type SeasonWeek = {
  id: number;
  seasonId: number;
  friday: string;
  isActive: number; // 0 | 1
  tee: string | null; // 'blue' | 'black' | 'white' | null
  weekNumber: number;
  createdAt: number;
};

type SideGame = {
  id: number;
  seasonId: number;
  name: string;
  format: string;
  scheduledRoundIds: number[];
};

type Round = {
  id: number;
  seasonId: number;
  type: 'official' | 'casual';
  status: 'scheduled' | 'active' | 'finalized' | 'cancelled';
  scheduledDate: string;
  autoCalculateMoney: number;
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

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/admin/season')({
  component: SeasonPage,
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function SeasonPage() {
  const navigate = useNavigate();
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);

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

  // 401 on either query → redirect
  if (
    (seasonsQuery.isError && (seasonsQuery.error as Error).message === 'UNAUTHORIZED') ||
    (roundsQuery.isError && (roundsQuery.error as Error).message === 'UNAUTHORIZED')
  ) {
    void navigate({ to: '/admin/login' });
    return null;
  }

  if (seasonsQuery.isError) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4">Season Settings</h2>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load seasons — tap to retry</p>
          <Button variant="outline" size="sm" onClick={() => void seasonsQuery.refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const seasons = seasonsQuery.data?.items ?? [];
  const rounds = roundsQuery.data?.items ?? [];
  const seasonRounds = rounds.filter((r) => r.seasonId === selectedSeasonId);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Season Settings</h2>

      <CreateSeasonForm onCreated={(id) => setSelectedSeasonId(id)} />

      <div className="mt-6">
        {seasonsQuery.isLoading ? (
          <LoadingSkeleton />
        ) : seasons.length === 0 ? (
          <p className="text-sm text-muted-foreground">No seasons yet. Create one above.</p>
        ) : (
          <SeasonList
            seasons={seasons}
            selectedSeasonId={selectedSeasonId}
            onSelect={(id) => setSelectedSeasonId(selectedSeasonId === id ? null : id)}
            onDeselect={() => setSelectedSeasonId(null)}
          />
        )}
      </div>

      {selectedSeasonId !== null && (
        <>
          <div className="mt-6">
            <SeasonWeeksCalendar seasonId={selectedSeasonId} />
          </div>
          <div className="mt-6">
            <SideGamesSection seasonId={selectedSeasonId} rounds={seasonRounds} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Season Form
// ---------------------------------------------------------------------------

function CreateSeasonForm({ onCreated }: { onCreated: (id: number) => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [playoffFormat, setPlayoffFormat] = useState('Round of 8 \u2192 Round of 4');
  const [harveyLive, setHarveyLive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (body: {
      name: string;
      startDate: string;
      endDate: string;
      playoffFormat: string;
      harveyLiveEnabled: boolean;
    }) =>
      apiFetch<{ season: Season }>('/admin/seasons', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });
      onCreated(data.season.id);
      setName('');
      setStartDate('');
      setEndDate('');
      setPlayoffFormat('Round of 8 \u2192 Round of 4');
      setHarveyLive(true);
      setFormError(null);
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      setFormError('Could not create season — try again.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setFormError('Name is required.'); return; }
    if (!startDate) { setFormError('Start date is required.'); return; }
    if (!endDate) { setFormError('End date is required.'); return; }

    // Client-side Friday validation
    const startDay = new Date(startDate + 'T12:00:00').getDay();
    const endDay = new Date(endDate + 'T12:00:00').getDay();
    if (startDay !== 5) { setFormError('Start date must be a Friday.'); return; }
    if (endDay !== 5) { setFormError('End date must be a Friday.'); return; }

    if (!playoffFormat.trim()) { setFormError('Playoff format is required.'); return; }
    setFormError(null);
    addMutation.mutate({
      name: name.trim(),
      startDate,
      endDate,
      playoffFormat: playoffFormat.trim(),
      harveyLiveEnabled: harveyLive,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border p-4 bg-muted/20">
      <h3 className="text-sm font-semibold mb-3">Create Season</h3>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Season Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={addMutation.isPending}
          className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-muted-foreground">Start Date (Friday) *</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={addMutation.isPending}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-muted-foreground">End Date (Friday) *</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={addMutation.isPending}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-center">
          <input
            type="text"
            placeholder="Playoff Format *"
            value={playoffFormat}
            onChange={(e) => setPlayoffFormat(e.target.value)}
            disabled={addMutation.isPending}
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <label className="flex items-center gap-2 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={harveyLive}
              onChange={(e) => setHarveyLive(e.target.checked)}
              disabled={addMutation.isPending}
              className="rounded"
            />
            <span className="text-sm">Harvey Live</span>
          </label>
          <Button type="submit" size="sm" disabled={addMutation.isPending} className="shrink-0">
            {addMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            <span className="ml-1">Create</span>
          </Button>
        </div>
      </div>
      {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Season List
// ---------------------------------------------------------------------------

function SeasonList({
  seasons,
  selectedSeasonId,
  onSelect,
  onDeselect,
}: {
  seasons: Season[];
  selectedSeasonId: number | null;
  onSelect: (id: number) => void;
  onDeselect: () => void;
}) {
  return (
    <div className="rounded-md border overflow-hidden">
      {seasons.map((s) => (
        <div key={s.id}>
          <button
            type="button"
            onClick={() => onSelect(s.id)}
            className={`w-full flex items-center justify-between px-4 py-3 text-left text-sm border-b transition-colors ${
              selectedSeasonId === s.id
                ? 'bg-primary/5 border-l-2 border-l-primary'
                : 'hover:bg-muted/50'
            }`}
          >
            <div>
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(s.startDate)} – {formatDate(s.endDate)} · {s.totalRounds} rounds ·{' '}
                {s.playoffFormat}
              </p>
            </div>
            {s.harveyLiveEnabled === 1 && (
              <span className="ml-3 shrink-0 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full px-2 py-0.5">
                Harvey Live
              </span>
            )}
          </button>
          {selectedSeasonId === s.id && (
            <EditSeasonPanel season={s} onClose={onDeselect} />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Season Panel
// ---------------------------------------------------------------------------

function EditSeasonPanel({ season, onClose }: { season: Season; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(season.name);
  const [startDate, setStartDate] = useState(season.startDate);
  const [endDate, setEndDate] = useState(season.endDate);
  const [playoffFormat, setPlayoffFormat] = useState(season.playoffFormat);
  const [harveyLive, setHarveyLive] = useState(season.harveyLiveEnabled === 1);
  const [editError, setEditError] = useState<string | null>(null);

  const editMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ season: Season }>(`/admin/seasons/${season.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });
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

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ deleted: boolean }>(`/admin/seasons/${season.id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });
      onClose();
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      setEditError('Could not delete — try again.');
    },
  });

  async function handleDelete() {
    try {
      const stats = await apiFetch<{
        seasonName: string;
        roundCount: number;
        playerCount: number;
      }>(`/admin/seasons/${season.id}/stats`);

      const details =
        stats.roundCount > 0
          ? `This will permanently delete "${stats.seasonName}" including ${stats.roundCount} round${stats.roundCount !== 1 ? 's' : ''} and data for ${stats.playerCount} player${stats.playerCount !== 1 ? 's' : ''}. This cannot be undone.`
          : `This will permanently delete "${stats.seasonName}". This cannot be undone.`;

      if (window.confirm(details)) {
        deleteMutation.mutate();
      }
    } catch (err) {
      if ((err as Error).message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      setEditError('Could not load season info — try again.');
    }
  }

  function handleSave() {
    if (name.trim() === '') { setEditError('Name is required.'); return; }
    if (playoffFormat.trim() === '') { setEditError('Playoff format is required.'); return; }
    const patch: Record<string, unknown> = {};
    if (name.trim() !== season.name) patch['name'] = name.trim();
    if (startDate !== season.startDate) patch['startDate'] = startDate;
    if (endDate !== season.endDate) patch['endDate'] = endDate;
    if (playoffFormat.trim() !== season.playoffFormat) patch['playoffFormat'] = playoffFormat.trim();
    if (harveyLive !== (season.harveyLiveEnabled === 1)) patch['harveyLiveEnabled'] = harveyLive;
    if (Object.keys(patch).length === 0) { onClose(); return; }
    setEditError(null);
    editMutation.mutate(patch);
  }

  return (
    <div className="px-4 py-3 bg-muted/10 border-b last:border-0">
      <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
        Edit Season
      </p>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={editMutation.isPending}
          placeholder="Name"
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-muted-foreground">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={editMutation.isPending}
              className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-muted-foreground">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={editMutation.isPending}
              className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <input
          type="text"
          value={playoffFormat}
          onChange={(e) => setPlayoffFormat(e.target.value)}
          disabled={editMutation.isPending}
          placeholder="Playoff Format"
          className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={harveyLive}
            onChange={(e) => setHarveyLive(e.target.checked)}
            disabled={editMutation.isPending}
            className="rounded"
          />
          <span className="text-sm">Harvey Live Enabled</span>
          {harveyLive ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <X className="h-4 w-4 text-muted-foreground" />
          )}
        </label>
        <div className="flex gap-1 mt-1">
          <Button size="sm" onClick={handleSave} disabled={editMutation.isPending || deleteMutation.isPending}>
            {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={editMutation.isPending || deleteMutation.isPending}
          >
            Cancel
          </Button>
          <div className="flex-1" />
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleDelete()}
            disabled={editMutation.isPending || deleteMutation.isPending}
          >
            {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Delete'}
          </Button>
        </div>
        {editError && <p className="text-sm text-destructive">{editError}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tee Badge
// ---------------------------------------------------------------------------

const TEE_STYLES: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  black: 'bg-gray-800 text-white dark:bg-gray-700 dark:text-gray-100',
  white: 'bg-gray-100 text-gray-700 border dark:bg-gray-200 dark:text-gray-800',
};

function TeeBadge({ tee }: { tee: string }) {
  return (
    <span
      className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${TEE_STYLES[tee] ?? 'bg-muted text-muted-foreground'}`}
    >
      {tee}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Season Weeks Calendar
// ---------------------------------------------------------------------------

function SeasonWeeksCalendar({ seasonId }: { seasonId: number }) {
  const navigate = useNavigate();
  const [toggleWarning, setToggleWarning] = useState<string | null>(null);

  const weeksQuery = useQuery({
    queryKey: ['admin-season-weeks', seasonId],
    queryFn: () =>
      apiFetch<{ items: SeasonWeek[]; totalFridays: number; activeRounds: number }>(
        `/admin/seasons/${seasonId}/weeks`,
      ),
    retry: false,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ weekId, isActive }: { weekId: number; isActive: boolean }) =>
      apiFetch<{
        week: SeasonWeek;
        activeRounds: number;
        totalFridays: number;
        hasRound?: boolean;
        warning?: string;
      }>(`/admin/seasons/${seasonId}/weeks/${weekId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-season-weeks', seasonId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-seasons'] });

      // Surface warnings from API response
      if (data.hasRound) {
        setToggleWarning(
          `Week ${data.week.weekNumber} has an existing round — the round is preserved but this week is now ${data.week.isActive === 1 ? 'active' : 'skipped'}.`,
        );
      } else if (data.warning) {
        setToggleWarning(data.warning);
      } else {
        setToggleWarning(null);
      }
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
      }
    },
  });

  if (weeksQuery.isError) {
    if ((weeksQuery.error as Error).message === 'UNAUTHORIZED') {
      void navigate({ to: '/admin/login' });
      return null;
    }
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-muted-foreground">Could not load weeks</p>
        <Button variant="outline" size="sm" onClick={() => void weeksQuery.refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  if (weeksQuery.isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 bg-muted rounded-md" />
        ))}
      </div>
    );
  }

  const items = weeksQuery.data?.items ?? [];
  const totalFridays = weeksQuery.data?.totalFridays ?? 0;
  const activeRounds = weeksQuery.data?.activeRounds ?? 0;
  const skipped = totalFridays - activeRounds;

  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-base font-semibold">Season Calendar</h3>
      </div>

      {activeRounds === 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          No active rounds remaining
        </div>
      )}

      {toggleWarning && (
        <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-sm">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {toggleWarning}
          </span>
          <button
            type="button"
            onClick={() => setToggleWarning(null)}
            className="shrink-0 text-amber-500 hover:text-amber-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-md border overflow-hidden">
        {items.map((week) => (
          <label
            key={week.id}
            className={`flex items-center gap-3 px-3 py-2 border-b last:border-0 text-sm cursor-pointer transition-colors ${
              week.isActive === 0
                ? 'bg-muted/30 text-muted-foreground'
                : 'hover:bg-muted/20'
            }`}
          >
            <input
              type="checkbox"
              checked={week.isActive === 1}
              onChange={() =>
                toggleMutation.mutate({
                  weekId: week.id,
                  isActive: week.isActive === 0,
                })
              }
              disabled={toggleMutation.isPending}
              className="rounded"
            />
            <span className={`flex items-center gap-2 ${week.isActive === 0 ? 'line-through' : ''}`}>
              <span className="font-medium">Week {week.weekNumber}</span>
              {' — '}
              {formatShortDate(week.friday)}
              {week.tee && <TeeBadge tee={week.tee} />}
            </span>
          </label>
        ))}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{activeRounds} active rounds</span>
        {' of '}
        {totalFridays} total Fridays
        {skipped > 0 && ` (${skipped} skipped)`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side Games Section
// ---------------------------------------------------------------------------

function SideGamesSection({ seasonId, rounds }: { seasonId: number; rounds: Round[] }) {
  const navigate = useNavigate();
  const [editingSideGameId, setEditingSideGameId] = useState<number | null>(null);
  const [recordingResultForGameId, setRecordingResultForGameId] = useState<number | null>(null);

  const sideGamesQuery = useQuery({
    queryKey: ['admin-side-games', seasonId],
    queryFn: () => apiFetch<{ items: SideGame[] }>(`/admin/seasons/${seasonId}/side-games`),
    retry: false,
  });

  if (sideGamesQuery.isError) {
    if ((sideGamesQuery.error as Error).message === 'UNAUTHORIZED') {
      void navigate({ to: '/admin/login' });
      return null;
    }
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-muted-foreground">Could not load side games</p>
        <Button variant="outline" size="sm" onClick={() => void sideGamesQuery.refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  const sideGames = sideGamesQuery.data?.items ?? [];

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Side Games</h3>
      <AddSideGameForm seasonId={seasonId} />
      <div className="mt-4">
        {sideGamesQuery.isLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-10 bg-muted rounded-md" />
            ))}
          </div>
        ) : sideGames.length === 0 ? (
          <p className="text-sm text-muted-foreground">No side games yet.</p>
        ) : (
          <div className="rounded-md border overflow-hidden">
            {sideGames.map((g) =>
              editingSideGameId === g.id ? (
                <EditSideGameRow
                  key={g.id}
                  game={g}
                  seasonId={seasonId}
                  onClose={() => setEditingSideGameId(null)}
                />
              ) : recordingResultForGameId === g.id ? (
                <RecordResultRow
                  key={g.id}
                  game={g}
                  rounds={rounds}
                  onClose={() => setRecordingResultForGameId(null)}
                />
              ) : (
                <SideGameRow
                  key={g.id}
                  game={g}
                  onEdit={() => {
                    setRecordingResultForGameId(null);
                    setEditingSideGameId(g.id);
                  }}
                  onRecordResult={() => {
                    setEditingSideGameId(null);
                    setRecordingResultForGameId(g.id);
                  }}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Side Game Form
// ---------------------------------------------------------------------------

function AddSideGameForm({ seasonId }: { seasonId: number }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [format, setFormat] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (body: { name: string; format: string }) =>
      apiFetch<{ sideGame: SideGame }>(`/admin/seasons/${seasonId}/side-games`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-side-games', seasonId] });
      setName('');
      setFormat('');
      setFormError(null);
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      setFormError('Could not add side game — try again.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setFormError('Name is required.'); return; }
    if (!format.trim()) { setFormError('Format is required.'); return; }
    setFormError(null);
    addMutation.mutate({ name: name.trim(), format: format.trim() });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-md border p-3 bg-muted/20">
      <h4 className="text-xs font-semibold mb-2">Add Side Game</h4>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={addMutation.isPending}
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="text"
          placeholder="Format *"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          disabled={addMutation.isPending}
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
      {formError && <p className="mt-1 text-sm text-destructive">{formError}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Side Game Row
// ---------------------------------------------------------------------------

function SideGameRow({
  game,
  onEdit,
  onRecordResult,
}: {
  game: SideGame;
  onEdit: () => void;
  onRecordResult: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b last:border-0 text-sm">
      <div>
        <p className="font-medium">{game.name}</p>
        <p className="text-xs text-muted-foreground">
          {game.format}
          {game.scheduledRoundIds.length > 0
            ? ` · ${game.scheduledRoundIds.length} scheduled round${game.scheduledRoundIds.length !== 1 ? 's' : ''}`
            : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-3">
        <Button variant="outline" size="sm" onClick={onEdit} aria-label="Edit side game">
          <Pencil className="h-3 w-3" />
          <span className="ml-1 hidden sm:inline">Edit</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRecordResult}
          aria-label="Record side game result"
        >
          <Trophy className="h-3 w-3" />
          <span className="ml-1 hidden sm:inline">Result</span>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Side Game Row
// ---------------------------------------------------------------------------

function EditSideGameRow({
  game,
  seasonId,
  onClose,
}: {
  game: SideGame;
  seasonId: number;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(game.name);
  const [format, setFormat] = useState(game.format);
  const [editError, setEditError] = useState<string | null>(null);

  const editMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ sideGame: SideGame }>(`/admin/side-games/${game.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-side-games', seasonId] });
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
    if (name.trim() !== game.name) patch['name'] = name.trim();
    if (format.trim() !== game.format) patch['format'] = format.trim();
    if (Object.keys(patch).length === 0) { onClose(); return; }
    setEditError(null);
    editMutation.mutate(patch);
  }

  return (
    <div className="px-3 py-2 border-b last:border-0 bg-muted/20">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={editMutation.isPending}
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
        <input
          type="text"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          disabled={editMutation.isPending}
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex gap-1 shrink-0">
          <Button size="sm" onClick={handleSave} disabled={editMutation.isPending}>
            {editMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={editMutation.isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
      {editError && <p className="mt-1 text-sm text-destructive">{editError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record Result Row
// ---------------------------------------------------------------------------

function RecordResultRow({
  game,
  rounds,
  onClose,
}: {
  game: SideGame;
  rounds: Round[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [roundId, setRoundId] = useState('');
  const [winnerName, setWinnerName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const sortedRounds = [...rounds].sort((a, b) =>
    a.scheduledDate.localeCompare(b.scheduledDate),
  );
  const noRounds = sortedRounds.length === 0;

  const resultMutation = useMutation({
    mutationFn: (body: { sideGameId: number; winnerName: string }) =>
      apiFetch<Record<string, unknown>>(`/admin/rounds/${roundId}/side-game-results`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setRecorded(true);
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      setFormError('Could not record result — try again.');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!roundId) { setFormError('Select a round.'); return; }
    if (!winnerName.trim()) { setFormError('Winner name is required.'); return; }
    setFormError(null);
    resultMutation.mutate({ sideGameId: game.id, winnerName: winnerName.trim() });
  }

  if (recorded) {
    return (
      <div className="px-3 py-2 border-b last:border-0 bg-green-50 dark:bg-green-900/20 text-sm text-green-700 dark:text-green-400 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Check className="h-4 w-4" />
          Result recorded for {game.name}
        </span>
        <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-3 py-2 border-b last:border-0 bg-muted/20">
      <p className="text-xs font-semibold text-muted-foreground mb-2">
        Record Result — {game.name}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={roundId}
          onChange={(e) => setRoundId(e.target.value)}
          disabled={resultMutation.isPending}
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">
            {noRounds ? 'No rounds for this season' : 'Select round *'}
          </option>
          {sortedRounds.map((r) => (
            <option key={r.id} value={r.id}>
              {formatDate(r.scheduledDate)} ({r.type})
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Winner name *"
          value={winnerName}
          onChange={(e) => setWinnerName(e.target.value)}
          disabled={resultMutation.isPending}
          className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex gap-1 shrink-0">
          <Button type="submit" size="sm" disabled={resultMutation.isPending || noRounds}>
            {resultMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Record'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={resultMutation.isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
      {formError && <p className="mt-1 text-sm text-destructive">{formError}</p>}
    </form>
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
