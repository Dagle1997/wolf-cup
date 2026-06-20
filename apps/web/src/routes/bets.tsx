import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Dice5, Trophy } from 'lucide-react';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types (mirror services/bets.ts BetsBoard)
// ---------------------------------------------------------------------------
type Person = { id: number; name: string };
type OddsMarket = 'stableford' | 'money' | 'perfect_day';
type Outcome = {
  status: 'live' | 'settled' | 'push';
  winningSide: 'A' | 'B' | null;
  payout: number;
  subjectAScore: number | null;
  subjectBScore: number | null;
  holesWon: { a: number; b: number } | null;
};
type Bet = {
  id: number;
  betType: 'h2h' | 'over_under' | 'per_hole' | 'odds_win';
  basis: 'net' | 'gross';
  amountDollars: number;
  line: number | null;
  oddsMarket: OddsMarket | null;
  odds: number | null;
  note: string | null;
  subjectA: Person;
  subjectB: Person | null;
  sideA: Person;
  sideB: Person | null; // null = The House (odds_win vs the book)
  outcome: Outcome;
};

const MARKET_LABEL: Record<OddsMarket, string> = {
  stableford: 'wins Stableford',
  money: 'wins money',
  perfect_day: 'a perfect day',
};
const fmtOdds = (n: number) => (n > 0 ? `+${n}` : `${n}`);
type SettleUp = { fromPlayerId: number; fromName: string; toPlayerId: number; toName: string; amount: number };
type Board = {
  round: { id: number; status: string; scheduledDate: string } | null;
  bets: Bet[];
  settleUp: SettleUp[]; // pairwise: `from` pays `to` `amount`
};

function money(n: number): string {
  if (n > 0) return `+$${n}`;
  if (n < 0) return `−$${Math.abs(n)}`;
  return '$0';
}

/** "YYYY-MM-DD" → "Fri, Jun 19" (round dates are calendar dates, parse as local). */
function formatRoundDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function basisLabel(b: Bet): string {
  return b.basis === 'gross' ? 'gross' : 'net';
}

/** The bet phrased from one stakeholder's side. */
function describeForSide(b: Bet, side: 'A' | 'B'): string {
  if (b.betType === 'odds_win') {
    const market = b.oddsMarket ? MARKET_LABEL[b.oddsMarket] : 'wins';
    const price = b.odds != null ? ` @ ${fmtOdds(b.odds)}` : '';
    // side A = bettor (backs the player to hit the market); side B = layer (fades it).
    return side === 'A'
      ? `${b.subjectA.name} — ${market}${price}`
      : `fades ${b.subjectA.name} — ${market}${price}`;
  }
  if (b.betType === 'over_under') {
    return side === 'A'
      ? `${b.subjectA.name} under ${b.line} (${basisLabel(b)})`
      : `${b.subjectA.name} over ${b.line} (${basisLabel(b)})`;
  }
  if (b.betType === 'per_hole') {
    const me = side === 'A' ? b.subjectA.name : b.subjectB?.name;
    const them = side === 'A' ? b.subjectB?.name : b.subjectA.name;
    return `${me} vs ${them} — $${b.amountDollars}/hole (${basisLabel(b)})`;
  }
  // h2h
  return side === 'A'
    ? `${b.subjectA.name} beats ${b.subjectB?.name} (${basisLabel(b)})`
    : `${b.subjectB?.name} beats ${b.subjectA.name} (${basisLabel(b)})`;
}

function stakeLabel(b: Bet): string {
  if (b.betType === 'per_hole') return `$${b.amountDollars}/hole`;
  if (b.betType === 'odds_win') return `$${b.amountDollars}${b.odds != null ? ` @ ${fmtOdds(b.odds)}` : ''}`;
  return `$${b.amountDollars}`;
}

type RosterEntry = { bet: Bet; side: 'A' | 'B'; opponent: Person };
type RosterPerson = { id: number; name: string; entries: RosterEntry[]; net: number };

const HOUSE: Person = { id: -1, name: 'The House' };

function buildRoster(board: Board): RosterPerson[] {
  const byId = new Map<number, RosterPerson>();
  const ensure = (p: Person): RosterPerson => {
    let r = byId.get(p.id);
    if (!r) {
      r = { id: p.id, name: p.name, entries: [], net: 0 };
      byId.set(p.id, r);
    }
    return r;
  };
  for (const b of board.bets) {
    // The House (null side B) gets no roster card; the bettor's card shows "vs The House".
    ensure(b.sideA).entries.push({ bet: b, side: 'A', opponent: b.sideB ?? HOUSE });
    if (b.sideB) ensure(b.sideB).entries.push({ bet: b, side: 'B', opponent: b.sideA });
  }
  // Per-person net = their own settled outcomes (overall up/down this week). The
  // actionable "who pays whom" is the pairwise settleUp list, not this aggregate.
  for (const r of byId.values()) {
    r.net = r.entries.reduce((sum, e) => {
      const o = e.bet.outcome;
      if (o.status !== 'settled') return sum;
      return sum + (o.winningSide === e.side ? o.payout : -o.payout);
    }, 0);
  }
  return [...byId.values()].sort((a, z) => z.net - a.net || a.name.localeCompare(z.name));
}

