/**
 * T7-4 Photo Gallery page.
 *
 * Route: /events/:eventId/gallery
 *
 * Mirrors T7-1's auth-then-data pattern: anonymous → redirect to OAuth;
 * 403 → forbidden card. Uploads happen sequentially when the user picks
 * multiple files (Wolf Cup 2026-03-22 pattern); per-file failures
 * accumulate into a summary banner without aborting siblings.
 *
 * The lightbox uses a native fullscreen overlay; pinch-zoom on iOS Safari
 * and double-tap-zoom on Android Chrome are handled by the browser. No
 * custom zoom widget in v1.
 *
 * Dual-export: `Route` (file-route registration) + `GalleryPage` (test seam).
 */

import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { useMarkMutation } from '../hooks/use-first-mutation';

// ---- Auth-status loader (mirror T7-1) ------------------------------------

// ---- Types ----------------------------------------------------------------

export type Photo = {
  id: string;
  signedUrl: string;
  contentType: string;
  uploadedAt: number;
  uploaderName: string | null;
};

export type Group = {
  roundId: string | null;
  roundDate: number | null;
  roundNumber: number | null;
  photos: Photo[];
};

export type GalleryResponse = { groups: Group[] };

type FetchOutcome =
  | { kind: 'ok'; data: GalleryResponse }
  | { kind: 'forbidden' };

async function fetchGallery(eventId: string): Promise<FetchOutcome> {
  const res = await fetch(`/api/events/${eventId}/gallery`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) throw new Error(`gallery_fetch_failed_${res.status}`);
  const body = (await res.json()) as GalleryResponse;
  return { kind: 'ok', data: body };
}

// ---- Helpers --------------------------------------------------------------

function groupLabel(group: Group): string {
  if (group.roundId === null) return 'Other photos';
  if (group.roundNumber !== null) return `Round ${group.roundNumber}`;
  return 'Round';
}

function totalPhotoCount(groups: Group[]): number {
  return groups.reduce((n, g) => n + g.photos.length, 0);
}

// ---- Component ------------------------------------------------------------

export type GalleryPageProps = {
  eventId: string;
  isOrganizer: boolean;
};

