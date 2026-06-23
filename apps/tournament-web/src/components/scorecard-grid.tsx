/**
 * ScorecardGrid — Wolf Cup–style front-9 / back-9 hole-by-hole scorecard,
 * ported (hand-copied + token-adapted) from the Wolf `ScorecardPanel` grid
 * (apps/web/src/routes/index.tsx L278-518) under the FD-1/FD-2 monorepo
 * boundary. This is a PURE presentational component: props in, JSX out — no
 * useQuery, no fetch, no network, no global state.
 *
 * Divergences from the Wolf source (Pete Dye adaptation, per story 3-1):
 *   - DROPS the Stab (Stableford), Hvy Pts (Harvey), and Wolf-decision rows and
 *     all wolf-decision logic. Rows are: Hole / Par / Score / Net / $.
 *   - `moneyNet` is `number | null` (see ../types/scorecard): a played hole
 *     whose moneyNet is null renders `—` (never `0`/`$0`); a section whose
 *     played holes contribute no non-null moneyNet renders `—` for its total
 *     (an empty sum is "unknown", never `0`). 3-1 does NOT compute money.
 *   - The per-hole Net cell is gated on `grossScore` (an unplayed hole never
 *     shows a net), whereas Wolf rendered `netScore ?? '—'` ungated. This is a
 *     deliberate, more-correct divergence aligned with AC #5 ("unplayed Net
 *     cells render —").
 *   - Wolf's shadcn semantic aliases (text-muted-foreground, bg-muted,
 *     border-border, bg-foreground, text-destructive, text-green-600,
 *     bg-green-700) are NOT defined in tournament-web (Tailwind v4, no shadcn
 *     theme) and would render as no-ops; they are replaced with the tournament
 *     token system via inline `var(--color-*)` styles (see ../index.css and
 *     ./card.tsx). Real palette utilities used by HoleBadge are unaffected.
 */
import type { CSSProperties } from 'react';
import { HoleBadge } from './hole-badge';
import { ScrollableTable } from './scrollable-table';
import type { ScorecardHole } from '../types/scorecard';

const FRONT = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const BACK = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const;

/**
 * Signed whole-dollar money string. Local helper (NEVER imported from
 * apps/web/** — FD-1/FD-2). Only called with a non-null amount; the `—`
 * (unknown) case is decided by the caller before formatting. A zero amount
 * renders unsigned `0` (NOT `$0`) so a zero section total matches the per-hole
 * `moneyNet === 0` rendering (AC #6) — this is a deliberate consistency fix
 * over the Wolf reference, which rendered totals as `$0` but per-hole zeros as
 * `0`.
 */
function formatMoney(amount: number): string {
  if (amount > 0) return `+$${amount}`;
  if (amount < 0) return `-$${Math.abs(amount)}`;
  return '0';
}

/** Sum a numeric field over the given holes, treating null/undefined as 0. */
function sumField(holes: ScorecardHole[], key: 'par' | 'grossScore' | 'netScore'): number {
  return holes.reduce((s, h) => s + (h[key] ?? 0), 0);
}

/** Sum only the non-null moneyNet contributions; also report how many there were. */
function sumMoney(holes: ScorecardHole[]): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const h of holes) {
    if (h.moneyNet !== null && h.moneyNet !== undefined) {
      total += h.moneyNet;
      count += 1;
    }
  }
  return { total, count };
}

/** Token-driven inline styles (shadcn aliases are no-ops in tournament-web). */
const mutedStyle: CSSProperties = { color: 'var(--color-text-muted)' };
const stripeStyle: CSSProperties = { background: 'var(--color-surface-sunken)' };
const subtleBorderStyle: CSSProperties = { borderColor: 'var(--color-border-subtle)' };
const headerStyle: CSSProperties = { background: 'var(--color-brand-primary)', color: '#fff' };

/** Money color for a per-hole or total cell, given the signed amount. */
function moneyColorStyle(amount: number): CSSProperties {
  if (amount > 0) return { color: 'var(--color-money-pos)' };
  if (amount < 0) return { color: 'var(--color-money-neg)' };
  return mutedStyle;
}

