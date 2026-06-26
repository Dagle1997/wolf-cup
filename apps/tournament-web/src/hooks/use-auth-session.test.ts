/**
 * T11-2 use-auth-session loader-helpers tests.
 *
 * Covers the four T11-2 exports added to hooks/use-auth-session.ts:
 *   - LoaderAuthStatus type (compile-time; not directly tested)
 *   - validateLoaderAuthStatus(body) — 6 input shapes
 *   - loadLoaderAuthStatus() — 3 fetch outcomes
 *   - requireAuthOrRedirect(opts?) — 4 cases incl redirect path + query-options assertion
 *
 * Test hazards addressed per spec Section 3b:
 *   - beforeEach clears the ['auth-status'] cache via queryClient.removeQueries
 *     to prevent inter-test contamination from the module-level queryClient
 *     singleton imported by requireAuthOrRedirect.
 *   - window.location.assign is stubbed via Object.defineProperty (the
 *     jsdom-safe pattern verified in me.test.tsx). Naïve `window.location =`
 *     assignment fails on modern jsdom.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { queryClient } from '../lib/query-client';
import {
  fetchAuthStatus,
  loadLoaderAuthStatus,
  requireAuthOrRedirect,
  validateLoaderAuthStatus,
} from './use-auth-session';

// ────────────────────────────────────────────────────────────────────────────
// Test setup: stub fetch + window.location.assign per Section 3b. Clear the
// shared ['auth-status'] cache before each test so requireAuthOrRedirect
// reliably hits the network path.
// ────────────────────────────────────────────────────────────────────────────

let assignSpy: ReturnType<typeof vi.fn>;
// Capture the original window.location descriptor so afterEach can restore
// it — Object.defineProperty replacement is NOT undone by vi.unstubAllGlobals,
// so without this the stubbed location leaks into other test files in the
// same worker (codex impl M#1).
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  assignSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignSpy },
  });
  queryClient.removeQueries({ queryKey: ['auth-status'] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalLocationDescriptor) {
    Object.defineProperty(window, 'location', originalLocationDescriptor);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// validateLoaderAuthStatus — 6 input shapes
// ────────────────────────────────────────────────────────────────────────────

describe('validateLoaderAuthStatus', () => {
  test('null input → {player: null}', () => {
    expect(validateLoaderAuthStatus(null)).toEqual({ player: null });
  });

  test('non-object input (string) → {player: null}', () => {
    expect(validateLoaderAuthStatus('not-an-object')).toEqual({ player: null });
  });

  test('object with no player field → {player: null}', () => {
    expect(validateLoaderAuthStatus({ device: {} })).toEqual({ player: null });
  });

  test('player explicitly null → {player: null}', () => {
    expect(validateLoaderAuthStatus({ player: null })).toEqual({ player: null });
  });

  test('valid player → returns extracted shape', () => {
    expect(
      validateLoaderAuthStatus({ player: { id: 'p-1', isOrganizer: true } }),
    ).toEqual({ player: { id: 'p-1', isOrganizer: true } });
  });

  test('malformed player (string id missing OR wrong isOrganizer type) → {player: null}', () => {
    expect(
      validateLoaderAuthStatus({ player: { id: 42, isOrganizer: true } }),
    ).toEqual({ player: null });
    expect(
      validateLoaderAuthStatus({ player: { id: 'p-1', isOrganizer: 'yes' } }),
    ).toEqual({ player: null });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// loadLoaderAuthStatus — 3 fetch outcomes
// ────────────────────────────────────────────────────────────────────────────

describe('loadLoaderAuthStatus', () => {
  test('happy path: fetch returns valid body → extracted player', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ player: { id: 'p-1', isOrganizer: false } }), {
        status: 200,
      }),
    );
    const result = await loadLoaderAuthStatus();
    expect(result).toEqual({ player: { id: 'p-1', isOrganizer: false } });
  });

  test('non-ok response → {player: null}', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    const result = await loadLoaderAuthStatus();
    expect(result).toEqual({ player: null });
  });

  test('fetch throws (network error) → {player: null}', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await loadLoaderAuthStatus();
    expect(result).toEqual({ player: null });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// requireAuthOrRedirect — 4 cases including redirect path + query-options
// assertion (the "load-bearing query options" AC-7 requirement: verify the
// helper actually configures fetchQuery with queryKey/queryFn/staleTime/retry
// per spec).
// ────────────────────────────────────────────────────────────────────────────

describe('requireAuthOrRedirect', () => {
  test('happy path with default cache freshness → returns {player}, calls fetchQuery with staleTime 30s + retry false', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ player: { id: 'p-1', isOrganizer: true } }), {
        status: 200,
      }),
    );
    const fetchQuerySpy = vi.spyOn(queryClient, 'fetchQuery');

    const result = await requireAuthOrRedirect();

    expect(result).toEqual({ player: { id: 'p-1', isOrganizer: true } });
    expect(fetchQuerySpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchQuerySpy.mock.calls[0]![0]!;
    expect(callArgs.queryKey).toEqual(['auth-status']);
    expect(callArgs.staleTime).toBe(30_000);
    expect(callArgs.retry).toBe(false);
    // Cache-shape consistency (H#1): queryFn MUST be the shared
    // fetchAuthStatus (full {player, device} shape) so useAuthSession
    // consumers (InstallPromptHost/AwardCelebration) keep reading device.
    expect(callArgs.queryFn).toBe(fetchAuthStatus);
  });

  test("'always' freshness → fetchQuery with staleTime 0 + retry false", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ player: { id: 'p-2', isOrganizer: false } }), {
        status: 200,
      }),
    );
    const fetchQuerySpy = vi.spyOn(queryClient, 'fetchQuery');

    const result = await requireAuthOrRedirect({ freshness: 'always' });

    expect(result).toEqual({ player: { id: 'p-2', isOrganizer: false } });
    expect(fetchQuerySpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchQuerySpy.mock.calls[0]![0]!;
    expect(callArgs.queryKey).toEqual(['auth-status']);
    expect(callArgs.staleTime).toBe(0);
    expect(callArgs.retry).toBe(false);
  });

  test('null player → redirects to /join (code-first, NOT forced Google) AND throws Error("redirecting-to-join")', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ player: null }), { status: 200 }),
    );

    await expect(requireAuthOrRedirect()).rejects.toThrow('redirecting-to-join');
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(assignSpy).toHaveBeenCalledWith(expect.stringMatching(/^\/join/));
    // Must NOT bounce a logged-out player straight into Google OAuth.
    expect(assignSpy).not.toHaveBeenCalledWith('/api/auth/google');
  });

  test('thrown Error has exact message string "redirecting-to-join" (TanStack Router beforeLoad contract)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ player: null }), { status: 200 }),
    );

    let caught: unknown = null;
    try {
      await requireAuthOrRedirect();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('redirecting-to-join');
  });
});
