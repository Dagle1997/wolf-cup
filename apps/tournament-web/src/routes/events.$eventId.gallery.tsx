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
import { Button } from '../components/button';
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
  // A photo with no round (taken when no round was active) is a TRIP photo;
  // per-round photos group under their round. Two galleries, one page.
  if (group.roundId === null) return 'Trip photos';
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
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  // Background upload queue (Wolf Cup streamlined pattern): each photo uploads
  // one-at-a-time so you can keep shooting while earlier shots upload. No
  // caption/confirm tap — selecting fires the upload; `cameraActive` reveals the
  // one-tap "Take another" affordance after a camera shot.
  const queueRef = useRef<File[]>([]);
  const drainingRef = useRef(false);
  const [uploading, setUploading] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
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

  function openCamera() {
    cameraInputRef.current?.click();
  }
  function openLibrary() {
    libraryInputRef.current?.click();
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

  // Drain the queue one file at a time; each lands in the grid as it completes
  // (per-photo invalidate). Per-file failures accumulate into the banner.
  async function drainQueue() {
    if (drainingRef.current) return;
    drainingRef.current = true;
    const errs: Array<{ filename: string; reason: string }> = [];
    while (queueRef.current.length > 0) {
      const file = queueRef.current.shift()!;
      setUploading(queueRef.current.length + 1); // queued + this one in flight
      try {
        await uploadOne(file);
        await qc.invalidateQueries({ queryKey: ['gallery', eventId] });
      } catch (e) {
        errs.push({ filename: file.name, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    drainingRef.current = false;
    setUploading(0);
    if (errs.length > 0) setUploadErrors((prev) => [...prev, ...errs]);
  }

  function enqueue(files: File[]) {
    if (files.length === 0) return;
    setUploadErrors([]);
    queueRef.current.push(...files);
    setUploading(queueRef.current.length);
    void drainQueue();
  }

  function handleCameraSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.currentTarget.files;
    if (files && files.length > 0) {
      enqueue(Array.from(files));
      setCameraActive(true); // keep the "Take another" path visible
    }
    e.currentTarget.value = ''; // allow re-capture of an identical frame
  }
  function handleLibrarySelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.currentTarget.files;
    if (files && files.length > 0) enqueue(Array.from(files));
    e.currentTarget.value = '';
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
      <div style={{ paddingBottom: 24 }}>
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: 'var(--space-3)' }}>
        {count === 0
          ? 'No photos yet'
          : `${count} photo${count === 1 ? '' : 's'}`}
      </div>

      {/* Camera-direct (one shot) + Library (multi-select). Both feed the
          background queue so you can keep shooting while uploads run. */}
      <div className="actions-row" style={{ marginBottom: 'var(--space-3)' }}>
        <Button data-testid="gallery-camera-btn" onClick={openCamera}>
          📷 Camera
        </Button>
        <Button variant="secondary" data-testid="gallery-library-btn" onClick={openLibrary}>
          🖼 Library
        </Button>
      </div>

      {(uploading > 0 || cameraActive) && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginBottom: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--color-brand-tint)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <span style={{ flex: 1 }}>
            {uploading > 0 ? `Uploading ${uploading} photo${uploading > 1 ? 's' : ''}…` : 'Uploaded'}
          </span>
          {cameraActive && (
            <span className="actions-row">
              <Button data-testid="gallery-take-another" onClick={openCamera}>
                Take another
              </Button>
              <Button variant="secondary" onClick={() => setCameraActive(false)}>
                Done
              </Button>
            </span>
          )}
        </div>
      )}

      {uploadErrors.length > 0 && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
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

      {groups.length === 0 && uploading === 0 && (
        <EmptyState icon="📸" title="Tap Camera or Library to add the first photo." />
      )}

      {groups.map((g) => (
        <section
          key={g.roundId ?? '__unassociated'}
          style={{ marginBottom: 24 }}
        >
          <h2
            style={{
              fontSize: '1rem',
              borderBottom: '1px solid var(--color-border)',
              paddingBottom: 4,
            }}
          >
            {groupLabel(g)}
            {g.roundDate !== null && (
              <span style={{ color: 'var(--color-text-muted)', marginLeft: 8, fontWeight: 'normal' }}>
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
                    background: 'var(--color-text-primary)',
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
                      border: '1px solid var(--color-text-muted)',
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

      {/* Camera → straight to the camera (one shot per tap on iOS). */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleCameraSelect}
        data-testid="gallery-file-input"
      />
      {/* Library → pick existing photos, multi-select. */}
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleLibrarySelect}
        data-testid="gallery-library-input"
      />

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
              background: 'var(--color-surface)',
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
                style={{ background: 'var(--color-danger)', color: '#fff', border: 0, padding: '6px 12px', borderRadius: 4 }}
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
