/**
 * Create Quick Event wizard (2026-06-29) — a phone-first fast path to a live
 * round, collapsing the full event-setup ceremony into one flow:
 *
 *   Course (today's date) → Players + roster → Arrange foursomes →
 *   Guyan rules (point value + pills) + Putting?/Snake? → Start.
 *
 * No new backend: on "Start" it orchestrates the SAME organizer endpoints the
 * full setup uses, in sequence:
 *   1. POST /api/admin/events                          (event + event_round + group)
 *   2. GET  /api/admin/events/:id/admin-context        (resolve groupId + eventRoundId)
 *   3. POST /api/admin/groups/:groupId/members  × N    (manual roster)
 *   4. PUT  /api/admin/events/:id/scorer-policy {open}  (anyone validated can score)
 *   5. PUT  /api/admin/events/:id/game-config          (if Guyan)
 *   6. POST /api/admin/event-rounds/:erId/sub-games    (if putting and/or snake)
 *   7. POST /api/admin/events/:id/pairings             (locked foursomes from arrange)
 *   8. POST /api/admin/event-rounds/:erId/start        (organizer as scorer) → roundId
 *   → navigate to /rounds/:roundId/score-entry
 *
 * A partial failure leaves a half-created event (surfaced with the failing
 * step); it's a throwaway test path, so the organizer can cancel it later.
 */
import { useState, type CSSProperties } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthSession, requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';

// ---- tz-aware date helpers (corrected h23 copy of admin.events.new.tsx; kept
// local so this wizard is self-contained — both are the same fixed version that
// avoids the UTC-midnight "day-2 over" bug). -------------------------------
function tzOffsetMs(instant: number, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes): number => {
      const p = parts.find((x) => x.type === type);
      return p ? Number(p.value) : 0;
    };
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asUTC - instant;
  } catch {
    return 0;
  }
}
function dateStringToEpochMs(s: string, timeZone: string): number {
  const [y, m, d] = s.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date(`${s}T00:00:00Z`).getTime();
  }
  const utcGuess = Date.UTC(y!, m! - 1, d!, 0, 0, 0);
  return utcGuess - tzOffsetMs(utcGuess, timeZone);
}
function todayInTimeZone(timeZone: string): string {
  // en-CA renders YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());
}

// ---- API types -----------------------------------------------------------
interface CourseTee { color: string; rating: number; slope: number }
interface CourseListItem {
  id: string;
  name: string;
  clubName: string;
  latestRevision: { id: string; tees: CourseTee[] } | null;
}
interface CoursesResponse { courses: CourseListItem[] }

async function fetchCourses(): Promise<CoursesResponse> {
  const res = await fetch('/api/courses', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as CoursesResponse;
}

type RuleType = 'net-skins' | 'greenie' | 'polie' | 'sandie';
const RULE_PILLS: Array<{ type: RuleType; label: string }> = [
  { type: 'net-skins', label: 'Net skins' },
  { type: 'greenie', label: 'Greenie' },
  { type: 'polie', label: 'Polie' },
  { type: 'sandie', label: 'Sandie' },
];

// A roster entry is either a manual row (typed name + handicap) or a
// GHIN-linked player (ghin set; name/firstName/lastName from the lookup,
// handicap shown for reassurance but resolved live server-side, never sent).
interface QuickPlayer {
  name: string;
  handicap: string;
  ghin?: number;
  firstName?: string;
  lastName?: string;
}

// Mirrors the GHIN search result shape returned by GET /api/players/search.
// (Small type already duplicated in admin.groups.$groupId.edit.tsx + profile.tsx.)
type GhinSearchResult = {
  ghinNumber: number;
  firstName: string;
  lastName: string;
  handicapIndex: number | null;
  club: string | null;
  state: string | null;
};

const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; }
  catch { return 'America/New_York'; }
})();

