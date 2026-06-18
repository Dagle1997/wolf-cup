/**
 * T3-2: organizer event-creation wizard at /admin/events/new.
 *
 * Three-step wizard:
 *   1. Basics — name, start_date, end_date, timezone
 *   2. Rounds — N rows of {round_date, course_revision_id, tee_color, holes_to_play}
 *   3. Review — read-only summary + Submit
 *
 * Submit POSTs to /api/admin/events (T3-2 save endpoint), which runs
 * Zod + pre-flight course_revision_id existence check, then atomically
 * inserts events + N event_rounds + 1 invites + 1 default Group.
 *
 * Auth guard: same loader contract as T2-3b/T2-5 — fetch /api/auth/status;
 * anonymous → window.location.assign('/api/auth/google'); non-organizer →
 * inline forbidden message; organizer → render wizard.
 *
 * Dual-export: `Route` for TanStack file-route registration AND
 * `NewEventWizard` for direct test rendering.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { ScrollableTable } from '../components/scrollable-table';

// ---- Loader (mirror T2-3b/T2-5) -------------------------------------------


// ---- IANA timezone validator (copied from server, NOT shared) -------------

/**
 * Validates an IANA timezone string. Engine-deferred: not all engines
 * throw at construct time, so .format() is called to actually exercise
 * the timeZone option. Mirrors the helper in admin-events.ts (intentionally
 * duplicated to avoid a SHARED edit; promote to shared util when a 3rd
 * consumer arrives).
 */
function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

// ---- Types + initial state ------------------------------------------------

type FormRound = {
  round_date: string; // YYYY-MM-DD from <input type="date">
  course_revision_id: string;
  tee_color: string;
  holes_to_play: '9' | '18';
};

type FormState = {
  step: 1 | 2 | 3;
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  timezone: string;
  rounds: FormRound[];
};

type CourseListEntry = {
  id: string;
  name: string;
  clubName: string;
  latestRevision: {
    id: string;
    courseTotal: number;
    tees?: Array<{ color: string; rating: number; slope: number }>;
  };
};

type CourseListResponse = { courses: CourseListEntry[] };

function emptyState(): FormState {
  const browserTz =
    typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'America/New_York';
  return {
    step: 1,
    name: '',
    start_date: '',
    end_date: '',
    timezone: browserTz,
    rounds: [
      {
        round_date: '',
        course_revision_id: '',
        tee_color: '',
        holes_to_play: '18',
      },
    ],
  };
}

// ---- Date helpers (string ↔ epoch ms) -------------------------------------

function dateStringToEpochMs(s: string): number {
  return new Date(`${s}T00:00:00Z`).getTime();
}

// ---- Save state-machine ---------------------------------------------------

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; eventId: string; inviteToken: string }
  | { kind: 'error'; userMessage: string };

// ---- Progress dots --------------------------------------------------------

/** A 3-step progress indicator. Keeps the "Step N of 3" text (a11y + tests). */
function StepDots({ step }: { step: 1 | 2 | 3 }) {
  const labels = ['Basics', 'Rounds', 'Review'];
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {[1, 2, 3].map((n) => {
          const done = n < step;
          const active = n === step;
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'center', flex: n < 3 ? 1 : '0 0 auto' }}>
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  flexShrink: 0,
                  fontSize: 'var(--font-sm)',
                  fontWeight: 700,
                  color: active || done ? '#fff' : 'var(--color-text-muted)',
                  background: active || done ? 'var(--color-brand-primary)' : 'var(--color-surface-sunken)',
                  border: active ? '2px solid var(--color-brand-strong)' : '1px solid var(--color-border)',
                }}
              >
                {done ? '✓' : n}
              </span>
              {n < 3 ? (
                <span style={{ flex: 1, height: 2, margin: '0 6px', background: done ? 'var(--color-brand-primary)' : 'var(--color-border)' }} />
              ) : null}
            </div>
          );
        })}
      </div>
      <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
        Step {step} of 3 · {labels[step - 1]}
      </p>
    </div>
  );
}

// ---- Component ------------------------------------------------------------

