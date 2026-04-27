/**
 * T3-3 component tests for the EditGroupPage.
 *
 * Tests render `EditGroupPage` directly (named export), bypassing TanStack
 * Router's loader — auth-guard is covered by tournament-api's auth.test.ts
 * /status tests + manual post-deploy walk-through (AC #22).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EditGroupPage } from './admin.groups.$groupId.edit';

const TEST_GROUP_ID = 'group-test-1';

function renderWithQueryClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <EditGroupPage groupId={TEST_GROUP_ID} />
    </QueryClientProvider>,
  );
}

const initialGroup = {
  id: TEST_GROUP_ID,
  name: 'Pinehurst Crew',
  eventId: 'event-1',
  moneyVisibilityMode: 'open' as const,
  members: [
    {
      playerId: 'p-1',
      name: 'Alice Anderson',
      ghin: '1111111',
      manualHandicapIndex: null,
      preferredTeeColor: null,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EditGroupPage', () => {
  it('idle render: shows group name, member list, add-player tabs', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes(`/api/admin/groups/${TEST_GROUP_ID}`) && !url.includes('/members')) {
        return new Response(JSON.stringify(initialGroup), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /edit group: pinehurst crew/i })).toBeInTheDocument();
    });

    // Member list shows Alice
    expect(screen.getByText('Alice Anderson')).toBeInTheDocument();
    expect(screen.getByText('1111111')).toBeInTheDocument();
    // GHIN-bound player has no manualHandicapIndex → "—"
    const memberRow = screen.getByText('Alice Anderson').closest('tr');
    expect(memberRow).not.toBeNull();

    // Add-player tabs
    expect(screen.getByRole('tab', { name: /ghin search/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /manual entry/i })).toBeInTheDocument();
  });

  it('GHIN search flow: results render → click Add → POST → invalidate group', async () => {
    const mockFetch = vi.mocked(fetch);
    let groupCallCount = 0;
    mockFetch.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes(`/api/admin/groups/${TEST_GROUP_ID}/members`)) {
        return new Response(
          JSON.stringify({
            player: {
              id: 'p-2',
              name: 'Josh Stoll',
              ghin: '2222222',
              manualHandicapIndex: null,
              preferredTeeColor: null,
            },
            groupMember: { groupId: TEST_GROUP_ID, playerId: 'p-2' },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(`/api/admin/groups/${TEST_GROUP_ID}`)) {
        groupCallCount += 1;
        // First call: just Alice. After member-add invalidate: Alice + Josh.
        const members =
          groupCallCount === 1
            ? initialGroup.members
            : [
                ...initialGroup.members,
                {
                  playerId: 'p-2',
                  name: 'Josh Stoll',
                  ghin: '2222222',
                  manualHandicapIndex: null,
                  preferredTeeColor: null,
                },
              ];
        return new Response(JSON.stringify({ ...initialGroup, members }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/players/search')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                ghinNumber: 2222222,
                firstName: 'Josh',
                lastName: 'Stoll',
                handicapIndex: 8.4,
                club: 'Guyan G&CC',
                state: 'WV',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByText('Alice Anderson')).toBeInTheDocument();
    });

    // GHIN tab is selected by default. Search for "Stoll".
    await userEvent.type(screen.getByLabelText(/last name/i), 'Stoll');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText(/josh stoll/i)).toBeInTheDocument();
    });

    // Click Add on the result.
    const addButtons = screen.getAllByRole('button', { name: /^add$/i });
    await userEvent.click(addButtons[0]!);

    // Verify Josh appears in the member list (post-invalidate refetch).
    await waitFor(() => {
      expect(screen.getByText('2222222')).toBeInTheDocument();
    });
  });

  it('manual entry flow: name + handicap → Add → POST → invalidate group', async () => {
    const mockFetch = vi.mocked(fetch);
    let groupCallCount = 0;
    mockFetch.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';

      if (
        url.includes(`/api/admin/groups/${TEST_GROUP_ID}/members`) &&
        method === 'POST'
      ) {
        return new Response(
          JSON.stringify({
            player: {
              id: 'p-3',
              name: 'Manual Mike',
              ghin: null,
              manualHandicapIndex: 12.5,
              preferredTeeColor: null,
            },
            groupMember: { groupId: TEST_GROUP_ID, playerId: 'p-3' },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(`/api/admin/groups/${TEST_GROUP_ID}`) && method === 'GET') {
        groupCallCount += 1;
        const members =
          groupCallCount === 1
            ? initialGroup.members
            : [
                ...initialGroup.members,
                {
                  playerId: 'p-3',
                  name: 'Manual Mike',
                  ghin: null,
                  manualHandicapIndex: 12.5,
                  preferredTeeColor: null,
                },
              ];
        return new Response(JSON.stringify({ ...initialGroup, members }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByText('Alice Anderson')).toBeInTheDocument();
    });

    // Switch to Manual Entry tab.
    await userEvent.click(screen.getByRole('tab', { name: /manual entry/i }));

    // Fill + submit.
    await userEvent.type(screen.getByLabelText(/player name/i), 'Manual Mike');
    await userEvent.type(screen.getByLabelText(/handicap.*optional/i), '12.5');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    // Verify Manual Mike appears (post-invalidate refetch).
    await waitFor(() => {
      expect(screen.getByText('Manual Mike')).toBeInTheDocument();
    });

    // Verify the POST payload was the manual shape.
    const postCall = mockFetch.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'POST';
    });
    expect(postCall).toBeDefined();
    const sentBody = JSON.parse((postCall![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(sentBody['mode']).toBe('manual');
    expect(sentBody['name']).toBe('Manual Mike');
    expect(sentBody['manualHandicapIndex']).toBe(12.5);
  });

  it('remove member: click Remove → DELETE → invalidate group → row gone', async () => {
    const mockFetch = vi.mocked(fetch);
    let groupCallCount = 0;
    mockFetch.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';

      if (url.includes(`/api/admin/groups/${TEST_GROUP_ID}/members/p-1`) && method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (url.includes(`/api/admin/groups/${TEST_GROUP_ID}`) && method === 'GET') {
        groupCallCount += 1;
        const members = groupCallCount === 1 ? initialGroup.members : [];
        return new Response(JSON.stringify({ ...initialGroup, members }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByText('Alice Anderson')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /remove alice anderson/i }));

    await waitFor(() => {
      expect(screen.queryByText('Alice Anderson')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no members yet/i)).toBeInTheDocument();
  });

  it('add error: 409 player_already_in_group → friendly message', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';

      if (url.includes(`/api/admin/groups/${TEST_GROUP_ID}/members`) && method === 'POST') {
        return new Response(
          JSON.stringify({ error: 'conflict', code: 'player_already_in_group', requestId: 'r' }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(`/api/admin/groups/${TEST_GROUP_ID}`) && method === 'GET') {
        return new Response(JSON.stringify(initialGroup), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByText('Alice Anderson')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('tab', { name: /manual entry/i }));
    await userEvent.type(screen.getByLabelText(/player name/i), 'Dupe');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/already in this group/i);
    });
  });
});