// JSON POST/PUT helper that throws a coded error on non-2xx.
async function apiSend(url: string, method: 'POST' | 'PUT', body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json['code'] === 'string' ? json['code'] : `http_${res.status}`;
    throw new Error(code);
  }
  return json;
}

export function QuickEventPage() {
  const session = useAuthSession();
  const navigate = useNavigate();
  const coursesQuery = useQuery<CoursesResponse, Error>({
    queryKey: ['courses'],
    queryFn: fetchCourses,
    enabled: session.player?.isOrganizer === true,
    staleTime: 60_000,
  });

  // Step 1 — course / date / holes
  const [courseRevisionId, setCourseRevisionId] = useState('');
  const [teeColor, setTeeColor] = useState('');
  const [holes, setHoles] = useState<9 | 18>(18);
  const [dateStr, setDateStr] = useState(() => todayInTimeZone(TZ));
  const [eventName, setEventName] = useState('');

  // Step 2 — roster (manual rows + GHIN-linked players). Starts with 4 empty
  // manual rows so the fast "type four names" flow still works; GHIN search
  // appends locked rows, and blank manual rows are dropped when leaving step 2.
  const [players, setPlayers] = useState<QuickPlayer[]>(
    () => Array.from({ length: 4 }, () => ({ name: '', handicap: '' })),
  );
  // GHIN search (ported from admin.groups.$groupId.edit.tsx).
  const [ghinLast, setGhinLast] = useState('');
  const [ghinFirst, setGhinFirst] = useState('');
  const [ghinSearchTriggered, setGhinSearchTriggered] = useState(false);

  // Step 3 — arrange (per-player foursome number, 1-based)
  const [foursomeOf, setFoursomeOf] = useState<number[]>(() => [1, 1, 1, 1]);

  // Step 4 — rules
  const [guyanOn, setGuyanOn] = useState(true);
  const [pointDollars, setPointDollars] = useState('5');
  const [ruleEnabled, setRuleEnabled] = useState<Record<RuleType, boolean>>({
    'net-skins': true, greenie: true, polie: true, sandie: true,
  });
  const [puttingOn, setPuttingOn] = useState(false);
  const [snakeOn, setSnakeOn] = useState(false);

  const [step, setStep] = useState(1);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const courses = coursesQuery.data?.courses ?? [];
  const selectedCourse = courses.find((c) => c.latestRevision?.id === courseRevisionId) ?? null;
  const tees = selectedCourse?.latestRevision?.tees ?? [];

  // GHIN name search (ported from admin.groups.$groupId.edit.tsx). 503 from a
  // missing/down GHIN integration degrades to a graceful "add manually" notice.
  const ghinSearchQuery = useQuery<{ results: GhinSearchResult[] } | { error: 'unavailable' }>({
    queryKey: ['ghin-search', ghinLast, ghinFirst],
    queryFn: async ({ signal }) => {
      const fn = ghinFirst.trim();
      const res = await fetch(
        `/api/players/search?name=${encodeURIComponent(ghinLast.trim())}${fn ? `&firstName=${encodeURIComponent(fn)}` : ''}`,
        { credentials: 'same-origin', signal },
      );
      if (res.status === 503) return { error: 'unavailable' as const };
      if (!res.ok) throw new Error('ghin_search_failed');
      return (await res.json()) as { results: GhinSearchResult[] };
    },
    enabled: ghinSearchTriggered && ghinLast.trim().length > 0,
    staleTime: 30_000,
  });

  // Roster mutators. foursomeOf[] is NOT maintained here — during step 2 it is
  // unused, and goToArrange() rebuilds it to exactly the roster length, so these
  // can only ever change players[] (no players/foursomeOf desync to manage).
  function addManualRow() {
    setPlayers((prev) => [...prev, { name: '', handicap: '' }]);
  }
  function addGhinPlayer(r: GhinSearchResult) {
    // De-dupe INSIDE the updater so a fast double-tap can't add the same golfer
    // twice (a dup would later 409 player_already_in_group and fail Start).
    setPlayers((prev) =>
      prev.some((p) => p.ghin === r.ghinNumber)
        ? prev
        : [
            ...prev,
            {
              name: `${r.firstName} ${r.lastName}`.trim(),
              handicap: r.handicapIndex !== null ? String(r.handicapIndex) : '',
              ghin: r.ghinNumber,
              firstName: r.firstName,
              lastName: r.lastName,
            },
          ],
    );
    setGhinSearchTriggered(false);
  }
  function removePlayer(i: number) {
    setPlayers((prev) => prev.filter((_, j) => j !== i));
  }
  function updatePlayer(i: number, patch: Partial<QuickPlayer>) {
    setPlayers((prev) => prev.map((pp, j) => (j === i ? { ...pp, ...patch } : pp)));
  }
  // Quick count setter (e.g. bump to 8 or 12). Pads with blank manual rows, or
  // trims TRAILING fully-blank manual rows — never auto-removes a GHIN row or a
  // row with ANY data (name OR handicap), so a mid-edit row is never lost.
  function setRosterSize(n: number) {
    const target = Math.max(1, Math.min(40, Math.floor(n) || 1));
    setPlayers((prev) => {
      const next = [...prev];
      while (next.length < target) next.push({ name: '', handicap: '' });
      for (let i = next.length - 1; i >= 0 && next.length > target; i--) {
        const p = next[i]!;
        if (p.ghin === undefined && p.name.trim() === '' && p.handicap.trim() === '') next.splice(i, 1);
      }
      return next;
    });
  }
  // Run (or re-run) the GHIN search. Re-clicking/Enter with the same criteria
  // refetches rather than no-op'ing (matters after a transient 503).
  function runGhinSearch() {
    if (ghinLast.trim().length === 0) return;
    if (ghinSearchTriggered) void ghinSearchQuery.refetch();
    else setGhinSearchTriggered(true);
  }

  // Effective roster = GHIN players + non-blank manual rows (blank manual rows
  // are ignored). Advancing to step 3 commits this compacted list and rebuilds
  // the default foursome split so blanks never reach Arrange / the POST loop.
  const effectivePlayers = players.filter((p) => p.ghin !== undefined || p.name.trim() !== '');
  function goToArrange() {
    const roster = effectivePlayers;
    setPlayers(roster);
    setFoursomeOf(Array.from({ length: roster.length }, (_, i) => Math.floor(i / 4) + 1));
    setStep(3);
  }

  const numFoursomes = foursomeOf.length ? Math.max(1, ...foursomeOf) : 1;

  // A tee is always required (the free-text input covers no-tee courses), so a
  // round never starts with an empty tee → unpinnable/unsettleable (codex review).
  const step1Valid = courseRevisionId !== '' && teeColor.trim() !== '' && dateStr !== '';
  const step2Valid = effectivePlayers.length >= 1;
  // Every foursome that has players is fine; arrange is always structurally valid.
  const step3Valid = true;
  // Point value must be a positive WHOLE-DOLLAR amount: the engine rejects any
  // non-×100 cents (registry.ts validateSchedule), so decimals are invalid — we
  // block Start rather than silently coerce a bad value (director review).
  const pointDollarsNum = Number(pointDollars);
  const pointValid = !guyanOn || (Number.isInteger(pointDollarsNum) && pointDollarsNum >= 1);
  const noClaimsOn = !ruleEnabled.greenie && !ruleEnabled.polie && !ruleEnabled.sandie;

  async function handleStart() {
    if (busy) return;
    // Defense-in-depth: the Start button is disabled when the point value is
    // invalid, but never let a bad value reach the money config via another path.
    if (guyanOn && !pointValid) return;
    setBusy(true);
    setError(null);
    try {
      const tz = TZ;
      const dateMs = dateStringToEpochMs(dateStr, tz);
      const name = eventName.trim() || `Quick Round — ${dateStr}`;

      // 1. Create the event (one round).
      setProgress('Creating event…');
      const created = (await apiSend('/api/admin/events', 'POST', {
        name,
        start_date: dateMs,
        end_date: dateMs,
        timezone: tz,
        rounds: [{ round_date: dateMs, course_revision_id: courseRevisionId, tee_color: teeColor.trim(), holes_to_play: holes }],
      })) as { eventId: string };
      const eventId = created.eventId;

      // 2. Resolve the auto-created groupId + eventRoundId.
      setProgress('Setting up…');
      const ctxRes = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/admin-context`, { credentials: 'same-origin' });
      if (!ctxRes.ok) throw new Error('admin_context_failed');
      const ctx = (await ctxRes.json()) as { groups: Array<{ id: string }>; eventRounds: Array<{ id: string }> };
      const groupId = ctx.groups[0]?.id;
      const eventRoundId = ctx.eventRounds[0]?.id;
      if (!groupId || !eventRoundId) throw new Error('event_context_incomplete');

      // 3. Add the roster; collect ids in entry order. GHIN-linked players are
      // added by GHIN (server resolves the live handicap); the rest are manual.
      setProgress('Adding players…');
      const playerIds: string[] = [];
      for (let i = 0; i < players.length; i++) {
        const p = players[i]!;
        const hi = p.handicap.trim() === '' ? undefined : Number(p.handicap);
        const body = p.ghin !== undefined
          ? { mode: 'ghin', ghin: p.ghin, firstName: p.firstName ?? '', lastName: p.lastName ?? '' }
          : {
              mode: 'manual',
              name: p.name.trim(),
              ...(hi !== undefined && Number.isFinite(hi) ? { manualHandicapIndex: hi } : {}),
            };
        const member = (await apiSend(`/api/admin/groups/${encodeURIComponent(groupId)}/members`, 'POST', body)) as { player: { id: string } };
        playerIds.push(member.player.id);
      }

      // 4. Open scoring policy — anyone validated (GHIN + join code) may score.
      await apiSend(`/api/admin/events/${encodeURIComponent(eventId)}/scorer-policy`, 'PUT', { policy: 'open' });

      // 5. Guyan rules (if elected) — locking the config makes it a money event.
      if (guyanOn) {
        setProgress('Saving rules…');
        await apiSend(`/api/admin/events/${encodeURIComponent(eventId)}/game-config`, 'PUT', {
          pointValueSchedule: { kind: 'flat', cents: pointDollarsNum * 100 },
          lockState: 'locked',
          modifiers: [
            { type: 'net-skins', enabled: ruleEnabled['net-skins'], variant: { basis: 'net', bonus: 'single' } },
            { type: 'greenie', enabled: ruleEnabled.greenie, variant: { carryover: true } },
            { type: 'polie', enabled: ruleEnabled.polie },
            { type: 'sandie', enabled: ruleEnabled.sandie },
          ],
        });
      }

      // 6. Putting and/or snake sub-games (all players participate).
      if (puttingOn || snakeOn) {
        setProgress('Adding games…');
        const subGames: Array<{ type: string; buyInPerParticipant: number; participantPlayerIds: string[] }> = [];
        if (puttingOn) subGames.push({ type: 'putting_contest', buyInPerParticipant: 0, participantPlayerIds: playerIds });
        if (snakeOn) subGames.push({ type: 'snake', buyInPerParticipant: 0, participantPlayerIds: playerIds });
        await apiSend(`/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/sub-games`, 'POST', { subGames });
      }

      // 7. Pairings (locked) from the arrange step.
      setProgress('Building foursomes…');
      const byFoursome = new Map<number, string[]>();
      for (let i = 0; i < players.length; i++) {
        const fn = foursomeOf[i] ?? 1;
        if (!byFoursome.has(fn)) byFoursome.set(fn, []);
        byFoursome.get(fn)!.push(playerIds[i]!);
      }
      const pairingsOut = [...byFoursome.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([fn, ids]) => ({ foursomeNumber: fn, locked: true, memberPlayerIds: ids }));
      await apiSend(`/api/admin/events/${encodeURIComponent(eventId)}/pairings`, 'POST', {
        rounds: [{ eventRoundId, pairings: pairingsOut }],
      });

      // 8. Start — organizer is the (always-eligible) scorer for each foursome;
      // the open policy + group-member gate let validated players score too.
      setProgress('Starting round…');
      const organizerId = session.player!.id;
      const started = (await apiSend(`/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/start`, 'POST', {
        scorers: pairingsOut.map((p) => ({ foursomeNumber: p.foursomeNumber, scorerPlayerId: organizerId })),
        confirmNoGame: !guyanOn,
        // Only acknowledge "no bonuses" when that's actually the case — otherwise
        // leave the guard active (it won't fire when a claim modifier is on).
        confirmNoModifiers: guyanOn && noClaimsOn,
      })) as { roundId: string };

      void navigate({ to: '/rounds/$roundId/score-entry', params: { roundId: started.roundId } });
    } catch (err) {
      setError((err as Error).message || 'unknown_error');
      setBusy(false);
      setProgress(null);
    }
  }

  if (session.player !== null && session.player.isOrganizer !== true) {
    return (
      <PageShell title="Create Quick Event">
        <p role="alert">Only organizers can create events.</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="Create Quick Event">
      <BackLink to="/" label="Home" />

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 6, margin: 'var(--space-2) 0 var(--space-4)' }}>
        {[1, 2, 3, 4].map((n) => (
          <div key={n} style={{ flex: 1, height: 4, borderRadius: 2, background: n <= step ? 'var(--color-brand-primary)' : 'var(--color-border)' }} />
        ))}
      </div>

      {/* STEP 1 — course / date / holes */}
      {step === 1 && (
        <section style={{ display: 'grid', gap: 'var(--space-3)' }} data-testid="quick-step-course">
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>Course & date</h2>
          {coursesQuery.isPending ? (
            <LoadingCard message="Loading courses…" />
          ) : coursesQuery.isError ? (
            <p role="alert" data-testid="quick-courses-error" style={{ color: 'var(--color-danger)' }}>
              Couldn’t load courses.{' '}
              <button type="button" onClick={() => coursesQuery.refetch()} style={{ background: 'none', border: 'none', color: 'var(--color-brand-primary)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>Retry</button>
            </p>
          ) : (
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>Course</span>
                <select
                  data-testid="quick-course"
                  value={courseRevisionId}
                  onChange={(e) => { setCourseRevisionId(e.target.value); setTeeColor(''); }}
                  style={inputStyle}
                >
                  <option value="">Select a course…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.latestRevision?.id ?? ''} disabled={!c.latestRevision}>
                      {c.name}{c.latestRevision ? '' : ' (no data)'}
                    </option>
                  ))}
                </select>
              </label>
              {tees.length > 0 ? (
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={labelStyle}>Tee</span>
                  <select data-testid="quick-tee" value={teeColor} onChange={(e) => setTeeColor(e.target.value)} style={inputStyle}>
                    <option value="">Select a tee…</option>
                    {tees.map((t) => <option key={t.color} value={t.color}>{t.color}</option>)}
                  </select>
                </label>
              ) : selectedCourse ? (
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={labelStyle}>Tee</span>
                  <input data-testid="quick-tee-text" value={teeColor} onChange={(e) => setTeeColor(e.target.value)} placeholder="e.g. White" style={inputStyle} />
                </label>
              ) : null}
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>Date</span>
                <input type="date" data-testid="quick-date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} style={inputStyle} />
              </label>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>Holes</span>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  {[9, 18].map((h) => (
                    <button key={h} type="button" data-testid={`quick-holes-${h}`} onClick={() => setHoles(h as 9 | 18)}
                      style={{ ...toggleStyle, ...(holes === h ? toggleActive : {}) }}>{h} holes</button>
                  ))}
                </div>
              </div>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>Event name (optional)</span>
                <input data-testid="quick-name" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder={`Quick Round — ${dateStr}`} style={inputStyle} />
              </label>
            </>
          )}
          <button type="button" data-testid="quick-next-1" disabled={!step1Valid} onClick={() => setStep(2)} style={primaryBtn}>Next</button>
        </section>
      )}

      {/* STEP 2 — roster (GHIN search + manual entry) */}
      {step === 2 && (
        <section style={{ display: 'grid', gap: 'var(--space-3)' }} data-testid="quick-step-players">
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>Players</h2>

          {/* GHIN search */}
          <div style={{ display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)' }}>
            <span style={labelStyle}>Search GHIN</span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input data-testid="quick-ghin-last" value={ghinLast} placeholder="Last name"
                onChange={(e) => { setGhinLast(e.target.value); setGhinSearchTriggered(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') runGhinSearch(); }}
                style={{ ...inputStyle, flex: 1 }} />
              <input data-testid="quick-ghin-first" value={ghinFirst} placeholder="First (optional)"
                onChange={(e) => { setGhinFirst(e.target.value); setGhinSearchTriggered(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') runGhinSearch(); }}
                style={{ ...inputStyle, flex: 1 }} />
            </div>
            <button type="button" data-testid="quick-ghin-search" disabled={ghinLast.trim().length === 0}
              onClick={runGhinSearch}
              style={{ ...secondaryBtn, opacity: ghinLast.trim().length === 0 ? 0.6 : 1 }}>
              Search
            </button>
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
              Add a first name to narrow common last names. WV golfers only (v1).
            </span>

            {ghinSearchQuery.isFetching ? <p style={{ margin: 0 }}>Searching…</p> : null}
            {ghinSearchQuery.data && 'error' in ghinSearchQuery.data ? (
              <p role="alert" data-testid="quick-ghin-unavailable" style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                GHIN search unavailable — add players manually below.
              </p>
            ) : null}
            {ghinSearchQuery.data && 'results' in ghinSearchQuery.data ? (
              ghinSearchQuery.data.results.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No matches in WV. Add a first name, or add manually.</p>
              ) : (
                <ul data-testid="quick-ghin-results" style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 300, overflowY: 'auto', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                  {ghinSearchQuery.data.results.map((r) => (
                    <li key={r.ghinNumber} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <span>
                        <strong>{r.firstName} {r.lastName}</strong>{r.handicapIndex !== null ? ` — HI ${r.handicapIndex}` : ''}
                        <span style={{ display: 'block', fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
                          GHIN {r.ghinNumber}{r.club ? ` · ${r.club}` : ''}
                        </span>
                      </span>
                      <button type="button" data-testid={`quick-ghin-add-${r.ghinNumber}`} onClick={() => addGhinPlayer(r)}
                        disabled={players.some((p) => p.ghin === r.ghinNumber)}
                        style={{ ...secondaryBtn, flexShrink: 0, padding: '0 var(--space-3)' }}>
                        {players.some((p) => p.ghin === r.ghinNumber) ? 'Added' : 'Add'}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>

          {/* Quick count + roster */}
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={labelStyle}>How many players?</span>
            <input type="number" inputMode="numeric" min={1} max={40} data-testid="quick-num-players" value={players.length}
              onChange={(e) => setRosterSize(Number(e.target.value))} style={inputStyle} />
          </label>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <span style={labelStyle}>Roster ({effectivePlayers.length})</span>
            {players.map((p, i) => (
              p.ghin !== undefined ? (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }} data-testid={`quick-roster-ghin-${i}`}>
                  <span style={{ flex: 1, overflowWrap: 'anywhere' }}>
                    {p.name}{p.handicap !== '' ? ` — HI ${p.handicap}` : ''}{' '}
                    <span style={{ fontSize: 'var(--font-xs)', fontWeight: 700, color: 'var(--color-brand-primary)', border: '1px solid var(--color-brand-primary)', borderRadius: 'var(--radius-sm)', padding: '0 4px' }}>GHIN</span>
                  </span>
                  <button type="button" aria-label={`Remove ${p.name}`} data-testid={`quick-player-remove-${i}`} onClick={() => removePlayer(i)} style={{ ...secondaryBtn, width: 44, padding: 0 }}>✕</button>
                </div>
              ) : (
                <div key={i} style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input data-testid={`quick-player-name-${i}`} value={p.name} placeholder={`Player ${i + 1}`}
                    onChange={(e) => updatePlayer(i, { name: e.target.value })}
                    style={{ ...inputStyle, flex: 1 }} />
                  <input data-testid={`quick-player-hcp-${i}`} value={p.handicap} placeholder="HCP" inputMode="decimal"
                    onChange={(e) => updatePlayer(i, { handicap: e.target.value })}
                    style={{ ...inputStyle, width: 72 }} />
                  <button type="button" aria-label={`Remove player ${i + 1}`} data-testid={`quick-player-remove-${i}`} onClick={() => removePlayer(i)} style={{ ...secondaryBtn, width: 44, padding: 0 }}>✕</button>
                </div>
              )
            ))}
            <button type="button" data-testid="quick-add-manual" onClick={addManualRow} style={secondaryBtn}>+ Add manual player</button>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" onClick={() => setStep(1)} style={secondaryBtn}>Back</button>
            <button type="button" data-testid="quick-next-2" disabled={!step2Valid} onClick={goToArrange} style={{ ...primaryBtn, flex: 1 }}>Next</button>
          </div>
        </section>
      )}

      {/* STEP 3 — arrange foursomes */}
      {step === 3 && (
        <section style={{ display: 'grid', gap: 'var(--space-3)' }} data-testid="quick-step-arrange">
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>Foursomes</h2>
          <p style={{ ...labelStyle, textTransform: 'none', letterSpacing: 0 }}>
            Set each player's group ({numFoursomes} group{numFoursomes === 1 ? '' : 's'}).
          </p>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            {players.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{p.name.trim() || `Player ${i + 1}`}</span>
                <select data-testid={`quick-foursome-${i}`} value={foursomeOf[i] ?? 1}
                  onChange={(e) => setFoursomeOf((prev) => prev.map((f, j) => j === i ? Number(e.target.value) : f))}
                  style={{ ...inputStyle, width: 120 }}>
                  {Array.from({ length: numFoursomes + 1 }, (_, k) => k + 1).map((fn) => (
                    <option key={fn} value={fn}>Group {fn}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" onClick={() => setStep(2)} style={secondaryBtn}>Back</button>
            <button type="button" data-testid="quick-next-3" disabled={!step3Valid} onClick={() => setStep(4)} style={{ ...primaryBtn, flex: 1 }}>Next</button>
          </div>
        </section>
      )}

      {/* STEP 4 — rules + start */}
      {step === 4 && (
        <section style={{ display: 'grid', gap: 'var(--space-3)' }} data-testid="quick-step-rules">
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>Games & rules</h2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={labelStyle}>Playing the Guyan game?</span>
            <button type="button" data-testid="quick-guyan-toggle" aria-pressed={guyanOn} onClick={() => setGuyanOn((v) => !v)}
              style={{ ...toggleStyle, ...(guyanOn ? toggleActive : {}) }}>{guyanOn ? 'Yes' : 'No'}</button>
          </div>
          {guyanOn && (
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>Per-point value ($, whole dollars)</span>
                <input data-testid="quick-point-value" inputMode="numeric" value={pointDollars} onChange={(e) => setPointDollars(e.target.value)} style={inputStyle} />
                {!pointValid ? (
                  <span data-testid="quick-point-error" style={{ fontSize: 'var(--font-xs)', color: 'var(--color-danger)' }}>
                    Enter a whole-dollar amount ($1 or more).
                  </span>
                ) : null}
              </label>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={labelStyle}>Bonuses</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  {RULE_PILLS.map((pill) => (
                    <button key={pill.type} type="button" data-testid={`quick-pill-${pill.type}`} aria-pressed={ruleEnabled[pill.type]}
                      onClick={() => setRuleEnabled((prev) => ({ ...prev, [pill.type]: !prev[pill.type] }))}
                      style={{ ...toggleStyle, ...(ruleEnabled[pill.type] ? toggleActive : {}) }}>{pill.label}</button>
                  ))}
                </div>
              </div>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-2)' }}>
            <span style={labelStyle}>Putting game? (tracks putts)</span>
            <button type="button" data-testid="quick-putting-toggle" aria-pressed={puttingOn} onClick={() => setPuttingOn((v) => !v)}
              style={{ ...toggleStyle, ...(puttingOn ? toggleActive : {}) }}>{puttingOn ? 'On' : 'Off'}</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={labelStyle}>Snake? (🐍 tap-to-take)</span>
            <button type="button" data-testid="quick-snake-toggle" aria-pressed={snakeOn} onClick={() => setSnakeOn((v) => !v)}
              style={{ ...toggleStyle, ...(snakeOn ? toggleActive : {}) }}>{snakeOn ? 'On' : 'Off'}</button>
          </div>

          {error !== null && (
            <p role="alert" data-testid="quick-error" style={{ color: 'var(--color-danger)' }}>
              Couldn’t start the round ({error}). Some of it may have been created — check Home.
            </p>
          )}
          {progress !== null && <p data-testid="quick-progress" style={{ color: 'var(--color-text-secondary)' }}>{progress}</p>}

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" onClick={() => setStep(3)} disabled={busy} style={secondaryBtn}>Back</button>
            <button type="button" data-testid="quick-start" disabled={busy || !pointValid} onClick={handleStart} style={{ ...primaryBtn, flex: 1, opacity: busy || !pointValid ? 0.6 : 1 }}>
              {busy ? 'Starting…' : 'Start round'}
            </button>
          </div>
          <p style={{ textAlign: 'center' }}>
            <Link to="/" style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>Cancel</Link>
          </p>
        </section>
      )}
    </PageShell>
  );
}

// ---- shared inline styles (phone-first: full-width, 44px+ tap targets) ----
const labelStyle: CSSProperties = { fontSize: 'var(--font-xs)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' };
const inputStyle: CSSProperties = { width: '100%', minHeight: 'var(--control-height-lg)', padding: '0 12px', fontSize: 'var(--font-md)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', boxSizing: 'border-box' };
const primaryBtn: CSSProperties = { minHeight: 'var(--control-height-lg)', borderRadius: 'var(--radius-md)', background: 'var(--color-brand-primary)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 'var(--font-md)', cursor: 'pointer' };
const secondaryBtn: CSSProperties = { minHeight: 'var(--control-height-lg)', padding: '0 var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', fontWeight: 700, cursor: 'pointer' };
const toggleStyle: CSSProperties = { minHeight: 44, padding: '0 var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', fontWeight: 700, cursor: 'pointer' };
const toggleActive: CSSProperties = { background: 'var(--color-brand-primary)', color: '#fff', border: '1px solid var(--color-brand-primary)' };

export const Route = createFileRoute('/admin/events/quick')({
  // Anonymous → /join (standard auth gate); organizers see the wizard, a
  // logged-in non-organizer hits the in-component "only organizers" message.
  beforeLoad: () => requireAuthOrRedirect(),
  component: QuickEventPage,
});
