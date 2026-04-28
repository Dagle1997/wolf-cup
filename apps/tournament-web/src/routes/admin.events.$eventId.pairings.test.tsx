/**
 * T4-2 component tests for PairingsPage. Renders directly with mocked
 * fetch; bypasses TanStack Router's loader.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PairingsPage } from './admin.events.$eventId.pairings';

const TEST_EVENT_ID = 'event-test-1';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PairingsPage eventId={TEST_EVENT_ID} />
    </QueryClientProvider>,
  );
}

const baseGetResponse = {
  event: { id: TEST_EVENT_ID, name: 'Pinehurst Test' },
  rounds: [
    {
      eventRoundId: 'er-1',
      roundNumber: 1,
      roundDate: 1_715_040_000_000,
      pairings: [],
    },
    {
      eventRoundId: 'er-2',
      roundNumber: 2,
      roundDate: 1_715_126_400_000,
      pairings: [],
    },
  ],
  roster: [
    { playerId: 'p-alice', name: 'Alice' },
    { playerId: 'p-bob', name: 'Bob' },
    { playerId: 'p-carol', name: 'Carol' },
    { playerId: 'p-dave', name: 'Dave' },
    { playerId: 'p-eve', name: 'Eve' },
    { playerId: 'p-frank', name: 'Frank' },
    { playerId: 'p-grace', name: 'Grace' },
    { playerId: 'p-henry', name: 'Henry' },
  ],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PairingsPage', () => {
  it('idle render with empty pairings: grid shows 2 rounds × 2 foursomes × 4 cells (all empty)', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(baseGetResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /pairings — pinehurst test/i }),
      ).toBeInTheDocument();
    });
    // 2 round rows (one per event_round).
    expect(screen.getByTestId('round-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('round-row-1')).toBeInTheDocument();
    // Each round has 2 foursomes × 4 cells = 8 cells.
    expect(screen.getByTestId('cell-0-0-0')).toBeInTheDocument();
    expect(screen.getByTestId('cell-0-0-3')).toBeInTheDocument();
    expect(screen.getByTestId('cell-0-1-0')).toBeInTheDocument();
    expect(screen.getByTestId('cell-0-1-3')).toBeInTheDocument();
    expect(screen.getByTestId('cell-1-0-0')).toBeInTheDocument();
    // Save button is disabled (no changes from server state).
    expect(screen.getByTestId('save-button')).toBeDisabled();
  });

  it('idle render with persisted pairings: cells prepopulate', async () => {
    const responseWithPairings = {
      ...baseGetResponse,
      rounds: [
        {
          eventRoundId: 'er-1',
          roundNumber: 1,
          roundDate: 1_715_040_000_000,
          pairings: [
            {
              id: 'p1',
              foursomeNumber: 1,
              locked: false,
              members: [
                { playerId: 'p-alice', name: 'Alice', slotNumber: 1 },
                { playerId: 'p-bob', name: 'Bob', slotNumber: 2 },
                { playerId: 'p-carol', name: 'Carol', slotNumber: 3 },
                { playerId: 'p-dave', name: 'Dave', slotNumber: 4 },
              ],
            },
          ],
        },
        {
          eventRoundId: 'er-2',
          roundNumber: 2,
          roundDate: 1_715_126_400_000,
          pairings: [],
        },
      ],
    };
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(responseWithPairings), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('select-0-0-0')).toBeInTheDocument();
    });
    const slot1 = screen.getByTestId('select-0-0-0') as HTMLSelectElement;
    const slot2 = screen.getByTestId('select-0-0-1') as HTMLSelectElement;
    expect(slot1.value).toBe('p-alice');
    expect(slot2.value).toBe('p-bob');
  });

  it('save: assign players to cells → POST → success status', async () => {
    const mockFetch = vi.mocked(fetch);
    let postBody: string | null = null;
    mockFetch.mockImplementation(async (input, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (method === 'POST') {
        postBody = (init as RequestInit).body as string;
        return new Response(
          JSON.stringify({ pairingCount: 1, memberCount: 4 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(baseGetResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('select-0-0-0')).toBeInTheDocument();
    });

    // Fill foursome 1 of round 1 with 4 players.
    await userEvent.selectOptions(screen.getByTestId('select-0-0-0'), 'p-alice');
    await userEvent.selectOptions(screen.getByTestId('select-0-0-1'), 'p-bob');
    await userEvent.selectOptions(screen.getByTestId('select-0-0-2'), 'p-carol');
    await userEvent.selectOptions(screen.getByTestId('select-0-0-3'), 'p-dave');

    expect(screen.getByTestId('save-button')).not.toBeDisabled();
    await userEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    });
    expect(postBody).not.toBeNull();
    const parsed = JSON.parse(postBody!) as {
      rounds: Array<{ pairings: Array<{ memberPlayerIds: string[] }> }>;
    };
    expect(parsed.rounds[0]!.pairings[0]!.memberPlayerIds).toEqual([
      'p-alice',
      'p-bob',
      'p-carol',
      'p-dave',
    ]);
  });

  it('422 conflict: page renders friendly inline error', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (method === 'POST') {
        return new Response(
          JSON.stringify({
            error: 'duplicate_player',
            code: 'player_in_multiple_pairings_per_round',
            requestId: 'r',
            conflicts: [
              {
                playerId: 'p-alice',
                eventRoundId: 'er-1',
                foursomeNumbers: [1, 2],
              },
            ],
          }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(baseGetResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('select-0-0-0')).toBeInTheDocument();
    });

    // Assign Alice to two foursomes in round 1.
    await userEvent.selectOptions(screen.getByTestId('select-0-0-0'), 'p-alice');
    await userEvent.selectOptions(screen.getByTestId('select-0-1-0'), 'p-alice');

    await userEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/multiple foursomes/i);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/alice/i);
  });

  it('lock-round: clicking the lock button sets the row to locked + greys out cells', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(baseGetResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('lock-round-0')).toBeInTheDocument();
    });

    // Initially unlocked: cells enabled.
    expect(screen.getByTestId('select-0-0-0')).not.toBeDisabled();

    // Click lock button.
    await userEvent.click(screen.getByTestId('lock-round-0'));

    // Lock label flips.
    await waitFor(() => {
      expect(screen.getByTestId('lock-round-0')).toHaveTextContent(/locked/i);
    });
    // Cells are now disabled.
    expect(screen.getByTestId('select-0-0-0')).toBeDisabled();
  });
});
