import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { getSession, setSession, clearSession, type WolfSession } from '@/lib/session-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Round = {
  id: number;
  type: 'official' | 'casual';
  status: 'scheduled' | 'active' | 'finalized' | 'cancelled';
  scheduledDate: string;
  autoCalculateMoney: boolean;
  roundNumber: number | null;
};

type RoundDetail = Round & {
  groups: Array<{
    id: number;
    groupNumber: number;
    battingOrder: number[] | null;
    players: Array<{ id: number; name: string; handicapIndex: number }>;
  }>;
};

type RoundsResponse = { items: Round[] };
type StartResponse = { round: RoundDetail };

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/score-entry')({
  component: ScoreEntryPage,
});

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function ScoreEntryPage() {
  const router = useRouter();
  const [selectedRound, setSelectedRound] = useState<Round | null>(null);
  const [entryCode, setEntryCode] = useState('');
  const [joined, setJoined] = useState<WolfSession | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  // Fetch available rounds
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rounds', 'available'],
    queryFn: () => apiFetch<RoundsResponse>('/rounds'),
    staleTime: 10_000,
  });

  // Session restore + auto-resume.
  //   - Session has groupId AND round is active → skip straight into scoring.
  //   - Session has no groupId but round is still joinable → show confirmation
  //     card (same as today, tap "Go to Ball Draw").
  //   - Session points at a finalized/cancelled round → clear session, fall
  //     through to the round-list view.
  useEffect(() => {
    if (!data) return;
    const session = getSession();
    if (!session) return;
    const match = data.items.find((r) => r.id === session.roundId);
    if (!match) return; // round not in available list — leave session alone, user may see it elsewhere
    if (match.status === 'finalized' || match.status === 'cancelled') {
      clearSession();
      return;
    }
    if (session.groupId != null) {
      // Fresh mount with a fully-populated session — go direct to scoring.
      void router.navigate({ to: '/score-entry-hole' });
      return;
    }
    // Session without groupId → keep the existing confirmation-card flow.
    setJoined(session);
  }, [data, router]);

  // Start round mutation
  const startMutation = useMutation({
    mutationFn: ({ id, code }: { id: number; code?: string }) =>
      apiFetch<StartResponse>(`/rounds/${id}/start`, {
        method: 'POST',
        headers: code ? { 'x-entry-code': code } : {},
      }),
    onSuccess: (data, variables) => {
      const session: WolfSession = {
        roundId: variables.id,
        entryCode: variables.code ?? null,
        groupId: null,
      };
      setSession(session);
      setJoined(session);
      setCodeError(null);
    },
    onError: (err: Error) => {
      if (err.message === 'INVALID_ENTRY_CODE') {
        setCodeError('Invalid entry code — please try again.');
        setEntryCode('');
      } else if (err.message === 'ROUND_NOT_JOINABLE') {
        setCodeError('This round is no longer joinable.');
      } else {
        setCodeError('Something went wrong. Please try again.');
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Confirmation view (after successfully joining)
  // ---------------------------------------------------------------------------

  if (joined) {
    const round = data?.items.find((r) => r.id === joined.roundId);
    const hasGroup = joined.groupId != null;
    // If groupId is set, route to score-entry-hole which auto-redirects to ball-draw
    // if batting order isn't set yet. This avoids an extra tap-through for returning users.
    const canResumeDirectly = hasGroup;
    return (
      <div className="p-4 flex flex-col items-center gap-4 pt-8">
        <CheckCircle2 className="w-12 h-12 text-green-600" />
        <h2 className="text-xl font-semibold">
          {round?.type === 'official' ? 'Official round joined' : 'Joined casual round — ready to begin'}
        </h2>
        <p className="text-muted-foreground text-sm text-center">
          {round?.scheduledDate}{round?.roundNumber ? ` · Round #${round.roundNumber}` : ''}
        </p>
        {canResumeDirectly ? (
          <Link to="/score-entry-hole" className="mt-4 w-full max-w-xs">
            <Button className="min-h-12 w-full">Resume Round</Button>
          </Link>
        ) : (
          <Link to="/ball-draw" className="mt-4 w-full max-w-xs">
            <Button className="min-h-12 w-full">
              {hasGroup ? 'Continue Ball Draw' : 'Start Ball Draw'}
            </Button>
          </Link>
        )}
        <Button
          variant="ghost"
          className="text-xs text-muted-foreground"
          onClick={() => {
            setJoined(null);
            setSelectedRound(null);
            setEntryCode('');
            setCodeError(null);
          }}
        >
          Switch round
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Entry code form (after selecting an official round)
  // ---------------------------------------------------------------------------

  if (selectedRound?.type === 'official') {
    return (
      <div className="p-4 flex flex-col gap-4">
        <button
          className="text-sm text-muted-foreground text-left"
          onClick={() => {
            setSelectedRound(null);
            setEntryCode('');
            setCodeError(null);
          }}
        >
          ← Back to rounds
        </button>
        <h2 className="text-xl font-semibold">Enter Weekly Code</h2>
        <p className="text-muted-foreground text-sm">
          Official round · {selectedRound.scheduledDate}
        </p>

        <input
          type="text"
          value={entryCode}
          onChange={(e) => {
            setEntryCode(e.target.value.toUpperCase());
            setCodeError(null);
          }}
          placeholder="ENTRY CODE"
          className="text-2xl text-center tracking-widest uppercase border rounded-lg p-4 min-h-16 w-full bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />

        {codeError && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {codeError}
          </div>
        )}

        <Button
          className="min-h-12 w-full"
          disabled={!entryCode.trim() || startMutation.isPending}
          onClick={() =>
            startMutation.mutate({ id: selectedRound.id, code: entryCode.trim() })
          }
        >
          {startMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Joining…
            </>
          ) : (
            'Submit'
          )}
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Round list / loading / empty states
  // ---------------------------------------------------------------------------

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Score Entry</h2>

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="h-24 rounded-xl bg-muted animate-pulse"
            />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Could not load rounds. Check your connection and try again.
        </div>
      )}

      {!isLoading && !isError && data?.items.length === 0 && (
        <div className="text-center py-12">
          <p className="text-lg font-medium">No rounds available today</p>
          <p className="text-muted-foreground text-sm mt-1">
            Check back on a round day or ask your administrator.
          </p>
        </div>
      )}

      {!isLoading &&
        !isError &&
        data?.items.map((round) => (
          <RoundCard
            key={round.id}
            round={round}
            isPending={startMutation.isPending && selectedRound?.id === round.id}
            onJoin={() => {
              setCodeError(null);
              if (round.type === 'casual') {
                setSelectedRound(round);
                startMutation.mutate({ id: round.id });
              } else {
                setSelectedRound(round);
              }
            }}
          />
        ))}

      {!isLoading && !isError && (
        <Link to="/practice" className="w-full">
          <Button variant="outline" className="min-h-12 w-full mt-2">
            New Practice Round
          </Button>
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round card component
// ---------------------------------------------------------------------------

function RoundCard({
  round,
  isPending,
  onJoin,
}: {
  round: Round;
  isPending: boolean;
  onJoin: () => void;
}) {
  return (
    <div className="border rounded-xl p-4 flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <p className="font-medium">{formatDate(round.scheduledDate)}</p>
        <div className="flex gap-2">
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              round.type === 'official'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {round.type === 'official' ? 'Official' : 'Casual'}
          </span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              round.status === 'active'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
            }`}
          >
            {round.status === 'active' ? 'Active' : 'Scheduled'}
          </span>
        </div>
      </div>

      <Button
        className="min-h-12 min-w-20 shrink-0"
        disabled={isPending}
        onClick={onJoin}
      >
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Join'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year!, month! - 1, day!));
}
