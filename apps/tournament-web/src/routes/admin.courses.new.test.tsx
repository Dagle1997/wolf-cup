/**
 * T2-5 component tests for the course-creation form.
 *
 * Tests render `NewCoursePage` directly (named export), bypassing TanStack
 * Router's loader so the auth guard isn't exercised here. Auth-guard
 * behavior is covered by tournament-api's auth.test.ts /status tests +
 * manual post-deploy walk-through (AC #20).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NewCoursePage } from './admin.courses.new';

type ParsedCourse = {
  name: string;
  club_name: string;
  tees: Array<{ color: string; rating: number; slope: number }>;
  holes: Array<{
    number: number;
    par: number;
    si: number;
    yardages: Record<string, number>;
  }>;
  totals: { out_total: number; in_total: number; course_total: number };
};

/**
 * Canonical valid parsed-course fixture matching the backend
 * `validCourseRequest()` helper — par 71 with out=35 / in=36, single 'blue' tee.
 */
function canonicalParsed(): ParsedCourse {
  const pars = [
    4, 4, 3, 4, 5, 4, 4, 3, 4,
    4, 4, 3, 4, 5, 4, 4, 3, 5,
  ];
  const yardages = [
    400, 420, 180, 440, 520, 410, 400, 170, 415,
    425, 430, 190, 445, 530, 420, 395, 160, 520,
  ];
  return {
    name: 'Test Course',
    club_name: 'Test Country Club',
    tees: [{ color: 'blue', rating: 72.3, slope: 130 }],
    holes: pars.map((par, i) => ({
      number: i + 1,
      par,
      si: i + 1,
      yardages: { blue: yardages[i]! },
    })),
    totals: { out_total: 35, in_total: 36, course_total: 71 },
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NewCoursePage', () => {
  it('idle state: renders header inputs, 1 default tee row, 18 hole rows, totals; Submit disabled', () => {
    render(<NewCoursePage />);

    expect(screen.getByRole('heading', { name: /^new course$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/club name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/source url \(optional\)/i)).toBeInTheDocument();

    // 1 default tee row → 1 set of color/rating/slope inputs.
    expect(screen.getByLabelText(/tee 1 color/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tee 1 rating/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tee 1 slope/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/tee 2 color/i)).not.toBeInTheDocument();

    // All 18 hole-par selects rendered (sample first + last + a par-3 slot).
    expect(screen.getByLabelText(/hole 1 par/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hole 18 par/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hole 9 stroke index/i)).toBeInTheDocument();

    // Totals + compute button.
    expect(screen.getByLabelText(/out total/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/in total/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/course total/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /compute totals from holes/i })).toBeInTheDocument();

    // Submit disabled in idle state (no fields filled).
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeDisabled();
  });

  it('upload pre-populate: parse-pdf success → form fields populated with parsed data', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(canonicalParsed()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<NewCoursePage />);

    const fileInput = screen.getByLabelText(/scorecard file/i) as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'card.jpg', {
      type: 'image/jpeg',
    });
    await userEvent.upload(fileInput, file);

    // Wait for the form to populate. The Name input value flips from '' to 'Test Course'.
    await waitFor(() => {
      expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('Test Course');
    });
    expect((screen.getByLabelText(/club name/i) as HTMLInputElement).value).toBe(
      'Test Country Club',
    );
    expect((screen.getByLabelText(/tee 1 color/i) as HTMLInputElement).value).toBe('blue');
    expect((screen.getByLabelText(/tee 1 rating/i) as HTMLInputElement).value).toBe('72.3');
    expect((screen.getByLabelText(/tee 1 slope/i) as HTMLInputElement).value).toBe('130');
    expect((screen.getByLabelText(/hole 1 par/i) as HTMLSelectElement).value).toBe('4');
    expect((screen.getByLabelText(/hole 3 par/i) as HTMLSelectElement).value).toBe('3');
    expect((screen.getByLabelText(/hole 18 par/i) as HTMLSelectElement).value).toBe('5');
    expect((screen.getByLabelText(/hole 1 blue yardage/i) as HTMLInputElement).value).toBe('400');
    expect((screen.getByLabelText(/out total/i) as HTMLInputElement).value).toBe('35');
    expect((screen.getByLabelText(/in total/i) as HTMLInputElement).value).toBe('36');
    expect((screen.getByLabelText(/course total/i) as HTMLInputElement).value).toBe('71');

    // Submit becomes enabled once the form is populated.
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeEnabled();
  });

  it('manual entry success: pre-populate + Submit → 201 → success message + form resets', async () => {
    const mockFetch = vi.mocked(fetch);
    // First call: parse-pdf upload (pre-populate).
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(canonicalParsed()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    // Second call: save endpoint succeeds.
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'course-uuid-123', requestId: 'req-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<NewCoursePage />);

    const fileInput = screen.getByLabelText(/scorecard file/i) as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'card.jpg', {
      type: 'image/jpeg',
    });
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('Test Course');
    });

    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/course saved/i);
    });
    expect(screen.getByRole('status')).toHaveTextContent(/course-uuid-123/);

    // Form resets to idle empty state — Name input cleared.
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('');

    // Verify the save call sent the JSON payload (not multipart).
    const saveCall = mockFetch.mock.calls[1]!;
    expect(saveCall[0]).toBe('/api/admin/courses');
    const init = saveCall[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sentBody['name']).toBe('Test Course');
    expect(sentBody['source_url']).toBeUndefined();
  });

  it('validation error from save: 400 validation_failed → errors render as top-level list', async () => {
    const mockFetch = vi.mocked(fetch);
    // Pre-populate via upload.
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(canonicalParsed()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    // Save returns 400 validation_failed with two errors.
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'bad_request',
          code: 'validation_failed',
          requestId: 'req-2',
          errors: ['Out total mismatch: claimed 36, computed 35', 'SI bijection mismatch'],
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(<NewCoursePage />);

    const fileInput = screen.getByLabelText(/scorecard file/i) as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'card.jpg', {
      type: 'image/jpeg',
    });
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('Test Course');
    });

    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    // Top-level error list rendered (per AC #11 v1 contract).
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/can't be saved/i);
    const items = within(alert).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/out total mismatch/i);
    expect(items[1]).toHaveTextContent(/si bijection mismatch/i);

    // Form NOT reset — organizer can fix and retry.
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('Test Course');
  });

  it('upload error: parse-pdf returns 400 wrong_mime → friendly message, form stays empty', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad_upload', code: 'wrong_mime' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<NewCoursePage />);

    const fileInput = screen.getByLabelText(/scorecard file/i) as HTMLInputElement;
    // Use a matching-MIME file so user-event doesn't filter at the accept
    // layer; the backend response is mocked to wrong_mime regardless. This
    // models the "user picks a junk file via 'All Files' in some browsers"
    // path that the input's accept attribute doesn't fully prevent.
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'foo.jpg', {
      type: 'image/jpeg',
    });
    await userEvent.upload(fileInput, file);

    const errorMsg = await screen.findByRole('alert');
    expect(errorMsg).toHaveTextContent(/can't open that kind of file/i);
    // Form stays empty — Name input is still blank.
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('');
  });

  it('duplicate course: save returns 409 → friendly duplicate message, form stays populated', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(canonicalParsed()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'conflict', code: 'duplicate_course', requestId: 'req-3' }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(<NewCoursePage />);

    const fileInput = screen.getByLabelText(/scorecard file/i) as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'card.jpg', {
      type: 'image/jpeg',
    });
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('Test Course');
    });

    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already exists/i);
    // Form preserved.
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('Test Course');
  });
});
