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
  latestRevision: { id: string; courseTotal: number };
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
  const { data: coursesResponse } = useQuery<CourseListResponse>({
    queryKey: ['courses'],
    queryFn: async () => {
      const res = await fetch('/api/courses');
      if (!res.ok) throw new Error('courses_fetch_failed');
      return (await res.json()) as CourseListResponse;
    },
    staleTime: 60_000,
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
      <div style={{ padding: 16 }}>
        <h1>Event created!</h1>
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
                background: '#1d4ed8',
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
        <p style={{ fontSize: '0.8em', color: '#888', marginTop: 16 }}>
          Event id: {saveState.eventId}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>New Event</h1>
      <p>Step {form.step} of 3</p>

      {form.step === 1 ? (
        <section>
          <h2>Basics</h2>
          <label htmlFor="event-name">Name</label>
          <input
            id="event-name"
            type="text"
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
          <label htmlFor="event-timezone">Timezone (IANA)</label>
          <input
            id="event-timezone"
            type="text"
            value={form.timezone}
            onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
          />
          <button type="button" onClick={next} disabled={!step1Valid()}>
            Next
          </button>
        </section>
      ) : null}

      {form.step === 2 ? (
        <section>
          <h2>Rounds</h2>
          <table>
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
                    <input
                      aria-label={`Round ${idx + 1} tee color`}
                      type="text"
                      value={round.tee_color}
                      onChange={(e) => setRoundField(idx, 'tee_color', e.target.value)}
                    />
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
          </table>
          <button type="button" onClick={addRound}>
            Add round
          </button>
          <div>
            <button type="button" onClick={back}>
              Back
            </button>
            <button type="button" onClick={next} disabled={!step2Valid()}>
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
          <div>
            <button type="button" onClick={back}>
              Back
            </button>
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={saveState.kind === 'saving'}
            >
              {saveState.kind === 'saving' ? 'Submitting…' : 'Submit'}
            </button>
          </div>
          {saveState.kind === 'error' ? (
            <p role="alert">{saveState.userMessage}</p>
          ) : null}
        </section>
      ) : null}
    </div>
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