export function ScorecardGrid({
  holes,
  showMoney,
}: {
  holes: ScorecardHole[];
  showMoney?: boolean;
}) {
  const holeMap = new Map(holes.map((h) => [h.holeNumber, h]));
  const g = (n: number) => holeMap.get(n) ?? null;

  const playedHoles = holes.filter((h) => h.grossScore != null);
  const front9played = playedHoles.filter((h) => h.holeNumber <= 9);
  const back9played = playedHoles.filter((h) => h.holeNumber > 9);

  const fPar = sumField(front9played, 'par');
  const fGross = sumField(front9played, 'grossScore');
  const fNet = sumField(front9played, 'netScore');
  const fMoney = sumMoney(front9played);

  const bPar = sumField(back9played, 'par');
  const bGross = sumField(back9played, 'grossScore');
  const bNet = sumField(back9played, 'netScore');
  const bMoney = sumMoney(back9played);

  // Combined-section money: "—" only when BOTH sections contribute zero non-null.
  const totalMoney = fMoney.total + bMoney.total;
  const totalMoneyCount = fMoney.count + bMoney.count;

  const tdC = 'text-center py-[3px] text-[10px]';
  const tdL = 'pl-2 pr-1 py-[3px] text-[10px] font-semibold whitespace-nowrap';
  const tdTot = 'text-center py-[3px] text-[10px] font-bold';

  /** Render one Score cell (HoleBadge for played holes, em-dash + dot otherwise). */
  const scoreCell = (h: ScorecardHole | null, key: number) => (
    <td key={key} className={tdC}>
      {h?.grossScore != null ? (
        <HoleBadge
          gross={h.grossScore}
          par={h.par}
          hasGreenie={h.hasGreenie}
          hasPolie={h.hasPolie}
          hasSandie={h.hasSandie}
          relativeStrokes={h.relativeStrokes}
        />
      ) : (
        <span className="relative inline-block text-[10px]" style={mutedStyle}>
          —
          {h?.relativeStrokes ? (
            <span
              data-testid="unplayed-stroke-dot"
              className="absolute -top-[2px] -right-[4px] w-[4px] h-[4px] rounded-full"
              style={{ background: 'var(--color-text-muted)' }}
            />
          ) : null}
        </span>
      )}
    </td>
  );

  /** Render one $ cell for a played/unplayed hole. */
  const moneyCell = (h: ScorecardHole | null, key: number) => {
    const played = h?.grossScore != null;
    const value = h?.moneyNet ?? null;
    if (!played || value === null) {
      return (
        <td key={key} className={tdC} style={mutedStyle}>
          —
        </td>
      );
    }
    return (
      <td key={key} className={tdC} style={moneyColorStyle(value)}>
        {value === 0 ? '0' : formatMoney(value)}
      </td>
    );
  };

  return (
    <div className="py-2 px-1 space-y-2">
      {/* ── Front 9 (own scroll region so it never pushes the page wide) ── */}
      <ScrollableTable label="Front 9">
        <table className="w-full border-collapse min-w-max">
          <thead>
            <tr style={headerStyle}>
              <th className="pl-2 pr-1 py-1 text-[10px] font-semibold text-left w-10">Hole</th>
              {FRONT.map((n) => (
                <th key={n} className="w-[22px] text-center py-1 text-[10px] font-semibold">
                  {n}
                </th>
              ))}
              <th className="w-[28px] text-center py-1 text-[10px] font-bold">Out</th>
            </tr>
          </thead>
          <tbody>
            <tr style={stripeStyle}>
              <td className={tdL} style={mutedStyle}>
                Par
              </td>
              {FRONT.map((n) => {
                const h = g(n);
                return (
                  <td key={n} className={tdC} style={mutedStyle}>
                    {h?.grossScore != null ? h.par : '—'}
                  </td>
                );
              })}
              <td className={tdTot} style={mutedStyle}>
                {front9played.length > 0 ? fPar : '—'}
              </td>
            </tr>
            <tr className="border-t" style={subtleBorderStyle}>
              <td className={tdL} style={mutedStyle}>
                Score
              </td>
              {FRONT.map((n) => scoreCell(g(n), n))}
              <td className={tdTot}>{front9played.length > 0 ? fGross : '—'}</td>
            </tr>
            <tr className="border-t" style={{ ...subtleBorderStyle, ...stripeStyle }}>
              <td className={tdL} style={mutedStyle}>
                Net
              </td>
              {FRONT.map((n) => {
                const h = g(n);
                return (
                  <td key={n} className={tdC} style={mutedStyle}>
                    {h?.grossScore != null ? (h.netScore ?? '—') : '—'}
                  </td>
                );
              })}
              <td className={tdTot} style={mutedStyle}>
                {front9played.length > 0 ? fNet : '—'}
              </td>
            </tr>
            {showMoney && (
              <tr className="border-t" style={{ ...subtleBorderStyle, ...stripeStyle }}>
                <td className={tdL} style={mutedStyle}>
                  $
                </td>
                {FRONT.map((n) => moneyCell(g(n), n))}
                <td
                  className={tdTot}
                  style={fMoney.count > 0 ? moneyColorStyle(fMoney.total) : mutedStyle}
                >
                  {fMoney.count > 0 ? formatMoney(fMoney.total) : '—'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollableTable>

      {/* ── Back 9 (show once any back-9 hole has been played) ── */}
      {back9played.length > 0 && (
        <ScrollableTable label="Back 9">
          <table className="w-full border-collapse min-w-max">
            <thead>
              <tr style={headerStyle}>
                <th className="pl-2 pr-1 py-1 text-[10px] font-semibold text-left w-10">Hole</th>
                {BACK.map((n) => (
                  <th key={n} className="w-[22px] text-center py-1 text-[10px] font-semibold">
                    {n}
                  </th>
                ))}
                <th className="w-[28px] text-center py-1 text-[10px] font-bold">In</th>
                <th className="w-[28px] text-center py-1 text-[10px] font-bold">Tot</th>
              </tr>
            </thead>
            <tbody>
              <tr style={stripeStyle}>
                <td className={tdL} style={mutedStyle}>
                  Par
                </td>
                {BACK.map((n) => {
                  const h = g(n);
                  return (
                    <td key={n} className={tdC} style={mutedStyle}>
                      {h?.grossScore != null ? h.par : '—'}
                    </td>
                  );
                })}
                <td className={tdTot} style={mutedStyle}>
                  {back9played.length > 0 ? bPar : '—'}
                </td>
                <td className={tdTot} style={mutedStyle}>
                  {fPar + bPar}
                </td>
              </tr>
              <tr className="border-t" style={subtleBorderStyle}>
                <td className={tdL} style={mutedStyle}>
                  Score
                </td>
                {BACK.map((n) => scoreCell(g(n), n))}
                <td className={tdTot}>{back9played.length > 0 ? bGross : '—'}</td>
                <td className={tdTot}>{fGross + bGross}</td>
              </tr>
              <tr className="border-t" style={{ ...subtleBorderStyle, ...stripeStyle }}>
                <td className={tdL} style={mutedStyle}>
                  Net
                </td>
                {BACK.map((n) => {
                  const h = g(n);
                  return (
                    <td key={n} className={tdC} style={mutedStyle}>
                      {h?.grossScore != null ? (h.netScore ?? '—') : '—'}
                    </td>
                  );
                })}
                <td className={tdTot} style={mutedStyle}>
                  {back9played.length > 0 ? bNet : '—'}
                </td>
                <td className={tdTot} style={mutedStyle}>
                  {fNet + bNet}
                </td>
              </tr>
              {showMoney && (
                <tr className="border-t" style={{ ...subtleBorderStyle, ...stripeStyle }}>
                  <td className={tdL} style={mutedStyle}>
                    $
                  </td>
                  {BACK.map((n) => moneyCell(g(n), n))}
                  <td
                    className={tdTot}
                    style={bMoney.count > 0 ? moneyColorStyle(bMoney.total) : mutedStyle}
                  >
                    {bMoney.count > 0 ? formatMoney(bMoney.total) : '—'}
                  </td>
                  <td
                    className={tdTot}
                    style={totalMoneyCount > 0 ? moneyColorStyle(totalMoney) : mutedStyle}
                  >
                    {totalMoneyCount > 0 ? formatMoney(totalMoney) : '—'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </div>
  );
}
