/**
 * T2-3b: minimal organizer upload UI for /admin/courses/upload.
 *
 * The user-facing half of the phone-photo + PDF flow shipped by T2-3 +
 * T2-3a. Calls POST /api/admin/courses/parse-pdf with a file from the
 * picker (or phone camera via capture="environment"); displays parsed
 * course summary on success or a friendly error message on failure.
 *
 * Auth guard: route loader calls GET /api/auth/status. Anonymous /
 * fetch-error → window.location.assign('/api/auth/google'). Authenticated
 * non-organizer → render inline forbidden message. Authenticated
 * organizer → render upload form.
 *
 * Dual-export: `Route` for TanStack file-route registration AND
 * `UploadCoursePage` for direct test rendering (per AC #6 spec).
 */

import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { queryClient } from '../lib/query-client';

// ---- Loader ---------------------------------------------------------------

type AuthStatus = { player: null | { id: string; isOrganizer: boolean } };

/**
 * Validates the /api/auth/status response shape. Returns the body if
 * shape-conformant; returns `{ player: null }` otherwise.
 */
function validateAuthStatus(body: unknown): AuthStatus {
  if (body === null || typeof body !== 'object') return { player: null };
  const p = (body as { player?: unknown }).player;
  if (p === null) return { player: null };
  if (
    p !== null &&
    typeof p === 'object' &&
    typeof (p as { id?: unknown }).id === 'string' &&
    typeof (p as { isOrganizer?: unknown }).isOrganizer === 'boolean'
  ) {
    return { player: { id: (p as { id: string }).id, isOrganizer: (p as { isOrganizer: boolean }).isOrganizer } };
  }
  return { player: null };
}

/**
 * Loader for /admin/courses/upload. Five-step contract per spec
 * Risk Acceptance §3 — covers fetch failure, !ok responses, JSON parse
 * failures, body=null, and shape mismatches by collapsing every error
 * path into `{ player: null }` (which then triggers the OAuth redirect).
 */
async function loadAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status').catch(() => null);
  if (res === null || !res.ok) return { player: null };
  const body = (await res.json().catch(() => null)) as unknown;
  if (body === null) return { player: null };
  return validateAuthStatus(body);
}

// ---- Component ------------------------------------------------------------

const ACCEPT_MIMES =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'success'; data: ParsedCourse }
  | { kind: 'error'; userMessage: string };

type ParsedCourse = {
  name: string;
  club_name: string;
  tees: Array<{ color: string; rating: number; slope: number }>;
  holes: Array<{ number: number; par: number; si: number; yardages: Record<string, number> }>;
  totals: { out_total: number; in_total: number; course_total: number };
};

const ERROR_MESSAGES: Record<string, string> = {
  missing_file: 'Please pick a file before submitting.',
  file_too_large: 'File is too large (10 MB max). Please use a smaller image or PDF.',
  wrong_mime: "We can't open that kind of file. Please use a PDF or a JPEG / PNG / WebP image.",
  wrong_magic: "That file looks corrupted or isn't actually a PDF/image. Try a different file.",
  unsupported_mime_heic: 'iPhone photos are HEIC by default. Please convert to JPEG and try again.',
  unsupported_mime_gif: "GIFs aren't supported. Please use a static image (JPEG / PNG / WebP) or a PDF.",
  vision_api_failed:
    'Parser is unavailable. Please try again in a minute, or enter the course manually from the admin home.',
};

function userMessageFromCode(code: string | undefined | null): string {
  if (code && code in ERROR_MESSAGES) return ERROR_MESSAGES[code]!;
  return 'Something went wrong. Please try again.';
}

