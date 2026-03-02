import { createFileRoute, useRouter, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, AlertCircle, ChevronLeft, ChevronRight, WifiOff, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { getSession, clearSession } from '@/lib/session-store';
import { enqueueScore } from '@/lib/offline-queue';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';

// ---------------------------------------------------------------------------
// Constants (from packages/engine/src/course.ts)
// ---------------------------------------------------------------------------

const HOLE_PARS = [5, 4, 4, 4, 4, 3, 3, 5, 4, 4, 5, 3, 4, 4, 3, 4, 4, 4] as const;
const HOLE_STROKE_INDEXES = [3, 1, 13, 5, 9, 17, 15, 7, 11, 8, 2, 18, 6, 10, 16, 4, 14, 12] as const;
const PAR3_HOLES = new Set([6, 7, 12, 15]); // Guyan G&CC par-3 holes

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
  autoCalculateMoney: boolean;
  groups: Group[];
};

type WolfHole = {
  holeNumber: number;
  type: 'skins' | 'wolf';
  wolfPlayerId: number | null;
  wolfPlayerName: string | null;
};

type HoleScore = { holeNumber: number; playerId: number; grossScore: number };
type RoundTotal = { playerId: number; stablefordTotal: number; moneyTotal: number };

type ScoresResponse = {
  scores: HoleScore[];
  roundTotals: RoundTotal[];
};

type SubmitResponse = {
  holeScores: HoleScore[];
  roundTotals: Array<{ playerId: number; stablefordTotal: number }>;
};

type StoredWolfDecision = {
  holeNumber: number;
  decision: string | null;
  partnerPlayerId: number | null;
  greenies: number[];
  polies: number[];
};

type WolfDecisionsResponse = { wolfDecisions: StoredWolfDecision[] };

