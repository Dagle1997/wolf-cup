/**
 * Import a course directly from GHIN (the authoritative USGA rating source).
 *
 * Flow: search by name → GET /api/admin/courses/ghin/search → pick a course
 * → GET /api/admin/courses/ghin/:id (server maps it to the save-request
 * shape, men's tees) → review + drop unwanted tees → POST the payload to the
 * existing /api/admin/courses save endpoint.
 *
 * Beats manual entry / PDF parse for any GHIN-rated course: no typing,
 * authoritative rating/slope, combos included.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';

type SearchHit = {
  ghinCourseId: number;
  name: string;
  city: string | null;
  state: string | null;
  status: string | null;
};

type MappedTee = { color: string; rating: number; slope: number };
type MappedHole = { number: number; par: number; si: number; yardages: Record<string, number> };
type MappedCourse = {
  name: string;
  club_name: string;
  tees: MappedTee[];
  holes: MappedHole[];
  totals: { out_total: number; in_total: number; course_total: number };
  source_url: string;
};
type Preview = {
  ghinCourse: { id: number; name: string; city: string | null; state: string | null };
  course: MappedCourse;
};

const btn: React.CSSProperties = {
  minHeight: 'var(--control-height, 44px)',
  padding: '8px 14px',
  borderRadius: 6,
  fontWeight: 600,
  cursor: 'pointer',
};

function ImportCoursePage() {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedTees, setSelectedTees] = useState<Set<string>>(new Set());

  const [saveState, setSaveState] = useState<
    | { kind: 'idle' | 'saving' }
    | { kind: 'success'; courseId: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function runSearch() {
    const q = query.trim();
    if (q.length < 3) {
      setSearchError('Type at least 3 characters.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setResults(null);
    setPreview(null);
    setSaveState({ kind: 'idle' });
    try {
      const res = await fetch(`/api/admin/courses/ghin/search?q=${encodeURIComponent(q)}`, {
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => null)) as { courses?: SearchHit[]; code?: string } | null;
      if (res.status === 503) {
        setSearchError('GHIN search isn’t configured on the server.');
        return;
      }
      if (!res.ok || !body?.courses) {
        setSearchError('GHIN search failed. Try again.');
        return;
      }
      setResults(body.courses);
    } catch {
      setSearchError('Network error. Try again.');
    } finally {
      setSearching(false);
    }
  }

  async function loadPreview(hit: SearchHit) {
    setPreviewLoading(true);
    setPreview(null);
    setSaveState({ kind: 'idle' });
    try {
      const res = await fetch(`/api/admin/courses/ghin/${hit.ghinCourseId}`, {
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => null)) as (Preview & { code?: string; reason?: string }) | null;
      if (res.status === 422) {
        setSearchError(`This course can’t be auto-imported (${body?.reason ?? 'unsupported'}). Use manual entry.`);
        return;
      }
      if (!res.ok || !body?.course) {
        setSearchError('Couldn’t load that course from GHIN.');
        return;
      }
      setPreview({ ghinCourse: body.ghinCourse, course: body.course });
      setSelectedTees(new Set(body.course.tees.map((t) => t.color)));
      setSearchError(null);
    } catch {
      setSearchError('Network error loading course.');
    } finally {
      setPreviewLoading(false);
    }
  }

  function toggleTee(color: string) {
    setSelectedTees((prev) => {
      const next = new Set(prev);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  }

  async function importCourse() {
    if (!preview || selectedTees.size === 0) return;
    setSaveState({ kind: 'saving' });

    // Filter the mapped payload to the selected tees (drop from tees[] and
    // from every hole's yardages). totals are par-based, so unaffected.
    const tees = preview.course.tees.filter((t) => selectedTees.has(t.color));
    const holes = preview.course.holes.map((h) => ({
      ...h,
      yardages: Object.fromEntries(
        Object.entries(h.yardages).filter(([color]) => selectedTees.has(color)),
      ),
    }));
    const payload = { ...preview.course, tees, holes };

    try {
      const res = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; code?: string } | null;
      if (res.status === 201 && body?.id) {
        setSaveState({ kind: 'success', courseId: body.id });
        return;
      }
      if (res.status === 409 && body?.code === 'duplicate_course') {
        setSaveState({ kind: 'error', message: 'That course is already in your library.' });
        return;
      }
      setSaveState({ kind: 'error', message: 'Import failed — please try again or use manual entry.' });
    } catch {
      setSaveState({ kind: 'error', message: 'Network error. Try again.' });
    }
  }

  return (
    <PageShell title="Import course from GHIN">
      <BackLink to="/admin/courses/new" label="Manual entry instead" />

      {saveState.kind === 'success' ? (
        <div
          data-testid="ghin-import-success"
          style={{ margin: '16px 0', padding: 12, border: '1px solid #86efac', background: '#f0fdf4', borderRadius: 8 }}
        >
          <strong style={{ color: '#166534' }}>Course imported.</strong>
          <div style={{ fontSize: '0.85em', color: '#15803d', marginTop: 4 }}>
            It’s in your library now — pick it in the event wizard’s course dropdown.
          </div>
          <p style={{ marginTop: 10 }}>
            <Link to="/admin/events/new">← Back to creating your event</Link>
          </p>
        </div>
      ) : (
        <>
          <p style={{ color: '#555', fontSize: '0.9em', margin: '12px 0' }}>
            Search GHIN by course name. Ratings &amp; slope come straight from the USGA database.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
              placeholder="e.g. Pete Dye Golf Club"
              aria-label="GHIN course search"
              data-testid="ghin-search-input"
              style={{ flex: 1, minHeight: 'var(--control-height, 44px)', padding: '0 10px' }}
            />
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={searching}
              data-testid="ghin-search-btn"
              style={{ ...btn, background: 'var(--color-brand-primary, #1d4ed8)', color: '#fff', border: 'none' }}
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchError ? <p role="alert" style={{ color: '#b91c1c', marginTop: 8 }}>{searchError}</p> : null}

          {results && results.length === 0 ? (
            <p style={{ color: '#555', marginTop: 12 }}>No GHIN courses matched “{query.trim()}”.</p>
          ) : null}

          {results && results.length > 0 && !preview ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'grid', gap: 8 }}>
              {results.map((hit) => (
                <li key={hit.ghinCourseId}>
                  <button
                    type="button"
                    onClick={() => void loadPreview(hit)}
                    disabled={previewLoading}
                    data-testid={`ghin-result-${hit.ghinCourseId}`}
                    style={{ ...btn, width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #ddd', fontWeight: 400 }}
                  >
                    <strong>{hit.name}</strong>
                    <span style={{ color: '#666', fontSize: '0.85em' }}>
                      {' '}— {[hit.city, hit.state].filter(Boolean).join(', ')}
                      {hit.status && hit.status !== 'Active' ? ` · ${hit.status}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {previewLoading ? <p style={{ marginTop: 12 }}>Loading course…</p> : null}

          {preview ? (
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setPreview(null)}
                style={{ ...btn, background: '#fff', border: '1px solid #ddd', fontWeight: 400, marginBottom: 12 }}
              >
                ← Back to results
              </button>
              <h2 style={{ margin: '0 0 4px' }}>{preview.course.name}</h2>
              <div style={{ color: '#666', fontSize: '0.85em', marginBottom: 12 }}>
                {[preview.ghinCourse.city, preview.ghinCourse.state].filter(Boolean).join(', ')} · par{' '}
                {preview.course.totals.course_total} · {preview.course.holes.length} holes
              </div>
              <p style={{ fontSize: '0.85em', color: '#555' }}>Tees to import:</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'grid', gap: 6 }}>
                {preview.course.tees.map((t) => (
                  <li key={t.color}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedTees.has(t.color)}
                        onChange={() => toggleTee(t.color)}
                        data-testid={`ghin-tee-${t.color}`}
                      />
                      <span><strong>{t.color}</strong> — {t.rating} / {t.slope}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => void importCourse()}
                disabled={saveState.kind === 'saving' || selectedTees.size === 0}
                data-testid="ghin-import-btn"
                style={{ ...btn, background: 'var(--color-brand-primary, #1d4ed8)', color: '#fff', border: 'none', width: '100%' }}
              >
                {saveState.kind === 'saving' ? 'Importing…' : `Import ${selectedTees.size} tee${selectedTees.size === 1 ? '' : 's'}`}
              </button>
              {saveState.kind === 'error' ? (
                <p role="alert" style={{ color: '#b91c1c', marginTop: 8 }}>{saveState.message}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/courses/import')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  if (!player.isOrganizer) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Forbidden</h1>
        <p>You need organizer access to import courses.</p>
      </div>
    );
  }
  return <ImportCoursePage />;
}
