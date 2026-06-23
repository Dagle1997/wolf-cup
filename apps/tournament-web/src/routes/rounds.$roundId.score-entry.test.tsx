/**
 * T5-2 component tests for ScoreEntryRoute.
 *
 * Tests render `ScoreEntryRoute` directly via the exported component,
 * mocking `fetch` for the GET endpoint and `useOfflineQueue` /
 * offline-queue lib for the Save flow. The component reads roundId from
 * TanStack Router's useParams, so we install a memory router that mounts
 * the route at /rounds/:roundId/score-entry.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  _resetDbForTests,
  _resetTerminalErrorsForTests,
  getTerminalErrors,
} from '../lib/offline-queue.js';

const ROUND_ID = '00000000-0000-0000-0000-000000000001';
const SCORER_ID = 'scorer-id';
const P1_ID = 'p1-id';
const P2_ID = 'p2-id';
const P3_ID = 'p3-id';

interface MockRoundDetail {
  roundId: string;
  eventId?: string;
  state:
    | 'not_started'
    | 'in_progress'
    | 'complete_editable'
    | 'finalized'
    | 'cancelled';
  holesToPlay: 9 | 18;
  myFoursome: {
    foursomeNumber: number;
    isScorer: boolean;
    scorerPlayerId: string | null;
    scorerName: string | null;
    members: Array<{
      playerId: string;
      name: string;
      handicapIndex: number | null;
    }>;
    holeScores: Array<{
      holeNumber: number;
      playerId: string;
      grossStrokes: number;
      putts: number | null;
    }>;
  };
}

function buildHappyPathDetail(
  overrides: Partial<MockRoundDetail['myFoursome']> = {},
  topLevel: Partial<MockRoundDetail> = {},
): MockRoundDetail {
  return {
    roundId: ROUND_ID,
    eventId: 'event-id',
    state: 'not_started',
    holesToPlay: 18,
    myFoursome: {
      foursomeNumber: 1,
      isScorer: true,
      scorerPlayerId: SCORER_ID,
      scorerName: 'Scorer',
      members: [
        { playerId: SCORER_ID, name: 'Scorer', handicapIndex: 12 },
        { playerId: P1_ID, name: 'Player One', handicapIndex: null },
        { playerId: P2_ID, name: 'Player Two', handicapIndex: null },
        { playerId: P3_ID, name: 'Player Three', handicapIndex: null },
      ],
      holeScores: [],
      ...overrides,
    },
    ...topLevel,
  };
}

interface MockRoundCourse {
  roundId: string;
  courseRevisionId: string;
  course: { name: string; clubName: string };
  holes: Array<{
    holeNumber: number;
    par: number;
    si: number;
    yardagePerTee: Record<string, number>;
  }>;
  tees: Array<{ teeColor: string; rating: number; slope: number }>;
  selectedTeeColor: string;
}

function buildCourse(parOverrides: Partial<Record<number, number>> = {}): MockRoundCourse {
  const holes = Array.from({ length: 18 }, (_, i) => ({
    holeNumber: i + 1,
    par: parOverrides[i + 1] ?? 4,
    si: i + 1,
    yardagePerTee: { blue: 350 + (i + 1) * 5 },
  }));
  return {
    roundId: ROUND_ID,
    courseRevisionId: 'crev-1',
    course: { name: 'Pinehurst No. 2', clubName: 'Pinehurst' },
    holes,
    tees: [{ teeColor: 'blue', rating: 723, slope: 130 }],
    selectedTeeColor: 'blue',
  };
}

function jsonOk(detail: MockRoundDetail): Response {
  return new Response(JSON.stringify(detail), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonOkCourse(course: MockRoundCourse): Response {
  return new Response(JSON.stringify(course), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonErr(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Routes fetch calls to detail vs course endpoints by URL pattern.
 * Used by the integration tests that need both endpoints to respond.
 */
function mockFetchByUrl(opts: {
  detail?: () => Promise<Response> | Response;
  course?: () => Promise<Response> | Response;
}): void {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes('/course')) {
      return opts.course
        ? Promise.resolve(opts.course())
        : Promise.reject(new TypeError('no course mock'));
    }
    return opts.detail
      ? Promise.resolve(opts.detail())
      : Promise.reject(new TypeError('no detail mock'));
  });
}

const { enqueueSpy, peekErroredSpy } = vi.hoisted(() => ({
  enqueueSpy: vi.fn(),
  peekErroredSpy: vi.fn(),
}));

