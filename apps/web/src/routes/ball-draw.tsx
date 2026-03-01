import { createFileRoute, useRouter, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { getSession, setSession } from '@/lib/session-store';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Par for each hole 1–18 at Guyan G&CC (from engine/course.ts)
const HOLE_PARS = [4, 4, 4, 3, 4, 4, 3, 5, 4, 4, 3, 4, 4, 5, 4, 3, 4, 4] as const;

const POSITIONS = ['1st', '2nd', '3rd', '4th'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Player = { id: number; name: string; handicapIndex: number };

type Group = {
  id: number;
  groupNumber: number;
  battingOrder: number[] | null;
  players: Player[];
};

type RoundDetail = {
  id: number;
  type: 'official' | 'casual';
  status: string;
  scheduledDate: string;
  autoCalculateMoney: boolean;
  groups: Group[];
};

type WolfHole = {
  holeNumber: number;
  type: 'skins' | 'wolf';
  wolfPlayerId: number | null;
  wolfPlayerName: string | null;
};

type GroupWithSchedule = Group & { wolfSchedule: WolfHole[] };

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/ball-draw')({
  component: BallDrawPage,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildWolfScheduleFromOrder(battingOrder: number[], players: Player[]): WolfHole[] {
  const nameMap = new Map(players.map((p) => [p.id, p.name]));
  return Array.from({ length: 18 }, (_, i) => {
    const holeNumber = i + 1;
    if (holeNumber <= 2) {
      return { holeNumber, type: 'skins' as const, wolfPlayerId: null, wolfPlayerName: null };
    }
    const wolfPlayerId = battingOrder[(holeNumber - 3) % 4]!;
    return {
      holeNumber,
      type: 'wolf' as const,
      wolfPlayerId,
      wolfPlayerName: nameMap.get(wolfPlayerId) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function BallDrawPage() {
  const router = useRouter();
  const session = getSession();

  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    session?.groupId ?? null,
  );
  const [wolfSchedule, setWolfSchedule] = useState<WolfHole[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local player list for the selected group (roster + any guests added this session)
  const [localPlayers, setLocalPlayers] = useState<Player[]>([]);
  // Track which group we've already initialized to avoid overwriting on query refetch
  const initializedGroupRef = useRef<number | null>(null);

  // Guest form state
  const [guestName, setGuestName] = useState('');
  const [guestHandicap, setGuestHandicap] = useState('');
  const [guestError, setGuestError] = useState<string | null>(null);

  // Session guard — redirect immediately if no session
  useEffect(() => {
    if (!session) {
      void router.navigate({ to: '/score-entry' });
    }
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['round', session?.roundId ?? 0],
    queryFn: () =>
      apiFetch<{ round: RoundDetail }>(`/rounds/${session!.roundId}`).then((d) => d.round),
    enabled: session !== null,
    staleTime: 30_000,
  });

  // Auto-select group when data arrives (single-group fast path)
  useEffect(() => {
    if (!data || selectedGroupId !== null) return;
    if (data.groups.length === 1) {
      setSelectedGroupId(data.groups[0]!.id);
    }
  }, [data, selectedGroupId]);

  // Initialize localPlayers from group data when a group is first selected.
  // The ref guard prevents overwriting locally-added guests on query refetch.
  useEffect(() => {
    if (!data || selectedGroupId === null) return;
    if (initializedGroupRef.current === selectedGroupId) return;
    const group = data.groups.find((g) => g.id === selectedGroupId);
    if (group) {
      setLocalPlayers(group.players);
      initializedGroupRef.current = selectedGroupId;
    }
  }, [data, selectedGroupId]);

  // Restore wolf schedule from existing batting order when a group is selected
  // (handles both single-group auto-select and multi-group manual selection)
  useEffect(() => {
    if (!data || selectedGroupId === null || wolfSchedule !== null) return;
    const group = data.groups.find((g) => g.id === selectedGroupId);
    if (group?.battingOrder) {
      setWolfSchedule(buildWolfScheduleFromOrder(group.battingOrder, group.players));
    }
  }, [data, selectedGroupId, wolfSchedule]);

  const guestMutation = useMutation({
    mutationFn: ({ name, handicapIndex }: { name: string; handicapIndex: number }) =>
      apiFetch<{ player: Player }>(
        `/rounds/${session!.roundId}/groups/${selectedGroupId!}/guests`,
        {
          method: 'POST',
          body: JSON.stringify({ name, handicapIndex }),
        },
      ),
    onSuccess: (data) => {
      setLocalPlayers((prev) => [...prev, data.player]);
      setGuestName('');
      setGuestHandicap('');
      setGuestError(null);
    },
    onError: (err: Error) => {
      if (err.message === 'GROUP_FULL') {
        setGuestError('Your group already has 4 players.');
      } else if (err.message === 'CASUAL_ONLY') {
        setGuestError('Guest players can only be added to casual rounds.');
      } else {
        setGuestError('Could not add guest — please try again.');
      }
    },
  });

  const submitMutation = useMutation({
    mutationFn: ({ groupId, order }: { groupId: number; order: number[] }) =>
      apiFetch<{ group: GroupWithSchedule }>(
        `/rounds/${session!.roundId}/groups/${groupId}/batting-order`,
        {
          method: 'PUT',
          headers: session?.entryCode ? { 'x-entry-code': session.entryCode } : {},
          body: JSON.stringify({ order }),
        },
      ),
    onSuccess: (data) => {
      setSession({ ...session!, groupId: data.group.id });
      setWolfSchedule(data.group.wolfSchedule);
      setError(null);
    },
    onError: (err: Error) => {
      if (err.message === 'INVALID_BATTING_ORDER') {
        setError('Invalid batting order — please check player assignments.');
      } else if (err.message === 'INVALID_ENTRY_CODE') {
        setError('Entry code no longer valid — please re-join the round.');
      } else {
        setError('Something went wrong — please try again.');
      }
    },
  });

  // Redirect pending
  if (!session) return null;

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="p-4 flex flex-col gap-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-16 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 flex items-center gap-2 text-destructive text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        Could not load round data. Check your connection and try again.
      </div>
    );
  }

  const groups = data?.groups ?? [];

  // ---------------------------------------------------------------------------
  // Wolf schedule view (after ball draw confirmed or restored from session)
  // ---------------------------------------------------------------------------

  if (wolfSchedule) {
    return (
      <div className="p-4 flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Wolf Assignments</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4">Hole</th>
                <th className="text-left py-2 pr-4">Par</th>
                <th className="text-left py-2 pr-4">Type</th>
                <th className="text-left py-2">Wolf</th>
              </tr>
            </thead>
            <tbody>
              {wolfSchedule.map((hole) => (
                <tr key={hole.holeNumber} className="border-b last:border-0">
                  <td className="py-2 pr-4">{hole.holeNumber}</td>
                  <td className="py-2 pr-4">{HOLE_PARS[hole.holeNumber - 1]}</td>
                  <td className="py-2 pr-4">{hole.type === 'skins' ? 'Skins' : 'Wolf'}</td>
                  <td className="py-2">{hole.wolfPlayerName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link to="/score-entry-hole" className="w-full">
          <Button className="min-h-12 w-full mt-2">Begin Score Entry</Button>
        </Link>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Group selector (multiple groups)
  // ---------------------------------------------------------------------------

  if (selectedGroupId === null) {
    return (
      <div className="p-4 flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Select Your Group</h2>
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <button
              key={g.id}
              className="border rounded-xl p-4 text-left"
              onClick={() => setSelectedGroupId(g.id)}
            >
              <p className="font-medium">Group {g.groupNumber}</p>
              <p className="text-sm text-muted-foreground">
                {g.players.map((p) => p.name).join(', ')}
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Ball draw entry form
  // ---------------------------------------------------------------------------

  const group = groups.find((g) => g.id === selectedGroupId);
  if (!group) {
    return (
      <div className="p-4 flex items-center gap-2 text-destructive text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        Group not found.
      </div>
    );
  }

  const isCasual = data?.type === 'casual';

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Ball Draw</h2>
      <p className="text-sm text-muted-foreground">
        Group {group.groupNumber} · {localPlayers.map((p) => p.name).join(', ') || 'No players yet'}
      </p>

      {/* Guest player form — casual rounds only, when < 4 players and no batting order set */}
      {isCasual && localPlayers.length < 4 && (
        <div className="flex flex-col gap-3 border rounded-xl p-4">
          <p className="text-sm font-medium">
            Add Guest Player ({localPlayers.length}/4)
          </p>
          <input
            type="text"
            placeholder="Guest name"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            className="border rounded-lg p-2 min-h-12 bg-background text-sm"
          />
          <input
            type="number"
            placeholder="Handicap index (e.g. 12.4)"
            min={0}
            max={54}
            step={0.1}
            value={guestHandicap}
            onChange={(e) => setGuestHandicap(e.target.value)}
            className="border rounded-lg p-2 min-h-12 bg-background text-sm"
          />
          {guestError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {guestError}
            </div>
          )}
          <Button
            variant="outline"
            className="min-h-12 w-full"
            disabled={!guestName.trim() || !guestHandicap || guestMutation.isPending}
            onClick={() =>
              guestMutation.mutate({
                name: guestName.trim(),
                handicapIndex: Number(guestHandicap),
              })
            }
          >
            {guestMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding…
              </>
            ) : (
              'Add Guest'
            )}
          </Button>
        </div>
      )}

      {/* Batting order form — shown when 4 players are present */}
      {localPlayers.length >= 4 && (
        <>
          <BattingOrderForm
            players={localPlayers}
            isPending={submitMutation.isPending}
            onSubmit={(order) => submitMutation.mutate({ groupId: group.id, order })}
          />
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </>
      )}

      {/* Message when casual round still needs players */}
      {isCasual && localPlayers.length < 4 && localPlayers.length > 0 && (
        <p className="text-sm text-muted-foreground text-center">
          Add {4 - localPlayers.length} more player{4 - localPlayers.length !== 1 ? 's' : ''} to continue.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batting order form component
// ---------------------------------------------------------------------------

function BattingOrderForm({
  players,
  isPending,
  onSubmit,
}: {
  players: Player[];
  isPending: boolean;
  onSubmit: (order: number[]) => void;
}) {
  const [order, setOrder] = useState<(number | null)[]>([null, null, null, null]);
  const usedIds = new Set(order.filter((id): id is number => id !== null));

  return (
    <div className="flex flex-col gap-3">
      {POSITIONS.map((pos, idx) => (
        <div key={pos} className="flex items-center gap-3">
          <span className="w-8 font-semibold text-sm text-muted-foreground">{pos}</span>
          <select
            className="flex-1 border rounded-lg p-3 min-h-12 bg-background"
            value={order[idx] ?? ''}
            onChange={(e) => {
              const newOrder = [...order];
              newOrder[idx] = e.target.value ? Number(e.target.value) : null;
              setOrder(newOrder);
            }}
          >
            <option value="">— select player —</option>
            {players.map((p) => (
              <option
                key={p.id}
                value={p.id}
                disabled={usedIds.has(p.id) && order[idx] !== p.id}
              >
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ))}
      <Button
        className="min-h-12 w-full mt-2"
        disabled={order.some((id) => id === null) || isPending}
        onClick={() => onSubmit(order as number[])}
      >
        {isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Saving…
          </>
        ) : (
          'Confirm Ball Draw'
        )}
      </Button>
    </div>
  );
}
