import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
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

  // Load all weeks for week picker
  const weeksQuery = useQuery({
    queryKey: ['attendance-weeks'],
    queryFn: async () => {
      // Get latest season's weeks via admin or guess from default
      const seasons = await apiFetch<{ items: { id: number }[] }>('/admin/seasons').catch(() => null);
      if (!seasons || seasons.items.length === 0) return [];
      const latestId = seasons.items[seasons.items.length - 1]!.id;
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
