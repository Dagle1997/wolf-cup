import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, Fragment } from 'react';
import { RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeaderboardPlayer = {
  playerId: number;
  name: string;
  handicapIndex: number;
  groupId: number;
  groupNumber: number;
  thruHole: number;
  grossTotal: number;
  netToPar: number;
  stablefordTotal: number;
  moneyTotal: number;
  rank: number;
  stablefordRank: number;
  moneyRank: number;
  harveyStableford: number | null;
  harveyMoney: number | null;
};

type LeaderboardResponse = {
  round: {
    id: number;
    type: 'official' | 'casual';
    status: string;
    scheduledDate: string;
    autoCalculateMoney: boolean;
  } | null;
  harveyLiveEnabled: boolean;
  sideGame: { name: string; format: string } | null;
  leaderboard: LeaderboardPlayer[];
  lastUpdated: string;
};

type ScorecardHole = {
  holeNumber: number;
  par: number;
  grossScore: number;
  netScore: number;
  stablefordPoints: number;
  moneyNet: number;
};

type ScorecardResponse = {
  playerId: number;
  playerName: string;
  groupId: number;
  autoCalculateMoney: boolean;
  holes: ScorecardHole[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(amount: number): string {
  if (amount > 0) return `+$${amount}`;
  if (amount < 0) return `-$${Math.abs(amount)}`;
  return '$0';
}

function formatNetToPar(n: number): string {
  if (n === 0) return 'E';
  if (n > 0) return `+${n}`;
  return String(n);
}

function formatThru(thruHole: number): string {
  if (thruHole === 0) return '—';
  if (thruHole === 18) return 'F';
  return `Thru ${thruHole}`;
}

// ---------------------------------------------------------------------------
// HoleBadge — compact golf notation for horizontal scorecard
// ---------------------------------------------------------------------------

function HoleBadge({ gross, net, par }: { gross: number; net: number; par: number }) {
  const d = net - par;
  if (d <= -2) {
    // Eagle or better: filled blue circle
    return (
      <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-blue-600 text-white text-[9px] font-black leading-none">
        {gross}
      </span>
    );
  }
  if (d === -1) {
    // Birdie: blue circle outline
    return (
      <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border-[1.5px] border-blue-600 text-blue-600 text-[9px] font-bold leading-none">
        {gross}
      </span>
    );
  }
  if (d === 1) {
    // Bogey: amber square outline
    return (
      <span className="inline-flex items-center justify-center w-[18px] h-[18px] border-[1.5px] border-amber-500 text-amber-600 text-[9px] font-medium leading-none">
        {gross}
      </span>
    );
  }
  if (d >= 2) {
    // Double bogey+: red text
    return <span className="text-[10px] font-medium text-destructive">{gross}</span>;
  }
  // Par
  return <span className="text-[10px] font-medium">{gross}</span>;
}

// ---------------------------------------------------------------------------
// ScorecardPanel — horizontal golf scorecard (front 9 + back 9)
// ---------------------------------------------------------------------------

function ScorecardPanel({
  roundId,
  playerId,
  autoCalculateMoney: _autoCalculateMoney,
}: {
  roundId: number;
  playerId: number;
  autoCalculateMoney: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['scorecard', roundId, playerId],
    queryFn: () => apiFetch<ScorecardResponse>(`/rounds/${roundId}/players/${playerId}/scorecard`),
  });

  if (isLoading) {
    return (
      <div className="p-4 text-center">
        <Loader2 className="h-4 w-4 animate-spin inline" />
      </div>
    );
  }
  if (isError) {
    return <div className="p-3 text-center text-muted-foreground text-xs">Could not load scorecard</div>;
  }
  if (!data || data.holes.length === 0) {
    return <div className="p-3 text-center text-muted-foreground text-xs">No scores yet</div>;
  }

  const holeMap = new Map(data.holes.map((h) => [h.holeNumber, h]));
  const g = (n: number) => holeMap.get(n) ?? null;

  const FRONT = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
  const BACK = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const;

  const front9 = data.holes.filter((h) => h.holeNumber <= 9);
  const back9 = data.holes.filter((h) => h.holeNumber > 9);
  const showMoney = data.autoCalculateMoney;

  const sum = <K extends keyof ScorecardHole>(holes: ScorecardHole[], key: K) =>
    holes.reduce((s, h) => s + (h[key] as number), 0);

  const fPar = sum(front9, 'par');
  const fGross = sum(front9, 'grossScore');
  const fNet = sum(front9, 'netScore');
  const fStab = sum(front9, 'stablefordPoints');
  const fMoney = sum(front9, 'moneyNet');

  const bPar = sum(back9, 'par');
  const bGross = sum(back9, 'grossScore');
  const bNet = sum(back9, 'netScore');
  const bStab = sum(back9, 'stablefordPoints');
  const bMoney = sum(back9, 'moneyNet');

  const tdC = 'text-center py-[3px] text-[10px]';
  const tdL = 'pl-2 pr-1 py-[3px] text-[10px] font-semibold text-muted-foreground whitespace-nowrap';
  const tdTot = 'text-center py-[3px] text-[10px] font-bold';

  return (
    <div className="overflow-x-auto py-2 px-1">
      <div className="min-w-max space-y-2">

      {/* ── Front 9 ── */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-green-700 text-white">
            <th className="pl-2 pr-1 py-1 text-[10px] font-semibold text-left w-10">Hole</th>
            {FRONT.map((n) => (
              <th key={n} className="w-[22px] text-center py-1 text-[10px] font-semibold">{n}</th>
            ))}
            <th className="w-[28px] text-center py-1 text-[10px] font-bold">Out</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-muted/30">
            <td className={tdL}>Par</td>
            {FRONT.map((n) => {
              const h = g(n);
              return <td key={n} className={`${tdC} text-muted-foreground`}>{h ? h.par : '—'}</td>;
            })}
            <td className={`${tdTot} text-muted-foreground`}>{front9.length > 0 ? fPar : '—'}</td>
          </tr>
          <tr className="border-t border-border/30">
            <td className={tdL}>Score</td>
            {FRONT.map((n) => {
              const h = g(n);
              return (
                <td key={n} className={tdC}>
                  {h
                    ? <HoleBadge gross={h.grossScore} net={h.netScore} par={h.par} />
                    : <span className="text-muted-foreground/50 text-[10px]">—</span>
                  }
                </td>
              );
            })}
            <td className={tdTot}>{front9.length > 0 ? fGross : '—'}</td>
          </tr>
          <tr className="border-t border-border/30 bg-muted/30">
            <td className={tdL}>Net</td>
            {FRONT.map((n) => {
              const h = g(n);
              return <td key={n} className={`${tdC} text-muted-foreground`}>{h ? h.netScore : '—'}</td>;
            })}
            <td className={`${tdTot} text-muted-foreground`}>{front9.length > 0 ? fNet : '—'}</td>
          </tr>
          <tr className="border-t border-border/30">
            <td className={tdL}>Stab</td>
            {FRONT.map((n) => {
              const h = g(n);
              const pts = h?.stablefordPoints;
              const color = pts !== undefined
                ? pts >= 3 ? 'text-green-600 font-semibold' : pts === 0 ? 'text-destructive/60' : ''
                : '';
              return <td key={n} className={`${tdC} ${color}`}>{h ? h.stablefordPoints : '—'}</td>;
            })}
            <td className={`${tdTot} text-green-700`}>{front9.length > 0 ? fStab : '—'}</td>
          </tr>
          {showMoney && (
            <tr className="border-t border-border/30 bg-muted/30">
              <td className={tdL}>$</td>
              {FRONT.map((n) => {
                const h = g(n);
                const color = h
                  ? h.moneyNet > 0 ? 'text-green-600' : h.moneyNet < 0 ? 'text-destructive' : 'text-muted-foreground'
                  : '';
                return (
                  <td key={n} className={`${tdC} ${color}`}>
                    {h ? (h.moneyNet === 0 ? '0' : formatMoney(h.moneyNet)) : '—'}
                  </td>
                );
              })}
              <td className={`${tdTot} ${fMoney > 0 ? 'text-green-600' : fMoney < 0 ? 'text-destructive' : ''}`}>
                {front9.length > 0 ? formatMoney(fMoney) : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ── Back 9 (only if any back-9 scores) ── */}
      {back9.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-green-700 text-white">
              <th className="pl-2 pr-1 py-1 text-[10px] font-semibold text-left w-10">Hole</th>
              {BACK.map((n) => (
                <th key={n} className="w-[22px] text-center py-1 text-[10px] font-semibold">{n}</th>
              ))}
              <th className="w-[28px] text-center py-1 text-[10px] font-bold">In</th>
              <th className="w-[28px] text-center py-1 text-[10px] font-bold">Tot</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-muted/30">
              <td className={tdL}>Par</td>
              {BACK.map((n) => {
                const h = g(n);
                return <td key={n} className={`${tdC} text-muted-foreground`}>{h ? h.par : '—'}</td>;
              })}
              <td className={`${tdTot} text-muted-foreground`}>{bPar}</td>
              <td className={`${tdTot} text-muted-foreground`}>{fPar + bPar}</td>
            </tr>
            <tr className="border-t border-border/30">
              <td className={tdL}>Score</td>
              {BACK.map((n) => {
                const h = g(n);
                return (
                  <td key={n} className={tdC}>
                    {h
                      ? <HoleBadge gross={h.grossScore} net={h.netScore} par={h.par} />
                      : <span className="text-muted-foreground/50 text-[10px]">—</span>
                    }
                  </td>
                );
              })}
              <td className={tdTot}>{bGross}</td>
              <td className={tdTot}>{fGross + bGross}</td>
            </tr>
            <tr className="border-t border-border/30 bg-muted/30">
              <td className={tdL}>Net</td>
              {BACK.map((n) => {
                const h = g(n);
                return <td key={n} className={`${tdC} text-muted-foreground`}>{h ? h.netScore : '—'}</td>;
              })}
              <td className={`${tdTot} text-muted-foreground`}>{bNet}</td>
              <td className={`${tdTot} text-muted-foreground`}>{fNet + bNet}</td>
            </tr>
            <tr className="border-t border-border/30">
              <td className={tdL}>Stab</td>
              {BACK.map((n) => {
                const h = g(n);
                const pts = h?.stablefordPoints;
                const color = pts !== undefined
                  ? pts >= 3 ? 'text-green-600 font-semibold' : pts === 0 ? 'text-destructive/60' : ''
                  : '';
                return <td key={n} className={`${tdC} ${color}`}>{h ? h.stablefordPoints : '—'}</td>;
              })}
              <td className={`${tdTot} text-green-700`}>{bStab}</td>
              <td className={`${tdTot} text-green-700`}>{fStab + bStab}</td>
            </tr>
            {showMoney && (
              <tr className="border-t border-border/30 bg-muted/30">
                <td className={tdL}>$</td>
                {BACK.map((n) => {
                  const h = g(n);
                  const color = h
                    ? h.moneyNet > 0 ? 'text-green-600' : h.moneyNet < 0 ? 'text-destructive' : 'text-muted-foreground'
                    : '';
                  return (
                    <td key={n} className={`${tdC} ${color}`}>
                      {h ? (h.moneyNet === 0 ? '0' : formatMoney(h.moneyNet)) : '—'}
                    </td>
                  );
                })}
                <td className={`${tdTot} ${bMoney > 0 ? 'text-green-600' : bMoney < 0 ? 'text-destructive' : ''}`}>
                  {formatMoney(bMoney)}
                </td>
                <td className={`${tdTot} ${(fMoney + bMoney) > 0 ? 'text-green-600' : (fMoney + bMoney) < 0 ? 'text-destructive' : ''}`}>
                  {formatMoney(fMoney + bMoney)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LeaderboardPage
// ---------------------------------------------------------------------------

function LeaderboardPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => apiFetch<LeaderboardResponse>('/leaderboard/live'),
    refetchInterval: 5000,
  });

  const [secondsAgo, setSecondsAgo] = useState(0);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const currentRound = data?.round ?? null;

  useEffect(() => {
    setSelectedPlayerId(null);
  }, [data?.round?.id]);

  useEffect(() => {
    if (!data?.lastUpdated) return;
    setSecondsAgo(Math.floor((Date.now() - new Date(data.lastUpdated).getTime()) / 1000));
    const interval = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - new Date(data.lastUpdated).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [data?.lastUpdated]);

  const colCount = data?.harveyLiveEnabled ? 7 : 5;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Live Leaderboard</h1>
        <div className="flex items-center gap-2">
          <Link to="/practice" className="text-xs text-muted-foreground hover:underline">
            Practice round
          </Link>
          <Button variant="ghost" size="sm" onClick={() => void refetch()} className="gap-1">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {data?.lastUpdated && (
        <p className="text-xs text-muted-foreground mb-3">Updated {secondsAgo}s ago</p>
      )}

      {isLoading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-12 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load leaderboard — tap to retry</p>
          <Button variant="outline" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}

      {data && data.round === null && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <p className="text-muted-foreground">No official round today</p>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <Link to="/practice">
              <Button className="w-full min-h-12">Start Practice Round</Button>
            </Link>
            <Link to="/score-entry">
              <Button variant="outline" className="w-full min-h-12">Join Official Round</Button>
            </Link>
          </div>
        </div>
      )}

      {data && currentRound && (
        <>
          {data.sideGame && (
            <div className="rounded-xl border bg-card p-3 mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Side Game</p>
              <p className="font-medium">{data.sideGame.name}</p>
              <p className="text-sm text-muted-foreground">{data.sideGame.format}</p>
            </div>
          )}

          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground text-xs">
                  <th className="text-left py-2 px-3 w-8">#</th>
                  <th className="text-left py-2 pr-2">Player</th>
                  <th className="text-right py-2 pr-2 w-14">To Par</th>
                  <th className="text-right py-2 pr-2 w-12">Pts</th>
                  <th className="text-right py-2 pr-3 w-16">$</th>
                  {data.harveyLiveEnabled && <th className="text-right py-2 pr-2 w-12">H.Pts</th>}
                  {data.harveyLiveEnabled && <th className="text-right py-2 pr-3 w-12">H.$</th>}
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((player) => {
                  const toParColor =
                    player.netToPar < 0
                      ? 'text-green-600 font-bold'
                      : player.netToPar > 0
                        ? 'text-destructive font-medium'
                        : 'font-medium';

                  return (
                    <Fragment key={player.playerId}>
                      <tr
                        role="button"
                        aria-expanded={selectedPlayerId === player.playerId}
                        onClick={() =>
                          setSelectedPlayerId((prev) =>
                            prev === player.playerId ? null : player.playerId,
                          )
                        }
                        className={`border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors ${selectedPlayerId === player.playerId ? 'bg-muted/20' : ''}`}
                      >
                        <td className="py-2 px-3 font-medium text-muted-foreground">{player.rank}</td>
                        <td className="py-2 pr-2">
                          <div className="font-medium">{player.name}</div>
                          <div className="text-xs text-muted-foreground">
                            HCP {Math.round(player.handicapIndex * 10) / 10} · {formatThru(player.thruHole)}
                          </div>
                        </td>
                        <td className={`py-2 pr-2 text-right tabular-nums ${toParColor}`}>
                          {player.thruHole === 0 ? '—' : formatNetToPar(player.netToPar)}
                        </td>
                        <td className="py-2 pr-2 text-right tabular-nums text-sm">
                          {player.stablefordTotal}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-sm">
                          {formatMoney(player.moneyTotal)}
                        </td>
                        {data.harveyLiveEnabled && (
                          <td className="py-2 pr-2 text-right tabular-nums">
                            {player.harveyStableford !== null
                              ? (typeof player.harveyStableford === 'number' && !Number.isInteger(player.harveyStableford)
                                  ? player.harveyStableford.toFixed(1)
                                  : player.harveyStableford)
                              : '—'}
                          </td>
                        )}
                        {data.harveyLiveEnabled && (
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {player.harveyMoney !== null
                              ? (typeof player.harveyMoney === 'number' && !Number.isInteger(player.harveyMoney)
                                  ? player.harveyMoney.toFixed(1)
                                  : player.harveyMoney)
                              : '—'}
                          </td>
                        )}
                      </tr>
                      {selectedPlayerId === player.playerId && (
                        <tr className="border-b bg-muted/10">
                          <td colSpan={colCount} className="p-0">
                            <ScorecardPanel
                              roundId={currentRound.id}
                              playerId={player.playerId}
                              autoCalculateMoney={currentRound.autoCalculateMoney}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {data.leaderboard.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="py-8 text-center text-muted-foreground">
                      No players in this round yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: LeaderboardPage,
});
