/**
 * T3-2 component tests for the event-creation wizard.
 *
 * Tests render `NewEventWizard` directly (named export), bypassing TanStack
 * Router's loader so the auth guard isn't exercised here. Auth-guard
 * behavior is covered by tournament-api's auth.test.ts /status tests +
 * manual post-deploy walk-through (AC #20).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { NewEventWizard } from './admin.events.new';

function renderWithQueryClient() {
  // Per-test QueryClient so cache state doesn't leak between tests.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NewEventWizard />
    </QueryClientProvider>,
  );
}

const COURSES_FIXTURE = {
  courses: [
    {
      id: 'c1',
      name: 'Pinehurst No. 2',
      clubName: 'Pinehurst Resort',
      latestRevision: { id: 'cr1', courseTotal: 72 },
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewEventWizard', () => {
  it('idle / step 1: renders Basics form; Next disabled until fields filled', async () => {
    // No fetches expected in idle state — the courses query lives in step 2.
    renderWithQueryClient();

    expect(screen.getByRole('heading', { name: /^new event$/i })).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/start date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();

    const next = screen.getByRole('button', { name: /^next$/i });
    expect(next).toBeDisabled();
  });

  it('step transition: fill basics + click Next → step 2 visible; Back → step 1 with values preserved', async () => {
    const mockFetch = vi.mocked(fetch);
    // Step 2 mounts the courses query.
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(COURSES_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();

    await userEvent.type(screen.getByLabelText(/^name$/i), 'Pinehurst 2026');
    // Note: typing into a date input requires the YYYY-MM-DD format.
    await userEvent.type(screen.getByLabelText(/start date/i), '2026-05-07');
    await userEvent.type(screen.getByLabelText(/end date/i), '2026-05-10');
    // Timezone defaults from browser; if test env returns 'UTC' that passes.

    const next = screen.getByRole('button', { name: /^next$/i });
    expect(next).toBeEnabled();
    await userEvent.click(next);

    // Step 2 visible
    expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^rounds$/i })).toBeInTheDocument();

    // "Course not listed?" escape hatch — links to both creation paths +
    // a refresh-list control so a newly-added course shows without reload.
    expect(screen.getByText(/course not listed/i)).toBeInTheDocument();
    expect(screen.getByTestId('wizard-add-course-upload')).toHaveAttribute(
      'href',
      '/admin/courses/upload',
    );
    expect(screen.getByTestId('wizard-add-course-manual')).toHaveAttribute(
      'href',
      '/admin/courses/new',
    );
    expect(screen.getByTestId('wizard-refresh-courses')).toBeInTheDocument();

    // Back returns to step 1 with values preserved
    await userEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByText(/step 1 of 3/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe(
      'Pinehurst 2026',
    );
  });

  it('validation: end_date before start_date keeps Next disabled on step 1', async () => {
    renderWithQueryClient();

    await userEvent.type(screen.getByLabelText(/^name$/i), 'Test');
    await userEvent.type(screen.getByLabelText(/start date/i), '2026-05-10');
    await userEvent.type(screen.getByLabelText(/end date/i), '2026-05-07'); // before start

    const next = screen.getByRole('button', { name: /^next$/i });
    expect(next).toBeDisabled();
  });

  it('happy path: full wizard → Submit → 201 → success screen with invite URL', async () => {
    const mockFetch = vi.mocked(fetch);
    // First fetch: courses query (mounted on step 2)
    mockFetch.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/courses')) {
        return new Response(JSON.stringify(COURSES_FIXTURE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/admin/events')) {
        return new Response(
          JSON.stringify({
            eventId: 'event-uuid-1',
            inviteToken: 'a'.repeat(43),
            requestId: 'req-1',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    // Step 1
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Pinehurst 2026');
    await userEvent.type(screen.getByLabelText(/start date/i), '2026-05-07');
    await userEvent.type(screen.getByLabelText(/end date/i), '2026-05-10');
    await userEvent.click(screen.getByRole('button', { name: /^next$/i }));

    // Step 2 — wait for courses query
    await waitFor(() => {
      const courseSelect = screen.getByLabelText(/round 1 course/i) as HTMLSelectElement;
      const opts = within(courseSelect).getAllByRole('option');
      expect(opts.length).toBeGreaterThan(1); // includes the "— pick —" placeholder
    });

    await userEvent.type(screen.getByLabelText(/round 1 date/i), '2026-05-07');
    await userEvent.selectOptions(screen.getByLabelText(/round 1 course/i), 'cr1');
    await userEvent.type(screen.getByLabelText(/round 1 tee color/i), 'blue');

    await userEvent.click(screen.getByRole('button', { name: /^next$/i }));

    // Step 3
    expect(screen.getByText(/step 3 of 3/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    // Success screen
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /event created/i })).toBeInTheDocument();
    });
    // Invite URL constructed from window.location.origin
    expect(screen.getByText(/\/invite\/aaa/)).toBeInTheDocument();
    expect(screen.getByText(/event-uuid-1/)).toBeInTheDocument();

    // Verify the POST payload shape
    const eventsCall = mockFetch.mock.calls.find((call) => {
      const url = typeof call[0] === 'string' ? call[0] : (call[0] as Request).url;
      return url.includes('/api/admin/events');
    });
    expect(eventsCall).toBeDefined();
    const init = eventsCall![1] as RequestInit;
    expect(init.method).toBe('POST');
    const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sentBody['name']).toBe('Pinehurst 2026');
    // Dates coerced to epoch ms
    expect(typeof sentBody['start_date']).toBe('number');
    expect(typeof sentBody['end_date']).toBe('number');
    expect(Array.isArray(sentBody['rounds'])).toBe(true);
    expect((sentBody['rounds'] as Array<Record<string, unknown>>)[0]!['holes_to_play']).toBe(18);
  });

  it('save error: 400 unknown_course_revision → friendly message, form preserved', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/courses')) {
        return new Response(JSON.stringify(COURSES_FIXTURE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          error: 'bad_request',
          code: 'unknown_course_revision',
          requestId: 'req-2',
          missing: ['cr-stale'],
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    });

    renderWithQueryClient();

    await userEvent.type(screen.getByLabelText(/^name$/i), 'Test');
    await userEvent.type(screen.getByLabelText(/start date/i), '2026-05-07');
    await userEvent.type(screen.getByLabelText(/end date/i), '2026-05-10');
    await userEvent.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => {
      const opts = within(screen.getByLabelText(/round 1 course/i)).getAllByRole('option');
      expect(opts.length).toBeGreaterThan(1);
    });

    await userEvent.type(screen.getByLabelText(/round 1 date/i), '2026-05-07');
    await userEvent.selectOptions(screen.getByLabelText(/round 1 course/i), 'cr1');
    await userEvent.type(screen.getByLabelText(/round 1 tee color/i), 'blue');

    await userEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no longer exist/i);
    // Form preserved — name still set on step 3
    expect(screen.getByText(/step 3 of 3/i)).toBeInTheDocument();
  });
});
