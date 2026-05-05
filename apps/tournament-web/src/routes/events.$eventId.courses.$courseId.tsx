/**
 * T7-3 course preview page.
 *
 * Route: /events/:eventId/courses/:courseId
 *
 * Renders header (neutral gradient + course name + clubName) +
 * tee-selector chips + 18-hole table + Out/In/Total totals.
 *
 * Hero image deferred (T7-3a) — no schema field. Header uses a gradient
 * placeholder.
 *
 * Auth: leaderboard pattern — beforeLoad redirects anonymous; data
 * fetch 403 → inline forbidden card. The 403 covers all cases where the
 * course isn't part of this event (uniform shape per spec AC-2).
 *
 * Dual-export: `Route` + `CoursePreviewPage` for direct test rendering.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../lib/query-client';

// ---- Types ----------------------------------------------------------------

type CoursePreviewResponse = {
  course: { id: string; name: string; clubName: string };
  revision: {
    id: string;
    revisionNumber: number;
    outTotal: number;
    inTotal: number;
    courseTotal: number;
  };
  tees: Array<{ teeColor: string; rating: number; slope: number }>;
  holes: Array<{
    holeNumber: number;
    par: 3 | 4 | 5;
    si: number;
    yardageByTee: Record<string, number>;
  }>;
  defaultTeeColor: string | null;
};

type FetchOutcome =
  | { kind: 'ok'; data: CoursePreviewResponse }
  | { kind: 'forbidden' };

// ---- Auth-status loader (mirror leaderboard) ------------------------------

type AuthStatus = { player: null | { id: string; isOrganizer: boolean } };

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
    return {
      player: {
        id: (p as { id: string }).id,
        isOrganizer: (p as { isOrganizer: boolean }).isOrganizer,
      },
    };
  }
  return { player: null };
}

async function loadAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status').catch(() => null);
  if (res === null || !res.ok) return { player: null };
  const body = (await res.json().catch(() => null)) as unknown;
  if (body === null) return { player: null };
  return validateAuthStatus(body);
}

// ---- Course preview fetcher -----------------------------------------------

async function fetchCourse(eventId: string, courseId: string): Promise<FetchOutcome> {
  const res = await fetch(`/api/events/${eventId}/courses/${courseId}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) throw new Error(`course_fetch_failed_${res.status}`);
  const body = (await res.json()) as CoursePreviewResponse;
  return { kind: 'ok', data: body };
}

// ---- Helpers --------------------------------------------------------------

const DASH = '—';

/**
 * Sum yardages for a contiguous hole range at a given tee. Returns the
 * formatted string: integer total, OR `—` if any hole in the range is
 * missing yardage for that tee (no partial sums per spec AC-5).
 */
export function rangeYardageTotal(
  holes: Array<{ holeNumber: number; yardageByTee: Record<string, number> }>,
  fromHole: number,
  toHole: number,
  tee: string,
): number | null {
  let sum = 0;
  for (const h of holes) {
    if (h.holeNumber < fromHole || h.holeNumber > toHole) continue;
    const y = h.yardageByTee[tee];
    if (typeof y !== 'number') return null;
    sum += y;
  }
  return sum;
}

// ---- Component ------------------------------------------------------------

export type CoursePreviewPageProps = {
  eventId: string;
  courseId: string;
};

export function CoursePreviewPage({ eventId, courseId }: CoursePreviewPageProps) {
  const query = useQuery<FetchOutcome>({
    queryKey: ['coursePreview', eventId, courseId],
    queryFn: () => fetchCourse(eventId, courseId),
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <div>
        <h1>Course</h1>
        <p>Loading…</p>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div>
        <h1>Course</h1>
        <p role="alert">
          Couldn&apos;t load the course. {String(query.error)}
        </p>
      </div>
    );
  }
  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <div>
        <h1>Course</h1>
        <p role="alert">
          You aren&apos;t a participant in this event, or this course isn&apos;t part of it.
        </p>
      </div>
    );
  }

  return <CoursePreviewView data={outcome.data} />;
}

