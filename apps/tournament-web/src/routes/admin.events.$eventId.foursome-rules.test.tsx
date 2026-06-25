/**
 * FoursomeRulesPage smoke tests (Epic 6) — per-foursome Guyan rules.
 *
 * Renders one editor per round-foursome from the pairings list, hydrates from
 * the event default (badge "Event default"), and Save PUTs the foursome's
 * modifiers + stake to the foursome game-config route.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FoursomeRulesPage } from './admin.events.$eventId.foursome-rules';
import { renderInRouter } from '../test-utils/render-in-router';

const EVENT_CFG_JSON = JSON.stringify({
  game: 'guyan-2v2',
  pointValueSchedule: { kind: 'flat', cents: 500 },
  modifiers: [
    { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } },
    { type: 'greenie', enabled: true, variant: { carryover: true } },
    { type: 'polie', enabled: true },
    { type: 'sandie', enabled: true },
  ],
  lockState: 'locked',
  configVersion: 1,
});

function mockFetch(opts: { foursomeConfig?: unknown } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as URL).href ?? String(input);
      if (url.includes('/pairings')) {
        return { ok: true, status: 200, json: async () => ({ rounds: [{ eventRoundId: 'er1', roundNumber: 1, pairings: [{ foursomeNumber: 1 }] }] }) };
      }
      if (url.includes('/foursomes/1/game-config')) {
        if (init?.method === 'PUT') return { ok: true, status: 200, json: async () => ({ config: { id: 'x' } }) };
        if (init?.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ deleted: true }) };
        return { ok: true, status: 200, json: async () => ({ foursomeConfig: opts.foursomeConfig ?? null, eventConfig: { configJson: EVENT_CFG_JSON } }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

function render(eventId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <FoursomeRulesPage eventId={eventId} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('FoursomeRulesPage', () => {
  it('renders a foursome editor inheriting the event default (badge), all rules ON', async () => {
    mockFetch();
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('foursome-rules-er1-1')).toBeInTheDocument());
    expect(screen.getByTestId('foursome-badge-er1-1')).toHaveTextContent('Event default');
    for (const t of ['net-skins', 'greenie', 'polie', 'sandie']) {
      expect(screen.getByTestId(`foursome-toggle-er1-1-${t}`)).toHaveAttribute('aria-checked', 'true');
    }
  });

  it('toggling Sandies off + Save PUTs the foursome config with sandie disabled + the stake', async () => {
    mockFetch();
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('foursome-toggle-er1-1-sandie')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('foursome-toggle-er1-1-sandie'));
    await userEvent.click(screen.getByTestId('foursome-save-er1-1'));

    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const putCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.modifiers.find((m: { type: string }) => m.type === 'sandie').enabled).toBe(false);
      expect(body.modifiers.find((m: { type: string }) => m.type === 'greenie').enabled).toBe(true);
      expect(body.pointValueSchedule).toEqual({ kind: 'flat', cents: 500 });
    });
  });

  it('an existing override shows the "Custom" badge + a reset control', async () => {
    mockFetch({ foursomeConfig: { configJson: JSON.stringify({ game: 'guyan-2v2', pointValueSchedule: { kind: 'flat', cents: 1000 }, modifiers: [{ type: 'sandie', enabled: false }], lockState: 'locked', configVersion: 1 }) } });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('foursome-badge-er1-1')).toHaveTextContent('Custom'));
    expect(screen.getByTestId('foursome-reset-er1-1')).toBeInTheDocument();
    // Stake hydrated from the override ($10).
    expect((screen.getByTestId('foursome-stake-er1-1') as HTMLInputElement).value).toBe('10');
  });
});
