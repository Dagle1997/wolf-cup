/**
 * T3-5 component tests for the EditRuleSetPage.
 *
 * Renders EditRuleSetPage directly (named export), bypassing TanStack Router's
 * loader. Auth-guard behavior is tested at the tournament-api layer +
 * manual post-deploy walk-through (AC #19).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EditRuleSetPage } from './admin.rule-sets.$id.edit';

const TEST_RULE_SET_ID = 'rs-test-1';

function renderWithQueryClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <EditRuleSetPage ruleSetId={TEST_RULE_SET_ID} />
    </QueryClientProvider>,
  );
}

const initialRuleSet = {
  id: TEST_RULE_SET_ID,
  name: 'Pinehurst stakes',
  createdAt: 1_715_000_000_000,
  latestRevision: {
    id: 'rev-1',
    revisionNumber: 1,
    configJson: {
      sandies: true,
      autoPress: { enabled: true, downN: 2, multiplier: 2 },
      greenies: { carryover: false, validation: 'none' as const },
      individualBet: { matchPlayPerHoleCents: 100 },
      subGames: { defaultBuyInPerParticipantCents: 0 },
    },
    effectiveFromRoundId: null,
    effectiveFromHole: 1,
    createdByPlayerId: 'p-1',
    createdAt: 1_715_000_000_000,
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EditRuleSetPage', () => {
  it('idle render: form fields populate from query data', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(initialRuleSet), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /edit rule set: pinehurst stakes/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/^revision 1$/i)).toBeInTheDocument();
    // Sandies checkbox checked from initial data
    const sandiesCheckbox = screen.getByLabelText(/sandies enabled/i) as HTMLInputElement;
    expect(sandiesCheckbox.checked).toBe(true);
    // Auto-press downN populated to "2"
    const downN = screen.getByLabelText(/n-down trigger/i) as HTMLInputElement;
    expect(downN.value).toBe('2');
    // Match play $/hole = $1.00 (from 100 cents)
    const matchPlay = screen.getByLabelText(/match play \$\/hole/i) as HTMLInputElement;
    expect(matchPlay.value).toBe('1.00');
  });

  it('greenies carryover toggle auto-switches validation', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(initialRuleSet), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByLabelText(/sandies enabled/i)).toBeInTheDocument();
    });

    // Initially: carryover off, validation 'none'
    const carryover = screen.getByLabelText(/^carryover$/i) as HTMLInputElement;
    expect(carryover.checked).toBe(false);
    const noneRadio = screen.getByLabelText(/^none$/i) as HTMLInputElement;
    const twoPuttRadio = screen.getByLabelText(/^2-putt$/i) as HTMLInputElement;
    expect(noneRadio.checked).toBe(true);
    expect(twoPuttRadio.checked).toBe(false);

    // Toggle carryover ON → validation auto-switches to '2-putt'
    await userEvent.click(carryover);
    expect(twoPuttRadio.checked).toBe(true);
    expect(noneRadio.checked).toBe(false);

    // Toggle OFF → switches back to 'none'
    await userEvent.click(carryover);
    expect(noneRadio.checked).toBe(true);
    expect(twoPuttRadio.checked).toBe(false);
  });

  it('save success: 201 → success message + revisionNumber increments after invalidate', async () => {
    const mockFetch = vi.mocked(fetch);
    let getCallCount = 0;
    mockFetch.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';

      if (url.includes('/revisions') && method === 'POST') {
        return new Response(
          JSON.stringify({ revisionId: 'rev-2', revisionNumber: 2, requestId: 'r' }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(`/api/admin/rule-sets/${TEST_RULE_SET_ID}`) && method === 'GET') {
        getCallCount += 1;
        // First fetch: revision 1; post-invalidate refetch: revision 2.
        const data =
          getCallCount === 1
            ? initialRuleSet
            : {
                ...initialRuleSet,
                latestRevision: {
                  ...initialRuleSet.latestRevision,
                  id: 'rev-2',
                  revisionNumber: 2,
                },
              };
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByText(/^revision 1$/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Success status appears
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/saved revision 2/i);
    });
    // Heading updates after invalidate refetch
    await waitFor(() => {
      expect(screen.getByText(/^revision 2$/i)).toBeInTheDocument();
    });
  });

  it('save error: 409 revision_number_conflict → reload-message; form preserved', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';

      if (url.includes('/revisions') && method === 'POST') {
        return new Response(
          JSON.stringify({ error: 'conflict', code: 'revision_number_conflict', requestId: 'r' }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(`/api/admin/rule-sets/${TEST_RULE_SET_ID}`) && method === 'GET') {
        return new Response(JSON.stringify(initialRuleSet), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByText(/^revision 1$/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/another save just landed/i);
    });

    // Form is preserved — sandies still checked.
    const sandiesCheckbox = screen.getByLabelText(/sandies enabled/i) as HTMLInputElement;
    expect(sandiesCheckbox.checked).toBe(true);
  });
});