function CoursePreviewView({ data }: { data: CoursePreviewResponse }) {
  const { course, revision, tees, holes, defaultTeeColor } = data;

  // Initial tee: defaultTeeColor if set, else first tee alphabetically
  // (which matches the lowercase ASC ordering already applied server-side).
  const initialTee = defaultTeeColor ?? (tees[0]?.teeColor ?? '');
  const [selectedTee, setSelectedTee] = useState<string>(initialTee);

  const outYardage = rangeYardageTotal(holes, 1, 9, selectedTee);
  const inYardage = rangeYardageTotal(holes, 10, 18, selectedTee);
  const totalYardage = rangeYardageTotal(holes, 1, 18, selectedTee);

  return (
    <div>
      <header
        style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
          color: 'white',
          padding: '24px 16px',
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.75rem' }}>{course.name}</h1>
        <div style={{ marginTop: 4, opacity: 0.9 }}>{course.clubName}</div>
      </header>

      <div role="group" aria-label="Tee selector" style={{ marginBottom: 12 }}>
        {tees.map((t) => (
          <button
            key={t.teeColor}
            type="button"
            onClick={() => setSelectedTee(t.teeColor)}
            aria-pressed={t.teeColor === selectedTee}
            style={{
              marginRight: 6,
              padding: '4px 10px',
              borderRadius: 14,
              border: t.teeColor === selectedTee ? '2px solid #1e3a8a' : '1px solid #ccc',
              backgroundColor: t.teeColor === selectedTee ? '#eff6ff' : 'transparent',
              fontWeight: t.teeColor === selectedTee ? 'bold' : 'normal',
              cursor: 'pointer',
            }}
          >
            {t.teeColor}
          </button>
        ))}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={cellStyle}>Hole</th>
            <th style={cellStyle}>Par</th>
            <th style={cellStyle}>Yardage</th>
            <th style={cellStyle}>SI</th>
          </tr>
        </thead>
        <tbody>
          {holes.map((h) => (
            <tr key={h.holeNumber}>
              <td style={cellStyle}>{h.holeNumber}</td>
              <td style={cellStyle}>{h.par}</td>
              <td style={cellStyle}>{formatYardage(h.yardageByTee[selectedTee])}</td>
              <td style={cellStyle}>{h.si}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 'bold', borderTop: '2px solid #ccc' }}>
            <td style={cellStyle}>Out</td>
            <td style={cellStyle}>{revision.outTotal}</td>
            <td style={cellStyle}>{outYardage === null ? DASH : outYardage}</td>
            <td style={cellStyle} aria-hidden="true">—</td>
          </tr>
          <tr style={{ fontWeight: 'bold' }}>
            <td style={cellStyle}>In</td>
            <td style={cellStyle}>{revision.inTotal}</td>
            <td style={cellStyle}>{inYardage === null ? DASH : inYardage}</td>
            <td style={cellStyle} aria-hidden="true">—</td>
          </tr>
          <tr style={{ fontWeight: 'bold' }}>
            <td style={cellStyle}>Total</td>
            <td style={cellStyle}>{revision.courseTotal}</td>
            <td style={cellStyle}>{totalYardage === null ? DASH : totalYardage}</td>
            <td style={cellStyle} aria-hidden="true">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: '6px 8px',
  textAlign: 'center',
  borderBottom: '1px solid #eee',
};

function formatYardage(y: number | undefined): string {
  if (typeof y !== 'number') return DASH;
  return String(y);
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/courses/$courseId')({
  beforeLoad: async () => {
    const status = await queryClient.fetchQuery({
      queryKey: ['auth-status'],
      queryFn: loadAuthStatus,
      staleTime: 30_000,
      retry: false,
    });
    if (status.player === null) {
      window.location.assign('/api/auth/google');
      throw new Error('redirecting-to-oauth');
    }
    return { player: status.player };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId, courseId } = Route.useParams();
  return <CoursePreviewPage eventId={eventId} courseId={courseId} />;
}
