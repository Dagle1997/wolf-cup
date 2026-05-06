import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { isInstalledPWA, useIsInstalledPWA } from './display-mode';

type MockMQL = {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function stubMatchMedia(matches: boolean): void {
  const mql: MockMQL = {
    matches,
    media: '(display-mode: standalone)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mql),
  });
}

function stubNavigatorStandalone(standalone: boolean | undefined): void {
  Object.defineProperty(navigator, 'standalone', {
    writable: true,
    configurable: true,
    value: standalone,
  });
}

function clearNavigatorStandalone(): void {
  // delete via redefining as undefined with configurable so each test starts clean.
  try {
    Reflect.deleteProperty(navigator, 'standalone');
  } catch {
    // Some jsdom builds make it non-configurable after first set; fall back
    // to writing undefined.
    Object.defineProperty(navigator, 'standalone', {
      writable: true,
      configurable: true,
      value: undefined,
    });
  }
}

describe('isInstalledPWA', () => {
  afterEach(() => {
    clearNavigatorStandalone();
    vi.unstubAllGlobals();
  });

  it('returns true when display-mode: standalone matches', () => {
    stubMatchMedia(true);
    expect(isInstalledPWA()).toBe(true);
  });

  it('returns true when display-mode does not match but navigator.standalone === true (iOS fallback)', () => {
    stubMatchMedia(false);
    stubNavigatorStandalone(true);
    expect(isInstalledPWA()).toBe(true);
  });

  it('returns false when both display-mode does not match and navigator.standalone is falsy', () => {
    stubMatchMedia(false);
    stubNavigatorStandalone(false);
    expect(isInstalledPWA()).toBe(false);
  });

  it('returns false when window is undefined (SSR safety)', () => {
    vi.stubGlobal('window', undefined);
    expect(isInstalledPWA()).toBe(false);
  });
});

describe('useIsInstalledPWA', () => {
  type ChangeListener = (e: { matches: boolean }) => void;

  function stubMatchMediaWithListener(initialMatches: boolean) {
    let captured: ChangeListener | null = null;
    const mql = {
      matches: initialMatches,
      media: '(display-mode: standalone)',
      addEventListener: vi.fn(
        (_evt: string, fn: ChangeListener) => {
          captured = fn;
        },
      ),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });
    return {
      mql,
      fireChange: (matches: boolean) => {
        if (captured !== null) {
          mql.matches = matches;
          captured({ matches });
        }
      },
    };
  }

  afterEach(() => {
    clearNavigatorStandalone();
    vi.unstubAllGlobals();
  });

  it('returns the initial matchMedia value at mount', () => {
    stubMatchMediaWithListener(true);
    const { result } = renderHook(() => useIsInstalledPWA());
    expect(result.current).toBe(true);
  });

  it('registers an addEventListener("change", ...) on the MediaQueryList', () => {
    const { mql } = stubMatchMediaWithListener(false);
    renderHook(() => useIsInstalledPWA());
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('re-renders with the new value when the matchMedia change handler fires', () => {
    const { fireChange } = stubMatchMediaWithListener(false);
    const { result } = renderHook(() => useIsInstalledPWA());
    expect(result.current).toBe(false);
    act(() => fireChange(true));
    expect(result.current).toBe(true);
  });

  it('removes the SAME listener reference on unmount', () => {
    const { mql } = stubMatchMediaWithListener(true);
    const { unmount } = renderHook(() => useIsInstalledPWA());
    // Capture the exact callback passed to addEventListener so we can
    // verify removeEventListener received the SAME reference (codex
    // impl-codex round-2 Low #1 — ensures cleanup actually detaches the
    // listener rather than registering an unrelated identity).
    const addCallArgs = mql.addEventListener.mock.calls[0];
    expect(addCallArgs).toBeDefined();
    const registeredHandler = addCallArgs![1];
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', registeredHandler);
  });
});
