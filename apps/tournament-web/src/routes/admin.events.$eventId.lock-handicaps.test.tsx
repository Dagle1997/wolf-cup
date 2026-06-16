/**
 * H1 lock-handicaps admin page smoke tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LockHandicapsPage } from './admin.events.$eventId.lock-handicaps';
import { renderInRouter } from '../test-utils/render-in-router';

function render(eventId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <LockHandicapsPage eventId={eventId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

const UNLOCKED = {
  eventId: 'evt1',
  lockDate: null as number | null,
  ghinConfigured: true,
  players: [
    {
      playerId: 'p1',
      name: 'Matt',
      ghin: '1111',
      hasGhin: true,
      currentHandicapIndex: 9.3,
      lockedHandicapIndex: null,
      lockedSource: null,
      lockedAsOf: null,
    },
    {
      playerId: 'p2',
      name: 'Manual Mike',
      ghin: null,
      hasGhin: false,
      currentHandicapIndex: 12.5,
      lockedHandicapIndex: null,
      lockedSource: null,
      lockedAsOf: null,
    },
  ],
};

const LOCKED = {
  ...UNLOCKED,
  lockDate: Date.parse('2026-06-10T00:00:00.000Z'),
  players: [
    { ...UNLOCKED.players[0], lockedHandicapIndex: 8.4, lockedSource: 'ghin', lockedAsOf: '2026-06-01' },
    { ...UNLOCKED.players[1], lockedHandicapIndex: 12.5, lockedSource: 'manual', lockedAsOf: null },
  ],
};

describe('LockHandicapsPage', () => {
  it('renders the roster with today’s HI and an unlocked status', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => UNLOCKED,
    });
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('lock-status-unlocked')).toBeInTheDocument());
    expect(screen.getByTestId('current-hi-p1')).toHaveTextContent('9.3');
    expect(screen.getByTestId('current-hi-p2')).toHaveTextContent('12.5');
    // No lock yet → locked column shows the placeholder.
    expect(screen.getByTestId('locked-hi-p1')).toHaveTextContent('—');
    // Lock button disabled until a date is chosen.
    expect(screen.getByTestId('lock-btn')).toBeDisabled();
    // Unlock button absent while unlocked.
    expect(screen.queryByTestId('unlock-btn')).not.toBeInTheDocument();
  });

  it('shows the locked banner + locked HI with GHIN provenance when locked', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => LOCKED,
    });
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('lock-status-banner')).toBeInTheDocument());
    expect(screen.getByTestId('lock-status-banner')).toHaveTextContent('2026-06-10');
    expect(screen.getByTestId('locked-hi-p1')).toHaveTextContent('8.4');
    expect(screen.getByTestId('locked-hi-p1')).toHaveTextContent('GHIN · 2026-06-01');
    expect(screen.getByTestId('locked-hi-p2')).toHaveTextContent('12.5');
    expect(screen.getByTestId('unlock-btn')).toBeInTheDocument();
  });

  it('POSTs the chosen date to /lock', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => UNLOCKED }); // GET
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) }); // POST lock
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => LOCKED }); // refetch
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('lock-date-input')).toBeInTheDocument());
    const input = screen.getByTestId('lock-date-input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '2026-06-10');
    await userEvent.click(screen.getByTestId('lock-btn'));

    await waitFor(() => {
      const lockCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/handicaps/lock'));
      expect(lockCall).toBeTruthy();
      const body = JSON.parse((lockCall![1] as RequestInit).body as string);
      expect(body.lockDate).toBe('2026-06-10');
    });
  });

  it('POSTs to /unlock when unlocking', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => LOCKED }); // GET
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => UNLOCKED }); // unlock + refetch
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('unlock-btn')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('unlock-btn'));

    await waitFor(() => {
      const unlockCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/handicaps/unlock'));
      expect(unlockCall).toBeTruthy();
      expect((unlockCall![1] as RequestInit).method).toBe('POST');
    });
  });
});
