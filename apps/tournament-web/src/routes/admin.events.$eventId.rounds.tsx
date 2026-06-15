/**
 * B3 — per-round course editor. Change/assign a round's course + tee AFTER
 * the event is created (the missing piece that made the post-creation "add
 * course" affordance honest). Locked once a round's scoring has started.
 */
import { createFileRoute, useParams, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

type AdminContext = {
  eventRounds: Array<{
    id: string;
    roundNumber: number;
    courseName: string;
    courseRevisionId: string;
    teeColor: string;
    started: boolean;
  }>;
};

type CourseEntry = {
  id: string;
  name: string;
  latestRevision: { id: string; tees?: Array<{ color: string }> } | null;
};

async function fetchCtx(eventId: string): Promise<AdminContext> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/admin-context`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as AdminContext;
}
async function fetchCourses(): Promise<{ courses: CourseEntry[] }> {
  const res = await fetch('/api/courses', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('courses_failed');
  return (await res.json()) as { courses: CourseEntry[] };
}

function RoundCourseEditor({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const ctxQuery = useQuery({ queryKey: ['admin-context', eventId], queryFn: () => fetchCtx(eventId), retry: false });
  const coursesQuery = useQuery({ queryKey: ['courses'], queryFn: fetchCourses, staleTime: 60_000 });

  // Per-round draft selection { eventRoundId: { revId, tee } }.
  const [draft, setDraft] = useState<Record<string, { revId: string; tee: string }>>({});
  const [savedFor, setSavedFor] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async ({ eventRoundId, courseRevisionId, teeColor }: { eventRoundId: string; courseRevisionId: string; teeColor: string }) => {
      const res = await fetch(`/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/course`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ courseRevisionId, teeColor }),
      });
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (!res.ok) throw new Error(body?.code ?? 'unknown');
      return eventRoundId;
    },
    onSuccess: async (eventRoundId) => {
      setSavedFor(eventRoundId);
      setTimeout(() => setSavedFor(null), 2000);
      await qc.invalidateQueries({ queryKey: ['admin-context', eventId] });
    },
  });

  if (ctxQuery.isPending) {
    return <PageShell title="Rounds & courses"><BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" /><LoadingCard /></PageShell>;
  }
  if (ctxQuery.isError) {
    return <PageShell title="Rounds & courses"><BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" /><ErrorCard error="Couldn't load rounds." onRetry={ctxQuery.refetch} /></PageShell>;
  }

  const rounds = ctxQuery.data!.eventRounds;
  const courses = coursesQuery.data?.courses ?? [];

  return (
    <PageShell title="Rounds & courses">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" />
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)', margin: '12px 0' }}>
        Assign or change each round's course. Locked once scoring has started.
        Need a course that isn't listed?{' '}
        <Link to="/admin/courses/import">Search GHIN</Link>,{' '}
        <a href="/admin/courses/upload">upload a scorecard</a>, or{' '}
        <a href="/admin/courses/new">add manually</a>, then come back.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-3)' }}>
        {rounds.map((r) => {
          const d = draft[r.id] ?? { revId: r.courseRevisionId, tee: r.teeColor };
          const chosenCourse = courses.find((c) => c.latestRevision?.id === d.revId);
          const tees = chosenCourse?.latestRevision?.tees ?? [];
          const dirty = d.revId !== r.courseRevisionId || d.tee !== r.teeColor;
          return (
            <li
              key={r.id}
              style={{ padding: 'var(--space-3)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>Round {r.roundNumber}</strong>
                <span style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>
                  {r.courseName} · {r.teeColor}
                </span>
              </div>

              {r.started ? (
                <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-warning-text)', marginTop: 8 }}>
                  Scoring has started — course is locked.
                </p>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)', alignItems: 'center' }}>
                  <select
                    aria-label={`Round ${r.roundNumber} course`}
                    value={d.revId}
                    onChange={(e) => {
                      const revId = e.target.value;
                      const c = courses.find((x) => x.latestRevision?.id === revId);
                      const firstTee = c?.latestRevision?.tees?.[0]?.color ?? '';
                      setDraft((p) => ({ ...p, [r.id]: { revId, tee: firstTee } }));
                    }}
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.latestRevision?.id ?? ''} disabled={!c.latestRevision}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Round ${r.roundNumber} tee`}
                    value={d.tee}
                    onChange={(e) => setDraft((p) => ({ ...p, [r.id]: { ...d, tee: e.target.value } }))}
                  >
                    {tees.length === 0 ? <option value={d.tee}>{d.tee || '—'}</option> : null}
                    {tees.map((t) => (<option key={t.color} value={t.color}>{t.color}</option>))}
                  </select>
                  <button
                    type="button"
                    disabled={!dirty || !d.tee || save.isPending}
                    onClick={() => save.mutate({ eventRoundId: r.id, courseRevisionId: d.revId, teeColor: d.tee })}
                    data-testid={`save-course-${r.id}`}
                    style={{ minHeight: 'var(--control-height)', padding: '0 14px', borderRadius: 'var(--radius-sm)', border: 'none', background: dirty && d.tee ? 'var(--color-brand-primary)' : 'var(--color-border)', color: '#fff', fontWeight: 600, cursor: dirty ? 'pointer' : 'default' }}
                  >
                    {savedFor === r.id ? '✓ Saved' : save.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
              {save.isError ? (
                <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 'var(--font-sm)', marginTop: 6 }}>
                  Couldn&apos;t change the course. {String(save.error?.message) === 'round_already_started' ? 'Scoring already started.' : 'Try again.'}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/rounds')({
  beforeLoad: async () => requireAuthOrRedirect(),
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  const { eventId } = useParams({ strict: false });
  if (!player.isOrganizer) {
    return <div style={{ padding: 24 }}><h1>Forbidden</h1><p>You need organizer access.</p></div>;
  }
  if (typeof eventId !== 'string') return <div>Invalid event.</div>;
  return <RoundCourseEditor eventId={eventId} />;
}
