import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, AlertCircle, ChevronDown, MapPin, Crown, TrendingUp, TrendingDown, Minus, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sparkline } from '@/components/sparkline';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StandingsPlayer = {
  playerId: number;
  name: string;
  roundsPlayed: number;
  roundsDropped: number;
  stablefordTotal: number;
  moneyTotal: number;
  combinedTotal: number;
  avgPerRound: number;
  lowRound: number;
  highRound: number;
  rank: number;
  rankPrevious: number | null;
  isPlayoffEligible: boolean;
  roundTotals: number[];
};

type StandingsResponse = {
  season: {
    id: number;
    name: string;
    totalRounds: number;
    roundsCompleted: number;
    nextRoundDate: string | null;
  } | null;
  fullMembers: StandingsPlayer[];
  subs: StandingsPlayer[];
  lastUpdated: string;
};

type PairingPair = {
  playerAId: number;
  playerAName: string;
  playerBId: number;
  playerBName: string;
  count: number;
};

type PairingHistoryResponse = {
  season: { id: number; name: string; year: number } | null;
  pairs: PairingPair[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLAYOFF_CUT = 8;
const BUBBLE_THRESHOLD = 10; // show bubble warning when within 10 pts of cut
const PIN_KEY = 'wolf-cup:pinned-player-id';

function fmt(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

function formatNextRound(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getPinned(): number | null {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function setPinned(playerId: number | null): void {
  try {
    if (playerId === null) localStorage.removeItem(PIN_KEY);
    else localStorage.setItem(PIN_KEY, String(playerId));
  } catch {
    // ignore storage errors
  }
}

function getPlayerPairings(playerId: number, pairs: PairingPair[]): { name: string; count: number }[] {
  const partners: { name: string; count: number }[] = [];
  for (const p of pairs) {
    if (p.playerAId === playerId) partners.push({ name: p.playerBName, count: p.count });
    else if (p.playerBId === playerId) partners.push({ name: p.playerAName, count: p.count });
  }
  partners.sort((a, b) => b.count - a.count);
  return partners;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/standings')({
  component: StandingsPage,
});

function StandingsPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['standings'],
    queryFn: () => apiFetch<StandingsResponse>('/standings'),
  });

  const { data: pairingData } = useQuery({
    queryKey: ['pairing-history'],
    queryFn: () => apiFetch<PairingHistoryResponse>('/pairings/history'),
    staleTime: 60_000,
  });

  const [pinnedId, setPinnedIdState] = useState<number | null>(null);
  useEffect(() => {
    setPinnedIdState(getPinned());
  }, []);

  const togglePin = (playerId: number) => {
    const next = pinnedId === playerId ? null : playerId;
    setPinned(next);
    setPinnedIdState(next);
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <Link
        to="/standings/history"
        className="flex items-center justify-between px-4 py-2 mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 group"
      >
        <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          🏆 Champions & History
        </span>
        <span className="text-xs text-amber-600 dark:text-amber-400 group-hover:translate-x-0.5 transition-transform">→</span>
      </Link>

      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {data?.season ? `${data.season.name}` : 'Season Standings'}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Best 10 rounds count</p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/odds"
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2"
          >
            Odds
          </Link>
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching} className="h-8 px-2">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {isLoading && <LoadingSkeleton />}

      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load standings — tap to retry</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && data.season && (
        <>
          <SeasonHero season={data.season} />

          {data.fullMembers.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-5xl">🏆</span>
              <p className="text-muted-foreground">No standings yet — play some rounds!</p>
            </div>
          ) : (
            <>
              <LeaderSpotlight
                players={data.fullMembers}
                pairs={pairingData?.pairs ?? []}
                pinnedId={pinnedId}
                onTogglePin={togglePin}
              />
              <StandingsList
                players={data.fullMembers.filter((p) => p.rank !== 1)}
                leader={data.fullMembers.find((p) => p.rank === 1) ?? null}
                pairs={pairingData?.pairs ?? []}
                pinnedId={pinnedId}
                onTogglePin={togglePin}
                showPlayoffCut
              />
              {data.subs.length > 0 && (
                <SubsSection
                  subs={data.subs}
                  pairs={pairingData?.pairs ?? []}
                  pinnedId={pinnedId}
                  onTogglePin={togglePin}
                />
              )}
            </>
          )}
        </>
      )}

      {!isLoading && !isError && data && data.season === null && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="text-5xl">📊</span>
          <p className="text-muted-foreground">No season data available</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeasonHero — progress bar + next round date
// ---------------------------------------------------------------------------

function SeasonHero({ season }: { season: NonNullable<StandingsResponse['season']> }) {
  const pct = season.totalRounds > 0 ? Math.round((season.roundsCompleted / season.totalRounds) * 100) : 0;
  const remaining = Math.max(season.totalRounds - season.roundsCompleted, 0);
  const nextLabel = formatNextRound(season.nextRoundDate);
  return (
    <div className="rounded-xl border bg-card p-3 mb-3">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Season Progress</div>
          <div className="text-xl font-bold tabular-nums leading-tight">
            {season.roundsCompleted}<span className="text-sm font-normal text-muted-foreground"> / {season.totalRounds}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Remaining</div>
          <div className="text-sm font-semibold tabular-nums">{remaining} rds</div>
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {nextLabel && (
        <div className="text-[11px] text-muted-foreground mt-2">
          Next round: <span className="font-semibold text-foreground">{nextLabel}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LeaderSpotlight — gold card for rank 1, also serves as their expandable row
// ---------------------------------------------------------------------------

function LeaderSpotlight({
  players,
  pairs,
  pinnedId,
  onTogglePin,
}: {
  players: StandingsPlayer[];
  pairs: PairingPair[];
  pinnedId: number | null;
  onTogglePin: (id: number) => void;
}) {
  const leader = players.find((p) => p.rank === 1);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isPinned = leader !== undefined && pinnedId === leader.playerId;

  useEffect(() => {
    if (isPinned && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isPinned]);

  if (!leader) return null;
  const second = players.find((p) => p.rank === 2);
  const lead = second ? leader.combinedTotal - second.combinedTotal : 0;
  const partners = expanded ? getPlayerPairings(leader.playerId, pairs) : [];

  return (
    <div
      ref={ref}
      onClick={() => setExpanded((v) => !v)}
      className={`relative rounded-xl border bg-gradient-to-br from-amber-100 via-amber-50 to-yellow-50 dark:from-amber-950/40 dark:via-amber-950/20 dark:to-yellow-950/20 p-3 mb-3 overflow-hidden cursor-pointer transition-all ${
        isPinned ? 'border-blue-400 ring-2 ring-blue-400/30' : 'border-amber-300 dark:border-amber-700/60'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center shadow-sm">
            <Crown className="h-5 w-5 text-amber-900" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">Season Leader</div>
            <div className="text-base font-bold truncate">{leader.name}</div>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTogglePin(leader.playerId); }}
            aria-label={isPinned ? 'Unpin this is me' : 'Pin this is me'}
            className={`flex-shrink-0 p-1 rounded-md transition-colors ${
              isPinned
                ? 'text-blue-500 bg-blue-100 dark:bg-blue-950/40'
                : 'text-amber-700/40 hover:text-amber-700 hover:bg-amber-200/40'
            }`}
          >
            <MapPin className={`h-3.5 w-3.5 ${isPinned ? 'fill-blue-500' : ''}`} />
          </button>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-2xl font-black tabular-nums text-amber-900 dark:text-amber-200 leading-none">{fmt(leader.combinedTotal)}</div>
          {second && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold mt-0.5 tabular-nums">+{fmt(lead)} over 2nd</div>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-amber-300/50 dark:border-amber-700/40 space-y-2">
          <div className="grid grid-cols-4 gap-2 text-center">
            <DetailStat label="Avg" value={fmt(leader.avgPerRound)} />
            <DetailStat label="Low" value={leader.roundsPlayed > 0 ? fmt(leader.lowRound) : '—'} />
            <DetailStat label="High" value={leader.roundsPlayed > 0 ? fmt(leader.highRound) : '—'} />
            <DetailStat label="Stab/$" value={`${fmt(leader.stablefordTotal)}/${fmt(leader.moneyTotal)}`} />
          </div>
          <div className="text-[11px] text-amber-700/80 dark:text-amber-400/80 tabular-nums">
            {leader.roundsPlayed} rd{leader.roundsPlayed === 1 ? '' : 's'}
            {leader.roundsDropped > 0 && <span> · {leader.roundsDropped} dropped</span>}
          </div>
          {partners.length > 0 && (
            <div>
              <div className="text-[9px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest mb-1.5">Paired With</div>
              <div className="flex flex-wrap gap-1">
                {partners.map((p) => (
                  <span
                    key={p.name}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      p.count >= 3
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        : p.count === 2
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                          : 'bg-white/60 dark:bg-black/20 text-foreground'
                    }`}
                  >
                    {p.name} <span className="font-bold">{p.count}x</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StandingsList — full-member cards with playoff cut divider
// ---------------------------------------------------------------------------

function StandingsList({
  players,
  leader,
  pairs,
  pinnedId,
  onTogglePin,
  showPlayoffCut,
}: {
  players: StandingsPlayer[];
  leader: StandingsPlayer | null;
  pairs: PairingPair[];
  pinnedId: number | null;
  onTogglePin: (id: number) => void;
  showPlayoffCut: boolean;
}) {
  const sorted = [...players].sort((a, b) => a.rank - b.rank);
  const rank8Total = (leader?.rank === PLAYOFF_CUT ? leader.combinedTotal : null)
    ?? sorted.find((p) => p.rank === PLAYOFF_CUT)?.combinedTotal
    ?? null;

  return (
    <div className="space-y-1.5">
      {sorted.map((player, i) => {
        // For rank 2, the person ahead is the leader (rendered separately above)
        const prev = i === 0 ? leader : sorted[i - 1] ?? null;
        const gap = prev ? prev.combinedTotal - player.combinedTotal : 0;
        const gapToCut = rank8Total !== null ? player.combinedTotal - rank8Total : null;
        // Bubble = close in BOTH rank position (5–11) and points (within threshold).
        // Excludes safely-top-4 and far-behind ranks so the chip stays meaningful.
        const rankDistanceToCut = Math.abs(player.rank - PLAYOFF_CUT);
        const isBubble =
          showPlayoffCut &&
          gapToCut !== null &&
          rankDistanceToCut <= 3 &&
          Math.abs(gapToCut) <= BUBBLE_THRESHOLD;
        const showCutDivider =
          showPlayoffCut && i > 0 && sorted[i - 1]!.rank <= PLAYOFF_CUT && player.rank > PLAYOFF_CUT;
        return (
          <div key={player.playerId}>
            {showCutDivider && <PlayoffCutDivider />}
            <PlayerCard
              player={player}
              prev={prev}
              gap={gap}
              isBubble={isBubble}
              pairs={pairs}
              isPinned={pinnedId === player.playerId}
              onTogglePin={() => onTogglePin(player.playerId)}
              desaturate={false}
            />
          </div>
        );
      })}
    </div>
  );
}

function PlayoffCutDivider() {
  return (
    <div className="flex items-center gap-3 my-3 px-1">
      <div className="flex-1 border-t-2 border-dashed border-red-300 dark:border-red-800" />
      <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-widest">Playoff Cut — Top {PLAYOFF_CUT}</span>
      <div className="flex-1 border-t-2 border-dashed border-red-300 dark:border-red-800" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SubsSection — collapsed by default
// ---------------------------------------------------------------------------

function SubsSection({
  subs,
  pairs,
  pinnedId,
  onTogglePin,
}: {
  subs: StandingsPlayer[];
  pairs: PairingPair[];
  pinnedId: number | null;
  onTogglePin: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors"
      >
        <span className="text-sm font-semibold text-muted-foreground">
          Substitutes ({subs.length})
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-1.5 mt-2 opacity-80">
          {[...subs].sort((a, b) => a.rank - b.rank).map((player, i, arr) => {
            const prev = i > 0 ? arr[i - 1] : null;
            const gap = prev ? prev.combinedTotal - player.combinedTotal : 0;
            return (
              <PlayerCard
                key={player.playerId}
                player={player}
                prev={prev}
                gap={gap}
                isBubble={false}
                pairs={pairs}
                isPinned={pinnedId === player.playerId}
                onTogglePin={() => onTogglePin(player.playerId)}
                desaturate
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlayerCard — one row in the standings list
// ---------------------------------------------------------------------------

function PlayerCard({
  player,
  prev,
  gap,
  isBubble,
  pairs,
  isPinned,
  onTogglePin,
  desaturate,
}: {
  player: StandingsPlayer;
  prev: StandingsPlayer | null;
  gap: number;
  isBubble: boolean;
  pairs: PairingPair[];
  isPinned: boolean;
  onTogglePin: () => void;
  desaturate: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isPinned && ref.current) {
      // Auto-scroll pinned card into view on mount / after pin change
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isPinned]);

  const partners = expanded ? getPlayerPairings(player.playerId, pairs) : [];

  // Delta chip: rank vs rankPrevious
  let delta: { kind: 'up' | 'down' | 'flat' | 'new'; value: number } = { kind: 'flat', value: 0 };
  if (player.rankPrevious === null) {
    delta = { kind: 'new', value: 0 };
  } else if (player.rank < player.rankPrevious) {
    delta = { kind: 'up', value: player.rankPrevious - player.rank };
  } else if (player.rank > player.rankPrevious) {
    delta = { kind: 'down', value: player.rank - player.rankPrevious };
  }

  // Gap-to-next-up label
  const gapLabel = prev === null
    ? '👑 Leader'
    : gap === 0
      ? `= with ${firstName(prev.name)}`
      : `−${fmt(gap)} to ${firstName(prev.name)}`;

  const cardTone = desaturate
    ? 'bg-card/60'
    : player.rank === 1
      ? 'bg-gradient-to-r from-amber-50 to-transparent dark:from-amber-950/20'
      : player.isPlayoffEligible
        ? 'bg-green-50/40 dark:bg-green-950/10'
        : 'bg-card';

  const borderTone = isPinned
    ? 'border-blue-400 ring-2 ring-blue-400/30'
    : player.rank === 1
      ? 'border-amber-300 dark:border-amber-700/60'
      : player.isPlayoffEligible
        ? 'border-green-200 dark:border-green-900/50'
        : 'border-border';

  return (
    <div
      ref={ref}
      onClick={() => setExpanded((v) => !v)}
      className={`rounded-xl border px-3 py-2.5 transition-all cursor-pointer ${cardTone} ${borderTone}`}
    >
      {/* Top row: rank pill · name · total */}
      <div className="flex items-center gap-2">
        <RankPill rank={player.rank} isPlayoffEligible={player.isPlayoffEligible} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-base truncate">{player.name}</span>
            {isBubble && (
              <span className="text-[9px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0">
                ⚠ Bubble
              </span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
              aria-label={isPinned ? 'Unpin this is me' : 'Pin this is me'}
              className={`ml-auto flex-shrink-0 p-1 rounded-md transition-colors ${
                isPinned
                  ? 'text-blue-500 bg-blue-100 dark:bg-blue-950/40'
                  : 'text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted'
              }`}
            >
              <MapPin className={`h-3.5 w-3.5 ${isPinned ? 'fill-blue-500' : ''}`} />
            </button>
          </div>
        </div>
        <div className="text-right tabular-nums flex-shrink-0">
          <div className="text-lg font-black leading-none">{fmt(player.combinedTotal)}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5">Total</div>
        </div>
      </div>

      {/* Second row: delta · gap-to-next · sparkline · rounds */}
      <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
        <DeltaChip delta={delta} />
        <span className="tabular-nums truncate">{gapLabel}</span>
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {player.roundTotals.length >= 2 && (
            <Sparkline data={player.roundTotals} width={48} height={14} color="#8b5cf6" />
          )}
          <span className="tabular-nums text-muted-foreground/80">
            {player.roundsPlayed} rd{player.roundsPlayed === 1 ? '' : 's'}
            {player.roundsDropped > 0 && (
              <span className="text-amber-600 dark:text-amber-400 ml-0.5">(-{player.roundsDropped})</span>
            )}
          </span>
        </div>
      </div>

      {/* Expanded detail grid */}
      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <div className="grid grid-cols-4 gap-2 text-center">
            <DetailStat label="Avg" value={fmt(player.avgPerRound)} />
            <DetailStat label="Low" value={player.roundsPlayed > 0 ? fmt(player.lowRound) : '—'} />
            <DetailStat label="High" value={player.roundsPlayed > 0 ? fmt(player.highRound) : '—'} />
            <DetailStat label="Stab/$" value={`${fmt(player.stablefordTotal)}/${fmt(player.moneyTotal)}`} />
          </div>
          {partners.length > 0 && (
            <div>
              <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Paired With</div>
              <div className="flex flex-wrap gap-1">
                {partners.map((p) => (
                  <span
                    key={p.name}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      p.count >= 3
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                        : p.count === 2
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                          : 'bg-muted text-foreground'
                    }`}
                  >
                    {p.name} <span className="font-bold">{p.count}x</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RankPill({ rank, isPlayoffEligible }: { rank: number; isPlayoffEligible: boolean }) {
  if (rank === 1) {
    return (
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-400 text-amber-900 flex items-center justify-center font-black text-sm shadow-sm">
        🏆
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-300 dark:bg-slate-500 text-slate-700 dark:text-slate-100 flex items-center justify-center font-black text-sm">
        2
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-400 text-orange-900 flex items-center justify-center font-black text-sm">
        3
      </div>
    );
  }
  if (isPlayoffEligible) {
    return (
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-400 flex items-center justify-center font-bold text-sm relative">
        {rank}
        <span className="absolute -bottom-0.5 -right-0.5 text-[8px] bg-green-500 text-white rounded-full w-3 h-3 flex items-center justify-center font-black">✓</span>
      </div>
    );
  }
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center font-semibold text-sm">
      {rank}
    </div>
  );
}

function DeltaChip({ delta }: { delta: { kind: 'up' | 'down' | 'flat' | 'new'; value: number } }) {
  if (delta.kind === 'up') {
    return (
      <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400 font-bold tabular-nums">
        <TrendingUp className="h-3 w-3" />{delta.value}
      </span>
    );
  }
  if (delta.kind === 'down') {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 font-bold tabular-nums">
        <TrendingDown className="h-3 w-3" />{delta.value}
      </span>
    );
  }
  if (delta.kind === 'new') {
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground/60" title="New on the board this round">
        <Circle className="h-2.5 w-2.5 fill-current" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-muted-foreground/50" title="No change from last round">
      <Minus className="h-3 w-3" />
    </span>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-16 rounded-xl bg-muted/50" />
      <div className="h-16 rounded-xl bg-muted/50" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-14 rounded-xl bg-muted/30" />
      ))}
    </div>
  );
}