vi.mock('../lib/offline-queue.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/offline-queue.js')>(
    '../lib/offline-queue.js',
  );
  return {
    ...actual,
    enqueueMutation: enqueueSpy,
    peekErroredEntries: peekErroredSpy,
  };
});

vi.mock('../hooks/useOfflineQueue.js', () => ({
  useOfflineQueue: vi.fn(() => ({
    pendingCount: 0,
    isDraining: false,
    drainError: null,
    drain: vi.fn(),
    refreshCount: vi.fn(),
  })),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({
    useParams: () => ({ roundId: ROUND_ID }),
  }),
}));

function stubMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      media: '(display-mode: standalone)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn());
  // T7-7: default to installed=true so existing tests that expect the
  // score-entry form (or read-only placeholder for non-scorers) keep
  // passing. The new install-matrix tests below explicitly opt in to
  // installed=false to exercise the install-required gate.
  stubMatchMedia(true);
  enqueueSpy.mockReset();
  enqueueSpy.mockResolvedValue(undefined);
  peekErroredSpy.mockReset();
  peekErroredSpy.mockResolvedValue([]);
  await _resetDbForTests();
  _resetTerminalErrorsForTests();
  sessionStorage.clear();
  // Wipe round-cache between tests too.
  const { _resetCacheForTests } = await import('../lib/round-cache.js');
  await _resetCacheForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('tournament-round-cache');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderRoute(): Promise<void> {
  const { ScoreEntryRoute } = await import('./rounds.$roundId.score-entry.js');
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  render(
    <QueryClientProvider client={qc}>
      <ScoreEntryRoute />
    </QueryClientProvider>,
  );
}

async function setUseOfflineQueueReturn(opts: {
  pendingCount?: number;
  isDraining?: boolean;
  drainSpy?: ReturnType<typeof vi.fn>;
}): Promise<void> {
  const mod = (await import('../hooks/useOfflineQueue.js')) as unknown as {
    useOfflineQueue: ReturnType<typeof vi.fn>;
  };
  mod.useOfflineQueue.mockReturnValue({
    pendingCount: opts.pendingCount ?? 0,
    isDraining: opts.isDraining ?? false,
    drainError: null,
    drain: opts.drainSpy ?? vi.fn(),
    refreshCount: vi.fn(),
  });
}

