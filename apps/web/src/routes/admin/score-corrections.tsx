import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

type Player = {
  id: number;
  name: string;
  ghinNumber: string | null;
  isActive: number;
  isGuest: number;
  createdAt: number;
};

type Group = {
  id: number;
  roundId: number;
  groupNumber: number;
};

type ScoreCorrection = {
  id: number;
  adminUserId: number;
  adminUsername: string | null;
  roundId: number;
  holeNumber: number;
  playerId: number | null;
  playerName: string | null;
  fieldName: string;
  oldValue: string;
  newValue: string;
  correctedAt: number;
};

type FieldName = 'grossScore' | 'wolfDecision' | 'wolfPartnerId' | 'greenie' | 'polie' | 'handicapIndex';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAR3_HOLES = [6, 7, 12, 15];

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/admin/score-corrections')({
  component: ScoreCorrectionsPage,
});

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

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const FIELD_LABELS: Record<string, string> = {
  grossScore: 'Gross Score',
  wolfDecision: 'Wolf Decision',
  wolfPartnerId: 'Wolf Partner',
  greenie: 'Greenie',
  polie: 'Polie',
  handicapIndex: 'Handicap Index',
};

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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ScoreCorrectionsPage() {
  const navigate = useNavigate();
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

  const roundsQuery = useQuery({
    queryKey: ['admin-rounds'],
    queryFn: () => apiFetch<{ items: Round[] }>('/admin/rounds'),
    retry: false,
  });
  const playersQuery = useQuery({
    queryKey: ['admin-players'],
    queryFn: () => apiFetch<{ items: Player[] }>('/admin/players'),
    retry: false,
  });

  const isLoading = roundsQuery.isLoading || playersQuery.isLoading;
  const isError = roundsQuery.isError || playersQuery.isError;
  const error = roundsQuery.error ?? playersQuery.error;

  if (isError) {
    if ((error as Error).message === 'UNAUTHORIZED') {
      void navigate({ to: '/admin/login' });
      return null;
    }
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4">Score Corrections</h2>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load data — tap to retry</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void roundsQuery.refetch();
              void playersQuery.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const finalizedRounds = (roundsQuery.data?.items ?? []).filter(
    (r) => r.status === 'finalized',
  );
  const activePlayers = (playersQuery.data?.items ?? []).filter(
    (p) => p.isActive === 1 && p.isGuest === 0,
  );

  function handleRoundChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = Number(e.target.value);
    setSelectedRoundId(val > 0 ? val : null);
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Score Corrections</h2>

      {/* Round selector */}
      <div className="rounded-md border p-4 bg-muted/20 mb-6">
        <label className="text-sm font-medium mb-1 block">Select Finalized Round</label>
        {isLoading ? (
          <div className="h-9 bg-muted rounded animate-pulse" />
        ) : (
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={selectedRoundId ?? ''}
            onChange={handleRoundChange}
          >
            <option value="">
              {finalizedRounds.length === 0 ? 'No finalized rounds' : '— select a round —'}
            </option>
            {finalizedRounds.map((r) => (
              <option key={r.id} value={r.id}>
                {formatDate(r.scheduledDate)} ({r.type})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Round-specific content */}
      {selectedRoundId !== null && (
        <RoundSection key={selectedRoundId} roundId={selectedRoundId} activePlayers={activePlayers} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round Section
// ---------------------------------------------------------------------------

function RoundSection({
  roundId,
  activePlayers,
}: {
  roundId: number;
  activePlayers: Player[];
}) {
  const navigate = useNavigate();

  const groupsQuery = useQuery({
    queryKey: ['admin-round-groups', roundId],
    queryFn: () => apiFetch<{ items: Group[] }>(`/admin/rounds/${roundId}/groups`),
    retry: false,
  });
  const correctionsQuery = useQuery({
    queryKey: ['admin-round-corrections', roundId],
    queryFn: () =>
      apiFetch<{ items: ScoreCorrection[] }>(`/admin/rounds/${roundId}/corrections`),
    retry: false,
  });

  const groupsUnauthorized = groupsQuery.isError && (groupsQuery.error as Error).message === 'UNAUTHORIZED';
  const correctionsUnauthorized = correctionsQuery.isError && (correctionsQuery.error as Error).message === 'UNAUTHORIZED';

  if (groupsUnauthorized || correctionsUnauthorized) {
    void navigate({ to: '/admin/login' });
    return null;
  }

  const isRoundLoading = groupsQuery.isLoading || correctionsQuery.isLoading;

  if (isRoundLoading) {
    return <LoadingSkeleton />;
  }

  const groupsError = groupsQuery.isError && !groupsUnauthorized;
  const correctionsError = correctionsQuery.isError && !correctionsUnauthorized;

  return (
    <div className="flex flex-col gap-6">
      {groupsError ? (
        <div className="rounded-md border p-4 bg-muted/20">
          <p className="text-sm text-destructive">Could not load groups for this round. Wolf decision and partner corrections are unavailable.</p>
        </div>
      ) : (
        <CorrectionForm
          roundId={roundId}
          activePlayers={activePlayers}
          groups={groupsQuery.data?.items ?? []}
        />
      )}
      {correctionsError ? (
        <p className="text-sm text-destructive">Could not load audit log — try refreshing the page.</p>
      ) : (
        <AuditLog corrections={correctionsQuery.data?.items ?? []} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Correction Form
// ---------------------------------------------------------------------------

function CorrectionForm({
  roundId,
  activePlayers,
  groups,
}: {
  roundId: number;
  activePlayers: Player[];
  groups: Group[];
}) {
  const navigate = useNavigate();
  const [holeNumber, setHoleNumber] = useState<number>(1);
  const [fieldName, setFieldName] = useState<FieldName>('grossScore');
  const [playerId, setPlayerId] = useState<string>('');
  const [grossScore, setGrossScore] = useState<string>('');
  const [groupId, setGroupId] = useState<string>('');
  const [wolfDecision, setWolfDecision] = useState<string>('alone');
  const [wolfPartnerId, setWolfPartnerId] = useState<string>('null');
  const [bonusAction, setBonusAction] = useState<'add' | 'remove'>('add');
  const [handicapIndex, setHandicapIndex] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitError, setSubmitError] = useState('');

  const addMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ correction: ScoreCorrection }>(
        `/admin/rounds/${roundId}/corrections`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin-round-corrections', roundId],
      });
      setPlayerId('');
      setGrossScore('');
      setGroupId('');
      setWolfDecision('alone');
      setWolfPartnerId('null');
      setBonusAction('add');
      setHandicapIndex('');
      setSubmitError('');
      setSuccessMsg('Correction recorded.');
    },
    onError: (err: Error) => {
      if (err.message === 'UNAUTHORIZED') {
        void navigate({ to: '/admin/login' });
        return;
      }
      const msg =
        err.message === 'NOT_FOUND'
          ? 'No score/decision found for that player/group/hole combination.'
          : err.message === 'VALIDATION_ERROR'
            ? 'Invalid value — check the score or decision entered.'
            : 'Failed to save correction — try again.';
      setSubmitError(msg);
      setSuccessMsg('');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    setSuccessMsg('');
    const body: Record<string, unknown> = { holeNumber, fieldName };

    if (fieldName === 'grossScore') {
      if (!playerId) { setSubmitError('Player is required.'); return; }
      if (!grossScore) { setSubmitError('Gross score is required.'); return; }
      const scoreNum = Number(grossScore);
      if (!Number.isInteger(scoreNum) || scoreNum < 1 || scoreNum > 9) {
        setSubmitError('Gross score must be a whole number between 1 and 9.');
        return;
      }
      body['playerId'] = Number(playerId);
      body['newValue'] = grossScore;

    } else if (fieldName === 'wolfDecision') {
      if (!groupId) { setSubmitError('Group is required.'); return; }
      body['groupId'] = Number(groupId);
      body['newValue'] = wolfDecision;

    } else if (fieldName === 'wolfPartnerId') {
      if (!groupId) { setSubmitError('Group is required.'); return; }
      body['groupId'] = Number(groupId);
      body['newValue'] = wolfPartnerId;

    } else if (fieldName === 'greenie') {
      if (!playerId) { setSubmitError('Player is required.'); return; }
      if (!groupId) { setSubmitError('Group is required.'); return; }
      body['playerId'] = Number(playerId);
      body['groupId'] = Number(groupId);
      body['newValue'] = bonusAction;

    } else if (fieldName === 'polie') {
      if (!playerId) { setSubmitError('Player is required.'); return; }
      if (!groupId) { setSubmitError('Group is required.'); return; }
      body['playerId'] = Number(playerId);
      body['groupId'] = Number(groupId);
      body['newValue'] = bonusAction;

    } else {
      // handicapIndex — holeNumber must be 0 (round-wide sentinel)
      if (!playerId) { setSubmitError('Player is required.'); return; }
      if (!handicapIndex) { setSubmitError('Handicap index is required.'); return; }
      const hiNum = Number(handicapIndex);
      if (isNaN(hiNum) || hiNum < 0 || hiNum > 54) {
        setSubmitError('Handicap index must be between 0 and 54.');
        return;
      }
      body['holeNumber'] = 0;
      body['playerId'] = Number(playerId);
      body['newValue'] = handicapIndex;
    }

    addMutation.mutate(body);
  }

  function handleFieldChange(f: FieldName) {
    setFieldName(f);
    setSubmitError('');
    setSuccessMsg('');
    // Reset greenie hole to a par-3 when switching to greenie
    if (f === 'greenie') setHoleNumber(6);
    else if (f !== 'handicapIndex') setHoleNumber(1);
  }

  const isPending = addMutation.isPending;

  // Par-3-only holes for greenie
  const holeOptions = fieldName === 'greenie'
    ? PAR3_HOLES
    : Array.from({ length: 18 }, (_, i) => i + 1);

  return (
    <form onSubmit={handleSubmit} className="rounded-md border p-4 bg-muted/20">
      <h3 className="text-sm font-semibold mb-4">Submit Correction</h3>

      {/* Field type selector */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Field to Correct
        </label>
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={fieldName}
          onChange={(e) => handleFieldChange(e.target.value as FieldName)}
          disabled={isPending}
        >
          {(Object.keys(FIELD_LABELS) as FieldName[]).map((f) => (
            <option key={f} value={f}>{FIELD_LABELS[f]}</option>
          ))}
        </select>
      </div>

      {/* Hole selector — hidden for handicapIndex (round-wide) */}
      {fieldName !== 'handicapIndex' && (
        <div className="mb-3">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Hole Number{fieldName === 'greenie' ? ' (par-3 only)' : ''}
          </label>
          <select
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={holeNumber}
            onChange={(e) => setHoleNumber(Number(e.target.value))}
            disabled={isPending}
          >
            {holeOptions.map((n) => (
              <option key={n} value={n}>Hole {n}</option>
            ))}
          </select>
        </div>
      )}

      {/* Conditional fields */}

      {/* grossScore */}
      {fieldName === 'grossScore' && (
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Player</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              disabled={isPending}
            >
              <option value="">— select player —</option>
              {activePlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              New Gross Score (1–9)
            </label>
            <input
              type="number"
              min={1}
              max={9}
              className="w-24 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={grossScore}
              onChange={(e) => setGrossScore(e.target.value)}
              disabled={isPending}
            />
          </div>
        </div>
      )}

      {/* wolfDecision */}
      {fieldName === 'wolfDecision' && (
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Group</label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={isPending}
            >
              <option value="">— select group —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>Group {g.groupNumber}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">New Decision</label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={wolfDecision}
              onChange={(e) => setWolfDecision(e.target.value)}
              disabled={isPending}
            >
              <option value="alone">Alone</option>
              <option value="partner">Partner</option>
              <option value="blind_wolf">Blind Wolf</option>
            </select>
          </div>
        </div>
      )}

      {/* wolfPartnerId */}
      {fieldName === 'wolfPartnerId' && (
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Group</label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={isPending}
            >
              <option value="">— select group —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>Group {g.groupNumber}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">New Partner</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={wolfPartnerId}
              onChange={(e) => setWolfPartnerId(e.target.value)}
              disabled={isPending}
            >
              <option value="null">None (clear partner)</option>
              {activePlayers.map((p) => (
                <option key={p.id} value={String(p.id)}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* greenie / polie */}
      {(fieldName === 'greenie' || fieldName === 'polie') && (
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Player</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              disabled={isPending}
            >
              <option value="">— select player —</option>
              {activePlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Group</label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={isPending}
            >
              <option value="">— select group —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>Group {g.groupNumber}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Action</label>
            <div className="flex rounded-md border overflow-hidden">
              {(['add', 'remove'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`px-3 py-2 text-xs font-medium transition-colors border-r last:border-r-0 ${
                    bonusAction === a
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background hover:bg-muted'
                  }`}
                  onClick={() => setBonusAction(a)}
                  disabled={isPending}
                >
                  {a === 'add' ? 'Add' : 'Remove'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* handicapIndex */}
      {fieldName === 'handicapIndex' && (
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Player</label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              disabled={isPending}
            >
              <option value="">— select player —</option>
              {activePlayers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              New Handicap Index (0–54)
            </label>
            <input
              type="number"
              min={0}
              max={54}
              step={0.1}
              className="w-28 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={handicapIndex}
              onChange={(e) => setHandicapIndex(e.target.value)}
              disabled={isPending}
            />
          </div>
        </div>
      )}

      {/* Submit row */}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
          Submit Correction
        </Button>
        {successMsg && (
          <span className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            {successMsg}
          </span>
        )}
      </div>
      {submitError && <p className="mt-2 text-sm text-destructive">{submitError}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

function AuditLog({ corrections }: { corrections: ScoreCorrection[] }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
        <ClipboardList className="h-4 w-4" />
        Audit Log
      </h3>
      {corrections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No corrections recorded for this round.
        </p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">When</th>
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">Admin</th>
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">Hole</th>
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">Field</th>
                <th className="py-2 px-3 text-left font-medium text-muted-foreground">Change</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2 px-3 text-muted-foreground whitespace-nowrap text-xs">
                    {formatTimestamp(c.correctedAt)}
                  </td>
                  <td className="py-2 px-3 text-xs">
                    {c.adminUsername ?? `#${c.adminUserId}`}
                  </td>
                  <td className="py-2 px-3 text-xs">
                    {c.holeNumber === 0 ? 'Round' : `#${c.holeNumber}`}
                  </td>
                  <td className="py-2 px-3 text-xs">
                    {c.playerName ? (
                      <span>
                        <span className="text-muted-foreground">{c.playerName} — </span>
                        {FIELD_LABELS[c.fieldName] ?? c.fieldName}
                      </span>
                    ) : (
                      FIELD_LABELS[c.fieldName] ?? c.fieldName
                    )}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs">
                    {c.oldValue} → {c.newValue}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
