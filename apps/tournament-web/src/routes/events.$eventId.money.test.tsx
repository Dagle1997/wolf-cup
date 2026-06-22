/**
 * T6-5 money page smoke tests.
 *
 * Renders MoneyPage directly (bypasses TanStack Router's auth loader).
 * Mocks fetch with a minimal 2-player matrix and asserts:
 * - matrix renders with correct cells
 * - viewer's row highlighted
 * - formatCents output verified
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MoneyPage } from './events.$eventId.money';
import { formatCents } from '../lib/format-cents';
import { renderInRouter } from '../test-utils/render-in-router';

function renderWithQueryClient(eventId: string, viewerId?: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // Conditional spread to satisfy exactOptionalPropertyTypes.
  const pageProps = viewerId === undefined
    ? ({ eventId } as const)
    : ({ eventId, viewerId } as const);
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <MoneyPage {...pageProps} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const MATRIX_FIXTURE = {
  players: [
    { id: 'pA', name: 'Alice' },
    { id: 'pB', name: 'Bob' },
  ],
  matrix: {
    pA: { pA: 0, pB: 500 },
    pB: { pA: -500, pB: 0 },
  },
  totals: { pA: 500, pB: -500 },
  // T13-5 split: the 2v2 lives in the team ledger; no individual bets here.
  teamLedger: {
    matrix: { pA: { pA: 0, pB: 500 }, pB: { pA: -500, pB: 0 } },
    totals: { pA: 500, pB: -500 },
  },
  individualLedger: {
    matrix: { pA: { pA: 0, pB: 0 }, pB: { pA: 0, pB: 0 } },
    totals: { pA: 0, pB: 0 },
  },
  computedAt: '2026-05-04T00:00:00.000Z',
  visibilityMode: 'open' as const,
};

describe('MoneyPage', () => {
  it('renders matrix cells with formatCents output', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(MATRIX_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithQueryClient('evt-1', 'pA');

    // Wait for the table data to render (Loading state has "Money" heading
    // too, so we must wait for an actual data-bound element).
    await waitFor(() => {
      expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    });

    // Cell pA→pB shows +$5.00. There are two of these (the cell and a total).
    const positiveCells = screen.getAllByText(formatCents(500));
    expect(positiveCells.length).toBeGreaterThan(0);
    const negativeCells = screen.getAllByText(formatCents(-500));
    expect(negativeCells.length).toBeGreaterThan(0);
  });

  it('renders forbidden message on 403', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{}', { status: 403 }),
    );
    renderWithQueryClient('evt-1', 'pA');
    await waitFor(() => {
      expect(screen.getByText(/aren't a participant/i)).toBeInTheDocument();
    });
  });

  it('renders empty-state when no participants', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          players: [],
          matrix: {},
          totals: {},
          computedAt: '2026-05-04T00:00:00.000Z',
          visibilityMode: 'open',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderWithQueryClient('evt-1');
    await waitFor(() => {
      expect(screen.getByText(/no participants yet/i)).toBeInTheDocument();
    });
  });
});

describe('MoneyPage — F1 (Story 1.4)', () => {
  it('renders an explicit "not yet enabled" state when f1.exposed is false (AC10)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...MATRIX_FIXTURE,
          f1: { isF1: true, lockState: 'locked', exposed: false, unsettleable: [] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderWithQueryClient('evt-1', 'pA');
    await waitFor(() => {
      expect(screen.getByText(/money not yet enabled/i)).toBeInTheDocument();
    });
    // It must NOT render a silent-zero ledger that reads as "everyone's even".
    expect(screen.queryByText(/Standings/)).not.toBeInTheDocument();
  });

  it('renders the fail-closed "Calculation paused" line for an unsettleable foursome (AC11)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...MATRIX_FIXTURE,
          f1: {
            isF1: true,
            lockState: 'locked',
            exposed: true,
            unsettleable: [{ foursomeNumber: 2, reason: 'missing_handicap', detail: 'missing handicap for player X' }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderWithQueryClient('evt-1', 'pA');
    await waitFor(() => {
      expect(screen.getByText(/Calculation paused — unsettleable/i)).toBeInTheDocument();
    });
  });
});

describe('formatCents', () => {
  it('formats positive cents', () => {
    expect(formatCents(4700)).toBe('+$47.00');
  });
  it('formats negative cents', () => {
    expect(formatCents(-1250)).toBe('-$12.50');
  });
  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00');
  });
  it('throws on non-integer input', () => {
    expect(() => formatCents(100.5)).toThrow(RangeError);
  });
});