export function UploadCoursePage() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight upload on unmount. Without this, navigating away
  // mid-upload leaves an orphaned fetch that may eventually return and
  // call setState on an unmounted component (React would warn at best, or
  // worse, the cancelled response would briefly flash success/error UI
  // when the user re-mounts the route).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function reset(): void {
    setFile(null);
    setState({ kind: 'idle' });
    abortRef.current = null;
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!file) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setState({ kind: 'uploading' });

    const form = new FormData();
    form.append('pdf', file);

    try {
      const res = await fetch('/api/admin/courses/parse-pdf', {
        method: 'POST',
        body: form,
        signal: ac.signal,
      });

      // Race guard: if the user clicked Cancel between the fetch
      // resolving and this point reaching, ac.signal.aborted will be true
      // and we MUST NOT setState — the reset() inside onCancel already
      // transitioned us back to idle.
      if (ac.signal.aborted) return;

      if (res.ok) {
        const data = (await res.json()) as ParsedCourse;
        if (ac.signal.aborted) return;
        setState({ kind: 'success', data });
        return;
      }

      const errBody = (await res.json().catch(() => null)) as { code?: string } | null;
      if (ac.signal.aborted) return;
      setState({ kind: 'error', userMessage: userMessageFromCode(errBody?.code ?? null) });
    } catch (err) {
      // AbortError on user-cancel is expected; reset() already handles state.
      if (err instanceof Error && err.name === 'AbortError') return;
      if (ac.signal.aborted) return;
      setState({ kind: 'error', userMessage: 'Network error. Please try again.' });
    }
  }

  function onCancel(): void {
    abortRef.current?.abort();
    reset();
  }

  // ---- Render branches ---------------------------------------------------

  if (state.kind === 'success') {
    const { data } = state;
    const firstHole = data.holes[0];
    return (
      <div>
        <h1>Parsed: {data.name}</h1>
        <p>{data.club_name}</p>
        <h2>Tees ({data.tees.length})</h2>
        <ul>
          {data.tees.map((t) => (
            <li key={t.color}>
              {t.color} — rating {t.rating}, slope {t.slope}
            </li>
          ))}
        </ul>
        <p>
          Printed totals: out {data.totals.out_total}, in {data.totals.in_total}, course{' '}
          {data.totals.course_total}
        </p>
        {firstHole !== undefined ? (
          <>
            <h3>Hole 1 yardages (sample)</h3>
            <ul>
              {Object.entries(firstHole.yardages).map(([color, y]) => (
                <li key={color}>
                  {color}: {y}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <button type="button" onClick={reset}>
          Try another
        </button>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div>
        <h1>Upload failed</h1>
        <p>{state.userMessage}</p>
        <button type="button" onClick={reset}>
          Try another file
        </button>
      </div>
    );
  }

  if (state.kind === 'uploading') {
    return (
      <div>
        <h1>Reading scorecard...</h1>
        <p>This may take ~15 seconds.</p>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  // idle
  return (
    <form onSubmit={onSubmit}>
      <h1>Upload a scorecard</h1>
      <p>Pick a PDF or take a photo of a printed scorecard.</p>
      <label htmlFor="scorecard-file">Scorecard file</label>
      <input
        id="scorecard-file"
        type="file"
        name="pdf"
        accept={ACCEPT_MIMES}
        capture="environment"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button type="submit" disabled={!file}>
        Submit
      </button>
    </form>
  );
}

// ---- Inline forbidden message (rendered when authed but not organizer) ----

function ForbiddenMessage() {
  return (
    <div>
      <h1>Not an organizer</h1>
      <p>
        You're signed in but don't have organizer permissions. Contact Josh to grant organizer
        access, or <a href="/api/auth/google">sign in as a different account</a>.
      </p>
    </div>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/admin/courses/upload')({
  beforeLoad: async () => {
    // TanStack Query caching per spec Risk Acceptance §3: 30s staleTime
    // (a freshly-promoted organizer sees the change within 30s of
    // navigation), retry: false (a failing /api/auth/status surfaces via
    // the redirect-to-OAuth branch, not via retry storms).
    const status = await queryClient.ensureQueryData({
      queryKey: ['auth-status'],
      queryFn: loadAuthStatus,
      staleTime: 30_000,
      retry: false,
    });
    if (status.player === null) {
      // Same-origin relative URL — works in production AND local dev (Vite
      // proxy forwards /api/* to the API). Must escape the SPA so the
      // OAuth Set-Cookie + 302 round-trip can complete.
      window.location.assign('/api/auth/google');
      // The browser navigates away before TanStack Router resolves the
      // loader. Throwing keeps TanStack Router from rendering anything in
      // the meantime.
      throw new Error('redirecting-to-oauth');
    }
    return { player: status.player };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  if (!player.isOrganizer) return <ForbiddenMessage />;
  return <UploadCoursePage />;
}
