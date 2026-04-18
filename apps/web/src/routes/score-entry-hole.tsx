import { createFileRoute, useRouter, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Loader2, AlertCircle, ChevronLeft, ChevronRight, WifiOff, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { getSession, clearSession } from '@/lib/session-store';
import { enqueueScore } from '@/lib/offline-queue';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { cn } from '@/lib/utils';
import { shortName } from '@/lib/names';
import { getWolfAssignment } from '@wolf-cup/engine';
import type { HoleNumber } from '@wolf-cup/engine';

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
  allHole18Scored: boolean;
  sideGame: { name: string; format: string; calculationType: string | null } | null;
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
  sandies: number[];
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
    const holeNumber = (i + 1) as HoleNumber;
    const assignment = getWolfAssignment([0, 1, 2, 3], holeNumber);
    if (assignment.type === 'skins') {
      return { holeNumber, type: 'skins' as const, wolfPlayerId: null, wolfPlayerName: null };
    }
    const wolfPlayerId = battingOrder[assignment.wolfBatterIndex]!;
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
  const [currentPutts, setCurrentPutts] = useState<Record<number, string>>({});
  const scoreInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [currentDecision, setCurrentDecision] = useState<'alone' | 'partner' | 'blind_wolf' | null>(null);
  const [currentPartnerId, setCurrentPartnerId] = useState<number | null>(null);
  const [currentGreenies, setCurrentGreenies] = useState<Set<number>>(new Set());
  const [currentPolies, setCurrentPolies] = useState<Set<number>>(new Set());
  const [currentSandies, setCurrentSandies] = useState<Set<number>>(new Set());
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

  // Auto-focus first score input when hole changes
  useEffect(() => {
    // Small delay to let inputs render after hole transition
    const t = setTimeout(() => scoreInputRefs.current[0]?.focus(), 50);
    return () => clearTimeout(t);
  }, [currentHole]);

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
      setCurrentPutts({});
    }

    // Pre-populate wolf decision
    const dec = holeDecisions.get(currentHole);
    if (dec) {
      setCurrentDecision((dec.decision as 'alone' | 'partner' | 'blind_wolf' | null) ?? null);
      setCurrentPartnerId(dec.partnerPlayerId);
      setCurrentGreenies(new Set(dec.greenies));
      setCurrentPolies(new Set(dec.polies));
      setCurrentSandies(new Set(dec.sandies ?? []));
    } else {
      setCurrentDecision(null);
      setCurrentPartnerId(null);
      setCurrentGreenies(new Set());
      setCurrentPolies(new Set());
      setCurrentSandies(new Set());
    }
    setSubmitError(null);
    setWolfError(null);
  }, [currentHole, submittedScores, holeDecisions]);

  const wolfDecisionMutation = useMutation({
    mutationFn: ({ holeNum, decision, partnerId, greenies, polies, sandies }: {
      holeNum: number;
      decision: 'alone' | 'partner' | 'blind_wolf' | null;
      partnerId: number | null;
      greenies: number[];
      polies: number[];
      sandies: number[];
    }) => {
      if (!session) throw new Error('No session');
      const body: Record<string, unknown> = { greenies, polies, sandies };
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
      setCurrentPutts({});
      } else {
        setCurrentHole(19);
      }
    },
    onError: (err: Error, { holeNum, decision, partnerId, greenies, polies, sandies }) => {
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
              decision: wolfSchedule[holeNum - 1]?.type === 'wolf' ? decision : null,
              partnerId,
              greenies,
              polies,
              sandies,
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
      setCurrentPutts({});
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

  const completeMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean }>(
        `/rounds/${session!.roundId}/complete`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      clearSession();
      void router.navigate({ to: '/' });
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

  const isPuttsWeek = roundData?.sideGame?.calculationType === 'auto_putts';

  const submitMutation = useMutation({
    mutationFn: ({ holeNum, inputs, puttsInputs }: { holeNum: number; inputs: Record<number, string>; puttsInputs: Record<number, string> }) => {
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
              ...(isPuttsWeek && puttsInputs[p.id] !== undefined && puttsInputs[p.id] !== ''
                ? { putts: Number(puttsInputs[p.id]) }
                : {}),
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
      const isWolf = wolfSchedule[holeNum - 1]?.type === 'wolf';
      const hasWolfDecision = round?.autoCalculateMoney && isWolf && currentDecision !== null;
      const hasBonusEvents = currentGreenies.size > 0 || currentPolies.size > 0 || currentSandies.size > 0;

      if (round?.autoCalculateMoney && (hasWolfDecision || hasBonusEvents)) {
        wolfDecisionMutation.mutate({
          holeNum,
          decision: wolfSchedule[holeNum - 1]?.type === 'wolf' ? currentDecision : null,
          partnerId: currentPartnerId,
          greenies: [...currentGreenies],
          polies: [...currentPolies],
          sandies: [...currentSandies],
        });
      } else {
        // No wolf decision to save — advance hole directly
        if (holeNum < 18) {
          setCurrentHole(holeNum + 1);
          setCurrentInputs({});
      setCurrentPutts({});
        } else {
          setCurrentHole(19);
        }
      }
    },
    onError: (err: Error, { holeNum, inputs, puttsInputs }) => {
      if (isNetworkError(err)) {
        // Network failure — queue locally and advance hole (data is safe in IndexedDB)
        const hasWolfData =
          roundData?.autoCalculateMoney &&
          (wolfSchedule[holeNum - 1]?.type === 'wolf' ? currentDecision !== null : currentGreenies.size > 0 || currentPolies.size > 0 || currentSandies.size > 0);
        void enqueueScore({
          roundId: session!.roundId,
          groupId: session!.groupId!,
          holeNumber: holeNum,
          scores: orderedPlayers.map((p) => ({
            playerId: p.id,
            grossScore: Number(inputs[p.id]),
            ...(isPuttsWeek && puttsInputs[p.id] !== undefined && puttsInputs[p.id] !== ''
              ? { putts: Number(puttsInputs[p.id]) }
              : {}),
          })),
          wolfDecision: hasWolfData
            ? {
                decision: wolfSchedule[holeNum - 1]?.type === 'wolf' ? currentDecision : null,
                partnerId: currentPartnerId,
                greenies: [...currentGreenies],
                polies: [...currentPolies],
                sandies: [...currentSandies],
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
      setCurrentPutts({});
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
  const groupNames = orderedPlayers.map((p) => p.name);
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
        ) : roundData?.type === 'casual' ? (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-300 text-green-800 text-sm px-3 py-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Practice round complete.
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
                <th className="text-right py-2 pr-3">Pts</th>
                <th className="text-right py-2 pr-3">$</th>
                <th className="text-right py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(({ player, grossTotal, stablefordTotal, moneyTotal }) => {
                const total = (stablefordTotal ?? 0) + (moneyTotal ?? 0);
                return (
                  <tr key={player.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{shortName(player.name, groupNames)}</td>
                    <td className="py-2 pr-3 text-right">{grossTotal}</td>
                    <td className="py-2 pr-3 text-right">
                      {stablefordTotal !== undefined ? stablefordTotal : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {moneyTotal !== undefined ? formatMoney(moneyTotal) : '—'}
                    </td>
                    <td className="py-2 text-right font-semibold">
                      {stablefordTotal !== undefined ? total : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2">
          {roundData?.status !== 'finalized' && roundData?.status !== 'completed' && (
            <Button variant="outline" className="w-full min-h-11" onClick={() => setCurrentHole(18)}>
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back to Hole 18
            </Button>
          )}
          <Link to="/">
            <Button variant="outline" className="w-full min-h-12">
              View Full Leaderboard
            </Button>
          </Link>
          {roundData?.type === 'casual' && roundData?.status === 'active' && roundData?.allHole18Scored && (
            <Button
              className="w-full min-h-12"
              disabled={completeMutation.isPending}
              onClick={() => completeMutation.mutate()}
            >
              {completeMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Ending Round…</>
              ) : (
                'End Round'
              )}
            </Button>
          )}
          {roundData?.type === 'casual' && roundData?.status === 'active' && !roundData?.allHole18Scored && (
            <p className="text-xs text-muted-foreground text-center">
              End Round available once all players finish hole 18.
            </p>
          )}
          {completeMutation.isError && (
            <div className="flex items-center gap-2 text-destructive text-xs">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Could not end round — please try again.
            </div>
          )}
          {roundData?.type !== 'casual' && (
            <Link to="/">
              <Button variant="outline" className="w-full min-h-12">
                View Leaderboard
              </Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Hole entry form
  // ---------------------------------------------------------------------------

  const wolfHole = wolfSchedule[currentHole - 1]!;
  const par = HOLE_PARS[currentHole - 1]!;
  const si = HOLE_STROKE_INDEXES[currentHole - 1]!;

  // Determine if wolf decision is required and if this is a forced-wolf hole
  const isWolfHole = wolfHole.type === 'wolf' && roundData.autoCalculateMoney;
  const currentWolfPlayerId = wolfHole.wolfPlayerId;

  // Find all wolf holes for the current wolf player
  const wolfPlayerHoles = isWolfHole && currentWolfPlayerId != null
    ? wolfSchedule.filter((w) => w.wolfPlayerId === currentWolfPlayerId && w.type === 'wolf').map((w) => w.holeNumber)
    : [];
  const isLastWolfHole = wolfPlayerHoles.length > 0 && wolfPlayerHoles[wolfPlayerHoles.length - 1] === currentHole;

  // Check if the wolf player has already gone alone/blind on a previous hole
  const hasGoneWolfBefore = wolfPlayerHoles.some((h) => {
    if (h >= currentHole) return false;
    const dec = holeDecisions.get(h);
    return dec?.decision === 'alone' || dec?.decision === 'blind_wolf';
  });

  // On last wolf hole, if they haven't gone wolf before, force wolf (no partner allowed)
  // Blind wolf on last hole requires pre-declaring it (handled by scorer manually calling it before last hole)
  const forceWolf = isLastWolfHole && !hasGoneWolfBefore;

  // Wolf decision is required on wolf holes
  const wolfDecisionValid = !isWolfHole || currentDecision !== null;

  const allValid = orderedPlayers.every((p) => {
    const val = currentInputs[p.id];
    if (!val) return false;
    const n = Number(val);
    if (!Number.isInteger(n) || n < 1 || n > 20) return false;
    if (isPuttsWeek) {
      const pv = currentPutts[p.id];
      if (!pv && pv !== '0') return false;
      const pn = Number(pv);
      if (!Number.isInteger(pn) || pn < 0 || pn > 9) return false;
    }
    return true;
  });

  const isPending = submitMutation.isPending || wolfDecisionMutation.isPending;

  // "Wrong group?" escape hatch — enabled only before any score has been saved
  // for this group on this device. Once hole_scores rows exist, group change
  // requires admin intervention.
  const noScoresSaved = (scoresData?.scores.length ?? 0) === 0;
  const handleChangeGroup = () => {
    if (!window.confirm('Change group? This clears your current group selection. Only allowed because no scores have been saved yet.')) return;
    if (session) {
      clearSession();
      // Keep the roundId so the round list auto-selects; just drop the groupId
      const next = { roundId: session.roundId, entryCode: session.entryCode, groupId: null };
      // setSession isn't available here — clearSession + navigate is cleaner
      // (score-entry will re-establish session if needed via session-restore effect).
      void next; // referenced to avoid unused-var lint
    }
    void router.navigate({ to: '/score-entry' });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content area — padded bottom so sticky footer doesn't cover */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-36">

        {/* Wrong-group escape hatch — only visible when no scores are saved */}
        {noScoresSaved && roundData?.status !== 'finalized' && roundData?.status !== 'completed' && (
          <div className="text-right mb-2">
            <button
              type="button"
              onClick={handleChangeGroup}
              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Wrong group?
            </button>
          </div>
        )}

        {/* Offline/sync banner */}
        {pendingCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-sm px-3 py-2 mb-3">
            <WifiOff className="w-4 h-4 shrink-0" />
            {pendingCount} score{pendingCount !== 1 ? 's' : ''} pending sync
            {isDraining && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
          </div>
        )}
        {drainError && (
          <div className="flex items-center gap-2 text-amber-700 text-sm mb-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {drainError}
          </div>
        )}

        {/* Hole header bar */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-baseline gap-3">
            <h2 className="text-2xl font-black">Hole {currentHole}</h2>
            <span className="text-sm text-muted-foreground">Par {par} · SI {si}</span>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">{submittedScores.size} / 18</div>
            <div className="text-xs font-medium text-muted-foreground">
              {wolfHole.type === 'skins' ? '⛳ Skins' : `🐺 ${wolfHole.wolfPlayerName ?? '—'}`}
            </div>
          </div>
        </div>

        {/* Side game banner */}
        {roundData.sideGame && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-xs px-3 py-2 mb-2">
            This week's side game: <span className="font-semibold">{roundData.sideGame.name}</span>
            {isPuttsWeek && ' — enter putts for each hole.'}
          </div>
        )}

        {/* Score inputs — compact card per player, auto-advance on digit entry */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {orderedPlayers.map((player, idx) => (
            <div key={player.id} className="border rounded-xl p-3 bg-card">
              <div className="text-xs font-semibold text-muted-foreground mb-2 truncate"><span className="text-[10px] text-muted-foreground/60 mr-1">{idx + 1}.</span>{shortName(player.name, groupNames)}</div>
              <input
                ref={(el) => { scoreInputRefs.current[idx] = el; }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                className="w-full border rounded-lg p-2 text-center text-xl font-bold bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                value={currentInputs[player.id] ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Only accept single digits 1-9
                  if (raw !== '' && !/^[1-9]$/.test(raw)) return;
                  setCurrentInputs((prev) => ({ ...prev, [player.id]: raw }));
                  // Auto-advance to next player, blur on last to dismiss keyboard
                  if (raw) {
                    if (idx < orderedPlayers.length - 1) {
                      scoreInputRefs.current[idx + 1]?.focus();
                    } else {
                      scoreInputRefs.current[idx]?.blur();
                    }
                  }
                }}
              />
              {isPuttsWeek && (
                <div className="mt-1.5">
                  <label className="text-[10px] text-muted-foreground">Putts</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    className="w-full border rounded-lg p-1.5 text-center text-sm font-semibold bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    value={currentPutts[player.id] ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw !== '' && !/^[0-9]$/.test(raw)) return;
                      setCurrentPutts((prev) => ({ ...prev, [player.id]: raw }));
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Bonuses — Greenie on par-3s only, Polie on any hole */}
        {roundData.autoCalculateMoney && (
          <div className="border rounded-xl p-3 mb-3">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
              Bonuses
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {orderedPlayers.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="flex-1 text-sm font-medium truncate min-w-0">
                    {shortName(p.name, groupNames)}
                  </span>
                  {PAR3_HOLES.has(currentHole) && (
                    <button
                      type="button"
                      onClick={() => {
                        const s = new Set(currentGreenies);
                        if (s.has(p.id)) s.delete(p.id);
                        else s.add(p.id);
                        setCurrentGreenies(s);
                      }}
                      className={cn(
                        'w-8 h-8 rounded-lg text-xs font-bold border transition-colors',
                        currentGreenies.has(p.id)
                          ? 'bg-green-600 text-white border-green-600'
                          : 'border-border text-muted-foreground hover:border-green-400',
                      )}
                      title={`Greenie — ${p.name}`}
                    >
                      G
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const s = new Set(currentPolies);
                      if (s.has(p.id)) s.delete(p.id);
                      else s.add(p.id);
                      setCurrentPolies(s);
                    }}
                    className={cn(
                      'w-8 h-8 rounded-lg text-xs font-bold border transition-colors',
                      currentPolies.has(p.id)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-border text-muted-foreground hover:border-blue-400',
                    )}
                    title={`Polie — ${p.name}`}
                  >
                    P
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const s = new Set(currentSandies);
                      if (s.has(p.id)) s.delete(p.id);
                      else s.add(p.id);
                      setCurrentSandies(s);
                    }}
                    className={cn(
                      'w-8 h-8 rounded-lg text-xs font-bold border transition-colors',
                      currentSandies.has(p.id)
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'border-border text-muted-foreground hover:border-amber-400',
                    )}
                    title={`Sandie — ${p.name}`}
                  >
                    S
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-2">
              {PAR3_HOLES.has(currentHole) ? 'G = Greenie · ' : ''}P = Polie · S = Sandie
            </p>
          </div>
        )}

        {/* Wolf decision (holes 3-18, autoCalculateMoney=true) */}
        {isWolfHole && (
          <div className={cn('border rounded-xl p-3 mb-3', !wolfDecisionValid && 'border-amber-400')}>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">
              🐺 Wolf: {wolfHole.wolfPlayerName ? shortName(wolfHole.wolfPlayerName, groupNames) : ''}
              {forceWolf && <span className="ml-2 text-amber-600 normal-case">(must go wolf)</span>}
            </p>
            {!wolfDecisionValid && (
              <p className="text-xs text-amber-600 mb-2">Pick partner, wolf, or blind wolf to save</p>
            )}
            {/* Player list — tap a non-wolf player to pick as partner */}
            <div className="flex flex-col gap-1.5 mb-2">
              {orderedPlayers.map((p) => {
                const isWolf = p.id === wolfHole.wolfPlayerId;
                const isPartner = currentDecision === 'partner' && currentPartnerId === p.id;
                const isAlone = isWolf && currentDecision === 'alone';
                const partnerDisabled = forceWolf && !isWolf;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={partnerDisabled}
                    onClick={() => {
                      if (isWolf) {
                        // Tapping yourself as wolf = go alone (toggle)
                        if (currentDecision === 'alone') {
                          setCurrentDecision(null);
                          setCurrentPartnerId(null);
                        } else {
                          setCurrentDecision('alone');
                          setCurrentPartnerId(null);
                        }
                      } else if (isPartner) {
                        // Deselect partner
                        setCurrentDecision(null);
                        setCurrentPartnerId(null);
                      } else {
                        setCurrentDecision('partner');
                        setCurrentPartnerId(p.id);
                      }
                    }}
                    className={cn(
                      'flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                      isWolf
                        ? isAlone
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:border-amber-500'
                        : partnerDisabled
                          ? 'border-border text-muted-foreground/40 cursor-not-allowed'
                          : isPartner
                            ? 'bg-green-600 text-white border-green-600'
                            : 'border-border text-foreground hover:border-foreground/40',
                    )}
                  >
                    <span>{shortName(p.name, groupNames)}</span>
                    {isWolf && (
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        {isAlone ? 'Wolf ✓' : 'Wolf — tap to go alone'}
                      </span>
                    )}
                    {isPartner && (
                      <span className="text-xs font-bold">Partner ✓</span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Alone / Blind Wolf buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (currentDecision === 'alone') {
                    setCurrentDecision(null);
                  } else {
                    setCurrentDecision('alone');
                    setCurrentPartnerId(null);
                  }
                }}
                className={cn(
                  'flex-1 py-2.5 text-xs font-bold rounded-lg border transition-colors',
                  currentDecision === 'alone'
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground/40',
                )}
              >
                Wolf
              </button>
              <button
                type="button"
                onClick={() => {
                  if (currentDecision === 'blind_wolf') {
                    setCurrentDecision(null);
                  } else {
                    setCurrentDecision('blind_wolf');
                    setCurrentPartnerId(null);
                  }
                }}
                className={cn(
                  'flex-1 py-2.5 text-xs font-bold rounded-lg border transition-colors',
                  currentDecision === 'blind_wolf'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'border-border text-muted-foreground hover:border-foreground/40',
                )}
              >
                Blind Wolf
              </button>
            </div>
          </div>
        )}

        {/* Errors */}
        {(submitError || wolfError) && (
          <div className="flex items-center gap-2 text-destructive text-sm mb-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {submitError ?? wolfError}
          </div>
        )}

        {/* End Round — casual rounds only */}
        {roundData.type === 'casual' && !showEndRoundConfirm && (
          <button
            type="button"
            className="text-xs text-muted-foreground/50 hover:text-muted-foreground mt-2 w-full text-center py-2"
            onClick={() => setShowEndRoundConfirm(true)}
          >
            End Round
          </button>
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

      {/* Sticky footer — Save + Prev/Next always visible */}
      <div className="shrink-0 border-t bg-background/95 backdrop-blur-sm px-4 pt-3 pb-4 flex flex-col gap-2">
        <Button
          className="min-h-12 w-full text-base font-semibold"
          disabled={!allValid || !wolfDecisionValid || isPending}
          onClick={() => {
            setSubmitError(null);
            setWolfError(null);
            // iOS Safari only opens the on-screen keyboard when focus() is called
            // inside a user-gesture handler. Focus the first score input here so
            // that when the mutation resolves and the hole advances, the same
            // DOM input (reused by React via stable key) keeps the keyboard open.
            scoreInputRefs.current[0]?.focus();
            submitMutation.mutate({ holeNum: currentHole, inputs: currentInputs, puttsInputs: currentPutts });
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 min-h-10"
            disabled={currentHole === 1}
            onClick={() => {
              const prevHole = currentHole - 1;
              const holeMap = submittedScores.get(prevHole);
              if (holeMap) {
                const inputs: Record<number, string> = {};
                for (const [pid, gs] of holeMap) inputs[pid] = String(gs);
                setCurrentInputs(inputs);
              } else {
                setCurrentInputs({});
              }
              setCurrentPutts({});
              setCurrentHole(prevHole);
            }}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Prev
          </Button>
          <Button
            variant="outline"
            className="flex-1 min-h-10"
            disabled={currentHole + 1 > firstUnscoredHole}
            onClick={() => {
              const nextHole = currentHole + 1;
              const holeMap = submittedScores.get(nextHole);
              if (holeMap) {
                const inputs: Record<number, string> = {};
                for (const [pid, gs] of holeMap) inputs[pid] = String(gs);
                setCurrentInputs(inputs);
              } else {
                setCurrentInputs({});
              }
              setCurrentPutts({});
              setCurrentHole(nextHole);
            }}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
