import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { Camera, Images, Check, Loader2, X, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, apiFetchFormData } from '@/lib/api';
import { getSession } from '@/lib/session-store';

export const Route = createFileRoute('/gallery')({
  component: GalleryPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Photo = {
  id: number;
  roundId: number | null;
  publicUrl: string;
  caption: string | null;
  createdAt: number;
  playerName: string | null;
  roundDate?: string | null;
};

type GalleryResponse = {
  photos: Photo[];
  total: number;
};

type UploadResponse = {
  id: number;
  publicUrl: string;
  roundId: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatRoundDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Lightbox
// ---------------------------------------------------------------------------

function Lightbox({
  photo,
  onClose,
}: {
  photo: Photo;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white z-[101]"
        aria-label="Close"
      >
        <X className="h-6 w-6" />
      </button>
      <div
        className="max-w-full max-h-full flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={photo.publicUrl}
          alt={photo.caption ?? 'Gallery photo'}
          className="max-w-full max-h-[80vh] rounded-lg object-contain"
        />
        <div className="text-center text-sm">
          {photo.caption && (
            <p className="text-white font-medium">{photo.caption}</p>
          )}
          <p className="text-white/50 text-xs mt-1">
            {formatDate(photo.createdAt)}
            {photo.playerName && ` · ${photo.playerName}`}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function GalleryPage() {
  const queryClient = useQueryClient();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);

  // Background upload queue: each photo uploads one-at-a-time so you can keep
  // shooting while earlier shots upload. No caption, no confirm tap — selecting
  // (camera or library) fires the upload. `uploading` = count still in flight
  // or queued; `cameraActive` reveals the one-tap "Take another" affordance.
  const queueRef = useRef<File[]>([]);
  const drainingRef = useRef(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['gallery'],
    queryFn: () => apiFetch<GalleryResponse>('/gallery?limit=100'),
  });

  const drainQueue = async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    const session = getSession();
    const headers: Record<string, string> = {};
    if (session?.entryCode) headers['x-entry-code'] = session.entryCode;
    while (queueRef.current.length > 0) {
      const file = queueRef.current.shift()!;
      setUploading(queueRef.current.length + 1); // queued + this one in flight
      try {
        const formData = new FormData();
        formData.append('photo', file);
        if (session?.roundId) formData.append('roundId', String(session.roundId));
        await apiFetchFormData<UploadResponse>('/gallery/upload', formData, headers);
        queryClient.invalidateQueries({ queryKey: ['gallery'] }); // show each as it lands
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      }
    }
    drainingRef.current = false;
    setUploading(0);
  };

  const enqueueFiles = (files: File[]) => {
    if (files.length === 0) return;
    setUploadError(null);
    queueRef.current.push(...files);
    setUploading(queueRef.current.length);
    void drainQueue();
  };

  const handleCameraSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      enqueueFiles(Array.from(files));
      setCameraActive(true); // keep the "Take another" path visible
    }
    e.target.value = ''; // allow re-capture of an identical frame
  };

  const handleLibrarySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) enqueueFiles(Array.from(files));
    e.target.value = '';
  };

  const openCamera = () => cameraInputRef.current?.click();
  const openLibrary = () => libraryInputRef.current?.click();

  // Group photos by round
  const photos = data?.photos ?? [];
  const grouped = new Map<string, Photo[]>();
  for (const photo of photos) {
    const key = photo.roundDate
      ? `round-${photo.roundId}`
      : 'general';
    const arr = grouped.get(key) ?? [];
    arr.push(photo);
    grouped.set(key, arr);
  }

  // Sort groups: rounds by date desc, general at end
  const sortedGroups = [...grouped.entries()].sort((a, b) => {
    if (a[0] === 'general') return 1;
    if (b[0] === 'general') return -1;
    const aDate = a[1][0]?.roundDate ?? '';
    const bDate = b[1][0]?.roundDate ?? '';
    return bDate.localeCompare(aDate);
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
          >
            <ChevronLeft className="h-3 w-3" />
            Board
          </Link>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Gallery
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={openCamera}
            data-testid="gallery-camera-btn"
          >
            <Camera className="h-4 w-4" />
            Camera
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            onClick={openLibrary}
            data-testid="gallery-library-btn"
          >
            <Images className="h-4 w-4" />
            Library
          </Button>
        </div>
        {/* Camera → straight to the camera (one shot per session on iOS). */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleCameraSelect}
        />
        {/* Library → pick existing photos, multi-select. */}
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleLibrarySelect}
        />
      </div>

      {/* Background-upload status + one-tap "Take another" (camera flow). */}
      {(uploading > 0 || cameraActive) && (
        <div className="rounded-xl border bg-card p-3 mb-4 flex items-center gap-3">
          {uploading > 0 ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-green-500 shrink-0" />
              <span className="text-sm flex-1">
                Uploading {uploading} photo{uploading > 1 ? 's' : ''}…
              </span>
            </>
          ) : (
            <>
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              <span className="text-sm flex-1">Uploaded</span>
            </>
          )}
          {cameraActive && (
            <div className="flex gap-2 shrink-0">
              <Button size="sm" className="gap-1" onClick={openCamera} data-testid="gallery-take-another">
                <Camera className="h-3.5 w-3.5" />
                Take another
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCameraActive(false)}>
                Done
              </Button>
            </div>
          )}
        </div>
      )}
      {uploadError && (
        <p className="text-xs text-destructive mb-4">Upload failed: {uploadError}</p>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="text-center py-8 text-muted-foreground">
          Could not load gallery
        </div>
      )}

      {/* Empty state */}
      {!isLoading && photos.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Camera className="h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground">No photos yet</p>
          <p className="text-xs text-muted-foreground/60">
            Snap some pics on the course and upload them here
          </p>
        </div>
      )}

      {/* Photo groups */}
      {sortedGroups.map(([key, groupPhotos]) => {
        const roundDate = groupPhotos[0]?.roundDate;
        const label = key === 'general'
          ? 'General'
          : roundDate
            ? formatRoundDate(roundDate)
            : 'Round';

        return (
          <div key={key} className="mb-6">
            <h2 className="text-sm font-semibold text-muted-foreground mb-2">
              {key !== 'general' && '⛳ '}
              {label}
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {groupPhotos.map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => setLightboxPhoto(photo)}
                  className="relative aspect-square rounded-lg overflow-hidden bg-muted hover:opacity-90 transition-opacity"
                >
                  <img
                    src={photo.publicUrl}
                    alt={photo.caption ?? ''}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {photo.caption && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                      <p className="text-[10px] text-white truncate">
                        {photo.caption}
                      </p>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Lightbox */}
      {lightboxPhoto && (
        <Lightbox
          photo={lightboxPhoto}
          onClose={() => setLightboxPhoto(null)}
        />
      )}
    </div>
  );
}
