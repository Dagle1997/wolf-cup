import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { AlertCircle, RefreshCw, ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Champion = {
  playerId: number;
  name: string;
  wins: number;
};

type Standing = {
  playerId: number;
  name: string;
  rank: number;
  points: number | null;
};

type HistorySeason = {
  id: number;
  name: string;
  year: number;
  champion: Champion | null;
  standings: Standing[];
};

type ChampionshipCount = {
  playerId: number;
  name: string;
  wins: number;
};

type AwardRecipient = {
  playerName: string;
  years: number[];
  detail: string;
};

type Award = {
  id: string;
  emoji: string;
  name: string;
  category: 'hall_of_fame' | 'superlatives';
  description: string;
  recipients: AwardRecipient[];
};

type HistoryResponse = {
  seasons: HistorySeason[];
  championshipCounts: ChampionshipCount[];
  awards: Award[];
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/standings_/history')({
  component: HistoryPage,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function fmt(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

// Build champion gallery entries: group seasons by champion, count wins, list years
function buildGallery(data: HistoryResponse): { playerId: number; name: string; wins: number; years: number[] }[] {
  const map = new Map<number, { name: string; years: number[] }>();
  for (const s of data.seasons) {
    if (!s.champion) continue;
    const existing = map.get(s.champion.playerId);
    if (existing) {
      existing.years.push(s.year);
    } else {
      map.set(s.champion.playerId, { name: s.champion.name, years: [s.year] });
    }
  }
  const entries = [...map.entries()].map(([playerId, { name, years }]) => ({
    playerId,
    name,
    wins: years.length,
    years: years.sort((a, b) => b - a),
  }));
  // Sort by most wins DESC, then most recent win DESC
  entries.sort((a, b) => b.wins - a.wins || b.years[0]! - a.years[0]!);
  return entries;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function HistoryPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['history'],
    queryFn: () => apiFetch<HistoryResponse>('/history'),
  });

  const gallery = data ? buildGallery(data) : [];

  const hallOfFame = data?.awards.filter((a) => a.category === 'hall_of_fame') ?? [];
  const superlatives = data?.awards.filter((a) => a.category === 'superlatives') ?? [];

  // Handle hash fragment navigation (TanStack Router doesn't auto-scroll)
  useEffect(() => {
    if (!data) return;
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      // Small delay to ensure DOM is rendered
      const timer = setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [data]);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* Back nav */}
      <Link to="/standings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="h-3.5 w-3.5" />
        Standings
      </Link>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold tracking-tight">Champions & History</h2>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching} className="h-8 px-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? `animate-spin` : ``}`} />
        </Button>
      </div>

      {isLoading && <LoadingSkeleton />}

      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load history — tap to retry</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          {data.seasons.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-5xl">🏆</span>
              <p className="text-muted-foreground">No historical data yet</p>
            </div>
          ) : (
            <>
              {/* Champions Gallery */}
              {gallery.length > 0 && (
                <section className="mb-6">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Champions</h3>
                  <div className="overflow-x-auto -mx-4 px-4">
                    <div className="flex gap-3">
                      {gallery.map((champ) => (
                        <ChampionCard key={champ.playerId} {...champ} />
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {/* Awards Wall */}
              {(hallOfFame.length > 0 || superlatives.length > 0) && (
                <section id="awards" className="mb-6">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Awards</h3>

                  {hallOfFame.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Hall of Fame</h4>
                      <div className="overflow-x-auto -mx-4 px-4">
                        <div className="flex gap-3">
                          {hallOfFame.map((award) => (
                            <AwardCard key={award.id} award={award} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {superlatives.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-2">Superlatives</h4>
                      <div className="overflow-x-auto -mx-4 px-4">
                        <div className="flex gap-3">
                          {superlatives.map((award) => (
                            <AwardCard key={award.id} award={award} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Season History */}
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Season History</h3>
                <div className="flex flex-col gap-3">
                  {data.seasons.map((s, i) => (
                    <SeasonCard key={s.id} season={s} defaultExpanded={i === 0} />
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ChampionCard({ name, wins, years }: { playerId: number; name: string; wins: number; years: number[] }) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="flex-shrink-0 w-36 rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Photo area / fallback */}
      <div className="h-24 bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center">
        {!imgFailed ? (
          <img
            src={`/champions/${years[0]}.jpg`}
            alt={name}
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 text-lg font-bold">
            {getInitials(name)}
          </span>
        )}
      </div>
      {/* Info */}
      <div className="px-3 py-2.5 text-center">
        <div className="flex items-center justify-center gap-1">
          {years.map((y) => (
            <span key={y} className="inline-flex flex-col items-center leading-none">
              <span className="text-lg">🏆</span>
              <span className="text-[8px] text-muted-foreground">{String(y).slice(2)}</span>
            </span>
          ))}
        </div>
        <div className="text-sm font-semibold mt-0.5">{name}</div>
      </div>
    </div>
  );
}

function AwardCard({ award }: { award: Award }) {
  return (
    <div id={`badge-${award.id}`} className="flex-shrink-0 w-40 rounded-xl border bg-card shadow-sm overflow-hidden p-3">
      <div className="text-3xl text-center mb-1">{award.emoji}</div>
      <div className="text-sm font-semibold text-center">{award.name}</div>
      <div className="text-[10px] text-muted-foreground text-center mt-1 mb-2">{award.description}</div>
      <div className="space-y-1.5">
        {award.recipients.map((r) => {
          const cashRecord = ['biggest_season_win', 'biggest_season_loss'].includes(award.id);
          const cashPerYear = ['money_man', 'philanthropist'].includes(award.id);
          const perSeason = ['ironman', 'dynasty', 'back_to_back', 'rickie_fowler', 'ph_balance', 'the_ronnie', 'snow_cone'];
          const showYearEmojis = !cashRecord && !cashPerYear && perSeason.includes(award.id);
          const cashLabels = cashPerYear ? r.detail.split(', ') : [];
          return (
            <div key={r.playerName} className="text-xs">
              <div className="font-medium">{r.playerName}</div>
              {cashRecord && (
                <div className="flex items-center justify-center gap-1 mt-0.5">
                  <span className="inline-flex flex-col items-center leading-none">
                    <span className="text-sm">{award.emoji}</span>
                    <span className="text-[8px] font-bold text-muted-foreground">{r.detail}</span>
                  </span>
                </div>
              )}
              {cashPerYear && (
                <div className="flex items-center gap-1 mt-0.5">
                  {r.years.map((y, i) => (
                    <span key={y} className="inline-flex flex-col items-center leading-none">
                      <span className="text-sm">{award.emoji}</span>
                      <span className="text-[8px] text-muted-foreground">{cashLabels[i] ?? String(y).slice(2)}</span>
                    </span>
                  ))}
                </div>
              )}
              {showYearEmojis && (
                <div className="flex items-center gap-1 mt-0.5">
                  {r.years.map((y) => (
                    <span key={y} className="inline-flex flex-col items-center leading-none">
                      <span className="text-sm">{award.emoji}</span>
                      <span className="text-[8px] text-muted-foreground">{String(y).slice(2)}</span>
                    </span>
                  ))}
                </div>
              )}
              {!cashRecord && !cashPerYear && <div className="text-[10px] text-muted-foreground">{r.detail}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeasonCard({ season, defaultExpanded }: { season: HistorySeason; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-base font-bold tabular-nums">{season.year}</span>
          {season.champion ? (
            <span className="text-sm">
              <span className="text-amber-600 mr-1">🏆</span>
              <span className="font-medium">{season.champion.name}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No champion data</span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t">
          {season.standings.length === 0 ? (
            <div className="px-4 py-4 text-center text-sm text-muted-foreground">
              {season.champion ? 'Champion only — no standings data' : 'No data available'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-[11px] text-muted-foreground">
                  <th className="py-1.5 pl-4 pr-2 text-center font-medium w-10">#</th>
                  <th className="py-1.5 px-2 text-left font-medium">Player</th>
                  <th className="py-1.5 px-4 text-right font-medium">Pts</th>
                </tr>
              </thead>
              <tbody>
                {season.standings.map((s) => (
                  <tr key={s.playerId} className="border-b last:border-0">
                    <td className="py-1.5 pl-4 pr-2 text-center tabular-nums text-muted-foreground text-xs">{s.rank}</td>
                    <td className="py-1.5 px-2 font-medium">{s.name}</td>
                    <td className="py-1.5 px-4 text-right tabular-nums">{s.points != null ? fmt(s.points) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 w-32 bg-muted rounded" />
      <div className="flex gap-3 overflow-hidden">
        {[1, 2, 3].map((i) => (
          <div key={i} className="w-36 h-44 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-6 w-32 bg-muted rounded" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-14 rounded-xl bg-muted" />
      ))}
    </div>
  );
}
