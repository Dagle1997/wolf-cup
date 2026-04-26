/**
 * T2-3b component tests for the upload route.
 *
 * Tests the 4 view states (idle / uploading / success / error) by
 * importing the named `UploadCoursePage` export directly — bypasses
 * TanStack Router so the loader / auth-guard logic isn't exercised here.
 * Auth-guard behavior is tested at the tournament-api layer
 * (auth.test.ts /status tests) + manually post-deploy (AC #15).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { UploadCoursePage } from './admin.courses.upload';

type ParsedCourse = {
  name: string;
  club_name: string;
  tees: Array<{ color: string; rating: number; slope: number }>;
  holes: Array<{ number: number; par: number; si: number; yardages: Record<string, number> }>;
  totals: { out_total: number; in_total: number; course_total: number };
};

const canonicalParsed: ParsedCourse = {
  name: 'Pine Needles',
  club_name: 'Pine Needles Lodge & Golf Club',
  tees: [{ color: 'Medal', rating: 74.7, slope: 141 }],
  holes: Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: i % 3 === 0 ? 5 : 4,
    si: i + 1,
    yardages: { Medal: 400 + i * 5 },
  })),
  totals: { out_total: 36, in_total: 35, course_total: 71 },
};

/** Builds a small test JPG file with valid magic bytes for upload. */
function makeTestFile(name = 'card.jpg', mime = 'image/jpeg'): File {
  const bytes = new Uint8Array(256);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return new File([bytes], name, { type: mime });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UploadCoursePage', () => {
  it('idle state: renders file input + disabled Submit button', () => {
    render(<UploadCoursePage />);

    expect(screen.getByRole('heading', { name: /upload a scorecard/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/scorecard file/i)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /^submit$/i });
    expect(submit).toBeDisabled();

    expect(screen.queryByText(/reading scorecard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/upload failed/i)).not.toBeInTheDocument();
  });

  it('uploading state: shows progress message + Cancel while parse-pdf is pending', async () => {
    // Controllable fetch promise — never resolves in this test so we
    // can assert the in-flight UI.
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>(() => {
          /* never resolves */
        }),
    );

    render(<UploadCoursePage />);

    const fileInput = screen.getByLabelText(/scorecard file/i) as HTMLInputElement;
    await userEvent.upload(fileInput, makeTestFile());

    const submit = screen.getByRole('button', { name: /^submit$/i });
    await userEvent.click(submit);

    expect(await screen.findByText(/reading scorecard/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^submit$/i })).not.toBeInTheDocument();
  });

  it('success state: renders parsed course summary + Try another button', async () => {
    let resolveParse: (v: Response) => void = () => {};
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolveParse = r;
        }),
    );

    render(<UploadCoursePage />);

    const fileInput = screen.getByLabelText(/scorecard file/i) as HTMLInputElement;
    await userEvent.upload(fileInput, makeTestFile());
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    // Resolve the parse-pdf fetch with a canonical ParsedCourse.
    resolveParse(
      new Response(JSON.stringify(canonicalParsed), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/parsed: pine needles/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/pine needles lodge/i)).toBeInTheDocument();
    expect(screen.getByText(/tees \(1\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try another/i })).toBeInTheDocument();
  });

  it('error state: maps wrong_mime code to user-friendly message + Try another file button', async () => {
    let resolveParse: (v: Response) => void = () => {};
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolveParse = r;
        }),
    );

    render(<UploadCoursePage />);

    const fileInput = screen.getByLabelText(/scorecard file/i) as HTMLInputElement;
    await userEvent.upload(fileInput, makeTestFile());
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    resolveParse(
      new Response(JSON.stringify({ error: 'bad_upload', code: 'wrong_mime' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/upload failed/i)).toBeInTheDocument();
    });
    // User-friendly message present, raw error code NOT shown.
    expect(screen.getByText(/can't open that kind of file/i)).toBeInTheDocument();
    expect(screen.queryByText(/wrong_mime/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try another file/i })).toBeInTheDocument();
  });
});
