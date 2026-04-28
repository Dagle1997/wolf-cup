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

const { enqueueSpy } = vi.hoisted(() => ({ enqueueSpy: vi.fn() }));

vi.mock('../lib/offline-queue.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/offline-queue.js')>(
    '../lib/offline-queue.js',
  );
  return {
    ...actual,
    enqueueMutation: enqueueSpy,
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

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn());
  enqueueSpy.mockReset();
  enqueueSpy.mockResolvedValue(undefined);
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
    expect(screen.getByTestId('scorecard-shell-strip').textContent).toMatch(
      /Hole 1.*Par 4.*SI 1/,
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
    expect(screen.getByTestId('scorecard-shell-strip').textContent).toMatch(
      /Hole 1.*Par 4.*SI 1/,
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
});