type WolfDecisionApiResponse = {
  wolfDecision: StoredWolfDecision;
  moneyTotals: Array<{ playerId: number; moneyTotal: number }>;
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/score-entry-hole')({
  component: ScoreEntryHolePage,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNetworkError(err: Error): boolean {
  return !navigator.onLine || err instanceof TypeError || err.message === 'Failed to fetch';
}

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

function formatMoney(amount: number): string {
  if (amount > 0) return `+$${amount}`;
  if (amount < 0) return `-$${Math.abs(amount)}`;
  return '$0';
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function ScoreEntryHolePage() {
  const router = useRouter();
  const session = getSession();

  // All hooks must come before any conditional return
  const [currentHole, setCurrentHole] = useState<number>(1);
  const [submittedScores, setSubmittedScores] = useState<Map<number, Map<number, number>>>(
    new Map(),
  );
  const [stablefordTotals, setStablefordTotals] = useState<Map<number, number>>(new Map());
  const [moneyTotals, setMoneyTotals] = useState<Map<number, number>>(new Map());
  const [holeDecisions, setHoleDecisions] = useState<Map<number, StoredWolfDecision>>(new Map());
  const [currentInputs, setCurrentInputs] = useState<Record<number, string>>({});
  const [currentDecision, setCurrentDecision] = useState<'alone' | 'partner' | 'blind_wolf' | null>(null);
  const [currentPartnerId, setCurrentPartnerId] = useState<number | null>(null);
  const [currentGreenies, setCurrentGreenies] = useState<Set<number>>(new Set());
  const [currentPolies, setCurrentPolies] = useState<Set<number>>(new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [wolfError, setWolfError] = useState<string | null>(null);
  const [showEndRoundConfirm, setShowEndRoundConfirm] = useState(false);

  const { pendingCount, isDraining, drainError, refreshCount } = useOfflineQueue(
    session?.roundId ?? 0,
    session?.groupId ?? 0,
  );

  // Session guard
  useEffect(() => {
    if (!session || session.groupId == null) {
      void router.navigate({ to: '/score-entry' });
    }
  }, []);

  const { data: roundData, isLoading: roundLoading, isError: roundError } = useQuery({
    queryKey: ['round', session?.roundId ?? 0],
    queryFn: () =>
      apiFetch<{ round: RoundDetail }>(`/rounds/${session!.roundId}`).then((d) => d.round),
    enabled: session !== null && session.groupId !== null,
    staleTime: 0,
    // Poll every 5s on the summary screen until the round is finalized
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'finalized') return false;
      return 5000;
    },
    refetchIntervalInBackground: false,
  });

  const { data: scoresData, isLoading: scoresLoading } = useQuery({
    queryKey: ['scores', session?.roundId ?? 0, session?.groupId ?? 0],
    queryFn: () =>
      apiFetch<ScoresResponse>(
        `/rounds/${session!.roundId}/groups/${session!.groupId}/scores`,
      ),
    enabled: session !== null && session.groupId !== null,
    staleTime: 0,
  });

  const { data: decisionsData, isLoading: decisionsLoading } = useQuery({
    queryKey: ['wolf-decisions', session?.roundId ?? 0, session?.groupId ?? 0],
    queryFn: () =>
      apiFetch<WolfDecisionsResponse>(
        `/rounds/${session!.roundId}/groups/${session!.groupId}/wolf-decisions`,
      ),
    enabled: session !== null && session.groupId !== null,
    staleTime: 0,
  });

  // Populate submitted scores, Stableford totals, money totals, and current hole from existing data
  useEffect(() => {
    if (!scoresData) return;
    const map = new Map<number, Map<number, number>>();
    for (const s of scoresData.scores) {
      if (!map.has(s.holeNumber)) map.set(s.holeNumber, new Map());
      map.get(s.holeNumber)!.set(s.playerId, s.grossScore);
    }
    setSubmittedScores(map);

    const totalsMap = new Map<number, number>();
    const moneyMap = new Map<number, number>();
    for (const t of scoresData.roundTotals) {
      totalsMap.set(t.playerId, t.stablefordTotal);
      moneyMap.set(t.playerId, t.moneyTotal);
    }
    setStablefordTotals(totalsMap);
    setMoneyTotals(moneyMap);

    // Advance to first unscored hole, or summary (19) if all done
    let first = 19;
    for (let h = 1; h <= 18; h++) {
      if (!map.has(h)) {
        first = h;
        break;
      }
    }
    setCurrentHole(first);
  }, [scoresData]);

  // Populate hole decisions from GET /wolf-decisions
  useEffect(() => {
    if (!decisionsData) return;
    const map = new Map<number, StoredWolfDecision>();
    for (const d of decisionsData.wolfDecisions) {
      map.set(d.holeNumber, d);
    }
    setHoleDecisions(map);
  }, [decisionsData]);

  // Pre-populate inputs when navigating to an already-scored hole
  useEffect(() => {
    const holeMap = submittedScores.get(currentHole);
    if (holeMap) {
      const inputs: Record<number, string> = {};
      for (const [pid, score] of holeMap) {
        inputs[pid] = String(score);
      }
      setCurrentInputs(inputs);
    } else {
      setCurrentInputs({});
    }

    // Pre-populate wolf decision
    const dec = holeDecisions.get(currentHole);
    if (dec) {
      setCurrentDecision((dec.decision as 'alone' | 'partner' | 'blind_wolf' | null) ?? null);
      setCurrentPartnerId(dec.partnerPlayerId);
      setCurrentGreenies(new Set(dec.greenies));
      setCurrentPolies(new Set(dec.polies));
    } else {
      setCurrentDecision(null);
      setCurrentPartnerId(null);
      setCurrentGreenies(new Set());
      setCurrentPolies(new Set());
    }
    setSubmitError(null);
    setWolfError(null);
  }, [currentHole, submittedScores, holeDecisions]);

  const wolfDecisionMutation = useMutation({
    mutationFn: ({ holeNum, decision, partnerId, greenies, polies }: {
      holeNum: number;
      decision: 'alone' | 'partner' | 'blind_wolf' | null;
      partnerId: number | null;
      greenies: number[];
      polies: number[];
    }) => {
      if (!session) throw new Error('No session');
      const body: Record<string, unknown> = { greenies, polies };
      if (decision !== null) {
        body['decision'] = decision;
        if (decision === 'partner' && partnerId !== null) {
          body['partnerPlayerId'] = partnerId;
        }
      }
      return apiFetch<WolfDecisionApiResponse>(
        `/rounds/${session.roundId}/groups/${session.groupId}/holes/${holeNum}/wolf-decision`,
        {
          method: 'POST',
          headers: session.entryCode ? { 'x-entry-code': session.entryCode } : {},
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: (data, { holeNum }) => {
      // Update money totals
      const newTotals = new Map<number, number>(moneyTotals);
      for (const t of data.moneyTotals) {
        newTotals.set(t.playerId, t.moneyTotal);
      }
      setMoneyTotals(newTotals);
      // Store decision in local state
      setHoleDecisions((prev) => new Map(prev).set(holeNum, data.wolfDecision));
      setWolfError(null);
      // Advance to next hole after both mutations succeed
      if (holeNum < 18) {
        setCurrentHole(holeNum + 1);
        setCurrentInputs({});
      } else {
        setCurrentHole(19);
      }
    },
    onError: (err: Error, { holeNum, decision, partnerId, greenies, polies }) => {
      if (isNetworkError(err)) {
        // Score was already persisted; re-queue score (idempotent) + wolf decision together
        const holeScoreMap = submittedScores.get(holeNum);
        if (holeScoreMap) {
          void enqueueScore({
            roundId: session!.roundId,
            groupId: session!.groupId!,
            holeNumber: holeNum,
            scores: [...holeScoreMap.entries()].map(([playerId, grossScore]) => ({
              playerId,
              grossScore,
            })),
            wolfDecision: {
              decision: holeNum >= 3 ? decision : null,
              partnerId,
              greenies,
              polies,
            },
            autoCalculateMoney: roundData?.autoCalculateMoney ?? false,
            entryCode: session!.entryCode ?? null,
            timestamp: Date.now(),
          })
            .then(() => void refreshCount())
            .catch(() => {
              /* score already on server; wolf decision is best-effort */
            });
        }
        // Advance hole — score was successfully saved
        if (holeNum < 18) {
          setCurrentHole(holeNum + 1);
          setCurrentInputs({});
        } else {
          setCurrentHole(19);
        }
      } else {
        if (err.message === 'INVALID_DECISION') {
          setWolfError('Invalid wolf decision — please check your inputs.');
        } else if (err.message === 'INVALID_ENTRY_CODE') {
          setWolfError('Entry code no longer valid — please re-join the round.');
        } else {
          setWolfError('Could not save wolf decision — please try again.');
        }
      }
    },
  });

  const quitMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean }>(
        `/rounds/${session!.roundId}/groups/${session!.groupId}/quit`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      clearSession();
      void router.navigate({ to: '/' });
    },
  });

  const submitMutation = useMutation({
    mutationFn: ({ holeNum, inputs }: { holeNum: number; inputs: Record<number, string> }) => {
      if (!session) throw new Error('No session');
      return apiFetch<SubmitResponse>(
        `/rounds/${session.roundId}/groups/${session.groupId}/holes/${holeNum}/scores`,
        {
          method: 'POST',
          headers: session.entryCode ? { 'x-entry-code': session.entryCode } : {},
          body: JSON.stringify({
            scores: orderedPlayers.map((p) => ({
              playerId: p.id,
              grossScore: Number(inputs[p.id]),
            })),
          }),
        },
      );
    },
    onSuccess: (data, { holeNum }) => {
      // Update submitted scores map
      const newMap = new Map(submittedScores);
      const holeMap = new Map<number, number>();
      for (const s of data.holeScores.filter((s) => s.holeNumber === holeNum)) {
        holeMap.set(s.playerId, s.grossScore);
      }
      newMap.set(holeNum, holeMap);
      setSubmittedScores(newMap);

      // Update Stableford totals from API response
      const newTotals = new Map<number, number>();
      for (const t of data.roundTotals) {
        newTotals.set(t.playerId, t.stablefordTotal);
      }
      setStablefordTotals(newTotals);
      setSubmitError(null);

      // Fire wolf decision POST if autoCalculateMoney and there's data to save
      const round = roundData;
      const hasWolfDecision = round?.autoCalculateMoney && holeNum >= 3 && currentDecision !== null;
      const hasGreeniesOrPolies = currentGreenies.size > 0 || currentPolies.size > 0;

      if (round?.autoCalculateMoney && (hasWolfDecision || hasGreeniesOrPolies)) {
        wolfDecisionMutation.mutate({
          holeNum,
          decision: holeNum >= 3 ? currentDecision : null,
          partnerId: currentPartnerId,
          greenies: [...currentGreenies],
          polies: [...currentPolies],
        });
      } else {
        // No wolf decision to save — advance hole directly
        if (holeNum < 18) {
          setCurrentHole(holeNum + 1);
          setCurrentInputs({});
        } else {
          setCurrentHole(19);
        }
      }
    },
    onError: (err: Error, { holeNum, inputs }) => {
      if (isNetworkError(err)) {
        // Network failure — queue locally and advance hole (data is safe in IndexedDB)
        const hasWolfData =
          roundData?.autoCalculateMoney &&
          (holeNum >= 3 ? currentDecision !== null : currentGreenies.size > 0 || currentPolies.size > 0);
        void enqueueScore({
          roundId: session!.roundId,
          groupId: session!.groupId!,
          holeNumber: holeNum,
          scores: orderedPlayers.map((p) => ({
            playerId: p.id,
            grossScore: Number(inputs[p.id]),
          })),
          wolfDecision: hasWolfData
            ? {
                decision: holeNum >= 3 ? currentDecision : null,
                partnerId: currentPartnerId,
                greenies: [...currentGreenies],
                polies: [...currentPolies],
              }
            : null,
          autoCalculateMoney: roundData?.autoCalculateMoney ?? false,
          entryCode: session!.entryCode ?? null,
          timestamp: Date.now(),
        })
          .then(() => {
            // Advance hole only after queue write succeeds
            void refreshCount();
            if (holeNum < 18) {
              setCurrentHole(holeNum + 1);
              setCurrentInputs({});
            } else {
              setCurrentHole(19);
            }
          })
          .catch(() => {
            setSubmitError('Could not save score offline — please retry when connected.');
          });
      } else {
        // Server error — surface to user, do not advance
        if (err.message === 'INVALID_SCORES') {
          setSubmitError('One or more player scores are invalid.');
        } else if (err.message === 'INVALID_ENTRY_CODE') {
          setSubmitError('Entry code no longer valid — please re-join the round.');
        } else {
          setSubmitError('Could not save scores — please try again.');
        }
      }
    },
  });

  // Redirect pending
  if (!session || session.groupId == null) return null;

  if (roundLoading || scoresLoading || decisionsLoading) {
    return (
      <div className="p-4 flex flex-col gap-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-16 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (roundError || !roundData) {
    return (
      <div className="p-4 flex items-center gap-2 text-destructive text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        Could not load round data. Check your connection and try again.
      </div>
    );
  }

  const group = roundData.groups.find((g) => g.id === session.groupId);

  // Redirect to ball-draw if no batting order set
  if (!group || group.battingOrder === null) {
    void router.navigate({ to: '/ball-draw' });
    return null;
  }

  const orderedPlayers = group.battingOrder.map((id) => group.players.find((p) => p.id === id)!);
  const wolfSchedule = buildWolfScheduleFromOrder(group.battingOrder, group.players);

  // First unscored hole (1–18), or 19 when all done — drives Next-button ceiling
  const firstUnscoredHole =
    Array.from({ length: 18 }, (_, i) => i + 1).find((h) => !submittedScores.has(h)) ?? 19;

  // ---------------------------------------------------------------------------
  // Summary view (currentHole 19 = all 18 holes submitted)
  // ---------------------------------------------------------------------------

  if (currentHole === 19) {
    const summaryRows = orderedPlayers.map((p) => {
      let grossTotal = 0;
      for (const holeMap of submittedScores.values()) {
        grossTotal += holeMap.get(p.id) ?? 0;
      }
      return {
        player: p,
        grossTotal,
        stablefordTotal: stablefordTotals.get(p.id),
        moneyTotal: moneyTotals.has(p.id) ? moneyTotals.get(p.id)! : undefined,
      };
    });

    return (
      <div className="p-4 flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Round Complete</h2>
        {roundData?.status === 'finalized' ? (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-300 text-green-800 text-sm px-3 py-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Round Finalized — scores are locked.
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            Awaiting finalization by admin.
          </div>
        )}
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-sm px-3 py-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            {pendingCount} score{pendingCount !== 1 ? 's' : ''} pending sync
            {isDraining && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
          </div>
        )}
        {drainError && (
          <div className="flex items-center gap-2 text-amber-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {drainError}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-3">Player</th>
                <th className="text-right py-2 pr-3">Gross</th>
                <th className="text-right py-2 pr-3">Stableford</th>
                <th className="text-right py-2">Money</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(({ player, grossTotal, stablefordTotal, moneyTotal }) => (
                <tr key={player.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{player.name}</td>
                  <td className="py-2 pr-3 text-right">{grossTotal}</td>
                  <td className="py-2 pr-3 text-right">
                    {stablefordTotal !== undefined ? stablefordTotal : '—'}
                  </td>
                  <td className="py-2 text-right">
                    {moneyTotal !== undefined ? formatMoney(moneyTotal) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link to="/ball-draw">
          <Button variant="outline" className="w-full min-h-12">
            Back to Wolf Schedule
          </Button>
        </Link>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Hole entry form
  // ---------------------------------------------------------------------------

  const wolfHole = wolfSchedule[currentHole - 1]!;
  const par = HOLE_PARS[currentHole - 1]!;
  const si = HOLE_STROKE_INDEXES[currentHole - 1]!;

  const allValid = orderedPlayers.every((p) => {
    const val = currentInputs[p.id];
    if (!val) return false;
    const n = Number(val);
    return Number.isInteger(n) && n >= 1 && n <= 20;
  });

  const isPending = submitMutation.isPending || wolfDecisionMutation.isPending;

  return (
    <div className="p-4 flex flex-col gap-4">
      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-sm px-3 py-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          {pendingCount} score{pendingCount !== 1 ? 's' : ''} pending sync
          {isDraining && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
        </div>
      )}
      {drainError && (
        <div className="flex items-center gap-2 text-amber-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {drainError}
        </div>
      )}

      {/* Hole header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Hole {currentHole}</h2>
        <span className="text-sm text-muted-foreground">
          {submittedScores.size} / 18 saved
        </span>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>Par {par}</span>
        <span>SI {si}</span>
        <span>
          {wolfHole.type === 'skins' ? 'Skins' : `Wolf: ${wolfHole.wolfPlayerName ?? '—'}`}
        </span>
      </div>

      {/* Score inputs */}
      <div className="flex flex-col gap-3">
        {orderedPlayers.map((player) => (
          <div key={player.id} className="flex items-center gap-3">
            <label className="flex-1 font-medium text-sm">{player.name}</label>
            <input
              type="number"
              min={1}
              max={20}
              className="w-20 border rounded-lg p-2 text-center text-base bg-background"
              value={currentInputs[player.id] ?? ''}
              onChange={(e) => {
                setCurrentInputs((prev) => ({ ...prev, [player.id]: e.target.value }));
              }}
            />
          </div>
        ))}
      </div>

      {/* Wolf decision (holes 3-18, autoCalculateMoney=true) */}
      {roundData.autoCalculateMoney && currentHole >= 3 && (
        <div className="flex flex-col gap-2 border rounded-lg p-3">
          <p className="text-sm font-medium">
            Wolf: {wolfHole.wolfPlayerName ?? '—'}
          </p>
          <div className="flex gap-2">
            {(['alone', 'partner', 'blind_wolf'] as const).map((d) => (
              <Button
                key={d}
                variant={currentDecision === d ? 'default' : 'outline'}
                className="flex-1 text-xs"
                onClick={() => setCurrentDecision(d)}
              >
                {d === 'alone' ? 'Wolf' : d === 'partner' ? 'Partner' : 'Blind Wolf'}
              </Button>
            ))}
          </div>
          {currentDecision === 'partner' && (
            <select
              className="border rounded-lg p-2 bg-background text-sm"
              value={currentPartnerId ?? ''}
              onChange={(e) =>
                setCurrentPartnerId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">— select partner —</option>
              {orderedPlayers
                .filter((p) => p.id !== wolfHole.wolfPlayerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          )}
        </div>
      )}

      {/* Greenie (par-3 holes only, autoCalculateMoney=true) */}
      {roundData.autoCalculateMoney && PAR3_HOLES.has(currentHole) && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Greenie</p>
          {orderedPlayers.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={currentGreenies.has(p.id)}
                onChange={(e) => {
                  const s = new Set(currentGreenies);
                  if (e.target.checked) s.add(p.id);
                  else s.delete(p.id);
                  setCurrentGreenies(s);
                }}
              />
              {p.name}
            </label>
          ))}
        </div>
      )}

      {/* Polie (any hole) */}
      {roundData.autoCalculateMoney && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Polie</p>
          {orderedPlayers.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={currentPolies.has(p.id)}
                onChange={(e) => {
                  const s = new Set(currentPolies);
                  if (e.target.checked) s.add(p.id);
                  else s.delete(p.id);
                  setCurrentPolies(s);
                }}
              />
              {p.name}
            </label>
          ))}
        </div>
      )}

      {/* Errors */}
      {submitError && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {submitError}
        </div>
      )}
      {wolfError && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {wolfError}
        </div>
      )}

      {/* Save button */}
      <Button
        className="min-h-12 w-full"
        disabled={!allValid || isPending}
        onClick={() => {
          setSubmitError(null);
          setWolfError(null);
          submitMutation.mutate({ holeNum: currentHole, inputs: currentInputs });
        }}
      >
        {isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Saving…
          </>
        ) : (
          `Save Hole ${currentHole}`
        )}
      </Button>

      {/* Navigation — Prev always enabled (unless hole 1); Next enabled up to firstUnscoredHole */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1 min-h-11"
          disabled={currentHole === 1}
          onClick={() => setCurrentHole((h) => h - 1)}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Prev
        </Button>
        <Button
          variant="outline"
          className="flex-1 min-h-11"
          disabled={currentHole + 1 > firstUnscoredHole}
          onClick={() => setCurrentHole((h) => h + 1)}
        >
          Next
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* End Round — casual rounds only */}
      {roundData.type === 'casual' && !showEndRoundConfirm && (
        <Button
          variant="ghost"
          className="text-xs text-muted-foreground mt-2"
          onClick={() => setShowEndRoundConfirm(true)}
        >
          End Round
        </Button>
      )}

      {roundData.type === 'casual' && showEndRoundConfirm && (
        <div className="flex flex-col gap-3 border border-destructive rounded-xl p-4 mt-2">
          <div className="flex items-start gap-2">
            <TriangleAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-destructive">End this round?</p>
              <p className="text-xs text-muted-foreground mt-1">
                All scores for your group will be permanently deleted. Other groups (if any) will not be affected.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 min-h-11"
              disabled={quitMutation.isPending}
              onClick={() => setShowEndRoundConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1 min-h-11"
              disabled={quitMutation.isPending}
              onClick={() => quitMutation.mutate()}
            >
              {quitMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Yes, End Round'
              )}
            </Button>
          </div>
          {quitMutation.isError && (
            <div className="flex items-center gap-2 text-destructive text-xs">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Could not end round — please try again.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