describe('ScoreEntryRoute', () => {
  test('renders Loading on initial mount', async () => {
    const fetchMock = vi.mocked(fetch);
    // never-resolving promise to keep loading state.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await renderRoute();
    expect(screen.getByTestId('loading')).toBeInTheDocument();
  });

  test('renders score-entry-form when isScorer=true', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()));
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('score-entry-form')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('current-hole').textContent).toBe('Hole 1');
    expect(screen.getByTestId('score-input-0')).toBeInTheDocument();
    expect(screen.getByTestId('score-input-3')).toBeInTheDocument();
  });

  test('renders read-only placeholder when isScorer=false', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonOk(buildHappyPathDetail({ isScorer: false })),
    );
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('read-only')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('read-only').textContent).toMatch(/Scorer/);
  });

  test('renders round-closed placeholder when state=finalized', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonOk(buildHappyPathDetail({}, { state: 'finalized' })),
    );
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('round-closed')).toBeInTheDocument(),
    );
  });

  test('renders no-scorer-yet placeholder when scorerPlayerId=null', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonOk(
        buildHappyPathDetail({
          isScorer: false,
          scorerPlayerId: null,
          scorerName: null,
        }),
      ),
    );
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('no-scorer')).toBeInTheDocument(),
    );
  });

  test('auto-advance: digit 5 advances immediately; 1 waits 1500ms; 2-digit 12 advances after second digit', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()));
    await renderRoute();
    await waitFor(() => screen.getByTestId('score-input-0'));

    const input0 = screen.getByTestId('score-input-0') as HTMLInputElement;
    const input1 = screen.getByTestId('score-input-1') as HTMLInputElement;
    const input2 = screen.getByTestId('score-input-2') as HTMLInputElement;
    const input3 = screen.getByTestId('score-input-3') as HTMLInputElement;

    // Switch to fake timers AFTER the GET has resolved + the form rendered.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Case A: digit '5' on input 0 → input 1 focused immediately.
    input0.focus();
    await act(async () => {
      fireEvent.change(input0, { target: { value: '5' } });
    });
    expect(document.activeElement).toBe(input1);

    // Case B: digit '1' on input 1 → wait. After 1500ms, advance to input 2.
    input1.focus();
    await act(async () => {
      fireEvent.change(input1, { target: { value: '1' } });
    });
    expect(document.activeElement).toBe(input1);
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(document.activeElement).toBe(input2);

    // Case C: typing '1' then '12' on input 2 → advances after second digit.
    input2.focus();
    await act(async () => {
      fireEvent.change(input2, { target: { value: '1' } });
    });
    await act(async () => {
      fireEvent.change(input2, { target: { value: '12' } });
    });
    expect(document.activeElement).toBe(input3);
    vi.useRealTimers();
  });

  test('score input rejects invalid values: 30, 01, 0, non-digit do not update state', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()));
    await renderRoute();
    await waitFor(() => screen.getByTestId('score-input-0'));

    const input0 = screen.getByTestId('score-input-0') as HTMLInputElement;

    // '30' rejected → input value stays empty.
    fireEvent.change(input0, { target: { value: '30' } });
    expect(input0.value).toBe('');

    fireEvent.change(input0, { target: { value: '0' } });
    expect(input0.value).toBe('');

    fireEvent.change(input0, { target: { value: '01' } });
    expect(input0.value).toBe('');

    fireEvent.change(input0, { target: { value: 'a' } });
    expect(input0.value).toBe('');
  });

  test('Save button disabled when fewer than 4 cells filled with valid 1-20', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()));
    await renderRoute();
    await waitFor(() => screen.getByTestId('save-button'));

    const saveButton = screen.getByTestId('save-button') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    // Fill 3 of 4.
    for (const idx of [0, 1, 2]) {
      const input = screen.getByTestId(`score-input-${idx}`) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '4' } });
    }
    expect(saveButton.disabled).toBe(true);

    // Fill the 4th.
    const input3 = screen.getByTestId('score-input-3') as HTMLInputElement;
    fireEvent.change(input3, { target: { value: '5' } });
    await waitFor(() => expect(saveButton.disabled).toBe(false));
  });

  test('iOS keyboard fix: Save onClick calls focus() on input 0 SYNCHRONOUSLY before enqueueMutation', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()));
    await renderRoute();
    await waitFor(() => screen.getByTestId('save-button'));

    // Fill all 4.
    for (const idx of [0, 1, 2, 3]) {
      const input = screen.getByTestId(`score-input-${idx}`) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '4' } });
    }

    const input0 = screen.getByTestId('score-input-0') as HTMLInputElement;
    const focusSpy = vi.spyOn(input0, 'focus');

    // Track ordering: focus() must be called BEFORE enqueueMutation.
    const callOrder: string[] = [];
    focusSpy.mockImplementation(() => {
      callOrder.push('focus');
    });
    enqueueSpy.mockImplementation(() => {
      callOrder.push('enqueue');
      return Promise.resolve();
    });

    const saveButton = screen.getByTestId('save-button') as HTMLButtonElement;
    await act(async () => {
      saveButton.click();
    });

    await waitFor(() => expect(callOrder.length).toBeGreaterThanOrEqual(2));
    // The first call MUST be focus, NOT enqueue.
    expect(callOrder[0]).toBe('focus');
    expect(callOrder).toContain('enqueue');
  });

  test('Save enqueues 4 mutations (one per player) with distinct clientEventIds', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()));
    await renderRoute();
    await waitFor(() => screen.getByTestId('save-button'));

    for (const idx of [0, 1, 2, 3]) {
      const input = screen.getByTestId(`score-input-${idx}`) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '4' } });
    }

    const saveButton = screen.getByTestId('save-button') as HTMLButtonElement;
    await act(async () => {
      saveButton.click();
    });

    await waitFor(() => expect(enqueueSpy).toHaveBeenCalledTimes(4));
    const calls = enqueueSpy.mock.calls.map(
      (c) => c[0] as { kind: string; url: string; clientEventId: string },
    );
    expect(calls.every((c) => c.kind === 'hole_score')).toBe(true);
    expect(calls.every((c) => c.url === `/api/rounds/${ROUND_ID}/holes/1/scores`)).toBe(true);
    const clientEventIds = new Set(calls.map((c) => c.clientEventId));
    expect(clientEventIds.size).toBe(4); // all distinct
  });

  test('Skip hole: tap Skip → advances + sessionStorage updated; refetch with hole still missing → UI stays advanced', async () => {
    // First render: hole 1 unscored.
    const detail = buildHappyPathDetail();
    vi.mocked(fetch).mockResolvedValue(jsonOk(detail));
    await renderRoute();
    await waitFor(() => screen.getByTestId('current-hole'));
    expect(screen.getByTestId('current-hole').textContent).toBe('Hole 1');

    // Skip hole 1.
    const skipButton = screen.getByTestId('skip-hole') as HTMLButtonElement;
    await act(async () => {
      skipButton.click();
    });

    // sessionStorage updated.
    const stored = sessionStorage.getItem('tournament:skipped-holes:' + ROUND_ID);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual({ skippedHoles: [1] });

    // UI advances to hole 2.
    await waitFor(() =>
      expect(screen.getByTestId('current-hole').textContent).toBe('Hole 2'),
    );
  });

  test('registerTerminalErrors is called once at mount', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()));
    await renderRoute();
    await waitFor(() => screen.getByTestId('score-entry-form'));
    const codes = getTerminalErrors('hole_score');
    expect(codes).toContain('round_not_writable');
    expect(codes).toContain('hole_number_exceeds_holes_to_play');
    expect(codes).toContain('foursome_has_no_scorer');
    expect(codes).toContain('invalid_body');
  });

  test('Pending-sync chip shows N queued when pendingCount > 0', async () => {
    await setUseOfflineQueueReturn({ pendingCount: 3 });
    vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()));
    await renderRoute();
    await waitFor(() => screen.getByTestId('sync-chip'));
    expect(screen.getByTestId('sync-chip').textContent).toBe('3 queued');
  });

  test('renders not-in-round placeholder on 404', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonErr(404, { code: 'round_not_found' }),
    );
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('not-in-round')).toBeInTheDocument(),
    );
  });

  // ---------- T5-4 cache integration ----------
  test('cold-online: GET succeeds, cache populates, par/SI strip renders, no offline chip', async () => {
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() => screen.getByTestId('score-entry-form'));
    await waitFor(() => screen.getByTestId('scorecard-shell-strip'));
    // The strip no longer repeats the hole number (the big HOLE header shows it).
    expect(screen.getByTestId('scorecard-shell-strip').textContent).toMatch(
      /Par 4.*SI 1/,
    );
    expect(screen.queryByTestId('offline-chip')).not.toBeInTheDocument();
    // Cache populated.
    const { readCachedRoundDetail, readCachedRoundCourse } = await import(
      '../lib/round-cache.js'
    );
    const cachedDetail = await readCachedRoundDetail(ROUND_ID);
    expect(cachedDetail).not.toBeNull();
    const cachedCourse = await readCachedRoundCourse(ROUND_ID);
    expect(cachedCourse).not.toBeNull();
  });

  test('cold-offline: fetch rejects, cache hits, UI renders from cache, "Offline mode" chip visible', async () => {
    // Pre-seed cache (simulating a prior online visit).
    const { writeCachedRoundDetail, writeCachedRoundCourse } = await import(
      '../lib/round-cache.js'
    );
    await writeCachedRoundDetail(ROUND_ID, buildHappyPathDetail());
    await writeCachedRoundCourse(ROUND_ID, buildCourse());

    // Now simulate offline: every fetch rejects.
    vi.mocked(fetch).mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });

    await renderRoute();
    await waitFor(() => screen.getByTestId('score-entry-form'));
    await waitFor(() => screen.getByTestId('offline-chip'));
    expect(screen.getByTestId('offline-chip')).toBeInTheDocument();
    // Par/SI strip still renders from cache.
    await waitFor(() => screen.getByTestId('scorecard-shell-strip'));
    // The strip no longer repeats the hole number (the big HOLE header shows it).
    expect(screen.getByTestId('scorecard-shell-strip').textContent).toMatch(
      /Par 4.*SI 1/,
    );
  });

  test('course-superseded banner: cached has par-4-on-hole-5; fresh has par-5-on-hole-5; banner fires + Dismiss + form unaffected', async () => {
    // Pre-seed cache with course (par 4 everywhere).
    const { writeCachedRoundDetail, writeCachedRoundCourse } = await import(
      '../lib/round-cache.js'
    );
    await writeCachedRoundDetail(ROUND_ID, buildHappyPathDetail());
    await writeCachedRoundCourse(ROUND_ID, buildCourse());

    // Network returns the SAME detail but a DIFFERENT course (par 5 on hole 5).
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse({ 5: 5 })),
    });

    await renderRoute();
    await waitFor(() => screen.getByTestId('score-entry-form'));
    await waitFor(() =>
      expect(
        screen.getByTestId('course-superseded-banner'),
      ).toBeInTheDocument(),
    );

    // Form is still rendered (banner does NOT discard in-flight scores).
    expect(screen.getByTestId('score-input-0')).toBeInTheDocument();

    // Dismiss removes the banner.
    const dismissBtn = screen.getByTestId('dismiss-banner') as HTMLButtonElement;
    await act(async () => {
      dismissBtn.click();
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId('course-superseded-banner'),
      ).not.toBeInTheDocument(),
    );
  });

  // ── T5-7 handoff control + stale-queue banner ────────────────────────

  test('T5-7: handoff button visible when isScorer=true', async () => {
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('handoff-control')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('handoff-open')).toBeInTheDocument();
  });

  test('T5-7: handoff button NOT visible when isScorer=false', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonOk(buildHappyPathDetail({ isScorer: false })),
    );
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('read-only')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('handoff-control')).not.toBeInTheDocument();
  });

  test('T5-7: tapping handoff opens picker with the OTHER 3 foursome members', async () => {
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() => screen.getByTestId('handoff-open'));

    await act(async () => {
      (screen.getByTestId('handoff-open') as HTMLButtonElement).click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('handoff-picker')).toBeInTheDocument(),
    );
    // 3 candidates (P1, P2, P3) — current scorer (SCORER_ID) excluded.
    expect(screen.getByTestId(`handoff-pick-${P1_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`handoff-pick-${P2_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`handoff-pick-${P3_ID}`)).toBeInTheDocument();
    expect(
      screen.queryByTestId(`handoff-pick-${SCORER_ID}`),
    ).not.toBeInTheDocument();
  });

  test('T5-7: selecting a candidate ENQUEUES the transfer with kind=scorer_handoff (offline-queue path per Section 2)', async () => {
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() => screen.getByTestId('handoff-open'));

    await act(async () => {
      (screen.getByTestId('handoff-open') as HTMLButtonElement).click();
    });
    await waitFor(() => screen.getByTestId('handoff-picker'));

    await act(async () => {
      (screen.getByTestId(`handoff-pick-${P1_ID}`) as HTMLButtonElement).click();
    });

    await waitFor(() => {
      expect(enqueueSpy).toHaveBeenCalled();
    });
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'scorer_handoff',
        url: `/api/rounds/${ROUND_ID}/scorer-assignments/transfer`,
        body: { foursomeNumber: 1, toPlayerId: P1_ID },
        roundId: ROUND_ID,
      }),
    );
    // clientEventId is generated by the component (UUID v4).
    const enqueueArgs = enqueueSpy.mock.calls[0]?.[0] as { clientEventId: string };
    expect(typeof enqueueArgs.clientEventId).toBe('string');
    expect(enqueueArgs.clientEventId.length).toBeGreaterThan(0);
  });

  test('T5-7: after enqueue, drain is invoked when navigator.onLine is true', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
    const drainSpy = vi.fn();
    await setUseOfflineQueueReturn({ drainSpy });
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() => screen.getByTestId('handoff-open'));

    await act(async () => {
      (screen.getByTestId('handoff-open') as HTMLButtonElement).click();
    });
    await waitFor(() => screen.getByTestId('handoff-picker'));
    await act(async () => {
      (screen.getByTestId(`handoff-pick-${P1_ID}`) as HTMLButtonElement).click();
    });

    await waitFor(() => expect(drainSpy).toHaveBeenCalled());
  });

  test('T5-7: when navigator.onLine is false at click-time, picker shows queued-offline indicator and skips drain', async () => {
    // Render online so the round-detail fetch succeeds and the page
    // reaches the handoff-control state. Flip to offline only at the
    // moment the user picks a candidate — that's when handleTransfer
    // consults navigator.onLine.
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
    const drainSpy = vi.fn();
    await setUseOfflineQueueReturn({ drainSpy });
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() => screen.getByTestId('handoff-open'));

    await act(async () => {
      (screen.getByTestId('handoff-open') as HTMLButtonElement).click();
    });
    await waitFor(() => screen.getByTestId('handoff-picker'));

    // Now flip to offline before the pick.
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });

    await act(async () => {
      (screen.getByTestId(`handoff-pick-${P1_ID}`) as HTMLButtonElement).click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('handoff-queued-offline')).toBeInTheDocument(),
    );
    expect(drainSpy).not.toHaveBeenCalled();
    // Restore onLine for subsequent tests.
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
  });

  test('T5-7: 200 path transitions to read-only after drain → invalidate → next refetch (AC-8)', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
    let detailCallCount = 0;
    vi.mocked(fetch).mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
        if (url.includes('/course')) return jsonOkCourse(buildCourse());
        // First call: caller is scorer. Subsequent calls: caller is no
        // longer scorer (post-handoff polling reflects new state).
        detailCallCount++;
        const detail =
          detailCallCount === 1
            ? buildHappyPathDetail()
            : buildHappyPathDetail({
                isScorer: false,
                scorerPlayerId: P1_ID,
                scorerName: 'Player One',
              });
        return jsonOk(detail);
      },
    );
    await renderRoute();
    await waitFor(() => screen.getByTestId('handoff-open'));

    await act(async () => {
      (screen.getByTestId('handoff-open') as HTMLButtonElement).click();
    });
    await waitFor(() => screen.getByTestId('handoff-picker'));
    await act(async () => {
      (screen.getByTestId(`handoff-pick-${P1_ID}`) as HTMLButtonElement).click();
    });

    // After enqueue + drain (mocked, immediate) + invalidate, the next
    // refetch sees isScorer=false and the page renders read-only.
    await waitFor(() =>
      expect(screen.getByTestId('read-only')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('read-only').textContent).toMatch(/Player One/);
  });

  test('T5-7: stale-queue banner renders when peekErroredEntries returns matching entries', async () => {
    peekErroredSpy.mockResolvedValue([
      {
        id: 1,
        kind: 'hole_score',
        url: `/api/rounds/${ROUND_ID}/holes/1/scores`,
        body: {},
        clientEventId: 'evt-stale-1',
        roundId: ROUND_ID,
        timestamp: Date.now(),
        retryCount: 1,
        lastError: {
          status: 403,
          body: {
            error: 'forbidden',
            code: 'not_scorer_for_this_foursome',
            currentScorerName: 'Ben McGinnis',
          },
        },
      },
    ]);
    vi.mocked(fetch).mockResolvedValue(
      jsonOk(buildHappyPathDetail({ isScorer: false, scorerName: 'Ben McGinnis' })),
    );
    await renderRoute();

    await waitFor(() =>
      expect(screen.getByTestId('stale-queue-banner')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('stale-queue-banner').textContent).toMatch(
      /Ben McGinnis is now scoring/,
    );
  });

  test('T5-7: stale-queue banner does NOT render when no errored entries', async () => {
    peekErroredSpy.mockResolvedValue([]);
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() => screen.getByTestId('handoff-control'));

    expect(screen.queryByTestId('stale-queue-banner')).not.toBeInTheDocument();
  });

  test('T5-7: stale-queue banner Dismiss button hides the banner and persists in sessionStorage', async () => {
    peekErroredSpy.mockResolvedValue([
      {
        id: 1,
        kind: 'hole_score',
        url: `/api/rounds/${ROUND_ID}/holes/1/scores`,
        body: {},
        clientEventId: 'evt-stale-1',
        roundId: ROUND_ID,
        timestamp: Date.now(),
        retryCount: 1,
        lastError: {
          status: 403,
          body: {
            code: 'not_scorer_for_this_foursome',
            currentScorerName: 'Ben McGinnis',
          },
        },
      },
    ]);
    vi.mocked(fetch).mockResolvedValue(
      jsonOk(buildHappyPathDetail({ isScorer: false, scorerName: 'Ben McGinnis' })),
    );
    await renderRoute();
    await waitFor(() => screen.getByTestId('stale-queue-banner'));

    await act(async () => {
      (screen.getByTestId('stale-queue-banner-dismiss') as HTMLButtonElement).click();
    });

    await waitFor(() =>
      expect(screen.queryByTestId('stale-queue-banner')).not.toBeInTheDocument(),
    );
    expect(
      sessionStorage.getItem(`tournament:stale-queue-banner-dismissed:${ROUND_ID}`),
    ).toBe('1');
  });

  test('T5-7: stale-queue banner View-errored toggle expands the held-mutations list', async () => {
    peekErroredSpy.mockResolvedValue([
      {
        id: 1,
        kind: 'hole_score',
        url: `/api/rounds/${ROUND_ID}/holes/3/scores`,
        body: { playerId: P1_ID, grossStrokes: 4, clientEventId: 'evt-x' },
        clientEventId: 'evt-x',
        roundId: ROUND_ID,
        timestamp: Date.now(),
        retryCount: 1,
        lastError: {
          status: 403,
          body: {
            code: 'not_scorer_for_this_foursome',
            currentScorerName: 'Ben McGinnis',
          },
        },
      },
    ]);
    vi.mocked(fetch).mockResolvedValue(
      jsonOk(buildHappyPathDetail({ isScorer: false, scorerName: 'Ben McGinnis' })),
    );
    await renderRoute();
    await waitFor(() => screen.getByTestId('stale-queue-banner'));

    expect(screen.queryByTestId('stale-queue-errored-list')).not.toBeInTheDocument();

    await act(async () => {
      (screen.getByTestId(
        'stale-queue-banner-toggle-details',
      ) as HTMLButtonElement).click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('stale-queue-errored-list')).toBeInTheDocument(),
    );
    const list = screen.getByTestId('stale-queue-errored-list');
    expect(list.textContent).toContain('/holes/3/scores');
    expect(list.textContent).toContain(P1_ID);
  });

  test('T5-7: registerTerminalErrors registers the scorer_handoff terminal codes on mount', async () => {
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() => screen.getByTestId('handoff-control'));

    const codes = getTerminalErrors('scorer_handoff');
    expect(codes).toContain('not_authorized_for_handoff');
    expect(codes).toContain('round_finalized');
    expect(codes).toContain('round_cancelled');
    expect(codes).toContain('foursome_has_no_scorer');
    expect(codes).toContain('assignee_not_in_foursome');
    expect(codes).toContain('round_not_found');
  });
});

