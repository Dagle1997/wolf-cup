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
  // /api/courses emits `null` for a course with no revision (courses.ts).
  // Such a course is not selectable for event creation.
  latestRevision: {
    id: string;
    courseTotal: number;
    tees?: Array<{ color: string; rating: number; slope: number }>;
  } | null;
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

/**
 * Convert a 'YYYY-MM-DD' date string to the epoch-ms of LOCAL MIDNIGHT in the
 * event's IANA `timeZone` — NOT UTC midnight.
 *
 * The whole app treats event.startDate / endDate / round.roundDate as
 * "local-day-start (midnight) in event.timezone" (see the time-semantics
 * comment in events.$eventId.index.tsx). The old body `new Date(`${s}T00:00:00Z`)`
 * encoded UTC midnight via a stray `Z`, shifting every date 4–5h early for US
 * zones — which made the "Event complete" countdown flip the *evening before*
 * the last round (the day-2 "tournament is over" banner) and dates appear to
 * roll at UTC-midnight. We instead resolve the real zone offset for that
 * wall-clock day and subtract it, landing on true local midnight.
 */
function dateStringToEpochMs(s: string, timeZone: string): number {
  const parts = s.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (
    parts.length !== 3 ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return new Date(`${s}T00:00:00Z`).getTime();
  }
  // The instant this wall-clock date would be if it were UTC midnight.
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // local − UTC offset at that instant in the target zone (DST-aware).
  const offsetMs = tzOffsetMs(utcGuess, timeZone);
  // Subtract the offset → local midnight expressed as a UTC instant.
  return utcGuess - offsetMs;
}

/**
 * Milliseconds the given IANA `timeZone` is ahead of UTC at `instant` (epoch ms),
 * via Intl. Returns 0 for an unparseable zone so date math degrades to UTC
 * rather than throwing (call sites validate the zone first, so this is a guard).
 */
function tzOffsetMs(instant: number, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes): number => {
      const p = parts.find((x) => x.type === type);
      return p ? Number(p.value) : 0;
    };
    const asUTC = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return asUTC - instant;
  } catch {
    return 0;
  }
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
    const tz = form.timezone.trim();
    if (
      dateStringToEpochMs(form.end_date, tz) <
      dateStringToEpochMs(form.start_date, tz)
    )
      return false;
    return true;
  }

  // ---- Step 2 validation ---------------------------------------------------

  function step2Valid(): boolean {
    if (form.rounds.length < 1) return false;
    const tz = form.timezone.trim();
    const startMs = dateStringToEpochMs(form.start_date, tz);
    const endMs = dateStringToEpochMs(form.end_date, tz);
    for (const r of form.rounds) {
      if (!r.round_date) return false;
      const rms = dateStringToEpochMs(r.round_date, tz);
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
    const tz = form.timezone.trim();
    return {
      name: form.name.trim(),
      start_date: dateStringToEpochMs(form.start_date, tz),
      end_date: dateStringToEpochMs(form.end_date, tz),
      timezone: tz,
      rounds: form.rounds.map((r) => ({
        round_date: dateStringToEpochMs(r.round_date, tz),
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
          {/* One stacked card per round (was a 5-column table — unusable on a
              phone). Each field is full-width with its label above. Josh 2026-06-25. */}
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {form.rounds.map((round, idx) => {
              const chosen = (coursesResponse?.courses ?? []).find(
                (c) => c.latestRevision?.id === round.course_revision_id,
              );
              const tees = chosen?.latestRevision?.tees ?? [];
              const fieldStyle = { width: '100%', minHeight: 44, boxSizing: 'border-box' as const };
              const labelStyle = { display: 'block', fontSize: 'var(--font-sm)', fontWeight: 600, margin: 'var(--space-2) 0 4px' };
              return (
                <div key={idx} className="card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong>Round {idx + 1}</strong>
                    <button
                      type="button"
                      onClick={() => removeRound(idx)}
                      disabled={form.rounds.length <= 1}
                      style={{ minHeight: 36 }}
                    >
                      Remove
                    </button>
                  </div>

                  <label style={labelStyle}>Date</label>
                  <input
                    aria-label={`Round ${idx + 1} date`}
                    type="date"
                    value={round.round_date}
                    min={form.start_date}
                    max={form.end_date}
                    onChange={(e) => setRoundField(idx, 'round_date', e.target.value)}
                    style={fieldStyle}
                  />

                  <label style={labelStyle}>Course</label>
                  <select
                    aria-label={`Round ${idx + 1} course`}
                    value={round.course_revision_id}
                    onChange={(e) => setRoundField(idx, 'course_revision_id', e.target.value)}
                    style={fieldStyle}
                  >
                    <option value="">— pick a course —</option>
                    {(coursesResponse?.courses ?? [])
                      .filter((c) => c.latestRevision !== null)
                      .map((c) => (
                        <option key={c.latestRevision!.id} value={c.latestRevision!.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>

                  <label style={labelStyle}>Tee</label>
                  {tees.length > 0 ? (
                    <select
                      aria-label={`Round ${idx + 1} tee color`}
                      value={round.tee_color}
                      onChange={(e) => setRoundField(idx, 'tee_color', e.target.value)}
                      style={fieldStyle}
                    >
                      <option value="">— pick a tee —</option>
                      {tees.map((t) => (
                        <option key={t.color} value={t.color}>{t.color}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`Round ${idx + 1} tee color`}
                      type="text"
                      placeholder={round.course_revision_id ? 'tee' : 'pick course first'}
                      value={round.tee_color}
                      onChange={(e) => setRoundField(idx, 'tee_color', e.target.value)}
                      style={fieldStyle}
                    />
                  )}

                  <label style={labelStyle}>Holes</label>
                  <select
                    aria-label={`Round ${idx + 1} holes to play`}
                    value={round.holes_to_play}
                    onChange={(e) => setRoundField(idx, 'holes_to_play', e.target.value as '9' | '18')}
                    style={fieldStyle}
                  >
                    <option value="18">18</option>
                    <option value="9">9</option>
                  </select>
                </div>
              );
            })}
          </div>
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
                      (c) => c.latestRevision?.id === r.course_revision_id,
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
