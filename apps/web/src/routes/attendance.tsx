import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttendanceWeek = {
  id: number;
  friday: string;
  weekNumber: number;
  tee: string | null;
};

type AttendancePlayer = {
  id: number;
  name: string;
  handicapIndex: number | null;
  status: 'in' | 'out' | 'unset';
};

type AttendanceResponse = {
  week: AttendanceWeek | null;
  players: AttendancePlayer[];
  confirmed: number;
  total: number;
};

type SeasonWeek = {
  id: number;
  friday: string;
  isActive: number;
  weekNumber: number;
};

type BenchSub = {
  id: number;
  playerId: number;
  name: string;
  ghinNumber: string | null;
  handicapIndex: number | null;
  roundCount: number;
};

type GhinResult = {
  ghinNumber: number;
  firstName: string;
  lastName: string;
  handicapIndex: number | null;
  club: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFriday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const TEE_LABELS: Record<string, string> = {
  blue: 'Blue tees',
  black: 'Black tees',
  white: 'White tees',
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/attendance')({
  component: AttendancePage,
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AttendancePage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedWeekId, setSelectedWeekId] = useState<number | null>(null);

  // Check admin status silently
  useEffect(() => {
    apiFetch<{ authenticated: boolean }>('/admin/auth/check')
      .then(() => setIsAdmin(true))
      .catch(() => setIsAdmin(false));
  }, []);

  // Load default attendance (current/next week)
  const defaultQuery = useQuery({
    queryKey: ['attendance-default'],
    queryFn: () => apiFetch<AttendanceResponse>('/attendance'),
  });

  // Load all weeks for week picker + track seasonId
  const [latestSeasonId, setLatestSeasonId] = useState<number | null>(null);
  const weeksQuery = useQuery({
    queryKey: ['attendance-weeks'],
    queryFn: async () => {
      const seasonsRes = await apiFetch<{ items: { id: number }[] }>('/admin/seasons').catch(() => null);
      if (!seasonsRes || seasonsRes.items.length === 0) return [];
      const latestId = seasonsRes.items[seasonsRes.items.length - 1]!.id;
      setLatestSeasonId(latestId);
      const data = await apiFetch<{ items: SeasonWeek[] }>(`/admin/seasons/${latestId}/weeks`).catch(() => null);
      return data?.items.filter((w) => w.isActive === 1) ?? [];
    },
    enabled: isAdmin,
  });

  // Load specific week attendance (admin only)
  const weekQuery = useQuery({
    queryKey: ['attendance-week', selectedWeekId],
    queryFn: () =>
      apiFetch<AttendanceResponse>(`/admin/attendance/${selectedWeekId}`),
    enabled: isAdmin && selectedWeekId !== null,
  });

  // Use selected week data or default
  const activeData =
    selectedWeekId && weekQuery.data ? weekQuery.data : defaultQuery.data;
  const isLoading =
    selectedWeekId ? weekQuery.isLoading : defaultQuery.isLoading;
  const isFetching =
    selectedWeekId ? weekQuery.isFetching : defaultQuery.isFetching;

  // Set selectedWeekId from default on first load
  useEffect(() => {
    if (defaultQuery.data?.week && selectedWeekId === null) {
      setSelectedWeekId(defaultQuery.data.week.id);
    }
  }, [defaultQuery.data, selectedWeekId]);

  const activeWeeks = weeksQuery.data ?? [];
  const currentIdx = activeWeeks.findIndex((w) => w.id === selectedWeekId);

  function goToPrev() {
    if (currentIdx > 0) {
      setSelectedWeekId(activeWeeks[currentIdx - 1]!.id);
    }
  }

  function goToNext() {
    if (currentIdx < activeWeeks.length - 1) {
      setSelectedWeekId(activeWeeks[currentIdx + 1]!.id);
    }
  }

  if (defaultQuery.isError) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4">Attendance</h2>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load attendance</p>
          <Button variant="outline" size="sm" onClick={() => void defaultQuery.refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold">Attendance</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => {
            void defaultQuery.refetch();
            if (selectedWeekId) void weekQuery.refetch();
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !activeData?.week ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No season or active weeks found.
        </p>
      ) : (
        <>
          {/* Week header with navigation */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium">
                Week {activeData.week.weekNumber} — {formatFriday(activeData.week.friday)}
              </p>
              {activeData.week.tee && (
                <p className="text-xs text-muted-foreground">
                  {TEE_LABELS[activeData.week.tee] ?? activeData.week.tee}
                </p>
              )}
            </div>
            {isAdmin && activeWeeks.length > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={currentIdx <= 0}
                  onClick={goToPrev}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={currentIdx >= activeWeeks.length - 1}
                  onClick={goToNext}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Confirmed count */}
          <p className="text-sm mb-3">
            <span className="font-semibold">{activeData.confirmed}/{activeData.total} confirmed</span>
          </p>

          {/* Player list */}
          <div className="rounded-md border overflow-hidden">
            {activeData.players.map((player) => (
              <PlayerRow
                key={player.id}
                player={player}
                weekId={activeData.week!.id}
                isAdmin={isAdmin}
              />
            ))}
          </div>

          {/* View Groups link — show when a round exists for this week */}
          {activeData.week && (
            <ViewGroupsLink friday={activeData.week.friday} />
          )}

          {/* Create Round (admin only) */}
          {isAdmin && activeData.week && (
            <CreateRoundButton
              weekId={activeData.week.id}
              confirmed={activeData.confirmed}
            />
          )}

          {/* Add Sub section (admin only) */}
          {isAdmin && activeData.week && latestSeasonId && (
            <AddSubSection
              seasonId={latestSeasonId}
              weekId={activeData.week.id}
              onAdded={() => {
                void defaultQuery.refetch();
                if (selectedWeekId) void weekQuery.refetch();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player Row
// ---------------------------------------------------------------------------

function PlayerRow({
  player,
  weekId,
  isAdmin,
}: {
  player: AttendancePlayer;
  weekId: number;
  isAdmin: boolean;
}) {
  const toggleMutation = useMutation({
    mutationFn: (status: 'in' | 'out') =>
      apiFetch<{ status: string; confirmed: number; total: number }>(
        `/admin/attendance/${weekId}/players/${player.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance-default'] });
      void queryClient.invalidateQueries({ queryKey: ['attendance-week', weekId] });
    },
  });

  function handleToggle() {
    if (!isAdmin) return;
    const newStatus = player.status === 'in' ? 'out' : 'in';
    toggleMutation.mutate(newStatus);
  }

  const statusIcon =
    player.status === 'in'
      ? 'bg-green-500'
      : player.status === 'out'
        ? 'bg-red-400'
        : 'bg-gray-300 dark:bg-gray-600';

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={!isAdmin || toggleMutation.isPending}
      className={`w-full flex items-center gap-3 px-4 py-3 border-b last:border-0 text-sm text-left transition-colors ${
        isAdmin ? 'cursor-pointer hover:bg-muted/30 active:bg-muted/50' : 'cursor-default'
      } ${player.status === 'out' ? 'text-muted-foreground' : ''}`}
    >
      <span className={`w-3 h-3 rounded-full shrink-0 ${statusIcon}`} />
      <span className="flex-1 font-medium">{player.name}</span>
      {player.handicapIndex !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {player.handicapIndex.toFixed(1)}
        </span>
      )}
      {toggleMutation.isPending && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// View Groups Link
// ---------------------------------------------------------------------------

function ViewGroupsLink({ friday }: { friday: string }) {
  const roundsQuery = useQuery({
    queryKey: ['rounds-for-week', friday],
    queryFn: () => apiFetch<{ items: { id: number; scheduledDate: string; status: string }[] }>('/rounds'),
  });

  const round = roundsQuery.data?.items.find(
    (r) => r.scheduledDate === friday && (r.status === 'scheduled' || r.status === 'active'),
  );

  if (!round) return null;

  return (
    <div className="mt-3">
      <Link to={`/pairings/${round.id}`}>
        <Button variant="outline" size="sm" className="w-full">
          <ExternalLink className="h-4 w-4 mr-2" />
          View Groups
        </Button>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Round Button
// ---------------------------------------------------------------------------

function CreateRoundButton({ weekId, confirmed }: { weekId: number; confirmed: number }) {
  const navigate = useNavigate();
  const [result, setResult] = useState<{ entryCode: string } | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ round: Record<string, unknown>; entryCode: string }>(
        '/admin/rounds/from-attendance',
        {
          method: 'POST',
          body: JSON.stringify({ seasonWeekId: weekId }),
        },
      ),
    onSuccess: (data) => {
      setResult({ entryCode: data.entryCode });
      void queryClient.invalidateQueries({ queryKey: ['admin-rounds'] });
    },
  });

  const canCreate = confirmed > 0 && confirmed % 4 === 0;
  const remainder = confirmed % 4;
  const needed = remainder === 0 ? 0 : 4 - remainder;

  if (result) {
    return (
      <div className="mt-3 rounded-md border p-3 bg-green-50 dark:bg-green-900/20 text-sm">
        <p className="font-medium text-green-700 dark:text-green-400">
          Round created! Entry code: <span className="font-mono text-lg">{result.entryCode}</span>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void navigate({ to: '/admin/rounds' })}
        >
          Go to Rounds
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <Button
        size="sm"
        className="w-full"
        disabled={!canCreate || createMutation.isPending}
        onClick={() => createMutation.mutate()}
      >
        {createMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin mr-1" />
        ) : null}
        Create Round ({confirmed} players)
      </Button>
      {!canCreate && confirmed > 0 && (
        <p className="text-xs text-muted-foreground mt-1 text-center">
          {needed} more needed for groups of 4
        </p>
      )}
      {createMutation.isError && (
        <p className="text-xs text-destructive mt-1 text-center">
          {(createMutation.error as Error).message === 'VALIDATION_ERROR'
            ? 'Cannot create round — check player count'
            : 'Could not create round — try again'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Sub Section
// ---------------------------------------------------------------------------

function AddSubSection({
  seasonId,
  weekId,
  onAdded,
}: {
  seasonId: number;
  weekId: number;
  onAdded: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [subName, setSubName] = useState('');
  const [searchResults, setSearchResults] = useState<GhinResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Bench subs query
  const benchQuery = useQuery({
    queryKey: ['admin-bench-subs', seasonId],
    queryFn: () => apiFetch<{ items: BenchSub[] }>(`/admin/seasons/${seasonId}/subs`),
    retry: false,
  });

  // Add new sub mutation
  const addNewMutation = useMutation({
    mutationFn: (body: { name: string; ghinNumber?: string; handicapIndex?: number; seasonWeekId: number }) =>
      apiFetch<{ sub: Record<string, unknown> }>(`/admin/seasons/${seasonId}/subs`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-bench-subs', seasonId] });
      onAdded();
      setSubName('');
      setSearchResults([]);
      setShowForm(false);
    },
    onError: () => setFormError('Could not add sub — try again.'),
  });

  // Add bench sub to week mutation
  const addBenchMutation = useMutation({
    mutationFn: (subBenchId: number) =>
      apiFetch<{ sub: Record<string, unknown> }>(`/admin/seasons/${seasonId}/subs/${subBenchId}/add-to-week`, {
        method: 'POST',
        body: JSON.stringify({ seasonWeekId: weekId }),
      }),
    onSuccess: () => {
      onAdded();
    },
    onError: () => setFormError('Could not add sub — try again.'),
  });

  async function handleSearch() {
    if (!subName.trim()) return;
    setSearching(true);
    setFormError(null);
    try {
      const parts = subName.trim().split(/\s+/);
      const lastName = parts[parts.length - 1]!;
      const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
      const params = new URLSearchParams({ last_name: lastName });
      if (firstName) params.set('first_name', firstName);
      const res = await apiFetch<{ results: GhinResult[] }>(`/admin/ghin/search?${params}`);
      setSearchResults(res.results ?? []);
    } catch {
      setFormError('GHIN search failed — add manually.');
    } finally {
      setSearching(false);
    }
  }

  function handleSelectGhin(result: GhinResult) {
    const body: { name: string; ghinNumber: string; handicapIndex?: number; seasonWeekId: number } = {
      name: `${result.firstName} ${result.lastName}`,
      ghinNumber: String(result.ghinNumber),
      seasonWeekId: weekId,
    };
    if (result.handicapIndex !== null) body.handicapIndex = result.handicapIndex;
    addNewMutation.mutate(body);
  }

  function handleAddManual() {
    if (!subName.trim()) { setFormError('Name is required.'); return; }
    addNewMutation.mutate({
      name: subName.trim(),
      seasonWeekId: weekId,
    });
  }

  const benchSubs = benchQuery.data?.items ?? [];

  return (
    <div className="mt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowForm(!showForm)}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-1" />
        Add Sub
      </Button>

      {showForm && (
        <div className="mt-3 rounded-md border p-3 bg-muted/20">
          {/* Returning subs */}
          {benchSubs.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                Returning Subs
              </p>
              <div className="rounded-md border overflow-hidden">
                {benchSubs.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => addBenchMutation.mutate(sub.id)}
                    disabled={addBenchMutation.isPending}
                    className="w-full flex items-center justify-between px-3 py-2.5 border-b last:border-0 text-sm text-left hover:bg-muted/30"
                  >
                    <span>
                      <span className="font-medium">{sub.name}</span>
                      <span className="text-muted-foreground ml-2">
                        {sub.roundCount} round{sub.roundCount !== 1 ? 's' : ''}
                      </span>
                    </span>
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* New sub */}
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            New Sub
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Name (Last or First Last)"
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch(); } }}
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button variant="outline" size="sm" onClick={() => void handleSearch()} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {/* GHIN search results */}
          {searchResults.length > 0 && (
            <div className="mt-2 rounded-md border overflow-hidden">
              {searchResults.map((r) => (
                <button
                  key={r.ghinNumber}
                  type="button"
                  onClick={() => handleSelectGhin(r)}
                  disabled={addNewMutation.isPending}
                  className="w-full flex items-center justify-between px-3 py-2.5 border-b last:border-0 text-sm text-left hover:bg-muted/30"
                >
                  <div>
                    <p className="font-medium">{r.lastName}, {r.firstName}</p>
                    <p className="text-xs text-muted-foreground">
                      #{r.ghinNumber} · {r.handicapIndex !== null ? `${r.handicapIndex} HI` : 'No HI'}
                      {r.club && ` · ${r.club}`}
                    </p>
                  </div>
                  <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Manual add (no GHIN) */}
          {subName.trim() && searchResults.length === 0 && !searching && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={handleAddManual}
              disabled={addNewMutation.isPending}
            >
              {addNewMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              Add "{subName.trim()}" without GHIN
            </Button>
          )}

          {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}
        </div>
      )}
    </div>
  );
}