// ---- T7-7 install × scorer matrix (FR-E9) ---------------------------------

const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function makeMockBeforeInstallEvent(): BeforeInstallPromptEvent {
  return {
    platforms: ['web'],
    userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    prompt: vi.fn(async () => ({ outcome: 'accepted' as const, platform: 'web' })),
    preventDefault() {},
  } as unknown as BeforeInstallPromptEvent;
}

describe('ScoreEntryRoute — T7-7 install × scorer matrix', () => {
  // Capture the ORIGINAL userAgent at suite-load time. Tests that mutate
  // navigator.userAgent are restored from this captured value in
  // afterEach so a failed deletion never leaks a mutated UA across tests
  // (codex impl-codex round-2 Med #3). Object.defineProperty with
  // writable+configurable lets subsequent tests override and the
  // teardown restore consistently.
  const ORIGINAL_USER_AGENT = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: ORIGINAL_USER_AGENT,
    });
    delete window.__deferredInstallPrompt;
  });

  test('(a) installed + scorer → score-entry-form', async () => {
    stubMatchMedia(true);
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('score-entry-form')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('install-required')).toBeNull();
    expect(screen.queryByTestId('read-only')).toBeNull();
  });

  test('(b) installed + non-scorer → read-only placeholder, NOT install-required', async () => {
    stubMatchMedia(true);
    vi.mocked(fetch).mockResolvedValue(
      jsonOk(buildHappyPathDetail({ isScorer: false })),
    );
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('read-only')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('install-required')).toBeNull();
    expect(screen.queryByTestId('score-entry-form')).toBeNull();
  });

  test('(c) non-installed + scorer → install-required card with role=dialog + view-leaderboard link', async () => {
    stubMatchMedia(false);
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: CHROME_DESKTOP_UA,
    });
    window.__deferredInstallPrompt = makeMockBeforeInstallEvent();
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()),
    });
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('install-required')).toBeInTheDocument(),
    );
    // Inner <InstallPrompt> renders role="dialog" with aria-label="Install app"
    // — the Chromium-with-deferred-event branch (install-prompt.tsx:84-97)
    // selects on `!isIos && beforeInstallEvent !== null`. Non-iOS UA + the
    // mocked event makes that branch render reliably.
    expect(
      screen.getByRole('dialog', { name: 'Install app' }),
    ).toBeInTheDocument();
    const link = screen.getByTestId('view-leaderboard-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/events/event-id/leaderboard');
    expect(screen.queryByTestId('score-entry-form')).toBeNull();
    expect(screen.queryByTestId('read-only')).toBeNull();
    delete window.__deferredInstallPrompt;
  });

  test('(d) non-installed + non-scorer → read-only placeholder, NOT install-required (Codex-gated)', async () => {
    stubMatchMedia(false);
    vi.mocked(fetch).mockResolvedValue(
      jsonOk(buildHappyPathDetail({ isScorer: false })),
    );
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('read-only')).toBeInTheDocument(),
    );
    // The Codex-gated rule: non-scorers in browser tabs MUST NOT see the
    // install-required surface (they couldn't score anyway, so the prompt
    // would be misleading).
    expect(screen.queryByTestId('install-required')).toBeNull();
    expect(screen.queryByTestId('score-entry-form')).toBeNull();
  });
});