function ResultChip({ entry }: { entry: RosterEntry }) {
  const { bet, side } = entry;
  const o = bet.outcome;
  if (o.status === 'live') {
    return <span className="text-[11px] font-medium text-amber-500">live</span>;
  }
  if (o.status === 'push') {
    return <span className="text-[11px] font-medium text-muted-foreground">push</span>;
  }
  const won = o.winningSide === side;
  const amount = won ? o.payout : -o.payout;
  return (
    <span className={`text-[11px] font-bold ${won ? 'text-green-600' : 'text-red-500'}`}>
      {won ? 'won' : 'lost'} {money(amount)}
    </span>
  );
}

function GalleryError() {
  return <div className="text-center py-8 text-muted-foreground">Could not load the action.</div>;
}

function BetsPage() {
  // `?round=N` views a past round's bets + results (from that round's scouting
  // panel); absent → the live/active round's board.
  const { round } = Route.useSearch();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bets', round ?? 'live'],
    queryFn: () => apiFetch<Board>(round != null ? `/bets?roundId=${round}` : '/bets'),
  });

  // A FINISHED round shows its date + past framing; a live/upcoming round keeps
  // "for the week". Keyed on round status (not the ?round param) so opening The
  // Action on the live board still reads as the current week even though the
  // link carries the live round id for correct scoping.
  const r = data?.round ?? null;
  const isPastRound = r ? r.status === 'finalized' || r.status === 'completed' : false;
  const roundDate = r ? formatRoundDate(r.scheduledDate) : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4">
        <Link
          to="/"
          // Only carry the round back for a PAST round (so the leaderboard
          // restores it). For the live/upcoming round, omit it so the board
          // returns to its live, auto-polling view rather than history mode.
          search={isPastRound && round != null ? { scouting: true, round } : { scouting: true }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          <ChevronLeft className="h-3 w-3" />
          Scouting
        </Link>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <Dice5 className="h-5 w-5" />
          The Action
        </h1>
        <p className="text-xs text-muted-foreground">
          {isPastRound && roundDate
            ? `${roundDate} — side bets, auto-settled from scores.`
            : 'Side bets for the week — auto-settled from scores.'}
        </p>
      </div>

      {/* Season record link */}
      <Link
        to="/bets/history"
        className="mb-4 flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-sm hover:bg-muted/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Season Record</span>
          <span className="text-[11px] text-muted-foreground">— who's up & down</span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}
      {isError && <GalleryError />}

      {data && (data.bets.length === 0 || !data.round) && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Dice5 className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">
            {isPastRound ? 'No bets were on the board for this round' : 'No bets on the board yet'}
          </p>
          <p className="text-xs text-muted-foreground/60">
            {isPastRound ? 'Nothing was wagered here.' : "The admin adds this week's action."}
          </p>
        </div>
      )}

      {data && data.bets.length > 0 && (
        <div className="space-y-4">
          {/* Settle-up — pairwise "who pays whom" (settled bets only). Each row is
              one real payment; bets only net against the SAME counterparty. */}
          {data.settleUp.length > 0 && (
            <div className="rounded-xl border bg-card p-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                Week settle-up
              </div>
              <ul className="space-y-1 text-sm">
                {data.settleUp.map((s) => (
                  <li key={`${s.fromPlayerId}-${s.toPlayerId}`} className="flex items-center justify-between gap-3">
                    <span>
                      <span className="font-semibold">{s.fromName}</span>
                      <span className="text-muted-foreground"> pays </span>
                      <span className="font-semibold">{s.toName}</span>
                    </span>
                    <span className="font-bold tabular-nums">${s.amount}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-person roster */}
          {buildRoster(data).map((person) => (
            <div key={person.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold">{person.name}</h2>
                {person.net !== 0 && (
                  <span className={`text-sm font-bold tabular-nums ${person.net > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {money(person.net)}
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {person.entries.map((e, i) => (
                  <li key={`${e.bet.id}-${i}`} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{describeForSide(e.bet, e.side)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {stakeLabel(e.bet)} · vs {e.opponent.name}
                        {e.bet.note ? ` · ${e.bet.note}` : ''}
                      </div>
                    </div>
                    <ResultChip entry={e} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/bets')({
  // `?round=N` scopes the board to a past round (reached from that round's
  // scouting panel). Absent/invalid → the live/active round.
  validateSearch: (search: Record<string, unknown>): { round?: number } => {
    const raw = search['round'];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? { round: n } : {};
  },
  component: BetsPage,
});
