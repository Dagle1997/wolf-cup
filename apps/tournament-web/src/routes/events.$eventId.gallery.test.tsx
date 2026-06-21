/**
 * T7-4 Gallery page smoke tests. Renders GalleryPage directly with mocked
 * fetch; covers grid render, FAB, sequential upload progress, per-file
 * failure banner, lightbox, organizer-only delete, and the delete dialog.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderInRouter } from '../test-utils/render-in-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GalleryPage, type GalleryResponse } from './events.$eventId.gallery';

const NOW = Date.UTC(2026, 4, 8, 4);

const TWO_GROUP_FIXTURE: GalleryResponse = {
  groups: [
    {
      roundId: 'r-1',
      roundDate: NOW,
      roundNumber: 1,
      photos: [
        {
          id: 'p-1',
          signedUrl: 'https://stub/p1?X-Amz-Signature=a',
          contentType: 'image/jpeg',
          uploadedAt: NOW,
          uploaderName: 'Matt',
        },
        {
          id: 'p-2',
          signedUrl: 'https://stub/p2?X-Amz-Signature=b',
          contentType: 'image/jpeg',
          uploadedAt: NOW + 1000,
          uploaderName: 'Josh',
        },
      ],
    },
    {
      roundId: null,
      roundDate: null,
      roundNumber: null,
      photos: [
        {
          id: 'p-3',
          signedUrl: 'https://stub/p3?X-Amz-Signature=c',
          contentType: 'image/png',
          uploadedAt: NOW - 100_000,
          uploaderName: null,
        },
      ],
    },
  ],
};

const EMPTY_FIXTURE: GalleryResponse = { groups: [] };

function renderPage(props: { eventId: string; isOrganizer: boolean }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <GalleryPage {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GalleryPage', () => {
  it('renders header, photo count, and grouped grid', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(TWO_GROUP_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { container } = renderPage({ eventId: 'evt-1', isOrganizer: false });
    await waitFor(() => {
      expect(screen.getByText('3 photos')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Gallery' })).toBeInTheDocument();
    // The roundDate (May 8) renders next to the round number in the same h2,
    // so the visible heading reads "Round 1May 8". Assert via partial match
    // and the grouped grid via tagName since <img alt=""> is decorative
    // and not in the accessibility tree (intentional — we don't want the
    // image elements announced as standalone content).
    expect(screen.getByRole('heading', { name: /Round 1/ })).toBeInTheDocument();
    expect(screen.getByText('Trip photos')).toBeInTheDocument();
    expect(container.querySelectorAll('img').length).toBe(3);
  });

  it('renders empty state and no photo count when groups is []', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EMPTY_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage({ eventId: 'evt-1', isOrganizer: false });
    await waitFor(() => {
      expect(screen.getByText('No photos yet')).toBeInTheDocument();
    });
    expect(screen.getByText(/add the first photo/i)).toBeInTheDocument();
  });

  it('renders forbidden state on 403', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 403 }));
    renderPage({ eventId: 'evt-1', isOrganizer: false });
    await waitFor(() => {
      expect(screen.getByText(/aren't a participant/i)).toBeInTheDocument();
    });
  });

  it('lightbox opens on photo tap and Close dismisses it', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(TWO_GROUP_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage({ eventId: 'evt-1', isOrganizer: false });
    await waitFor(() => {
      expect(screen.getByText('Round 1')).toBeInTheDocument();
    });

    // Tap first photo button.
    const photoButtons = screen.getAllByRole('button', { name: /View photo/i });
    fireEvent.click(photoButtons[0]!);
    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Photo viewer' })).not.toBeInTheDocument();
    });
  });

  it('non-organizer does not see delete buttons', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(TWO_GROUP_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage({ eventId: 'evt-1', isOrganizer: false });
    await waitFor(() => {
      expect(screen.getByText('Round 1')).toBeInTheDocument();
    });
    expect(screen.queryAllByRole('button', { name: 'Delete photo' }).length).toBe(0);
  });

  it('organizer sees delete buttons; clicking opens confirmation dialog', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(TWO_GROUP_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage({ eventId: 'evt-1', isOrganizer: true });
    await waitFor(() => {
      expect(screen.getByText('Round 1')).toBeInTheDocument();
    });
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete photo' });
    expect(deleteButtons.length).toBe(3);

    fireEvent.click(deleteButtons[0]!);
    expect(screen.getByRole('dialog', { name: 'Delete confirmation' })).toBeInTheDocument();
    expect(screen.getByText(/Delete this photo\?/i)).toBeInTheDocument();
  });

  it('Camera button triggers the camera input; Library button the library input', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EMPTY_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderPage({ eventId: 'evt-1', isOrganizer: false });
    await waitFor(() => {
      expect(screen.getByText('No photos yet')).toBeInTheDocument();
    });
    const cameraInput = screen.getByTestId('gallery-file-input') as HTMLInputElement;
    const libraryInput = screen.getByTestId('gallery-library-input') as HTMLInputElement;
    const cameraSpy = vi.spyOn(cameraInput, 'click');
    const librarySpy = vi.spyOn(libraryInput, 'click');
    fireEvent.click(screen.getByTestId('gallery-camera-btn'));
    expect(cameraSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('gallery-library-btn'));
    expect(librarySpy).toHaveBeenCalledTimes(1);
  });

  it('camera shot reveals the one-tap "Take another" affordance', async () => {
    let getCalls = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/gallery') && method === 'GET') {
        getCalls += 1;
        return new Response(JSON.stringify(EMPTY_FIXTURE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.endsWith('/gallery') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'new', roundId: null, signedUrl: 'x' }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    renderPage({ eventId: 'evt-1', isOrganizer: false });
    await waitFor(() => expect(screen.getByText('No photos yet')).toBeInTheDocument());

    const cameraInput = screen.getByTestId('gallery-file-input') as HTMLInputElement;
    const shot = new File([new Uint8Array([1])], 'shot.jpg', { type: 'image/jpeg' });
    fireEvent.change(cameraInput, { target: { files: [shot] } });

    // "Take another" appears after a camera shot and stays until Done.
    await waitFor(() => expect(screen.getByTestId('gallery-take-another')).toBeInTheDocument());
    expect(getCalls).toBeGreaterThanOrEqual(2); // initial + per-upload invalidate
  });

  it('sequential upload: progress text + per-file failure banner', async () => {
    // First fetch: initial GET
    // Then 2 POST uploads (one fails), then GET again on invalidate.
    let getCallCount = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/gallery') && method === 'GET') {
        getCallCount += 1;
        return new Response(JSON.stringify(EMPTY_FIXTURE), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.endsWith('/gallery') && method === 'POST') {
        // Determine which file by inspecting FormData.
        const fd = init!.body as FormData;
        const file = fd.get('photo') as File;
        if (file.name === 'fail.jpg') {
          return new Response(JSON.stringify({ error: 'file_too_large' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ id: 'new', roundId: null, signedUrl: 'x' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    });

    renderPage({ eventId: 'evt-1', isOrganizer: false });
    await waitFor(() => {
      expect(screen.getByText('No photos yet')).toBeInTheDocument();
    });

    const input = screen.getByTestId('gallery-file-input') as HTMLInputElement;
    const ok = new File([new Uint8Array([1])], 'ok.jpg', { type: 'image/jpeg' });
    const fail = new File([new Uint8Array([2])], 'fail.jpg', { type: 'image/jpeg' });

    fireEvent.change(input, { target: { files: [ok, fail] } });

    // Wait for progress to clear and the failure banner to surface.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/1 upload failed/);
    });
    expect(screen.getByText(/fail\.jpg/)).toBeInTheDocument();
    expect(screen.getByText(/file_too_large/)).toBeInTheDocument();

    // GET ran at least twice (initial + post-upload invalidate).
    expect(getCallCount).toBeGreaterThanOrEqual(2);
  });
});