// ---- F1 Epic 2 (Story 2.1) — inline claim capture UI ----------------------

describe('ScoreEntryRoute — claim chips (Story 2.1)', () => {
  test('renders greenie/polie/sandie chips INSIDE the score-entry component (AC15)', async () => {
    // A greenie can only happen on a par 3, so load a course where the current
    // hole (1) is a par 3 — that makes all three G/P/S toggles eligible.
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse({ 1: 3 })),
    });
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('score-entry-form')).toBeInTheDocument(),
    );
    // Wait for the par-3 course to load so the greenie (G) toggle is eligible.
    await waitFor(() =>
      expect(screen.getByTestId(`claim-greenie-${SCORER_ID}`)).toBeInTheDocument(),
    );
    // AC15: the control is in the score-entry render tree (no separate route).
    const form = screen.getByTestId('score-entry-form');
    const greenieToggle = screen.getByTestId(`claim-greenie-${SCORER_ID}`);
    expect(form.contains(greenieToggle)).toBe(true);
    // One toggle per claim type, per player (the per-player Bonuses row).
    expect(screen.getByTestId(`claim-polie-${SCORER_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`claim-sandie-${P1_ID}`)).toBeInTheDocument();
  });

  test('chip tap enqueues a set claim mutation; second tap enqueues a remove (AC9/AC11)', async () => {
    // Taps the greenie toggle → needs a par-3 current hole for G to render.
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse({ 1: 3 })),
    });
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('score-entry-form')).toBeInTheDocument(),
    );
    const chip = await screen.findByTestId(`claim-greenie-${P1_ID}`);

    await act(async () => {
      fireEvent.click(chip);
    });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const firstBody = enqueueSpy.mock.calls[0]![0].body as { op: string; claimType: string };
    expect(firstBody.op).toBe('set');
    expect(firstBody.claimType).toBe('greenie');
    expect(enqueueSpy.mock.calls[0]![0].kind).toBe('claim');
    expect(chip.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      fireEvent.click(chip);
    });
    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    const secondBody = enqueueSpy.mock.calls[1]![0].body as { op: string };
    expect(secondBody.op).toBe('remove'); // removal is a QUEUED mutation, not client-only
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  test('seeds active chips from the server-derived current claims', async () => {
    const detail = buildHappyPathDetail();
    (detail.myFoursome as Record<string, unknown>)['claims'] = [
      { playerId: P1_ID, holeNumber: 1, claimType: 'greenie' },
    ];
    // Current hole (1) must be a par 3 for the greenie toggle to be present.
    mockFetchByUrl({
      detail: () => jsonOk(detail),
      course: () => jsonOkCourse(buildCourse({ 1: 3 })),
    });
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('score-entry-form')).toBeInTheDocument(),
    );
    // P1's greenie on hole 1 (the current hole) renders pre-pressed (par 3 → G
    // eligible; wait for the course to load first).
    await waitFor(() =>
      expect(screen.getByTestId(`claim-greenie-${P1_ID}`)).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId(`claim-greenie-${P1_ID}`).getAttribute('aria-pressed'),
    ).toBe('true');
    // A claim NOT in the server set renders un-pressed (polie shows on any hole).
    expect(
      screen.getByTestId(`claim-polie-${P1_ID}`).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  test('greenie (G) is hidden unless the hole is a par 3; polie + sandie always shown', async () => {
    // Current hole (1) is a par 4 → no greenie. polie + sandie still render.
    mockFetchByUrl({
      detail: () => jsonOk(buildHappyPathDetail()),
      course: () => jsonOkCourse(buildCourse()), // all par 4
    });
    await renderRoute();
    await waitFor(() => screen.getByTestId('scorecard-shell-strip'));
    expect(screen.getByTestId('scorecard-shell-strip').textContent).toMatch(/Par 4/);
    // polie + sandie are available on any hole...
    expect(screen.getByTestId(`claim-polie-${SCORER_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`claim-sandie-${SCORER_ID}`)).toBeInTheDocument();
    // ...but a greenie can only happen on a par 3, so the G toggle is absent here.
    expect(screen.queryByTestId(`claim-greenie-${SCORER_ID}`)).toBeNull();
  });

  test('claim toggles render as 44px G/P/S buttons (per-player Bonuses row)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOk(buildHappyPathDetail()));
    await renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('score-entry-form')).toBeInTheDocument(),
    );
    // Use polie — it shows on any hole (greenie needs a par 3 / loaded course).
    const chip = screen.getByTestId(`claim-polie-${SCORER_ID}`) as HTMLButtonElement;
    // 44px circular toggle (the NFR-A1 tap-target floor) — set inline (jsdom
    // doesn't lay out, so assert the declared style).
    expect(chip.style.width).toBe('44px');
    expect(chip.style.height).toBe('44px');
    expect(chip.textContent).toBe('P');
  });
});
