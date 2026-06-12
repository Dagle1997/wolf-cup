/**
 * T13-4 scorer-policy admin page smoke tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ScorerPolicyPage } from './admin.events.$eventId.scorer-policy';
import { renderInRouter } from '../test-utils/render-in-router';

function render(eventId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <ScorerPolicyPage eventId={eventId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

const FIXTURE = {
  policy: 'foursome' as const,
  designatedPlayerIds: [],
  roster: [
    { playerId: 'p1', name: 'Matt' },
    { playerId: 'caddie', name: 'Caddie Carl' },
  ],
};

describe('ScorerPolicyPage', () => {
  it('shows the three policies; the designee picker appears only under Designated', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE,
    });
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('policy-foursome')).toBeInTheDocument());
    expect(screen.getByTestId('policy-designated')).toBeInTheDocument();
    expect(screen.getByTestId('policy-open')).toBeInTheDocument();
    // Picker hidden under default 'foursome'.
    expect(screen.queryByTestId('designee-picker')).not.toBeInTheDocument();

    // Switch to Designated → picker with the roster appears.
    await userEvent.click(screen.getByTestId('policy-designated').querySelector('input')!);
    expect(screen.getByTestId('designee-picker')).toBeInTheDocument();
    expect(screen.getByTestId('designee-caddie')).toBeInTheDocument();
    expect(screen.getByText('Caddie Carl')).toBeInTheDocument();
  });

  it('saves the selected policy + designees via PUT', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => FIXTURE }); // GET
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) }); // PUT
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('policy-designated')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('policy-designated').querySelector('input')!);
    await userEvent.click(screen.getByTestId('designee-caddie'));
    await userEvent.click(screen.getByTestId('save-scorer-policy'));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.policy).toBe('designated');
      expect(body.designatedPlayerIds).toContain('caddie');
    });
  });
});
