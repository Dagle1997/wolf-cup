import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { Camera, Upload, Loader2, X, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch, apiFetchFormData } from '@/lib/api';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [caption, setCaption] = useState('');
  const [showCaptionInput, setShowCaptionInput] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['gallery'],
    queryFn: () => apiFetch<GalleryResponse>('/gallery?limit=100'),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('photo', file);
      if (caption.trim()) formData.append('caption', caption.trim());
      return apiFetchFormData<UploadResponse>('/gallery/upload', formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery'] });
      setCaption('');
      setShowCaptionInput(false);
      setPendingFile(null);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    setShowCaptionInput(true);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleUpload = () => {
    if (!pendingFile) return;
    uploadMutation.mutate(pendingFile);
  };

  const handleCancelUpload = () => {
    setPendingFile(null);
    setShowCaptionInput(false);
    setCaption('');
  };

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
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          <Upload className="h-3.5 w-3.5" />
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Caption input + confirm (shown after file selected) */}
      {showCaptionInput && pendingFile && (
        <div className="rounded-xl border bg-card p-4 mb-4 space-y-3">
          <div className="flex items-center gap-3">
            <img
              src={URL.createObjectURL(pendingFile)}
              alt="Preview"
              className="w-16 h-16 rounded-lg object-cover shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{pendingFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(pendingFile.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
          </div>
          <input
            type="text"
            placeholder="Add a caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/50"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={handleUpload}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  Uploading…
                </>
              ) : (
                'Upload Photo'
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancelUpload}
              disabled={uploadMutation.isPending}
            >
              Cancel
            </Button>
          </div>
          {uploadMutation.isError && (
            <p className="text-xs text-destructive">
              Upload failed: {uploadMutation.error.message}
            </p>
          )}
        </div>
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
