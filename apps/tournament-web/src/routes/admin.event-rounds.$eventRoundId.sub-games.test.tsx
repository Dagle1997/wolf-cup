/**
 * T3-9 component tests for SubGamesPage.
 *
 * Tests render `SubGamesPage` directly bypassing TanStack Router's loader
 * so the component's idle/mutation/error paths are exercised in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SubGamesPage } from './admin.event-rounds.$eventRoundId.sub-games';

const TEST_EVENT_ROUND_ID = 'event-round-test-1';

function renderWithQueryClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SubGamesPage eventRoundId={TEST_EVENT_ROUND_ID} />
    </QueryClientProvider>,
  );
}

const baseGetResponse = {
  eventRound: {
    id: TEST_EVENT_ROUND_ID,
    eventId: 'event-1',
    roundNumber: 1,
    roundDate: 1_715_040_000_000,
  },
  event: { id: 'event-1', name: 'Pinehurst 2026' },
  roster: [
    { playerId: 'p-alice', name: 'Alice' },
    { playerId: 'p-bob', name: 'Bob' },
    { playerId: 'p-carol', name: 'Carol' },
  ],
  subGames: [],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SubGamesPage', () => {
  it('idle render: skins enabled with roster + buy-in input; v1.5 sections disabled with tooltip', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(baseGetResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /sub-game setup — round 1/i }),
      ).toBeInTheDocument();
    });
    // Pinehurst 2026 event header rendered.
    expect(screen.getByText(/pinehurst 2026/i)).toBeInTheDocument();
    // Skins fieldset is enabled.
    const skinsSection = screen.getByTestId('sub-game-section-skins');
    expect(skinsSection).not.toBeDisabled();
    // Skins buy-in input is enabled.
    const skinsBuyIn = screen.getByTestId('buy-in-skins');
    expect(skinsBuyIn).not.toBeDisabled();
    // Skins participant checkboxes for each roster member.
    expect(screen.getByTestId('participant-skins-p-alice')).not.toBeDisabled();
    expect(screen.getByTestId('participant-skins-p-bob')).not.toBeDisabled();
    expect(screen.getByTestId('participant-skins-p-carol')).not.toBeDisabled();
    // CTP / sandies / putting_contest fieldsets disabled with tooltip.
    expect(screen.getByTestId('sub-game-section-ctp')).toBeDisabled();
    expect(screen.getByTestId('sub-game-section-ctp')).toHaveAttribute(
      'title',
      'Coming in v1.5',
    );
    expect(screen.getByTestId('sub-game-section-sandies')).toBeDisabled();
    expect(screen.getByTestId('sub-game-section-putting_contest')).toBeDisabled();
  });

  it('toggle players + buy-in + save → POST body matches; success message renders', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';

      if (method === 'POST' && url.includes('/sub-games')) {
        return new Response(
          JSON.stringify({ subGameCount: 1, participantCount: 2 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // GET prepopulation
      return new Response(JSON.stringify(baseGetResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByTestId('participant-skins-p-alice')).toBeInTheDocument();
    });

    // Toggle Alice + Bob into skins.
    await userEvent.click(screen.getByTestId('participant-skins-p-alice'));
    await userEvent.click(screen.getByTestId('participant-skins-p-bob'));
    // Set $5.00 buy-in.
    const buyIn = screen.getByTestId('buy-in-skins') as HTMLInputElement;
    await userEvent.clear(buyIn);
    await userEvent.type(buyIn, '5.00');

    // Save.
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    });

    // Inspect the POST body.
    const postCall = mockFetch.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    const postInit = postCall![1] as RequestInit;
    const bodyJson = JSON.parse(postInit.body as string) as {
      subGames: Array<{
        type: string;
        buyInPerParticipant: number;
        participantPlayerIds: string[];
      }>;
    };
    expect(bodyJson.subGames).toHaveLength(1);
    expect(bodyJson.subGames[0]!.type).toBe('skins');
    expect(bodyJson.subGames[0]!.buyInPerParticipant).toBe(500);
    expect(bodyJson.subGames[0]!.participantPlayerIds).toEqual(
      expect.arrayContaining(['p-alice', 'p-bob']),
    );
  });

  it('save error 400 player_not_in_event → friendly inline message; form preserved', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (method === 'POST') {
        return new Response(
          JSON.stringify({ error: 'bad_request', code: 'player_not_in_event' }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(baseGetResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByTestId('participant-skins-p-alice')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('participant-skins-p-alice'));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/isn't on this event's roster/i);
    });
    // Form still shows Alice as toggled (form state preserved after error).
    expect(screen.getByTestId('participant-skins-p-alice')).toBeChecked();
  });

  it('disabled v1.5 types: their participant checkboxes are NOT clickable', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(baseGetResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();
    await waitFor(() => {
      expect(screen.getByTestId('participant-ctp-p-alice')).toBeInTheDocument();
    });

    // ctp/sandies/putting_contest checkboxes for Alice are disabled.
    expect(screen.getByTestId('participant-ctp-p-alice')).toBeDisabled();
    expect(screen.getByTestId('participant-sandies-p-alice')).toBeDisabled();
    expect(screen.getByTestId('participant-putting_contest-p-alice')).toBeDisabled();
  });

  it('server has empty skins entry: save button disabled on idle; save preserves the empty entry (round-2 codex edge)', async () => {
    const mockFetch = vi.mocked(fetch);
    const responseEmptySkins = {
      ...baseGetResponse,
      subGames: [
        {
          type: 'skins',
          buyInPerParticipant: 0,
          participantPlayerIds: [],
        },
      ],
    };
    let capturedPostBody: string | null = null;
    mockFetch.mockImplementation(async (input, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (method === 'POST') {
        capturedPostBody = (init as RequestInit).body as string;
        return new Response(
          JSON.stringify({ subGameCount: 1, participantCount: 0 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(responseEmptySkins), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    renderWithQueryClient();

    // Wait for prepopulation.
    await waitFor(() => {
      expect(screen.getByTestId('participant-skins-p-alice')).toBeInTheDocument();
    });
    // Save button is disabled on idle (draft matches server's empty-skins state).
    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();

    // Toggle Alice → enables save → save → POST body MUST include a skins
    // entry (server originally had one; serverHadSkins gate emits it even
    // before user changes — but here we have a change too).
    await userEvent.click(screen.getByTestId('participant-skins-p-alice'));
    expect(saveButton).not.toBeDisabled();
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    });

    expect(capturedPostBody).not.toBeNull();
    const parsed = JSON.parse(capturedPostBody!) as {
      subGames: Array<{ type: string; participantPlayerIds: string[] }>;
    };
    expect(parsed.subGames).toHaveLength(1);
    expect(parsed.subGames[0]!.type).toBe('skins');
    expect(parsed.subGames[0]!.participantPlayerIds).toEqual(['p-alice']);
  });

  it('save button disabled on idle render (form matches server state)', async () => {
    const mockFetch = vi.mocked(fetch);
    const responseWithConfig = {
      ...baseGetResponse,
      subGames: [
        {
          type: 'skins',
          buyInPerParticipant: 500,
          participantPlayerIds: ['p-alice', 'p-bob'],
        },
      ],
    };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(responseWithConfig), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();

    // Wait for prepopulation to settle.
    await waitFor(() => {
      expect(screen.getByTestId('participant-skins-p-alice')).toBeChecked();
    });

    // Save button is disabled because draft equals server state.
    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();

    // Toggle Carol → state changes → button enables.
    await userEvent.click(screen.getByTestId('participant-skins-p-carol'));
    expect(saveButton).not.toBeDisabled();
  });

  it('prepopulates from existing config: skins with 2 participants + $5.00 buy-in', async () => {
    const mockFetch = vi.mocked(fetch);
    const responseWithConfig = {
      ...baseGetResponse,
      subGames: [
        {
          type: 'skins',
          buyInPerParticipant: 500,
          participantPlayerIds: ['p-alice', 'p-bob'],
        },
      ],
    };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(responseWithConfig), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByTestId('participant-skins-p-alice')).toBeChecked();
    });
    expect(screen.getByTestId('participant-skins-p-bob')).toBeChecked();
    expect(screen.getByTestId('participant-skins-p-carol')).not.toBeChecked();
    const buyIn = screen.getByTestId('buy-in-skins') as HTMLInputElement;
    expect(buyIn.value).toBe('5.00');
  });
});
