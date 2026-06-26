/**
 * Component tests for SubGamesPage — skins as three independent pots
 * (Net / Gross / Canadian), CTP + Putting disabled (v1.5).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderInRouter } from '../test-utils/render-in-router';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SubGamesPage } from './admin.event-rounds.$eventRoundId.sub-games';

const TEST_EVENT_ROUND_ID = 'event-round-test-1';

function renderWithQueryClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <SubGamesPage eventRoundId={TEST_EVENT_ROUND_ID} />
    </QueryClientProvider>,
  );
}

const baseGetResponse = {
  eventRound: { id: TEST_EVENT_ROUND_ID, eventId: 'event-1', roundNumber: 1, roundDate: 1_715_040_000_000 },
  event: { id: 'event-1', name: 'Pinehurst 2026' },
  roster: [
    { playerId: 'p-alice', name: 'Alice' },
    { playerId: 'p-bob', name: 'Bob' },
    { playerId: 'p-carol', name: 'Carol' },
  ],
  subGames: [] as Array<{ type: string; mode: string | null; buyInPerParticipant: number; participantPlayerIds: string[] }>,
};

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('SubGamesPage', () => {
  it('renders three skins pots (net/gross/canadian) + active putting + disabled CTP', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(baseGetResponse), { status: 200, headers: { 'content-type': 'application/json' } }));
    renderWithQueryClient();

    await waitFor(() => expect(screen.getByRole('heading', { name: /sub-game setup — round 1/i })).toBeInTheDocument());
    expect(screen.getByText(/pinehurst 2026/i)).toBeInTheDocument();
    expect(screen.getByTestId('skins-section-net')).toBeInTheDocument();
    expect(screen.getByTestId('skins-section-gross')).toBeInTheDocument();
    expect(screen.getByTestId('skins-section-gross_beats_net')).toBeInTheDocument();
    // Each pot has its own buy-in + per-player checkboxes.
    expect(screen.getByTestId('skins-buyin-net')).toBeInTheDocument();
    expect(screen.getByTestId('skins-participant-gross-p-alice')).toBeInTheDocument();
    // Putting is now an active section (enables putts entry); CTP still disabled.
    expect(screen.getByTestId('putting-section')).toBeInTheDocument();
    expect(screen.getByTestId('putting-participant-p-alice')).toBeInTheDocument();
    expect(screen.getByTestId('sub-game-section-ctp')).toBeDisabled();
  });

  it('enabling Net + Gross pots + Save → POST sends two skins entries with modes + $25', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (method === 'POST') return new Response(JSON.stringify({ subGameCount: 2 }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(baseGetResponse), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    renderWithQueryClient();
    await waitFor(() => expect(screen.getByTestId('skins-buyin-net')).toBeInTheDocument());

    await userEvent.type(screen.getByTestId('skins-buyin-net'), '25');
    await userEvent.click(screen.getByTestId('skins-participant-net-p-alice'));
    await userEvent.click(screen.getByTestId('skins-participant-net-p-bob'));
    await userEvent.type(screen.getByTestId('skins-buyin-gross'), '25');
    await userEvent.click(screen.getByTestId('skins-participant-gross-p-alice'));

    await userEvent.click(screen.getByTestId('save-sub-games'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));

    const postCall = mockFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    const body = JSON.parse((postCall![1] as RequestInit).body as string) as { subGames: Array<{ type: string; mode: string; buyInPerParticipant: number; participantPlayerIds: string[] }> };
    expect(body.subGames).toHaveLength(2);
    const net = body.subGames.find((g) => g.mode === 'net')!;
    const gross = body.subGames.find((g) => g.mode === 'gross')!;
    expect(net.type).toBe('skins');
    expect(net.buyInPerParticipant).toBe(2500);
    expect(net.participantPlayerIds).toEqual(expect.arrayContaining(['p-alice', 'p-bob']));
    expect(gross.buyInPerParticipant).toBe(2500);
    expect(gross.participantPlayerIds).toEqual(['p-alice']);
    // Canadian pot left empty → not sent.
    expect(body.subGames.some((g) => g.mode === 'gross_beats_net')).toBe(false);
  });

  it('prepopulates each pot from existing config (mode-aware)', async () => {
    const resp = {
      ...baseGetResponse,
      subGames: [
        { type: 'skins', mode: 'net', buyInPerParticipant: 2500, participantPlayerIds: ['p-alice', 'p-bob'] },
        { type: 'skins', mode: 'gross_beats_net', buyInPerParticipant: 1000, participantPlayerIds: ['p-carol'] },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(resp), { status: 200, headers: { 'content-type': 'application/json' } }));
    renderWithQueryClient();

    await waitFor(() => expect(screen.getByTestId('skins-participant-net-p-alice')).toBeChecked());
    expect((screen.getByTestId('skins-buyin-net') as HTMLInputElement).value).toBe('25.00');
    expect(screen.getByTestId('skins-participant-net-p-bob')).toBeChecked();
    expect((screen.getByTestId('skins-buyin-gross_beats_net') as HTMLInputElement).value).toBe('10.00');
    expect(screen.getByTestId('skins-participant-gross_beats_net-p-carol')).toBeChecked();
    // Gross pot untouched → empty.
    expect((screen.getByTestId('skins-buyin-gross') as HTMLInputElement).value).toBe('');
  });

  it('save error 400 player_not_in_event → friendly inline message; form preserved', async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (method === 'POST') return new Response(JSON.stringify({ error: 'bad_request', code: 'player_not_in_event' }), { status: 400, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(baseGetResponse), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    renderWithQueryClient();
    await waitFor(() => expect(screen.getByTestId('skins-participant-net-p-alice')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('skins-participant-net-p-alice'));
    await userEvent.click(screen.getByTestId('save-sub-games'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/isn't on this event's roster/i));
    expect(screen.getByTestId('skins-participant-net-p-alice')).toBeChecked();
  });
});
