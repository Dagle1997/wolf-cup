import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, Fragment } from 'react';
import { RefreshCw, AlertCircle, Loader2, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { getSession } from '@/lib/session-store';

// ---------------------------------------------------------------------------
// Types — Highlights
// ---------------------------------------------------------------------------

type Highlight = {
  emoji: string;
  title: string;
  detail: string;
  category: 'scoring' | 'money' | 'bonus' | 'wolf';
};

type HighlightsResponse = {
  highlights: Highlight[];
};

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
  harveyTotal: number | null;
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

type HistoryRound = {
  id: number;
  type: string;
  status: string;
  scheduledDate: string;
  playerCount: number;
};

type HistoryResponse = {
  rounds: HistoryRound[];
};

type ScorecardHole = {
  holeNumber: number;
  par: number;
  grossScore: number | null;
  netScore: number | null;
  stablefordPoints: number | null;
  moneyNet: number;
  hasGreenie?: boolean;
  hasPolie?: boolean;
  relativeStrokes?: number;
  wolfDecision?: string | null;
  wolfRole?: 'wolf' | 'partner' | 'opponent' | null;
  wolfPlayerName?: string | null;
  partnerPlayerName?: string | null;
};

type ScorecardResponse = {
  playerId: number;
  playerName: string;
  groupId: number;
  autoCalculateMoney: boolean;
  battingPosition: number | null;
  wolfHoles: number[];
  holes: ScorecardHole[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

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

function formatRoundDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// HoleBadge — compact golf notation for horizontal scorecard
// ---------------------------------------------------------------------------

function HoleBadge({ gross, par, hasGreenie, hasPolie, relativeStrokes }: {
  gross: number; par: number;
  hasGreenie?: boolean | undefined; hasPolie?: boolean | undefined;
  relativeStrokes?: number | undefined;
}) {
  const d = gross - par; // gross-based styling
  const bonusDots = (hasGreenie || hasPolie) ? (
    <span className="absolute -bottom-[2px] left-1/2 -translate-x-1/2 flex gap-[1px]">
      {hasGreenie && <span className="w-[4px] h-[4px] rounded-full bg-emerald-500" />}
      {hasPolie && <span className="w-[4px] h-[4px] rounded-full bg-amber-400" />}
    </span>
  ) : null;
  const strokeDot = relativeStrokes ? (
    <span className="absolute -top-[2px] -right-[2px] w-[4px] h-[4px] rounded-full bg-foreground/50" />
  ) : null;

  if (d <= -2) {
    // Eagle or better: filled red circle
    return (
      <span className="relative inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-red-600 text-white text-[9px] font-black leading-none">
        {gross}{bonusDots}{strokeDot}
      </span>
    );
  }
  if (d === -1) {
    // Birdie: red circle outline
    return (
      <span className="relative inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border-[1.5px] border-red-600 text-red-600 text-[9px] font-bold leading-none">
        {gross}{bonusDots}{strokeDot}
      </span>
    );
  }
  if (d === 1) {
    // Bogey: orange square outline
    return (
      <span className="relative inline-flex items-center justify-center w-[18px] h-[18px] border-[1.5px] border-amber-500 text-amber-600 text-[9px] font-medium leading-none">
        {gross}{bonusDots}{strokeDot}
      </span>
    );
  }
  if (d >= 2) {
    // Double bogey+: blue text with diagonal hash background
    const hashSvg = `url("data:image/svg+xml,%3Csvg width='6' height='6' xmlns='http://www.w3.org/2000/svg'%3E%3Cline x1='0' y1='6' x2='6' y2='0' stroke='%23888' stroke-width='1'/%3E%3C/svg%3E")`;
    return (
      <span className="relative inline-flex items-center justify-center w-[18px] h-[18px] text-blue-600 text-[9px] font-bold leading-none"
        style={{ backgroundImage: hashSvg, backgroundSize: '6px 6px' }}>
        {gross}{bonusDots}{strokeDot}
      </span>
    );
  }
  // Par
  return (
    <span className="relative inline-block text-[10px] font-medium">
      {gross}{bonusDots}{strokeDot}
    </span>
  );
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

  const playedHoles = data.holes.filter((h) => h.grossScore !== null);
  if (playedHoles.length === 0) {
    return <div className="p-3 text-center text-muted-foreground text-xs">No scores yet</div>;
  }

  const holeMap = new Map(data.holes.map((h) => [h.holeNumber, h]));
  const g = (n: number) => holeMap.get(n) ?? null;
  const wolfSet = new Set(data.wolfHoles);
  const hasAnyWolfDecision = data.holes.some((h) => h.wolfRole);

  const FRONT = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
  const BACK = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const;

  const front9played = playedHoles.filter((h) => h.holeNumber <= 9);
  const back9played = playedHoles.filter((h) => h.holeNumber > 9);
  const showMoney = data.autoCalculateMoney;

  const sum = (holes: ScorecardHole[], key: 'par' | 'grossScore' | 'netScore' | 'stablefordPoints' | 'moneyNet') =>
    holes.reduce((s, h) => s + ((h[key] as number | null) ?? 0), 0);

  const fPar = sum(front9played, 'par');
  const fGross = sum(front9played, 'grossScore');
  const fNet = sum(front9played, 'netScore');
  const fStab = sum(front9played, 'stablefordPoints');
  const fMoney = sum(front9played, 'moneyNet');

  const bPar = sum(back9played, 'par');
  const bGross = sum(back9played, 'grossScore');
  const bNet = sum(back9played, 'netScore');
  const bStab = sum(back9played, 'stablefordPoints');
  const bMoney = sum(back9played, 'moneyNet');

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
              <th key={n} className="w-[22px] text-center py-1 text-[10px] font-semibold">
                {wolfSet.has(n)
                  ? <span className="inline-flex items-center justify-center w-[16px] h-[16px] border border-white/80 rounded-sm text-[10px] font-bold">{n}</span>
                  : n}
              </th>
            ))}
            <th className="w-[28px] text-center py-1 text-[10px] font-bold">Out</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-muted/30">
            <td className={tdL}>Par</td>
            {FRONT.map((n) => {
              const h = g(n);
              return <td key={n} className={`${tdC} text-muted-foreground`}>{h?.grossScore != null ? h.par : '—'}</td>;
            })}
            <td className={`${tdTot} text-muted-foreground`}>{front9played.length > 0 ? fPar : '—'}</td>
          </tr>
          <tr className="border-t border-border/30">
            <td className={tdL}>Score</td>
            {FRONT.map((n) => {
              const h = g(n);
              return (
                <td key={n} className={tdC}>
                  {h?.grossScore != null
                    ? <HoleBadge gross={h.grossScore} par={h.par} hasGreenie={h.hasGreenie} hasPolie={h.hasPolie} relativeStrokes={h.relativeStrokes} />
                    : <span className="relative inline-block text-muted-foreground/50 text-[10px]">
                        —
                        {h?.relativeStrokes ? <span className="absolute -top-[2px] -right-[4px] w-[4px] h-[4px] rounded-full bg-foreground/50" /> : null}
                      </span>
                  }
                </td>
              );
            })}
            <td className={tdTot}>{front9played.length > 0 ? fGross : '—'}</td>
          </tr>
          {/* Wolf decision row — show if any wolf decisions exist in group */}
          {hasAnyWolfDecision && (
            <tr className="border-t border-border/30 bg-muted/30">
              <td className={tdL}>Wolf</td>
              {FRONT.map((n) => {
                const h = g(n);
                const role = h?.wolfRole;
                const dec = h?.wolfDecision;
                const wolfInit = h?.wolfPlayerName ? getInitials(h.wolfPlayerName) : '';
                const partnerInit = h?.partnerPlayerName ? getInitials(h.partnerPlayerName) : '';
                return (
                  <td key={n} className={`${tdC} text-[9px]`}>
                    {role === 'wolf'
                      ? dec === 'alone' ? <span className="font-bold text-foreground">W</span>
                        : dec === 'blind_wolf' ? <span className="font-bold text-red-500">B</span>
                        : dec === 'partner' ? <span className="font-bold text-green-600">{partnerInit}</span>
                        : <span className="text-amber-500">🐺</span>
                      : role === 'partner' ? <span className="font-bold text-green-600">{wolfInit}</span>
                      : role === 'opponent'
                        ? dec === 'partner' ? <span className="font-bold text-red-500">{partnerInit}</span>
                          : <span className="font-bold text-red-500">3v1</span>
                      : ''}
                  </td>
                );
              })}
              <td className={tdTot} />
            </tr>
          )}
          <tr className="border-t border-border/30 bg-muted/30">
            <td className={tdL}>Net</td>
            {FRONT.map((n) => {
              const h = g(n);
              return <td key={n} className={`${tdC} text-muted-foreground`}>{h?.netScore ?? '—'}</td>;
            })}
            <td className={`${tdTot} text-muted-foreground`}>{front9played.length > 0 ? fNet : '—'}</td>
          </tr>
          <tr className="border-t border-border/30">
            <td className={tdL}>Stab</td>
            {FRONT.map((n) => {
              const h = g(n);
              const pts = h?.stablefordPoints;
              const color = pts != null
                ? pts >= 3 ? 'text-green-600 font-semibold' : pts === 0 ? 'text-destructive/60' : ''
                : '';
              return <td key={n} className={`${tdC} ${color}`}>{h?.stablefordPoints ?? '—'}</td>;
            })}
            <td className={`${tdTot} text-green-700`}>{front9played.length > 0 ? fStab : '—'}</td>
          </tr>
          {showMoney && (
            <tr className="border-t border-border/30 bg-muted/30">
              <td className={tdL}>$</td>
              {FRONT.map((n) => {
                const h = g(n);
                const hasScore = h?.grossScore != null;
                const color = hasScore
                  ? h!.moneyNet > 0 ? 'text-green-600' : h!.moneyNet < 0 ? 'text-destructive' : 'text-muted-foreground'
                  : '';
                return (
                  <td key={n} className={`${tdC} ${color}`}>
                    {hasScore ? (h!.moneyNet === 0 ? '0' : formatMoney(h!.moneyNet)) : '—'}
                  </td>
                );
              })}
              <td className={`${tdTot} ${fMoney > 0 ? 'text-green-600' : fMoney < 0 ? 'text-destructive' : ''}`}>
                {front9played.length > 0 ? formatMoney(fMoney) : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ── Back 9 (show once any back-9 hole has been played) ── */}
      {back9played.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-green-700 text-white">
              <th className="pl-2 pr-1 py-1 text-[10px] font-semibold text-left w-10">Hole</th>
              {BACK.map((n) => (
                <th key={n} className="w-[22px] text-center py-1 text-[10px] font-semibold">
                  {wolfSet.has(n)
                    ? <span className="inline-flex items-center justify-center w-[16px] h-[16px] border border-white/80 rounded-sm text-[10px] font-bold">{n}</span>
                    : n}
                </th>
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
                return <td key={n} className={`${tdC} text-muted-foreground`}>{h?.grossScore != null ? h.par : '—'}</td>;
              })}
              <td className={`${tdTot} text-muted-foreground`}>{back9played.length > 0 ? bPar : '—'}</td>
              <td className={`${tdTot} text-muted-foreground`}>{fPar + bPar}</td>
            </tr>
            <tr className="border-t border-border/30">
              <td className={tdL}>Score</td>
              {BACK.map((n) => {
                const h = g(n);
                return (
                  <td key={n} className={tdC}>
                    {h?.grossScore != null
                      ? <HoleBadge gross={h.grossScore} par={h.par} hasGreenie={h.hasGreenie} hasPolie={h.hasPolie} relativeStrokes={h.relativeStrokes} />
                      : <span className="relative inline-block text-muted-foreground/50 text-[10px]">
                          —
                          {h?.relativeStrokes ? <span className="absolute -top-[2px] -right-[4px] w-[4px] h-[4px] rounded-full bg-foreground/50" /> : null}
                        </span>
                    }
                  </td>
                );
              })}
              <td className={tdTot}>{back9played.length > 0 ? bGross : '—'}</td>
              <td className={tdTot}>{fGross + bGross}</td>
            </tr>
            {/* Wolf decision row — back 9 */}
            {hasAnyWolfDecision && (
              <tr className="border-t border-border/30 bg-muted/30">
                <td className={tdL}>Wolf</td>
                {BACK.map((n) => {
                  const h = g(n);
                  const role = h?.wolfRole;
                  const dec = h?.wolfDecision;
                  const wolfInit = h?.wolfPlayerName ? getInitials(h.wolfPlayerName) : '';
                  const partnerInit = h?.partnerPlayerName ? getInitials(h.partnerPlayerName) : '';
                  return (
                    <td key={n} className={`${tdC} text-[9px]`}>
                      {role === 'wolf'
                        ? dec === 'alone' ? <span className="font-bold text-foreground">W</span>
                          : dec === 'blind_wolf' ? <span className="font-bold text-red-500">B</span>
                          : dec === 'partner' ? <span className="font-bold text-green-600">{partnerInit}</span>
                          : <span className="text-amber-500">🐺</span>
                        : role === 'partner' ? <span className="font-bold text-green-600">{wolfInit}</span>
                        : role === 'opponent'
                          ? dec === 'partner' ? <span className="font-bold text-red-500">{partnerInit}</span>
                            : <span className="font-bold text-red-500">3v1</span>
                        : ''}
                    </td>
                  );
                })}
                <td className={tdTot} />
                <td className={tdTot} />
              </tr>
            )}
            <tr className="border-t border-border/30 bg-muted/30">
              <td className={tdL}>Net</td>
              {BACK.map((n) => {
                const h = g(n);
                return <td key={n} className={`${tdC} text-muted-foreground`}>{h?.netScore ?? '—'}</td>;
              })}
              <td className={`${tdTot} text-muted-foreground`}>{back9played.length > 0 ? bNet : '—'}</td>
              <td className={`${tdTot} text-muted-foreground`}>{fNet + bNet}</td>
            </tr>
            <tr className="border-t border-border/30">
              <td className={tdL}>Stab</td>
              {BACK.map((n) => {
                const h = g(n);
                const pts = h?.stablefordPoints;
                const color = pts != null
                  ? pts >= 3 ? 'text-green-600 font-semibold' : pts === 0 ? 'text-destructive/60' : ''
                  : '';
                return <td key={n} className={`${tdC} ${color}`}>{h?.stablefordPoints ?? '—'}</td>;
              })}
              <td className={`${tdTot} text-green-700`}>{back9played.length > 0 ? bStab : '—'}</td>
              <td className={`${tdTot} text-green-700`}>{fStab + bStab}</td>
            </tr>
            {showMoney && (
              <tr className="border-t border-border/30 bg-muted/30">
                <td className={tdL}>$</td>
                {BACK.map((n) => {
                  const h = g(n);
                  const hasScore = h?.grossScore != null;
                  const color = hasScore
                    ? h!.moneyNet > 0 ? 'text-green-600' : h!.moneyNet < 0 ? 'text-destructive' : 'text-muted-foreground'
                    : '';
                  return (
                    <td key={n} className={`${tdC} ${color}`}>
                      {hasScore ? (h!.moneyNet === 0 ? '0' : formatMoney(h!.moneyNet)) : '—'}
                    </td>
                  );
                })}
                <td className={`${tdTot} ${bMoney > 0 ? 'text-green-600' : bMoney < 0 ? 'text-destructive' : ''}`}>
                  {back9played.length > 0 ? formatMoney(bMoney) : '—'}
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
// Rank medal helpers
// ---------------------------------------------------------------------------

function rankRowClass(rank: number, isSelected: boolean): string {
  const base = 'border-b last:border-0 cursor-pointer transition-colors';
  if (rank === 1) return `${base} border-l-2 border-l-amber-400 ${isSelected ? 'bg-amber-50/80 dark:bg-amber-950/30' : 'hover:bg-amber-50/60 dark:hover:bg-amber-950/20'}`;
  if (rank === 2) return `${base} border-l-2 border-l-slate-400 ${isSelected ? 'bg-slate-50/80 dark:bg-slate-900/20' : 'hover:bg-muted/30'}`;
  if (rank === 3) return `${base} border-l-2 border-l-orange-500 ${isSelected ? 'bg-orange-50/60 dark:bg-orange-950/20' : 'hover:bg-muted/30'}`;
  return `${base} border-l-2 border-l-transparent ${isSelected ? 'bg-muted/20' : 'hover:bg-muted/30'}`;
}

function RankCell({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400 text-amber-900 text-xs font-black">1</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 text-slate-700 text-xs font-black dark:bg-slate-600 dark:text-slate-100">2</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-400 text-orange-900 text-xs font-black">3</span>;
  return <span className="text-sm font-medium text-muted-foreground">{rank}</span>;
}

// ---------------------------------------------------------------------------
// HighlightReel — slideshow of round highlights
// ---------------------------------------------------------------------------

function HighlightReel({ roundId }: { roundId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['highlights', roundId],
    queryFn: () => apiFetch<HighlightsResponse>(`/rounds/${roundId}/highlights`),
  });

  const [current, setCurrent] = useState(0);
  const items = data?.highlights ?? [];

  // Auto-advance every 4 seconds
  useEffect(() => {
    if (items.length <= 1) return;
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % items.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [items.length]);

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-4 mb-3 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) return null;

  const item = items[current]!;
  const catColor = {
    scoring: 'bg-blue-500/10 border-blue-500/20',
    money: 'bg-green-500/10 border-green-500/20',
    bonus: 'bg-emerald-500/10 border-emerald-500/20',
    wolf: 'bg-amber-500/10 border-amber-500/20',
  }[item.category];

  return (
    <div className={`rounded-xl border ${catColor} p-4 mb-3 transition-all duration-300`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Highlight Reel
          </span>
        </div>
        {items.length > 1 && (
          <div className="flex items-center gap-1">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === current ? 'bg-foreground' : 'bg-foreground/20'
                }`}
                aria-label={`Highlight ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-start gap-3 mt-2">
        <span className="text-2xl shrink-0 leading-none mt-0.5">{item.emoji}</span>
        <div className="min-w-0">
          <div className="font-bold text-sm leading-tight">{item.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{item.detail}</div>
        </div>
      </div>
      {items.length > 1 && (
        <div className="flex justify-between mt-3">
          <button
            onClick={() => setCurrent((current - 1 + items.length) % items.length)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ‹ Prev
          </button>
          <span className="text-[10px] text-muted-foreground/60">
            {current + 1} / {items.length}
          </span>
          <button
            onClick={() => setCurrent((current + 1) % items.length)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LeaderboardTable — shared between live and historical views
// ---------------------------------------------------------------------------

function LeaderboardTable({
  data,
  roundId,
  autoCalculateMoney,
}: {
  data: LeaderboardResponse;
  roundId: number;
  autoCalculateMoney: boolean;
}) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const colCount = data.harveyLiveEnabled ? 6 : 5;

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/60 text-muted-foreground text-[11px]">
            <th className="text-center py-2 pl-2 pr-1 w-10">#</th>
            <th className="text-left py-2 pr-2">Player</th>
            <th className="text-right py-2 pr-2 w-14">To Par</th>
            <th className="text-right py-2 pr-2 w-12">Stb</th>
            <th className="text-right py-2 pr-3 w-14">$</th>
            {data.harveyLiveEnabled && <th className="text-right py-2 pr-3 w-16">Hvy Pts</th>}
          </tr>
        </thead>
        <tbody>
          {data.leaderboard.map((player) => {
            const isSelected = selectedPlayerId === player.playerId;
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
                  aria-expanded={isSelected}
                  onClick={() =>
                    setSelectedPlayerId((prev) =>
                      prev === player.playerId ? null : player.playerId,
                    )
                  }
                  className={rankRowClass(player.rank, isSelected)}
                >
                  <td className="py-2.5 pl-2 pr-1 text-center">
                    <RankCell rank={player.rank} />
                  </td>
                  <td className="py-2.5 pr-2">
                    <div className="font-semibold leading-tight">{player.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      HCP {Math.round(player.handicapIndex * 10) / 10} · {formatThru(player.thruHole)}
                    </div>
                  </td>
                  <td className={`py-2.5 pr-2 text-right tabular-nums text-base ${toParColor}`}>
                    {player.thruHole === 0 ? '—' : formatNetToPar(player.netToPar)}
                  </td>
                  <td className="py-2.5 pr-2 text-right tabular-nums font-medium">
                    {player.stablefordTotal}
                  </td>
                  <td className={`py-2.5 pr-3 text-right tabular-nums font-medium ${player.moneyTotal > 0 ? 'text-green-600' : player.moneyTotal < 0 ? 'text-destructive' : ''}`}>
                    {formatMoney(player.moneyTotal)}
                  </td>
                  {data.harveyLiveEnabled && (
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">
                      {player.harveyTotal !== null
                        ? (typeof player.harveyTotal === 'number' && !Number.isInteger(player.harveyTotal)
                            ? player.harveyTotal.toFixed(1)
                            : player.harveyTotal)
                        : '—'}
                    </td>
                  )}
                </tr>
                {isSelected && (
                  <tr className="border-b bg-muted/5">
                    <td colSpan={colCount} className="p-0">
                      <ScorecardPanel
                        roundId={roundId}
                        playerId={player.playerId}
                        autoCalculateMoney={autoCalculateMoney}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {data.leaderboard.length === 0 && (
            <tr>
              <td colSpan={colCount} className="py-10 text-center text-muted-foreground">
                No players in this round yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LeaderboardPage
// ---------------------------------------------------------------------------

function LeaderboardPage() {
  const [viewingRoundId, setViewingRoundId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // If the user has an active session, show their round instead of the generic "live" round
  const session = getSession();
  const sessionRoundId = session?.roundId ?? null;

  // Live leaderboard
  const { data: liveData, isLoading: liveLoading, isError: liveError, isFetching: liveFetching, refetch: liveRefetch } = useQuery({
    queryKey: ['leaderboard', sessionRoundId ? `session-${sessionRoundId}` : 'live'],
    queryFn: () => sessionRoundId
      ? apiFetch<LeaderboardResponse>(`/leaderboard/${sessionRoundId}`)
      : apiFetch<LeaderboardResponse>('/leaderboard/live'),
    refetchInterval: viewingRoundId ? false : 5000, // stop polling when viewing history
  });

  // History list
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['leaderboard-history'],
    queryFn: () => apiFetch<HistoryResponse>('/leaderboard/history'),
    enabled: showHistory || (liveData?.round === null),
  });

  // Historical round leaderboard
  const { data: histRoundData, isLoading: histRoundLoading } = useQuery({
    queryKey: ['leaderboard', viewingRoundId],
    queryFn: () => apiFetch<LeaderboardResponse>(`/leaderboard/${viewingRoundId}`),
    enabled: viewingRoundId !== null,
  });

  const [secondsAgo, setSecondsAgo] = useState(0);

  const isViewingHistory = viewingRoundId !== null;
  const currentData = isViewingHistory ? histRoundData : liveData;
  const currentRound = currentData?.round ?? null;

  useEffect(() => {
    if (!liveData?.lastUpdated || isViewingHistory) return;
    setSecondsAgo(Math.floor((Date.now() - new Date(liveData.lastUpdated).getTime()) / 1000));
    const interval = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - new Date(liveData.lastUpdated).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [liveData?.lastUpdated, isViewingHistory]);

  // Auto-show history when no live round
  useEffect(() => {
    if (liveData && liveData.round === null) {
      setShowHistory(true);
    }
  }, [liveData]);

  const goBackToLive = () => {
    setViewingRoundId(null);
    setShowHistory(false);
  };

  // Filter out the live round from history list
  const historyRounds = historyData?.rounds.filter(
    (r) => !liveData?.round || r.id !== liveData.round.id
  ) ?? [];

  // Prev/next round navigation
  const currentHistIdx = historyRounds.findIndex((r) => r.id === viewingRoundId);
  const prevRound = currentHistIdx < historyRounds.length - 1 ? historyRounds[currentHistIdx + 1] : null;
  const nextRound = currentHistIdx > 0 ? historyRounds[currentHistIdx - 1] : null;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          {isViewingHistory ? (
            <>
              <button
                onClick={goBackToLive}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
              >
                <ChevronLeft className="w-3 h-3" />
                {liveData?.round ? 'Back to Live' : 'All Rounds'}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => prevRound && setViewingRoundId(prevRound.id)}
                  disabled={!prevRound}
                  className="p-1 rounded hover:bg-muted disabled:opacity-20 disabled:cursor-default"
                  aria-label="Previous round"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-center">
                  <h1 className="text-xl font-bold tracking-tight">
                    {currentRound ? formatRoundDate(currentRound.scheduledDate) : 'Round'}
                  </h1>
                  {currentRound && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {currentRound.type === 'casual' ? 'Practice' : 'Official'} · {currentRound.status}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => nextRound && setViewingRoundId(nextRound.id)}
                  disabled={!nextRound}
                  className="p-1 rounded hover:bg-muted disabled:opacity-20 disabled:cursor-default"
                  aria-label="Next round"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold tracking-tight">Live Leaderboard</h1>
              {liveData?.lastUpdated && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {liveFetching ? 'Updating…' : `Updated ${secondsAgo}s ago`}
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isViewingHistory && (
            <>
              <Link to="/admin" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Admin
              </Link>
              <Link to="/practice" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Practice
              </Link>
              <Button variant="ghost" size="sm" onClick={() => void liveRefetch()} className="gap-1 h-8 px-2">
                <RefreshCw className={`h-3.5 w-3.5 ${liveFetching ? 'animate-spin' : ''}`} />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Loading state */}
      {(liveLoading || (isViewingHistory && histRoundLoading)) && (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-14 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Error state */}
      {liveError && !liveLoading && !isViewingHistory && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load leaderboard — tap to retry</p>
          <Button variant="outline" onClick={() => void liveRefetch()}>Retry</Button>
        </div>
      )}

      {/* Historical round view */}
      {isViewingHistory && currentData && currentRound && (
        <>
          {(currentRound.status === 'finalized' || currentRound.status === 'completed') && (
            <HighlightReel roundId={currentRound.id} />
          )}
          {currentData.sideGame && (
            <div className="rounded-xl border bg-card p-3 mb-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Side Game</p>
              <p className="font-semibold">{currentData.sideGame.name}</p>
              <p className="text-sm text-muted-foreground">{currentData.sideGame.format}</p>
            </div>
          )}
          <LeaderboardTable
            data={currentData}
            roundId={currentRound.id}
            autoCalculateMoney={currentRound.autoCalculateMoney}
          />
        </>
      )}

      {/* Live round view */}
      {!isViewingHistory && liveData && currentRound && (
        <>
          {(currentRound.status === 'finalized' || currentRound.status === 'completed') && (
            <HighlightReel roundId={currentRound.id} />
          )}
          {liveData.sideGame && (
            <div className="rounded-xl border bg-card p-3 mb-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Side Game</p>
              <p className="font-semibold">{liveData.sideGame.name}</p>
              <p className="text-sm text-muted-foreground">{liveData.sideGame.format}</p>
            </div>
          )}
          <LeaderboardTable
            data={liveData}
            roundId={currentRound.id}
            autoCalculateMoney={currentRound.autoCalculateMoney}
          />
        </>
      )}

      {/* No live round + history list / Past rounds link */}
      {!isViewingHistory && liveData && liveData.round === null && (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <span className="text-5xl">⛳</span>
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

      {/* Past rounds button when live round is showing */}
      {!isViewingHistory && liveData && liveData.round !== null && !showHistory && (
        <button
          onClick={() => setShowHistory(true)}
          className="w-full mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
        >
          View Past Rounds
        </button>
      )}

      {/* History list */}
      {!isViewingHistory && showHistory && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Past Rounds</h2>
          {historyLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {historyRounds.length === 0 && !historyLoading && (
            <p className="text-sm text-muted-foreground text-center py-4">No past rounds yet</p>
          )}
          <div className="flex flex-col gap-1.5">
            {historyRounds.map((r) => (
              <button
                key={r.id}
                onClick={() => setViewingRoundId(r.id)}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm hover:bg-muted/30 transition-colors text-left"
              >
                <div>
                  <span className="font-medium">{formatRoundDate(r.scheduledDate)}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {r.type === 'casual' ? 'Practice' : 'Official'}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{r.playerCount} players</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: LeaderboardPage,
});