export function GalleryPage({ eventId, isOrganizer }: GalleryPageProps) {
  const qc = useQueryClient();
  const markMutation = useMarkMutation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [uploadErrors, setUploadErrors] = useState<
    Array<{ filename: string; reason: string }>
  >([]);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Photo | null>(null);

  const query = useQuery<FetchOutcome>({
    queryKey: ['gallery', eventId],
    queryFn: () => fetchGallery(eventId),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (photoId: string) => {
      const res = await fetch(`/api/events/${eventId}/gallery/${photoId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`delete_failed_${res.status}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['gallery', eventId] });
    },
  });

  function openPicker() {
    fileInputRef.current?.click();
  }

  async function uploadOne(file: File): Promise<void> {
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch(`/api/events/${eventId}/gallery`, {
      method: 'POST',
      credentials: 'same-origin',
      body: fd,
    });
    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      const body = (await res.json().catch(() => null)) as
        | { error?: string; maxBytes?: number }
        | null;
      if (body?.error) reason = body.error;
      throw new Error(reason);
    }
    // T7-6 — first successful upload in this session counts as a mutation.
    markMutation();
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setUploadErrors([]);
    setProgress({ current: 0, total: list.length });

    const errs: Array<{ filename: string; reason: string }> = [];
    for (let i = 0; i < list.length; i++) {
      setProgress({ current: i + 1, total: list.length });
      try {
        await uploadOne(list[i]!);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        errs.push({ filename: list[i]!.name, reason });
      }
    }
    setProgress(null);
    setUploadErrors(errs);
    await qc.invalidateQueries({ queryKey: ['gallery', eventId] });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (query.isPending) {
    return (
      <PageShell title="Gallery">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Gallery">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Couldn't load the gallery."
          error={query.error}
          onRetry={query.refetch}
        />
      </PageShell>
    );
  }
  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Gallery">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Not a participant"
          error="You aren't a participant in this event."
        />
      </PageShell>
    );
  }

  const groups = outcome.data.groups;
  const count = totalPhotoCount(groups);

  return (
    <PageShell title="Gallery">
      <BackLink to="/events/$eventId" params={{ eventId }} />
      <div style={{ paddingBottom: 96 }}>
      <div style={{ color: '#555', fontSize: '0.9rem', marginBottom: 12 }}>
        {count === 0
          ? 'No photos yet'
          : `${count} photo${count === 1 ? '' : 's'}`}
      </div>

      {progress && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: '#eef',
            borderRadius: 6,
          }}
        >
          Uploading {progress.current} of {progress.total}…
        </div>
      )}

      {uploadErrors.length > 0 && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: '#fee',
            border: '1px solid #f99',
            borderRadius: 6,
          }}
        >
          <strong>
            {uploadErrors.length} upload{uploadErrors.length === 1 ? '' : 's'} failed:
          </strong>
          <ul style={{ margin: '4px 0 0 16px' }}>
            {uploadErrors.map((e, i) => (
              <li key={i}>
                {e.filename} — {e.reason}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setUploadErrors([])}
            style={{ marginTop: 4 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {groups.length === 0 && !progress && (
        <EmptyState icon="📸" title="Tap the camera button to add the first photo." />
      )}

      {groups.map((g) => (
        <section
          key={g.roundId ?? '__unassociated'}
          style={{ marginBottom: 24 }}
        >
          <h2
            style={{
              fontSize: '1rem',
              borderBottom: '1px solid #ddd',
              paddingBottom: 4,
            }}
          >
            {groupLabel(g)}
            {g.roundDate !== null && (
              <span style={{ color: '#888', marginLeft: 8, fontWeight: 'normal' }}>
                {new Date(g.roundDate).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            )}
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 6,
              marginTop: 8,
            }}
          >
            {g.photos.map((p) => (
              <figure
                key={p.id}
                style={{ margin: 0, position: 'relative' }}
              >
                <button
                  type="button"
                  onClick={() => setLightbox(p)}
                  aria-label={`View photo by ${p.uploaderName ?? 'someone'}`}
                  style={{
                    display: 'block',
                    border: 0,
                    padding: 0,
                    width: '100%',
                    aspectRatio: '1 / 1',
                    background: '#000',
                    cursor: 'pointer',
                  }}
                >
                  <img
                    src={p.signedUrl}
                    alt=""
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                </button>
                {isOrganizer && (
                  <button
                    type="button"
                    aria-label="Delete photo"
                    onClick={() => setPendingDelete(p)}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      background: 'rgba(255,255,255,0.85)',
                      border: '1px solid #999',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      padding: '2px 6px',
                    }}
                  >
                    🗑
                  </button>
                )}
              </figure>
            ))}
          </div>
        </section>
      ))}

      {/* Hidden file input — triggered by FAB. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => void handleFilesSelected(e.currentTarget.files)}
        data-testid="gallery-file-input"
      />

      {/* Floating action button (camera). */}
      <button
        type="button"
        onClick={openPicker}
        aria-label="Upload photos"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: 0,
          background: '#0a5',
          color: '#fff',
          fontSize: '1.5rem',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        📷
      </button>

      {/* Lightbox. */}
      {lightbox && (
        <div
          role="dialog"
          aria-label="Photo viewer"
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(null);
            }}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              background: 'rgba(255,255,255,0.85)',
              border: 0,
              borderRadius: 4,
              fontSize: '1rem',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
          <img
            src={lightbox.signedUrl}
            alt=""
            style={{ maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain' }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Delete confirmation. */}
      {pendingDelete && (
        <div
          role="dialog"
          aria-label="Delete confirmation"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: 16,
              borderRadius: 8,
              maxWidth: 400,
            }}
          >
            <p style={{ marginTop: 0 }}>Delete this photo? This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = pendingDelete.id;
                  setPendingDelete(null);
                  deleteMutation.mutate(id);
                }}
                style={{ background: '#c33', color: '#fff', border: 0, padding: '6px 12px', borderRadius: 4 }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </PageShell>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/gallery')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const ctx = Route.useRouteContext();
  return <GalleryPage eventId={eventId} isOrganizer={ctx.player.isOrganizer} />;
}
