/**
 * T2-5: organizer course-creation form at /admin/courses/new.
 *
 * Two flows merge here:
 *   - MANUAL: fill course header / tees / holes / totals by hand.
 *   - UPLOAD: pick a scorecard file → POST /api/admin/courses/parse-pdf →
 *     pre-populate every field from the parsed response → review/correct →
 *     Submit.
 *
 * Both flows POST to /api/admin/courses (the T2-5 save endpoint), which
 * runs T2-4 validateCourse before persisting in a single libsql
 * transaction across courses + course_revisions + course_tees + course_holes.
 *
 * Auth guard: same loader contract as T2-3b's upload route — fetch
 * /api/auth/status; anonymous → redirect to /api/auth/google;
 * authenticated non-organizer → render inline forbidden message;
 * organizer → render the form.
 *
 * Dual-export: `Route` for TanStack file-route registration AND
 * `NewCoursePage` for direct test rendering.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';

// ---- Types + initial state ------------------------------------------------

type FormTee = { color: string; rating: string; slope: string };
type FormHole = {
  number: number;
  par: string;
  si: string;
  yardages: Record<string, string>;
};
type FormTotals = { out_total: string; in_total: string; course_total: string };

type FormState = {
  name: string;
  club_name: string;
  source_url: string;
  tees: FormTee[];
  holes: FormHole[];
  totals: FormTotals;
};

type ParsedCourse = {
  name: string;
  club_name: string;
  tees: Array<{ color: string; rating: number; slope: number }>;
  holes: Array<{
    number: number;
    par: number;
    si: number;
    yardages: Record<string, number>;
  }>;
  totals: { out_total: number; in_total: number; course_total: number };
};

function emptyHole(number: number): FormHole {
  return { number, par: '', si: '', yardages: {} };
}

function emptyState(): FormState {
  return {
    name: '',
    club_name: '',
    source_url: '',
    tees: [{ color: '', rating: '', slope: '' }],
    holes: Array.from({ length: 18 }, (_, i) => emptyHole(i + 1)),
    totals: { out_total: '', in_total: '', course_total: '' },
  };
}

// ---- Save state-machine ---------------------------------------------------

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; courseId: string }
  | { kind: 'validation_error'; errors: string[] }
  | { kind: 'error'; userMessage: string };

const ACCEPT_MIMES =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';

const PARSE_ERROR_MESSAGES: Record<string, string> = {
  missing_file: 'Please pick a file before uploading.',
  file_too_large: 'File is too large (10 MB max).',
  wrong_mime: "We can't open that kind of file. Use a PDF or JPEG/PNG/WebP.",
  wrong_magic: "That file looks corrupted or isn't actually a PDF/image.",
  unsupported_mime_heic: 'iPhone HEIC photos: please convert to JPEG and try again.',
  unsupported_mime_gif: "GIFs aren't supported.",
  vision_api_failed: 'Parser is unavailable — try again or enter the course manually.',
};

function parseErrorMessage(code: string | null | undefined): string {
  if (code && code in PARSE_ERROR_MESSAGES) return PARSE_ERROR_MESSAGES[code]!;
  return 'Upload failed. Please try again.';
}

// ---- Component ------------------------------------------------------------

export function NewCoursePage() {
  const [form, setForm] = useState<FormState>(emptyState);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Separate refs so an in-flight upload isn't orphaned by a subsequent
  // save (or vice versa). Single-ref design would let one operation's
  // abort overwrite the other's, leaving requests un-aborted at unmount.
  const uploadAbortRef = useRef<AbortController | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);

  // Abort BOTH in-flight requests on unmount.
  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
      saveAbortRef.current?.abort();
    };
  }, []);

  // ---- Tee table mutations -------------------------------------------------

  function addTee(): void {
    setForm((prev) => ({
      ...prev,
      tees: [...prev.tees, { color: '', rating: '', slope: '' }],
      // No need to mutate hole.yardages here — yardages are sparse, keyed by
      // tee.color which is empty initially. New cells render as empty inputs.
    }));
  }

  function removeTee(idx: number): void {
    setForm((prev) => {
      if (prev.tees.length <= 1) return prev;
      const removedColor = prev.tees[idx]?.color ?? '';
      const nextTees = prev.tees.filter((_, i) => i !== idx);
      const nextHoles = prev.holes.map((h) => {
        if (!removedColor || !(removedColor in h.yardages)) return h;
        const { [removedColor]: _drop, ...rest } = h.yardages;
        return { ...h, yardages: rest };
      });
      return { ...prev, tees: nextTees, holes: nextHoles };
    });
  }

  function setTeeField(idx: number, field: keyof FormTee, value: string): void {
    setForm((prev) => {
      const oldColor = prev.tees[idx]?.color ?? '';
      const nextTees = prev.tees.map((t, i) => (i === idx ? { ...t, [field]: value } : t));
      // Rename the yardage key on every hole when a tee color changes.
      if (field !== 'color' || value === oldColor) {
        return { ...prev, tees: nextTees };
      }
      const nextHoles = prev.holes.map((h) => {
        const newYardages: Record<string, string> = {};
        for (const [k, v] of Object.entries(h.yardages)) {
          if (k === oldColor) {
            if (value !== '') newYardages[value] = v;
          } else {
            newYardages[k] = v;
          }
        }
        return { ...h, yardages: newYardages };
      });
      return { ...prev, tees: nextTees, holes: nextHoles };
    });
  }

  // ---- Hole mutations ------------------------------------------------------

  function setHoleField(idx: number, field: 'par' | 'si', value: string): void {
    setForm((prev) => ({
      ...prev,
      holes: prev.holes.map((h, i) => (i === idx ? { ...h, [field]: value } : h)),
    }));
  }

  function setHoleYardage(idx: number, color: string, value: string): void {
    setForm((prev) => ({
      ...prev,
      holes: prev.holes.map((h, i) => {
        if (i !== idx) return h;
        if (value === '') {
          const { [color]: _drop, ...rest } = h.yardages;
          return { ...h, yardages: rest };
        }
        return { ...h, yardages: { ...h.yardages, [color]: value } };
      }),
    }));
  }

  // ---- Totals --------------------------------------------------------------

  function setTotalsField(field: keyof FormTotals, value: string): void {
    setForm((prev) => ({ ...prev, totals: { ...prev.totals, [field]: value } }));
  }

  function computeTotalsFromHoles(): void {
    setForm((prev) => {
      let outSum = 0;
      let inSum = 0;
      for (let i = 0; i < 18; i++) {
        const par = Number(prev.holes[i]?.par ?? '');
        if (!Number.isFinite(par) || par <= 0) {
          // Skip unfilled rows — partial computation isn't useful.
          // The button is intended for use after pars are filled.
          return prev;
        }
        if (i < 9) outSum += par;
        else inSum += par;
      }
      return {
        ...prev,
        totals: {
          out_total: String(outSum),
          in_total: String(inSum),
          course_total: String(outSum + inSum),
        },
      };
    });
  }

  // ---- Pre-populate from parse-pdf upload ----------------------------------

  function prepopulateFromUpload(parsed: ParsedCourse): void {
    const teeColors = parsed.tees.map((t) => t.color);
    setForm({
      name: parsed.name,
      club_name: parsed.club_name,
      source_url: '', // parser output has no source_url; manual entry can fill
      tees: parsed.tees.map((t) => ({
        color: t.color,
        rating: String(t.rating),
        slope: String(t.slope),
      })),
      holes: parsed.holes.map((h) => {
        const yardages: Record<string, string> = {};
        for (const color of teeColors) {
          const v = h.yardages[color];
          if (v !== undefined) yardages[color] = String(v);
        }
        return {
          number: h.number,
          par: String(h.par),
          si: String(h.si),
          yardages,
        };
      }),
      totals: {
        out_total: String(parsed.totals.out_total),
        in_total: String(parsed.totals.in_total),
        course_total: String(parsed.totals.course_total),
      },
    });
  }

  // ---- Upload-scorecard handler --------------------------------------------

  async function onUploadScorecard(file: File): Promise<void> {
    // Abort any prior in-flight upload before replacing the ref so
    // back-to-back picks don't leak the previous fetch.
    uploadAbortRef.current?.abort();
    const ac = new AbortController();
    uploadAbortRef.current = ac;
    setUploading(true);
    setUploadError(null);

    const fd = new FormData();
    fd.append('pdf', file);

    try {
      const res = await fetch('/api/admin/courses/parse-pdf', {
        method: 'POST',
        body: fd,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;

      if (res.ok) {
        const parsed = (await res.json()) as ParsedCourse;
        if (ac.signal.aborted) return;
        prepopulateFromUpload(parsed);
        setUploading(false);
        return;
      }

      const errBody = (await res.json().catch(() => null)) as { code?: string } | null;
      if (ac.signal.aborted) return;
      setUploadError(parseErrorMessage(errBody?.code ?? null));
      setUploading(false);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (ac.signal.aborted) return;
      setUploadError('Network error. Please try again.');
      setUploading(false);
    }
  }

  // ---- Submit handler ------------------------------------------------------

  function isComplete(): boolean {
    if (!form.name.trim() || !form.club_name.trim()) return false;
    if (form.tees.length < 1) return false;
    for (const t of form.tees) {
      if (!t.color.trim()) return false;
      const r = Number(t.rating);
      if (!Number.isFinite(r) || r <= 0) return false;
      const s = Number(t.slope);
      if (!Number.isInteger(s) || s < 55 || s > 155) return false;
    }
    for (const h of form.holes) {
      const par = Number(h.par);
      if (!Number.isInteger(par) || par < 3 || par > 5) return false;
      const si = Number(h.si);
      if (!Number.isInteger(si) || si < 1 || si > 18) return false;
      for (const t of form.tees) {
        const y = Number(h.yardages[t.color]);
        if (!Number.isInteger(y) || y < 0) return false;
      }
    }
    const o = Number(form.totals.out_total);
    const i = Number(form.totals.in_total);
    const tot = Number(form.totals.course_total);
    if (!Number.isInteger(o) || o <= 0) return false;
    if (!Number.isInteger(i) || i <= 0) return false;
    if (!Number.isInteger(tot) || tot <= 0) return false;
    return true;
  }

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      name: form.name,
      club_name: form.club_name,
      tees: form.tees.map((t) => ({
        color: t.color,
        rating: Number(t.rating),
        slope: Number(t.slope),
      })),
      holes: form.holes.map((h) => {
        const yardages: Record<string, number> = {};
        for (const [k, v] of Object.entries(h.yardages)) {
          yardages[k] = Number(v);
        }
        return {
          number: h.number,
          par: Number(h.par),
          si: Number(h.si),
          yardages,
        };
      }),
      totals: {
        out_total: Number(form.totals.out_total),
        in_total: Number(form.totals.in_total),
        course_total: Number(form.totals.course_total),
      },
    };
    if (form.source_url.trim()) {
      payload['source_url'] = form.source_url.trim();
    }
    return payload;
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!isComplete()) return;
    // Belt-and-suspenders: Submit is button-disabled while uploading
    // (see submitDisabled below), but if any path bypasses that, abort
    // the prior save before opening a new one.
    saveAbortRef.current?.abort();
    const ac = new AbortController();
    saveAbortRef.current = ac;
    setSaveState({ kind: 'saving' });

    try {
      const res = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload()),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;

      const body = (await res.json().catch(() => null)) as
        | { id?: string; code?: string; errors?: string[] }
        | null;
      if (ac.signal.aborted) return;

      if (res.status === 201 && body && typeof body.id === 'string') {
        setSaveState({ kind: 'success', courseId: body.id });
        setForm(emptyState());
        return;
      }

      const code = body?.code ?? null;
      if (res.status === 400 && code === 'validation_failed' && Array.isArray(body?.errors)) {
        setSaveState({ kind: 'validation_error', errors: body.errors });
        return;
      }
      if (res.status === 400 && code === 'invalid_body') {
        setSaveState({
          kind: 'error',
          userMessage: 'Form data is invalid. Please check every field and try again.',
        });
        return;
      }
      if (res.status === 400 && code === 'body_too_large') {
        setSaveState({
          kind: 'error',
          userMessage: 'Course data is too large. Please remove extra tees or shorten course names.',
        });
        return;
      }
      if (res.status === 409 && code === 'duplicate_course') {
        setSaveState({
          kind: 'error',
          userMessage: 'A course with that club + name already exists.',
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

  // Disable Submit while uploading so a concurrent save can't race the
  // pre-populate flow (would set state on a half-populated form).
  const submitDisabled = !isComplete() || saveState.kind === 'saving' || uploading;

  return (
    <PageShell title="New Course">
      {/* Upload pre-populate */}
      <section>
        <h2>Upload Scorecard (optional)</h2>
        <p>Pre-populate the form from a PDF or photo of a printed scorecard.</p>
        <label htmlFor="new-course-scorecard-file">Scorecard file</label>
        <input
          id="new-course-scorecard-file"
          type="file"
          accept={ACCEPT_MIMES}
          capture="environment"
          disabled={uploading || saveState.kind === 'saving'}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onUploadScorecard(f);
          }}
        />
        {uploading ? <p>Reading scorecard…</p> : null}
        {uploadError ? <p role="alert">{uploadError}</p> : null}
      </section>

      <form onSubmit={onSubmit}>
        {/* Course header */}
        <section>
          <h2>Course</h2>
          <label htmlFor="course-name">Name</label>
          <input
            id="course-name"
            type="text"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          />
          <label htmlFor="course-club-name">Club name</label>
          <input
            id="course-club-name"
            type="text"
            value={form.club_name}
            onChange={(e) => setForm((p) => ({ ...p, club_name: e.target.value }))}
          />
          <label htmlFor="course-source-url">Source URL (optional)</label>
          <input
            id="course-source-url"
            type="url"
            value={form.source_url}
            onChange={(e) => setForm((p) => ({ ...p, source_url: e.target.value }))}
          />
        </section>

        {/* Tees */}
        <section>
          <h2>Tees</h2>
          <div style={{ overflowX: 'auto' }} tabIndex={0}><table>
            <thead>
              <tr>
                <th>Color</th>
                <th>Rating</th>
                <th>Slope</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {form.tees.map((tee, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      aria-label={`Tee ${idx + 1} color`}
                      type="text"
                      value={tee.color}
                      onChange={(e) => setTeeField(idx, 'color', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Tee ${idx + 1} rating`}
                      type="number"
                      step="0.1"
                      value={tee.rating}
                      onChange={(e) => setTeeField(idx, 'rating', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Tee ${idx + 1} slope`}
                      type="number"
                      value={tee.slope}
                      onChange={(e) => setTeeField(idx, 'slope', e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => removeTee(idx)}
                      disabled={form.tees.length <= 1}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <button type="button" onClick={addTee}>
            Add tee
          </button>
        </section>

        {/* 18 holes */}
        <section>
          <h2>Holes</h2>
          <div style={{ overflowX: 'auto' }} tabIndex={0}><table>
            <thead>
              <tr>
                <th>Hole</th>
                <th>Par</th>
                <th>SI</th>
                {form.tees.map((tee, idx) => (
                  <th key={idx}>{tee.color || `Tee ${idx + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {form.holes.map((hole, holeIdx) => (
                <tr key={hole.number}>
                  <td>{hole.number}</td>
                  <td>
                    <select
                      aria-label={`Hole ${hole.number} par`}
                      value={hole.par}
                      onChange={(e) => setHoleField(holeIdx, 'par', e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Hole ${hole.number} stroke index`}
                      type="number"
                      min={1}
                      max={18}
                      value={hole.si}
                      onChange={(e) => setHoleField(holeIdx, 'si', e.target.value)}
                    />
                  </td>
                  {form.tees.map((tee, teeIdx) => (
                    <td key={teeIdx}>
                      <input
                        aria-label={`Hole ${hole.number} ${tee.color || `tee ${teeIdx + 1}`} yardage`}
                        type="number"
                        min={0}
                        value={tee.color ? hole.yardages[tee.color] ?? '' : ''}
                        disabled={!tee.color}
                        onChange={(e) =>
                          tee.color && setHoleYardage(holeIdx, tee.color, e.target.value)
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        {/* Totals */}
        <section>
          <h2>Printed Totals</h2>
          <label htmlFor="totals-out">Out total</label>
          <input
            id="totals-out"
            type="number"
            value={form.totals.out_total}
            onChange={(e) => setTotalsField('out_total', e.target.value)}
          />
          <label htmlFor="totals-in">In total</label>
          <input
            id="totals-in"
            type="number"
            value={form.totals.in_total}
            onChange={(e) => setTotalsField('in_total', e.target.value)}
          />
          <label htmlFor="totals-course">Course total</label>
          <input
            id="totals-course"
            type="number"
            value={form.totals.course_total}
            onChange={(e) => setTotalsField('course_total', e.target.value)}
          />
          <button type="button" onClick={computeTotalsFromHoles}>
            Compute totals from holes
          </button>
        </section>

        {/* Server response surface */}
        {saveState.kind === 'validation_error' ? (
          <section role="alert">
            <h2>Course can't be saved yet</h2>
            <ul>
              {saveState.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {saveState.kind === 'error' ? (
          <p role="alert">{saveState.userMessage}</p>
        ) : null}
        {saveState.kind === 'success' ? (
          <p role="status">Course saved! (id: {saveState.courseId})</p>
        ) : null}

        <button type="submit" disabled={submitDisabled}>
          {saveState.kind === 'saving' ? 'Saving…' : 'Submit'}
        </button>
      </form>
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

export const Route = createFileRoute('/admin/courses/new')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  if (!player.isOrganizer) return <ForbiddenMessage />;
  return <NewCoursePage />;
}
