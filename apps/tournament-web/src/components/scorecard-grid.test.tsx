import { describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ScorecardGrid } from './scorecard-grid';
import {
  STEVEN_CHATTERTON_CARD,
  FRONT_NINE_ONLY,
  ALL_NULL_MONEY_FRONT,
} from '../lib/scorecard-fixtures';

/**
 * Find the <tr> whose first cell (the row label) has the given text. The grid
 * uses a label cell ("Par", "Score", "Net", "$") as the first <td> of each row;
 * this lets a test scope assertions to a single row without class-name coupling.
 */
function rowByLabel(label: string): HTMLTableRowElement {
  const rows = Array.from(document.querySelectorAll('tr')) as HTMLTableRowElement[];
  const match = rows.find((tr) => {
    const first = tr.querySelector('td');
    return first?.textContent?.trim() === label;
  });
  if (!match) throw new Error(`No row labelled "${label}" found`);
  return match;
}

function hasRowLabelled(label: string): boolean {
  const rows = Array.from(document.querySelectorAll('tr')) as HTMLTableRowElement[];
  return rows.some((tr) => tr.querySelector('td')?.textContent?.trim() === label);
}

describe('ScorecardGrid', () => {
  test('(a) front-only fixture renders an Out total but no In/Tot columns', () => {
    render(<ScorecardGrid holes={FRONT_NINE_ONLY} />);

    // Only one table renders when the back 9 is unplayed (no In/Tot header).
    expect(screen.getByText('Out')).toBeInTheDocument();
    expect(screen.queryByText('In')).not.toBeInTheDocument();
    expect(screen.queryByText('Tot')).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);

    // Out gross total = sum of played front-9 gross (4+3+4+5+4+5+3+5+4 = 37).
    const grossTotal = FRONT_NINE_ONLY.filter((h) => h.holeNumber <= 9).reduce(
      (s, h) => s + (h.grossScore ?? 0),
      0,
    );
    const scoreRow = rowByLabel('Score');
    const cells = within(scoreRow).getAllByRole('cell');
    // Last cell of the Score row is the Out total.
    expect(cells[cells.length - 1]!.textContent?.trim()).toBe(String(grossTotal));
  });

  test('(b) full-18 fixture renders the back-9 table with In + Tot columns', () => {
    render(<ScorecardGrid holes={STEVEN_CHATTERTON_CARD} />);

    expect(screen.getByText('Out')).toBeInTheDocument();
    expect(screen.getByText('In')).toBeInTheDocument();
    expect(screen.getByText('Tot')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(2);

    // Tot gross = sum of all played gross.
    const totGross = STEVEN_CHATTERTON_CARD.reduce((s, h) => s + (h.grossScore ?? 0), 0);
    // The back-9 Score row's last cell is the Tot total.
    const scoreRows = Array.from(document.querySelectorAll('tr')).filter(
      (tr) => tr.querySelector('td')?.textContent?.trim() === 'Score',
    ) as HTMLTableRowElement[];
    expect(scoreRows).toHaveLength(2);
    const backScoreRow = scoreRows[1]!;
    const cells = within(backScoreRow).getAllByRole('cell');
    expect(cells[cells.length - 1]!.textContent?.trim()).toBe(String(totGross));
  });

  test('(c) unplayed cell placeholder + single stroke dot (back table forced)', () => {
    const holes = [
      // Front 9 played (these render badges, not unplayed-stroke dots).
      ...FRONT_NINE_ONLY.slice(0, 9),
      // Hole 10 played → forces the back-9 table to render.
      { holeNumber: 10, par: 4, grossScore: 4, netScore: 4, moneyNet: 1 },
      // Hole 11 unplayed WITH a 2-stroke allocation → must show "—" + exactly ONE dot.
      { holeNumber: 11, par: 4, grossScore: null, netScore: null, moneyNet: null, relativeStrokes: 2 },
      // Holes 12–18 unplayed with NO strokes, so hole 11 is the ONLY unplayed-stroke
      // cell — making the total dot count a clean assertion of "one dot, not two".
      ...[12, 13, 14, 15, 16, 17, 18].map((n) => ({
        holeNumber: n,
        par: 4,
        grossScore: null,
        netScore: null,
        moneyNet: null,
      })),
    ];
    const { container } = render(<ScorecardGrid holes={holes} />);

    // The unplayed cell shows an em-dash placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    // Exactly one stroke dot for that unplayed hole (never two, even though
    // relativeStrokes is 2 — AC #5: unplayed cells show at most one dot).
    const dots = container.querySelectorAll('[data-testid="unplayed-stroke-dot"]');
    expect(dots).toHaveLength(1);
  });

  test('(d) showMoney=false omits the $ row; showMoney=true renders it', () => {
    const { rerender } = render(<ScorecardGrid holes={STEVEN_CHATTERTON_CARD} showMoney={false} />);
    expect(hasRowLabelled('$')).toBe(false);

    rerender(<ScorecardGrid holes={STEVEN_CHATTERTON_CARD} showMoney={true} />);
    expect(hasRowLabelled('$')).toBe(true);
  });

  test('(e) a played hole with moneyNet === null renders "—" in its $ cell (not "0")', () => {
    // Take the front 9 of the showcase card and override hole 5 (index 4) to a
    // played hole with moneyNet: null, so the assertion can scope to the front-9
    // $ row deterministically. (The card's own null-money hole 15 lives in the
    // back 9; this keeps the test in a single-table render.)
    const front = STEVEN_CHATTERTON_CARD.slice(0, 9);
    const holes = front.map((h, i) =>
      i === 4 ? { ...h, grossScore: 5, netScore: 5, moneyNet: null } : h,
    );
    render(<ScorecardGrid holes={holes} showMoney />);

    const moneyRow = rowByLabel('$');
    const cells = within(moneyRow).getAllByRole('cell');
    // cells[0] = "$" label; cells[1..9] = holes 1..9; cells[10] = Out total.
    // Hole 5 (index 4) is the null-money played hole.
    expect(cells[5]!.textContent?.trim()).toBe('—');
    expect(cells[5]!.textContent?.trim()).not.toBe('0');
  });

  test('(f) a section whose played holes are all-null money renders "—" for its total (not "0")', () => {
    render(<ScorecardGrid holes={ALL_NULL_MONEY_FRONT} showMoney />);

    const moneyRow = rowByLabel('$');
    const cells = within(moneyRow).getAllByRole('cell');
    const outTotalCell = cells[cells.length - 1]!;
    expect(outTotalCell.textContent?.trim()).toBe('—');
    expect(outTotalCell.textContent?.trim()).not.toBe('0');
  });

  test('(g) no Stab, Wolf, or Hvy row is present', () => {
    render(<ScorecardGrid holes={STEVEN_CHATTERTON_CARD} showMoney />);
    expect(hasRowLabelled('Stab')).toBe(false);
    expect(hasRowLabelled('Wolf')).toBe(false);
    expect(hasRowLabelled('Hvy')).toBe(false);
    expect(hasRowLabelled('Hvy Pts')).toBe(false);
    // The Pete Dye rows that SHOULD be present:
    expect(hasRowLabelled('Par')).toBe(true);
    expect(hasRowLabelled('Score')).toBe(true);
    expect(hasRowLabelled('Net')).toBe(true);
  });

  test('(h) a played hole with moneyNet === 0 renders "0" (not "—", not "$0")', () => {
    // Central AC #6 distinction: 0 is a legitimate even-money result, not "unknown".
    const front = STEVEN_CHATTERTON_CARD.slice(0, 9);
    const holes = front.map((h, i) =>
      i === 4 ? { ...h, grossScore: 4, netScore: 4, moneyNet: 0 } : h,
    );
    render(<ScorecardGrid holes={holes} showMoney />);
    const cells = within(rowByLabel('$')).getAllByRole('cell');
    // cells[0] = "$" label; cells[1..9] = holes 1..9; cells[10] = Out total.
    expect(cells[5]!.textContent?.trim()).toBe('0');
  });

  test('(i) Par and Net section (Out) totals equal the sum of played front-9 holes (AC #4)', () => {
    render(<ScorecardGrid holes={STEVEN_CHATTERTON_CARD} showMoney />);
    const front = STEVEN_CHATTERTON_CARD.filter((h) => h.holeNumber <= 9 && h.grossScore != null);
    const fPar = front.reduce((s, h) => s + h.par, 0);
    const fNet = front.reduce((s, h) => s + (h.netScore ?? 0), 0);
    // Full-18 card → two Par rows + two Net rows (front + back tables); [0] is the front table.
    const parRows = Array.from(document.querySelectorAll('tr')).filter(
      (tr) => tr.querySelector('td')?.textContent?.trim() === 'Par',
    ) as HTMLTableRowElement[];
    const netRows = Array.from(document.querySelectorAll('tr')).filter(
      (tr) => tr.querySelector('td')?.textContent?.trim() === 'Net',
    ) as HTMLTableRowElement[];
    const fParCells = within(parRows[0]!).getAllByRole('cell');
    const fNetCells = within(netRows[0]!).getAllByRole('cell');
    expect(fParCells[fParCells.length - 1]!.textContent?.trim()).toBe(String(fPar));
    expect(fNetCells[fNetCells.length - 1]!.textContent?.trim()).toBe(String(fNet));
  });

  test('(j) the back-9 In total equals the sum of played back-9 gross, independent of Tot (AC #4)', () => {
    render(<ScorecardGrid holes={STEVEN_CHATTERTON_CARD} />);
    const back = STEVEN_CHATTERTON_CARD.filter((h) => h.holeNumber > 9 && h.grossScore != null);
    const bGross = back.reduce((s, h) => s + (h.grossScore ?? 0), 0);
    const scoreRows = Array.from(document.querySelectorAll('tr')).filter(
      (tr) => tr.querySelector('td')?.textContent?.trim() === 'Score',
    ) as HTMLTableRowElement[];
    // Back-9 Score row cells: label + 9 holes + In + Tot → In is the second-to-last.
    const backCells = within(scoreRows[1]!).getAllByRole('cell');
    expect(backCells[backCells.length - 2]!.textContent?.trim()).toBe(String(bGross));
  });

  test('(k) a non-null money section summing to exactly 0 renders "0" (not "$0")', () => {
    // Two played front-9 holes, +2 and -2 → a non-null sum of 0. This is distinct
    // from the empty-sum "—" case (test f): here money IS known and nets to zero.
    const holes = [
      { holeNumber: 1, par: 4, grossScore: 4, netScore: 4, moneyNet: 2 },
      { holeNumber: 2, par: 4, grossScore: 5, netScore: 5, moneyNet: -2 },
    ];
    render(<ScorecardGrid holes={holes} showMoney />);
    const cells = within(rowByLabel('$')).getAllByRole('cell');
    const outTotal = cells[cells.length - 1]!;
    expect(outTotal.textContent?.trim()).toBe('0');
    expect(outTotal.textContent?.trim()).not.toBe('$0');
  });
});
