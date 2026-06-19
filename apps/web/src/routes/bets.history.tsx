import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Trophy } from 'lucide-react';
import { apiFetch } from '@/lib/api';

// Mirrors services/bets.ts SeasonBetHistory.
type Person = { playerId: number; name: string; net: number };
type History = {
  season: { id: number; name: string } | null;
  people: Person[];
  pendingCount: number;
};

function money(n: number): string {
  if (n > 0) return `+$${n}`;
  if (n < 0) return `−$${Math.abs(n)}`;
  return '$0';
}

function HistoryPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bets-history'],
    queryFn: () => apiFetch<History>('/bets/history'),
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4">
        <Link
          to="/bets"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          <ChevronLeft className="h-3 w-3" />
          The Action
        </Link>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Season Record
        </h1>
        <p className="text-xs text-muted-foreground">
          Net up / down across every settled bet{data?.season ? ` · ${data.season.name}` : ''}.
        </p>
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}
      {isError && <div className="text-center py-8 text-muted-foreground">Could not load the record.</div>}

      {data && data.people.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Trophy className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">No settled bets yet this season</p>
          {data.pendingCount > 0 && (
            <p className="text-xs text-muted-foreground/60">
              {data.pendingCount} bet{data.pendingCount === 1 ? '' : 's'} still in play.
            </p>
          )}
        </div>
      )}

      {data && data.people.length > 0 && (
        <div className="space-y-3">
          <div className="rounded-xl border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/60 text-muted-foreground text-[11px]">
                  <th className="text-center py-2 pl-2 pr-1 w-10">#</th>
                  <th className="text-left py-2 pr-2">Player</th>
                  <th className="text-right py-2 pr-3 w-20">Net</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p, i) => (
                  <tr key={p.playerId} className="border-b last:border-0">
                    <td className="py-2.5 pl-2 pr-1 text-center text-muted-foreground font-medium">{i + 1}</td>
                    <td className="py-2.5 pr-2 font-semibold">{p.name}</td>
                    <td
                      className={`py-2.5 pr-3 text-right tabular-nums font-bold ${
                        p.net > 0 ? 'text-green-600' : p.net < 0 ? 'text-red-500' : 'text-muted-foreground'
                      }`}
                    >
                      {money(p.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.pendingCount > 0 && (
            <p className="text-[11px] text-muted-foreground text-center">
              {data.pendingCount} bet{data.pendingCount === 1 ? '' : 's'} still in play — not counted until the round finalizes.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/bets/history')({
  component: HistoryPage,
});
