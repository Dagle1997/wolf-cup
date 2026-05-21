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
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

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
      <PageShell title="Course">
        <BackLink to="/events/$eventId/schedule" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Course">
        <BackLink to="/events/$eventId/schedule" params={{ eventId }} />
        <ErrorCard
          title="Couldn't load the course."
          error={query.error}
          onRetry={query.refetch}
        />
      </PageShell>
    );
  }
  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Course">
        <BackLink to="/events/$eventId/schedule" params={{ eventId }} />
        <ErrorCard
          title="Not available"
          error="You aren't a participant in this event, or this course isn't part of it."
        />
      </PageShell>
    );
  }

  return <CoursePreviewView data={outcome.data} eventId={eventId} />;
}

function CoursePreviewView({ data, eventId }: { data: CoursePreviewResponse; eventId: string }) {
  const { course, revision, tees, holes, defaultTeeColor } = data;

  // Initial tee: defaultTeeColor if set, else first tee alphabetically
  // (which matches the lowercase ASC ordering already applied server-side).
  const initialTee = defaultTeeColor ?? (tees[0]?.teeColor ?? '');
  const [selectedTee, setSelectedTee] = useState<string>(initialTee);

  const outYardage = rangeYardageTotal(holes, 1, 9, selectedTee);
  const inYardage = rangeYardageTotal(holes, 10, 18, selectedTee);
  const totalYardage = rangeYardageTotal(holes, 1, 18, selectedTee);

  return (
    <PageShell>
      <BackLink to="/events/$eventId/schedule" params={{ eventId }} />
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
    </PageShell>
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
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId, courseId } = Route.useParams();
  return <CoursePreviewPage eventId={eventId} courseId={courseId} />;
}