export function NewEventWizard() {
  const [form, setForm] = useState<FormState>(emptyState);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const saveAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      saveAbortRef.current?.abort();
    };
  }, []);

  // Course picker query — gated to step 2+ via `enabled` so the fetch
  // doesn't fire on wizard mount (step 1 doesn't need course data; firing
  // early wastes a request and creates test-mock surface area on idle).
  const {
    data: coursesResponse,
    refetch: refetchCourses,
    isFetching: coursesFetching,
  } = useQuery<CourseListResponse>({
    queryKey: ['courses'],
    queryFn: async () => {
      const res = await fetch('/api/courses');
      if (!res.ok) throw new Error('courses_fetch_failed');
      return (await res.json()) as CourseListResponse;
    },
    staleTime: 60_000,
    // Refetch when the user returns from adding a course in another tab.
    refetchOnWindowFocus: true,
    enabled: form.step >= 2,
  });

  // ---- Step 1 validation ---------------------------------------------------

  function step1Valid(): boolean {
    if (!form.name.trim()) return false;
    if (!form.start_date || !form.end_date) return false;
    if (!form.timezone.trim() || !isValidIanaTimezone(form.timezone.trim()))
      return false;
    if (dateStringToEpochMs(form.end_date) < dateStringToEpochMs(form.start_date))
      return false;
    return true;
  }

  // ---- Step 2 validation ---------------------------------------------------

  function step2Valid(): boolean {
    if (form.rounds.length < 1) return false;
    const startMs = dateStringToEpochMs(form.start_date);
    const endMs = dateStringToEpochMs(form.end_date);
    for (const r of form.rounds) {
      if (!r.round_date) return false;
      const rms = dateStringToEpochMs(r.round_date);
      if (rms < startMs || rms > endMs) return false;
      if (!r.course_revision_id) return false;
      if (!r.tee_color.trim()) return false;
      if (r.holes_to_play !== '9' && r.holes_to_play !== '18') return false;
    }
    return true;
  }

  // ---- Round mutations -----------------------------------------------------

  function addRound(): void {
    setForm((prev) => ({
      ...prev,
      rounds: [
        ...prev.rounds,
        { round_date: '', course_revision_id: '', tee_color: '', holes_to_play: '18' },
      ],
    }));
  }

  function removeRound(idx: number): void {
    setForm((prev) => {
      if (prev.rounds.length <= 1) return prev;
      return { ...prev, rounds: prev.rounds.filter((_, i) => i !== idx) };
    });
  }

  function setRoundField<K extends keyof FormRound>(
    idx: number,
    field: K,
    value: FormRound[K],
  ): void {
    setForm((prev) => ({
      ...prev,
      rounds: prev.rounds.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    }));
  }

  // ---- Step transitions ----------------------------------------------------

  function next(): void {
    if (form.step === 1 && step1Valid()) {
      setForm((p) => ({ ...p, step: 2 }));
    } else if (form.step === 2 && step2Valid()) {
      setForm((p) => ({ ...p, step: 3 }));
    }
  }

  function back(): void {
    if (form.step === 2) setForm((p) => ({ ...p, step: 1 }));
    else if (form.step === 3) setForm((p) => ({ ...p, step: 2 }));
  }

  // ---- Submit --------------------------------------------------------------

  function buildPayload(): Record<string, unknown> {
    return {
      name: form.name.trim(),
      start_date: dateStringToEpochMs(form.start_date),
      end_date: dateStringToEpochMs(form.end_date),
      timezone: form.timezone.trim(),
      rounds: form.rounds.map((r) => ({
        round_date: dateStringToEpochMs(r.round_date),
        course_revision_id: r.course_revision_id,
        tee_color: r.tee_color.trim(),
        holes_to_play: Number(r.holes_to_play),
      })),
    };
  }

  async function onSubmit(): Promise<void> {
    saveAbortRef.current?.abort();
    const ac = new AbortController();
    saveAbortRef.current = ac;
    setSaveState({ kind: 'saving' });

    try {
      const res = await fetch('/api/admin/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload()),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;

      const body = (await res.json().catch(() => null)) as
        | { eventId?: string; inviteToken?: string; code?: string }
        | null;
      if (ac.signal.aborted) return;

      if (
        res.status === 201 &&
        body &&
        typeof body.eventId === 'string' &&
        typeof body.inviteToken === 'string'
      ) {
        setSaveState({
          kind: 'success',
          eventId: body.eventId,
          inviteToken: body.inviteToken,
        });
        return;
      }
      const code = body?.code ?? null;
      if (res.status === 400 && code === 'invalid_body') {
        setSaveState({
          kind: 'error',
          userMessage: 'Form data is invalid. Please go back and check every field.',
        });
        return;
      }
      if (res.status === 400 && code === 'unknown_course_revision') {
        setSaveState({
          kind: 'error',
          userMessage:
            'One or more selected courses no longer exist. Please go back to step 2 and re-pick.',
        });
        return;
      }
      if (res.status === 400 && code === 'unknown_tee_color') {
        setSaveState({
          kind: 'error',
          userMessage:
            'A round’s tee isn’t a valid tee for its course. Please go back to step 2 and pick a tee from the dropdown.',
        });
        return;
      }
      if (res.status === 400 && code === 'body_too_large') {
        setSaveState({
          kind: 'error',
          userMessage: 'Event data is too large. Please remove rounds or shorten the name.',
        });
        return;
      }
      setSaveState({ kind: 'error', userMessage: 'Save failed. Please try again.' });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (ac.signal.aborted) return;
      setSaveState({ kind: 'error', userMessage: 'Network error. Please try again.' });
    }
  }

  // ---- Render --------------------------------------------------------------

  if (saveState.kind === 'success') {
    const inviteUrl = `${window.location.origin}/invite/${saveState.inviteToken}`;
    return (
      <PageShell title="Event created!">
        <p>Share this invite link with the players:</p>
        <p>
          <code>{inviteUrl}</code>
        </p>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 16, display: 'grid', gap: 8 }}>
          <li>
            <a
              href={`/admin/events/${saveState.eventId}`}
              style={{
                display: 'inline-block',
                padding: '10px 18px',
                background: 'var(--color-brand-primary)',
                color: '#fff',
                borderRadius: 6,
                textDecoration: 'none',
                fontWeight: 600,
              }}
              data-testid="new-event-admin-link"
            >
              Set up event → pairings, roster, rule set
            </a>
          </li>
          <li>
            <a
              href={`/events/${saveState.eventId}`}
              style={{ display: 'inline-block', padding: '8px 0' }}
              data-testid="new-event-view-link"
            >
              View event home →
            </a>
          </li>
        </ul>
        <p style={{ fontSize: '0.8em', color: 'var(--color-text-muted)', marginTop: 16 }}>
          Event id: {saveState.eventId}
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell title="New Event">
      <StepDots step={form.step} />

      {form.step === 1 ? (
        <section>
          <h2>Basics</h2>
          <label htmlFor="event-name">Name</label>
          <input
            id="event-name"
            type="text"
            placeholder="e.g. Pinehurst 2026"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
          <label htmlFor="event-start-date">Start date</label>
          <input
            id="event-start-date"
            type="date"
            value={form.start_date}
            onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
          />
          <label htmlFor="event-end-date">End date</label>
          <input
            id="event-end-date"
            type="date"
            value={form.end_date}
            onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
          />

          {/* Timezone is auto-detected from the device. Non-technical users
              never see the raw IANA string unless they open "Change". */}
          <div style={{ margin: 'var(--space-3) 0', fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>
            <span aria-hidden>🕓 </span>Times shown in <strong>{form.timezone}</strong> (detected)
          </div>
          <details style={{ marginBottom: 'var(--space-3)' }}>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)' }}>Change timezone</summary>
            <label htmlFor="event-timezone" style={{ marginTop: 'var(--space-2)' }}>Timezone (IANA)</label>
            <input
              id="event-timezone"
              type="text"
              value={form.timezone}
              onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
            />
            {form.timezone.trim() && !isValidIanaTimezone(form.timezone.trim()) ? (
              <p role="alert" style={{ color: 'var(--color-money-neg)', fontSize: 'var(--font-sm)' }}>Not a valid IANA timezone (e.g. America/New_York).</p>
            ) : null}
          </details>

          <button
            type="button"
            onClick={next}
            disabled={!step1Valid()}
            style={{ width: '100%', minHeight: 'var(--control-height-lg)', background: step1Valid() ? 'var(--color-brand-primary)' : undefined, color: step1Valid() ? '#fff' : undefined, fontWeight: 700, border: step1Valid() ? 'none' : undefined }}
          >
            Next
          </button>
        </section>
      ) : null}

      {form.step === 2 ? (
        <section>
          <h2>Rounds</h2>
          <ScrollableTable label="Event rounds"><table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Course</th>
                <th>Tee</th>
                <th>Holes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {form.rounds.map((round, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      aria-label={`Round ${idx + 1} date`}
                      type="date"
                      value={round.round_date}
                      min={form.start_date}
                      max={form.end_date}
                      onChange={(e) => setRoundField(idx, 'round_date', e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Round ${idx + 1} course`}
                      value={round.course_revision_id}
                      onChange={(e) =>
                        setRoundField(idx, 'course_revision_id', e.target.value)
                      }
                    >
                      <option value="">— pick a course —</option>
                      {(coursesResponse?.courses ?? []).map((c) => (
                        <option key={c.latestRevision.id} value={c.latestRevision.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {(() => {
                      // Tees for the course chosen in THIS round (default/card
                      // tee for the round; per-player tee is set on the roster /
                      // pairings). Dropdown when we know the course's tees;
                      // falls back to free-text if the course list lacks them.
                      const chosen = (coursesResponse?.courses ?? []).find(
                        (c) => c.latestRevision.id === round.course_revision_id,
                      );
                      const tees = chosen?.latestRevision.tees ?? [];
                      if (tees.length > 0) {
                        return (
                          <select
                            aria-label={`Round ${idx + 1} tee color`}
                            value={round.tee_color}
                            onChange={(e) => setRoundField(idx, 'tee_color', e.target.value)}
                          >
                            <option value="">— pick a tee —</option>
                            {tees.map((t) => (
                              <option key={t.color} value={t.color}>{t.color}</option>
                            ))}
                          </select>
                        );
                      }
                      return (
                        <input
                          aria-label={`Round ${idx + 1} tee color`}
                          type="text"
                          placeholder={round.course_revision_id ? 'tee' : 'pick course first'}
                          value={round.tee_color}
                          onChange={(e) => setRoundField(idx, 'tee_color', e.target.value)}
                        />
                      );
                    })()}
                  </td>
                  <td>
                    <select
                      aria-label={`Round ${idx + 1} holes to play`}
                      value={round.holes_to_play}
                      onChange={(e) =>
                        setRoundField(idx, 'holes_to_play', e.target.value as '9' | '18')
                      }
                    >
                      <option value="18">18</option>
                      <option value="9">9</option>
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => removeRound(idx)}
                      disabled={form.rounds.length <= 1}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></ScrollableTable>
          <button type="button" onClick={addRound} style={{ minHeight: 'var(--control-height)', marginTop: 'var(--space-2)' }}>
            + Add round
          </button>

          {/* Course not in the list? Add one without losing wizard progress.
              The creation pages open in a new tab (the wizard is unsaved
              local state); on return, "Refresh list" re-pulls /api/courses
              so the new course appears in the picker. */}
          <div
            style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3)',
              border: '1px dashed var(--color-border, var(--color-border))',
              borderRadius: 8,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-2)',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted, var(--color-text-muted))' }}>
              Course not listed?
            </span>
            <a
              href="/admin/courses/import"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="wizard-add-course-ghin"
              style={{ minHeight: 'var(--control-height)', display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}
            >
              + Search GHIN
            </a>
            <a
              href="/admin/courses/upload"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="wizard-add-course-upload"
              style={{ minHeight: 'var(--control-height)', display: 'inline-flex', alignItems: 'center' }}
            >
              + From scorecard (PDF)
            </a>
            <a
              href="/admin/courses/new"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="wizard-add-course-manual"
              style={{ minHeight: 'var(--control-height)', display: 'inline-flex', alignItems: 'center' }}
            >
              + Add manually
            </a>
            <button
              type="button"
              onClick={() => void refetchCourses()}
              disabled={coursesFetching}
              data-testid="wizard-refresh-courses"
              style={{ minHeight: 'var(--control-height)', marginLeft: 'auto' }}
            >
              {coursesFetching ? 'Refreshing…' : '↻ Refresh list'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={back} style={{ minHeight: 'var(--control-height-lg)' }}>
              Back
            </button>
            <button
              type="button"
              onClick={next}
              disabled={!step2Valid()}
              style={{ flex: 1, minHeight: 'var(--control-height-lg)', background: step2Valid() ? 'var(--color-brand-primary)' : undefined, color: step2Valid() ? '#fff' : undefined, fontWeight: 700, border: step2Valid() ? 'none' : undefined }}
            >
              Next
            </button>
          </div>
        </section>
      ) : null}

      {form.step === 3 ? (
        <section>
          <h2>Review</h2>
          <ul>
            <li>Name: {form.name}</li>
            <li>
              Dates: {form.start_date} → {form.end_date}
            </li>
            <li>Timezone: {form.timezone}</li>
            <li>
              Rounds:
              <ul>
                {form.rounds.map((r, i) => {
                  const courseLabel =
                    coursesResponse?.courses.find(
                      (c) => c.latestRevision.id === r.course_revision_id,
                    )?.name ?? r.course_revision_id;
                  return (
                    <li key={i}>
                      Round {i + 1}: {r.round_date} — {courseLabel} — {r.tee_color} —{' '}
                      {r.holes_to_play} holes
                    </li>
                  );
                })}
              </ul>
            </li>
          </ul>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={back} style={{ minHeight: 'var(--control-height-lg)' }}>
              Back
            </button>
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={saveState.kind === 'saving'}
              style={{ flex: 1, minHeight: 'var(--control-height-lg)', background: 'var(--color-brand-primary)', color: '#fff', fontWeight: 700, border: 'none' }}
            >
              {saveState.kind === 'saving' ? 'Submitting…' : 'Submit'}
            </button>
          </div>
          {saveState.kind === 'error' ? (
            <p role="alert">{saveState.userMessage}</p>
          ) : null}
        </section>
      ) : null}
    </PageShell>
  );
}

// ---- Inline forbidden message --------------------------------------------

function ForbiddenMessage() {
  return (
    <div>
      <h1>Not an organizer</h1>
      <p>
        You're signed in but don't have organizer permissions. Contact Josh to grant
        organizer access, or <a href="/api/auth/google">sign in as a different account</a>.
      </p>
    </div>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/admin/events/new')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  if (!player.isOrganizer) return <ForbiddenMessage />;
  return <NewEventWizard />;
}
