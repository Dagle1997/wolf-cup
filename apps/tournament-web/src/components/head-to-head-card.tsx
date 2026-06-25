/**
 * T13-5 hole-by-hole "card" for a single game (a side match or the foursome
 * team match), from the viewer's perspective. Renders each hole's gross/net for
 * both sides, who won the hole, the money won/lost, and a running total.
 *
 * Shared by the My Money board (per-game expansion) and the Foursome results
 * view. Pure presentational — money already viewer-signed by the API.
 */
import { formatCents } from '../lib/format-cents';
import { ScrollableTable } from './scrollable-table';

export type CardHole = {
  holeNumber: number;
  par: number;
  viewerGross: number | null;
  viewerNet: number | null;
  oppGross: number | null;
  oppNet: number | null;
  winner: 'viewer' | 'opponent' | 'halved' | null;
  moneyToViewerCents: number;
};

function moneyColor(cents: number): string | undefined {
  if (cents > 0) return 'var(--color-success, var(--color-brand-primary))';
  if (cents < 0) return 'var(--color-danger, #dc2626)';
  return undefined;
}

/** "4 (4)" → gross with net in parens; "—" when unscored. */
function score(gross: number | null, net: number | null): string {
  if (gross === null) return '—';
  return net !== null && net !== gross ? `${gross} (${net})` : `${gross}`;
}

export type HeadToHeadCardProps = {
  /** Label for the viewer column (e.g. "You"). */
  viewerLabel?: string;
  /** Label for the opposing column (opponent name, or "Other team"). */
  opponentLabel: string;
  /** Whether the opposing side has individual gross (false for the team game). */
  showOpponentScore?: boolean;
  perHole: CardHole[];
};

export function HeadToHeadCard({
  viewerLabel = 'You',
  opponentLabel,
  showOpponentScore = true,
  perHole,
}: HeadToHeadCardProps) {
  let running = 0;
  return (
    <ScrollableTable label={`Hole-by-hole vs ${opponentLabel}`}>
      {/* Scoped, phone-first compaction: tight padding, and hide the Par
          column on narrow screens (its info is low-value next to net score). */}
      <style>{H2H_STYLE}</style>
      <table className="h2h-card" style={{ borderCollapse: 'collapse', fontSize: 'var(--font-xs)', width: '100%' }}>
        <thead>
          <tr>
            <th className="h2h-l">Hole</th>
            <th className="h2h-r h2h-par">Par</th>
            <th className="h2h-r">{viewerLabel}</th>
            <th className="h2h-r">{opponentLabel}</th>
            <th className="h2h-c">Won</th>
            <th className="h2h-r h2h-money">$</th>
            <th className="h2h-r h2h-money">Total</th>
          </tr>
        </thead>
        <tbody>
          {perHole.map((h) => {
            running += h.moneyToViewerCents;
            const wonMark =
              h.winner === 'viewer' ? '✓' : h.winner === 'opponent' ? '✗' : h.winner === 'halved' ? '–' : '';
            return (
              <tr key={h.holeNumber}>
                <td className="h2h-l">{h.holeNumber}</td>
                <td className="h2h-r h2h-par">{h.par}</td>
                <td className="h2h-r">{score(h.viewerGross, h.viewerNet)}</td>
                <td className="h2h-r">
                  {showOpponentScore ? score(h.oppGross, h.oppNet) : h.oppNet ?? '—'}
                </td>
                <td className="h2h-c">{wonMark}</td>
                <td className="h2h-r h2h-money" style={{ color: moneyColor(h.moneyToViewerCents) }}>
                  {h.moneyToViewerCents === 0 ? '—' : formatCents(h.moneyToViewerCents)}
                </td>
                <td className="h2h-r h2h-money" style={{ color: moneyColor(running) }}>
                  {formatCents(running)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollableTable>
  );
}

/**
 * Phone-first table styling. Tight 1px/4px cell padding so 7 columns read at
 * 390px; money columns never wrap; the Par column collapses below 360px where
 * horizontal room is tightest (par is the least-needed column when net score is
 * already shown). Font floor honored (--font-xs = 12px).
 */
const H2H_STYLE = `
.h2h-card th, .h2h-card td { padding: 2px 4px; }
.h2h-card .h2h-l { text-align: left; }
.h2h-card .h2h-r { text-align: right; }
.h2h-card .h2h-c { text-align: center; }
.h2h-card .h2h-money { white-space: nowrap; font-variant-numeric: tabular-nums; }
@media (max-width: 359px) {
  .h2h-card .h2h-par { display: none; }
}
`;
