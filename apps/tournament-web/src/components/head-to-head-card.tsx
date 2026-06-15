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
      <table style={{ borderCollapse: 'collapse', fontSize: 'var(--font-sm)' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '2px 8px' }}>Hole</th>
            <th style={{ textAlign: 'right', padding: '2px 8px' }}>Par</th>
            <th style={{ textAlign: 'right', padding: '2px 8px' }}>{viewerLabel}</th>
            <th style={{ textAlign: 'right', padding: '2px 8px' }}>{opponentLabel}</th>
            <th style={{ textAlign: 'center', padding: '2px 8px' }}>Won</th>
            <th style={{ textAlign: 'right', padding: '2px 8px' }}>$</th>
            <th style={{ textAlign: 'right', padding: '2px 8px' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {perHole.map((h) => {
            running += h.moneyToViewerCents;
            const wonMark =
              h.winner === 'viewer' ? '✓' : h.winner === 'opponent' ? '✗' : h.winner === 'halved' ? '–' : '';
            return (
              <tr key={h.holeNumber}>
                <td style={{ padding: '2px 8px' }}>{h.holeNumber}</td>
                <td style={{ textAlign: 'right', padding: '2px 8px' }}>{h.par}</td>
                <td style={{ textAlign: 'right', padding: '2px 8px' }}>
                  {score(h.viewerGross, h.viewerNet)}
                </td>
                <td style={{ textAlign: 'right', padding: '2px 8px' }}>
                  {showOpponentScore ? score(h.oppGross, h.oppNet) : h.oppNet ?? '—'}
                </td>
                <td style={{ textAlign: 'center', padding: '2px 8px' }}>{wonMark}</td>
                <td style={{ textAlign: 'right', padding: '2px 8px', color: moneyColor(h.moneyToViewerCents) }}>
                  {h.moneyToViewerCents === 0 ? '—' : formatCents(h.moneyToViewerCents)}
                </td>
                <td style={{ textAlign: 'right', padding: '2px 8px', color: moneyColor(running) }}>
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
