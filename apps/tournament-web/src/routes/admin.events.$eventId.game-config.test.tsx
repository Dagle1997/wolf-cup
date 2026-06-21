/**
 * GameConfigPage smoke tests (Story 1.3) — preset-first setup page.
 *
 * Renders the Standard Guyan preset + point-value control + lock toggle, and
 * Save calls PUT /api/admin/events/:eventId/game-config with the chosen schedule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GameConfigPage } from './admin.events.$eventId.game-config';
import { renderInRouter } from '../test-utils/render-in-router';

function render(eventId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <GameConfigPage eventId={eventId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('GameConfigPage', () => {
  it('renders the Standard Guyan preset, point value, and lock toggle (unseeded)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ config: null }),
    });
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('preset-card')).toBeInTheDocument());
    expect(screen.getByText('Standard Guyan')).toBeInTheDocument();
    expect(screen.getByTestId('pv-flat-dollars')).toBeInTheDocument();
    expect(screen.getByTestId('lock-toggle')).toBeInTheDocument();
    // Unseeded → the seed-flavored Save label.
    expect(screen.getByTestId('save-game-config')).toHaveTextContent('Set up Standard Guyan');
  });

  it('Save calls PUT with the chosen flat schedule (whole-dollar → even cents)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ config: null }) }); // GET
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ config: { id: 'x', lockState: 'locked', configVersion: 1, configJson: '{}' } }) }); // PUT
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('pv-flat-dollars')).toBeInTheDocument());
    const input = screen.getByTestId('pv-flat-dollars') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '10');
    await userEvent.click(screen.getByTestId('save-game-config'));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.pointValueSchedule).toEqual({ kind: 'flat', cents: 1000 });
      expect(body.lockState).toBe('locked');
    });
  });

  it('shows the front/back inputs when that mode is chosen and PUTs the split', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ config: null }) }); // GET
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ config: { id: 'x', lockState: 'locked', configVersion: 1, configJson: '{}' } }) }); // PUT
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('pv-mode-front-back')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('pv-mode-front-back').querySelector('input')!);
    expect(screen.getByTestId('pv-front-dollars')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('save-game-config'));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.pointValueSchedule.kind).toBe('front-back');
      expect(body.pointValueSchedule.frontCents).toBe(500);
      expect(body.pointValueSchedule.backCents).toBe(1000);
    });
  });
});
